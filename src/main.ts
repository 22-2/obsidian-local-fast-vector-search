import { Plugin, Notice, App, PluginSettingTab, Setting } from "obsidian";
import type {
	PreTrainedModelType,
	PreTrainedTokenizerType,
	TensorType,
	AutoModelType,
	AutoTokenizerType,
} from "./types";
import { initializeTransformers } from "./transformersModel";
import { IVectorizer } from "./vectorizers/IVectorizer";
import { createVectorizer } from "./vectorizers/VectorizerFactory";
import { CommandHandler } from "./commands";

// ---------------------------------

interface PluginSettings {
	provider: string;
	ollamaEndpoint: string;
	ollamaApiKey: string;
}

const DEFAULT_SETTINGS: PluginSettings = {
	provider: "transformer",
	ollamaEndpoint: "https://api.ollama.com/embed",
	ollamaApiKey: "",
};

export default class MyVectorPlugin extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;
	model: PreTrainedModelType | null = null;
	tokenizer: PreTrainedTokenizerType | null = null;
	isModelReady: boolean = false;
	isLoading: boolean = false;
	private initializationPromise: Promise<void> | null = null;
	vectorizer: IVectorizer | null = null;
	commandHandler: CommandHandler | null = null;

	// --- transformers のモジュールを保持する変数 ---
	private transformers: {
		AutoModel: AutoModelType;
		AutoTokenizer: AutoTokenizerType;
		Tensor: typeof import("@huggingface/transformers").Tensor;
		env: typeof import("@huggingface/transformers").env;
	} | null = null;
	// -----------------------------------------

	async onload() {
		// load settings
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);

		// add settings tab
		this.addSettingTab(
			new (class extends PluginSettingTab {
				plugin: MyVectorPlugin;
				constructor(app: App, plugin: MyVectorPlugin) {
					super(app, plugin);
					this.plugin = plugin;
				}
				display(): void {
					const { containerEl } = this;
					containerEl.empty();
					containerEl.createEl("h2", { text: "Vectorizer Settings" });

					new Setting(containerEl)
						.setName("Provider")
						.setDesc("Select the vectorizer provider")
						.addDropdown((dropdown) =>
							dropdown
								.addOption("transformer", "Transformer.js")
								.addOption("ollama", "Ollama API")
								.setValue(this.plugin.settings.provider)
								.onChange(async (value) => {
									this.plugin.settings.provider = value;
									await this.plugin.saveData(
										this.plugin.settings
									);
								})
						);

					new Setting(containerEl)
						.setName("Ollama Endpoint")
						.setDesc("Endpoint URL for Ollama embedding service")
						.addText((text) =>
							text
								.setPlaceholder("https://api.ollama.com/embed")
								.setValue(this.plugin.settings.ollamaEndpoint)
								.onChange(async (value) => {
									this.plugin.settings.ollamaEndpoint = value;
									await this.plugin.saveData(
										this.plugin.settings
									);
								})
						);

					new Setting(containerEl)
						.setName("Ollama API Key")
						.setDesc("API key for Ollama service (if required)")
						.addText((text) =>
							text
								.setPlaceholder("")
								.setValue(this.plugin.settings.ollamaApiKey)
								.onChange(async (value) => {
									this.plugin.settings.ollamaApiKey = value;
									await this.plugin.saveData(
										this.plugin.settings
									);
								})
						);
				}
			})(this.app, this)
		);

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
			editorCallback: async (editor) => {
				// view is unused
				try {
					await this.ensureModelInitialized();
				} catch (error) {
					console.error("Model initialization failed:", error);
					new Notice(
						"Failed to initialize AI model. Check console for details."
					);
					return;
				}

				if (!this.isModelReady || !this.commandHandler) {
					new Notice(
						"Model or command handler is not ready. Please wait or check console."
					);
					return;
				}

				// Delegate to CommandHandler
				await this.commandHandler.vectorizeCurrentNote(editor);
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

				if (!this.isModelReady || !this.commandHandler) {
					new Notice(
						"Model or command handler is not ready. Please wait or check console."
					);
					return;
				}

				// Delegate to CommandHandler
				try {
					const results =
						await this.commandHandler.vectorizeAllNotes();
					// Optional: Handle results if needed, e.g., display summary
					if (results && results.length > 0) {
						// Check if results is not undefined
						console.log(
							`Vectorized ${results.length} items across all notes.`
						);
					}
				} catch (error) {
					// Error handling is likely within vectorizeAllNotes, but catch here too
					console.error("Failed to vectorize all notes:", error);
					new Notice("Failed to vectorize all notes. Check console.");
				}
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
			const { model, tokenizer } = await initializeTransformers(
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
			// --- Instantiate Vectorizer and CommandHandler ---
			if (this.model && this.tokenizer && this.transformers?.Tensor) {
				// Create vectorizer based on settings
				const provider = this.settings.provider;
				let options: any = {};
				if (provider === "transformer") {
					options = {
						model: this.model,
						tokenizer: this.tokenizer,
						Tensor: this.transformers.Tensor,
					};
				} else if (provider === "ollama") {
					options = {
						endpoint: this.settings.ollamaEndpoint,
						apiKey: this.settings.ollamaApiKey,
					};
				}
				this.vectorizer = createVectorizer(provider, options);
				this.commandHandler = new CommandHandler(
					this.app,
					this.vectorizer
				);
				console.log("Vectorizer and CommandHandler initialized.");
			} else {
				// This case should ideally not happen if isModelReady is true
				console.error(
					"Failed to initialize handlers: Model, tokenizer, or Tensor missing after load."
				);
				this.isModelReady = false; // Ensure state reflects reality
				throw new Error(
					"Model/Tokenizer/Tensor missing after successful load indication."
				);
			}
			// -------------------------------------------------
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

	onunload() {
		console.log("Unloading vector plugin...");
		this.model = null;
		this.tokenizer = null;
		this.isModelReady = false;
		this.isLoading = false;
		this.initializationPromise = null;
		this.transformers = null;
		this.vectorizer = null;
		this.commandHandler = null;
	}
}
