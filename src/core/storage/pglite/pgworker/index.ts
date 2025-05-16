import { PGlite } from "@electric-sql/pglite";
//@ts-ignore
import { PGliteWorker, PGliteWorkerOptions } from "@electric-sql/pglite/worker";
import PGWorkerInstance from "./pglite.worker?worker";

export interface WorkerMessage {
	type: "status" | "error" | "progress";
	payload: any;
}

export interface CreateDbOptions {
	dbName: string;
	tableName: string;
	dimensions: number;
	relaxedDurability?: boolean;
	onWorkerMessage?: (message: WorkerMessage) => void;
}

export const createAndInitDb = async (
	options: CreateDbOptions
): Promise<PGlite> => {
	const pgWorker = new PGWorkerInstance();

	if (options.onWorkerMessage) {
		const messageHandler = (event: MessageEvent) => {
			const data = event.data as WorkerMessage;
			if (
				data &&
				(data.type === "status" ||
					data.type === "error" ||
					data.type === "progress")
			) {
				options.onWorkerMessage!(data);
			}
		};
		pgWorker.addEventListener("message", messageHandler);
	}

	const workerInitOptions: PGliteWorkerOptions & {
		dbName: string;
		tableName: string;
		dimensions: number;
	} = {
		dbName: options.dbName,
		tableName: options.tableName,
		dimensions: options.dimensions,
		relaxedDurability: options.relaxedDurability,
	};

	const pg = await PGliteWorker.create(pgWorker, workerInitOptions);

	console.log(`PGlite DB proxy created for worker: ${options.dbName}`);
	return pg;
};
