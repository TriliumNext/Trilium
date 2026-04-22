import { ButtonView, Command, Plugin } from "ckeditor5";
import copyIcon from "../icons/copy.svg?raw";

export default class CopyToClipboardButton extends Plugin {

    public init() {
        const editor = this.editor;
        editor.commands.add("copyToClipboard", new CopyToClipboardCommand(this.editor));

        const componentFactory = editor.ui.componentFactory;
        componentFactory.add("copyToClipboard", locale => {
            const button = new ButtonView(locale);
            button.set({
                tooltip: "Copy to clipboard",
                icon: copyIcon
            });

            this.listenTo(button, "execute", () => {
                editor.execute("copyToClipboard");
            });

            return button;
        });
    }

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
