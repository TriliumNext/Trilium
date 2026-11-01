import {
    MIME_TYPE_AUTO, MIME_TYPES_DICT, normalizeMimeTypeForCKEditor, resolveEnabledMimeTypes
} from "@triliumnext/commons";
import { describe, expect, it, vi } from "vitest";

// Wrap the real `normalizeMimeTypeForCKEditor` in a spy so we can observe how many
// times the highlight.js mapping build loop invokes it. It is called once per MIME
// type while the map is being built and not at all on cached lookups, which is how
// we prove the map is constructed exactly once.
const normalizeSpy = vi.hoisted(() => vi.fn());
vi.mock("@triliumnext/commons", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/commons")>();
    normalizeSpy.mockImplementation(actual.normalizeMimeTypeForCKEditor);
    return {
        ...actual,
        normalizeMimeTypeForCKEditor: (...args: Parameters<typeof actual.normalizeMimeTypeForCKEditor>) => normalizeSpy(...args)
    };
});

vi.mock("./i18n.js", () => ({ t: (key: string) => key }));

import options from "./options.js";
import mimeTypesService, {
    getHighlightJsNameForMime, orderEnabledMimeTypes
} from "./mime_types.js";

describe("mime_types service", () => {
    it("getMimeTypes loads lazily, defaults to the dict's `default` set, and always enables text/plain", () => {
        // No user option configured -> fall back to the entries flagged `default`.
        options.getJson = vi.fn(() => null) as typeof options.getJson;

        const mimeTypes = mimeTypesService.getMimeTypes();

        // It is a clone, not the frozen source dictionary.
        expect(mimeTypes).not.toBe(MIME_TYPES_DICT);
        expect(mimeTypes.length).toBe(MIME_TYPES_DICT.length);
        expect(Object.isFrozen(mimeTypes)).toBe(false);

        const enabledMimes = mimeTypes.filter((mt) => mt.enabled).map((mt) => mt.mime);
        const defaultMimes = MIME_TYPES_DICT.filter((mt) => mt.default).map((mt) => mt.mime);
        // Every default mime is enabled, plus text/plain which is forced on.
        for (const mime of defaultMimes) {
            expect(enabledMimes).toContain(mime);
        }
        expect(enabledMimes).toContain("text/plain");

        // A non-default mime (no `default` flag, not text/plain) stays disabled.
        const apl = mimeTypes.find((mt) => mt.mime === "text/apl");
        expect(apl?.enabled).toBe(false);
    });

    it("getMimeTypes returns the already-loaded cache on subsequent calls", () => {
        // getJson must not be consulted again now that the cache is populated.
        const spy = vi.fn(() => null);
        options.getJson = spy as typeof options.getJson;

        const first = mimeTypesService.getMimeTypes();
        const second = mimeTypesService.getMimeTypes();

        expect(second).toBe(first);
        expect(spy).not.toHaveBeenCalled();
    });

    it("loadMimeTypes honours a user-configured enabled list", () => {
        options.getJson = vi.fn(() => ["text/apl"]) as typeof options.getJson;

        mimeTypesService.loadMimeTypes();
        const mimeTypes = mimeTypesService.getMimeTypes();

        const apl = mimeTypes.find((mt) => mt.mime === "text/apl");
        const plain = mimeTypes.find((mt) => mt.mime === "text/plain");
        // A default mime that is NOT in the user list is now disabled.
        const html = mimeTypes.find((mt) => mt.mime === "text/html");

        expect(apl?.enabled).toBe(true);
        // text/plain stays enabled even though it is not in the configured list.
        expect(plain?.enabled).toBe(true);
        expect(html?.enabled).toBe(false);
    });

    it("getHighlightJsNameForMime maps CKEditor-normalized mimes to highlight.js codes and caches the mapping", () => {
        // Pre-normalize all argument MIME types so the only remaining `normalizeMimeTypeForCKEditor`
        // calls are the ones the build loop makes internally. This lets us count build-loop
        // invocations without the test's own argument-prep calls polluting the spy.
        const cMime = normalizeMimeTypeForCKEditor("text/x-csrc"); // text-x-csrc
        const cssMime = normalizeMimeTypeForCKEditor("text/css"); // text-css
        const aplMime = normalizeMimeTypeForCKEditor("text/apl");

        // The first lookup builds the mapping: the loop normalizes every MIME type once.
        normalizeSpy.mockClear();
        expect(getHighlightJsNameForMime(cMime)).toBe("c");
        const buildCalls = normalizeSpy.mock.calls.length;
        // The build ran and touched every MIME type (one normalize call per dictionary entry).
        expect(buildCalls).toBe(MIME_TYPES_DICT.length);
        expect(buildCalls).toBeGreaterThan(1);

        // Every subsequent lookup must hit the cached map and NOT rebuild it,
        // i.e. `normalizeMimeTypeForCKEditor` is not invoked again.
        normalizeSpy.mockClear();
        // text/css -> text-css -> "css" (exercises the cached path on the second call)
        expect(getHighlightJsNameForMime(cssMime)).toBe("css");
        // A mime that exists but has no mdLanguageCode is omitted from the mapping.
        expect(getHighlightJsNameForMime(aplMime)).toBeUndefined();
        // An entirely unknown mime resolves to undefined.
        expect(getHighlightJsNameForMime("totally-unknown")).toBeUndefined();
        // No rebuild happened across these three cached lookups.
        expect(normalizeSpy).not.toHaveBeenCalled();
    });

    it("translates the titles that name a Trilium format rather than a language", () => {
        options.getJson = vi.fn(() => null) as typeof options.getJson;
        mimeTypesService.loadMimeTypes();
        const titleOf = (mime: string) =>
            mimeTypesService.getMimeTypes().find((mt) => mt.mime === mime)?.title;

        expect(titleOf("text/x-trilium-log")).toBe("code_mime_types.trilium_log");
        expect(titleOf("text/x-trilium-search")).toBe("code_mime_types.trilium_search_query");
    });

    it("getEnabledMimeTypes follows the stored order unless sorting is on", () => {
        options.getJson = vi.fn(() => [ "text/x-python", "text/css" ]) as typeof options.getJson;
        mimeTypesService.loadMimeTypes();

        options.is = vi.fn(() => false) as typeof options.is;
        expect(mimeTypesService.getEnabledMimeTypes().map((mt) => mt.mime))
            .toEqual([ "text/plain", "text/x-python", "text/css" ]);

        options.is = vi.fn(() => true) as typeof options.is;
        expect(mimeTypesService.getEnabledMimeTypes().map((mt) => mt.mime))
            .toEqual([ "text/plain", "text/css", "text/x-python" ]);
    });

    it("re-exports MIME_TYPE_AUTO and the public helpers", () => {
        expect(mimeTypesService.MIME_TYPE_AUTO).toBe(MIME_TYPE_AUTO);
        expect(typeof mimeTypesService.getMimeTypes).toBe("function");
        expect(typeof mimeTypesService.loadMimeTypes).toBe("function");
        expect(mimeTypesService.getHighlightJsNameForMime).toBe(getHighlightJsNameForMime);
    });
});

describe("orderEnabledMimeTypes", () => {
    const ordered = (order: (string | null)[] | null, isSortedAlphabetically: boolean) =>
        orderEnabledMimeTypes(resolveEnabledMimeTypes(order), order, isSortedAlphabetically)
            .map((mt) => mt.mime);

    it("sorts by title with plain text first, wherever the stored order places it", () => {
        expect(ordered([ "text/x-python", "text/plain", "text/css", "text/x-csrc" ], true))
            .toEqual([ "text/plain", "text/x-csrc", "text/css", "text/x-python" ]);
    });

    it("keeps the stored order, with plain text first unless it was placed elsewhere", () => {
        expect(ordered([ "text/x-python", "text/css" ], false))
            .toEqual([ "text/plain", "text/x-python", "text/css" ]);
        expect(ordered([ "text/x-python", "text/plain", "text/css" ], false))
            .toEqual([ "text/x-python", "text/plain", "text/css" ]);
    });

    it("leaves out unknown and repeated entries", () => {
        expect(ordered([ "text/x-python", null, "text/x-unknown", "text/x-python" ], false))
            .toEqual([ "text/plain", "text/x-python" ]);
    });

    it("sorts the default MIME types when nothing is stored", () => {
        const mimes = ordered(null, false);
        expect(mimes[0]).toBe("text/plain");
        expect(mimes).toContain("text/x-python");
        expect(mimes.slice(1)).toEqual(ordered(null, true).slice(1));
    });
});
