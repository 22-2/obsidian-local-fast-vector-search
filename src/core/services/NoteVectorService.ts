import { App, TFile } from "obsidian";
import type { PluginSettings } from "src/pluginSettings";
import { LoggerService } from "../../shared/services/LoggerService";
import { TextChunker } from "../chunking/TextChunker";
import type { SimilarityResultItem } from "../storage/types";
import { IntegratedWorkerProxy } from "../workers/IntegratedWorkerProxy";

export class NoteVectorService {
	constructor(
		private app: App,
		private textChunker: TextChunker,
		private workerProxy: IntegratedWorkerProxy,
		private logger: LoggerService | null,
		private settings: PluginSettings
	) {}

	public async getNoteVector(file: TFile): Promise<number[] | null> {
		const content = await this.app.vault.cachedRead(file);
		if (!content.trim()) {
			this.logger?.verbose_log(
				`Note ${file.path} is empty, skipping vector generation.`
			);
			return null;
		}

		const chunkInfos = await this.textChunker.chunkText(
			content,
			file.path,
			this.settings
		);
		if (chunkInfos.length === 0) {
			this.logger?.verbose_log(
				`No chunks generated for note ${file.path}.`
			);
			return null;
		}

		const chunkTexts = chunkInfos.map((ci) => ci.chunk);

		try {
			const chunkVectors = await this.workerProxy.vectorizeSentences(
				chunkTexts
			);
			if (!chunkVectors || chunkVectors.length === 0) {
				this.logger?.warn(
					`Vectorization returned no vectors for note ${file.path}.`
				);
				return null;
			}
			const noteVector = await this.workerProxy.averageVectors(
				chunkVectors
			);
			return noteVector;
		} catch (error) {
			this.logger?.error(
				`Error generating note vector for ${file.path}:`,
				error
			);
			return null;
		}
	}

	public async getNoteVectorFromDB(file: TFile): Promise<number[] | null> {
		if (!this.app.vault.getAbstractFileByPath(file.path)) {
			this.logger?.verbose_log(
				`File ${file.path} does not exist in vault, skipping vector retrieval.`
			);
			return null;
		}
		this.logger?.log(`Getting note vector from DB for ${file.path}`);
		try {
			const chunkVectors = await this.workerProxy.getVectorsByFilePath(
				file.path
			);

			this.logger?.log(
				`getVectorsByFilePath returned ${
					chunkVectors?.length || 0
				} vectors for ${file.path}`
			);

			if (!chunkVectors || chunkVectors.length === 0) {
				this.logger?.warn(
					`⚠️ No vectors found in DB for note ${file.path}. The file needs to be vectorized. Try running "Rebuild index for current note" command.`
				);
				return null;
			}

			this.logger?.verbose_log(
				`Found ${chunkVectors.length} chunk vectors for ${file.path}. Averaging...`
			);
			const noteVector = await this.workerProxy.averageVectors(
				chunkVectors
			);
			return noteVector;
		} catch (error) {
			this.logger?.error(
				`Error getting note vector from DB for ${file.path}:`,
				error
			);
			return null;
		}
	}

	public async findSimilarChunks(
		noteVector: number[],
		limit: number,
		excludeFilePaths: string[] = []
	): Promise<SimilarityResultItem[]> {
		if (!noteVector || noteVector.length === 0) {
			return [];
		}
		try {
			const results = await this.workerProxy.searchSimilarByVector(
				noteVector,
				limit,
				excludeFilePaths.length > 0
					? { excludeFilePaths: excludeFilePaths }
					: undefined
			);
			return results;
		} catch (error) {
			this.logger?.error(
				"Error finding similar chunks by vector:",
				error
			);
			throw error;
		}
	}
}
