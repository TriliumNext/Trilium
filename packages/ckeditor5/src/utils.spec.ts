import { _setModelData as setModelData, ClassicEditor, Essentials, Heading, Paragraph, type DifferItemAttribute } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../test/editor-kit.js";
import { attributeChangeAffectsHeading, escapeHtml } from "./utils.js";

describe("escapeHtml", () => {
    it("returns the string unchanged when there are no special characters", () => {
        expect(escapeHtml("hello world")).toBe("hello world");
    });

    it("escapes ampersands", () => {
        expect(escapeHtml("a & b")).toBe("a &amp; b");
    });

    it("escapes less-than signs", () => {
        expect(escapeHtml("a < b")).toBe("a &lt; b");
    });

    it("escapes greater-than signs", () => {
        expect(escapeHtml("a > b")).toBe("a &gt; b");
    });

    it("escapes double-quote characters", () => {
        expect(escapeHtml('say "hi"')).toBe("say &quot;hi&quot;");
    });

    it("escapes all special characters in one string", () => {
        expect(escapeHtml('<a href="x">&copy;</a>')).toBe(
            "&lt;a href=&quot;x&quot;&gt;&amp;copy;&lt;/a&gt;"
        );
    });

    it("returns an empty string unchanged", () => {
        expect(escapeHtml("")).toBe("");
    });
});

describe("attributeChangeAffectsHeading", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Heading]);
    });

    it("returns false when change.type is not 'attribute'", () => {
        const change = {
            type: "insert",
            range: { start: { parent: null }, end: { parent: null } }
        } as unknown as DifferItemAttribute;

        expect(attributeChangeAffectsHeading(change, editor)).toBe(false);
    });

    it("returns false when no heading ancestor exists anywhere in the range", () => {
        setModelData(editor.model, "<paragraph>hello[]</paragraph>");

        const root = editor.model.document.getRoot();
        if (!root) throw new Error("No root");

        const para = root.getChild(0);
        if (!para) throw new Error("No paragraph");

        // Create a range fully inside the paragraph (parent = paragraph, not a heading)
        const start = editor.model.createPositionAt(para, 0);
        const end = editor.model.createPositionAt(para, "end");

        const change = {
            type: "attribute",
            attributeKey: "bold",
            attributeOldValue: null,
            attributeNewValue: true,
            range: { start, end }
        } as unknown as DifferItemAttribute;

        expect(attributeChangeAffectsHeading(change, editor)).toBe(false);
    });

    it("returns true (fast path) when start.parent is a heading element", () => {
        setModelData(editor.model, "<heading1>foo[]bar</heading1>");

        const root = editor.model.document.getRoot();
        if (!root) throw new Error("No root");

        const heading = root.getChild(0);
        if (!heading) throw new Error("No heading");

        // Both start and end are inside the heading element
        const start = editor.model.createPositionAt(heading, 0);
        const end = editor.model.createPositionAt(heading, "end");

        const change = {
            type: "attribute",
            attributeKey: "bold",
            attributeOldValue: null,
            attributeNewValue: true,
            range: { start, end }
        } as unknown as DifferItemAttribute;

        expect(attributeChangeAffectsHeading(change, editor)).toBe(true);
    });

    it("returns true (fast path) when end.parent is a heading element (start is not)", () => {
        setModelData(editor.model,
            "<paragraph>para</paragraph>" +
            "<heading1>head[]ing</heading1>"
        );

        const root = editor.model.document.getRoot();
        if (!root) throw new Error("No root");

        const para = root.getChild(0);
        const heading = root.getChild(1);
        if (!para || !heading) throw new Error("Missing elements");

        // start is inside paragraph, end is inside heading
        const start = editor.model.createPositionAt(para, 0);
        const end = editor.model.createPositionAt(heading, "end");

        const change = {
            type: "attribute",
            attributeKey: "bold",
            attributeOldValue: null,
            attributeNewValue: true,
            range: { start, end }
        } as unknown as DifferItemAttribute;

        expect(attributeChangeAffectsHeading(change, editor)).toBe(true);
    });

    it("returns true (loop path) when a heading element is enclosed in the range but boundaries are at root level", () => {
        setModelData(editor.model,
            "<paragraph>before</paragraph>" +
            "<heading1>inside</heading1>" +
            "<paragraph>after</paragraph>"
        );

        const root = editor.model.document.getRoot();
        if (!root) throw new Error("No root");

        // Build a range that spans the heading at the root level:
        // start is before the heading element (offset 1 in root), end is after it (offset 2).
        // start.parent = root, end.parent = root — neither is a heading ancestor.
        // The range.getItems() will yield the heading1 element itself.
        const start = editor.model.createPositionAt(root, 1);
        const end = editor.model.createPositionAt(root, 2);

        const change = {
            type: "attribute",
            attributeKey: "bold",
            attributeOldValue: null,
            attributeNewValue: true,
            range: { start, end }
        } as unknown as DifferItemAttribute;

        expect(attributeChangeAffectsHeading(change, editor)).toBe(true);
    });

    it("returns true when only start.parent has a heading ancestor (not the end)", () => {
        setModelData(editor.model,
            "<heading1>head[]ing</heading1>" +
            "<paragraph>para</paragraph>"
        );

        const root = editor.model.document.getRoot();
        if (!root) throw new Error("No root");

        const heading = root.getChild(0);
        const para = root.getChild(1);
        if (!heading || !para) throw new Error("Missing elements");

        // start is inside heading (so hasHeadingAncestor(start.parent) = true immediately)
        const start = editor.model.createPositionAt(heading, 0);
        const end = editor.model.createPositionAt(para, 0);

        const change = {
            type: "attribute",
            attributeKey: "bold",
            attributeOldValue: null,
            attributeNewValue: true,
            range: { start, end }
        } as unknown as DifferItemAttribute;

        expect(attributeChangeAffectsHeading(change, editor)).toBe(true);
    });

    it("returns false for an empty paragraph range with no headings in document", () => {
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        const root = editor.model.document.getRoot();
        if (!root) throw new Error("No root");

        const para = root.getChild(0);
        if (!para) throw new Error("No paragraph");

        // Collapsed range inside paragraph
        const pos = editor.model.createPositionAt(para, 0);

        const change = {
            type: "attribute",
            attributeKey: "alignment",
            attributeOldValue: null,
            attributeNewValue: "center",
            range: { start: pos, end: pos }
        } as unknown as DifferItemAttribute;

        expect(attributeChangeAffectsHeading(change, editor)).toBe(false);
    });
});
