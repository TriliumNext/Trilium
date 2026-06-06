import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import $ from "jquery";

vi.mock("./i18n.js", () => ({
    getCurrentLanguage: () => mockedLanguage
}));
vi.mock("./syntax_highlight.js", () => ({
    formatCodeBlocks: (arg: unknown) => formatCodeBlocksMock(arg)
}));
vi.mock("../widgets/type_widgets/text/read_only_helper.js", () => ({
    applyReferenceLinks: (arg: unknown) => applyReferenceLinksMock(arg)
}));

import renderDoc, { isValidDocName } from "./doc_renderer.js";

let mockedLanguage = "en";
const formatCodeBlocksMock = vi.fn((_arg?: unknown) => {});
const applyReferenceLinksMock = vi.fn(async (_arg?: unknown) => {});

/** Builds a minimal FNote-like object with the given docName label. */
function fakeNote(docName: string | null) {
    return { getLabelValue: (name: string) => (name === "docName" ? docName : null) } as any;
}

/**
 * Overrides jQuery's `.load(url, cb)` so we can drive the callback deterministically.
 * The handler receives the requested url and the jQuery element so it can inject HTML.
 */
function stubLoad(handler: (url: string, $el: JQuery<HTMLElement>) => { status?: string } | void) {
    return vi.spyOn($.fn, "load").mockImplementation(function (this: JQuery<HTMLElement>, url: any, cb?: any) {
        const result = handler(url, this) ?? {};
        const status = result.status ?? "success";
        // jQuery invokes the callback with (responseText, status, xhr).
        cb?.call(this, this.html(), status, {});
        return this;
    } as any);
}

describe("isValidDocName", () => {
    it("accepts valid docNames", () => {
        expect(isValidDocName("launchbar_intro")).toBe(true);
        expect(isValidDocName("User Guide/Quick Start")).toBe(true);
        expect(isValidDocName("User Guide/User Guide/Quick Start")).toBe(true);
        expect(isValidDocName("Quick Start Guide")).toBe(true);
        expect(isValidDocName("quick_start_guide")).toBe(true);
        expect(isValidDocName("quick-start-guide")).toBe(true);
        expect(isValidDocName("User Guide/User Guide/Advanced Usage/Text Extraction (OCR)")).toBe(true);
    });

    it("rejects path traversal attacks", () => {
        expect(isValidDocName("..")).toBe(false);
        expect(isValidDocName("../etc/passwd")).toBe(false);
        expect(isValidDocName("foo/../bar")).toBe(false);
        expect(isValidDocName("../../../../api/notes/_malicious/open")).toBe(false);
        expect(isValidDocName("..\\etc\\passwd")).toBe(false);
        expect(isValidDocName("foo\\bar")).toBe(false);
    });

    it("rejects URL manipulation attacks", () => {
        expect(isValidDocName("../../../../api/notes/_malicious/open?x=")).toBe(false);
        expect(isValidDocName("foo#bar")).toBe(false);
        expect(isValidDocName("%2e%2e")).toBe(false);
        expect(isValidDocName("%2e%2e%2f%2e%2e%2fapi")).toBe(false);
    });
});

describe("renderDoc", () => {
    beforeEach(() => {
        mockedLanguage = "en";
        formatCodeBlocksMock.mockClear();
        applyReferenceLinksMock.mockClear();
        (window as any).glob = { isStandalone: false, isDev: false, assetPath: "assets" };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("resolves with an empty container when the note has no docName (load is never called)", async () => {
        const loadSpy = stubLoad(() => {});
        const $content = await renderDoc(fakeNote(null));
        expect($content.length).toBe(1);
        expect(loadSpy).not.toHaveBeenCalled();
    });

    it("resolves with an empty container and logs when the docName is invalid", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const loadSpy = stubLoad(() => {});
        const $content = await renderDoc(fakeNote("../etc/passwd"));
        expect($content.length).toBe(1);
        expect(loadSpy).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid docName"));
    });

    it("loads the localized doc, rewrites relative image src, and runs post-processing", async () => {
        mockedLanguage = "de";
        const loadSpy = stubLoad((_url, $el) => {
            $el.html(`<img src="pic.png"><a class="reference-link">x</a>`);
        });

        const $content = await renderDoc(fakeNote("Quick Start"));

        // URL is base/doc_notes/<lang>/<docName with %20>.html
        expect(loadSpy.mock.calls[0][0]).toBe("assets/doc_notes/de/Quick%20Start.html");
        // The relative image src is rewritten to be prefixed with the doc directory.
        expect($content.find("img").attr("src")).toBe("assets/doc_notes/de/pic.png");
        expect(formatCodeBlocksMock).toHaveBeenCalledTimes(1);
        expect(applyReferenceLinksMock).toHaveBeenCalledTimes(1);
    });

    it("forces English for User Guide docs regardless of the current language", async () => {
        mockedLanguage = "fr";
        const loadSpy = stubLoad(() => {});
        await renderDoc(fakeNote("User Guide/Quick Start"));
        expect(loadSpy.mock.calls[0][0]).toBe("assets/doc_notes/en/User%20Guide/Quick%20Start.html");
    });

    it("falls back to the English doc when the localized load errors", async () => {
        mockedLanguage = "de";
        const requested: string[] = [];
        const loadSpy = stubLoad((url) => {
            requested.push(url);
            // First (German) request errors; the English fallback succeeds.
            return url.includes("/de/") ? { status: "error" } : {};
        });

        const $content = await renderDoc(fakeNote("Quick Start"));

        expect(requested).toEqual([
            "assets/doc_notes/de/Quick%20Start.html",
            "assets/doc_notes/en/Quick%20Start.html"
        ]);
        expect($content.length).toBe(1);
        expect(loadSpy).toHaveBeenCalledTimes(2);
        // processContent runs for the fallback url.
        expect(formatCodeBlocksMock).toHaveBeenCalledTimes(1);
        expect(applyReferenceLinksMock).toHaveBeenCalledTimes(1);
    });

    it("uses the server-assets base path in standalone mode", async () => {
        (window as any).glob = { isStandalone: true, isDev: false, assetPath: "assets" };
        const loadSpy = stubLoad(() => {});
        await renderDoc(fakeNote("Quick Start"));
        expect(loadSpy.mock.calls[0][0]).toBe("server-assets/doc_notes/en/Quick%20Start.html");
    });

    it("uses the parent of assetPath in dev mode", async () => {
        (window as any).glob = { isStandalone: false, isDev: true, assetPath: "assets" };
        const loadSpy = stubLoad(() => {});
        await renderDoc(fakeNote("Quick Start"));
        expect(loadSpy.mock.calls[0][0]).toBe("assets/../doc_notes/en/Quick%20Start.html");
    });
});
