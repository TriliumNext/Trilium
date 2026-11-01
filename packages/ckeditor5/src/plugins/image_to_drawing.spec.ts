import {
    ButtonView,
    Essentials,
    Image,
    ImageBlock,
    ImageCaption,
    ImageInline,
    Paragraph,
    _getModelData as getModelData,
    _setModelData as setModelData,
    type ClassicEditor
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import ContentEmbed from "./content_embed/content_embed.js";
import ImageToDrawing from "./image_to_drawing.js";

const SRC = "api/attachments/i1/image/a.png";
const IMAGE = `<imageBlock src="${SRC}"></imageBlock>`;
const CAPTIONED_IMAGE = `<imageBlock src="${SRC}"><caption>Sketch</caption></imageBlock>`;
const EMBED = "<contentEmbed attachmentId=\"d1\" boxSize=\"medium\" editable=\"true\""
    + " hideTitle=\"true\">";

describe("ImageToDrawing", () => {
    let editor: ClassicEditor;
    let calls: string[];
    let convertImageToDrawing: ReturnType<typeof vi.fn<(src: string) => Promise<string | null>>>;

    beforeEach(async () => {
        calls = [];
        convertImageToDrawing = vi.fn(async (src: string) => {
            calls.push(`convert ${src}`);
            return "d1";
        });
        editor = await createTestEditor([
            Essentials, Paragraph, Image, ImageBlock, ImageInline, ImageCaption, ContentEmbed,
            ImageToDrawing
        ], {
            imageToDrawing: { convert: convertImageToDrawing },
            contentEmbed: {
                focusAttachment: (id: string) => calls.push(`focus ${id}`),
                loadAttachment: (id: string) => calls.push(`load ${id}`)
            }
        });
    });

    /** Holds the next conversion until the returned function finishes it with an attachment ID. */
    function holdConversion() {
        let finish: (id: string | null) => void = () => undefined;
        convertImageToDrawing.mockImplementationOnce(() => new Promise((resolve) => {
            finish = resolve;
        }));
        return (id: string | null) => finish(id);
    }

    it("replaces a block image with an editable, untitled Medium embed in one step", async () => {
        setModelData(editor.model, `<paragraph>a</paragraph>[${CAPTIONED_IMAGE}]`);

        await editor.execute("convertImageToDrawing");

        expect(getModelData(editor.model)).toBe(
            `<paragraph>a</paragraph>[${EMBED}<caption>Sketch</caption></contentEmbed>]`
        );
        expect(calls).toEqual([ `convert ${SRC}`, "focus d1", "load d1" ]);

        editor.execute("undo");
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(`<paragraph>a</paragraph>${CAPTIONED_IMAGE}`);
    });

    it("gives the embed the size that the image is shown at, from the least size up", async () => {
        const root = editor.editing.view.getDomRoot();
        if (root) root.style.fontSize = "10px";
        const imageOf = (width: number, height: number) =>
            `[<imageBlock src="${SRC}" width="${width}" height="${height}"></imageBlock>]`;
        const embedOf = (width: string, height: string) => "<contentEmbed attachmentId=\"d1\""
            + ` boxSize="medium" customHeight="${height}" customWidth="${width}" editable="true"`
            + " hideTitle=\"true\"></contentEmbed>";

        setModelData(editor.model, imageOf(300, 150));
        await editor.execute("convertImageToDrawing");
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(embedOf("30em", "15em"));

        setModelData(editor.model, imageOf(40, 20));
        await editor.execute("convertImageToDrawing");
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(embedOf("10em", "3em"));
    });

    it("leaves an empty caption behind", async () => {
        setModelData(editor.model, `[<imageBlock src="${SRC}"><caption></caption></imageBlock>]`);

        await editor.execute("convertImageToDrawing");

        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(`${EMBED}</contentEmbed>`);
    });

    it("is enabled for a selected block image only, and not while it converts one", async () => {
        const command = editor.commands.get("convertImageToDrawing");

        setModelData(editor.model, "<paragraph>[]a</paragraph>");
        expect(command?.isEnabled).toBe(false);

        setModelData(editor.model,
            `<paragraph>a[<imageInline src="${SRC}"></imageInline>]</paragraph>`);
        expect(command?.isEnabled).toBe(false);

        setModelData(editor.model, `[${IMAGE}]`);
        expect(command?.isEnabled).toBe(true);

        const finish = holdConversion();
        const conversion = editor.execute("convertImageToDrawing");
        expect(command?.isEnabled).toBe(false);

        finish(null);
        await conversion;
        expect(command?.isEnabled).toBe(true);
    });

    it("keeps the image when the host fails, and inserts nothing once it is gone", async () => {
        setModelData(editor.model, `<paragraph>a</paragraph>[${IMAGE}]`);
        convertImageToDrawing.mockResolvedValueOnce(null);
        await editor.execute("convertImageToDrawing");
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(`<paragraph>a</paragraph>${IMAGE}`);

        editor.config.set("imageToDrawing", { convert: undefined });
        await editor.execute("convertImageToDrawing");
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(`<paragraph>a</paragraph>${IMAGE}`);
        editor.config.set("imageToDrawing", { convert: convertImageToDrawing });

        const finish = holdConversion();
        const conversion = editor.execute("convertImageToDrawing");
        editor.model.change((writer) => {
            const image = editor.model.document.getRoot()?.getChild(1);
            if (image) writer.remove(image);
        });
        finish("d1");
        await conversion;

        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe("<paragraph>a</paragraph>");
        expect(calls).not.toContain("focus d1");
    });

    it("adds a button that runs the command and returns the focus to the editor", async () => {
        const button = editor.ui.componentFactory.create("convertImageToDrawing") as ButtonView;
        const focus = vi.spyOn(editor.editing.view, "focus");
        expect(button.label).toBe("Convert image to a drawing canvas");
        expect(button.isEnabled).toBe(false);

        setModelData(editor.model, `[${IMAGE}]`);
        expect(button.isEnabled).toBe(true);

        button.fire("execute");
        expect(focus).toHaveBeenCalled();
        await vi.waitFor(() => expect(getModelData(editor.model, { withoutSelection: true }))
            .toContain("contentEmbed"));
    });
});
