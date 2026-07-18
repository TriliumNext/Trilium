import { ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CollapsibleEditing from "../src/collapsible-editing.js";

describe("CollapsibleEditing schema", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;
    let schema: ClassicEditor["model"]["schema"];

    beforeEach(async () => {
        domElement = document.createElement("div");
        document.body.appendChild(domElement);
        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [Essentials, Paragraph, CollapsibleEditing]
        });
        schema = editor.model.schema;
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    it("registers the details and summary elements", () => {
        expect(schema.isRegistered("details")).toBe(true);
        expect(schema.isRegistered("summary")).toBe(true);
    });

    it("allows details at the document root", () => {
        expect(schema.checkChild(["$root"], "details")).toBe(true);
    });

    it("allows summary only inside details", () => {
        expect(schema.checkChild(["$root", "details"], "summary")).toBe(true);
        expect(schema.checkChild(["$root"], "summary")).toBe(false);
        expect(schema.checkChild(["$root", "paragraph"], "summary")).toBe(false);
    });

    it("allows block content inside details (so the body can hold paragraphs and nested collapsibles)", () => {
        expect(schema.checkChild(["$root", "details"], "paragraph")).toBe(true);
        // Nested collapsibles are explicitly supported.
        expect(schema.checkChild(["$root", "details"], "details")).toBe(true);
    });

    it("treats summary as a block element so MoveBlockUpDown resolves caret-in-summary to the enclosing details", () => {
        // The collapsible plugin sets isBlock: true on <summary> deliberately —
        // see the comment in registerSchema. If this regresses, the "caret in
        // title acts as a handle for the whole block" UX breaks.
        expect(schema.isBlock("summary")).toBe(true);
    });

    it("allows plain text inside summary", () => {
        expect(schema.checkChild(["$root", "details", "summary"], "$text")).toBe(true);
    });
});
