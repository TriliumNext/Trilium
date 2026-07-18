import { ButtonView, Plugin } from "ckeditor5";
import copyIcon from "../icons/copy.svg?raw";
import { escapeHtml } from "../utils";

/**
 * Adds a "Copy anchor link" button to the bookmark/anchor widget toolbar.
 * When clicked, copies a reference link href (e.g. `#root/noteId?bookmark=anchorName`)
 * to the clipboard.
 */
export default class CopyAnchorLinkButton extends Plugin {

    public init() {
        const editor = this.editor;

        editor.ui.componentFactory.add("copyAnchorLink", (locale) => {
            const button = new ButtonView(locale);
            const t = locale.t;

            button.set({
                label: t("Copy anchor reference link"),
                icon: copyIcon,
                tooltip: true
            });

            this.listenTo(button, "execute", () => {
                const selection = editor.model.document.selection;
                const selectedElement = selection.getSelectedElement();

                if (selectedElement?.name === "bookmark") {
                    const bookmarkId = selectedElement.getAttribute("bookmarkId") as string;
                    const noteId = glob.getActiveContextNote()?.noteId;

                    if (noteId && bookmarkId) {
                        const href = `#root/${noteId}?bookmark=${encodeURIComponent(bookmarkId)}`;
                        const title = glob.getReferenceLinkTitleSync(href);
                        const html = `<a class="reference-link" href="${escapeHtml(href)}">${escapeHtml(title)}</a>`;
                        navigator.clipboard.write([
                            new ClipboardItem({
                                "text/html": new Blob([html], { type: "text/html" }),
                                "text/plain": new Blob([href], { type: "text/plain" })
                            })
                        ]);
                    }
                }
            });

            return button;
        });
    }

}
