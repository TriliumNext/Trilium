import {
    ClassicEditor,
    Essentials,
    FileRepository,
    Paragraph,
    Plugin,
    Widget,
    toWidget,
    viewToModelPositionOutsideModelElement,
    _getModelData as getModelData,
    _setModelData as setModelData,
    type FileLoader
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { installGlobMock } from "../../../test/globals-test-kit.js";
import ContentEmbed from "../content_embed/content_embed.js";
import { isUploadAsLink } from "../uploadimage.js";
import FileUploadCommand, { isFocusUpload, isQuietUpload } from "./fileuploadcommand.js";

/**
 * Minimal plugin that registers the 'reference' model schema AND the downcast
 * converters that the CKEditor mapper requires for inline widget elements.
 */
class ReferenceSchema extends Plugin {
    static get requires() {
        return [Widget];
    }

    init() {
        const editor = this.editor;
        const schema = editor.model.schema;
        const conversion = editor.conversion;

        schema.register("reference", {
            allowWhere: "$text",
            isInline: true,
            isObject: true,
            allowAttributes: ["href", "uploadId", "uploadStatus", "uploadFileName"]
        });

        // Editing downcast: the mapper needs a real view element for every model element.
        conversion.for("editingDowncast").elementToElement({
            model: "reference",
            view: (_modelItem, { writer: viewWriter }) => {
                const container = viewWriter.createContainerElement("span", {
                    class: "reference-link-placeholder"
                });
                return toWidget(container, viewWriter);
            }
        });

        // Data downcast: used by editor.getData() / getModelData helper.
        conversion.for("dataDowncast").elementToElement({
            model: "reference",
            view: (_modelItem, { writer: viewWriter }) => {
                return viewWriter.createContainerElement("a", { class: "reference-link" });
            }
        });

        // Upcast: <a class="reference-link"> → reference model element.
        conversion.for("upcast").elementToElement({
            view: { name: "a", classes: ["reference-link"] },
            model: (_viewElement, { writer: modelWriter }) => {
                return modelWriter.createElement("reference");
            }
        });

        // Required mapper so that positions outside the inline widget resolve correctly.
        editor.editing.mapper.on(
            "viewToModelPosition",
            viewToModelPositionOutsideModelElement(
                editor.model,
                (viewElement) => viewElement.hasClass("reference-link-placeholder")
            )
        );
    }
}

/**
 * Minimal upload adapter that satisfies FileRepository — it never actually
 * uploads anything (the command tests don't need network I/O).
 */
function createUploadAdapterPlugin(editor: ClassicEditor) {
    editor.plugins.get(FileRepository).createUploadAdapter = (loader) => ({
        upload: () => loader.file.then(() => ({ default: "http://example.com/file" })),
        abort: () => {}
    });
}

describe("FileUploadCommand", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([
            Essentials, Paragraph, FileRepository, ReferenceSchema, ContentEmbed
        ]);

        // Provide a minimal upload adapter so FileRepository.createLoader() succeeds.
        createUploadAdapterPlugin(editor);

        // Register the command manually (FileUploadEditing is not loaded here).
        editor.commands.add("fileUpload", new FileUploadCommand(editor));
    });

    // -----------------------------------------------------------------
    // refresh()
    // -----------------------------------------------------------------

    it("is enabled only where the schema allows a reference link", () => {
        const schema = editor.model.schema;
        schema.register("plainBlock", { inheritAllFrom: "$block" });
        schema.addChildCheck((context, definition) =>
            context.endsWith("plainBlock") && definition.name === "reference" ? false : undefined
        );
        editor.conversion.elementToElement({ model: "plainBlock", view: "pre" });
        const command = editor.commands.get("fileUpload");

        setModelData(editor.model, "<paragraph>[]foo</paragraph>");
        expect(command?.isEnabled).toBe(true);

        setModelData(editor.model, "<plainBlock>[]foo</plainBlock>");
        expect(command?.isEnabled).toBe(false);
    });

    // -----------------------------------------------------------------
    // execute()
    // -----------------------------------------------------------------

    it("inserts a placeholder per file, named after it, with a space after each link", () => {
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");

        editor.execute("fileUpload", {
            file: [
                new File(["a"], "a.txt", { type: "text/plain" }),
                new File(["b"], "b.png", { type: "image/png" })
            ]
        });

        expect(getModelData(editor.model)).toMatch(new RegExp(
            "^<paragraph>foo" +
            "<reference href=\"\" uploadFileName=\"a.txt\" uploadId=\"\\w+\"></reference> " +
            "<reference href=\"\" uploadFileName=\"b.png\" uploadId=\"\\w+\"></reference> " +
            "\\[\\]</paragraph>$"
        ));
    });

    it("inserts an embed placeholder per file, in the size the host gives its type", () => {
        installGlobMock({
            getComponentByEl: () => ({
                getEmbedBoxSize: (mime: string) => (mime === "image/png" ? "medium" : "tiny")
            })
        });
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

        editor.execute("fileUpload", {
            file: [
                new File(["a"], "a.txt", { type: "text/plain" }),
                new File(["b"], "b.png", { type: "image/png" })
            ],
            asEmbed: true
        });

        expect(getModelData(editor.model)).toMatch(new RegExp(
            "^<paragraph>foo</paragraph>" +
            "<contentEmbed boxSize=\"tiny\" uploadFileName=\"a.txt\" uploadId=\"\\w+\">" +
            "</contentEmbed>" +
            "<contentEmbed boxSize=\"medium\" uploadFileName=\"b.png\" uploadId=\"\\w+\">" +
            "</contentEmbed>" +
            "<paragraph>\\[\\]bar</paragraph>$"
        ));
    });

    it("sizes the embeds medium for a host that names no size", () => {
        installGlobMock({ getComponentByEl: () => ({}) });
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        editor.execute("fileUpload", {
            file: [ new File(["a"], "a.txt", { type: "text/plain" }) ],
            asEmbed: true
        });

        expect(getModelData(editor.model)).toMatch(/^<contentEmbed boxSize="medium" /);
        expect(getModelData(editor.model)).not.toMatch(/editable|hideTitle/);
    });

    it("gives the embeds the box size, hidden title and editing the caller asks for", () => {
        const getEmbedBoxSize = vi.fn(() => "tiny");
        installGlobMock({ getComponentByEl: () => ({ getEmbedBoxSize }) });
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        editor.execute("fileUpload", {
            file: [
                new File(["{}"], "Canvas.excalidraw", { type: "application/vnd.excalidraw+json" })
            ],
            asEmbed: true,
            boxSize: "medium",
            hideTitle: true,
            editable: true
        });

        expect(getModelData(editor.model)).toMatch(new RegExp(
            "^<contentEmbed boxSize=\"medium\" editable=\"true\" hideTitle=\"true\" " +
            "uploadFileName=\"Canvas.excalidraw\""
        ));
        expect(getEmbedBoxSize).not.toHaveBeenCalled();
    });

    it("places an embed that takes the focus as an image, keeping the text and the cursor", () => {
        installGlobMock({ getComponentByEl: () => ({}) });
        const insert = (data: string, focusEmbed: boolean) => {
            setModelData(editor.model, data);
            editor.execute("fileUpload", {
                file: [ new File([ "{}" ], "Canvas.excalidraw") ],
                asEmbed: true,
                focusEmbed
            });
            return getModelData(editor.model).replace(/<contentEmbed[^>]*><\/contentEmbed>/, "<E>");
        };

        // Beside the block of the selection, which collapses to its start.
        expect([
            insert("<paragraph>f[oo] bar</paragraph><paragraph>baz</paragraph>", true),
            insert("<paragraph>foo [bar</paragraph><paragraph>ba]z</paragraph>", true),
            insert("<paragraph>foo[] bar</paragraph>", true),
            insert("<paragraph>[foo bar]</paragraph>", true),
            insert("<paragraph>foo bar[]</paragraph>", true),
            insert(
                "<paragraph>foo</paragraph><paragraph>[]</paragraph><paragraph>bar</paragraph>",
                true
            )
        ]).toEqual([
            "<E><paragraph>f[]oo bar</paragraph><paragraph>baz</paragraph>",
            "<E><paragraph>foo []bar</paragraph><paragraph>baz</paragraph>",
            "<E><paragraph>foo[] bar</paragraph>",
            "<paragraph>[]foo bar</paragraph><E>",
            "<paragraph>foo bar[]</paragraph><E>",
            // An empty line becomes the embed, as it becomes an image.
            "<paragraph>foo[]</paragraph><E><paragraph>bar</paragraph>"
        ]);
        // Other embeds take the place of the selection.
        expect(insert("<paragraph>f[oo] bar</paragraph>", false))
            .toBe("<paragraph>f</paragraph><E><paragraph>[] bar</paragraph>");
    });

    it("marks the loaders of a quiet upload and of a focus upload, and only those", () => {
        installGlobMock({ getComponentByEl: () => ({}) });
        setModelData(editor.model, "<paragraph>[]</paragraph>");
        const createLoaderSpy = vi.spyOn(editor.plugins.get(FileRepository), "createLoader");

        editor.execute("fileUpload", { file: [ new File(["1"], "one.txt") ] });
        editor.execute("fileUpload", { file: [ new File(["2"], "two.txt") ], quiet: true });
        editor.execute("fileUpload", { file: [ new File(["3"], "three.txt") ], focusEmbed: true });

        const loaders = createLoaderSpy.mock.results.map(({ value }) => value as FileLoader);
        expect(loaders.map(isQuietUpload)).toEqual([ false, true, false ]);
        expect(loaders.map(isFocusUpload)).toEqual([ false, false, true ]);
    });

    it("marks the loader of every file to upload as a link, for an embed too", () => {
        installGlobMock({ getComponentByEl: () => ({}) });
        setModelData(editor.model, "<paragraph>[]</paragraph>");
        const createLoaderSpy = vi.spyOn(editor.plugins.get(FileRepository), "createLoader");

        const files = [
            new File(["1"], "one.txt", { type: "text/plain" }),
            new File(["2"], "two.png", { type: "image/png" })
        ];
        editor.execute("fileUpload", { file: [ files[0] ] });
        editor.execute("fileUpload", { file: [ files[1] ], asEmbed: true });

        expect(createLoaderSpy.mock.calls).toEqual([ [ files[0] ], [ files[1] ] ]);
        for (const { value } of createLoaderSpy.mock.results) {
            expect(isUploadAsLink(value as FileLoader)).toBe(true);
        }
    });

    it("does not modify the model when an empty file array is passed", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const before = getModelData(editor.model);

        editor.execute("fileUpload", { file: [] });

        expect(getModelData(editor.model)).toBe(before);
    });

    it("does not throw and does not insert anything when createLoader returns null", () => {
        // Remove the upload adapter so createLoader returns null.
        (editor.plugins.get(FileRepository) as unknown as { createUploadAdapter: unknown }).createUploadAdapter = undefined;

        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const before = getModelData(editor.model);

        const file = new File(["x"], "x.txt", { type: "text/plain" });
        expect(() => editor.execute("fileUpload", { file: [file] })).not.toThrow();
        expect(getModelData(editor.model)).toBe(before);
    });
});
