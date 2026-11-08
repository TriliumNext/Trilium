import { ButtonView, type Editor, type LinkCommand, type Locale, Plugin } from "ckeditor5";
import copyIcon from "../icons/copy.svg?raw";

/**
 * Builds a "Copy address (URL)" toolbar button that copies `getUrl()` to the clipboard via
 * the host-provided `clipboard.copy` callback (cross-browser fallback + toast).
 * Shared by the default link toolbar and the link-embed widget toolbar.
 */
export function createCopyUrlButton(editor: Editor, locale: Locale, getUrl: () => string | null | undefined): ButtonView {
    const button = new ButtonView(locale);
    button.set({
        label: editor.t("Copy address (URL)"),
        icon: copyIcon,
        tooltip: true
    });

    button.on("execute", () => {
        const url = getUrl();
        if (typeof url === "string" && url) {
            copyUrl(editor, url);
        }
    });

    return button;
}

/**
 * Adds a "Copy address (URL)" button to the link balloon toolbar, placed right after the URL
 * preview. Copies the selected link's href to the clipboard via the host-provided `clipboard.copy`
 * callback (which handles the cross-browser fallback and the success/error toast). The button
 * shows only on a link to a web page.
 */
export default class CopyLinkUrlButton extends Plugin {

    init() {
        const editor = this.editor;

        editor.ui.componentFactory.add("copyLinkUrl", (locale) => {
            // The link balloon toolbar comes with `Link`, which registers the command.
            const command = editor.commands.get("link") as LinkCommand;
            const button = createCopyUrlButton(editor, locale, () => command.value);
            // Links to notes, attachments and anchors start with `#`, and have no address.
            button.bind("isVisible").to(command, "value", (href) => !href?.startsWith("#"));
            return button;
        });
    }

}

/** Copies `url` to the clipboard through the host-provided `clipboard.copy` callback. */
export function copyUrl(editor: Editor, url: string) {
    editor.config.get("clipboard")?.copy?.(url);
}
