import { afterEach, describe, expect, it } from "vitest";

import { getClientDir, getPdfjsAssetDir, getShareThemeAssetDir } from "./assets.js";

// The test runner sets NODE_ENV=development, which exercises the dev branch of
// these path helpers. Toggle to production to cover the resource-dir branch too.
describe("assets path helpers", () => {
    const original = process.env.NODE_ENV;
    afterEach(() => { process.env.NODE_ENV = original; });

    it("resolves dev paths under development", () => {
        process.env.NODE_ENV = "development";
        expect(getShareThemeAssetDir()).toContain("share-theme");
        expect(getPdfjsAssetDir()).toContain("pdfjs-viewer");
        expect(getClientDir()).toContain("client");
    });

    it("resolves resource-dir paths under production", () => {
        process.env.NODE_ENV = "production";
        expect(getShareThemeAssetDir()).toContain("share-theme");
        expect(getPdfjsAssetDir()).toContain("pdfjs-viewer");
        expect(typeof getClientDir()).toBe("string");
    });
});
