import { LoggerService } from "../../shared/services/LoggerService";
import { IntegratedWorkerProxy } from "../workers/IntegratedWorkerProxy";

export class StorageManagementService {
	private logger: LoggerService | null;
	constructor(
		private workerProxy: IntegratedWorkerProxy,
		logger: LoggerService | null
	) {
		this.logger = logger;
	}

	public async rebuildStorage(
		onProgress?: (message: string) => void
	): Promise<void> {
		try {
			if (onProgress)
				onProgress(
					"Rebuilding storage: Initiating database rebuild..."
				);
			await this.workerProxy.rebuildDatabase();
			if (onProgress) onProgress("Storage rebuild complete.");
			this.logger?.verbose_log(
				"Storage rebuild completed by StorageManagementService."
			);
		} catch (error) {
			this.logger?.error(
				"Failed to rebuild storage in StorageManagementService:",
				error
			);
			throw error; // Propagate error to CommandHandler
		}
	}

	public async ensureIndexes(
		onProgress?: (message: string) => void
	): Promise<void> {
		try {
			if (onProgress)
				onProgress("Ensuring database indexes are up to date...");
			const result = await this.workerProxy.ensureIndexes();
			if (result.success) {
				if (onProgress)
					onProgress(
						result.message || "Indexes ensured successfully."
					);
				this.logger?.verbose_log(
					result.message ||
						"Indexes ensured successfully by StorageManagementService."
				);
			} else {
				throw new Error(result.message || "Failed to ensure indexes.");
			}
		} catch (error) {
			this.logger?.error(
				"Failed to ensure indexes in StorageManagementService:",
				error
			);
			if (onProgress)
				onProgress(
					`Index creation/check failed: ${
						error instanceof Error ? error.message : "Unknown error"
					}`
				);
			throw error;
		}
	}
}
