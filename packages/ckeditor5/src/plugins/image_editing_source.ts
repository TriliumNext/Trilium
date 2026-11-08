import {
    type DowncastAttributeEvent,
    ImageUtils,
    type ModelElement,
    Plugin,
    type ViewElement
} from "ckeditor5";

/**
 * Configuration injected by the host application (see the editor's `imageEditingSource` config).
 *
 * `resolve` is given the `src` an image stores and returns the URL the editing view loads it from.
 */
export interface ImageEditingSourceConfig {
    resolve?: (src: string) => string;
}

/**
 * Loads each image of the editing view from the URL that the `imageEditingSource.resolve` config
 * returns, while the model and `editor.getData()` keep the stored `src`. Trilium adds the version
 * of a note's image to its URL, so the browser fetches the image again once the note changes
 * instead of reusing the copy it already holds for that URL.
 */
export default class ImageEditingSource extends Plugin {

    static get requires() {
        return [ImageUtils] as const;
    }

    static get pluginName() {
        return "ImageEditingSource" as const;
    }

    /** The images the editing downcast rendered. `refresh()` drops those that left the document. */
    private readonly _images = new Set<ModelElement>();

    init() {
        const editor = this.editor;

        editor.conversion.for("editingDowncast").add((dispatcher) => {
            for (const imageType of ["imageBlock", "imageInline"]) {
                // Runs after the converter of `ImageEditing`, which writes the stored `src`.
                dispatcher.on<DowncastAttributeEvent<ModelElement>>(
                    `attribute:src:${imageType}`,
                    (_evt, data, conversionApi) => {
                        const src = data.attributeNewValue;
                        const img = this._findViewImg(data.item);
                        if (typeof src !== "string" || !img) {
                            return;
                        }

                        this._images.add(data.item);
                        conversionApi.writer.setAttribute("src", this._resolve(src), img);
                    },
                    { priority: "low" }
                );
            }
        });
    }

    /**
     * Points every image of the editing view at the URL `resolve` returns for it now. It visits the
     * images the converter rendered rather than the whole document, and changes the view only, so
     * the document does not fire `change:data` and the note is not saved again.
     */
    refresh() {
        const editor = this.editor;
        const graveyard = editor.model.document.graveyard;
        const updates: { img: ViewElement; url: string }[] = [];

        for (const image of this._images) {
            if (!image.isAttached() || image.root === graveyard) {
                this._images.delete(image);
                continue;
            }

            const src = image.getAttribute("src");
            const img = this._findViewImg(image);
            if (typeof src !== "string" || !img) {
                continue;
            }

            const url = this._resolve(src);
            if (img.getAttribute("src") !== url) {
                updates.push({ img, url });
            }
        }

        if (!updates.length) {
            return;
        }

        editor.editing.view.change((writer) => {
            for (const { img, url } of updates) {
                writer.setAttribute("src", url, img);
            }
        });
    }

    private _resolve(src: string) {
        const config = this.editor.config.get("imageEditingSource") as
            ImageEditingSourceConfig | undefined;
        return config?.resolve?.(src) ?? src;
    }

    /** The `<img>` of an image block's `<figure>` or of an inline image's wrapper. */
    private _findViewImg(image: ModelElement) {
        const viewElement = this.editor.editing.mapper.toViewElement(image);
        /* v8 ignore next -- `ImageEditing` maps every attached image to a view element before
           its `src` is converted, and `refresh()` skips the images that left the document. */
        if (!viewElement) {
            return undefined;
        }

        return this.editor.plugins.get(ImageUtils).findViewImgElement(viewElement);
    }

}

declare module "ckeditor5" {
    interface PluginsMap {
        [ImageEditingSource.pluginName]: ImageEditingSource;
    }
}
