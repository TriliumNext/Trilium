import { Command, ModelElement } from "ckeditor5";
import { getPrettierConfig, isSupportedLanguage } from "./languages_config";

export class FormatCodeblockCommand extends Command {
    declare value: string | false;

    override refresh() {
        const codeBlockCommand = this.editor.commands.get("codeBlock");
        const language = codeBlockCommand?.value;

        if (typeof language === "string" && isSupportedLanguage(language)) {
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

        const language = this.value;
        if (!language) {
            return;
        }

        const config = getPrettierConfig(language);
        if (!config) {
            return;
        }

        const codeBlockEl = selection
            .getFirstPosition()
            ?.findAncestor("codeBlock");
        if (!codeBlockEl) {
            console.warn("Unable to find code block element to format.");
            return;
        }

        const codeText = this.extractCodeText(codeBlockEl);

        if (!codeText) {
            return;
        }

        Promise.all([import("prettier/standalone"), config.plugins()])
            .then(async ([prettier, plugins]) => {
                const formatted = await prettier.format(codeText, {
                    parser: config.parser,
                    plugins: plugins as any[],
                    tabWidth: 4,
                    printWidth: 120,
                });

                const trimmed = this.removeTrailingNewline(formatted);

                if (trimmed === codeText) {
                    return;
                }

                model.change((writer) => {
                    const range = writer.createRangeIn(codeBlockEl);
                    writer.remove(range);
                    const lines = trimmed.split("\n");
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
            .catch((err) => {
                console.error("Failed to format code block:", err);
            });
    }

    private removeTrailingNewline(text: string) {
        return text.replace(/\n$/, "");
    }

    private extractCodeText(codeBlockEl: ModelElement): string {
        return Array.from(codeBlockEl.getChildren())
            .map((child) => ("data" in child ? child.data : "\n"))
            .join("")
            .trim();
    }
}
