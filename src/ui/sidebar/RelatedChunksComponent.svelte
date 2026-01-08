<script lang="ts">
	import { getIcon } from "obsidian";
	import { onMount, tick, untrack } from "svelte";
	import type { SimilarityResultItem } from "../../core/storage/types";
	import type LocalFastVectorizePlugin from "../../main";
	import ChunkItemComponent from "./ChunkItemComponent.svelte";

	let {
		plugin,
		activeNoteName = $bindable(null),
		relatedChunks = $bindable([]),
		onChunkClick,
		getChunkPreview,
		isSearchResultsMode = $bindable(false),
		searchQuery = $bindable(null),
		onBackClick,
	}: {
		plugin: LocalFastVectorizePlugin;
		activeNoteName: string | null;
		relatedChunks: SimilarityResultItem[];
		onChunkClick: (item: SimilarityResultItem) => Promise<void>;
		getChunkPreview: (item: SimilarityResultItem) => Promise<string>;
		isSearchResultsMode: boolean;
		searchQuery: string | null;
		onBackClick: () => Promise<void>;
	} = $props();

	type FileGroup = [string, SimilarityResultItem[]];
	type ChunkMap = Map<string, SimilarityResultItem[]>;
	type ChunkQueue = {
		chunks: SimilarityResultItem[];
		currentIndex: number;
		isDisplaying: boolean;
	};

	let displayedFileGroups = $state<FileGroup[]>([]);
	let allGroupedChunks = $state<ChunkMap>(new Map());
	let displayedChunksInExpandedGroups = $state<
		Map<string, SimilarityResultItem[]>
	>(new Map());
	let chunkDisplayQueues = $state<Map<string, ChunkQueue>>(new Map());
	let collapseIconSvg = $state("");
	let backIconSvg = $state("");
	let isDisplaying = $state(false);
	let pendingDisplay = $state<(() => void) | null>(null);
	let expandedFiles = $state<Set<string>>(new Set());

	const hasActiveNote = $derived(Boolean(activeNoteName));
	const hasChunks = $derived(allGroupedChunks.size > 0);
	const showEmptyState = $derived(
		!hasChunks && (hasActiveNote || isSearchResultsMode),
	);
	const showWelcomeState = $derived(
		!hasChunks && !hasActiveNote && !isSearchResultsMode,
	);
	const showNeedsIndexingState = $derived(
		hasActiveNote && !hasChunks && !isSearchResultsMode,
	);

	onMount(() => {
		initializeIcon();

		return () => {
			cleanup();
		};
	});

	$effect(() => {
		const chunks = relatedChunks;
		untrack(() => {
			processAndDisplayChunks(chunks);
		});
	});

	function initializeIcon(): void {
		const iconElement = getIcon("right-triangle");
		if (iconElement) {
			collapseIconSvg = iconElement.outerHTML;
		}
		const backIcon = getIcon("arrow-left");
		if (backIcon) {
			backIconSvg = backIcon.outerHTML;
		}
	}

	function cleanup(): void {
		isDisplaying = false;
		pendingDisplay = null;
		chunkDisplayQueues.clear();
		displayedChunksInExpandedGroups.clear();
		refreshDisplayedChunks();
	}

	function resetDisplayState(): void {
		isDisplaying = false;
		pendingDisplay = null;
		displayedFileGroups = [];
	}

	function refreshDisplayedChunks(): void {
		displayedChunksInExpandedGroups = new Map(
			displayedChunksInExpandedGroups,
		);
	}

	function groupChunksByPath(chunks: SimilarityResultItem[]): ChunkMap {
		const map = new Map<string, SimilarityResultItem[]>();

		if (!chunks?.length) {
			return map;
		}

		const sortedChunks = [...chunks].sort(
			(a, b) => a.distance - b.distance,
		);

		for (const chunk of sortedChunks) {
			const filePath = chunk.file_path;
			if (!map.has(filePath)) {
				map.set(filePath, []);
			}
			map.get(filePath)!.push(chunk);
		}

		return map;
	}

	function processAndDisplayChunks(
		chunks: SimilarityResultItem[], // 型を変更
	): void {
		resetDisplayState();
		allGroupedChunks = groupChunksByPath(chunks);

		chunkDisplayQueues.clear();
		displayedChunksInExpandedGroups.clear();
		refreshDisplayedChunks();

		if (allGroupedChunks.size === 0) {
			updateExpandedFiles(chunks);
			return;
		}

		updateExpandedFiles(chunks);

		if (!plugin.settings.expandRelatedChunksFileGroups) {
			displayAllGroups();
		} else {
			displayGroupsProgressively();
		}
	}

	function updateExpandedFiles(chunks: SimilarityResultItem[]): void {
		if (!chunks?.length) {
			expandedFiles = new Set();
			return;
		}

		if (plugin.settings.expandRelatedChunksFileGroups) {
			const allFilePaths = new Set(
				chunks.map((chunk) => chunk.file_path),
			);
			expandedFiles = allFilePaths;
			initializeExpandedGroups(allFilePaths);
		} else {
			expandedFiles = new Set();
		}
	}

	function initializeExpandedGroups(filePaths: Set<string>): void {
		displayedChunksInExpandedGroups.clear();
		chunkDisplayQueues.clear();

		filePaths.forEach((filePath) => {
			const chunksForFile = allGroupedChunks.get(filePath) || [];
			displayedChunksInExpandedGroups.set(filePath, []);

			chunkDisplayQueues.set(filePath, {
				chunks: chunksForFile,
				currentIndex: 0,
				isDisplaying: true,
			});

			if (chunksForFile.length > 0) {
				displayNextChunk(filePath);
			}
		});

		refreshDisplayedChunks();
	}

	function displayAllGroups(): void {
		displayedFileGroups = Array.from(allGroupedChunks.entries());
	}

	function displayGroupsProgressively(): void {
		const filePaths = Array.from(allGroupedChunks.keys());
		let currentIndex = 0;
		isDisplaying = true;

		const displayNextGroup = (): void => {
			if (!isDisplaying || currentIndex >= filePaths.length) {
				return;
			}

			const filePath = filePaths[currentIndex];
			const group = allGroupedChunks.get(filePath);

			if (group) {
				displayedFileGroups = [
					...displayedFileGroups,
					[filePath, group],
				];
			}

			currentIndex++;
			scheduleNextGroupDisplay(
				currentIndex < filePaths.length,
				displayNextGroup,
			);
		};

		displayNextGroup();
	}

	function scheduleNextGroupDisplay(
		hasMore: boolean,
		displayFn: () => void,
	): void {
		if (hasMore) {
			pendingDisplay = () => {
				if (isDisplaying) {
					displayFn();
				}
			};
		}
	}

	function displayNextChunk(filePath: string): void {
		const queue = chunkDisplayQueues.get(filePath);
		if (
			!queue ||
			!queue.isDisplaying ||
			queue.currentIndex >= queue.chunks.length
		) {
			return;
		}

		const chunkToAdd = queue.chunks[queue.currentIndex];
		const currentChunks =
			displayedChunksInExpandedGroups.get(filePath) || [];

		displayedChunksInExpandedGroups.set(filePath, [
			...currentChunks,
			chunkToAdd,
		]);
		refreshDisplayedChunks();

		queue.currentIndex++;
		chunkDisplayQueues.set(filePath, queue);
	}

	function onGroupRendered(element: HTMLElement): void {
		if (pendingDisplay) {
			const nextDisplay = pendingDisplay;
			pendingDisplay = null;
			requestAnimationFrame(nextDisplay);
		}
	}

	function onChunkRendered(node: HTMLElement, filePath: string) {
		requestAnimationFrame(() => {
			displayNextChunk(filePath);
		});

		return {
			destroy() {},
		};
	}

	async function toggleFile(filePath: string): Promise<void> {
		const isCurrentlyExpanded = expandedFiles.has(filePath);

		const newSet = new Set(expandedFiles);
		if (newSet.has(filePath)) {
			newSet.delete(filePath);
		} else {
			newSet.add(filePath);
		}
		expandedFiles = newSet;

		await tick();

		const isNowExpanded = expandedFiles.has(filePath);

		if (isNowExpanded && !isCurrentlyExpanded) {
			expandFile(filePath);
		} else if (!isNowExpanded && isCurrentlyExpanded) {
			collapseFile(filePath);
		}
	}

	async function openNote(
		filePath: string,
		event?: MouseEvent | KeyboardEvent,
	): Promise<void> {
		const isMouseEvent = event instanceof MouseEvent;
		const newLeaf =
			isMouseEvent && (event.ctrlKey || event.metaKey || event.button === 1);
		const openInBackground = isMouseEvent && event.button === 1;

		try {
			await plugin.app.workspace.openLinkText(
				filePath,
				"",
				newLeaf || false,
				{ active: !openInBackground },
			);
		} catch (error) {
			console.error(`Failed to open note: ${filePath}`, error);
		}
	}

	function getFilePathFromEventTarget(
		event: MouseEvent,
	): string | null {
		const target = event.currentTarget as HTMLElement | null;
		return target?.dataset?.href ?? null;
	}

	function handleClick(event: MouseEvent): void {
		const filePath = getFilePathFromEventTarget(event);
		if (!filePath) return;
		openNote(filePath, event);
	}

	function handleMouseDown(event: MouseEvent): void {
		// Prevent Chromium/Electron auto-scroll on middle click
		if (event.button !== 1) return;
		event.preventDefault();
		event.stopPropagation();
		const filePath = getFilePathFromEventTarget(event);
		if (!filePath) return;
		openNote(filePath, event);
	}

	function handleMouseOver(
		event: MouseEvent | FocusEvent,
		filePath: string,
	): void {
		const target = event.currentTarget as HTMLElement;
		if (!target) return;

		plugin.app.workspace.trigger("hover-link", {
			event,
			source: "related-chunks-sidebar",
			hoverParent: target,
			targetEl: target,
			linktext: filePath,
		});
	}

	function expandFile(filePath: string): void {
		const chunksToDisplay = allGroupedChunks.get(filePath) || [];
		displayedChunksInExpandedGroups.set(filePath, []);

		stopExistingQueue(filePath);

		chunkDisplayQueues.set(filePath, {
			chunks: chunksToDisplay,
			currentIndex: 0,
			isDisplaying: true,
		});

		if (chunksToDisplay.length > 0) {
			displayNextChunk(filePath);
		}
	}

	function collapseFile(filePath: string): void {
		stopExistingQueue(filePath);
		displayedChunksInExpandedGroups.delete(filePath);
		refreshDisplayedChunks();
	}

	function stopExistingQueue(filePath: string): void {
		if (chunkDisplayQueues.has(filePath)) {
			const queue = chunkDisplayQueues.get(filePath)!;
			queue.isDisplaying = false;
			chunkDisplayQueues.set(filePath, queue);
		}
	}

	function getFileName(filePath: string): string {
		const parts = filePath.split("/");
		const fullName = parts[parts.length - 1] || filePath;
		return fullName.replace(/\.[^/.]+$/, "");
	}
</script>

<div class="related-chunks-container search-result-container">
	{#if isSearchResultsMode}
		<div class="related-chunks-header search-results-header">
			<button
				class="back-button clickable-icon"
				onclick={onBackClick}
				aria-label="Back"
			>
				{@html backIconSvg}
			</button>
			<div class="search-results-title">
				Results for "{searchQuery}"
			</div>
		</div>
	{:else if hasActiveNote}
		<div class="related-chunks-header">Related to {activeNoteName}</div>
	{/if}

	{#if showNeedsIndexingState}
		<div class="related-chunks-empty">
			<div style="margin-bottom: 10px;">
				⚠️ This note hasn't been indexed yet.
			</div>
			<div style="font-size: 0.9em; color: var(--text-muted);">
				Run the command:<br/>
				<strong>"Rebuild index for current note"</strong><br/>
				or<br/>
				<strong>"Rebuild all indexes"</strong><br/>
				from the command palette (Ctrl/Cmd+P).
			</div>
		</div>
	{:else if showEmptyState}
		<div class="related-chunks-empty">No related chunks found.</div>
	{:else if showWelcomeState}
		<div class="related-chunks-empty">
			Open a note to see related chunks, or select text and right-click to
			search.
		</div>
	{/if}

	{#each displayedFileGroups as [filePath, chunks] (filePath)}
		{@const isExpanded = expandedFiles.has(filePath)}
		{@const currentDisplayedChunks =
			displayedChunksInExpandedGroups.get(filePath) || []}

			<div class="related-chunks-file-group" use:onGroupRendered>
				<div
					class="related-chunks-file-header tree-item-self search-result-file-title"
					role="button"
					tabindex="0"
					onmouseover={(e) => handleMouseOver(e, filePath)}
					onfocus={(e) => handleMouseOver(e, filePath)}
					data-href={filePath}
					onmousedown={handleMouseDown}
					onclick={handleClick}
					onkeydown={(e) => {
						if (e.key === "Enter") openNote(filePath, e);
					}}
				>
				<div
					class="tree-item-icon collapse-icon"
					class:is-collapsed={!isExpanded}
					role="button"
					tabindex="0"
					onclick={(e) => {
						e.stopPropagation();
						toggleFile(filePath);
					}}
					onkeydown={(e) => {
						if (e.key === "Enter") {
							e.stopPropagation();
							toggleFile(filePath);
						}
					}}
				>
					{@html collapseIconSvg || ``}
				</div>
				<div class="related-chunks-file-name tree-item-inner">
					{getFileName(filePath)}
				</div>
				<div class="tree-item-flair-outer">
					<div class="related-chunks-file-count tree-item-flair">
						{chunks.length}
					</div>
				</div>
			</div>

			{#if isExpanded}
				<div class="related-chunks-list">
					{#each currentDisplayedChunks as chunk (chunk.id)}
						<div use:onChunkRendered={filePath}>
							<ChunkItemComponent
								{chunk}
								{onChunkClick}
								{getChunkPreview}
								{plugin}
							/>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/each}
</div>

<style>
	.related-chunks-header {
		padding: var(--size-2-3) var(--size-4-2);
		font-weight: var(--font-bold);
		border-bottom: 1px solid var(--background-modifier-border);
	}
	.search-results-header {
		display: flex;
		align-items: center;
		gap: var(--size-2-2);
	}
	.back-button {
		background: none;
		border: none;
		cursor: pointer;
		padding: var(--size-2-1);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-s);
		color: var(--icon-color);
	}
	.back-button:hover {
		background-color: var(--background-modifier-hover);
	}
	.search-results-title {
		font-weight: bold;
		flex-grow: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.related-chunks-empty {
		color: var(--text-muted);
		padding: var(--size-4-3);
		text-align: center;
	}

	.related-chunks-file-header {
		display: flex;
		cursor: pointer;
	}

	.related-chunks-file-header:hover {
		background-color: var(--background-modifier-hover);
	}

	.related-chunks-list {
		padding-left: 21px;
	}

	.related-chunks-container {
		padding: 0px;
	}
</style>
