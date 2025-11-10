import { App, Notice, Plugin } from "obsidian";
import { LoggerService } from "../../shared/services/LoggerService";
import { NotificationService } from "../../shared/services/NotificationService";
import { SearchModal } from "../../ui/modals/SearchModal";
import { DiscardDBModal } from "../../ui/modals/DiscardDBModal";
import { DeleteResourcesModal } from "../../ui/modals/DeleteResourcesModal";
import type { PluginSettings } from "../../pluginSettings";
import type { ResourceInitializer } from "./ResourceInitializer";
import type { ViewManager } from "./ViewManager";

export class CommandRegistrar {
	constructor(
		private app: App,
		private plugin: Plugin,
		private logger: LoggerService | null,
		private settings: PluginSettings,
		private resourceInitializer: ResourceInitializer,
		private viewManager: ViewManager,
		private clearResourcesCallback: (
			discardDbOnly: boolean
		) => Promise<void>
	) {}

	registerAllCommands(): void {
		this.registerSearchSimilarNotesCommand();
		this.registerRebuildAllIndexesCommand();
		this.registerDiscardDbCommand();
		this.registerDeleteResourcesCommand();
		this.registerShowRelatedChunksSidebarCommand();
	}

	private registerSearchSimilarNotesCommand(): void {
		this.plugin.addCommand({
			id: "search-similar-notes",
			name: "Search similar notes",
			callback: async () => {
				try {
					await this.resourceInitializer.ensureResourcesInitialized();
				} catch (error) {
					console.error(
						"Resource initialization check failed for search:",
						error
					);
					new Notice(
						"Resources are not ready for search. Check console."
					);
					return;
				}
				if (!this.resourceInitializer.commandHandler) {
					new Notice(
						"Command handler not ready for search. Please try reloading the plugin."
					);
					return;
				}

				if (!this.resourceInitializer.notificationService) {
					new Notice("Notification service not ready.");
					return;
				}
				new SearchModal(
					this.app,
					this.resourceInitializer.commandHandler,
					this.resourceInitializer.notificationService,
					this.settings
				).open();
			},
		});
	}

	private registerRebuildAllIndexesCommand(): void {
		this.plugin.addCommand({
			id: "rebuild-all-indexes",
			name: "Rebuild all indexes (Clear and re-vectorize all notes)",
			callback: async () => {
				await this.rebuildAllIndexes();
			},
		});
	}

	public async rebuildAllIndexes(): Promise<void> {
		const progressNotice = new Notice("Preparing for rebuild...", 0);
		try {
			progressNotice.setMessage(
				"Ensuring resources are ready for rebuild... This may take a moment."
			);
			await this.resourceInitializer.ensureResourcesInitialized();

			sessionStorage.setItem("my-vector-plugin-rebuild-flag", "true");

			progressNotice.setMessage(
				"Resources ready. Reloading the app to start index rebuild..."
			);

			setTimeout(() => {
				this.app.commands.executeCommandById("app:reload");
			}, 1500);
		} catch (error) {
			console.error("Failed to prepare for rebuild:", error);
			progressNotice.setMessage(
				"Could not initiate rebuild process. Check console for details."
			);
			setTimeout(() => progressNotice.hide(), 7000);
			sessionStorage.removeItem("my-vector-plugin-rebuild-flag");
		}
	}

	private registerDiscardDbCommand(): void {
		this.plugin.addCommand({
			id: "discard-db",
			name: "Discard database",
			callback: async () => {
				new DiscardDBModal(this.app, async () => {
					await this.clearResourcesCallback(true);
				}).open();
			},
		});
	}

	private registerDeleteResourcesCommand(): void {
		this.plugin.addCommand({
			id: "delete-resources",
			name: "Delete all resources (model cache, DB, etc.)",
			callback: async () => {
				new DeleteResourcesModal(this.app, async () => {
					await this.clearResourcesCallback(false);
				}).open();
			},
		});
	}

	private registerShowRelatedChunksSidebarCommand(): void {
		this.plugin.addCommand({
			id: "show-related-chunks-sidebar",
			name: "Show/Hide Related Chunks Sidebar",
			callback: () => {
				this.viewManager.activateRelatedChunksView();
			},
		});
	}
}
