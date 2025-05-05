import { IVectorizer } from "./IVectorizer";
import { TransformerVectorizer } from "./TransformerVectorizer";
import type { PreTrainedModelType, PreTrainedTokenizerType } from "../types";

export interface VectorizerOptions {
	model?: PreTrainedModelType;
	tokenizer?: PreTrainedTokenizerType;
	Tensor?: any;
	/** endpoint URL */
	endpoint?: string;
	/** API key if needed */
	apiKey?: string;
}

/**
 * Factory to create IVectorizer based on provider name
 * @param options required dependencies per provider
 */
export function createVectorizer(
	provider: string,
	options: VectorizerOptions
): IVectorizer {
	switch (provider) {
		case "transformer":
			if (!options.model || !options.tokenizer || !options.Tensor) {
				throw new Error(
					"TransformerVectorizer requires model, tokenizer, and Tensor."
				);
			}
			return new TransformerVectorizer(
				options.model,
				options.tokenizer,
				options.Tensor
			);

		default:
			throw new Error(`Unknown vectorizer provider: ${provider}`);
	}
}
