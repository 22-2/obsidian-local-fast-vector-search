export interface ChunkMetadata {
	filePath: string;
	startPosition: number;
	endPosition: number;
	createdAt: Date;
	tags?: string[];
}

export interface ChunkInfo {
	chunk: string;
	metadata: ChunkMetadata;
}

export interface ChunkingOptions {
	maxChunkCharacters: number;
	removeFrontmatter?: boolean;
}

export interface Chunk {
	text: string;
	originalOffsetStart: number;
	originalOffsetEnd: number;
	contributingSegmentIds?: string[];
}
