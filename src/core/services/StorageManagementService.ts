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
}
