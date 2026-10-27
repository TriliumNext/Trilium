import { ButtonView, Command, ImageUtils, Plugin, type ModelElement } from "ckeditor5";
import bxsPen from "boxicons/svg/solid/bxs-pen.svg?raw";

import { MIN_EMBED_SIZE } from "./content_embed/content_embed.js";
import { SIZE_ATTRIBUTES } from "./resizable_widgets/resizable_widgets.js";

/**
 * Adds the `convertImageToDrawing` button to the image toolbar. The host attaches a drawing canvas
 * that shows the selected block image, which an editable, untitled Medium embed of it replaces, at
 * the size that the image is shown at.
 */
export default class ImageToDrawing extends Plugin {

    static get requires() {
        return [ ImageUtils ] as const;
    }

    static get pluginName() {
        return "ImageToDrawing" as const;
    }

    init() {
        const editor = this.editor;
        const t = editor.t;
        const command = new ConvertImageToDrawingCommand(editor);
        editor.commands.add("convertImageToDrawing", command);

        editor.ui.componentFactory.add("convertImageToDrawing", (locale) => {
            const button = new ButtonView(locale);
            button.set({
                label: t("Convert image to a drawing canvas"),
                icon: bxsPen,
                tooltip: true
            });
            button.bind("isEnabled").to(command);
            this.listenTo(button, "execute", () => {
                void editor.execute("convertImageToDrawing");
                // `ContentEmbed` focuses the new drawing only while the editor has the focus.
                editor.editing.view.focus();
            });
            return button;
        });
    }

}

/**
 * Replaces the selected block image with an embed of a drawing canvas that shows it. Resolves once
 * the embed is in place, or once the host fails to attach the drawing.
 */
export class ConvertImageToDrawingCommand extends Command {

    override refresh() {
        const model = this.editor.model;
        const image = this.getSelectedBlockImage();

        this.isEnabled = !!image && typeof image.getAttribute("src") === "string"
            && model.schema.checkChild(model.createPositionBefore(image), "contentEmbed");
    }

    override async execute() {
        const editor = this.editor;
        const image = this.getSelectedBlockImage();
        const src = image?.getAttribute("src");
        /* v8 ignore next -- `refresh()` disables the command without a block image with a src. */
        if (!image || typeof src !== "string") return;

        const size = this.getShownSize(image);
        this.forceDisabled(CONVERTING);
        let attachmentId: string | null | undefined;
        try {
            attachmentId = await editor.config.get("imageToDrawing")?.convert?.(src);
        } finally {
            this.clearForceDisabled(CONVERTING);
        }
        if (!attachmentId || !isInDocument(image)) return;

        editor.config.get("contentEmbed")?.focusAttachment?.(attachmentId);
        // CKEditor's renderer draws a figure that replaces another in the same render twice, so
        // the embed goes in and the image out in two changes, of one batch for a single undo.
        const model = editor.model;
        const { embed, batch } = model.change((writer) => {
            const embed = writer.createElement("contentEmbed", {
                attachmentId,
                boxSize: "medium",
                hideTitle: true,
                editable: true,
                ...size
            });
            const caption = getCaption(image);
            if (caption && !caption.isEmpty) {
                writer.append(writer.cloneElement(caption), embed);
            }
            writer.insert(embed, writer.createPositionAfter(image));
            return { embed, batch: writer.batch };
        });
        model.enqueueChange(batch, (writer) => {
            writer.remove(image);
            writer.setSelection(embed, "on");
        });
    }

    /** The size that `image` is shown at, as the size attributes of an embed. */
    private getShownSize(image: ModelElement): Record<string, string> {
        const editing = this.editor.editing;
        const viewElement = editing.mapper.toViewElement(image);
        const figure = viewElement && editing.view.domConverter.mapViewToDom(viewElement);
        /* v8 ignore next -- the editing view renders the selected image as a `<figure>`. */
        if (!(figure instanceof HTMLElement)) return {};

        const rect = figure.querySelector("img")?.getBoundingClientRect();
        if (!rect?.width || !rect.height) return {};

        const em = parseFloat(getComputedStyle(figure).fontSize);
        return {
            [SIZE_ATTRIBUTES.width]: toEm(rect.width / em, MIN_EMBED_SIZE.width),
            [SIZE_ATTRIBUTES.height]: toEm(rect.height / em, MIN_EMBED_SIZE.height)
        };
    }

    private getSelectedBlockImage() {
        const selection = this.editor.model.document.selection;
        const image = this.editor.plugins.get(ImageUtils).getClosestSelectedImageElement(selection);
        return image?.is("element", "imageBlock") ? image : null;
    }

}

const CONVERTING = "converting";

function getCaption(image: ModelElement) {
    return [ ...image.getChildren() ].find((child) => child.is("element", "caption"));
}

/** `value` in `em`, rounded to hundredths and no less than `min`. */
function toEm(value: number, min: number) {
    return `${Math.max(Math.round(value * 100) / 100, min)}em`;
}

/** Whether `element` is still in the document, rather than removed while the host worked. */
function isInDocument(element: ModelElement) {
    const root = element.root;
    return root.is("rootElement") && root.rootName !== "$graveyard";
}

declare module "ckeditor5" {
    interface EditorConfig {
        imageToDrawing?: {
            /**
             * Attaches a drawing canvas that shows the image at `src`, and answers with the ID of
             * its attachment, or `null` when that fails.
             */
            convert?(src: string): Promise<string | null>;
        };
    }
}
