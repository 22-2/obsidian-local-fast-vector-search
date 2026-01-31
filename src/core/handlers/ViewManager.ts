import { App, MarkdownView, TFile, WorkspaceLeaf, debounce } from "obsidian";
import type { PluginSettings } from "../../pluginSettings";
import { LoggerService } from "../../shared/services/LoggerService";
import { NotificationService } from "../../shared/services/NotificationService";
import { isPathIgnoredByUserFilters } from "../../shared/utils/vaultUtils";
import {
	RelatedChunksView,
	VIEW_TYPE_RELATED_CHUNKS,
} from "../../ui/sidebar/RelatedChunksView";
import { NoteVectorService } from "../services/NoteVectorService";
import { SearchService } from "../services/SearchService";

export class ViewManager {
	public lastProcessedFilePath: string | null = null;

	constructor(
		private app: App,
		private logger: LoggerService | null,
		private settings: PluginSettings,
		private getNoteVectorService: () => NoteVectorService | null,
		private getSearchService: () => SearchService | null,
		private notificationService: NotificationService | null
	) {}

	async activateRelatedChunksView(): Promise<void> {
		this.logger?.verbose_log("Attempting to activate or create RelatedChunksView.");

		try {
			const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RELATED_CHUNKS);
			this.logger?.verbose_log(`Found ${existingLeaves.length} existing leaves.`);

			const primaryLeaf = this.getOrCleanupLeaves(existingLeaves);

			if (primaryLeaf) {
				this.logger?.verbose_log("Reusing existing leaf.");
				return;
			}

			await this.createNewLeaf();
		} catch (error) {
			this.logger?.error("Error in activateRelatedChunksView:", error);
			throw error;
		}
	}

	private getOrCleanupLeaves(leaves: WorkspaceLeaf[]): WorkspaceLeaf | null {
		if (leaves.length === 0) return null;

		if (leaves.length > 1) {
			this.logger?.warn(
				`Found ${leaves.length} duplicate leaves. Cleaning up ${leaves.length - 1} duplicates.`
			);
			leaves.slice(1).forEach((leaf, i) => {
				this.logger?.verbose_log(`Detaching duplicate leaf instance ${i + 2}.`);
				leaf.detach();
			});
		}

		return leaves[0];
	}

	private async createNewLeaf(): Promise<void> {
		this.logger?.verbose_log("Creating new leaf.");
		
		const newLeaf = await this.createRelatedChunksLeaf();
		if (!newLeaf) {
			throw new Error("Failed to create a new leaf for RelatedChunksView");
		}

		await newLeaf.setViewState({
			type: VIEW_TYPE_RELATED_CHUNKS,
			active: true,
		});
		this.logger?.verbose_log("New leaf created successfully.");
	}

	private async createRelatedChunksLeaf(): Promise<WorkspaceLeaf | null> {
		const { workspace } = this.app;

		// Try right sidebar first
		const rightLeaf = workspace.getRightLeaf(false);
		if (rightLeaf) {
			this.logger?.verbose_log("Using right sidebar for new leaf.");
			return rightLeaf;
		}

		// Try splitting active markdown view
		const activeMarkdownView = workspace.getActiveViewOfType(MarkdownView);
		if (activeMarkdownView?.leaf) {
			const splitLeaf = this.trySplitLeaf(activeMarkdownView.leaf);
			if (splitLeaf) return splitLeaf;
		}

		// Try creating in right sidebar
		const sidebarLeaf = this.tryCreateSidebarLeaf();
		if (sidebarLeaf) return sidebarLeaf;

		// Fallback to floating leaf
		return this.tryCreateFloatingLeaf();
	}

	private trySplitLeaf(leaf: WorkspaceLeaf): WorkspaceLeaf | null {
		this.logger?.verbose_log("Creating leaf by splitting active markdown view.");
		try {
			return this.app.workspace.createLeafBySplit(leaf, "vertical", false);
		} catch (error) {
			this.logger?.warn("Failed to create leaf by splitting:", error);
			return null;
		}
	}

	private tryCreateSidebarLeaf(): WorkspaceLeaf | null {
		this.logger?.verbose_log("Creating new leaf in right sidebar.");
		try {
			return this.app.workspace.getLeaf("split", "vertical");
		} catch (error) {
			this.logger?.warn("Failed to create leaf in right sidebar:", error);
			return null;
		}
	}

	private tryCreateFloatingLeaf(): WorkspaceLeaf | null {
		this.logger?.verbose_log("Fallback: Creating floating leaf.");
		try {
			return this.app.workspace.getLeaf(true);
		} catch (error) {
			this.logger?.error("Failed to create fallback leaf:", error);
			return null;
		}
	}

	async searchAndDisplayInSidebar(
		query: string,
		excludeFilePaths: string[] = []
	): Promise<void> {
		this.logger?.verbose_log(`Searching for similar chunks for query: "${query}"`);

		const searchService = this.getSearchService();
		if (!searchService) {
			this.notificationService?.showNotice("Search service is not ready.");
			return;
		}

		try {
			await this.activateRelatedChunksView();

			const view = this.getRelatedChunksView();
			if (view) {
				view.setLoadingState(query);
			}

			const activeFile = this.app.workspace.getActiveFile();
			const activeFileIgnored =
				this.settings.enableUserIgnoreFilters &&
				!!(activeFile && isPathIgnoredByUserFilters(this.app, activeFile.path));
			const effectiveExcludeFilePaths = activeFileIgnored
				? []
				: excludeFilePaths;

			const results = await searchService.search(
				query,
				undefined,
				this.settings.relatedChunksResultLimit,
				{ excludeFilePaths: effectiveExcludeFilePaths }
			);

			const shouldFilterIgnored =
				this.settings.enableUserIgnoreFilters &&
				!activeFileIgnored;
			const filteredResults = shouldFilterIgnored
				? results.filter(
						(result) =>
							!isPathIgnoredByUserFilters(this.app, result.file_path)
				  )
				: results;

			if (view) {
				view.displaySearchResults(query, filteredResults);
			}
		} catch (error) {
			this.logger?.error("Error during sidebar search:", error);
			this.notificationService?.showNotice("Failed to perform search. Check console.");
		}
	}

	private getRelatedChunksView(): RelatedChunksView | null {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RELATED_CHUNKS);
		if (leaves.length === 0) {
			return null;
		}
		
		const view = leaves[0].view;
		if (view instanceof RelatedChunksView) {
			return view;
		}
		
		const viewType = (view as any)?.getViewType?.() || 'unknown';
		this.logger?.warn(
			`Found leaf with VIEW_TYPE_RELATED_CHUNKS, but view is not a RelatedChunksView instance. Type: ${viewType}`
		);
		return null;
	}

	handleActiveLeafChange = debounce(
		async (skipActivation: boolean = false): Promise<void> => {
			this.logger?.log("handleActiveLeafChange called");

			// if (this.shouldSkipUpdate()) {
			// 	return;
			// }

			const activeFile = this.app.workspace.getActiveFile();
			const currentFilePath = activeFile?.path || null;
			this.logger?.log(`Active file: ${currentFilePath || "none"}`);

			if (currentFilePath === this.lastProcessedFilePath) {
				this.logger?.verbose_log(
					`Active file is the same as previously processed (${currentFilePath}), skipping update.`
				);
				return;
			}

			this.lastProcessedFilePath = currentFilePath;

			const noteVectorService = this.getNoteVectorService();
			if (!noteVectorService) {
				this.logger?.warn(
					"NoteVectorService not ready for active leaf change."
				);
				return;
			}

			this.logger?.log("NoteVectorService is ready");

			if (activeFile && activeFile.extension === "md") {
				await this.processMarkdownFile(
					activeFile,
					noteVectorService,
					skipActivation
				);
			} else {
				this.logger?.verbose_log(
					"No active markdown file or active file is not markdown."
				);
				this.clearSidebarView();
			}
		},
		200,
		true
	);

	private shouldSkipUpdate(): boolean {
		const currentActiveLeaf = this.app.workspace.activeLeaf;
		if (currentActiveLeaf && currentActiveLeaf.view instanceof RelatedChunksView) {
			this.logger?.verbose_log(
				"Active leaf is RelatedChunksView itself, skipping update to prevent flickering or state loss."
			);
			return true;
		}
		return false;
	}

	private async processMarkdownFile(
		activeFile: TFile,
		noteVectorService: NoteVectorService,
		skipActivation: boolean
	): Promise<void> {
		this.logger?.log(`Active file changed: ${activeFile.path}. Finding related chunks.`);
		
		try {
			const noteVector = await this.getNoteVector(activeFile, noteVectorService);
			
			if (noteVector) {
				await this.processNoteVector(activeFile, noteVector, noteVectorService, skipActivation);
			} else {
				this.handleMissingNoteVector(activeFile);
			}
		} catch (error) {
			this.handleProcessingError(activeFile, error);
		}
	}

	private async getNoteVector(
		activeFile: TFile,
		noteVectorService: NoteVectorService
	): Promise<number[] | null> {
		this.logger?.log(`Attempting to get note vector from DB for: ${activeFile.path}`);
		const noteVector = await noteVectorService.getNoteVectorFromDB(activeFile);
		this.logger?.log(
			`Note vector result for ${activeFile.path}: ${
				noteVector ? `Found (length: ${noteVector.length})` : "Not found"
			}`
		);
		return noteVector;
	}

	private async processNoteVector(
		activeFile: TFile,
		noteVector: number[],
		noteVectorService: NoteVectorService,
		skipActivation: boolean
	): Promise<void> {
		const activeFileIgnored =
			this.settings.enableUserIgnoreFilters &&
			isPathIgnoredByUserFilters(this.app, activeFile.path);
		const excludeFilePaths = activeFileIgnored
			? new Set<string>()
			: this.buildExcludeFilePaths(activeFile);
		const searchResults = await noteVectorService.findSimilarChunks(
			noteVector,
			this.settings.relatedChunksResultLimit,
			Array.from(excludeFilePaths)
		);

		const shouldFilterIgnored =
			this.settings.enableUserIgnoreFilters && !activeFileIgnored;
		const filteredResults = shouldFilterIgnored
			? searchResults.filter(
					(result) =>
						!isPathIgnoredByUserFilters(this.app, result.file_path)
				)
			: searchResults;

		await this.updateOrCreateSidebarView(
			activeFile,
			filteredResults,
			skipActivation
		);
	}

	private buildExcludeFilePaths(activeFile: TFile): Set<string> {
		const excludeFilePaths = new Set<string>([activeFile.path]);

		if (this.settings.excludeOutgoingLinksFromRelatedChunks) {
			this.addOutgoingLinks(activeFile, excludeFilePaths);
		}

		if (this.settings.excludeBacklinksFromRelatedChunks) {
			this.addBacklinks(activeFile, excludeFilePaths);
		}

		return excludeFilePaths;
	}

	private addOutgoingLinks(activeFile: TFile, excludeFilePaths: Set<string>): void {
		const fileCache = this.app.metadataCache.getFileCache(activeFile);
		if (!fileCache?.links) return;

		for (const link of fileCache.links) {
			const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
				link.link,
				activeFile.path
			);
			if (linkedFile) {
				excludeFilePaths.add(linkedFile.path);
			}
		}
	}

	private addBacklinks(activeFile: TFile, excludeFilePaths: Set<string>): void {
		const backlinks = this.app.metadataCache.getBacklinksForFile(activeFile);
		for (const sourcePath of Object.keys(backlinks.data)) {
			excludeFilePaths.add(sourcePath);
		}
	}

	private async updateOrCreateSidebarView(
		activeFile: TFile,
		searchResults: any[],
		skipActivation: boolean
	): Promise<void> {
		const sidebarLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RELATED_CHUNKS);
		this.logger?.log(`Found ${sidebarLeaves.length} sidebar leaves`);

		if (sidebarLeaves.length > 0) {
			this.updateExistingSidebarView(sidebarLeaves[0], activeFile, searchResults);
		} else if (this.settings.autoShowRelatedChunksSidebar && !skipActivation) {
			await this.createAndUpdateSidebarView(activeFile, searchResults);
		}
	}

	private updateExistingSidebarView(
		leaf: WorkspaceLeaf,
		activeFile: TFile,
		searchResults: any[]
	): void {
		const view = leaf.view;
		if (view instanceof RelatedChunksView) {
			view.updateView(activeFile.basename, searchResults);
		} else {
			// const viewType = (view as any)?.getViewType?.() || 'unknown';
			// this.logger?.warn(
			// 	`View in leaf is not a RelatedChunksView instance. Type: ${viewType}`
			// );
		}
	}

	private async createAndUpdateSidebarView(
		activeFile: TFile,
		searchResults: any[]
	): Promise<void> {
		await this.activateRelatedChunksView();
		const newSidebarLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RELATED_CHUNKS);
		
		if (newSidebarLeaves.length > 0) {
			this.updateExistingSidebarView(newSidebarLeaves[0], activeFile, searchResults);
		}
	}

	private handleMissingNoteVector(activeFile: TFile): void {
		this.logger?.warn(
			`⚠️ Could not get note vector for ${activeFile.path}. ` +
			`The file might not be vectorized yet or is empty. ` +
			`Please check if the file has been indexed.`
		);

		const view = this.getRelatedChunksView();
		if (view) {
			view.updateView(activeFile.basename, []);
		}
	}

	private handleProcessingError(activeFile: TFile, error: unknown): void {
		this.logger?.error(`Error processing related chunks for ${activeFile.path}:`, error);
		this.notificationService?.showNotice("Failed to find related chunks. Check console.");
		this.clearSidebarView();
	}

	private clearSidebarView(): void {
		const view = this.getRelatedChunksView();
		if (view) {
			if (view instanceof RelatedChunksView) {
				view.clearView();
			} else {
				const viewType = (view as any)?.getViewType?.() || 'unknown';
				this.logger?.warn(
					`View is not a RelatedChunksView instance in clearSidebarView. Type: ${viewType}`
				);
			}
		}
	}

	resetLastProcessedFile(): void {
		this.lastProcessedFilePath = null;
	}
}
