import { ButtonView, Plugin } from "ckeditor5";
import copyIcon from "../icons/copy.svg?raw";

/**
 * Adds a "Copy URL" button to the link balloon toolbar, placed right after the URL preview.
 * Copies the selected link's href to the clipboard via the host-provided `clipboard.copy`
 * callback (which handles the cross-browser fallback and the success/error toast).
 */
export default class CopyLinkUrlButton extends Plugin {

    init() {
        const editor = this.editor;

        editor.ui.componentFactory.add("copyLinkUrl", (locale) => {
            const button = new ButtonView(locale);
            button.set({
                label: this._translate("link.copy_url"),
                icon: copyIcon,
                tooltip: true
            });

            this.listenTo(button, "execute", () => {
                const href = editor.commands.get("link")?.value;
                if (typeof href === "string" && href) {
                    editor.config.get("clipboard")?.copy?.(href);
                }
            });

            return button;
        });
    }

    private _translate(key: string) {
        const translate = this.editor.config.get("translate") as ((key: string) => string) | undefined;
        return translate ? translate(key) : key;
    }

}
