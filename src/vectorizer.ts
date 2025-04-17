import type {
	PreTrainedModelType,
	PreTrainedTokenizerType,
	TensorType,
} from "./types";

export class Vectorizer {
	private model: PreTrainedModelType;
	private tokenizer: PreTrainedTokenizerType;
	private Tensor: any;
	private VECTOR_DIMENSION = 512;

	constructor(
		model: PreTrainedModelType,
		tokenizer: PreTrainedTokenizerType,
		Tensor: any
	) {
		this.model = model;
		this.tokenizer = tokenizer;
		this.Tensor = Tensor;
	}

	async vectorizeSentences(sentences: string[]): Promise<number[][]> {
		try {
			const inputs = this.tokenizer(sentences, {
				padding: true,
				truncation: true,
			});

			const outputs = await this.model(inputs);
			let embeddingTensor: TensorType;

			// 1) sentence_embedding があればそのまま使う
			if (outputs.sentence_embedding instanceof this.Tensor) {
				embeddingTensor = outputs.sentence_embedding;
			}
			// 2) なければ last_hidden_state の平均プーリング
			else if (outputs.last_hidden_state instanceof this.Tensor) {
				const hidden = outputs.last_hidden_state;
				const mask = new this.Tensor(inputs.attention_mask).unsqueeze(
					2
				);
				const sum = hidden.mul(mask).sum(1);
				const denom = mask.sum(1).clamp_(1e-9, Infinity);
				embeddingTensor = sum.div(denom);
			} else {
				console.error("Model output keys:", Object.keys(outputs));
				throw new Error(
					"埋め込みテンソルが見つかりません。モデルの構造が正常でない可能性があります。"
				);
			}

			let resultVectorsNested = embeddingTensor.tolist();
			let resultVectors: number[][] = resultVectorsNested as number[][];

			if (
				resultVectors.length > 0 &&
				resultVectors[0].length > this.VECTOR_DIMENSION
			) {
				resultVectors = resultVectors.map((vector) =>
					vector.slice(0, this.VECTOR_DIMENSION)
				);
			}

			// 正規化
			if (resultVectors.length > 0) {
				resultVectors = resultVectors.map((vec) => {
					const norm = Math.hypot(...vec);
					return norm > 0 ? vec.map((x) => x / norm) : vec;
				});
			}

			return resultVectors;
		} catch (error) {
			console.error("Error during internal vectorization:", error);
			throw error;
		}
	}
}
