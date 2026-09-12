import { TRILIUM_SRC_ATTRIBUTE } from "@triliumnext/commons";
import { createImageTypeRegExp, ImageUpload, Plugin } from "ckeditor5";
import type { ViewDocumentClipboardInputEvent } from "ckeditor5";

/**
 * The parts of a clipboard `DataTransfer` this plugin reads. Kept structural so the rule below can
 * be exercised without building a real one.
 */
export interface ClipboardImageSource {
    getData(type: string): string;
    files: readonly (File | null)[];
}

/**
 * Elements that carry nothing of their own, so their presence does not stop an image from being the
 * only thing on the clipboard. Chrome routinely writes a `<meta charset>` ahead of the fragment.
 */
const WEIGHTLESS_TAGS = new Set(["META", "STYLE", "LINK", "SCRIPT", "TITLE"]);

/**
 * Makes an image copied from another application paste as the image itself rather than as a broken
 * link to it.
 *
 * Copying a picture in Slack, Google Chat or a browser puts two things on the clipboard: the decoded
 * bytes as a file, and an HTML fragment naming the picture by URL. CKEditor's `ImageUploadEditing`
 * prefers the HTML whenever any is present — deliberately, since a copy from Word carries a bitmap
 * of the selection that must not win over the text (ckeditor/ckeditor5-upload#68). But for a bare
 * image the HTML is the worse of the two: those URLs are usually private to the app that served
 * them (`files.slack.com` answers only to a Slack session cookie), so the note ends up pointing at
 * something neither the server nor the browser can fetch.
 *
 * So the file is preferred over the HTML in exactly one shape — the HTML is a single `<img>` and
 * nothing else, and the clipboard carries exactly one image file. Anything with text in it, or with
 * a second image, keeps the current behavior, which leaves the Word case untouched.
 *
 * A mixed selection of text and pictures carries no file at all — the browser only offers one when
 * the copy *is* a picture — so it cannot be rescued here. Those go on relying on the server
 * fetching the URL after the note is saved (see `image_download.ts`), which works whenever the URL
 * is reachable without the originating app's credentials.
 */
export default class ClipboardBareImage extends Plugin {

    static get requires() {
        return [ImageUpload] as const;
    }

    static get pluginName() {
        return "ClipboardBareImage" as const;
    }

    init() {
        const editor = this.editor;

        // `high`, to get in ahead of `ImageUploadEditing`'s own normal-priority listener — the one
        // that would otherwise hand the paste to the HTML path and never look at the file.
        this.listenTo<ViewDocumentClipboardInputEvent>(
            editor.editing.view.document,
            "clipboardInput",
            (evt, data) => {
                const file = bareImageFile(data.dataTransfer, editor.config.get("image.upload.types"));
                if (!file) {
                    return;
                }

                evt.stop();

                editor.model.change((writer) => {
                    if (data.targetRanges) {
                        writer.setSelection(data.targetRanges.map((range) => editor.editing.mapper.toModelRange(range)));
                    }

                    editor.execute("uploadImage", { file: [file] });
                });
            },
            { priority: "high" }
        );
    }
}

/**
 * The single image file to paste in place of the clipboard's HTML, or `null` to leave the paste
 * alone. See {@link ClipboardBareImage} for why the shape has to be this narrow.
 */
export function bareImageFile(dataTransfer: ClipboardImageSource, uploadTypes?: string[]): File | null {
    // With no HTML there is nothing to prefer the file over: `ImageUploadEditing` already uploads it.
    if (!dataTransfer.getData("text/html")) {
        return null;
    }

    const pattern = uploadTypes?.length ? createImageTypeRegExp(uploadTypes) : /^image\//;
    const files = dataTransfer.files.filter((file): file is File => !!file && pattern.test(file.type));

    // More than one and there is no telling which belongs to the image; none and there is nothing
    // to offer in the HTML's place.
    if (files.length !== 1) {
        return null;
    }

    return isBareImageHtml(dataTransfer.getData("text/html")) ? files[0] : null;
}

/**
 * Whether the clipboard HTML is one image and nothing besides — no text, no second element standing
 * beside it — and that image is one the editor could not resolve on its own.
 */
export function isBareImageHtml(html: string): boolean {
    const body = new DOMParser().parseFromString(html, "text/html").body;
    if (!body || body.textContent?.trim()) {
        return false;
    }

    const images = body.querySelectorAll("img");
    if (images.length !== 1) {
        return false;
    }

    const image = images[0];
    for (const element of body.querySelectorAll("*")) {
        // Everything else has to be either something wrapping the image or something weightless;
        // an element standing beside it means the clipboard held more than just a picture.
        if (element === image || element.contains(image) || WEIGHTLESS_TAGS.has(element.tagName)) {
            continue;
        }

        return false;
    }

    // An image the editor can already resolve is left to the normal path: Trilium's own marker means
    // this came from a Trilium copy, where the reference beside the payload is the point (see the
    // ClipboardImageEmbed plugin).
    if (image.hasAttribute(TRILIUM_SRC_ATTRIBUTE)) {
        return false;
    }

    const src = image.getAttribute("src") ?? "";

    // A `data:` URI carries its own bytes. A `blob:` one only resolves inside the document that
    // minted it: ours is fine, but another application's — Element Desktop copies its pictures as
    // `blob:vector://vector/…` — is dead the moment it leaves that renderer, which makes it exactly
    // the kind of unreachable source this plugin exists to replace.
    return !src.startsWith("data:") && !src.startsWith(`blob:${window.location.origin}/`);
}
