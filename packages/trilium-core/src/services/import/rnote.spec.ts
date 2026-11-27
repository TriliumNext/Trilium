import { gzipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";

import { convertRnote } from "./rnote.js";

const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const GREEN = { r: 0.148, g: 0.632, b: 0.41, a: 1 };

function smooth(overrides: Record<string, unknown> = {}) {
    return {
        smooth: {
            stroke_width: 6, stroke_color: BLACK, fill_color: null, pressure_curve: "linear",
            line_style: "solid", line_cap: "straight", ...overrides
        }
    };
}

/** A pen stroke through `[x, y, pressure]` triples. */
function brush(elements: number[][], style = smooth()) {
    const [ start, ...rest ] = elements.map(([ x, y, pressure ]) => ({ pos: [ x, y ], pressure }));
    return { brushstroke: { path: { start, segments: rest.map((end) => ({ lineto: { end } })) }, style } };
}

function rnote(strokes: (object | null)[], times?: number[], document: Record<string, unknown> = {}) {
    return gzipSync(strToU8(JSON.stringify({
        version: "0.14.2",
        data: {
            engine_snapshot: {
                document: { config: { background: { pattern: "grid" }, layout: "infinite" } },
                camera: { offset: [ -96, 300 ], size: [ 1920, 1000 ], zoom: 2 },
                stroke_components: strokes.map((value) => ({ value, version: 1 })),
                chrono_components: strokes.map((value, index) => ({
                    value: value && { t: times?.[index] ?? index, layer: { user_layer: 0 } }, version: 1
                })),
                ...document
            }
        }
    })));
}

function convert(file: Uint8Array) {
    const converted = convertRnote(file);
    if (!converted) throw new Error("The file was not converted.");
    return { ...converted, document: JSON.parse(converted.content) };
}

describe("convertRnote", () => {
    it("keeps the paper, the view and the positions of the ink on a canvas without bounds", () => {
        const { document } = convert(rnote([ brush([ [ 10, 20, 0.5 ], [ 10.52, 20, 1 ], [ 12, 23.04, 0.25 ] ]) ]));
        expect(document).toMatchObject({
            version: 1, paper: "grid", layout: "infinite", view: { x: 432, y: 400, zoom: 2 }
        });
        // Tenths of a unit and a pressure out of 255, each point as the difference from the last.
        expect(document.strokes).toEqual([ { w: 3, k: 100, p: [ 100, 200, 128, 5, 0, 127, 15, 30, -191 ] } ]);

        const paper = (pattern: unknown) => convert(rnote(
            [ brush([ [ 0, 0, 1 ] ]) ], undefined, { document: { config: { background: { pattern } } } }
        )).document.paper;
        expect([ "none", "lines", "dots", "isometric_grid", undefined ].map(paper))
            .toEqual([ "blank", "ruled", "dots", "grid", "blank" ]);
    });

    it("gives a stroke the width RNote drew it at", () => {
        const { document } = convert(rnote([
            // One pressure all along: the width it has there, whatever the pressure.
            brush([ [ 0, 0, 1 ], [ 5, 0, 1 ] ], smooth({ stroke_width: 5.2 })),
            brush([ [ 0, 0, 0.5 ], [ 5, 0, 0.5 ] ]),
            // A width that ignores the pressure.
            brush([ [ 0, 0, 0.2 ], [ 5, 0, 0.9 ] ], smooth({ pressure_curve: "const", stroke_width: 2 })),
            // A curve of the pressure, on a stroke of twice the size at full pressure.
            brush([ [ 0, 0, 0.25 ], [ 5, 0, 1 ] ], smooth({ pressure_curve: "sqrt" })),
            brush([ [ 0, 0, 0 ], [ 5, 0, 0 ] ])
        ]));
        expect(document.strokes.map(({ w, k }: { w: number, k: number }) => [ w, k ]))
            .toEqual([ [ 5.2, 0 ], [ 3, 0 ], [ 2, 0 ], [ 3, 100 ] ]);
        expect(document.strokes[3].p).toEqual([ 0, 0, 128, 50, 0, 127 ]);
    });

    it("maps black ink to the text color and translucent ink to the highlighter", () => {
        const { document } = convert(rnote([
            brush([ [ 0, 0, 1 ] ]),
            brush([ [ 0, 0, 1 ] ], smooth({ stroke_color: GREEN })),
            brush([ [ 0, 0, 0.5 ], [ 9, 0, 1 ] ], smooth({ stroke_color: { r: 1, g: 1, b: 0, a: 0.4 }, stroke_width: 20 })),
            brush([ [ 0, 0, 1 ] ], smooth({ stroke_color: { ...GREEN, a: 0 } }))
        ]));
        expect(document.strokes.map(({ p, ...look }: { p: number[] }) => look)).toEqual([
            { w: 6, k: 0 },
            { c: "#26a169", w: 6, k: 0 },
            { t: "h", c: "#ffff00", w: 20 }
        ]);
    });

    it("draws in the order of RNote's counter, and leaves out erased strokes and repeated points", () => {
        const { document } = convert(rnote(
            [
                brush([ [ 30, 0, 1 ] ]),
                null,
                brush([ [ 10, 0, 1 ], [ 10.01, 0, 1 ], [ 10, 0.04, 1 ], [ 11, 0, 1 ] ]),
                brush([ [ 20, 0, 1 ] ])
            ],
            [ 7, 0, 2, 5 ]
        ));
        expect(document.strokes.map(({ p }: { p: number[] }) => p))
            .toEqual([ [ 100, 0, 128, 10, 0, 0 ], [ 200, 0, 128 ], [ 300, 0, 128 ] ]);
    });

    it("turns lines and rectangles into strokes, and counts what a handwriting note cannot hold", () => {
        const shape = (shape: object) => ({ shapestroke: { shape, style: smooth({ stroke_width: 2, stroke_color: GREEN }) } });
        const rect = (halfExtents: number[], affine: number[]) =>
            shape({ rect: { cuboid: { half_extents: halfExtents }, transform: { affine } } });
        const { document, skipped } = convert(rnote([
            shape({ line: { start: [ 0, 10 ], end: [ 100, 30 ] } }),
            // Scaled to twice its size around (100, 50); RNote stores a negative extent as drawn.
            rect([ -20, 10 ], [ 2, 0, 0, 0, 2, 0, 100, 50, 1 ]),
            rect([ 0, 0 ], [ 1, 0, 0, 0, 1, 0, 5, 5, 1 ]),
            shape({ ellipse: { radii: [ 5, 5 ] } }),
            { textstroke: { text: "Title" } },
            { textstroke: { text: "Title" } },
            { bitmapimage: { image: { data: "" } } }
        ]));
        expect(skipped).toEqual({ shapestroke: 2, textstroke: 2, bitmapimage: 1 });

        const [ line, box ] = document.strokes;
        expect(line).toEqual({ c: "#26a169", w: 2, k: 0, p: [ 0, 100, 128, 500, 100, 0, 500, 100, 0 ] });

        // The box runs from the middle of a side through the four corners and back.
        let [ x, y ] = [ 0, 0 ];
        const visited: string[] = [];
        for (let i = 0; i < box.p.length; i += 3) {
            x += box.p[i];
            y += box.p[i + 1];
            visited.push(`${x / 10},${y / 10}`);
            expect(x === 600 || x === 1400 || y === 300 || y === 700).toBe(true);
        }
        expect(visited[0]).toBe("100,30");
        expect(visited[visited.length - 1]).toBe("100,30");
        const corners = [ "60,30", "60,70", "140,70", "140,30" ];
        expect(visited.filter((position) => corners.includes(position))).toEqual(corners);
        // Points crowd toward each corner, which keeps it sharp once the stroke is smoothed.
        expect(visited).toContain("60,31");
    });

    it("returns nothing for a file that is not an RNote document or holds no ink", () => {
        expect(convertRnote(strToU8("not gzipped"))).toBeUndefined();
        expect(convertRnote(gzipSync(strToU8("not JSON")))).toBeUndefined();
        expect(convertRnote(gzipSync(strToU8(JSON.stringify({ version: "0.14.2", data: {} }))))).toBeUndefined();
        expect(convertRnote(rnote([ { textstroke: { text: "Typed" } }, null ]))).toBeUndefined();
    });
});
