import {
	split as splitSentencesInternal,
	SentenceSplitterSyntax,
} from "sentence-splitter";
import type { Chunk } from "./types";
import {
	MAX_CHUNK_SIZE,
	MAX_SENTENCE_CHARS,
	MIN_SENTENCE_CHARS,
} from "../../shared/constants/appConstants";

interface SentenceWithOffset {
	text: string;
	startOffset: number;
	endOffset: number;
}

interface CacheEntry {
	chunks: Chunk[];
	timestamp: number;
}

export class MarkdownChunker {
	private static cache = new Map<string, CacheEntry>();
	private static readonly MAX_CACHE_SIZE = 100;
	private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5分

	/**
	 * ノート内容のSHA-256ハッシュを生成
	 */
	private static async computeHash(content: string): Promise<string> {
		const encoder = new TextEncoder();
		const data = encoder.encode(content);
		const hashBuffer = await crypto.subtle.digest("SHA-256", data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
	}

	/**
	 * キャッシュのクリーンアップ
	 */
	private static cleanupCache(): void {
		const now = Date.now();
		const entriesToDelete: string[] = [];

		// 期限切れエントリーを削除
		for (const [hash, entry] of this.cache.entries()) {
			if (now - entry.timestamp > this.CACHE_TTL_MS) {
				entriesToDelete.push(hash);
			}
		}

		entriesToDelete.forEach((hash) => this.cache.delete(hash));

		// キャッシュサイズ制限を超えた場合、古いエントリーから削除
		if (this.cache.size > this.MAX_CACHE_SIZE) {
			const sortedEntries = Array.from(this.cache.entries()).sort(
				(a, b) => a[1].timestamp - b[1].timestamp
			);
			const deleteCount = this.cache.size - this.MAX_CACHE_SIZE;
			for (let i = 0; i < deleteCount; i++) {
				this.cache.delete(sortedEntries[i][0]);
			}
		}
	}

	/**
	 * キャッシュをクリア
	 */
	public static clearCache(): void {
		this.cache.clear();
	}

	public static async chunkMarkdown(noteContent: string): Promise<Chunk[]> {
		// ハッシュを計算してキャッシュをチェック
		const contentHash = await this.computeHash(noteContent);
		const cachedEntry = this.cache.get(contentHash);
		const now = Date.now();

		// キャッシュヒット: 有効期限内のエントリーがあれば返す
		if (cachedEntry && now - cachedEntry.timestamp <= this.CACHE_TTL_MS) {
			// チャンクオブジェクトのディープコピーを返す(参照を避ける)
			return cachedEntry.chunks.map((chunk) => ({
				text: chunk.text,
				originalOffsetStart: chunk.originalOffsetStart,
				originalOffsetEnd: chunk.originalOffsetEnd,
				contributingSegmentIds: chunk.contributingSegmentIds
					? [...chunk.contributingSegmentIds]
					: [],
			}));
		}

		// キャッシュミス: チャンクを生成
		const { processedText, frontmatterLength } =
			this.removeFrontmatter(noteContent);

		// URLを除去（位置関係は維持）
		const textWithoutUrls = this.removeUrls(processedText);

		if (!textWithoutUrls.trim()) {
			return [];
		}

		const sentences = this.splitIntoSentences(textWithoutUrls);
		const chunks: Chunk[] = [];
		let currentChunk = "";
		let chunkStartOffset = -1;
		let chunkEndOffset = -1;

		for (const sentence of sentences) {
			const sentenceStart = frontmatterLength + sentence.startOffset;
			const sentenceEnd = frontmatterLength + sentence.endOffset;
			if (sentence.text.length > MAX_CHUNK_SIZE) {
				if (currentChunk) {
					chunks.push({
						text: currentChunk,
						originalOffsetStart: chunkStartOffset,
						originalOffsetEnd: chunkEndOffset,
						contributingSegmentIds: [],
					});
					currentChunk = "";
					chunkStartOffset = -1;
					chunkEndOffset = -1;
				}
				chunks.push({
					text: sentence.text,
					originalOffsetStart: sentenceStart,
					originalOffsetEnd: sentenceEnd,
					contributingSegmentIds: [],
				});
				continue;
			}

			const potential =
				currentChunk + (currentChunk ? " " : "") + sentence.text;
			if (potential.length <= MAX_CHUNK_SIZE) {
				currentChunk = potential;
				if (chunkStartOffset === -1) {
					chunkStartOffset = sentenceStart;
				}
				chunkEndOffset = sentenceEnd;
			} else {
				if (currentChunk) {
					chunks.push({
						text: currentChunk,
						originalOffsetStart: chunkStartOffset,
						originalOffsetEnd: chunkEndOffset,
						contributingSegmentIds: [],
					});
				}
				currentChunk = sentence.text;
				chunkStartOffset = sentenceStart;
				chunkEndOffset = sentenceEnd;
			}
		}

		if (currentChunk) {
			chunks.push({
				text: currentChunk,
				originalOffsetStart: chunkStartOffset,
				originalOffsetEnd: chunkEndOffset,
				contributingSegmentIds: [],
			});
		}

		// キャッシュに保存
		this.cache.set(contentHash, {
			chunks: chunks.map((chunk) => ({
				text: chunk.text,
				originalOffsetStart: chunk.originalOffsetStart,
				originalOffsetEnd: chunk.originalOffsetEnd,
				contributingSegmentIds: chunk.contributingSegmentIds
					? [...chunk.contributingSegmentIds]
					: [],
			})),
			timestamp: now,
		});

		this.cleanupCache();

		return chunks;
	}

	/**
	 * URLを除去（位置関係を保つため空白で置換）
	 */
	private static removeUrls(text: string): string {
		// http:// または https:// で始まるURLを空白で置換
		const URL_REGEX = /https?:\/\/[^\s\)>\]]+/g;
		return text.replace(URL_REGEX, (match) => " ".repeat(match.length));
	}

	/**
	 * フロントマターを除去
	 */
	private static removeFrontmatter(text: string): {
		processedText: string;
		frontmatterLength: number;
	} {
		const FRONTMATTER_REGEX =
			/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---\s*[\r\n]+/;
		const fmMatch = text.match(FRONTMATTER_REGEX);

		if (fmMatch) {
			return {
				processedText: text.substring(fmMatch[0].length),
				frontmatterLength: fmMatch[0].length,
			};
		}

		return { processedText: text, frontmatterLength: 0 };
	}

	private static splitIntoSentences(text: string): SentenceWithOffset[] {
		const nodes = splitSentencesInternal(text);
		const results: SentenceWithOffset[] = [];
		for (const node of nodes) {
			if (!node || node.type !== SentenceSplitterSyntax.Sentence) {
				continue;
			}
			const range = node.range;
			if (!range || range.length !== 2) {
				continue;
			}
			const [rangeStart, rangeEnd] = range;
			if (
				typeof rangeStart !== "number" ||
				typeof rangeEnd !== "number" ||
				rangeEnd <= rangeStart
			) {
				continue;
			}
			const rawSentence = text.slice(rangeStart, rangeEnd);
			const trimmedLeading =
				rawSentence.length - rawSentence.trimStart().length;
			const trimmedTrailing =
				rawSentence.length - rawSentence.trimEnd().length;
			const trimmedSentence = rawSentence.slice(
				trimmedLeading,
				trimmedTrailing > 0 ? -trimmedTrailing : undefined
			);
			if (!trimmedSentence) {
				continue;
			}
			const baseStartOffset = rangeStart + trimmedLeading;
			// 長すぎる文はさらに分割
			if (trimmedSentence.length > MAX_SENTENCE_CHARS) {
				this.splitSentenceByMaxLength(
					trimmedSentence,
					baseStartOffset,
					results
				);
			} else {
				results.push({
					text: trimmedSentence,
					startOffset: baseStartOffset,
					endOffset: baseStartOffset + trimmedSentence.length,
				});
			}
		}
		return results;
	}

	private static splitSentenceByMaxLength(
		sentenceText: string,
		baseStartOffset: number,
		output: SentenceWithOffset[]
	): void {
		let cursor = 0;
		while (cursor < sentenceText.length) {
			let segmentEnd = Math.min(
				cursor + MAX_SENTENCE_CHARS,
				sentenceText.length
			);
			if (segmentEnd < sentenceText.length) {
				segmentEnd = this.findSplitIndex(
					sentenceText,
					cursor,
					segmentEnd
				);
			}
			segmentEnd = Math.max(segmentEnd, cursor + MIN_SENTENCE_CHARS);
			const segmentRaw = sentenceText.slice(cursor, segmentEnd);
			const trimmedLeading =
				segmentRaw.length - segmentRaw.trimStart().length;
			const trimmedTrailing =
				segmentRaw.length - segmentRaw.trimEnd().length;
			const segmentText = segmentRaw.slice(
				trimmedLeading,
				trimmedTrailing > 0 ? -trimmedTrailing : undefined
			);
			if (segmentText.length > 0) {
				const segmentStartOffset =
					baseStartOffset + cursor + trimmedLeading;
				const segmentEndOffset =
					segmentStartOffset + segmentText.length;
				output.push({
					text: segmentText,
					startOffset: segmentStartOffset,
					endOffset: segmentEndOffset,
				});
			}
			cursor = segmentEnd;
		}
	}

	private static findSplitIndex(
		text: string,
		cursor: number,
		preferredEnd: number
	): number {
		for (let i = preferredEnd; i > cursor; i--) {
			if (i - cursor < MIN_SENTENCE_CHARS) {
				continue;
			}
			const char = text.charAt(i - 1);
			if (this.isPreferredSplitCharacter(char)) {
				return i;
			}
		}
		return Math.max(cursor + MIN_SENTENCE_CHARS, preferredEnd);
	}

	private static isPreferredSplitCharacter(char: string): boolean {
		if (!char) {
			return false;
		}
		return /\s/.test(char) || "。、，．,.!?！？；：".includes(char);
	}
}
