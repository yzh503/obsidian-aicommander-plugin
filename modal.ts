import { App, Modal, Setting } from "obsidian";

export class PromptModal extends Modal {
  prompt: string;

  onSubmit: (prompt: string) => void;

  constructor(
    app: App,
    defaultprompt: string,
    onSubmit: (prompt: string) => void
  ) {
    super(app);
    this.prompt = defaultprompt;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("h1", { text: "" });

    new Setting(contentEl).setName("Generate text from prompt").addText((text) =>
      text.setValue(this.prompt).onChange((value) => {
        this.prompt = value;
      })
    );

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Submit")
        .setCta()
        .onClick(() => {
          this.close();
          this.onSubmit(this.prompt);
        })
    );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}