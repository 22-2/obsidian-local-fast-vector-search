import { Plugin } from "obsidian";
import { PGlite } from "@electric-sql/pglite";
import { IdbFs } from "@electric-sql/pglite";
import { deleteDB, openDB, IDBPDatabase } from "idb";
const PGLITE_VERSION = "0.2.14";
const IDB_NAME = "pglite-resources-cache";
const IDB_STORE_NAME = "resources";

import { LoggerService } from "../../../shared/services/LoggerService";

export class PGliteProvider {
	private plugin: Plugin;
	private dbName: string;
	private pgClient: PGlite | null = null;
	private isInitialized: boolean = false;
	private relaxedDurability: boolean;
	private logger: LoggerService | null;

	private resourceCacheKeys: {
		fsBundle: string;
		wasmModule: string;
		vectorExtensionBundle: string;
	};

	constructor(
		plugin: Plugin,
		dbName: string,
		relaxedDurability: boolean = true,
		logger: LoggerService | null
	) {
		this.plugin = plugin;
		this.logger = logger;
		this.dbName = dbName;
		this.relaxedDurability = relaxedDurability;

		// Keys for IndexedDB store
		this.resourceCacheKeys = {
			fsBundle: `pglite-${PGLITE_VERSION}-postgres.data`,
			wasmModule: `pglite-${PGLITE_VERSION}-postgres.wasm`,
			vectorExtensionBundle: `pglite-${PGLITE_VERSION}-vector.tar.gz`,
		};
		this.logger?.verbose_log("PGlite resource IndexedDB keys initialized.");
	}

	async initialize(): Promise<void> {
		if (this.isInitialized && this.pgClient) {
			this.logger?.verbose_log("PGliteProvider already initialized.");
			return;
		}

		try {
			const { fsBundle, wasmModule, vectorExtensionBundlePath } =
				await this.loadPGliteResources();

			this.logger?.verbose_log(
				`Creating/Opening database: ${this.dbName}`
			);
			this.pgClient = await this.createPGliteInstance({
				fsBundle,
				wasmModule,
				vectorExtensionBundlePath,
			});

			// インスタンス化が完了したらBlob URLを解放
			URL.revokeObjectURL(vectorExtensionBundlePath.href);

			this.isInitialized = true;
			this.logger?.verbose_log("PGlite initialized successfully");
		} catch (error) {
			this.logger?.error("Error initializing PGlite:", error);
			// 初期化失敗時は状態をリセット
			this.pgClient = null;
			this.isInitialized = false;
			throw new Error(`Failed to initialize PGlite: ${error}`);
		}
	}

	getClient(): PGlite {
		if (!this.pgClient) {
			const error = new Error("PGlite client is not initialized");
			this.logger?.error("PGlite client error:", error);
			throw error;
		}
		return this.pgClient;
	}

	isReady(): boolean {
		return this.isInitialized && this.pgClient !== null;
	}

	async close(): Promise<void> {
		if (this.pgClient) {
			try {
				await this.pgClient.close();
				this.pgClient = null;
				this.isInitialized = false;
				this.logger?.verbose_log("PGlite connection closed");
			} catch (error) {
				this.logger?.error("Error closing PGlite connection:", error);
			}
		}
	}

	async discardDB(): Promise<void> {
		this.logger?.verbose_log(
			`Discarding PGlite database: ${this.dbName} using idb.`
		);
		try {
			if (this.pgClient) {
				await this.close();
				this.logger?.verbose_log(
					"Closed existing PGlite client before discarding."
				);
			}

			await deleteDB("/pglite/" + this.dbName); // Use imported deleteIdb
			this.logger?.verbose_log(
				`Successfully discarded database: ${this.dbName}`
			);

			this.pgClient = null;
			this.isInitialized = false;
		} catch (error: any) {
			this.logger?.error(
				`Error discarding PGlite database ${this.dbName}:`,
				error
			);
			this.pgClient = null;
			this.isInitialized = false;
			const errorMessage = error?.message || "Unknown error";
			const errorDetails = error?.name ? `(${error.name})` : "";
			throw new Error(
				`Failed to discard PGlite database ${this.dbName}: ${errorMessage} ${errorDetails}`
			);
		}
	}

	private async createPGliteInstance(options: {
		loadDataDir?: Blob;
		fsBundle: Blob;
		wasmModule: WebAssembly.Module;
		vectorExtensionBundlePath: URL;
	}): Promise<PGlite> {
		// Create PGlite instance with options

		return await PGlite.create({
			...options,
			relaxedDurability: this.relaxedDurability,
			fs: new IdbFs(this.dbName),
			fsBundle: options.fsBundle,
			wasmModule: options.wasmModule,
			extensions: {
				vector: options.vectorExtensionBundlePath,
			},
		});
	}

	private async openIndexedDB(): Promise<IDBPDatabase> {
		return openDB(IDB_NAME, 1, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
					db.createObjectStore(IDB_STORE_NAME);
				}
			},
		});
	}

	private async loadPGliteResources(): Promise<{
		fsBundle: Blob;
		wasmModule: WebAssembly.Module;
		vectorExtensionBundlePath: URL;
	}> {
		const resources = {
			fsBundle: {
				url: `https://unpkg.com/@electric-sql/pglite@${PGLITE_VERSION}/dist/postgres.data`,
				key: this.resourceCacheKeys.fsBundle,
				type: "application/octet-stream",
				process: async (buffer: ArrayBuffer) =>
					new Blob([buffer], { type: "application/octet-stream" }),
			},
			wasmModule: {
				url: `https://unpkg.com/@electric-sql/pglite@${PGLITE_VERSION}/dist/postgres.wasm`,
				key: this.resourceCacheKeys.wasmModule,
				type: "application/wasm",
				process: async (buffer: ArrayBuffer) => {
					const wasmBytes = new Uint8Array(buffer);

					if (!WebAssembly.validate(wasmBytes)) {
						this.logger?.error(
							"Invalid WebAssembly module data (validated as Uint8Array)."
						);
						this.logger?.error(
							`Buffer length: ${buffer.byteLength}, Uint8Array length: ${wasmBytes.length}`
						);
						throw new Error("Invalid WebAssembly module data.");
					}
					try {
						this.logger?.verbose_log(
							`Compiling WASM module from ${wasmBytes.length} bytes...`
						);
						const module = await WebAssembly.compile(wasmBytes);
						this.logger?.verbose_log(
							"WASM module compiled successfully."
						);
						return module;
					} catch (compileError) {
						this.logger?.error(
							"WebAssembly.compile failed:",
							compileError
						);
						this.logger?.error(
							`Buffer length: ${buffer.byteLength}, Uint8Array length: ${wasmBytes.length}`
						);
						if (compileError instanceof Error) {
							this.logger?.error(
								"Compile Error name:",
								compileError.name
							);
							this.logger?.error(
								"Compile Error message:",
								compileError.message
							);
							this.logger?.error(
								"Compile Error stack:",
								compileError.stack
							);
						}
						throw compileError;
					}
				},
			},
			vectorExtensionBundle: {
				url: `https://unpkg.com/@electric-sql/pglite@${PGLITE_VERSION}/dist/vector.tar.gz`,
				key: this.resourceCacheKeys.vectorExtensionBundle,
				type: "application/gzip",
				process: async (buffer: ArrayBuffer) => {
					const blob = new Blob([buffer], {
						type: "application/gzip",
					});
					const blobUrl = URL.createObjectURL(blob);
					this.logger?.verbose_log(
						"Created Blob URL for vector extension bundle:",
						blobUrl
					);
					return new URL(blobUrl);
				},
			},
		};

		const loadedResources: any = {};
		let db: IDBPDatabase | undefined;

		try {
			db = await this.openIndexedDB();

			for (const [resourceName, resourceInfo] of Object.entries(
				resources
			)) {
				this.logger?.verbose_log(
					`Attempting to load ${resourceName} from IndexedDB cache: ${resourceInfo.key}`
				);

				let cachedData: ArrayBuffer | undefined = await db.get(
					IDB_STORE_NAME,
					resourceInfo.key
				);

				if (cachedData) {
					this.logger?.verbose_log(
						`${resourceName} found in IndexedDB cache. Processing...`
					);
				} else {
					this.logger?.verbose_log(
						`${resourceName} not found in IndexedDB cache. Downloading from ${resourceInfo.url}...`
					);
					const response = await fetch(resourceInfo.url);

					if (!response.ok) {
						throw new Error(
							`Failed to download ${resourceName}: Status ${response.status}`
						);
					}

					cachedData = await response.arrayBuffer();
					this.logger?.verbose_log(
						`${resourceName} downloaded (${cachedData.byteLength} bytes).`
					);

					this.logger?.verbose_log(
						`Saving ${resourceName} to IndexedDB cache: ${resourceInfo.key}`
					);

					await db.put(IDB_STORE_NAME, cachedData, resourceInfo.key);
					this.logger?.verbose_log(
						`${resourceName} saved to IndexedDB cache.`
					);
				}
				if (resourceName === "fsBundle") {
					loadedResources[resourceName] = new Blob([cachedData], {
						type: resourceInfo.type,
					});
				} else if (resourceName === "vectorExtensionBundle") {
					loadedResources[resourceName] = await resourceInfo.process(
						cachedData
					);
				} else {
					loadedResources[resourceName] = await resourceInfo.process(
						cachedData
					);
				}
				this.logger?.verbose_log(
					`${resourceName} processed successfully.`
				);
			}
		} catch (error) {
			this.logger?.error(
				`Error loading or caching PGlite resource:`,
				error
			);
			if (error instanceof Error) {
				this.logger?.error(
					`Error details: Name: ${error.name}, Message: ${error.message}`
				);
			}
			throw new Error(
				`Failed to load or cache PGlite resource: ${error}`
			);
		} finally {
		}

		return {
			fsBundle: loadedResources.fsBundle,
			wasmModule: loadedResources.wasmModule,
			vectorExtensionBundlePath: loadedResources.vectorExtensionBundle,
		};
	}
}
