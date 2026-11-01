import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parsePageContent } from "./graph.js";
import { inkmlToSvg } from "./inkml.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** A minimal OneNote-style InkML document with one red brush and a multi-point trace. */
const INKML = `<inkml:ink xmlns:inkml="http://www.w3.org/2003/InkML">
    <inkml:definitions>
        <inkml:brush xml:id="br0">
            <inkml:brushProperty name="color" value="#FF0000"/>
            <inkml:brushProperty name="width" value="120"/>
            <inkml:brushProperty name="transparency" value="0"/>
        </inkml:brush>
    </inkml:definitions>
    <inkml:trace brushRef="#br0">100 100, 200 150, 300 100</inkml:trace>
</inkml:ink>`;

describe("inkmlToSvg", () => {
    it("renders a trace as an SVG path using its brush color and width", () => {
        const svg = inkmlToSvg(INKML);
        expect(svg).toBeTruthy();
        expect(svg).toContain("<svg");
        expect(svg).toContain("viewBox=");
        expect(svg).toContain("<path");
        expect(svg).toContain(`stroke="#FF0000"`);
        expect(svg).toContain(`stroke-width="120"`);
        // The path should move to the first point and line to the rest.
        expect(svg).toMatch(/d="M \d+ \d+ L \d+ \d+ L \d+ \d+"/);
    });

    it("caps the displayed size while keeping the true coordinate space in the viewBox", () => {
        const svg = inkmlToSvg(INKML) ?? "";
        const width = Number(svg.match(/width="(\d+)"/)?.[1]);
        expect(width).toBeLessThanOrEqual(800);
        // 300 - 100 + 2*padding(10) = 220 wide in coordinate units.
        expect(svg).toContain("viewBox=\"0 0 220");
    });

    it("renders a single-point trace as a circle", () => {
        const dot = `<inkml:ink xmlns:inkml="http://www.w3.org/2003/InkML">
            <inkml:trace>50 60</inkml:trace>
        </inkml:ink>`;
        const svg = inkmlToSvg(dot) ?? "";
        expect(svg).toContain("<circle");
        expect(svg).not.toContain("<path");
        // The default brush is black ink, so the dot fills theme-adaptively via an inline style.
        expect(svg).toContain(`style="fill:light-dark(#000000, #ffffff)"`);
        expect(svg).toContain("<style>svg{color-scheme:light dark}</style>");
    });

    it("renders a readable-colored single-point trace with a literal fill", () => {
        const dot = `<inkml:ink xmlns:inkml="http://www.w3.org/2003/InkML">
            <inkml:definitions>
                <inkml:brush xml:id="br0"><inkml:brushProperty name="color" value="#FF0000"/></inkml:brush>
            </inkml:definitions>
            <inkml:trace brushRef="#br0">50 60</inkml:trace>
        </inkml:ink>`;
        const svg = inkmlToSvg(dot) ?? "";

        // A color readable under both themes is baked into the dot's fill; no adaptive style is emitted.
        expect(svg).toContain("<circle");
        expect(svg).toContain(`fill="#FF0000"`);
        expect(svg).not.toContain("light-dark");
        expect(svg).not.toContain("<style>");
    });

    it("works without namespace prefixes and falls back to a default (black) brush", () => {
        const plain = `<ink><trace>0 0, 10 10</trace></ink>`;
        const svg = inkmlToSvg(plain) ?? "";
        expect(svg).toContain("<path");
        // The default brush is black ink: rendered theme-adaptively, never hard black.
        expect(svg).toContain(`style="stroke:light-dark(#000000, #ffffff)"`);
        expect(svg).not.toContain(`stroke="#000000"`);
    });

    it("renders black ink and its dark-canvas inverse (white) theme-adaptively", () => {
        const blackAndWhite = `<inkml:ink xmlns:inkml="http://www.w3.org/2003/InkML">
            <inkml:definitions>
                <inkml:brush xml:id="black"><inkml:brushProperty name="color" value="#000000"/></inkml:brush>
                <inkml:brush xml:id="white"><inkml:brushProperty name="color" value="#FFFFFF"/></inkml:brush>
            </inkml:definitions>
            <inkml:trace brushRef="#black">0 0, 10 10</inkml:trace>
            <inkml:trace brushRef="#white">20 20, 30 30</inkml:trace>
        </inkml:ink>`;
        const svg = inkmlToSvg(blackAndWhite) ?? "";

        // Lightness reflection maps black and white onto the same black-on-light/white-on-dark pair.
        expect((svg.match(/style="stroke:light-dark\(#000000, #ffffff\)"/gi) ?? [])).toHaveLength(2);
        expect(svg).not.toContain(`stroke="#000000"`);
        expect(svg).not.toContain(`stroke="#FFFFFF"`);

        // The adaptive <style> is emitted once, keyed to the embedding context's color-scheme.
        expect((svg.match(/<style>/g) ?? [])).toHaveLength(1);
        expect(svg).toContain("svg{color-scheme:light dark}");
    });

    it("adapts palette near-blacks like #333333 for dark mode, keeping them literal in light mode", () => {
        // The reported regression: OneNote's black-looking pens are per-client near-blacks
        // (#333333, #404040, ...), not #000000. Reflected lightness lands within a rounding error
        // of OneNote's own dark-mode rendering (#333333 -> #cbc8c8 in OneNote, #cccccc here).
        const nearBlacks = `<inkml:ink xmlns:inkml="http://www.w3.org/2003/InkML">
            <inkml:definitions>
                <inkml:brush xml:id="b33"><inkml:brushProperty name="color" value="#333333"/></inkml:brush>
                <inkml:brush xml:id="b40"><inkml:brushProperty name="color" value="#404040"/></inkml:brush>
            </inkml:definitions>
            <inkml:trace brushRef="#b33">0 0, 10 10</inkml:trace>
            <inkml:trace brushRef="#b40">20 20, 30 30</inkml:trace>
        </inkml:ink>`;
        const svg = inkmlToSvg(nearBlacks) ?? "";

        expect(svg).toContain(`style="stroke:light-dark(#333333, #cccccc)"`);
        expect(svg).toContain(`style="stroke:light-dark(#404040, #bfbfbf)"`);
        expect(svg).not.toContain(`stroke="#333333"`);
    });

    it("keeps the hue when adapting saturated colors, in either direction", () => {
        // A dark blue must lighten to a readable *blue*, not to gray; a near-white pink must darken
        // to a red. The light-mode side always keeps the exact color OneNote sent.
        const saturated = `<inkml:ink xmlns:inkml="http://www.w3.org/2003/InkML">
            <inkml:definitions>
                <inkml:brush xml:id="navy"><inkml:brushProperty name="color" value="#000080"/></inkml:brush>
                <inkml:brush xml:id="pink"><inkml:brushProperty name="color" value="#ffe6e6"/></inkml:brush>
            </inkml:definitions>
            <inkml:trace brushRef="#navy">0 0, 10 10</inkml:trace>
            <inkml:trace brushRef="#pink">20 20, 30 30</inkml:trace>
        </inkml:ink>`;
        const svg = inkmlToSvg(saturated) ?? "";

        expect(svg).toContain(`style="stroke:light-dark(#000080, #7f7fff)"`);
        expect(svg).toContain(`style="stroke:light-dark(#190000, #ffe6e6)"`);
    });

    it("adapts named colors, keeping the original token on the as-sent side", () => {
        const named = `<inkml:ink xmlns:inkml="http://www.w3.org/2003/InkML">
            <inkml:definitions>
                <inkml:brush xml:id="b0"><inkml:brushProperty name="color" value="Black"/></inkml:brush>
                <inkml:brush xml:id="b1"><inkml:brushProperty name="color" value="white"/></inkml:brush>
            </inkml:definitions>
            <inkml:trace brushRef="#b0">0 0, 10 10</inkml:trace>
            <inkml:trace brushRef="#b1">20 20, 30 30</inkml:trace>
        </inkml:ink>`;
        const svg = inkmlToSvg(named) ?? "";

        expect(svg).toContain(`style="stroke:light-dark(Black, #ffffff)"`);
        expect(svg).toContain(`style="stroke:light-dark(#000000, white)"`);
    });

    it("leaves ink readable under both themes literal and omits the adaptive style", () => {
        // #FF0000 (lightness exactly 0.5) and a mid-light gray are untouched — including #cccccc,
        // which is a dark-mode *target* but as source ink is readable on both canvases — and with no
        // adapted strokes there's no <style> block. An unparseable color also stays literal.
        const readable = `<inkml:ink xmlns:inkml="http://www.w3.org/2003/InkML">
            <inkml:definitions>
                <inkml:brush xml:id="gray"><inkml:brushProperty name="color" value="#cccccc"/></inkml:brush>
                <inkml:brush xml:id="odd"><inkml:brushProperty name="color" value="not-a-color"/></inkml:brush>
            </inkml:definitions>
            <inkml:trace brushRef="#gray">0 0, 10 10</inkml:trace>
            <inkml:trace brushRef="#odd">20 20, 30 30</inkml:trace>
        </inkml:ink>`;
        const graySvg = inkmlToSvg(readable) ?? "";
        expect(graySvg).toContain(`stroke="#cccccc"`);
        expect(graySvg).toContain(`stroke="not-a-color"`);
        expect(graySvg).not.toContain("light-dark");
        expect(graySvg).not.toContain("<style>");

        const svg = inkmlToSvg(INKML) ?? "";
        expect(svg).toContain(`stroke="#FF0000"`);
        expect(svg).not.toContain("<style>");
    });

    it("tolerates malformed brush and trace data, falling back to defaults", () => {
        // An id-less brush is skipped; a name-less property and non-numeric width/height are ignored
        // (keeping the defaults); a bare (un-prefixed) brushRef still resolves; a trace with
        // unparseable coordinates contributes nothing.
        const messy = `<ink>
            <definitions>
                <brush><brushProperty name="color" value="#123456"/></brush>
                <brush xml:id="b1">
                    <brushProperty value="orphan"/>
                    <brushProperty name="width" value="wide"/>
                    <brushProperty name="height" value="tall"/>
                    <brushProperty name="color" value="#00AA00"/>
                </brush>
            </definitions>
            <trace brushRef="b1">0 0, 10 10</trace>
            <trace>squiggle</trace>
        </ink>`;
        const svg = inkmlToSvg(messy) ?? "";

        expect((svg.match(/<path/g) ?? [])).toHaveLength(1);
        expect(svg).toContain(`style="stroke:light-dark(#00AA00, #55ff55)"`); // dark green, adapted
        expect(svg).toContain(`stroke-width="70"`); // default width kept over the unparseable one
        expect(svg).not.toContain("#123456"); // the id-less brush is never referenced
    });

    it("scales fractional coordinates and survives a missing closing tag", () => {
        // Fractional coords are scaled up 10000x for precision; the truncated document (no </ink>)
        // still parses. 1.5→15000, 3.5→35000: 20000 wide + 2*padding(10).
        const svg = inkmlToSvg(`<ink><trace>1.5 2.5, 3.5 4.5</trace>`) ?? "";
        expect(svg).toContain(`viewBox="0 0 20020 20020"`);
    });

    it("returns null for empty input or ink with no traces", () => {
        expect(inkmlToSvg("")).toBeNull();
        expect(inkmlToSvg("   ")).toBeNull();
        expect(inkmlToSvg(`<inkml:ink xmlns:inkml="http://www.w3.org/2003/InkML"></inkml:ink>`)).toBeNull();
    });

    it("converts a real OneNote ink export (curly-brace brush ids, traceGroup, himetric coords)", () => {
        const svg = inkmlToSvg(readFileSync(join(FIXTURES_DIR, "sample.inkml"), "utf-8")) ?? "";

        // One <path> per <trace>, each resolving its brush color despite the `#{guid}{n}` brushRef ids.
        // The pens are all dark colors (including the palette's near-black #404040 rather than
        // #000000), so each adapts for dark mode while keeping its exact color in light mode.
        expect((svg.match(/<path/g) ?? []).length).toBe(42);
        for (const color of ["#404040", "#1353BA", "#167D1D", "#C62938", "#904C15"]) {
            expect(svg).toContain(`style="stroke:light-dark(${color}, #`);
        }
        expect(svg).toContain(`style="stroke:light-dark(#404040, #bfbfbf)"`);

        // Highlighter strokes (transparency 0.496, rectangle tip) keep their literal mid-light
        // yellow, render translucent, and use the larger height as their thickness rather than the
        // thin pen-style width.
        expect(svg).toContain(`opacity="0.50"`);
        expect(svg).toContain(`stroke="#FAF320" stroke-width="1000"`);

        // The displayed size is capped while the true himetric coordinate space stays in the viewBox.
        const dims = svg.match(/width="(\d+)" height="(\d+)" viewBox="0 0 (\d+) (\d+)"/);
        expect(Number(dims?.[1])).toBeLessThanOrEqual(800);
        expect(Number(dims?.[3])).toBeGreaterThan(20000);
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
