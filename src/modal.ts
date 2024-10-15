import { App, Modal } from "obsidian";

export class PromptModal extends Modal {
  prompt: string;

  onSubmit: (prompt: string) => void;

  constructor(
    app: App,
    defaultPrompt: string,
    onSubmit: (prompt: string) => void
  ) {
    super(app);
    this.prompt = defaultPrompt;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;

    // Add a title to the modal
    contentEl.createEl("h2", { text: "Generate Text from Prompt" });

    // Create a container for the textarea
    const textareaContainer = contentEl.createDiv({ cls: "prompt-modal-textarea-container" });

    // Create the textarea element
    const textarea = textareaContainer.createEl("textarea", { cls: "prompt-modal-textarea" });
    textarea.value = this.prompt;

    textarea.addEventListener("input", () => {
      this.prompt = textarea.value;
    });

    // Create a container for the buttons
    const buttonContainer = contentEl.createDiv({ cls: "prompt-modal-button-container" });

    // Create the submit button
    const submitBtn = buttonContainer.createEl("button", { text: "Submit" });
    submitBtn.addClass("mod-cta"); // Obsidian's standard call-to-action button styling
    submitBtn.addEventListener("click", () => {
      this.close();
      this.onSubmit(this.prompt);
    });

    // Optionally, add a cancel button
    const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}