import type { MimeType } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Theme } from "./themes.js";

/**
 * `ensureMimeTypes`, `highlight` and `loadTheme` all read module-level state (the registered /
 * unsupported mime sets and the injected `<style>` element), so every test gets a fresh copy of
 * the module rather than inheriting whatever the previous one registered.
 */
async function freshModule() {
    vi.resetModules();
    return await import("./index.js");
}

const mime = (mimeType: string, enabled = true): MimeType => ({
    title: mimeType,
    mime: mimeType,
    enabled
});

beforeEach(() => {
    document.head.innerHTML = "";
    vi.restoreAllMocks();
});

describe("ensureMimeTypes", () => {
    // ensureMimeTypes keys everything by the CKEditor-normalised mime ("application/json" ->
    // "application-json"), and highlight() looks up `options.language` verbatim — so callers pass
    // the normalised form. The tests use it directly to keep that contract visible.
    it("registers a supported mime type once and ignores disabled ones", async () => {
        const { ensureMimeTypes, highlight } = await freshModule();

        await ensureMimeTypes([mime("application/json"), mime("text/plain", false)]);

        expect(highlight("{}", { language: "application-json" })).not.toBeNull();

        // The disabled entry was skipped outright: neither registered nor remembered as
        // unsupported, so asking for it warns and yields nothing.
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        expect(highlight("x", { language: "text-plain" })).toBeNull();
        expect(warn).toHaveBeenCalledOnce();

        // A second pass is a no-op for an already-registered mime type.
        await ensureMimeTypes([mime("application/json")]);
        expect(highlight("{}", { language: "application-json" })).not.toBeNull();
    });

    it("remembers a mime type with no highlight.js definition as unsupported", async () => {
        const { ensureMimeTypes, highlight } = await freshModule();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        // `application/mbox` is present in the table but maps to null (no highlighter).
        await ensureMimeTypes([mime("application/mbox")]);

        expect(highlight("x", { language: "application-mbox" })).toBeNull();
        // Known-unsupported short-circuits before the "unable to find highlighting" warning.
        expect(warn).not.toHaveBeenCalled();
    });
});

describe("loadTheme", () => {
    const theme = (css: string): Theme => ({
        name: "Test (Dark)",
        load: () => Promise.resolve({ default: css }) as ReturnType<Theme["load"]>
    });

    it("injects one style element and reuses it across theme switches", async () => {
        const { loadTheme } = await freshModule();

        await loadTheme(theme(".hljs { color: red; }"));
        const injected = document.head.querySelectorAll("style");
        expect(injected.length).toBe(1);
        // The CSS is normalised on the way in, so CKEditor's code blocks pick the theme up.
        expect(injected[0]?.textContent).toContain(".hljs, .ck-content pre.hljs {");

        await loadTheme(theme(".hljs { color: blue; }"));
        expect(document.head.querySelectorAll("style").length).toBe(1);
        expect(document.head.querySelector("style")?.textContent).toContain("blue");
    });

    it("removes the style element for \"none\", and tolerates a repeat", async () => {
        const { loadTheme } = await freshModule();

        await loadTheme(theme(".hljs { color: red; }"));
        expect(document.head.querySelectorAll("style").length).toBe(1);

        await loadTheme("none");
        expect(document.head.querySelectorAll("style").length).toBe(0);

        // Nothing left to remove — must not throw.
        await loadTheme("none");
        expect(document.head.querySelectorAll("style").length).toBe(0);
    });

    it("does nothing when \"none\" is requested before any theme was loaded", async () => {
        const { loadTheme } = await freshModule();

        await loadTheme("none");

        expect(document.head.querySelectorAll("style").length).toBe(0);
    });
});
