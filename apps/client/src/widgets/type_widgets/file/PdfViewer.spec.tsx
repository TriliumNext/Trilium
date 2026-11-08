import { existsSync } from "node:fs";
import path from "node:path";

import { render } from "preact";
import { afterEach, describe, expect, it } from "vitest";

import PdfViewer, { getFontFaceCss, getPdfUrl } from "./PdfViewer";

describe("PdfViewer", () => {
    function viewerUrl(props: { noteId?: string; ntxId?: string | null }) {
        const container = document.createElement("div");
        render(<PdfViewer pdfUrl="/api/notes/abc123/open" {...props} />, container);
        const src = container.querySelector("iframe")?.getAttribute("src");
        render(null, container);
        return new URL(src ?? "", "http://localhost").searchParams;
    }

    it("addresses the viewer in its URL, so it can post before the frame loads", () => {
        const params = viewerUrl({ noteId: "abc123", ntxId: "ntx 1" });
        expect(params.get("noteId")).toBe("abc123");
        expect(params.get("ntxId")).toBe("ntx 1");
        expect(params.get("file")).toBe("/api/notes/abc123/open");

        // A viewer outside a note (print preview, lightbox, revisions) reports to no one.
        expect(viewerUrl({}).has("noteId")).toBe(false);
        expect(viewerUrl({ noteId: "abc123", ntxId: null }).has("ntxId")).toBe(false);
    });

    it("hides pdf.js' own sidebar, since the right panel lists the document's contents", () => {
        expect(viewerUrl({}).get("sidebar")).toBe("0");
    });
});

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
