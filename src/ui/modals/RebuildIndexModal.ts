import { App, Modal, Setting } from "obsidian";

export class RebuildIndexModal extends Modal {
	private onConfirm: () => Promise<void>;
	private onCancel: () => void;
	private confirmed: boolean = false;

	constructor(
		app: App,
		onConfirm: () => Promise<void>,
		onCancel: () => void
	) {
		super(app);
		this.onConfirm = onConfirm;
		this.onCancel = onCancel;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Rebuild Index Required" });
		contentEl.createEl("p", {
			text: "Changing this setting requires a full rebuild of the vector index. This will clear all existing data and re-process all your notes. Do you want to proceed?",
		});

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText("Rebuild Now")
					.setCta()
					.onClick(async () => {
						this.confirmed = true;
						this.close();
						await this.onConfirm();
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
		if (!this.confirmed) {
			this.onCancel();
		}
	}
}
