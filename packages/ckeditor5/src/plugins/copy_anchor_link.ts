import { ButtonView, Plugin } from "ckeditor5";
import copyIcon from "../icons/copy.svg?raw";
import { escapeHtml } from "../utils";

/**
 * Adds a "Copy anchor link" button to the bookmark/anchor widget toolbar.
 * When clicked, copies a reference link href (e.g. `#root/noteId?bookmark=anchorName`)
 * to the clipboard via the host-provided `clipboard.copyHtml` callback (cross-browser
 * fallback + toast) — `navigator.clipboard` is undefined outside secure contexts, so
 * writing to it directly crashed the editor when Trilium is served over plain HTTP.
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
                        editor.config.get("clipboard")?.copyHtml?.(html, href);
                    }
                }
            });

            return button;
        });
    }

}
