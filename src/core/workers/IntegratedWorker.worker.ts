import {
	WorkerRequest,
	WorkerResponse,
} from "../../shared/types/integrated-worker";

// @ts-ignore global self for Worker
const worker = self as DedicatedWorkerGlobalScope;

// ログメッセージをメインスレッドに送信するヘルパー関数
function postLogMessage(
	level: "info" | "warn" | "error" | "verbose",
	message: string,
	...args: any[]
) {
	postMessage({
		type: "status",
		payload: {
			level,
			message,
			args: JSON.parse(JSON.stringify(args)), // 循環参照などを避けるためにJSON化
		},
	});
}

// 初期化状態管理
let isInitialized = false;

// 初期化関数（スケルトン）
async function initialize(): Promise<boolean> {
	if (isInitialized) {
		postLogMessage("info", "IntegratedWorker is already initialized.");
		return true;
	}

	try {
		postLogMessage("info", "Initializing IntegratedWorker...");

		// TODO: ここで実際の初期化処理を行う
		// - VectorizerWorker の初期化
		// - PGliteWorker の初期化
		// - その他の必要なリソースの初期化

		// 現在はダミーとして1秒待機
		await new Promise((resolve) => setTimeout(resolve, 1000));

		isInitialized = true;
		postLogMessage("info", "IntegratedWorker initialization completed.");
		return true;
	} catch (error: any) {
		postLogMessage(
			"error",
			"IntegratedWorker initialization failed:",
			error
		);
		return false;
	}
}

// メッセージハンドラー
worker.onmessage = async (event: MessageEvent) => {
	const request = event.data as WorkerRequest;
	const { id, type, payload } = request;

	try {
		switch (type) {
			case "initialize":
				const initResult = await initialize();
				postMessage({
					id,
					type: "initialized",
					payload: initResult,
				} as WorkerResponse);
				break;

			case "vectorizeAndStore":
				if (!isInitialized) {
					throw new Error(
						"Worker not initialized. Call initialize first."
					);
				}
				// TODO: 実装
				postLogMessage(
					"info",
					"vectorizeAndStore request received (not yet implemented)"
				);
				postMessage({
					id,
					type: "vectorizeAndStoreResult",
					payload: {
						success: false,
						processedCount: 0,
						errors: ["Not yet implemented"],
					},
				} as WorkerResponse);
				break;

			case "search":
				if (!isInitialized) {
					throw new Error(
						"Worker not initialized. Call initialize first."
					);
				}
				// TODO: 実装
				postLogMessage(
					"info",
					"search request received (not yet implemented)"
				);
				postMessage({
					id,
					type: "searchResult",
					payload: {
						results: [],
					},
				} as WorkerResponse);
				break;

			case "rebuildDb":
				if (!isInitialized) {
					throw new Error(
						"Worker not initialized. Call initialize first."
					);
				}
				// TODO: 実装
				postLogMessage(
					"info",
					"rebuildDb request received (not yet implemented)"
				);
				postMessage({
					id,
					type: "rebuildDbResult",
					payload: {
						success: false,
						message: "Not yet implemented",
					},
				} as WorkerResponse);
				break;

			case "testSimilarity":
				if (!isInitialized) {
					throw new Error(
						"Worker not initialized. Call initialize first."
					);
				}
				// TODO: 実装
				postLogMessage(
					"info",
					"testSimilarity request received (not yet implemented)"
				);
				postMessage({
					id,
					type: "testSimilarityResult",
					payload: "Test not yet implemented",
				} as WorkerResponse);
				break;

			case "closeDb":
				if (!isInitialized) {
					throw new Error(
						"Worker not initialized. Call initialize first."
					);
				}
				// TODO: 実装
				postLogMessage(
					"info",
					"closeDb request received (not yet implemented)"
				);
				postMessage({
					id,
					type: "dbClosed",
					payload: true,
				} as WorkerResponse);
				break;

			default:
				postLogMessage("warn", "Unknown message type:", type);
				postMessage({
					id,
					type: "error",
					payload: `Unknown message type: ${type}`,
				} as WorkerResponse);
		}
	} catch (error: any) {
		postLogMessage("error", `Error processing message ${type}:`, error);
		postMessage({
			id,
			type: "error",
			payload: `Error processing ${type}: ${error.message}`,
		} as WorkerResponse);
	}
};
