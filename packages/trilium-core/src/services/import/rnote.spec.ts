import { gzipSync, strToU8, unzlibSync } from "fflate";
import { describe, expect, it } from "vitest";

import { convertRnote, serializeRnote } from "./rnote.js";

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
    const urls = converted.images.map((_, index) => `api/attachments/a${index}/image/image.png`);
    return { ...converted, document: readDocument(serializeRnote(converted, urls)) };
}

/**
 * Reads a saved note, with its objects by kind: the strokes and the images without their `id`,
 * which their place in the note gives.
 */
function readDocument(content: string) {
    const document = JSON.parse(content);
    const objects: Record<string, unknown>[] = document.objects;
    return {
        ...document,
        strokes: objects.filter(({ o }) => o === undefined).map(({ id, ...stroke }) => stroke),
        images: objects.filter(({ o }) => o === "image").map(({ o, id, ...image }) => image),
        texts: objects.filter(({ o }) => o === "text").map(({ o, ...text }) => text)
    };
}

describe("convertRnote", () => {
    it("keeps the paper and the positions of the ink on a canvas without bounds, but not RNote's camera", () => {
        const { document } = convert(rnote([ brush([ [ 10, 20, 0.5 ], [ 10.52, 20, 1 ], [ 12, 23.04, 0.25 ] ]) ]));
        expect(document).toMatchObject({ version: 2, paper: "grid", layout: "infinite" });
        expect(document.objects).toEqual([ { id: "s1", w: 3, k: 100, p: [ 100, 200, 128, 5, 0, 127, 15, 30, -191 ] } ]);
        // The note opens fitting its ink, not where the RNote window was last scrolled and zoomed.
        expect(document).not.toHaveProperty("view");
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
            brush([ [ 0, 0, 0 ], [ 5, 0, 0 ] ]),
            brush([ [ 0, 0, 0.125 ], [ 5, 0, 0.125 ] ], smooth({ pressure_curve: "cbrt" })),
            brush([ [ 0, 0, 0.5 ], [ 5, 0, 0.5 ] ], smooth({ pressure_curve: "pow2" })),
            brush([ [ 0, 0, 0.5 ], [ 5, 0, 0.5 ] ], smooth({ pressure_curve: "pow3", stroke_width: 8 }))
        ]));
        expect(document.strokes.map(({ w, k }: { w: number, k: number }) => [ w, k ]))
            .toEqual([ [ 5.2, 0 ], [ 3, 0 ], [ 2, 0 ], [ 3, 100 ], [ 3, 0 ], [ 1.5, 0 ], [ 1, 0 ] ]);
        expect(document.strokes[3].p).toEqual([ 0, 0, 128, 50, 0, 127 ]);

        // A stroke of more points than a function takes arguments.
        const long = Array.from({ length: 300_000 }, (_, i) => [ i, i % 2, 0.5 ]);
        expect(convert(rnote([ brush(long) ])).document.strokes[0].w).toBe(3);
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
            { bitmapimage: { image: { data: "" } } },
            // Pixels that are not base64, which Node would decode where a browser throws.
            { bitmapimage: {
                image: { data: "AAAAAA!=", pixel_width: 1, pixel_height: 1, memory_format: "R8g8b8a8Premultiplied" },
                rectangle: { cuboid: { half_extents: [ 1, 1 ] }, transform: { affine: [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ] } }
            } }
        ]));
        expect(skipped).toEqual({ shapestroke: 2, textstroke: 2, bitmapimage: 2 });

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

    it("keeps the text boxes and the images where they are, next to the ink", () => {
        const text = (content: string, x: number, y: number, color = BLACK, ranges: object[] = []) => ({
            textstroke: {
                text: content,
                transform: { affine: [ 1, 0, 0, 0, 1, 0, x, y, 1 ] },
                text_style: { color, ranged_text_attributes: ranges }
            }
        });
        const RED = { r: 1, g: 0, b: 0, a: 1 };
        // Two premultiplied pixels: opaque red, and green at half opacity.
        const pixels = btoa(String.fromCharCode(255, 0, 0, 255, 0, 64, 0, 128));
        const image = (affine: number[]) => ({
            bitmapimage: {
                image: { data: pixels, pixel_width: 2, pixel_height: 1, memory_format: "R8g8b8a8Premultiplied" },
                rectangle: { cuboid: { half_extents: [ 1, 0.5 ] }, transform: { affine } }
            }
        });
        const converted = convert(rnote([
            text("Second", 0, 200),
            // The ranges count UTF-8 bytes: "Café" is five of them.
            text("Café\nau lait", 0, 300, RED, [ { range: { start: 0, end: 5 }, attribute: { text_color: BLACK } } ]),
            // 2 by 1 pixels scaled by 100 around (150, 150).
            image([ 100, 0, 0, 0, 100, 0, 150, 150, 1 ]),
            text("Title & <more>", 40, 0),
            text("Title & <more>", 40, 0),
            text("Hi", 0, 0),
            text("  ", 0, 400),
            // A box with a width and a font size of 12, twice as wide and three times as tall.
            { textstroke: { text: "Wide", transform: { affine: [ 2, 0, 0, 0, 3, 0, 500, 500, 1 ] }, text_style: { max_width: 400, font_size: 12 } } },
            // Shown 100 by 400, which is not the shape of its pixels.
            image([ 50, 0, 0, 0, 400, 0, 0, 0, 1 ]),
            brush([ [ 0, 0, 1 ] ]),
            { shapestroke: { shape: { rect: { cuboid: { half_extents: [ 0, 0 ] }, transform: { affine: [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ] } } }, style: smooth() } }
        ]));

        expect(converted.skipped).toEqual({ textstroke: 1, shapestroke: 1 });
        expect(converted.document.strokes).toHaveLength(1);
        // The text starts where it did, inside the padding of the box, at the size it had. The box
        // is as wide as the longest line at RNote's font size of 32, or as RNote wrapped it.
        expect(converted.document.texts).toEqual([
            { id: "rnote1", x: -8, y: 196, w: 131.2, s: 32, html: "<p>Second</p>" },
            { id: "rnote2", x: -8, y: 296, w: 150.4, s: 32, html: "<p>Café<span style=\"color:#ff0000;--tn-color:#ff0000;\"><br>au lait</span></p>" },
            { id: "rnote3", x: 32, y: -4, w: 284.8, s: 32, html: "<p>Title &amp; &lt;more&gt;</p>" },
            { id: "rnote4", x: -8, y: -4, w: 80, s: 32, html: "<p>Hi</p>" },
            { id: "rnote5", x: 492, y: 496, w: 816, s: 24, html: "<p>Wide</p>" }
        ]);
        expect(converted.document.images).toEqual([
            { url: "api/attachments/a0/image/image.png", x: 50, y: 100, w: 200, h: 100 },
            { url: "api/attachments/a1/image/image.png", x: -50, y: -200, w: 100, h: 400 }
        ]);
        // An image that has no URL is left out.
        expect(readDocument(serializeRnote(converted, [ undefined, "api/attachments/b/image/b.png" ])).images)
            .toEqual([ { url: "api/attachments/b/image/b.png", x: -50, y: -200, w: 100, h: 400 } ]);
        expect(readDocument(serializeRnote(converted)).images).toEqual([]);
        // The images lie under the strokes, and the text boxes over them.
        expect(converted.document.objects.map(({ o, id }: Record<string, unknown>) => o ?? id))
            .toEqual([ "image", "image", "s1", "text", "text", "text", "text", "text" ]);

        // Each PNG holds the pixels as they are, with their alpha no longer premultiplied.
        for (const { png } of converted.images) {
            expect([ ...png.slice(0, 8) ]).toEqual([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ]);
            const view = new DataView(png.buffer, png.byteOffset);
            expect([ view.getUint32(16), view.getUint32(20) ]).toEqual([ 2, 1 ]);
            const idatLength = view.getUint32(33);
            expect(String.fromCharCode(...png.slice(37, 41))).toBe("IDAT");
            expect([ ...unzlibSync(png.slice(41, 41 + idatLength)) ]).toEqual([ 0, 255, 0, 0, 255, 0, 128, 0, 128 ]);
        }

        // A document of text alone is a handwriting note too.
        const typed = convert(rnote([ text("Typed", 0, 0) ]));
        expect(typed.document).toMatchObject({ layout: "infinite", strokes: [], texts: [ { html: "<p>Typed</p>" } ] });

        // The pixels of a screenshot, transparent, are millions of base64 characters.
        const side = 1024;
        const screenshot = convert(rnote([ { bitmapimage: {
            image: {
                data: `${"A".repeat(Math.floor(side * side * 4 / 3) * 4)}AA==`,
                pixel_width: side, pixel_height: side, memory_format: "R8g8b8a8Premultiplied"
            },
            rectangle: { cuboid: { half_extents: [ 1, 1 ] }, transform: { affine: [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ] } }
        } } ]));
        expect(screenshot.skipped).toEqual({});
        expect(screenshot.images).toHaveLength(1);
    });

    it("draws what a component leaves out as RNote does, and skips one it cannot draw", () => {
        const path = (start: object, ...ends: object[]) => ({ start, segments: ends.map((end) => ({ lineto: { end } })) });
        // One transparent pixel.
        const pixel = { data: "AAAAAA==", pixel_width: 1, pixel_height: 1, memory_format: "R8g8b8a8Premultiplied" };
        const cuboid = { half_extents: [ 1, 1 ] };
        const { document, skipped } = convert(rnote([
            // No width, no pressure, an end without a position, and a color without its alpha.
            { brushstroke: {
                path: path({ pos: [ 0, 0 ] }, {}, { pos: [ 10, 0 ] }),
                style: { smooth: { stroke_color: { r: 0, g: 0, b: 0 } } }
            } },
            // A line in a style without a width or a color.
            { shapestroke: { shape: { line: { start: [ 0, 0 ], end: [ 0, 10 ] } }, style: { smooth: {} } } },
            // A range that sets no color.
            { textstroke: {
                text: "Bold", transform: { affine: [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ] },
                text_style: { ranged_text_attributes: [ { range: { start: 0, end: 4 }, attribute: { font_weight: 700 } } ] }
            } },
            // Without a style, without a point, without a style, and with an end that is not a number.
            { brushstroke: { path: path({ pos: [ 0, 0 ] }) } },
            { brushstroke: { path: path({}), style: smooth() } },
            { shapestroke: { shape: { line: { start: [ 0, 0 ], end: [ 0, 10 ] } } } },
            { shapestroke: { shape: { line: { start: [ 0, 0 ], end: [ "10", 0 ] } }, style: smooth() } },
            // Without a rectangle, with fewer pixels than it says, and shown at no width.
            { bitmapimage: { image: pixel } },
            { bitmapimage: { image: { ...pixel, pixel_width: 2 }, rectangle: { cuboid, transform: { affine: [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ] } } } },
            { bitmapimage: { image: pixel, rectangle: { cuboid, transform: { affine: [ 0, 0, 0, 0, 1, 0, 0, 0, 1 ] } } } }
        ]));

        expect(skipped).toEqual({ brushstroke: 2, shapestroke: 2, bitmapimage: 3 });
        expect(document.strokes).toEqual([
            { w: 2, k: 0, p: [ 0, 0, 128, 100, 0, 0 ] },
            { w: 2, k: 0, p: [ 0, 0, 128, 0, 50, 0, 0, 50, 0 ] }
        ]);
        expect(document.texts.map(({ html }: { html: string }) => html)).toEqual([ "<p>Bold</p>" ]);
    });

    it("returns nothing for a file that is not an RNote document or holds nothing it can convert", () => {
        expect(convertRnote(strToU8("not gzipped"))).toBeUndefined();
        expect(convertRnote(gzipSync(strToU8("not JSON")))).toBeUndefined();
        expect(convertRnote(gzipSync(strToU8(JSON.stringify({ version: "0.14.2", data: {} }))))).toBeUndefined();
        expect(convertRnote(rnote([ { textstroke: { text: " " } }, { vectorimage: {} }, null ]))).toBeUndefined();
    });
});
