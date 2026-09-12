import { existsSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getFontFaceCss, getPdfUrl } from "./PdfViewer";

describe("getPdfUrl", () => {
    afterEach(() => history.replaceState({}, "", "/"));

    it("resolves an API path against the deployment root, never relative to the viewer", () => {
        expect(getPdfUrl("attachments/abc123/open")).toBe("/api/attachments/abc123/open");

        // Trilium behind a reverse proxy on a subpath: the URL keeps the prefix, so pdf.js still
        // reaches the API without `../../` — which a proxy filtering traversal would reject (#8877).
        history.replaceState({}, "", "/trilium/#root/abc123");
        expect(getPdfUrl("notes/abc123/open")).toBe("/trilium/api/notes/abc123/open");

        expect(getPdfUrl("revisions/rev1/download")).not.toContain("..");
    });
});

describe("getFontFaceCss", () => {
    const originalAssetPath = window.glob.assetPath;

    afterEach(() => {
        window.glob.assetPath = originalAssetPath;
        history.replaceState({}, "", "/");
    });

    it("resolves every face against the deployment root, never relative to the viewer", () => {
        // Standalone serves the client from the root, so its asset path is a bare `.`.
        window.glob.assetPath = ".";
        expect(getFontFaceCss()).toContain("url('/fonts/Inter/Inter-VariableFont_opsz,wght.woff2')");

        // The server version-stamps the prefix, and keeps it relative so a subpath deployment works.
        window.glob.assetPath = "assets/v1.2.3";
        history.replaceState({}, "", "/trilium/#root/abc123");
        expect(getFontFaceCss()).toContain("url('/trilium/assets/v1.2.3/fonts/Inter/");

        expect(getFontFaceCss()).not.toContain("..");
    });

    it("names files the client actually ships", () => {
        window.glob.assetPath = ".";

        const fontsDir = path.join(__dirname, "../../../fonts");
        const files = [...getFontFaceCss().matchAll(/url\('\/fonts\/([^']+)'\)/g)].map(([, file]) => file);

        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            expect(existsSync(path.join(fontsDir, file)), `${file} is missing from ${fontsDir}`).toBe(true);
        }
    });
});
