import { Essentials, Image, ImageBlock, ImageInline, Paragraph } from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import ImageEditingSource from "./image_editing_source.js";

const BLOCK_SRC = "api/images/blockNote/Block";
const INLINE_SRC = "api/images/inlineNote/Inline";
const CONTENT = `<figure class="image"><img src="${BLOCK_SRC}"></figure>`
    + `<p>x<img src="${INLINE_SRC}">y</p>`;

describe("ImageEditingSource", () => {
    async function createEditor(resolve?: (src: string) => string) {
        const plugins = [
            Essentials, Paragraph, Image, ImageBlock, ImageInline, ImageEditingSource
        ];
        const editor = await createTestEditor(plugins, { imageEditingSource: { resolve } });
        editor.setData(CONTENT);
        return editor;
    }

    function renderedSources(editor: Awaited<ReturnType<typeof createEditor>>) {
        const imgs = editor.editing.view.getDomRoot()?.querySelectorAll("img") ?? [];
        return [...imgs].map((img) => img.getAttribute("src"));
    }

    it("loads block and inline images from the resolved URL but saves the stored src", async () => {
        const editor = await createEditor((src) => `${src}?v=1`);

        expect(renderedSources(editor)).toEqual([`${BLOCK_SRC}?v=1`, `${INLINE_SRC}?v=1`]);
        expect(editor.getData()).toContain(`src="${BLOCK_SRC}"`);
        expect(editor.getData()).toContain(`src="${INLINE_SRC}"`);
        expect(editor.getData()).not.toContain("?v=1");
    });

    it("keeps the stored src without a resolver", async () => {
        const editor = await createEditor();

        expect(renderedSources(editor)).toEqual([BLOCK_SRC, INLINE_SRC]);
    });

    it("re-resolves the images on refresh without changing the data", async () => {
        let version = 1;
        const editor = await createEditor((src) => (
            src === BLOCK_SRC ? `${src}?v=${version}` : src
        ));
        const onDataChange = vi.fn();
        editor.model.document.on("change:data", onDataChange);

        version = 2;
        editor.plugins.get(ImageEditingSource).refresh();

        expect(renderedSources(editor)).toEqual([`${BLOCK_SRC}?v=2`, INLINE_SRC]);
        expect(onDataChange).not.toHaveBeenCalled();
        expect(editor.getData()).not.toContain("?v=");
    });

    it("refreshes images added later and drops the ones removed from the document", async () => {
        let version = 1;
        const resolve = vi.fn((src: string) => `${src}?v=${version}`);
        const editor = await createEditor(resolve);
        const plugin = editor.plugins.get(ImageEditingSource);

        editor.setData(`<figure class="image"><img src="${INLINE_SRC}"></figure>`);
        version = 2;
        resolve.mockClear();
        plugin.refresh();

        expect(renderedSources(editor)).toEqual([`${INLINE_SRC}?v=2`]);
        // The images of the replaced content are not resolved again.
        expect(resolve.mock.calls).toEqual([ [ INLINE_SRC ] ]);

        resolve.mockClear();
        plugin.refresh();
        expect(resolve.mock.calls).toEqual([ [ INLINE_SRC ] ]);
    });

    it("leaves an image without a src alone", async () => {
        const resolve = vi.fn((src: string) => `${src}?v=1`);
        const editor = await createEditor(resolve);
        const root = editor.model.document.getRoot();
        const image = root?.getChild(0);
        expect(image?.is("element", "imageBlock")).toBe(true);

        resolve.mockClear();
        editor.model.change((writer) => {
            if (image?.is("element")) {
                writer.removeAttribute("src", image);
            }
        });
        editor.plugins.get(ImageEditingSource).refresh();

        // Only the inline image, which keeps its src, is resolved again.
        expect(resolve.mock.calls).toEqual([ [ INLINE_SRC ] ]);
        expect(renderedSources(editor)).toEqual([ "", `${INLINE_SRC}?v=1` ]);
    });
});
