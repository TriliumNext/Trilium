import { ClassicEditor, ClipboardPipeline, Essentials, FileRepository, Image, ImageBlock, ImageInline, ImageUpload, Paragraph } from "ckeditor5";
import type { ViewDocumentFragment } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import ClipboardImageEmbed, { embedClipboardImageReferences, restoreClipboardImageReferences, TRILIUM_SRC_ATTRIBUTE } from "./clipboard_image_embed.js";

/** A representative internal image reference and the data: URI a resolver would hand back. */
const REFERENCE = "api/images/noteId123/photo.png";
const DATA_URI = "data:image/png;base64,AAAA";

/** A minimal stand-in for the view DataTransfer that records what the serializer writes to it. */
function recordingDataTransfer() {
    const store: Record<string, string> = {};
    return {
        store,
        setData: (type: string, data: string) => { store[type] = data; },
        getData: (type: string) => store[type] ?? ""
    };
}

describe("ClipboardImageEmbed", () => {

    // --- The pure view-fragment transforms (the business logic). ---

    describe("embedClipboardImageReferences", () => {
        let editor: ClassicEditor;

        beforeEach(async () => {
            editor = await createTestEditor([Essentials, Paragraph]);
        });

        function embed(html: string, embedImage: (src: string) => string | null): string {
            const fragment = editor.data.processor.toView(html) as ViewDocumentFragment;
            embedClipboardImageReferences(editor.editing.view, fragment, embedImage);
            return editor.data.processor.toData(fragment);
        }

        it("rewrites an internal image to a data: URI and stashes the original reference", () => {
            const result = embed(`<img src="${REFERENCE}">`, () => DATA_URI);

            expect(result).toContain(`src="${DATA_URI}"`);
            expect(result).toContain(`${TRILIUM_SRC_ATTRIBUTE}="${REFERENCE}"`);
        });

        it("leaves an image untouched when the resolver declines it (returns null)", () => {
            const result = embed(`<img src="https://example.com/x.png">`, () => null);

            expect(result).toContain(`src="https://example.com/x.png"`);
            expect(result).not.toContain(TRILIUM_SRC_ATTRIBUTE);
        });

        it("is idempotent: an already-embedded image is not re-encoded", () => {
            const embedImage = vi.fn(() => DATA_URI);

            const result = embed(`<img src="${DATA_URI}" ${TRILIUM_SRC_ATTRIBUTE}="${REFERENCE}">`, embedImage);

            expect(embedImage).not.toHaveBeenCalled();
            expect(result).toContain(`${TRILIUM_SRC_ATTRIBUTE}="${REFERENCE}"`);
        });

        it("skips an image without a src attribute", () => {
            const embedImage = vi.fn(() => DATA_URI);

            const result = embed(`<img alt="no source">`, embedImage);

            expect(embedImage).not.toHaveBeenCalled();
            expect(result).not.toContain(TRILIUM_SRC_ATTRIBUTE);
        });

        it("embeds only the images the resolver accepts within a mixed fragment", () => {
            const embedImage = (src: string) => (src === REFERENCE ? DATA_URI : null);

            const result = embed(`<p>text</p><img src="${REFERENCE}"><img src="https://ext/y.png">`, embedImage);

            expect(result).toContain(`src="${DATA_URI}"`);
            expect(result).toContain(`${TRILIUM_SRC_ATTRIBUTE}="${REFERENCE}"`);
            expect(result).toContain(`src="https://ext/y.png"`);
        });

        it("does nothing (and never calls the resolver) for a fragment with no images", () => {
            const embedImage = vi.fn(() => DATA_URI);

            const result = embed(`<p>just text</p>`, embedImage);

            expect(embedImage).not.toHaveBeenCalled();
            expect(result).toBe(`<p>just text</p>`);
        });
    });

    describe("restoreClipboardImageReferences", () => {
        let editor: ClassicEditor;

        beforeEach(async () => {
            editor = await createTestEditor([Essentials, Paragraph]);
        });

        function restore(html: string): string {
            const fragment = editor.data.processor.toView(html) as ViewDocumentFragment;
            restoreClipboardImageReferences(editor.editing.view, fragment);
            return editor.data.processor.toData(fragment);
        }

        it("restores the src from the marker and drops the marker attribute", () => {
            const result = restore(`<img src="${DATA_URI}" ${TRILIUM_SRC_ATTRIBUTE}="${REFERENCE}">`);

            expect(result).toContain(`src="${REFERENCE}"`);
            expect(result).not.toContain(TRILIUM_SRC_ATTRIBUTE);
            expect(result).not.toContain("data:image");
        });

        it("leaves an image without the marker untouched", () => {
            const result = restore(`<img src="${DATA_URI}">`);

            expect(result).toContain(`src="${DATA_URI}"`);
        });

        it("is the inverse of embedding (round-trips back to the original reference)", () => {
            const embedded = (() => {
                const fragment = editor.data.processor.toView(`<img src="${REFERENCE}">`) as ViewDocumentFragment;
                embedClipboardImageReferences(editor.editing.view, fragment, () => DATA_URI);
                return editor.data.processor.toData(fragment);
            })();

            expect(restore(embedded)).toContain(`src="${REFERENCE}"`);
            expect(restore(embedded)).not.toContain(TRILIUM_SRC_ATTRIBUTE);
        });
    });

    // --- The plugin wiring: that the transforms run on the real clipboard pipeline events. ---

    describe("plugin", () => {
        it("registers under its name and requires the clipboard pipeline", async () => {
            const editor = await createTestEditor([Essentials, Paragraph, ClipboardImageEmbed]);

            expect(editor.plugins.get(ClipboardImageEmbed)).toBeInstanceOf(ClipboardImageEmbed);
            expect(ClipboardImageEmbed.pluginName).toBe("ClipboardImageEmbed");
            expect(ClipboardImageEmbed.requires).toContain(ClipboardPipeline);
        });

        describe("on copy (clipboardOutput)", () => {
            async function copy(html: string, clipboardImageEmbed?: Record<string, unknown>): Promise<string> {
                const editor = await createTestEditor(
                    [Essentials, Paragraph, Image, ImageBlock, ImageInline, ClipboardImageEmbed],
                    clipboardImageEmbed ? { clipboardImageEmbed } : {}
                );
                const dataTransfer = recordingDataTransfer();
                const content = editor.data.processor.toView(html) as ViewDocumentFragment;

                editor.editing.view.document.fire("clipboardOutput", { dataTransfer, content, method: "copy" });

                return dataTransfer.getData("text/html");
            }

            it("embeds internal images in the serialized clipboard HTML", async () => {
                const html = await copy(`<figure class="image"><img src="${REFERENCE}"></figure>`, {
                    enabled: true,
                    embedImage: () => DATA_URI
                });

                expect(html).toContain(`src="${DATA_URI}"`);
                expect(html).toContain(`${TRILIUM_SRC_ATTRIBUTE}="${REFERENCE}"`);
            });

            it("does not embed when the kill-switch option is disabled", async () => {
                const html = await copy(`<figure class="image"><img src="${REFERENCE}"></figure>`, {
                    enabled: false,
                    embedImage: () => DATA_URI
                });

                expect(html).toContain(`src="${REFERENCE}"`);
                expect(html).not.toContain(TRILIUM_SRC_ATTRIBUTE);
            });

            it("does not embed when no resolver is configured", async () => {
                const html = await copy(`<figure class="image"><img src="${REFERENCE}"></figure>`, { enabled: true });

                expect(html).toContain(`src="${REFERENCE}"`);
                expect(html).not.toContain(TRILIUM_SRC_ATTRIBUTE);
            });

            it("does not embed when the feature is not configured at all", async () => {
                const html = await copy(`<figure class="image"><img src="${REFERENCE}"></figure>`);

                expect(html).toContain(`src="${REFERENCE}"`);
                expect(html).not.toContain(TRILIUM_SRC_ATTRIBUTE);
            });
        });

        describe("on paste (inputTransformation)", () => {
            let editor: ClassicEditor;
            let fileRepository: FileRepository;
            let createLoader: ReturnType<typeof vi.spyOn>;

            beforeEach(async () => {
                editor = await createTestEditor([Essentials, Paragraph, Image, ImageBlock, ImageInline, ImageUpload, ClipboardImageEmbed]);
                fileRepository = editor.plugins.get(FileRepository);
                // Spy on loader creation: ImageUploadEditing calls it for every "local" (data:/blob:)
                // image it decides to upload, so it is the precise signal for "an upload was attempted".
                createLoader = vi.spyOn(fileRepository, "createLoader");
                editor.setData("<p>start</p>");
            });

            function paste(html: string) {
                const content = editor.data.processor.toView(html) as ViewDocumentFragment;
                editor.plugins.get(ClipboardPipeline).fire("inputTransformation", {
                    content,
                    dataTransfer: recordingDataTransfer(),
                    method: "paste"
                });
            }

            it("restores the reference and never uploads the embedded copy", () => {
                paste(`<img src="${DATA_URI}" ${TRILIUM_SRC_ATTRIBUTE}="${REFERENCE}">`);

                expect(createLoader).not.toHaveBeenCalled();
                const data = editor.getData();
                expect(data).toContain(REFERENCE);
                expect(data).not.toContain("data:image");
            });

            it("still uploads a genuine external data: image (no marker), so normal paste is unaffected", () => {
                paste(`<img src="${DATA_URI}">`);

                // ImageUploadEditing's upload path is live; only our marked embeds are diverted.
                expect(createLoader).toHaveBeenCalled();
            });
        });
    });
});
