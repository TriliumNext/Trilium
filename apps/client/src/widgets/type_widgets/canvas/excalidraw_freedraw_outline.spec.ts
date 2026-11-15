import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

type Point = [ number, number ];

interface FreedrawElement {
    points: Point[];
    pressures: number[];
    simulatePressure: boolean;
    strokeWidth: number;
    lastCommittedPoint: Point | null;
}

interface Stroke {
    points: Point[];
    pressures: number[];
    simulatePressure: boolean;
    strokeWidth: number;
}

interface Outline {
    getFreeDrawSvgPath: (element: FreedrawElement) => string;
    /** How many times `getFreeDrawSvgPath()` called perfect-freehand's `getStroke()`. */
    strokeCalls: number;
}

const BLOCK_START = "/* Trilium patch: incremental outline of a growing freedraw stroke */";
const BLOCK_END =
    "/* End of the Trilium patch: incremental outline of a growing freedraw stroke */";
/** What `getFreeDrawSvgPath()` does without the patch: it outlines every stroke from scratch. */
const NO_BLOCK = "var triliumFreedrawOutline = { getGrowingStrokePath: () => null };";

/**
 * Guards the incremental outline of the Excalidraw patch (hunk 9 in the `patching-excalidraw`
 * skill): `getFreeDrawSvgPath()` outlines a stroke that grows, as the one being drawn does, from
 * where its last outline stopped, with the block `triliumFreedrawOutline`. These tests run the dev
 * bundle's own `getFreeDrawSvgPath()` with the block of each bundle against the same function
 * without it, after every point of random strokes: the SVG paths must be the same, character for
 * character.
 */
describe("Excalidraw outline of a growing freedraw stroke (Trilium patch)", () => {
    // Vitest resolves the `development` export, so both folders come from `dist`.
    const entry = createRequire(import.meta.url).resolve("@excalidraw/excalidraw");
    const distDir = join(dirname(entry), "..");
    // The perfect-freehand that the bundles import.
    const { getStroke } = createRequire(join(distDir, "..", "package.json"))("perfect-freehand");
    const developmentSource = readScripts(join(distDir, "dev"));
    // `getFreeDrawSvgPath()` and the SVG path helpers that follow it.
    const region = developmentSource.slice(
        developmentSource.indexOf("function getFreeDrawSvgPath(element) {"),
        developmentSource.indexOf("// scene/Shape.ts"));

    function loadOutline(block: string): Outline {
        const outline = { strokeCalls: 0 } as Outline;
        const countingGetStroke = (...args: unknown[]) => {
            outline.strokeCalls++;
            return getStroke(...args);
        };
        outline.getFreeDrawSvgPath = new Function(
            "getStroke", `${block}\n${region}\nreturn getFreeDrawSvgPath;`)(countingGetStroke);
        return outline;
    }

    it.each([ "dev", "prod" ])("outlines a growing stroke as from scratch after every point (%s)",
        (bundle) => {
            const patched = loadOutline(readBlock(join(distDir, bundle)));
            const unpatched = loadOutline(NO_BLOCK);
            const mismatches: string[] = [];

            for (let seed = 1; seed <= 60; seed++) {
                const stroke = createStroke(seed);
                const element = createElement(stroke);
                for (let i = 0; i < stroke.points.length; i++) {
                    addPoint(element, stroke, i);
                    if (patched.getFreeDrawSvgPath(element)
                        !== unpatched.getFreeDrawSvgPath(element)) {
                        mismatches.push(`seed ${seed}, point ${i}`);
                        break;
                    }
                }
                // On pointer up the stroke is finished, and outlined with `last: true`.
                element.lastCommittedPoint = element.points[element.points.length - 1];
                if (patched.getFreeDrawSvgPath(element) !== unpatched.getFreeDrawSvgPath(element)) {
                    mismatches.push(`seed ${seed}, finished`);
                }
            }

            expect(mismatches).toEqual([]);
        });

    it.each([ "dev", "prod" ])("stops outlining a growing stroke from scratch (%s)", (bundle) => {
        const outline = loadOutline(readBlock(join(distDir, bundle)));
        const stroke = createStroke(1);
        stroke.points = Array.from({ length: 500 }, (_, i): Point => [ i * 3, Math.sin(i / 20) * 40 ]);
        stroke.pressures = stroke.points.map(() => 0.5);
        const element = createElement(stroke);
        for (let i = 0; i < 100; i++) {
            addPoint(element, stroke, i);
            outline.getFreeDrawSvgPath(element);
        }

        outline.strokeCalls = 0;
        for (let i = 100; i < stroke.points.length; i++) {
            addPoint(element, stroke, i);
            outline.getFreeDrawSvgPath(element);
        }

        expect(outline.strokeCalls).toBe(0);
    });

    it("outlines strokes drawn in turn, and a stroke whose width changes, as from scratch", () => {
        const patched = loadOutline(readBlock(join(distDir, "dev")));
        const unpatched = loadOutline(NO_BLOCK);
        const strokes = [ createStroke(7), createStroke(8) ];
        const elements = strokes.map(createElement);
        const mismatches: string[] = [];

        for (let round = 0; round < 150; round++) {
            for (const [ index, element ] of elements.entries()) {
                // The first stroke grows by three points between two outlines of the second.
                for (let step = 0; step < (index === 0 ? 3 : 1); step++) {
                    const { points } = strokes[index];
                    addPoint(element, strokes[index], element.points.length % points.length);
                    if (patched.getFreeDrawSvgPath(element)
                        !== unpatched.getFreeDrawSvgPath(element)) {
                        mismatches.push(`stroke ${index}, round ${round}`);
                    }
                }
            }
            if (round === 60) elements[0].strokeWidth *= 2;
        }

        expect(mismatches).toEqual([]);
    });
});

/** The code between the markers of the block, which must occur once in the bundle. */
function readBlock(dir: string) {
    const parts = readScripts(dir).split(BLOCK_START);
    expect(parts, dir).toHaveLength(2);
    const [ block, ...rest ] = parts[1].split(BLOCK_END);
    expect(rest, dir).toHaveLength(1);
    return block;
}

/** The text of the scripts in `dir`. */
function readScripts(dir: string) {
    return readdirSync(dir)
        .filter((file) => file.endsWith(".js"))
        .map((file) => readFileSync(join(dir, file), "utf8"))
        .join("\n");
}

function createElement(stroke: Stroke): FreedrawElement {
    const { simulatePressure, strokeWidth } = stroke;
    return { points: [], pressures: [], simulatePressure, strokeWidth, lastCommittedPoint: null };
}

/** Appends a point as Excalidraw does on each pointer move, with new arrays. */
function addPoint(element: FreedrawElement, stroke: Stroke, index: number) {
    element.points = [ ...element.points, stroke.points[index] ];
    element.pressures = element.simulatePressure
        ? element.pressures
        : [ ...element.pressures, stroke.pressures[index] ];
}

/**
 * A random stroke: gentle curves with sharp turns, repeated points, tiny and large steps, real or
 * simulated pressure, and one of the widths a pen stroke has in Trilium.
 */
function createStroke(seed: number): Stroke {
    const random = createRandom(seed);
    const simulatePressure = random() < 0.5;
    const strokeWidth = [ 0.5, 1, 2, 4 ][Math.floor(random() * 4)];
    const count = 30 + Math.floor(random() * 400);
    const points: Point[] = [ [ 0, 0 ] ];
    const pressures = [ random() ];
    let [ x, y ] = [ 0, 0 ];
    let angle = random() * 2 * Math.PI;

    for (let i = 1; i < count; i++) {
        angle += random() < 0.05
            ? Math.PI * (0.7 + random() * 0.6)
            : (random() - 0.5) * 0.8;
        const kind = random();
        const step = kind < 0.1 ? 0
            : kind < 0.3 ? random() * 0.5
                : kind < 0.9 ? 1 + random() * 6
                    : 10 + random() * 40;
        x += Math.cos(angle) * step;
        y += Math.sin(angle) * step;
        points.push([ x, y ]);
        pressures.push(Math.min(1, Math.max(0, pressures[i - 1] + (random() - 0.5) * 0.3)));
    }

    return { points, pressures, simulatePressure, strokeWidth };
}

/** mulberry32: the same strokes on every run. */
function createRandom(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
