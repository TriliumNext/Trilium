import { _setModelData as setModelData, ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { modelQueryElement, modelQueryElementsAll, viewQueryElement } from "./utils.js";

describe("footnote utils", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph]);
        setModelData(editor.model, "<paragraph>foo</paragraph><paragraph>bar[]</paragraph>");
    });

    function root() {
        const rootElement = editor.model.document.getRoot();
        if (!rootElement) {
            throw new Error("Editor has no root element.");
        }
        return rootElement;
    }

    describe("modelQueryElementsAll", () => {
        it("returns every element when no predicate is given, skipping text nodes", () => {
            const found = modelQueryElementsAll(editor, root());

            expect(found.map((element) => element.name)).toEqual(["paragraph", "paragraph"]);
        });

        it("returns only the elements matching the predicate", () => {
            const found = modelQueryElementsAll(editor, root(), (element) => element.childCount === 1);

            expect(found).toHaveLength(2);
        });

        it("returns an empty array when nothing matches", () => {
            expect(modelQueryElementsAll(editor, root(), () => false)).toEqual([]);
        });
    });

    describe("modelQueryElement", () => {
        it("returns the first element when no predicate is given", () => {
            expect(modelQueryElement(editor, root())?.name).toBe("paragraph");
        });

        it("returns the first element matching the predicate", () => {
            const found = modelQueryElement(editor, root(), (element) => {
                const child = element.getChild(0);
                return Boolean(child?.is("$text") && child.data === "bar");
            });

            expect(found?.name).toBe("paragraph");
        });

        it("returns null when nothing matches", () => {
            expect(modelQueryElement(editor, root(), () => false)).toBeNull();
        });
    });

    describe("viewQueryElement", () => {
        it("returns the first view element when no predicate is given", () => {
            const viewRoot = editor.editing.view.document.getRoot();
            if (!viewRoot) {
                throw new Error("Editing view has no root element.");
            }

            expect(viewQueryElement(editor, viewRoot)?.name).toBe("p");
        });

        it("returns null when nothing matches", () => {
            const viewRoot = editor.editing.view.document.getRoot();
            if (!viewRoot) {
                throw new Error("Editing view has no root element.");
            }

            expect(viewQueryElement(editor, viewRoot, () => false)).toBeNull();
        });
    });
});
