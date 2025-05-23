import { App, TFile } from "obsidian";
import { TextChunker } from "../../core/chunking/TextChunker";
import { LoggerService } from "../../shared/services/LoggerService";
import { IntegratedWorkerProxy } from "../workers/IntegratedWorkerProxy";
import { ChunkInfo } from "../storage/types";

export class VectorizationService {
	private logger: LoggerService | null;
	constructor(
		private app: App,
		private workerProxy: IntegratedWorkerProxy, // IVectorizer と PGliteVectorStore の代わりに workerProxy を使用
		private textChunker: TextChunker,
		logger: LoggerService | null
	) {
		this.logger = logger;
	}

	public async vectorizeAllNotes(
		onProgress?: (message: string, isOverallProgress?: boolean) => void
	): Promise<{ totalVectorsProcessed: number }> {
		const files = this.app.vault.getMarkdownFiles();
		let totalVectorsProcessed = 0;
		const allChunksToProcess: ChunkInfo[] = [];

		if (onProgress)
			onProgress("Starting vectorization for all notes...", true);

		for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
			const file = files[fileIndex];
			const progressPercent = (
				((fileIndex + 1) / files.length) *
				100
			).toFixed(1);
			let noticeMessage = `Processing file ${fileIndex + 1}/${
				files.length
			} (${progressPercent}%): ${file.basename}`;

			try {
				const content = await this.app.vault.cachedRead(file);
				if (!content.trim()) {
					this.logger?.verbose_log(
						`Skipping empty file: ${file.path}`
					);
					if (onProgress)
						onProgress(`${noticeMessage} (skipped empty)`, false);
					continue;
				}
				const chunkInfos = this.textChunker.chunkText(content);
				if (chunkInfos.length === 0) {
					this.logger?.verbose_log(
						`No chunks generated for file: ${file.path}`
					);
					if (onProgress)
						onProgress(`${noticeMessage} (no chunks)`, false);
					continue;
				}

				const chunksWithFilePath: ChunkInfo[] = chunkInfos.map(
					(chunk) => ({
						filePath: file.path,
						chunkOffsetStart: chunk.metadata.startPosition,
						chunkOffsetEnd: chunk.metadata.endPosition,
						text: chunk.chunk,
					})
				);
				allChunksToProcess.push(...chunksWithFilePath);
				if (onProgress) onProgress(noticeMessage, false);
			} catch (fileError) {
				this.logger?.error(
					`Failed to process file ${file.path}:`,
					fileError
				);
				if (onProgress)
					onProgress(
						`Skipping file ${file.basename} due to error. Check console.`,
						false
					);
				// Consider collecting errors to report at the end
			}
		}

		if (allChunksToProcess.length > 0) {
			if (onProgress)
				onProgress(
					`Vectorizing and storing ${allChunksToProcess.length} chunks...`,
					true
				);
			const result = await this.workerProxy.vectorizeAndStoreChunks(
				allChunksToProcess
			);
			totalVectorsProcessed = result.count;
			this.logger?.verbose_log(
				`Upserted ${totalVectorsProcessed} vectors in batch.`
			);
		} else {
			if (onProgress)
				onProgress("No new vectors to save from any notes.", true);
		}
		return { totalVectorsProcessed };
	}
}
