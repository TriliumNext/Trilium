import { ButtonView, Plugin } from "ckeditor5";
import pencilIcon from "../icons/pencil.svg?raw";

const IMAGE_API_RE = /(?:^|\/)api\/images\/([A-Za-z0-9_]+)\//;
const ATTACHMENT_API_RE = /(?:^|\/)api\/attachments\/([A-Za-z0-9_]+)\/image\//;

/**
 * Adds an "Annotate image" button to the image balloon toolbar.
 * The button is enabled only when the selected image is a Trilium-hosted image
 * (note image or attachment). When clicked, fires the "annotateImage:open" event
 * on the editor with `{ src: string, element: ModelElement }`.
 *
 * The app side listens for this event via `editor.on("annotateImage:open", ...)`.
 */
export default class AnnotateImagePlugin extends Plugin {

    static get pluginName() {
        return "AnnotateImagePlugin" as const;
    }

    public init() {
        const editor = this.editor;

        editor.ui.componentFactory.add("annotateImage", (locale) => {
            const button = new ButtonView(locale);

            button.set({
                label: locale.t("Annotate image"),
                icon: pencilIcon,
                tooltip: true,
                isEnabled: false
            });

            const updateState = () => {
                const selected = editor.model.document.selection.getSelectedElement();
                if (!selected || !["imageBlock", "imageInline"].includes(selected.name)) {
                    button.isEnabled = false;
                    return;
                }
                const src = selected.getAttribute("src") as string | undefined;
                button.isEnabled = !!(src && (IMAGE_API_RE.test(src) || ATTACHMENT_API_RE.test(src)));
            };

            this.listenTo(editor.model.document.selection, "change:range", updateState);
            this.listenTo(editor.model.document, "change:data", updateState);

            this.listenTo(button, "execute", () => {
                const selected = editor.model.document.selection.getSelectedElement();
                if (!selected) return;
                const src = selected.getAttribute("src") as string | undefined;
                if (!src) return;

                // The app side handles this via editor.on("annotateImage:open", ...)
                (editor as any).fire("annotateImage:open", { src, element: selected });
            });

            return button;
        });
    }
}
