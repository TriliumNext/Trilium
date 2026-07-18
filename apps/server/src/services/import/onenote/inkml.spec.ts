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
    });

    it("works without namespace prefixes and falls back to a default brush", () => {
        const plain = `<ink><trace>0 0, 10 10</trace></ink>`;
        const svg = inkmlToSvg(plain) ?? "";
        expect(svg).toContain("<path");
        expect(svg).toContain(`stroke="#000000"`);
    });

    it("returns null for empty input or ink with no traces", () => {
        expect(inkmlToSvg("")).toBeNull();
        expect(inkmlToSvg("   ")).toBeNull();
        expect(inkmlToSvg(`<inkml:ink xmlns:inkml="http://www.w3.org/2003/InkML"></inkml:ink>`)).toBeNull();
    });

    it("converts a real OneNote ink export (curly-brace brush ids, traceGroup, himetric coords)", () => {
        const svg = inkmlToSvg(readFileSync(join(FIXTURES_DIR, "sample.inkml"), "utf-8")) ?? "";

        // One <path> per <trace>, each resolving its brush color despite the `#{guid}{n}` brushRef ids.
        expect((svg.match(/<path/g) ?? []).length).toBe(42);
        for (const color of ["#404040", "#1353BA", "#167D1D", "#C62938", "#904C15", "#FAF320"]) {
            expect(svg).toContain(`stroke="${color}"`);
        }

        // Highlighter strokes (transparency 0.496, rectangle tip) render translucent and use the
        // larger height as their thickness rather than the thin pen-style width.
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
