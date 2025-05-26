import type { ChunkInfo, ChunkingOptions } from "./types";

import {
	split as splitSentencesInternal,
	SentenceSplitterSyntax,
} from "sentence-splitter";

interface TxtNode {
	type: string;
	raw: string;
	range: TxtNodeRange;
	loc: TxtNodeLineLocation;
	parent?: TxtNode;
}

interface TxtNodeLineLocation {
	start: TxtNodePosition;
	end: TxtNodePosition;
}

interface TxtNodePosition {
	line: number;
	column: number;
}

export type TxtNodeRange = readonly [startIndex: number, endIndex: number];
interface SentenceASTNode extends TxtNode {
	type: typeof SentenceSplitterSyntax.Sentence;
	raw: string;
	range: [number, number];
}

const DEFAULT_CHUNKING_OPTIONS: ChunkingOptions = {
	maxChunkCharacters: 512,
	removeFrontmatter: true,
};

export class TextChunker {
	private options: ChunkingOptions;

	constructor(options: Partial<ChunkingOptions> = {}) {
		this.options = { ...DEFAULT_CHUNKING_OPTIONS, ...options };
	}

	// フロントマターを削除する（オプション）
	private removeFrontmatterIfExists(text: string): {
		processedText: string;
		frontmatterLength: number;
	} {
		if (this.options.removeFrontmatter) {
			const fmMatch = text.match(
				/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---\s*[\r\n]+/
			);
			if (fmMatch) {
				return {
					processedText: text.substring(fmMatch[0].length),
					frontmatterLength: fmMatch[0].length,
				};
			}
		}
		return { processedText: text, frontmatterLength: 0 };
	}

	public chunkText(text: string, filePath?: string): ChunkInfo[] {
		if (!text) {
			return [];
		}

		const { processedText, frontmatterLength } =
			this.removeFrontmatterIfExists(text);

		if (!processedText.trim()) {
			return [];
		}

		const chunks: ChunkInfo[] = [];
		const fileName = this.extractTitleFromPath(filePath);
		let isFirstChunk = true;

		const allAstNodes: TxtNode[] = splitSentencesInternal(processedText);

		const sentences: SentenceASTNode[] = allAstNodes.filter(
			(node): node is SentenceASTNode =>
				node.type === SentenceSplitterSyntax.Sentence
		);

		if (sentences.length === 0) {
			return [];
		}

		let currentChunkSentencesText: string[] = [];
		let currentChunkSentencesRanges: Array<{ start: number; end: number }> =
			[];
		let currentChunkCombinedLength = 0;

		for (const sentence of sentences) {
			const sentenceText = sentence.raw; // Raw text of the sentence
			const sentenceLength = sentenceText.length;
			// range is [start, end) relative to processedText
			const sentenceStartInProcessedText = sentence.range[0];
			const sentenceEndInProcessedText = sentence.range[1];

			// Case 1: The current sentence itself is longer than or equal to maxChunkCharacters.
			// It forms a chunk on its own.
			if (sentenceLength >= this.options.maxChunkCharacters) {
				// First, if there's a pending chunk being built, finalize and add it.
				if (currentChunkSentencesText.length > 0) {
					const chunkContent = currentChunkSentencesText.join(" ");
					const chunkContentForPush = isFirstChunk
						? `${fileName}: ${chunkContent}`
						: chunkContent;
					chunks.push({
						chunk: chunkContentForPush,
						metadata: {
							filePath: filePath || "",
							// Start of the first sentence, end of the last sentence in this chunk
							startPosition:
								frontmatterLength +
								currentChunkSentencesRanges[0].start,
							endPosition:
								frontmatterLength +
								currentChunkSentencesRanges[
									currentChunkSentencesRanges.length - 1
								].end,
							createdAt: new Date(),
						},
					});
					isFirstChunk = false; // 最初のチャンクが追加されたのでフラグをfalseに設定
					// Reset for the next chunk
					currentChunkSentencesText = [];
					currentChunkSentencesRanges = [];
					currentChunkCombinedLength = 0;
				}

				// Add the very long sentence as its own chunk
				const sentenceTextForPush = isFirstChunk
					? `${fileName}: ${sentenceText}`
					: sentenceText;
				chunks.push({
					chunk: sentenceTextForPush,
					metadata: {
						filePath: filePath || "",
						startPosition:
							frontmatterLength + sentenceStartInProcessedText,
						endPosition:
							frontmatterLength + sentenceEndInProcessedText,
						createdAt: new Date(),
					},
				});
				isFirstChunk = false; // 最初のチャンクが追加されたのでフラグをfalseに設定
				continue; // Move to the next sentence
			}

			// Case 2: Adding this sentence to the current chunk would exceed maxChunkCharacters.
			// Finalize the current chunk, then start a new one with this sentence.
			// Length check: current content + space (if not first) + new sentence
			const potentialNewLength =
				currentChunkCombinedLength +
				(currentChunkSentencesText.length > 0 ? 1 : 0) + // for the space separator
				sentenceLength;

			if (
				currentChunkSentencesText.length > 0 &&
				potentialNewLength > this.options.maxChunkCharacters
			) {
				// Finalize the current chunk
				const chunkContent = currentChunkSentencesText.join(" ");
				const chunkContentForPush = isFirstChunk
					? `${fileName}: ${chunkContent}`
					: chunkContent;
				chunks.push({
					chunk: chunkContentForPush,
					metadata: {
						filePath: filePath || "",
						startPosition:
							frontmatterLength +
							currentChunkSentencesRanges[0].start,
						endPosition:
							frontmatterLength +
							currentChunkSentencesRanges[
								currentChunkSentencesRanges.length - 1
							].end,
						createdAt: new Date(),
					},
				});
				isFirstChunk = false; // 最初のチャンクが追加されたのでフラグをfalseに設定

				// Start a new chunk with the current sentence
				currentChunkSentencesText = [sentenceText];
				currentChunkSentencesRanges = [
					{
						start: sentenceStartInProcessedText,
						end: sentenceEndInProcessedText,
					},
				];
				currentChunkCombinedLength = sentenceLength;
			}
			// Case 3: Add this sentence to the current_chunk.
			else {
				currentChunkSentencesText.push(sentenceText);
				currentChunkSentencesRanges.push({
					start: sentenceStartInProcessedText,
					end: sentenceEndInProcessedText,
				});
				// Recalculate combined length accurately using the joined string
				currentChunkCombinedLength =
					currentChunkSentencesText.join(" ").length;
			}
		}

		// After the loop, if there are any remaining sentences in currentChunkSentencesText,
		// form a final chunk from them.
		if (currentChunkSentencesText.length > 0) {
			const chunkContent = currentChunkSentencesText.join(" ");
			const chunkContentForPush = isFirstChunk
				? `${fileName}: ${chunkContent}`
				: chunkContent;
			chunks.push({
				chunk: chunkContentForPush,
				metadata: {
					filePath: filePath || "",
					startPosition:
						frontmatterLength +
						currentChunkSentencesRanges[0].start,
					endPosition:
						frontmatterLength +
						currentChunkSentencesRanges[
							currentChunkSentencesRanges.length - 1
						].end,
					createdAt: new Date(),
				},
			});
			isFirstChunk = false; // 最初のチャンクが追加されたのでフラグをfalseに設定
		}
		return chunks;
	}

	private extractTitleFromPath(filePath?: string): string {
		if (!filePath) return "";
		const fileName = filePath.split(/[/\\]/).pop();
		if (!fileName) return "";
		const titleMatch = fileName.match(/^(.*)\.[^.]+$/);
		return titleMatch ? titleMatch[1] : fileName;
	}
}
