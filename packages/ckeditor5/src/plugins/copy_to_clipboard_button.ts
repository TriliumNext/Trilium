import { ButtonView, Command, type Editor, type Locale, Plugin } from "ckeditor5";
import copyIcon from "../icons/copy.svg?raw";
import { getSelectedExtendedCodeBlock } from "./content_embed/inline_source.js";

export default class CopyToClipboardButton extends Plugin {

    public init() {
        const editor = this.editor;
        editor.commands.add("copyToClipboard", new CopyToClipboardCommand(this.editor));

        const componentFactory = editor.ui.componentFactory;
        componentFactory.add("copyToClipboard", (locale) => {
            return createCopyToClipboardButton(editor, locale);
        });
    }

}

/** A button that copies the code at the selection through the `copyToClipboard` command. */
export function createCopyToClipboardButton(editor: Editor, locale: Locale) {
    const button = new ButtonView(locale);
    // A `label` rather than a literal `tooltip` string: the tooltip reads the same, and the
    // icon-only button gains the accessible name it had no way to expose before.
    button.set({
        label: editor.t("Copy to clipboard"),
        tooltip: true,
        icon: copyIcon
    });

    button.on("execute", () => {
        editor.execute("copyToClipboard");
    });

    return button;
}

export class CopyToClipboardCommand extends Command {

    private executeCallback?: (text: string) => void;

    override execute(...args: Array<unknown>) {
        const editor = this.editor;
        const model = editor.model;
        const selection = model.document.selection;

        if (!this.executeCallback) {
            this.executeCallback = this.editor.config.get("clipboard")?.copy;
        }

        const embed = getSelectedExtendedCodeBlock(editor);
        if (embed) {
            // The host writes the code typed last into the model after a delay.
            editor.config.get("contentEmbed")?.flushInline?.();
            const source = embed.getAttribute("source") as string | undefined;
            this.copyText(source ?? "", "extended code block");
            return;
        }

        // Try code block first
        const codeBlockEl = selection.getFirstPosition()?.findAncestor("codeBlock");
        if (codeBlockEl) {
            const codeText = Array.from(codeBlockEl.getChildren())
                .map(child => "data" in child ? child.data : "\n")
                .join("");
            this.copyText(codeText, "code block");
            return;
        }

        // Try inline code (text with 'code' attribute)
        const position = selection.getFirstPosition();
        /* v8 ignore next 1 -- getFirstPosition() never returns null in a live editor selection */
        if (position) {
            const textNode = position.textNode || position.nodeBefore || position.nodeAfter;
            if (textNode && "data" in textNode && textNode.hasAttribute?.("code")) {
                this.copyText(textNode.data as string, "inline code");
                return;
            }
        }

        console.warn("No code block or inline code found to copy from.");
    }

    private copyText(text: string, source: string) {
        if (!text) {
            console.warn(`No text found in ${source}.`);
            return;
        }

        if (!this.executeCallback) {
            navigator.clipboard.writeText(text).then(() => {
                console.log(`${source} copied to clipboard`);
            }).catch(err => {
                console.error(`Failed to copy ${source}`, err);
            });
        } else {
            this.executeCallback(text);
        }
    }

}
