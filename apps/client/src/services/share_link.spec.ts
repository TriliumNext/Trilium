import { afterEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../test/easy-froca";
import froca from "./froca";
import options from "./options";
import { buildShareLink, getNoteShareLink, getShareScope } from "./share_link";

describe("buildShareLink", () => {
    const originalGlob = window.glob;

    afterEach(() => {
        window.glob = originalGlob;
        history.replaceState({}, "", "/");
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

    it("keeps the browser deployment subpath with or without a trailing slash", () => {
        setGlob({});

        history.replaceState({}, "", "/trilium");
        expect(buildShareLink("abc123", null)).toBe("http://localhost:3000/trilium/share/abc123");

        history.replaceState({}, "", "/trilium/");
        expect(buildShareLink("abc123", null)).toBe("http://localhost:3000/trilium/share/abc123");
    });

    it("resolves an empty shareId (share root) to the /share/ base", () => {
        setGlob({ httpBaseUrl: "http://127.0.0.1:37742" });
        expect(buildShareLink("", undefined)).toBe("http://127.0.0.1:37742/share/");
    });

    it("keeps the subpath when the sync server is reverse-proxied below the domain root", () => {
        setGlob({ httpBaseUrl: "http://127.0.0.1:37742" });

        const subpath = "https://notes.example.com/trilium";
        expect(buildShareLink("abc123", subpath)).toBe(`${subpath}/share/abc123`);
        expect(buildShareLink("abc123", `${subpath}/`)).toBe(`${subpath}/share/abc123`);
        expect(buildShareLink("abc123", `${subpath}///`)).toBe(`${subpath}/share/abc123`);

        const nested = "https://notes.example.com/a/b";
        expect(buildShareLink("abc123", nested)).toBe(`${nested}/share/abc123`);
    });

    it("drops a query or fragment carried by the configured sync server address", () => {
        setGlob({ httpBaseUrl: "http://127.0.0.1:37742" });

        const subpath = "https://notes.example.com/trilium";
        expect(buildShareLink("abc123", `${subpath}?x=1#y`)).toBe(`${subpath}/share/abc123`);
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

describe("getNoteShareLink", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("links a shared note to its shared page, by its alias or its id", () => {
        const host = "https://notes.example.com";
        options.load({ syncServerHost: host });
        const shareRoot = buildNote({
            id: "_share",
            title: "Shared notes",
            children: [
                { id: "sharedAlias", title: "Aliased", "#shareAlias": "my-page" },
                { id: "sharedPlain", title: "Plain" }
            ]
        });
        const unshared = buildNote({ title: "Private" });

        expect(getNoteShareLink(froca.notes.sharedAlias)).toBe(`${host}/share/my-page`);
        expect(getNoteShareLink(froca.notes.sharedPlain)).toBe(`${host}/share/sharedPlain`);
        expect(getNoteShareLink(shareRoot)).toBeNull();
        expect(getNoteShareLink(unshared)).toBeNull();
    });

    it("gives no link in the mobile app without a sync server", () => {
        vi.stubGlobal("Capacitor", { isNativePlatform: () => true });
        const shareRoot = buildNote({
            id: "_share",
            title: "Shared notes",
            children: [ { title: "Shared" } ]
        });
        const shared = froca.notes[shareRoot.children[0]];

        options.load({ syncServerHost: "" });
        expect(getNoteShareLink(shared)).toBeNull();

        options.load({ syncServerHost: "https://notes.example.com" });
        expect(getNoteShareLink(shared)).toBe(`https://notes.example.com/share/${shared.noteId}`);
    });
});

describe("getShareScope", () => {
    it("tells a public share from a local one, a standalone preview and one only an export publishes", () => {
        const syncServerHost = "https://sync.example.com";
        const platform = { isElectron: false, isStandalone: false, isMobileApp: false };

        expect(getShareScope({ ...platform, syncServerHost: "" })).toBe("public");
        expect(getShareScope({ ...platform, isElectron: true, syncServerHost: "" })).toBe("local");
        expect(getShareScope({ ...platform, isElectron: true, syncServerHost })).toBe("public");
        expect(getShareScope({ ...platform, isStandalone: true, syncServerHost: "" })).toBe("preview");
        expect(getShareScope({ ...platform, isStandalone: true, syncServerHost })).toBe("public");
        expect(getShareScope({ ...platform, isStandalone: true, isMobileApp: true, syncServerHost: "" })).toBe("export-only");
        expect(getShareScope({ ...platform, isStandalone: true, isMobileApp: true, syncServerHost })).toBe("public");
    });
});
