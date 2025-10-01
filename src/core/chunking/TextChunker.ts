import type { ChunkInfo } from "./types";
import { MarkdownChunker } from "./MarkdownChunker";

export class TextChunker {
	constructor() {}

	public chunkText(noteContent: string, filePath?: string): ChunkInfo[] {
		const fileName = this.extractTitleFromPath(filePath);

		if (!noteContent.trim()) {
			if (!fileName) return [];
			return [
				{
					chunk: fileName,
					metadata: {
						filePath: filePath || "",
						startPosition: -1,
						endPosition: -1,
						createdAt: new Date(),
					},
				},
			];
		}
		const chunksFromMarkdown = MarkdownChunker.chunkMarkdown(noteContent);

		if (chunksFromMarkdown.length === 0) {
			// MarkdownChunker がチャンクを返さなかったが、内容は空ではない場合
			// この場合もタイトルをチャンクとする
			if (!fileName) return [];
			return [
				{
					chunk: fileName,
					metadata: {
						filePath: filePath || "",
						startPosition: -1,
						endPosition: -1,
						createdAt: new Date(),
					},
				},
			];
		}

		return chunksFromMarkdown.map((chunk, index) => {
			// 最初のチャンクにはファイル名を付加する
			const chunkContent =
				index === 0 && fileName
					? `${fileName}: ${chunk.text}`
					: chunk.text;

			return {
				chunk: chunkContent,
				metadata: {
					filePath: filePath || "",
					startPosition: chunk.originalOffsetStart,
					endPosition: chunk.originalOffsetEnd,
					createdAt: new Date(),
				},
			};
		});
	}

	private extractTitleFromPath(filePath?: string): string {
		if (!filePath) return "";
		const fileName = filePath.split(/[/\\]/).pop();
		if (!fileName) return "";
		const titleMatch = fileName.match(/^(.*)\.[^.]+$/);
		return titleMatch ? titleMatch[1] : fileName;
	}
}
