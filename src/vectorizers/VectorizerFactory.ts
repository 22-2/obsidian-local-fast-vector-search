import { IVectorizer } from "./IVectorizer";
import { WorkerProxyVectorizer } from "./WorkerProxyVectorizer";

export interface VectorizerOptions {
	endpoint?: string;
	apiKey?: string;
}

/**
 * Factory to create IVectorizer based on provider name
 * @param provider 'transformer' (uses worker) or 'ollama' (uses API)
 * @param options required dependencies per provider
 */
export function createVectorizer(provider: string): IVectorizer {
	switch (provider) {
		case "transformer":
			console.log("Creating WorkerProxyVectorizer...");
			return new WorkerProxyVectorizer();
		default:
			throw new Error(`Unknown vectorizer provider: ${provider}`);
	}
}
