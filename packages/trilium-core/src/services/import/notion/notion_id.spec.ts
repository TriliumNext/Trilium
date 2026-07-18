import { describe, expect, it } from "vitest";

import { getNotionId, stripNotionId } from "./notion_id.js";

const ID = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d";

describe("getNotionId", () => {
    it("extracts the 32-hex id from a Notion file or folder name", () => {
        expect(getNotionId(`My Page ${ID}.html`)).toBe(ID);
        expect(getNotionId(`My Page ${ID}`)).toBe(ID);
    });

    it("extracts the id from a hyphenated UUID and from a query-suffixed URL", () => {
        // Notion sometimes hyphenates the id; the hyphens are stripped before matching.
        expect(getNotionId("My Page 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d.html")).toBe(ID);
        expect(getNotionId(`image.png?table=block&id=${ID}`)).toBe(ID);
    });

    it("returns undefined when there is no id", () => {
        expect(getNotionId("Workspace")).toBeUndefined();
        expect(getNotionId("index.html")).toBeUndefined();
    });
});

describe("stripNotionId", () => {
    it("removes the trailing id while keeping the extension", () => {
        expect(stripNotionId(`My Page ${ID}.html`)).toBe("My Page.html");
        expect(stripNotionId(`My Page ${ID}`)).toBe("My Page");
    });

    it("leaves names without an id untouched", () => {
        expect(stripNotionId("Workspace")).toBe("Workspace");
    });
});
