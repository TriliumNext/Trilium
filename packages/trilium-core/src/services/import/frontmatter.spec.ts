import { describe, expect, it } from "vitest";

import { extractFrontmatter, parseFrontmatter } from "./frontmatter.js";

describe("extractFrontmatter", () => {
    it("parses scalar properties into camelCased labels and strips the block from the body", () => {
        const { body, attributes } = extractFrontmatter("---\nfirst: First value\nDate Time: 2026-06-27T15:10:00\n---\nBody text.");
        expect(body).toBe("Body text.");
        expect(attributes).toEqual([
            { name: "first", value: "First value" },
            { name: "dateTime", value: "2026-06-27T15:10:00" }
        ]);
    });

    it("expands a list property into one label per item", () => {
        const { attributes } = extractFrontmatter("---\ntags:\n  - Tag\n  - AnotherTag\n---\n");
        expect(attributes).toEqual([
            { name: "tags", value: "Tag" },
            { name: "tags", value: "AnotherTag" }
        ]);
    });

    it("stringifies booleans/numbers and keeps an empty property as an empty-valued label", () => {
        const { attributes } = extractFrontmatter("---\nCheckbox prop: true\nDisabled: false\nNumber: 5\nfirst:\n---\n");
        expect(attributes).toEqual([
            { name: "checkboxProp", value: "true" },
            { name: "disabled", value: "false" },
            { name: "number", value: "5" },
            { name: "first", value: "" }
        ]);
    });

    it("leaves a note without front matter untouched", () => {
        const { body, attributes } = extractFrontmatter("# Title\n\nNo front matter here.");
        expect(body).toBe("# Title\n\nNo front matter here.");
        expect(attributes).toEqual([]);
    });

    it("ignores a --- divider that isn't at the very start of the file", () => {
        const md = "Intro\n\n---\nkey: value\n---\n";
        const { body, attributes } = extractFrontmatter(md);
        expect(body).toBe(md);
        expect(attributes).toEqual([]);
    });

    it("sanitizes dangerous-looking property names to plain alphanumeric label names", () => {
        // A relation/script-trigger or promoted-definition syntax in a key is neutralized by toAttributeName:
        // the `~`, `:` and markup characters are stripped, so no special attribute can be smuggled in.
        const { attributes } = extractFrontmatter('---\n"~runOnNoteCreation": x\n"label:evil": y\n"<script>": z\n"~template": w\n---\n');
        expect(attributes).toEqual([
            { name: "runonnotecreation", value: "x" },
            { name: "labelEvil", value: "y" },
            { name: "script", value: "z" },
            { name: "template", value: "w" }
        ]);
    });

    it("keeps the note intact when the front matter YAML is malformed", () => {
        const md = "---\nkey: [unclosed\n---\nBody.";
        const { body, attributes } = extractFrontmatter(md);
        expect(body).toBe(md);
        expect(attributes).toEqual([]);
    });

    it("skips a nested-mapping property, which has no flat label representation", () => {
        const { attributes } = extractFrontmatter("---\nscalar: kept\nnested:\n  a: 1\n  b: 2\n---\n");
        expect(attributes).toEqual([{ name: "scalar", value: "kept" }]);
    });
});

describe("parseFrontmatter", () => {
    it("strips a structurally-valid non-mapping block (list/scalar) but yields no data", () => {
        const list = parseFrontmatter("---\n- a\n- b\n---\nBody.");
        expect(list).toEqual({ body: "Body.", data: {} });

        const scalar = parseFrontmatter("---\njust a scalar\n---\nBody.");
        expect(scalar).toEqual({ body: "Body.", data: {} });
    });

    it("returns the raw key/value mapping for a caller to type itself", () => {
        const { body, data } = parseFrontmatter("---\nNumber: 5\nFlag: true\n---\nBody.");
        expect(body).toBe("Body.");
        expect(data).toEqual({ Number: 5, Flag: true });
    });
});
