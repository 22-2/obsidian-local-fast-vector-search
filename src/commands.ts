import { Editor, Notice, App } from "obsidian";
import type { IVectorizer } from "./vectorizers/IVectorizer";
import { splitTextToSentences } from "./utils";

export class CommandHandler {
	private app: App;
	private vectorizer: IVectorizer;

	constructor(app: App, vectorizer: IVectorizer) {
		this.app = app;
		this.vectorizer = vectorizer;
	}

	async vectorizeCurrentNote(editor: Editor): Promise<void> {
		const text = editor.getValue();
		const sentences = splitTextToSentences(text);

		if (sentences.length === 0) {
			new Notice("No text found to vectorize.");
			return;
		}

		const notice = new Notice(
			`Vectorizing ${sentences.length} sentences (using worker)...`,
			0
		); // 0で手動で消すまで表示
		try {
			const startTime = performance.now();
			// vectorizeSentences は WorkerProxyVectorizer を介して Worker に処理を依頼
			const vectors = await this.vectorizer.vectorizeSentences(sentences);
			const endTime = performance.now();
			const processingTime = (endTime - startTime) / 1000;

			notice.setMessage(
				// Noticeの内容を更新
				`Vectorization complete! ${
					vectors.length
				} vectors generated in ${processingTime.toFixed(2)} seconds.`
			);
			console.log(
				`Vectorization completed in ${processingTime.toFixed(
					2
				)} seconds.`
			);
			console.log("Generated vectors:", vectors);
			// Noticeを数秒後に消す
			setTimeout(() => notice.hide(), 5000);
		} catch (error) {
			console.error("Vectorization failed:", error);
			notice.setMessage(
				"Vectorization failed. Check console for details."
			);
			setTimeout(() => notice.hide(), 5000);
		}
	}

	async vectorizeAllNotes(): Promise<{ file: string; vector: number[] }[]> {
		const files = this.app.vault.getMarkdownFiles();
		if (files.length === 0) {
			new Notice("No markdown files found to vectorize.");
			return [];
		}

		const allItems: { file: string; sentence: string }[] = [];
		const notice = new Notice("Reading all markdown files...", 0);
		try {
			for (const file of files) {
				const content = await this.app.vault.cachedRead(file);
				splitTextToSentences(content).forEach((s) =>
					allItems.push({ file: file.path, sentence: s })
				);
			}
		} catch (error) {
			console.error("Error reading files:", error);
			notice.setMessage("Error reading files. Check console.");
			setTimeout(() => notice.hide(), 5000);
			return [];
		}

		if (allItems.length === 0) {
			notice.setMessage("No sentences found in markdown files.");
			setTimeout(() => notice.hide(), 3000);
			return [];
		}

		notice.setMessage(
			`Starting vectorization for ${allItems.length} sentences (batched, using worker)...`
		);
		const startAll = performance.now();

		const batchSize = 128; // Workerに送るバッチサイズ
		const results: { file: string; vector: number[] }[] = [];
		let processedCount = 0;

		try {
			for (let i = 0; i < allItems.length; i += batchSize) {
				const batchItems = allItems.slice(i, i + batchSize);
				const batchSentences = batchItems.map((x) => x.sentence);

				const batchStartTime = performance.now();
				// Worker にバッチ処理を依頼
				const vs = await this.vectorizer.vectorizeSentences(
					batchSentences
				);
				const batchEndTime = performance.now();
				const batchTime = (batchEndTime - batchStartTime) / 1000;

				vs.forEach((vec, idx) => {
					results.push({
						file: batchItems[idx].file,
						vector: vec,
					});
				});

				processedCount = Math.min(i + batchSize, allItems.length);
				const progressPercent = (
					(processedCount / allItems.length) *
					100
				).toFixed(1);
				const estimatedTotalTime =
					(((performance.now() - startAll) / processedCount) *
						allItems.length) /
					1000;

				console.log(
					`Batch ${i / batchSize + 1}: Processed ${processedCount}/${
						allItems.length
					} sentences (${progressPercent}%) in ${batchTime.toFixed(
						2
					)}s. Total vectors: ${
						results.length
					}. Est. total time: ${estimatedTotalTime.toFixed(1)}s`
				);
				notice.setMessage(
					`Vectorizing... ${processedCount}/${allItems.length} (${progressPercent}%)`
				);

				// メインスレッドがブロックされないように少し待機 (オプション)
				// await new Promise(resolve => setTimeout(resolve, 10));
			}

			const totalTime = (performance.now() - startAll) / 1000;
			notice.setMessage(
				`Vectorization finished! ${
					results.length
				} vectors generated in ${totalTime.toFixed(2)}s.`
			);
			console.log(`All notes vectorized in ${totalTime.toFixed(2)}s`);
			setTimeout(() => notice.hide(), 5000);

			return results;
		} catch (error) {
			console.error("Vectorization of all notes failed:", error);
			notice.setMessage(
				"Vectorization failed during batch processing. Check console."
			);
			setTimeout(() => notice.hide(), 5000);
			return results; // 途中までの結果を返すか、空配列を返すか
		}
	}
}
