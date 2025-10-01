import type { SimilarityResultItem } from "../../core/storage/types";

export interface SimilarityResultItemWithPreview extends SimilarityResultItem {
	previewText?: string;
}
