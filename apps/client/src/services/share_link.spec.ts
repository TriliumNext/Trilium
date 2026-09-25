import { afterEach, describe, expect, it } from "vitest";

import { buildShareLink } from "./share_link";

describe("buildShareLink", () => {
    const originalGlob = window.glob;

    afterEach(() => {
        window.glob = originalGlob;
    });

    function setGlob(patch: Record<string, unknown>) {
        window.glob = { ...patch } as unknown as typeof window.glob;
    }

    it("uses the configured sync server host when set (regardless of the local origin)", () => {
        setGlob({ httpBaseUrl: "http://127.0.0.1:37742" });
        expect(buildShareLink("abc123", "https://notes.example.com")).toBe("https://notes.example.com/share/abc123");
    });

    it("uses the injected loopback origin on the desktop renderer (not the trilium-app:// location)", () => {
        // The renderer loads from trilium-app://app/, so without httpBaseUrl the link would be
        // trilium-app://app/share/... — the regression this guards against.
        setGlob({ httpBaseUrl: "http://127.0.0.1:37742" });
        expect(buildShareLink("abc123", undefined)).toBe("http://127.0.0.1:37742/share/abc123");
    });

    it("derives from the page origin when there is no sync server and no injected origin (server / browser)", () => {
        setGlob({});
        // happy-dom serves the page from http://localhost:3000/ by default.
        expect(buildShareLink("abc123", null)).toBe("http://localhost:3000/share/abc123");
    });

    it("resolves an empty shareId (share root) to the /share/ base", () => {
        setGlob({ httpBaseUrl: "http://127.0.0.1:37742" });
        expect(buildShareLink("", undefined)).toBe("http://127.0.0.1:37742/share/");
    });

    it("percent-encodes a shareId carrying characters that are not path-safe", () => {
        // A shareAlias is free-form text, so it can hold spaces, quotes, separators and anything
        // else a title can. Each branch must produce one path segment the /share/:shareId route
        // decodes back to the alias.
        const shareId = `my alias"/?x`;
        const encoded = "my%20alias%22%2F%3Fx";
        const syncServerHost = "https://notes.example.com";

        setGlob({ httpBaseUrl: "http://127.0.0.1:37742" });
        expect(buildShareLink(shareId, syncServerHost)).toBe(`${syncServerHost}/share/${encoded}`);
        expect(buildShareLink(shareId, undefined)).toBe(`http://127.0.0.1:37742/share/${encoded}`);

        setGlob({});
        expect(buildShareLink(shareId, null)).toBe(`http://localhost:3000/share/${encoded}`);
    });
});
