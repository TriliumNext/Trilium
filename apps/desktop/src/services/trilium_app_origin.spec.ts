import { describe, expect, it } from "vitest";

import { isTriliumAppShellUrl, TRILIUM_APP_BASE_URL, TRILIUM_APP_ORIGIN } from "./trilium_app_origin.js";

describe("trilium_app_origin", () => {
    it("derives the origin and base URL from the scheme and host", () => {
        expect(TRILIUM_APP_ORIGIN).toBe("trilium-app://app");
        expect(TRILIUM_APP_BASE_URL).toBe("trilium-app://app/");
    });

    describe("isTriliumAppShellUrl", () => {
        it("accepts the app shell origin and any path under it", () => {
            expect(isTriliumAppShellUrl("trilium-app://app")).toBe(true);
            expect(isTriliumAppShellUrl("trilium-app://app/")).toBe(true);
            expect(isTriliumAppShellUrl("trilium-app://app/pdfjs/web/viewer.html")).toBe(true);
            expect(isTriliumAppShellUrl("trilium-app://app/?print#root/abc")).toBe(true);
        });

        it("rejects other hosts, schemes, and unparseable / empty input", () => {
            expect(isTriliumAppShellUrl("trilium-app://evil")).toBe(false);
            expect(isTriliumAppShellUrl("trilium-app://app.evil.example")).toBe(false);
            expect(isTriliumAppShellUrl("https://www.youtube-nocookie.com/embed/x")).toBe(false);
            expect(isTriliumAppShellUrl("devtools://devtools/bundled/devtools_app.html")).toBe(false);
            expect(isTriliumAppShellUrl("not a url")).toBe(false);
            expect(isTriliumAppShellUrl("")).toBe(false);
            expect(isTriliumAppShellUrl(null)).toBe(false);
            expect(isTriliumAppShellUrl(undefined)).toBe(false);
        });
    });
});
