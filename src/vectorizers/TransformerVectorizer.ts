import type {
	PreTrainedModelType,
	PreTrainedTokenizerType,
	TensorType,
} from "../types";
import { IVectorizer } from "./IVectorizer";

export class TransformerVectorizer implements IVectorizer {
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
		// ...copy logic from original Vectorizer...
		const inputs = this.tokenizer(sentences, {
			padding: true,
			truncation: true,
		});

		const outputs = await this.model(inputs);
		let embeddingTensor: TensorType;

		if (outputs.sentence_embedding instanceof this.Tensor) {
			embeddingTensor = outputs.sentence_embedding;
		} else if (outputs.last_hidden_state instanceof this.Tensor) {
			const hidden = outputs.last_hidden_state;
			const mask = new this.Tensor(inputs.attention_mask).unsqueeze(2);
			const sum = hidden.mul(mask).sum(1);
			const denom = mask.sum(1).clamp_(1e-9, Infinity);
			embeddingTensor = sum.div(denom);
		} else {
			console.error("Model output keys:", Object.keys(outputs));
			throw new Error(
				"埋め込みテンソルが見つかりません。モデルの構造が正常でない可能性があります。"
			);
		}

		let resultVectors = (embeddingTensor.tolist() as number[][]).map(
			(vec) => {
				if (vec.length > this.VECTOR_DIMENSION) {
					vec = vec.slice(0, this.VECTOR_DIMENSION);
				}
				const norm = Math.hypot(...vec);
				return norm > 0 ? vec.map((x) => x / norm) : vec;
			}
		);

		return resultVectors;
	}
}
