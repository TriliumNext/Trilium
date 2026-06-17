import { ClipboardPipeline, Plugin, UpcastWriter } from "ckeditor5";
import type { ClipboardInputTransformationData, ClipboardInputTransformationEvent, EditingView, ViewDocumentClipboardOutputEvent, ViewDocumentClipboardOutputEventData, ViewDocumentFragment, ViewElement } from "ckeditor5";

/**
 * View attribute that carries the original internal image reference (e.g.
 * `api/images/<noteId>/...`) next to the embedded `data:` URI on the clipboard. External
 * applications read the `src` (the self-contained data URI); Trilium's own paste handler reads
 * this attribute to restore the reference, so an internal copy/paste never duplicates the image.
 */
export const TRILIUM_SRC_ATTRIBUTE = "data-trilium-src";

/**
 * Configuration injected by the host application (see the editor's `clipboardImageEmbed` config).
 *
 * `embedImage` is given an image `src` and returns a self-contained `data:` URI to embed, or
 * `null` to leave the image untouched (non-internal images, images not yet loaded, or ones over a
 * size cap). The DOM/canvas work lives in the client so this plugin stays platform-agnostic and
 * unit-testable with a stub resolver.
 */
export interface ClipboardImageEmbedConfig {
    enabled?: boolean;
    embedImage?: (src: string) => string | null;
}

/**
 * Makes copying (or dragging out) note content paste correctly into EXTERNAL applications — email
 * clients, word processors — by embedding internal images as `data:` URIs on the clipboard, while
 * keeping internal Trilium→Trilium paste reference-based so no duplicate images are created.
 *
 * - On copy/cut/drag-out (`clipboardOutput`, before the default serializer) each internal image's
 *   `src` is rewritten to a `data:` URI, with the original reference stashed in
 *   {@link TRILIUM_SRC_ATTRIBUTE} (see {@link embedClipboardImageReferences}).
 * - On paste/drop (`inputTransformation`, before CKEditor's `ImageUploadEditing` would upload the
 *   `data:` URI as a brand-new attachment) the reference is restored from that attribute, so the
 *   embedded copy is dropped and the note keeps pointing at the original image (see
 *   {@link restoreClipboardImageReferences}).
 */
export default class ClipboardImageEmbed extends Plugin {

    static get requires() {
        return [ClipboardPipeline] as const;
    }

    static get pluginName() {
        return "ClipboardImageEmbed" as const;
    }

    init() {
        const editor = this.editor;

        // Embed internal images as data: URIs on the way out (copy / cut / drag-out). Runs before
        // the default `low`-priority serializer so the serialized clipboard HTML carries the URIs.
        this.listenTo<ViewDocumentClipboardOutputEvent>(
            editor.editing.view.document,
            "clipboardOutput",
            (_evt, data) => this._embedImages(data),
            { priority: "high" }
        );

        // Restore references on the way in (paste / drop), before `ImageUploadEditing`'s
        // normal-priority `inputTransformation` listener would otherwise upload the data: URI.
        this.listenTo<ClipboardInputTransformationEvent>(
            editor.plugins.get(ClipboardPipeline),
            "inputTransformation",
            (_evt, data) => this._restoreImages(data),
            { priority: "high" }
        );
    }

    private _embedImages(data: ViewDocumentClipboardOutputEventData) {
        const config = this.editor.config.get("clipboardImageEmbed") as ClipboardImageEmbedConfig | undefined;
        if (!config?.enabled || !config.embedImage) {
            return;
        }

        embedClipboardImageReferences(this.editor.editing.view, data.content, config.embedImage);
    }

    private _restoreImages(data: ClipboardInputTransformationData) {
        restoreClipboardImageReferences(this.editor.editing.view, data.content);
    }
}

/**
 * Rewrite each internal image in a clipboard view fragment to a self-contained `data:` URI,
 * stashing the original reference in {@link TRILIUM_SRC_ATTRIBUTE}. Images that `embedImage`
 * declines (returns `null`), images without a `src`, and images that are already embedded are
 * left untouched, so the pass is idempotent.
 */
export function embedClipboardImageReferences(view: EditingView, fragment: ViewDocumentFragment, embedImage: (src: string) => string | null) {
    forEachImage(view, fragment, (writer, image) => {
        const src = image.getAttribute("src");
        if (typeof src !== "string" || image.hasAttribute(TRILIUM_SRC_ATTRIBUTE)) {
            return;
        }

        const dataUri = embedImage(src);
        if (!dataUri) {
            return;
        }

        writer.setAttribute("src", dataUri, image);
        writer.setAttribute(TRILIUM_SRC_ATTRIBUTE, src, image);
    });
}

/**
 * Inverse of {@link embedClipboardImageReferences}: for every image carrying a
 * {@link TRILIUM_SRC_ATTRIBUTE}, restore its `src` to that internal reference and drop the
 * attribute (and the embedded `data:` URI with it). Images without the marker are left untouched.
 */
export function restoreClipboardImageReferences(view: EditingView, fragment: ViewDocumentFragment) {
    forEachImage(view, fragment, (writer, image) => {
        const reference = image.getAttribute(TRILIUM_SRC_ATTRIBUTE);
        if (typeof reference !== "string") {
            return;
        }

        writer.setAttribute("src", reference, image);
        writer.removeAttribute(TRILIUM_SRC_ATTRIBUTE, image);
    });
}

/** Invoke `callback` for each `<img>` in the fragment, sharing a single upcast writer. */
function forEachImage(view: EditingView, fragment: ViewDocumentFragment, callback: (writer: UpcastWriter, image: ViewElement) => void) {
    const images: ViewElement[] = [];
    for (const { item } of view.createRangeIn(fragment)) {
        if (item.is("element", "img")) {
            images.push(item);
        }
    }
    if (!images.length) {
        return;
    }

    const writer = new UpcastWriter(view.document);
    for (const image of images) {
        callback(writer, image);
    }
}
