import { App, Modal, Setting, Notice } from "obsidian";

export class RebuildAllIndexesModal extends Modal {
	private onConfirm: () => Promise<void>;

	constructor(app: App, onConfirm: () => Promise<void>) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Rebuild All Indexes" });
		contentEl.createEl("p", {
			text: "Are you sure you want to rebuild the entire vector index from scratch? This will clear all existing data and re-process all your notes. This action cannot be undone and may take some time.",
		});

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText("Rebuild")
					.setCta()
					.onClick(async () => {
						const notice = new Notice("Rebuilding indexes...", 0);
						try {
							await this.onConfirm();
							notice.setMessage("Indexes rebuilt successfully.");
							setTimeout(() => notice.hide(), 5000);
						} catch (error: any) {
							console.error("Failed to rebuild indexes:", error);
							notice.setMessage(
								`Failed to rebuild indexes: ${error.message}`
							);
							setTimeout(() => notice.hide(), 7000);
						} finally {
							this.close();
						}
					})
			)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => {
					this.close();
				})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
