export const DB_NAME = "local-fast-vector-search"; // Idbの名前
export const EMBEDDINGS_TABLE_NAME = "embeddings";
export const EMBEDDINGS_DIMENSIONS = 256;
export const MIN_CHUNK_SIZE = 150;
export const MAX_CHUNK_SIZE = 1000;
export const MAX_SENTENCE_CHARS = 100;
export const MIN_SENTENCE_CHARS = 5;

// hnsw parameters
export const HNSW_M = 8;
export const HNSW_EF_CONSTRUCTION = 64;
export const HNSW_EF_SEARCH = 220;
