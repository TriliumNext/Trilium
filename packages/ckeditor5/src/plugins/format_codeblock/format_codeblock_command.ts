import { Command, ModelElement, Notification } from "ckeditor5";

export class FormatCodeblockCommand extends Command {
    declare value: string | false;

    private _isFormatting = false;

    override refresh() {
        if (this._isFormatting) {
            this.isEnabled = false;
            return;
        }

        const codeBlockCommand = this.editor.commands.get("codeBlock");
        const language = codeBlockCommand?.value;
        const codeFormatter = this.editor.config.get("codeFormatter");

        if (
            typeof language === "string" &&
            codeFormatter?.isLanguageSupported(language)
        ) {
            this.isEnabled = true;
            this.value = language;
        } else {
            this.isEnabled = false;
            this.value = false;
        }
    }

    override execute() {
        const editor = this.editor;
        const model = editor.model;
        const selection = model.document.selection;
        const notification = editor.plugins.get(Notification);
        const t = editor.locale.t;
        const codeFormatter = editor.config.get("codeFormatter");

        const language = this.value;
        if (!language || !codeFormatter) {
            return;
        }

        const codeBlockEl = selection
            .getFirstPosition()
            ?.findAncestor("codeBlock");
        if (!codeBlockEl) {
            notification.showWarning(
                t("Unable to find code block element to format."),
                {
                    namespace: "formatCodeblock",
                },
            );
            return;
        }

        const codeText = this.extractCodeText(codeBlockEl);

        if (!codeText.trim()) {
            return;
        }

        this._isFormatting = true;
        this.refresh();

        codeFormatter
            .format(codeText, language)
            .then((formatted) => {
                // Strip trailing newline that formatters like Prettier always add,
                // to avoid accumulating phantom softBreak elements in the model.
                const normalizedFormatted = formatted.replace(/\n$/, "");

                if (normalizedFormatted === codeText) {
                    return;
                }

                model.change((writer) => {
                    const range = writer.createRangeIn(codeBlockEl);
                    writer.remove(range);
                    const lines = normalizedFormatted.split("\n");
                    for (let i = 0; i < lines.length; i++) {
                        if (i > 0) {
                            writer.appendElement("softBreak", codeBlockEl);
                        }
                        if (lines[i]) {
                            writer.appendText(lines[i], codeBlockEl);
                        }
                    }
                });
            })
            .catch((err: unknown) => {
                const message =
                    err instanceof Error ? err.message : String(err);
                notification.showWarning(message, {
                    namespace: "formatCodeblock",
                });
            })
            .finally(() => {
                this._isFormatting = false;
                this.refresh();
            });
    }

    private extractCodeText(codeBlockEl: ModelElement): string {
        return Array.from(codeBlockEl.getChildren())
            .map((child) => ("data" in child ? child.data : "\n"))
            .join("");
    }
}
