import { Command, Editor, ModelElement, Notification } from "ckeditor5";

export interface CodeFormatterInterface {
    readonly name: string;
    format(code: string, language: string): Promise<string>;
}

export interface FormatterRegistryInterface {
    isLanguageSupported(language: string): boolean;
    getFormatterForLanguage(language: string): CodeFormatterInterface | undefined;
}

export class FormatCodeblockCommand extends Command {
    declare value: string | false;

    private readonly registry: FormatterRegistryInterface;

    constructor(editor: Editor, registry: FormatterRegistryInterface) {
        super(editor);
        this.registry = registry;
    }

    override refresh() {
        const codeBlockCommand = this.editor.commands.get("codeBlock");
        const language = codeBlockCommand?.value;

        if (
            typeof language === "string" &&
            this.registry.isLanguageSupported(language)
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

        const language = this.value;
        if (!language) {
            return;
        }

        const formatter = this.registry.getFormatterForLanguage(language);
        if (!formatter) {
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

        if (!codeText) {
            return;
        }

        formatter
            .format(codeText, language)
            .then((formatted) => {
                if (formatted === codeText) {
                    return;
                }

                model.change((writer) => {
                    const range = writer.createRangeIn(codeBlockEl);
                    writer.remove(range);
                    const lines = formatted.split("\n");
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
                notification.showWarning(err.message || String(err), {
                    title: t(
                        `Failed to format code block with ${formatter.name}`,
                    ),
                    namespace: "formatCodeblock",
                });
            });
    }

    private extractCodeText(codeBlockEl: ModelElement): string {
        return Array.from(codeBlockEl.getChildren())
            .map((child) => ("data" in child ? child.data : "\n"))
            .join("");
    }
}
