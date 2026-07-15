import { ButtonView, type Editor, type Locale, Plugin } from "ckeditor5";
import copyIcon from "../icons/copy.svg?raw";

/**
 * Builds a "Copy URL" toolbar button that copies `getUrl()` to the clipboard via
 * the host-provided `clipboard.copy` callback (cross-browser fallback + toast).
 * Shared by the default link toolbar and the link-embed widget toolbar.
 */
export function createCopyUrlButton(editor: Editor, locale: Locale, getUrl: () => string | null | undefined): ButtonView {
    const button = new ButtonView(locale);
    button.set({
        label: translate(editor, "link.copy_url"),
        icon: copyIcon,
        tooltip: true
    });

    button.on("execute", () => {
        const url = getUrl();
        if (typeof url === "string" && url) {
            editor.config.get("clipboard")?.copy?.(url);
        }
    });

    return button;
}

function translate(editor: Editor, key: string) {
    const translateFn = editor.config.get("translate") as ((key: string) => string) | undefined;
    return translateFn ? translateFn(key) : key;
}

/**
 * Adds a "Copy URL" button to the link balloon toolbar, placed right after the URL preview.
 * Copies the selected link's href to the clipboard via the host-provided `clipboard.copy`
 * callback (which handles the cross-browser fallback and the success/error toast).
 */
export default class CopyLinkUrlButton extends Plugin {

    init() {
        const editor = this.editor;

        editor.ui.componentFactory.add("copyLinkUrl", (locale) =>
            createCopyUrlButton(editor, locale, () => editor.commands.get("link")?.value as string | null | undefined)
        );
    }

}
