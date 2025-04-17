import { Plugin, Notice } from "obsidian";

type PreTrainedModelType = import("@huggingface/transformers").PreTrainedModel;
type PreTrainedTokenizerType =
	import("@huggingface/transformers").PreTrainedTokenizer;
type TensorType = import("@huggingface/transformers").Tensor;
type AutoModelType = typeof import("@huggingface/transformers").AutoModel;
type AutoTokenizerType =
	typeof import("@huggingface/transformers").AutoTokenizer;
// ---------------------------------

export default class MyVectorPlugin extends Plugin {
	model: PreTrainedModelType | null = null;
	tokenizer: PreTrainedTokenizerType | null = null;
	isModelReady: boolean = false;
	isLoading: boolean = false;
	private initializationPromise: Promise<void> | null = null;

	// --- transformers のモジュールを保持する変数 ---
	private transformers: {
		AutoModel: AutoModelType;
		AutoTokenizer: AutoTokenizerType;
		Tensor: typeof import("@huggingface/transformers").Tensor;
		env: typeof import("@huggingface/transformers").env;
	} | null = null;
	// -----------------------------------------

	async onload() {
		console.log("MyVectorPlugin loading...");

		this.app.workspace.onLayoutReady(async () => {
			console.log(
				"Obsidian layout ready. Triggering background initialization."
			);
			this.initializeResources().catch((error) => {
				console.error("Background model initialization failed:", error);
			});
		});

		this.addCommand({
			id: "vectorize-current-note",
			name: "Vectorize current note",
			editorCallback: async (editor, view) => {
				try {
					await this.ensureModelInitialized();
				} catch (error) {
					console.error("Model initialization failed:", error);
					new Notice(
						"Failed to initialize AI model. Check console for details."
					);
					return;
				}

				if (!this.isModelReady || !this.model || !this.tokenizer) {
					new Notice(
						"Model is not ready. Initialization might have failed or is still in progress."
					);
					return;
				}

				const text = editor.getValue();
				const sentences = text
					.split(/\n+/)
					.map((s) => s.trim())
					.filter((s) => s.length > 0);

				if (sentences.length === 0) {
					new Notice("No text found to vectorize.");
					return;
				}

				try {
					new Notice(`Vectorizing ${sentences.length} sentences...`);

					// 時間計測開始
					const startTime = performance.now();

					const vectors = await this.vectorizeSentences(sentences);

					// 時間計測終了
					const endTime = performance.now();
					const processingTime = (endTime - startTime) / 1000; // 秒単位に変換

					console.log(
						`Vectorization completed in ${processingTime.toFixed(
							2
						)} seconds.`
					);
					new Notice(
						`Vectorization complete! ${
							vectors.length
						} vectors generated in ${processingTime.toFixed(
							2
						)} seconds.`
					);
					console.log("Generated vectors:", vectors);
				} catch (error) {
					console.error("Vectorization failed:", error);
					new Notice(
						"Vectorization failed. Check console for details."
					);
				}
			},
		});

		this.addCommand({
			id: "vectorize-all-notes",
			name: "Vectorize all notes",
			callback: async () => {
				try {
					await this.ensureModelInitialized();
				} catch (error) {
					console.error("Model initialization failed:", error);
					new Notice("Failed to initialize AI model. Check console.");
					return;
				}
				if (!this.isModelReady || !this.model || !this.tokenizer) {
					new Notice("Model is not ready.");
					return;
				}

				const files = this.app.vault.getMarkdownFiles();
				if (files.length === 0) {
					new Notice("No markdown files found to vectorize.");
					return;
				}

				// --- 既存の初期化＆ファイル取得 ---
				const allItems: { file: string; sentence: string }[] = [];
				for (const file of files) {
					const content = await this.app.vault.cachedRead(file);
					content
						.split(/\n+/)
						.map((s) => s.trim())
						.filter((s) => s.length > 0)
						.forEach((s) =>
							allItems.push({ file: file.path, sentence: s })
						);
				}
				new Notice(
					`Total ${allItems.length} sentences → batched vectorization`
				);
				const startAll = performance.now();

				const batchSize = 128;
				const results: { file: string; vector: number[] }[] = [];
				for (let i = 0; i < allItems.length; i += batchSize) {
					const batch = allItems
						.slice(i, i + batchSize)
						.map((x) => x.sentence);
					const vs = await this.vectorizeSentences(batch);
					vs.forEach((vec, idx) => {
						results.push({
							file: allItems[i + idx].file,
							vector: vec,
						});
					});
					console.log(
						`Processed ${i + batchSize} sentences, ${
							results.length
						} vectors generated.`
					);
				}

				const totalTime = (performance.now() - startAll) / 1000;
				new Notice(`All batched in ${totalTime.toFixed(2)}s`);

				// ------------------------------------
			},
		});
	}

	async ensureModelInitialized(): Promise<void> {
		if (this.isModelReady) {
			return Promise.resolve();
		}

		if (!this.initializationPromise) {
			console.log("Initialization not yet started. Starting now.");
			this.initializationPromise = this.initializeResources();
		} else {
			console.log(
				"Initialization already in progress. Waiting for completion."
			);
		}

		await this.initializationPromise;
	}

	async initializeResources(): Promise<void> {
		if (this.isLoading || this.isModelReady) {
			console.log(
				`Initialization skipped: isLoading=${this.isLoading}, isModelReady=${this.isModelReady}`
			);
			return;
		}

		this.isLoading = true;

		// --- window.process を削除 ---
		// @ts-ignore
		if (typeof window !== "undefined" && window.process) {
			console.log("Temporarily deleting window.process.");
			// @ts-ignore
			delete window.process;
		}
		// --------------------------

		try {
			console.log("Starting model and tokenizer initialization...");
			new Notice("Loading AI model... This may take a while.");

			// 初期化時間計測開始
			const initStartTime = performance.now();

			// --- 動的に transformers を import ---
			if (!this.transformers) {
				console.log(
					"Dynamically importing @huggingface/transformers..."
				);
				this.transformers = await import("@huggingface/transformers");
				// 必要に応じて env 設定を行う
				this.transformers.env.useBrowserCache = true;
				console.log("Transformers module loaded.");
			}
			// ------------------------------------

			// --- initializeModelAndTokenizer に import したモジュールを渡す ---
			const { model, tokenizer } = await initializeModelAndTokenizer(
				this.transformers.AutoModel,
				this.transformers.AutoTokenizer
			);
			// ---------------------------------------------------------
			this.model = model;
			this.tokenizer = tokenizer;
			this.isModelReady = true;

			// 初期化時間計測終了
			const initEndTime = performance.now();
			const initTime = (initEndTime - initStartTime) / 1000; // 秒単位に変換

			console.log(
				`AI model and tokenizer loaded successfully in ${initTime.toFixed(
					2
				)} seconds!`
			);
			new Notice(
				`AI model loaded successfully in ${initTime.toFixed(
					2
				)} seconds!`
			);
		} catch (error: any) {
			console.error("Failed to initialize model or tokenizer:", error);
			console.error("Detailed Error:", error.message, error.stack);
			this.isModelReady = false;
			this.transformers = null; // 失敗したらモジュール参照もクリア
			throw error; // エラーを再スロー
		} finally {
			this.isLoading = false;
			// --- window.process の復元は不要 (削除したままにする) ---
			console.log("Initialization process finished.");
		}
	}

	async vectorizeSentences(sentences: string[]): Promise<number[][]> {
		if (
			!this.isModelReady ||
			!this.model ||
			!this.tokenizer ||
			!this.transformers ||
			!this.transformers.Tensor
		) {
			throw new Error(
				"Model, tokenizer, or transformers module is not initialized."
			);
		}

		const VECTOR_DIMENSION = 512;

		const Tensor = this.transformers.Tensor; // Tensor クラスへの参照を取得
		// -----------------------------------------------------

		try {
			const inputs = this.tokenizer(sentences, {
				padding: true,
				truncation: true,
			});

			const outputs = await this.model!(inputs);
			let embeddingTensor: TensorType;

			// 1) sentence_embedding があればそのまま使う
			if (outputs.sentence_embedding instanceof Tensor) {
				embeddingTensor = outputs.sentence_embedding;
			}
			// 2) なければ last_hidden_state の平均プーリング
			else if (outputs.last_hidden_state instanceof Tensor) {
				const hidden = outputs.last_hidden_state;
				const mask = new Tensor(inputs.attention_mask).unsqueeze(2);
				const sum = hidden.mul(mask).sum(1);
				const denom = mask.sum(1).clamp_(1e-9, Infinity);
				embeddingTensor = sum.div(denom);
			} else {
				console.error("Model output keys:", Object.keys(outputs));
				throw new Error("埋め込みテンソルが見つかりません");
			}

			let resultVectorsNested = embeddingTensor.tolist();
			let resultVectors: number[][] = resultVectorsNested as number[][];

			if (
				resultVectors.length > 0 &&
				resultVectors[0].length > VECTOR_DIMENSION
			) {
				resultVectors = resultVectors.map((vector) =>
					vector.slice(0, VECTOR_DIMENSION)
				);
			}

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

	onunload() {
		console.log("Unloading vector plugin...");
		this.model = null;
		this.tokenizer = null;
		this.isModelReady = false;
		this.isLoading = false;
		this.initializationPromise = null;
		this.transformers = null;
	}
}

async function initializeModelAndTokenizer(
	AutoModel: AutoModelType,
	AutoTokenizer: AutoTokenizerType
): Promise<{
	model: PreTrainedModelType;
	tokenizer: PreTrainedTokenizerType;
}> {
	try {
		console.log("Starting model download/load...");
		const modelStartTime = performance.now();

		const model = await AutoModel.from_pretrained(
			"cfsdwe/static-embedding-japanese-for-js",
			{ device: "webgpu", dtype: "q8" }
		);

		const modelEndTime = performance.now();
		const modelLoadTime = (modelEndTime - modelStartTime) / 1000;
		console.log(
			`Model loaded in ${modelLoadTime.toFixed(
				2
			)} seconds. Starting tokenizer download/load...`
		);

		const tokenizerStartTime = performance.now();

		const tokenizer = await AutoTokenizer.from_pretrained(
			"cfsdwe/static-embedding-japanese-for-js",
			{}
		);

		const tokenizerEndTime = performance.now();
		const tokenizerLoadTime =
			(tokenizerEndTime - tokenizerStartTime) / 1000;
		console.log(
			`Tokenizer loaded in ${tokenizerLoadTime.toFixed(2)} seconds.`
		);

		return { model, tokenizer };
	} catch (error) {
		console.error(
			"Model/Tokenizer Initialization Error in external function:",
			error
		);
		throw error;
	}
}
