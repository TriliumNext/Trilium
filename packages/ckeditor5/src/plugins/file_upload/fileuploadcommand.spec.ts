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
    _setModelData as setModelData
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import FileUploadCommand from "./fileuploadcommand.js";

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
            allowAttributes: ["href", "uploadId", "uploadStatus"]
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
        editor = await createTestEditor([Essentials, Paragraph, FileRepository, ReferenceSchema]);

        // Provide a minimal upload adapter so FileRepository.createLoader() succeeds.
        createUploadAdapterPlugin(editor);

        // Register the command manually (FileUploadEditing is not loaded here).
        editor.commands.add("fileUpload", new FileUploadCommand(editor));
    });

    // -----------------------------------------------------------------
    // refresh()
    // -----------------------------------------------------------------

    it("is always enabled regardless of the selection position", () => {
        setModelData(editor.model, "<paragraph>[]foo</paragraph>");
        const command = editor.commands.get("fileUpload");
        command?.refresh();
        expect(command?.isEnabled).toBe(true);
    });

    it("remains enabled after refresh is called", () => {
        const command = editor.commands.get("fileUpload");
        command?.refresh();
        expect(command?.isEnabled).toBe(true);
    });

    // -----------------------------------------------------------------
    // execute() — happy path (single file)
    // -----------------------------------------------------------------

    it("inserts a reference placeholder for a single file", () => {
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        const file = new File(["content"], "test.txt", { type: "text/plain" });
        editor.execute("fileUpload", { file: [file] });

        const modelData = getModelData(editor.model);
        expect(modelData).toContain("reference");
    });

    it("inserts a reference placeholder with an uploadId attribute", () => {
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        const file = new File(["content"], "test.txt", { type: "text/plain" });
        editor.execute("fileUpload", { file: [file] });

        // Walk the model root and find the inserted reference element.
        const root = editor.model.document.getRoot();
        let foundReference = false;
        if (root) {
            for (const child of Array.from(root.getChildren())) {
                if (child.is("element")) {
                    for (const node of Array.from(child.getChildren())) {
                        if (node.is("element", "reference")) {
                            foundReference = true;
                            // href is set to '' and uploadId is a loader id (number/string).
                            expect(node.getAttribute("href")).toBe("");
                            expect(node.getAttribute("uploadId")).toBeDefined();
                        }
                    }
                }
            }
        }
        expect(foundReference).toBe(true);
    });

    it("inserts a space text node after the reference placeholder", () => {
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        const file = new File(["x"], "x.txt", { type: "text/plain" });
        editor.execute("fileUpload", { file: [file] });

        // The model data string representation should show that a text
        // node with a space follows the reference element.
        const modelStr = getModelData(editor.model);
        // The space is inserted by writer.insertText(' ', placeholder, 'after').
        expect(modelStr).toContain(" ");
    });

    // -----------------------------------------------------------------
    // execute() — multiple files
    // -----------------------------------------------------------------

    it("inserts one reference placeholder per file when multiple files are passed", () => {
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        const files = [
            new File(["a"], "a.txt", { type: "text/plain" }),
            new File(["b"], "b.txt", { type: "text/plain" })
        ];
        editor.execute("fileUpload", { file: files });

        const root = editor.model.document.getRoot();
        let referenceCount = 0;
        if (root) {
            for (const child of Array.from(root.getChildren())) {
                if (child.is("element")) {
                    for (const node of Array.from(child.getChildren())) {
                        if (node.is("element", "reference")) {
                            referenceCount++;
                        }
                    }
                }
            }
        }
        expect(referenceCount).toBe(2);
    });

    // -----------------------------------------------------------------
    // execute() — empty file array
    // -----------------------------------------------------------------

    it("does not modify the model when an empty file array is passed", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const before = getModelData(editor.model);

        editor.execute("fileUpload", { file: [] });

        expect(getModelData(editor.model)).toBe(before);
    });

    // -----------------------------------------------------------------
    // uploadFile() — no loader returned (no upload adapter configured)
    // -----------------------------------------------------------------

    it("does not throw and does not insert anything when createLoader returns null", () => {
        // Remove the upload adapter so createLoader returns null.
        (editor.plugins.get(FileRepository) as unknown as { createUploadAdapter: unknown }).createUploadAdapter = undefined;

        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const before = getModelData(editor.model);

        const file = new File(["x"], "x.txt", { type: "text/plain" });
        // Should not throw even without an upload adapter.
        expect(() => editor.execute("fileUpload", { file: [file] })).not.toThrow();

        // The model should be unchanged (the early-return guard was hit).
        expect(getModelData(editor.model)).toBe(before);
    });

    // -----------------------------------------------------------------
    // Spy: FileRepository.createLoader is actually called
    // -----------------------------------------------------------------

    it("calls FileRepository.createLoader for each file", () => {
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        const fileRepository = editor.plugins.get(FileRepository);
        const createLoaderSpy = vi.spyOn(fileRepository, "createLoader");

        const files = [
            new File(["1"], "one.txt", { type: "text/plain" }),
            new File(["2"], "two.txt", { type: "text/plain" })
        ];
        editor.execute("fileUpload", { file: files });

        expect(createLoaderSpy).toHaveBeenCalledTimes(2);
        expect(createLoaderSpy).toHaveBeenCalledWith(files[0]);
        expect(createLoaderSpy).toHaveBeenCalledWith(files[1]);
    });
});
