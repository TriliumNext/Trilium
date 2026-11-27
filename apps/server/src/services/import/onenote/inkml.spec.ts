import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parsePageContent } from "./graph.js";
import { inkmlToStrokes } from "./inkml.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

interface BrushOptions {
    color?: string;
    width?: number;
    height?: number;
    transparency?: number;
    ignorePressure?: boolean;
}

function brush(id: string, { color = "#FF0000", width = 120, height = width, transparency = 0, ignorePressure = false }: BrushOptions = {}) {
    return `<inkml:brush xml:id="${id}">
        <inkml:brushProperty name="color" value="${color}"/>
        <inkml:brushProperty name="width" value="${width}"/>
        <inkml:brushProperty name="height" value="${height}"/>
        <inkml:brushProperty name="transparency" value="${transparency}"/>
        <inkml:brushProperty name="ignorePressure" value="${ignorePressure}"/>
    </inkml:brush>`;
}

function ink(definitions: string, traces: string) {
    return `<inkml:ink xmlns:inkml="http://www.w3.org/2003/InkML"><inkml:definitions>${definitions}</inkml:definitions>${traces}</inkml:ink>`;
}

const PRESSURE_CONTEXT = `<inkml:context xml:id="ctxPressure"><inkml:inkSource><inkml:traceFormat>
    <inkml:channel name="X" type="integer" units="himetric"/>
    <inkml:channel name="Y" type="integer" units="himetric"/>
    <inkml:channel name="F" type="integer" max="32767" units="dev"/>
</inkml:traceFormat></inkml:inkSource></inkml:context>`;

describe("inkmlToStrokes", () => {
    it("places a trace in pixels from the corner of the page, with the size and the color of its brush", () => {
        const strokes = inkmlToStrokes(ink(brush("br0"), `<inkml:trace brushRef="#br0">100 100, 200 150, 300 100</inkml:trace>`));
        // A himetric unit is 96/2540 of a pixel: 100 units are 3.78 px, saved in tenths. The width
        // of 120 units is 4.54 px, and a trace without pressure has one width all along.
        expect(strokes).toEqual([ { c: "#ff0000", w: 4.54, k: 0, p: [ 38, 38, 128, 38, 19, 0, 37, -19, 0 ] } ]);

        // Another unit of the X channel scales the trace, here a centimeter of 37.8 px.
        const context = `<inkml:context xml:id="cm"><inkml:channel name="X" units="cm"/><inkml:channel name="Y" units="cm"/></inkml:context>`;
        const [ metric ] = inkmlToStrokes(ink(brush("br0") + context, `<inkml:trace contextRef="#cm" brushRef="#br0">1 1, 2 1</inkml:trace>`));
        expect(metric.p).toEqual([ 378, 378, 128, 378, 0, 0 ]);
    });

    it("keeps the pressure of a trace that has it, unless the brush ignores it", () => {
        const traces = `<inkml:trace contextRef="#ctxPressure" brushRef="#pen">0 0 16384, 2540 0 32767, 5080 0 99999</inkml:trace>`
            + `<inkml:trace contextRef="#ctxPressure" brushRef="#flat">0 0 16384, 2540 0 32767</inkml:trace>`;
        const [ pen, flat ] = inkmlToStrokes(ink(PRESSURE_CONTEXT + brush("pen") + brush("flat", { ignorePressure: true }), traces));
        // Half pressure, then full pressure, which a value over the maximum stays at. The stroke
        // has the default sensitivity, at which its size is its width at half pressure.
        expect(pen).toEqual({ c: "#ff0000", w: 4.54, p: [ 0, 0, 128, 960, 0, 127, 960, 0, 0 ] });
        expect(flat).toEqual({ c: "#ff0000", w: 4.54, k: 0, p: [ 0, 0, 128, 960, 0, 0 ] });
    });

    it("turns translucent ink into highlighter ink as wide as the longer side of its tip", () => {
        const definitions = PRESSURE_CONTEXT
            + brush("marker", { color: "#FAF320", width: 56, height: 400, transparency: 0.5 })
            + brush("huge", { color: "#FAF320", width: 56, height: 4000, transparency: 0.5 });
        const [ marker, huge ] = inkmlToStrokes(ink(definitions,
            `<inkml:trace contextRef="#ctxPressure" brushRef="#marker">0 0 1000, 2540 0 32767</inkml:trace>`
            + `<inkml:trace brushRef="#huge">0 0, 2540 0</inkml:trace>`));
        // The highlighter has one width, whatever the pressure.
        expect(marker).toEqual({ t: "h", c: "#faf320", w: 15.12, p: [ 0, 0, 128, 960, 0, 0 ] });
        expect(huge.w).toBe(60);
    });

    it("gives near-black and near-white ink the text color of the theme, and keeps every other color", () => {
        const colors = [ "#404040", "#333333", "black", "#FFFFFF", "#000080", "#FAF320", "#808080", "not a color" ];
        const definitions = colors.map((color, index) => brush(`b${index}`, { color })).join("");
        const traces = colors.map((_, index) => `<inkml:trace brushRef="#b${index}">0 0, 100 0</inkml:trace>`).join("");
        expect(inkmlToStrokes(ink(definitions, traces)).map(({ c }) => c))
            .toEqual([ undefined, undefined, undefined, undefined, "#000080", "#faf320", "#808080", undefined ]);
    });

    it("tolerates ink without prefixes, brushes or clean points, and returns nothing for no ink", () => {
        const strokes = inkmlToStrokes(`<ink>
            <definitions><brush><brushProperty name="width" value="500"/></brush><brush xml:id="odd"><brushProperty name="width" value="wide"/><brushProperty name="color"/></brush></definitions>
            <trace brushRef="#missing">100 100, junk, 100.4 100, 100 100.2, 200 100, 300</trace>
            <trace brushRef="odd">0 0</trace>
            <trace>nothing here</trace>
        </ink> trailing junk <trace>0 0, 9 9</trace>`);
        // The default brush is 70 units wide and black. Points that are not numbers and points
        // that fall on the one before them are left out, as is a trace without points.
        expect(strokes).toEqual([
            { w: 2.65, k: 0, p: [ 38, 38, 128, 38, 0, 0 ] },
            { w: 2.65, k: 0, p: [ 0, 0, 128 ] }
        ]);
        expect(inkmlToStrokes("")).toEqual([]);
        expect(inkmlToStrokes("  \n ")).toEqual([]);
        expect(inkmlToStrokes("<ink><definitions/></ink>")).toEqual([]);
    });

    it("converts a real OneNote ink export (curly-brace brush ids, traceGroup, himetric coords)", () => {
        const inkml = readFileSync(join(FIXTURES_DIR, "sample.inkml"), "utf8");
        const strokes = inkmlToStrokes(inkml);
        expect(strokes).toHaveLength(42);
        // The first trace starts at (1684, 4198) with the near-black pen of 70 units.
        expect(strokes[0]).toMatchObject({ w: 2.65, k: 0 });
        expect(strokes[0]).not.toHaveProperty("c");
        expect(strokes[0].p.slice(0, 3)).toEqual([ 636, 1587, 128 ]);
        // The three highlighter brushes are yellow and have a rectangular tip.
        const highlights = strokes.filter(({ t }) => t === "h");
        expect(highlights.length).toBeGreaterThan(0);
        expect(new Set(highlights.map(({ c }) => c))).toEqual(new Set([ "#faf320" ]));
        expect(new Set(strokes.map(({ c }) => c))).toEqual(new Set([ undefined, "#1353ba", "#167d1d", "#904c15", "#c62938", "#faf320" ]));
    });
});

describe("parsePageContent", () => {
    it("splits a MIME multipart response into its HTML and InkML parts", () => {
        const boundary = "--MIMEBoundary123";
        const raw = [
            boundary,
            "Content-Type: text/html",
            "",
            "<html><body><p>Hello</p></body></html>",
            boundary,
            "Content-Type: application/inkml+xml",
            "",
            "<inkml:ink></inkml:ink>",
            `${boundary}--`
        ].join("\r\n");

        const { html, inkml } = parsePageContent(raw);
        expect(html).toBe("<html><body><p>Hello</p></body></html>");
        expect(inkml).toBe("<inkml:ink></inkml:ink>");
    });

    it("returns a non-multipart response verbatim as the HTML part", () => {
        const { html, inkml } = parsePageContent("<html><body><p>No ink here</p></body></html>");
        expect(html).toBe("<html><body><p>No ink here</p></body></html>");
        expect(inkml).toBe("");
    });
});
