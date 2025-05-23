// main.ts
import { Plugin, Notice, App } from "obsidian";
import { LoggerService } from "./shared/services/LoggerService";
import { CommandHandler } from "./commands";
import { deleteDB } from "idb";
import { DB_NAME } from "./shared/constants/appConstants";
import { TextChunker } from "./core/chunking/TextChunker";
import { NotificationService } from "./shared/services/NotificationService";
import { VectorizationService } from "./core/services/VectorizationService";
import { SearchService } from "./core/services/SearchService";
import { StorageManagementService } from "./core/services/StorageManagementService";
import { IntegratedWorkerProxy } from "./core/workers/IntegratedWorkerProxy";
import { SearchModal } from "./ui/modals/SearchModal";
import { DiscardDBModal } from "./ui/modals/DiscardDBModal";
import { DeleteResourcesModal } from "./ui/modals/DeleteResourcesModal";

import { PluginSettings, DEFAULT_SETTINGS } from "./pluginSettings";
import { VectorizerSettingTab } from "./ui/settings";

export default class MyVectorPlugin extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;
	private initializationPromise: Promise<void> | null = null;
	commandHandler: CommandHandler | null = null;

	// 新しい統合ワーカープロキシ
	proxy: IntegratedWorkerProxy | null = null;

	// Service instances
	vectorizationService: VectorizationService | null = null;
	searchService: SearchService | null = null;
	storageManagementService: StorageManagementService | null = null;
	notificationService: NotificationService | null = null;
	textChunker: TextChunker | null = null;
	logger: LoggerService | null = null; // 型を修正し、初期値をnullに設定

	async onload() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
		this.logger = new LoggerService();
		this.logger.updateSettings(this.settings);

		// 統合ワーカープロキシの初期化
		this.proxy = new IntegratedWorkerProxy(this.logger);

		this.addSettingTab(new VectorizerSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(async () => {
			if (this.logger)
				this.logger.verbose_log(
					"Obsidian layout ready. Triggering background initialization."
				);
			this.initializationPromise = this.initializeResources().catch(
				(error) => {
					console.error(
						"Background resource initialization failed:",
						error
					);
					new Notice(
						"Failed to initialize resources. Check console."
					);
				}
			);
		});

		this.addCommand({
			id: "vectorize-all-notes",
			name: "Vectorize all notes (Worker & Save)",
			callback: async () => {
				try {
					await this.ensureResourcesInitialized();
				} catch (error) {
					console.error(
						"Resource initialization check failed:",
						error
					);
					new Notice("Resources are not ready. Check console.");
					return;
				}
				if (!this.commandHandler) {
					new Notice("Command handler not ready.");
					return;
				}
				await this.commandHandler.vectorizeAllNotes();
			},
		});

		this.addCommand({
			id: "search-similar-notes",
			name: "Search similar notes",
			callback: async () => {
				try {
					await this.ensureResourcesInitialized();
				} catch (error) {
					console.error(
						"Resource initialization check failed for search:",
						error
					);
					new Notice(
						"Resources are not ready for search. Check console."
					);
					return;
				}
				if (!this.commandHandler) {
					new Notice(
						"Command handler not ready for search. Please try reloading the plugin."
					);
					return;
				}

				if (!this.notificationService) {
					new Notice("Notification service not ready.");
					return;
				}
				new SearchModal(
					this.app,
					this.commandHandler,
					this.notificationService
				).open();
			},
		});

		this.addCommand({
			id: "rebuild-all-indexes",
			name: "Rebuild all indexes (Clear and re-vectorize all notes)",
			callback: async () => {
				try {
					await this.ensureResourcesInitialized();
				} catch (error) {
					console.error(
						"Resource initialization check failed for rebuild:",
						error
					);
					new Notice(
						"Resources are not ready for rebuild. Check console."
					);
					return;
				}
				if (!this.commandHandler) {
					new Notice(
						"Command handler not ready for rebuild. Please try reloading the plugin."
					);
					return;
				}

				await this.commandHandler.rebuildAllIndexes();
			},
		});

		this.addCommand({
			id: "test-vectorization",
			name: "Test vectorization (Worker)",
			callback: async () => {
				try {
					await this.ensureResourcesInitialized();
				} catch (error) {
					console.error(
						"Resource initialization check failed for test:",
						error
					);
					new Notice(
						"Resources are not ready for test. Check console."
					);
					return;
				}
				if (!this.proxy) {
					new Notice("IntegratedWorkerProxy not ready for test.");
					return;
				}
				const testResult = await this.proxy.testSimilarity();
				new Notice(testResult, 5000);
			},
		});

		this.addCommand({
			id: "discard-db",
			name: "Discard database",
			callback: async () => {
				new DiscardDBModal(this.app, async () => {
					await this.clearResources(true);
					new Notice("Database discarded.");
				}).open();
			},
		});

		this.addCommand({
			id: "delete-resources",
			name: "Delete all resources (model cache, DB, etc.)",
			callback: async () => {
				new DeleteResourcesModal(this.app, async () => {
					await this.clearResources(false);
					new Notice("All resources deleted.");
				}).open();
			},
		});
	}

	async ensureResourcesInitialized(): Promise<void> {
		if (
			this.vectorizationService &&
			this.searchService &&
			this.storageManagementService &&
			this.commandHandler &&
			this.proxy
		) {
			return;
		}

		if (!this.initializationPromise) {
			if (this.logger)
				this.logger.verbose_log(
					"Initialization not started, starting now."
				);
			this.initializationPromise = this.initializeResources();
		}

		if (this.logger)
			this.logger.verbose_log(
				"Waiting for resource initialization to complete..."
			);
		await this.initializationPromise;
		if (
			!this.vectorizationService ||
			!this.searchService ||
			!this.storageManagementService ||
			!this.commandHandler ||
			!this.proxy
		) {
			throw new Error("Resources failed to initialize.");
		}
		if (this.logger)
			this.logger.verbose_log("Resource initialization confirmed.");
	}
	async initializeResources(): Promise<void> {
		if (
			this.vectorizationService &&
			this.searchService &&
			this.storageManagementService &&
			this.commandHandler &&
			this.proxy
		) {
			if (this.logger)
				this.logger.verbose_log("Resources already initialized.");
			return;
		}

		if (this.logger)
			this.logger.verbose_log(
				"Initializing resources (Integrated Worker, Services, Command Handler)..."
			);
		const initNotice = new Notice("Initializing resources...", 0);

		try {
			// 0. 統合ワーカープロキシの初期化を最初に実行
			// proxyがnullの場合のみ新規作成
			if (!this.proxy) {
				this.proxy = new IntegratedWorkerProxy(this.logger);
			}
			initNotice.setMessage("Initializing integrated worker...");
			await this.proxy.ensureInitialized();
			if (this.logger)
				this.logger.verbose_log("IntegratedWorkerProxy initialized.");

			// 1. Initialize TextChunker
			if (!this.textChunker) {
				this.textChunker = new TextChunker({}); // Use default options or load from settings
				if (this.logger)
					this.logger.verbose_log("TextChunker initialized.");
			}

			// 2. Initialize Services (after workerProxy, textChunker are ready)
			if (!this.vectorizationService) {
				this.vectorizationService = new VectorizationService(
					this.app,
					this.proxy, // IntegratedWorkerProxy を渡す
					this.textChunker,
					this.logger
				);
				if (this.logger)
					this.logger.verbose_log(
						"VectorizationService initialized."
					);
			}
			if (!this.searchService) {
				this.searchService = new SearchService(
					this.proxy // IntegratedWorkerProxy を渡す
				);
				if (this.logger)
					this.logger.verbose_log("SearchService initialized.");
			}
			if (!this.storageManagementService) {
				this.storageManagementService = new StorageManagementService(
					this.proxy, // IntegratedWorkerProxy を渡す
					this.logger
				);
				if (this.logger)
					this.logger.verbose_log(
						"StorageManagementService initialized."
					);
			}
			if (!this.notificationService) {
				this.notificationService = new NotificationService();
				if (this.logger)
					this.logger.verbose_log("NotificationService initialized.");
			}

			// 3. CommandHandler の初期化 (after services are ready)
			if (
				this.vectorizationService &&
				this.searchService &&
				this.storageManagementService &&
				!this.commandHandler
			) {
				this.commandHandler = new CommandHandler(
					this.app,
					this.vectorizationService,
					this.searchService,
					this.storageManagementService
				);
				if (this.logger)
					this.logger.verbose_log(
						"CommandHandler initialized with new services."
					);
			}

			if (
				!this.textChunker ||
				!this.vectorizationService ||
				!this.searchService ||
				!this.storageManagementService ||
				!this.commandHandler ||
				!this.proxy
			) {
				throw new Error(
					"Not all resources were ready after initialization attempt."
				);
			}
			initNotice.setMessage("Resources initialized successfully!");
			setTimeout(() => initNotice.hide(), 2000);
		} catch (error: any) {
			if (this.logger)
				this.logger.error("Failed to initialize resources:", error);
			initNotice.setMessage(
				`Resource initialization failed: ${error.message}`
			);
			setTimeout(() => initNotice.hide(), 5000);
			// 失敗時は全てをnullに戻し、再試行可能にする
			this.commandHandler = null;
			this.textChunker = null;
			this.vectorizationService = null;
			this.searchService = null;
			this.storageManagementService = null;
			this.initializationPromise = null;
			// プロキシもエラーの原因になりうるので、一旦終了してnullにする
			if (this.proxy) {
				this.proxy.terminate();
				this.proxy = null;
			}
			throw error;
		} finally {
			if (this.logger)
				this.logger.verbose_log(
					"Resource initialization attempt finished."
				);
		}
	}
	async onunload() {
		if (this.logger) this.logger.verbose_log("Unloading vector plugin...");

		// 統合ワーカープロキシの終了
		if (this.proxy) {
			if (this.logger)
				this.logger.verbose_log("Terminating integrated worker...");
			this.proxy.terminate();
		}

		this.commandHandler = null;
		this.notificationService = null;
		this.textChunker = null;
		this.vectorizationService = null;
		this.searchService = null;
		this.storageManagementService = null;
		this.initializationPromise = null;
		this.proxy = null;
		this.logger = null;
	}

	async saveSettings() {
		await this.saveData(this.settings);
		if (this.logger) {
			// nullチェックを追加
			this.logger.updateSettings(this.settings);
		}
	}
	async clearResources(discardDbOnly: boolean): Promise<void> {
		if (this.logger)
			this.logger.log(
				`Attempting to delete resources (discardDbOnly: ${discardDbOnly})...`
			);

		if (this.proxy) {
			try {
				await this.proxy.closeDatabase();
				this.logger?.verbose_log("PGlite database closed via worker.");
			} catch (e) {
				this.logger?.warn(
					"Failed to gracefully close DB via worker, proceeding with termination.",
					e
				);
			}
			this.proxy.terminate();
			this.proxy = null;
			this.initializationPromise = null;

			this.vectorizationService = null;
			this.searchService = null;
			this.storageManagementService = null;
			this.commandHandler = null;
			this.logger?.verbose_log(
				"IntegratedWorkerProxy terminated and plugin services reset."
			);
		}

		await deleteDB("pglite/" + DB_NAME);
		this.logger?.verbose_log(
			"PGlite database files deleted from IndexedDB."
		);

		if (!discardDbOnly) {
			// Transformers.js モデルキャッシュの削除
			const cacheNamePatterns = [
				/^transformers-cache$/i,
				/^huggingface-hub$/i,
			];
			let clearedSomething = false;

			const cacheKeys = await caches.keys();
			for (const key of cacheKeys) {
				if (cacheNamePatterns.some((pattern) => pattern.test(key))) {
					await caches.delete(key);
					this.logger?.verbose_log(`Cache '${key}' deleted.`);
					clearedSomething = true;
				}
			}

			// PGlite リソースキャッシュの削除 (postgres.data, postgres.wasm, vector.tar.gz)
			await deleteDB("pglite-resources-cache");
			this.logger?.verbose_log(
				"PGlite resource cache deleted from IndexedDB."
			);

			if (!clearedSomething) {
				this.logger?.verbose_log("No matching caches found to clear.");
			}
		}
		new Notice(
			"Resources cleanup complete. Plugin will re-initialize on next action."
		);
	}
}
