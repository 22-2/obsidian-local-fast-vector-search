import { ItemView, WorkspaceLeaf, MarkdownView, TFile } from "obsidian";
import { mount, unmount } from "svelte";
import RelatedChunksComponent from "./RelatedChunksComponent.svelte";
import LocalFastVectorizePlugin from "../../main";
import type { SimilarityResultItem } from "../../core/storage/types";
import {
	offsetToPosition,
	extractChunkPreview,
} from "../../shared/utils/textUtils";

export const VIEW_TYPE_RELATED_CHUNKS = "related-chunks-sidebar";

export class RelatedChunksView extends ItemView {
	plugin: LocalFastVectorizePlugin;
	component?: RelatedChunksComponent;
	currentNoteName: string | null = null;
	currentResults: SimilarityResultItem[] = [];
	target: HTMLElement | null = null;
	isSearchResultsMode = false;
	searchQuery: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: LocalFastVectorizePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_RELATED_CHUNKS;
	}

	getDisplayText(): string {
		return "Related Chunks";
	}
	getIcon(): string {
		return "waypoints";
	}
	async onOpen() {
		this.contentEl.empty();
		this.target = document.createElement("div");
		this.contentEl.appendChild(this.target);

		this.renderComponent();
	}
	private renderComponent() {
		if (this.component) {
			const oldComponent = this.component;
			this.component = undefined; // 先にundefinedにして再帰呼び出しを防ぐ
			try {
				unmount(oldComponent);
			} catch (e) {
				this.plugin.logger?.warn(
					"Error unmounting Svelte component:",
					e
				);
			}
		}

		if (!this.target) return;

		this.component = mount(RelatedChunksComponent, {
			target: this.target,
			props: {
				plugin: this.plugin,
				activeNoteName: this.currentNoteName,
				relatedChunks: this.currentResults,
				onChunkClick: this.handleChunkClick.bind(this),
				getChunkPreview: this.getChunkPreview.bind(this),
				isSearchResultsMode: this.isSearchResultsMode,
				searchQuery: this.searchQuery,
				onBackClick: this.handleBackClick.bind(this),
			},
		}) as RelatedChunksComponent;
	}
	async onClose() {
		if (this.component) {
			const oldComponent = this.component;
			this.component = undefined;
			try {
				unmount(oldComponent);
			} catch (e) {
				this.plugin.logger?.warn(
					"Error unmounting Svelte component on close:",
					e
				);
			}
		}

		if (this.target) {
			this.target.remove();
			this.target = null;
		}
	}
	async updateView(noteName: string | null, results: SimilarityResultItem[]) {
		if (this.isSearchResultsMode) {
			return;
		}
		this.currentNoteName = noteName;
		this.currentResults = results;
		this.renderComponent();
	}

	private async getChunkPreview(item: SimilarityResultItem): Promise<string> {
		try {
			const file = this.plugin.app.vault.getAbstractFileByPath(
				item.file_path
			);

			if (!(file instanceof TFile)) {
				return "File not found for preview.";
			}

			const content = await this.plugin.app.vault.cachedRead(file);
			return extractChunkPreview(
				content,
				item.chunk_offset_start ?? -1,
				item.chunk_offset_end ?? -1
			);
		} catch (e) {
			console.error("Error extracting text for preview:", e);
			this.plugin.logger?.error("Error extracting text for preview:", e);
			return "Error loading preview.";
		}
	}

	clearView() {
		this.updateView(null, []);
	}

	displaySearchResults(query: string, results: SimilarityResultItem[]) {
		this.isSearchResultsMode = true;
		this.searchQuery = query;
		this.currentNoteName = null;
		this.currentResults = results;
		this.renderComponent();
	}

	setLoadingState(query: string) {
		this.isSearchResultsMode = true;
		this.searchQuery = query;
		this.currentNoteName = null;
		this.currentResults = [];
		this.renderComponent();
	}

	async handleBackClick() {
		this.isSearchResultsMode = false;
		this.searchQuery = null;

		const activeFile = this.app.workspace.getActiveFile();
		this.updateView(activeFile?.basename || null, []);

		if (this.plugin.viewManager) {
			this.plugin.viewManager.resetLastProcessedFile();
			await this.plugin.viewManager.handleActiveLeafChange();
		}
	}
	private async handleChunkClick(item: SimilarityResultItem) {
		const file = this.app.vault.getAbstractFileByPath(item.file_path);
		if (!(file instanceof TFile)) {
			return;
		}

		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);

		if (!(leaf.view instanceof MarkdownView)) {
			return;
		}

		let position = { line: 0, ch: 0 };

		if (item.chunk_offset_start != null && item.chunk_offset_start !== -1) {
			const content = await this.app.vault.cachedRead(file);
			position = offsetToPosition(content, item.chunk_offset_start);
		}

		leaf.view.editor.setCursor(position);
		leaf.view.editor.scrollIntoView({ from: position, to: position }, true);
	}
}
