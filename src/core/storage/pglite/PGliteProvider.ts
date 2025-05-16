import { PGlite } from "@electric-sql/pglite";
import { deleteDB } from "idb";
import { LoggerService } from "../../../shared/services/LoggerService";
import { createAndInitDb, CreateDbOptions, WorkerMessage } from "./pgworker";

export class PGliteProvider {
	private dbName: string;
	private pgClient: PGlite | null = null;
	private isInitialized: boolean = false;
	private relaxedDurability: boolean;
	private logger: LoggerService | null;

	private tableName: string;
	private dimensions: number;
	private onWorkerMessageCallback?: (message: WorkerMessage) => void;

	constructor(
		dbName: string,
		relaxedDurability: boolean = true,
		logger: LoggerService | null,
		tableName: string,
		dimensions: number,
		onWorkerMessageCallback?: (message: WorkerMessage) => void
	) {
		this.logger = logger;
		this.dbName = dbName;
		this.relaxedDurability = relaxedDurability;
		this.tableName = tableName;
		this.dimensions = dimensions;
		this.onWorkerMessageCallback = onWorkerMessageCallback;
		this.logger?.verbose_log(
			"PGliteProvider (Worker mode via pgworker) initialized."
		);
	}

	async initialize(): Promise<void> {
		if (this.isInitialized && this.pgClient) {
			this.logger?.verbose_log(
				"PGliteProvider (Worker) already initialized."
			);
			return;
		}

		try {
			this.logger?.verbose_log(
				`Initializing PGlite via pgworker for database: ${this.dbName}`
			);

			const dbOptions: CreateDbOptions = {
				dbName: this.dbName,
				tableName: this.tableName,
				dimensions: this.dimensions,
				relaxedDurability: this.relaxedDurability,
				onWorkerMessage: (message: WorkerMessage) => {
					if (message.type === "status") {
						this.logger?.verbose_log(
							`PGlite Worker Status: ${message.payload}`
						);
					} else if (message.type === "error") {
						this.logger?.error(
							`PGlite Worker Error: ${message.payload}`
						);
					} else if (message.type === "progress") {
						this.logger?.verbose_log(
							`PGlite Worker Progress: ${JSON.stringify(
								message.payload
							)}`
						);
					}

					// Forward the message to the main plugin's callback if it exists
					if (this.onWorkerMessageCallback) {
						this.onWorkerMessageCallback(message);
					}
				},
			};

			this.pgClient = await createAndInitDb(dbOptions);

			this.isInitialized = true;
			this.logger?.verbose_log(
				"PGlite (via Worker) initialized successfully"
			);
		} catch (error) {
			this.logger?.error(
				"Error initializing PGlite (via Worker):",
				error
			);

			this.pgClient = null;
			this.isInitialized = false;

			const originalError =
				error instanceof Error ? error : new Error(String(error));
			throw new Error(
				`Failed to initialize PGlite (via Worker): ${originalError.message}`
			);
		}
	}

	getClient(): PGlite {
		if (!this.pgClient) {
			const error = new Error(
				"PGlite client (Worker proxy) is not initialized"
			);
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
				this.logger?.verbose_log(
					"PGlite connection (in worker) closed via proxy"
				);
			} catch (error) {
				this.logger?.error(
					"Error closing PGlite connection (via proxy):",
					error
				);
			}
		}
	}

	async discardDB(): Promise<void> {
		this.logger?.verbose_log(`Discarding PGlite database: ${this.dbName}.`);
		try {
			if (this.pgClient && this.isInitialized) {
				await this.close();
				this.logger?.verbose_log(
					"Closed PGlite connection in worker before discarding DB."
				);
			}

			await deleteDB("/pglite/" + this.dbName, {
				blocked: () => {
					this.logger?.warn(
						`IDB Deletion of /pglite/${this.dbName} was blocked. Ensure all connections are closed.`
					);
				},
			});
			this.logger?.verbose_log(
				`Successfully requested discard of database from IndexedDB: ${this.dbName}`
			);
		} catch (error: any) {
			this.logger?.error(
				`Error discarding PGlite database ${this.dbName}:`,
				error
			);
			const errorMessage = error?.message || "Unknown error";
			const errorDetails = error?.name ? `(${error.name})` : "";
			throw new Error(
				`Failed to discard PGlite database ${this.dbName}: ${errorMessage} ${errorDetails}`
			);
		} finally {
			this.pgClient = null;
			this.isInitialized = false;
		}
	}
}
