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
	chunkSize: number; // サイズベースチャンキング時の目標チャンクサイズ（文字数）
	removeFrontmatter?: boolean; // フロントマターを削除するかどうか
}
