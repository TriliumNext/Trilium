import { describe, expect, it, vi } from "vitest";

import FAttribute from "../entities/fattribute.js";
import type { AttributeType } from "../entities/fattribute.js";
import { buildNote } from "../test/easy-froca";
import attributeRenderer from "./attribute_renderer.js";
import froca from "./froca.js";
import ws from "./ws.js";

// ws is globally mocked but the stub does not define logError.
(ws as any).logError = vi.fn();

function attr(props: { type: AttributeType; name: string; value: string; isInheritable?: boolean }) {
    return new FAttribute(froca, {
        attributeId: Math.random().toString(36).slice(2),
        noteId: "n_attr",
        type: props.type,
        name: props.name,
        value: props.value,
        position: 0,
        isInheritable: !!props.isInheritable
    });
}

describe("renderAttribute", () => {
    it("renders a label without value", async () => {
        const $attr = await attributeRenderer.renderAttribute(attr({ type: "label", name: "foo", value: "" }), false);
        expect($attr.text()).toBe("#foo");
    });

    it("renders a label with a simple value", async () => {
        const $attr = await attributeRenderer.renderAttribute(attr({ type: "label", name: "color", value: "red" }), false);
        expect($attr.text()).toBe("#color=red");
    });

    it("appends the inheritable marker only when both flags are set", async () => {
        const inheritable = attr({ type: "label", name: "foo", value: "", isInheritable: true });
        expect((await attributeRenderer.renderAttribute(inheritable, true)).text()).toBe("#foo(inheritable)");
        // renderIsInheritable false -> no marker even though the attr is inheritable
        expect((await attributeRenderer.renderAttribute(inheritable, false)).text()).toBe("#foo");
        // renderIsInheritable true but attr not inheritable -> no marker
        const notInheritable = attr({ type: "label", name: "foo", value: "" });
        expect((await attributeRenderer.renderAttribute(notInheritable, true)).text()).toBe("#foo");
    });

    it("returns an empty span for auto-link attributes", async () => {
        const $attr = await attributeRenderer.renderAttribute(attr({ type: "label", name: "internalBookmark", value: "x" }), false);
        expect($attr.text()).toBe("");
        expect($attr.children().length).toBe(0);
    });

    it("renders a relation with a resolvable target as a reference link", async () => {
        const target = buildNote({ title: "Target Note" });
        const $attr = await attributeRenderer.renderAttribute(attr({ type: "relation", name: "myrel", value: target.noteId }), false);
        expect($attr.text()).toBe(`~myrel=Target Note`);
        const $link = $attr.find("a.reference-link");
        expect($link.length).toBe(1);
        expect($link.attr("href")).toBe(`#root/${target.noteId}`);
    });

    it("renders relation prefix but no link when the target note is missing", async () => {
        const orig = froca.getNote;
        froca.getNote = vi.fn(async () => null) as typeof froca.getNote;
        try {
            const $attr = await attributeRenderer.renderAttribute(attr({ type: "relation", name: "myrel", value: "missing" }), false);
            expect($attr.text()).toBe("~myrel=");
            expect($attr.find("a").length).toBe(0);
        } finally {
            froca.getNote = orig;
        }
    });

    it("renders nothing for a valueless relation", async () => {
        const $attr = await attributeRenderer.renderAttribute(attr({ type: "relation", name: "myrel", value: "" }), false);
        expect($attr.text()).toBe("");
    });

    it("logs an error for an unknown attribute type", async () => {
        (ws as any).logError = vi.fn();
        const bad = attr({ type: "label", name: "x", value: "" });
        (bad as any).type = "weird";
        const $attr = await attributeRenderer.renderAttribute(bad, false);
        expect(ws.logError).toHaveBeenCalledWith("Unknown attr type: weird");
        expect($attr.text()).toBe("");
    });
});

describe("formatValue (via label rendering)", () => {
    async function rendered(value: string) {
        const $attr = await attributeRenderer.renderAttribute(attr({ type: "label", name: "v", value }), false);
        return $attr.text().replace(/^#v=/, "");
    }

    it("formats values across every quoting branch", async () => {
        // plain (matches the allowed-character regex) -> unquoted
        expect(await rendered("simple-value_1,2.3")).toBe("simple-value_1,2.3");
        // contains a space (fails regex), no double quote -> wrap in double quotes
        expect(await rendered("a b")).toBe(`"a b"`);
        // contains a double quote, no single quote -> wrap in single quotes
        expect(await rendered(`he said "hi"`)).toBe(`'he said "hi"'`);
        // contains both double and single quotes, no backtick -> wrap in backticks
        expect(await rendered(`"x" and 'y'`)).toBe("`\"x\" and 'y'`");
        // contains double, single and backtick -> escape double quotes and wrap in double quotes
        expect(await rendered("\"a\" 'b' `c`")).toBe(`"\\"a\\" 'b' \`c\`"`);
    });
});

describe("renderAttributes", () => {
    it("joins multiple attributes with a space and stays empty for none", async () => {
        const $container = await attributeRenderer.renderAttributes(
            [attr({ type: "label", name: "a", value: "" }), attr({ type: "label", name: "b", value: "" })],
            false
        );
        expect($container.hasClass("rendered-note-attributes")).toBe(true);
        expect($container.text()).toBe("#a #b");

        const $empty = await attributeRenderer.renderAttributes([], false);
        expect($empty.text()).toBe("");
    });

    it("strips the per-attribute wrapping span but keeps the relation reference link", async () => {
        const target = buildNote({ title: "Target Note" });
        const $container = await attributeRenderer.renderAttributes(
            [attr({ type: "relation", name: "myrel", value: target.noteId })],
            false
        );

        expect($container.text()).toBe("~myrel=Target Note");

        // The reference link <a> survives the .html() inner-HTML extraction...
        const $link = $container.find("a.reference-link");
        expect($link.length).toBe(1);
        expect($link.attr("href")).toBe(`#root/${target.noteId}`);
        expect($link.text()).toBe("Target Note");

        // ...but the per-attribute wrapping <span> emitted by renderAttribute is stripped:
        // the only span is $container itself (rendered-note-attributes), with no nested spans.
        expect($container.is("span.rendered-note-attributes")).toBe(true);
        expect($container.find("span").length).toBe(0);
        // The reference link is a direct child of the container, not nested in a span.
        expect($container.children("a.reference-link").length).toBe(1);
    });
});

describe("renderNormalAttributes", () => {
    it("renders plain attributes, excluding definitions/auto-links/hidden/foreign", async () => {
        const note = buildNote({
            title: "Note",
            "#color": "red",
            "#archived": "true", // hidden attribute -> excluded
            "#internalBookmark": "x" // auto-link -> excluded
        });
        // a definition-style label is also excluded by isDefinition()
        const def = attr({ type: "label", name: "label:foo", value: "promoted" });
        (def as any).noteId = note.noteId;

        const { count, $renderedAttributes } = await attributeRenderer.renderNormalAttributes(note);

        expect(count).toBe(1);
        expect($renderedAttributes.text()).toBe("#color=red");
    });

    it("renders only the attributes matching promoted definitions when present", async () => {
        const note = buildNote({
            title: "Promoted note",
            "#label:rank": "promoted,single,text",
            "#rank": "5",
            "#color": "red"
        });

        const { count, $renderedAttributes } = await attributeRenderer.renderNormalAttributes(note);

        // Only #rank matches the promoted definition #label:rank
        expect(count).toBe(1);
        expect($renderedAttributes.text()).toBe("#rank=5");
    });
});
