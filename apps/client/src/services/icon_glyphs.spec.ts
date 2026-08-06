import { afterEach, describe, expect, it, vi } from "vitest";

import {
    drawIconGlyph, type IconGlyph, loadIconFonts, renderIconImage, resolveIconGlyphs, warmIconFonts
} from "./icon_glyphs";

const uncheckedWindow = window as unknown as { glob: { iconRegistry?: unknown } };

/**
 * Two characters of the private-use block, which is where every icon pack numbers its icons — from
 * the same run of numbers, which is why a character is only ever half of an answer here.
 */
const FILE_GLYPH = "\ue9a1";
const CUBE_GLYPH = "\uf1c2";

/**
 * What the stylesheet makes of each icon class, as it is read back off the probe wearing it. Stubbed
 * rather than written as CSS: this is drawn against a browser's own style resolution, which the test
 * environment has none of.
 */
function answerWith(styles: Record<string, Partial<CSSStyleDeclaration>>) {
    return vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
        const iconClass = (element as HTMLElement).className.replace("icon-glyph-probe", "").trim();
        return (pseudo === "::before" ? styles[iconClass] ?? {} : {}) as CSSStyleDeclaration;
    });
}

/** A canvas that records what it was asked to draw, there being none to draw on here. */
function answerWithCanvas(metrics: Partial<TextMetrics> = {}) {
    const context = {
        font: "",
        fillStyle: "",
        textAlign: "",
        textBaseline: "",
        scale: vi.fn(),
        fillText: vi.fn(),
        measureText: vi.fn(() => ({
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: 16,
            actualBoundingBoxAscent: 14,
            actualBoundingBoxDescent: 2,
            ...metrics
        }))
    };
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => context,
        toDataURL: () => "data:image/png;base64,DRAWN"
    };

    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string, options?: unknown) =>
        (tagName === "canvas" ? canvas : createElement(tagName, options as ElementCreationOptions)) as HTMLElement);

    return { canvas, context };
}

/** Stands in for the browser's font set, which the test environment has none of either. */
function answerWithFonts(load: (font: string, text?: string) => Promise<unknown>) {
    const spy = vi.fn(load);
    Object.defineProperty(document, "fonts", { configurable: true, value: { load: spy } });
    return spy;
}

afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, "fonts");
    delete uncheckedWindow.glob.iconRegistry;
});

describe("resolveIconGlyphs", () => {
    it("reads the character and the font of each class, however quoted, and asks once per class", () => {
        const resolve = answerWith({
            "bx bx-file": { content: `"${FILE_GLYPH}"`, fontFamily: "boxicons" },
            "mdi mdi-cube": { content: `'${CUBE_GLYPH}'`, fontFamily: "trilium-icon-pack-mdi" },
            // A class that draws no icon, one the stylesheet says nothing about, and one whose
            // character has nothing to be looked up in.
            "bx bx-nothing": { content: "none", fontFamily: "boxicons" },
            "bx bx-unknown": { content: "", fontFamily: "boxicons" },
            "bx bx-fontless": { content: `"${FILE_GLYPH}"` }
        });
        const host = document.createElement("div");

        const glyphs = resolveIconGlyphs([
            "bx bx-file", "mdi mdi-cube", "bx bx-nothing", "bx bx-unknown", "bx bx-fontless", "bx bx-file"
        ], host);

        expect(glyphs.get("bx bx-file")).toEqual({ content: FILE_GLYPH, fontFamily: "boxicons" });
        // A pack the user brought along, carried with the font that gives its numbering meaning.
        expect(glyphs.get("mdi mdi-cube")).toEqual({ content: CUBE_GLYPH, fontFamily: "trilium-icon-pack-mdi" });
        expect(glyphs.has("bx bx-nothing")).toBe(false);
        expect(glyphs.has("bx bx-unknown")).toBe(false);
        expect(glyphs.has("bx bx-fontless")).toBe(false);

        // Five classes asked for six times: what a map of thousands of notes is spared.
        expect(resolve).toHaveBeenCalledTimes(5);
        // The probe is an element of no consequence, and is not left behind as one.
        expect(host.childElementCount).toBe(0);
    });

    it("takes the probe back out, out of the page itself by default, even where styles cannot be read", () => {
        vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
            throw new Error("no styles to speak of");
        });

        expect(() => resolveIconGlyphs([ "bx bx-file" ])).toThrow();
        expect(document.body.querySelector(".icon-glyph-probe")).toBeNull();
    });
});

describe("loadIconFonts", () => {
    it("asks for each font once, naming a character it has to cover", async () => {
        const load = answerWithFonts(() => Promise.resolve([]));

        await loadIconFonts([
            { fontFamily: "boxicons", content: FILE_GLYPH },
            { fontFamily: "boxicons", content: FILE_GLYPH },
            { fontFamily: "trilium-icon-pack-mdi", content: CUBE_GLYPH }
        ]);

        expect(load).toHaveBeenCalledTimes(2);
        expect(load).toHaveBeenCalledWith("16px boxicons", FILE_GLYPH);
        expect(load).toHaveBeenCalledWith("16px trilium-icon-pack-mdi", CUBE_GLYPH);
    });

    it("is done either way, a font that cannot be promised being no reason not to draw", async () => {
        const glyph: IconGlyph = { fontFamily: "boxicons", content: FILE_GLYPH };

        // Somewhere with no font set to ask at all, which is where these tests themselves run.
        await expect(loadIconFonts([ glyph ])).resolves.toBeUndefined();

        answerWithFonts(() => Promise.reject(new Error("no such font")));
        await expect(loadIconFonts([ glyph ])).resolves.toBeUndefined();
    });
});

describe("warmIconFonts", () => {
    it("loads every pack's font, each pack being found by the icon it names itself with", async () => {
        uncheckedWindow.glob.iconRegistry = {
            sources: [ { icon: "bx bx-package" }, { icon: "mdi mdi-cube" } ]
        };
        answerWith({
            "bx bx-package": { content: `"${FILE_GLYPH}"`, fontFamily: "boxicons" },
            "mdi mdi-cube": { content: `"${CUBE_GLYPH}"`, fontFamily: "trilium-icon-pack-mdi" }
        });
        const load = answerWithFonts(() => Promise.resolve([]));

        await warmIconFonts();

        expect(load.mock.calls.map(([ font ]) => font))
            .toEqual([ "16px boxicons", "16px trilium-icon-pack-mdi" ]);
    });

    it("has nothing to load where the packs are not known yet", async () => {
        const load = answerWithFonts(() => Promise.resolve([]));

        await expect(warmIconFonts()).resolves.toBeUndefined();

        expect(load).not.toHaveBeenCalled();
    });
});

describe("drawIconGlyph", () => {
    const glyph: IconGlyph = { fontFamily: "boxicons", content: FILE_GLYPH };

    it("writes the glyph at the size asked for, into a canvas of the density asked for", () => {
        const { canvas, context } = answerWithCanvas();

        expect(drawIconGlyph(glyph, { size: 20, color: "red", scale: 3 }))
            .toBe("data:image/png;base64,DRAWN");

        // The density is applied here and only here: a caller that had also scaled the size would
        // be paying for a drawing nine times the area it can show.
        expect([ canvas.width, canvas.height ]).toEqual([ 60, 60 ]);
        expect(context.scale).toHaveBeenCalledWith(3, 3);
        expect(context.font).toBe("20px boxicons");
        expect(context.fillStyle).toBe("red");
        // The glyph's own box in the middle of the square, and nothing measured to get there:
        // browsers do not answer `actualBoundingBox*` alike, and centring the ink on it drew the
        // same icon pixels apart between them.
        expect(context.measureText).not.toHaveBeenCalled();
        expect(context.fillText).toHaveBeenCalledWith(FILE_GLYPH, 10, 10);
        expect(context.textAlign).toBe("center");
        expect(context.textBaseline).toBe("middle");
    });

    it("says so where there is no canvas to draw on", () => {
        const createElement = document.createElement.bind(document);
        vi.spyOn(document, "createElement").mockImplementation((tagName: string) =>
            (tagName === "canvas" ? { getContext: () => null } : createElement(tagName)) as HTMLElement);

        expect(drawIconGlyph(glyph, { size: 20, color: "black", scale: 1 })).toBeNull();
    });
});

describe("renderIconImage", () => {
    it("draws an icon once and keeps it, on the terms it was drawn on", async () => {
        const resolve = answerWith({ "bx bx-kept": { content: `"${FILE_GLYPH}"`, fontFamily: "boxicons" } });
        const { context } = answerWithCanvas();
        answerWithFonts(() => Promise.resolve([]));

        await expect(renderIconImage("bx bx-kept", { size: 20 }))
            .resolves.toBe("data:image/png;base64,DRAWN");
        await expect(renderIconImage("bx bx-kept", { size: 20 })).resolves.toBe("data:image/png;base64,DRAWN");
        expect(resolve).toHaveBeenCalledTimes(1);

        // Asked for on other terms, it is another drawing: the same icon larger, denser, or in
        // another colour is not the one already drawn.
        await renderIconImage("bx bx-kept", { size: 40 });
        await renderIconImage("bx bx-kept", { size: 20, scale: 4 });
        await renderIconImage("bx bx-kept", { size: 20, color: "red" });
        expect(resolve).toHaveBeenCalledTimes(4);
        expect(context.fillStyle).toBe("red");
    });

    it("keeps an icon it could not draw, rather than trying it again per frame", async () => {
        const resolve = answerWith({ "bx bx-missing": { content: "none", fontFamily: "boxicons" } });

        await expect(renderIconImage("bx bx-missing", { size: 20 })).resolves.toBeNull();
        await expect(renderIconImage("bx bx-missing", { size: 20 })).resolves.toBeNull();

        expect(resolve).toHaveBeenCalledTimes(1);
    });
});
