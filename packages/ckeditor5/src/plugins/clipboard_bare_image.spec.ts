import { TRILIUM_SRC_ATTRIBUTE } from "@triliumnext/commons";
import { ClassicEditor, Essentials, FileRepository, Image, ImageBlock, ImageInline, ImageUpload, Paragraph } from "ckeditor5";
import type { ViewRange } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import ClipboardBareImage, { bareImageFile, isBareImageHtml } from "./clipboard_bare_image.js";

/** What Slack puts on the clipboard for a copied picture: a private URL and nothing else. */
const SLACK_HTML = `<html>
<body>
<!--StartFragment--><img src="https://files.slack.com/files-pri/T017YV03N2V-F08N4H06R8B/image.png" alt="image.png"/><!--EndFragment-->
</body>
</html>`;

/** A mixed selection — text, a mention and a picture — which carries no file to fall back on. */
const GOOGLE_CHAT_HTML = `<html>
<body>
<!--StartFragment--><span><div><span data-name="Elian Doran"><a role="button"><span>@</span><span>Elian Doran</span></a></span>, eu cred ca ceva s-a stricat<br></div><div><div><img src="https://chat.google.com/u/0/api/get_attachment_url?url_type=FIFE_URL&amp;attachment_token=AOo0EEWKpJnS5oUz"></div></div><div>Inainte de merge cu develop aveam ~7 issues<br></div></span><!--EndFragment-->
</body>
</html>`;

function imageFile(name = "image.png", type = "image/png") {
    return new File(["bytes"], name, { type });
}

/**
 * A stand-in for the clipboard `DataTransfer`, carrying whatever flavors a test needs. `types` is
 * here for the sake of upstream's own listener, which reads it whenever this plugin declines and
 * lets the event through.
 */
function clipboard(html: string, files: File[] = []) {
    return {
        types: [...(html ? ["text/html"] : []), ...(files.length ? ["Files"] : [])],
        getData: (type: string) => (type === "text/html" ? html : ""),
        files
    };
}

describe("ClipboardBareImage", () => {

    // --- The rule itself: is the clipboard HTML one picture and nothing else? ---

    describe("isBareImageHtml", () => {
        it("accepts a lone image, however the source wrapped it", () => {
            expect(isBareImageHtml(SLACK_HTML)).toBe(true);
            expect(isBareImageHtml(`<img src="https://ext/a.png">`)).toBe(true);
            // Wrappers are fine — they hold nothing but the image itself.
            expect(isBareImageHtml(`<div><span><img src="https://ext/a.png"></span></div>`)).toBe(true);
            // Chrome writes a charset ahead of the fragment; it carries nothing.
            expect(isBareImageHtml(`<meta charset="utf-8"><img src="https://ext/a.png">`)).toBe(true);
        });

        it("refuses anything carrying text, which is what keeps a Word paste intact", () => {
            // ckeditor/ckeditor5#2830: preferring the clipboard bitmap here would drop the text.
            expect(isBareImageHtml(`<p>see this <img src="https://ext/a.png"></p>`)).toBe(false);
            expect(isBareImageHtml(GOOGLE_CHAT_HTML)).toBe(false);
        });

        it("refuses a fragment that is not exactly one image", () => {
            expect(isBareImageHtml(`<img src="https://ext/a.png"><img src="https://ext/b.png">`)).toBe(false);
            expect(isBareImageHtml(`<p>no pictures at all</p>`)).toBe(false);
            // A sibling element carrying no text is still something more than the picture.
            expect(isBareImageHtml(`<img src="https://ext/a.png"><hr>`)).toBe(false);
        });

        it("leaves images the editor can already resolve to the normal paste path", () => {
            // Self-contained bytes: nothing to gain by preferring the file.
            expect(isBareImageHtml(`<img src="data:image/png;base64,AAAA">`)).toBe(false);
            expect(isBareImageHtml(`<img src="blob:http://localhost/abc">`)).toBe(false);
            // Copied out of Trilium, where the reference beside the payload is the whole point.
            expect(isBareImageHtml(`<img src="data:image/png;base64,AAAA" ${TRILIUM_SRC_ATTRIBUTE}="api/images/n1/p.png">`)).toBe(false);
        });

        it("accepts an image with no src at all, since the file is then the only thing to go on", () => {
            expect(isBareImageHtml(`<img alt="no source">`)).toBe(true);
        });
    });

    describe("bareImageFile", () => {
        it("offers the file that stands in for a bare image", () => {
            const file = imageFile();

            expect(bareImageFile(clipboard(SLACK_HTML, [file]))).toBe(file);
        });

        it("declines when there is no HTML, which upstream already handles", () => {
            expect(bareImageFile(clipboard("", [imageFile()]))).toBeNull();
        });

        it("declines unless exactly one image file is on offer", () => {
            expect(bareImageFile(clipboard(SLACK_HTML, []))).toBeNull();
            // Two files and there is no telling which one the image stands for.
            expect(bareImageFile(clipboard(SLACK_HTML, [imageFile("a.png"), imageFile("b.png")]))).toBeNull();
            // A non-image file is not a candidate at all.
            expect(bareImageFile(clipboard(SLACK_HTML, [new File(["x"], "notes.txt", { type: "text/plain" })]))).toBeNull();
        });

        it("honours the editor's configured upload types", () => {
            const webp = imageFile("a.webp", "image/webp");

            expect(bareImageFile(clipboard(SLACK_HTML, [webp]), ["png", "jpeg"])).toBeNull();
            expect(bareImageFile(clipboard(SLACK_HTML, [webp]), ["png", "webp"])).toBe(webp);
        });

        it("declines when the HTML is more than a picture, even with a file present", () => {
            expect(bareImageFile(clipboard(GOOGLE_CHAT_HTML, [imageFile()]))).toBeNull();
        });
    });

    // --- The wiring: that the rule actually diverts the paste. ---

    describe("plugin", () => {
        let editor: ClassicEditor;
        let createLoader: ReturnType<typeof vi.spyOn>;

        beforeEach(async () => {
            editor = await createTestEditor([Essentials, Paragraph, Image, ImageBlock, ImageInline, ImageUpload, ClipboardBareImage]);
            // Loader creation is what an upload attempt looks like from the outside.
            createLoader = vi.spyOn(editor.plugins.get(FileRepository), "createLoader");
            editor.setData("<p>start</p>");
        });

        function paste(html: string, files: File[], targetRanges?: ViewRange[]) {
            const reachedRestOfPipeline = vi.fn();
            // Registered after the plugin's own `high`-priority listener, so it stands in for
            // everything downstream: reached only when the plugin declined the paste. Stopping here
            // keeps the real clipboard pipeline — which a stubbed DataTransfer cannot satisfy — out
            // of the test, while still telling us which way the decision went.
            editor.editing.view.document.on("clipboardInput", (evt) => {
                reachedRestOfPipeline();
                evt.stop();
            }, { priority: "high" });

            editor.editing.view.document.fire("clipboardInput", { dataTransfer: clipboard(html, files), method: "paste", targetRanges });

            return { reachedRestOfPipeline };
        }

        it("registers under its name and requires image upload", () => {
            expect(editor.plugins.get(ClipboardBareImage)).toBeInstanceOf(ClipboardBareImage);
            expect(ClipboardBareImage.pluginName).toBe("ClipboardBareImage");
            expect(ClipboardBareImage.requires).toContain(ImageUpload);
        });

        it("uploads the clipboard file when the HTML is a bare image, and takes the paste over", () => {
            const file = imageFile();

            const { reachedRestOfPipeline } = paste(SLACK_HTML, [file]);

            expect(createLoader).toHaveBeenCalledTimes(1);
            expect(createLoader).toHaveBeenCalledWith(file);
            // The HTML — and its unreachable URL — never gets inserted.
            expect(reachedRestOfPipeline).not.toHaveBeenCalled();
        });

        it("drops the image where the paste landed rather than where the caret was", () => {
            // A real paste always names its target ranges — a drop lands wherever it was released,
            // and even a keyboard paste carries the ranges — so this is the ordinary path.
            editor.setData("<p>before</p><p>after</p>");
            const target = editor.model.document.getRoot()?.getChild(1);
            const viewRange = editor.editing.mapper.toViewRange(editor.model.createRangeIn(target as never));

            paste(SLACK_HTML, [imageFile()], [viewRange]);

            expect(createLoader).toHaveBeenCalledTimes(1);
            expect(editor.model.document.selection.getFirstPosition()?.parent).toBe(target);
        });

        it("keeps out of a paste whose HTML carries more than the picture", () => {
            const { reachedRestOfPipeline } = paste(GOOGLE_CHAT_HTML, [imageFile()]);

            expect(createLoader).not.toHaveBeenCalled();
            expect(reachedRestOfPipeline).toHaveBeenCalled();
        });

        it("keeps out of a paste with no file to substitute", () => {
            const { reachedRestOfPipeline } = paste(SLACK_HTML, []);

            expect(createLoader).not.toHaveBeenCalled();
            expect(reachedRestOfPipeline).toHaveBeenCalled();
        });
    });
});
