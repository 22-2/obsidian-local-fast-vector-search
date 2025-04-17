import { Editor, Notice, App } from "obsidian";
import { Vectorizer } from "./vectorizer";
import { splitTextToSentences } from "./utils";

export class CommandHandler {
	private app: App;
	private vectorizer: Vectorizer;

	constructor(app: App, vectorizer: Vectorizer) {
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

		try {
			new Notice(`Vectorizing ${sentences.length} sentences...`);

			const startTime = performance.now();
			const vectors = await this.vectorizer.vectorizeSentences(sentences);

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
				} vectors generated in ${processingTime.toFixed(2)} seconds.`
			);
			console.log("Generated vectors:", vectors);
		} catch (error) {
			console.error("Vectorization failed:", error);
			new Notice("Vectorization failed. Check console for details.");
		}
	}

	async vectorizeAllNotes(): Promise<{ file: string; vector: number[] }[]> {
		const files = this.app.vault.getMarkdownFiles();
		if (files.length === 0) {
			new Notice("No markdown files found to vectorize.");
			return [];
		}

		// --- 既存の初期化＆ファイル取得 ---
		const allItems: { file: string; sentence: string }[] = [];
		for (const file of files) {
			const content = await this.app.vault.cachedRead(file);
			splitTextToSentences(content).forEach((s) =>
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
			const vs = await this.vectorizer.vectorizeSentences(batch);
			vs.forEach((vec, idx) => {
				results.push({
					file: allItems[i + idx].file,
					vector: vec,
				});
			});
			console.log(
				`Processed ${Math.min(
					i + batchSize,
					allItems.length
				)} sentences, ${results.length} vectors generated.`
			);
		}

		const totalTime = (performance.now() - startAll) / 1000;
		new Notice(`All batched in ${totalTime.toFixed(2)}s`);

		return results;
	}
}
