import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyFontsFromOptions, createFontStylesheetLink, quoteFamily } from "./font.js";

function fontLinkHrefs() {
    return Array.from(document.head.querySelectorAll<HTMLLinkElement>("link[data-font-stylesheet]"))
        .map((link) => link.getAttribute("href"));
}

/** happy-dom does not fetch stylesheets, so emulate the pending links finishing loading. */
function fireLoadOnFontLinks() {
    for (const link of document.head.querySelectorAll<HTMLLinkElement>("link[data-font-stylesheet]")) {
        link.dispatchEvent(new Event("load"));
    }
}

// The fonts service keeps a monotonic cache-busting counter as module state, so the exact `?v=N`
// value carries across tests; assertions therefore check the shape and relative change, not the number.
const VERSIONED_HREF = /^api\/fonts\?v=\d+$/;

describe("font service", () => {
    beforeEach(() => {
        // Prevent happy-dom from actually fetching the stylesheet links (which would hit the network and
        // surface as an unhandled rejection); we only assert on the DOM, not on loaded styles.
        const happyDOM = (window as unknown as { happyDOM?: { settings: { disableCSSFileLoading: boolean } } }).happyDOM;
        if (happyDOM) {
            happyDOM.settings.disableCSSFileLoading = true;
        }
        document.head.innerHTML = "";
    });

    afterEach(() => {
        document.head.innerHTML = "";
    });

    it("creates a marked stylesheet link", () => {
        const link = createFontStylesheetLink();
        expect(link.rel).toBe("stylesheet");
        expect(link.hasAttribute("data-font-stylesheet")).toBe(true);
        expect(link.getAttribute("href")).toMatch(/^api\/fonts(\?v=\d+)?$/);
    });

    it("swaps in a fresh cache-busted stylesheet and removes the old one once it loads", () => {
        document.head.appendChild(createFontStylesheetLink());
        expect(fontLinkHrefs()).toHaveLength(1);

        applyFontsFromOptions();
        // New link added before the old one is removed.
        const afterApply = fontLinkHrefs();
        expect(afterApply).toHaveLength(2);
        expect(afterApply[1]).toMatch(VERSIONED_HREF);

        fireLoadOnFontLinks();
        expect(fontLinkHrefs()).toEqual([afterApply[1]]);
    });

    it("bumps the cache-busting param on every apply", () => {
        document.head.appendChild(createFontStylesheetLink());

        applyFontsFromOptions();
        fireLoadOnFontLinks();
        const first = fontLinkHrefs()[0];

        applyFontsFromOptions();
        fireLoadOnFontLinks();
        const second = fontLinkHrefs()[0];

        expect(first).toMatch(VERSIONED_HREF);
        expect(second).toMatch(VERSIONED_HREF);
        expect(second).not.toBe(first);
    });

    it("inserts the new link right after the previous one, preserving cascade position", () => {
        document.head.appendChild(createFontStylesheetLink());
        // A trailing stylesheet (e.g. style.css) must stay after the fonts stylesheet.
        const trailing = document.createElement("link");
        trailing.rel = "stylesheet";
        trailing.href = "style.css";
        document.head.appendChild(trailing);

        applyFontsFromOptions();
        fireLoadOnFontLinks();

        const hrefs = Array.from(document.head.querySelectorAll("link")).map((l) => l.getAttribute("href"));
        expect(hrefs).toHaveLength(2);
        expect(hrefs[0]).toMatch(VERSIONED_HREF);
        expect(hrefs[1]).toBe("style.css");
    });
});

/**
 * The font service as a new session first loads it. The session caches live in the module, so a
 * spec that reused one module would read whatever the previous spec left there.
 */
async function freshFontModule() {
    vi.resetModules();
    return await import("./font.js");
}

let font: Awaited<ReturnType<typeof freshFontModule>>;

describe("listSystemFonts and rendersFamily", () => {
    /** One face as `queryLocalFonts()` reports it — a family arrives once per weight and slant. */
    function face(family: string, style: string): FontData {
        return { family, style, fullName: `${family} ${style}`, postscriptName: `${family}-${style}` };
    }

    /**
     * Stands in for the canvas the probe draws on, since happy-dom has none. `paints` decides, per
     * family, whether any pixel ends up covered. Returns the `fillText` spy every canvas shares, so
     * a spec can count the draws.
     */
    function stubProbeCanvas(paints: (family: string) => boolean) {
        const fillText = vi.fn();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => {
            const drawn = { font: "" };
            const familyOf = () => drawn.font.match(/"(.+)"/)?.[1] ?? "";

            return {
                canvas: { width: 40, height: 40 },
                clearRect: () => {},
                fillText,
                getImageData: () => {
                    return { data: new Uint8ClampedArray([ 0, 0, 0, paints(familyOf()) ? 255 : 0 ]) };
                },
                get font() {
                    return drawn.font;
                },
                set font(value: string) {
                    drawn.font = value;
                }
            };
        }) as never);

        return fillText;
    }

    beforeEach(async () => {
        font = await freshFontModule();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("returns nothing where the runtime does not expose the API", async () => {
        expect(window.queryLocalFonts).toBeUndefined();
        expect(await font.listSystemFonts()).toEqual([]);
    });

    it("reduces the faces to sorted, deduplicated families", async () => {
        vi.stubGlobal("queryLocalFonts", async () => [
            face("Inter", "Regular"),
            face("Inter", "Bold"),
            face("Adwaita Mono", "Regular"),
            face("Inter", "Italic")
        ]);

        expect(await font.listSystemFonts()).toEqual([ "Adwaita Mono", "Inter" ]);
    });

    it("returns nothing when the query is refused, so the picker keeps the stock list", async () => {
        vi.stubGlobal("queryLocalFonts", async () => {
            throw new DOMException("denied", "NotAllowedError");
        });

        expect(await font.listSystemFonts()).toEqual([]);
    });

    it("lists every family without drawing any of them, since drawing loads the font file", async () => {
        vi.stubGlobal("queryLocalFonts", async () => [ face("Inter", "Regular"), face("Unifont", "Regular") ]);
        const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");

        expect(await font.listSystemFonts()).toEqual([ "Inter", "Unifont" ]);
        expect(getContext).not.toHaveBeenCalled();
    });

    it("tells a family the engine measures but will not draw from one it draws", () => {
        stubProbeCanvas((family) => family !== "Unifont");

        expect(font.rendersFamily("Inter")).toBe(true);
        expect(font.rendersFamily("Unifont")).toBe(false);
    });

    it("accepts every family where there is no canvas to judge it on", () => {
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

        expect(font.rendersFamily("Unifont")).toBe(true);
    });

    it("asks the device once per session, however often and however concurrently it is asked", async () => {
        const query = vi.fn(async () => [ face("Inter", "Regular") ]);
        vi.stubGlobal("queryLocalFonts", query);

        const concurrent = await Promise.all([ font.listSystemFonts(), font.listSystemFonts() ]);
        expect(concurrent).toEqual([ [ "Inter" ], [ "Inter" ] ]);
        expect(await font.listSystemFonts()).toEqual([ "Inter" ]);
        expect(query).toHaveBeenCalledTimes(1);
    });

    it("keeps a refused answer for the session rather than asking again", async () => {
        const query = vi.fn(async () => {
            throw new DOMException("denied", "NotAllowedError");
        });
        vi.stubGlobal("queryLocalFonts", query);

        expect(await font.listSystemFonts()).toEqual([]);
        expect(await font.listSystemFonts()).toEqual([]);
        expect(query).toHaveBeenCalledTimes(1);
    });

    it("draws each family once per session, whatever the answer", () => {
        const fillText = stubProbeCanvas((family) => family !== "Unifont");

        for (let attempt = 0; attempt < 3; attempt++) {
            expect(font.rendersFamily("Inter")).toBe(true);
            expect(font.rendersFamily("Unifont")).toBe(false);
        }
        expect(fillText).toHaveBeenCalledTimes(2);
    });

    it("draws again once a canvas is offered, rather than keeping the answer given without one", () => {
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValueOnce(null);
        expect(font.rendersFamily("Unifont")).toBe(true);

        stubProbeCanvas((family) => family !== "Unifont");
        expect(font.rendersFamily("Unifont")).toBe(false);
    });
});

describe("filterAvailableFamilies", () => {
    /**
     * Stands in for the canvas the measurement runs on. `installed` decides which families the
     * device has; anything else falls back, and measures exactly as the generic it fell back to.
     */
    function stubMeasuring(installed: Record<string, number>) {
        const measured: string[] = [];
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => {
            const generics = { monospace: 100, serif: 110, "sans-serif": 120 };
            let current = "";

            return {
                canvas: { width: 40, height: 40 },
                measureText: () => {
                    const family = current.match(/"(.+?)"/)?.[1];
                    const fallback = current.replace(/^\d+px\s*/, "").split(", ").pop() ?? "";
                    if (family) measured.push(family);
                    // Without a family named, the width is the generic's own.
                    return { width: family && family in installed ? installed[family] : generics[fallback as keyof typeof generics] };
                },
                get font() {
                    return current;
                },
                set font(value: string) {
                    current = value;
                }
            };
        }) as never);

        return measured;
    }

    beforeEach(async () => {
        font = await freshFontModule();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("measures each family once per session, whether or not the device has it", () => {
        const measured = stubMeasuring({ Georgia: 130 });

        expect(font.filterAvailableFamilies([ "Georgia", "Garamond" ])).toEqual([ "Georgia" ]);
        const firstPass = measured.length;
        expect(firstPass).toBeGreaterThan(0);

        expect(font.filterAvailableFamilies([ "Garamond", "Georgia" ])).toEqual([ "Georgia" ]);
        expect(measured).toHaveLength(firstPass);

        // A family not seen before is still measured.
        font.filterAvailableFamilies([ "Arial" ]);
        expect(measured.slice(firstPass)).toContain("Arial");
    });

    it("keeps the families the device has and drops the ones it falls back from", () => {
        stubMeasuring({ Georgia: 130, "Comic Sans MS": 140 });

        expect(font.filterAvailableFamilies([ "Georgia", "Garamond", "Comic Sans MS", "Luminari" ]))
            .toEqual([ "Georgia", "Comic Sans MS" ]);
    });

    it("keeps a family that measures as one generic but not the others", () => {
        // Arial resolves to the same face as the default sans-serif, so it is told apart only by
        // the other two. A single fallback would report it missing.
        stubMeasuring({ Arial: 120 });

        expect(font.filterAvailableFamilies([ "Arial" ])).toEqual([ "Arial" ]);
    });

    it("keeps everything where there is no canvas to measure on", () => {
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

        expect(font.filterAvailableFamilies([ "Garamond", "Luminari" ])).toEqual([ "Garamond", "Luminari" ]);
    });
});

/*
 * Read off the function rather than off anything it is written into: happy-dom drops the quotes as
 * it parses a declaration, so `style.fontFamily` reads the same either way and an assertion made
 * through the DOM would hold with the quoting gone.
 */
describe("quoteFamily", () => {
    it("quotes what could not be read unquoted, and leaves the generics as they are", () => {
        // A name beginning with a digit is no identifier, and unquoted takes the whole declaration
        // with it. Windows ships this one; queryLocalFonts() reports whatever is installed.
        expect(quoteFamily("8514oem")).toBe(`"8514oem"`);
        expect(quoteFamily("Trebuchet MS")).toBe(`"Trebuchet MS"`);

        // A generic names a browser default, which quoting would turn into a request for a font
        // that happens to be called "monospace".
        expect(quoteFamily("monospace")).toBe("monospace");
        expect(quoteFamily("ui-sans-serif")).toBe("ui-sans-serif");

        // The quote would close the string early and leave the rest of it as CSS to be read.
        expect(quoteFamily(`Fo"o`)).toBe(`"Fo\\"o"`);
        expect(quoteFamily("Fo\\o")).toBe(`"Fo\\\\o"`);

        // No family is named, and naming an empty one would be no better.
        expect(quoteFamily("")).toBe("");
    });
});
