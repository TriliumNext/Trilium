import { describe, expect, it } from "vitest";

import {
    adaptInkColor, decodePoints, dropRepeatedPoints, encodePoints, HANDWRITING_FORMAT_VERSION, lineToPoints, pathToPoints,
    polygonToPoints, reflectLightness, serializeImportedHandwriting
} from "./handwriting.js";

describe("serializeImportedHandwriting", () => {
    it("lists the images, the strokes and the text boxes as objects, in the order they are drawn", () => {
        const url = "api/attachments/abc/image/a.png";
        const content = serializeImportedHandwriting({
            paper: "grid",
            strokes: [ JSON.stringify({ w: 3, p: [ 1, 2, 128 ] }), JSON.stringify({ t: "h", w: 20, p: [ 3, 4, 128 ] }) ],
            images: [ { url, x: 10.04, y: 20, w: 300.26, h: 150 } ],
            texts: [ { id: "box", x: 1.04, y: 2, w: 100, s: 12.04, html: "<p>a</p>" }, { id: "plain", x: 0, y: 0, w: 50, html: "" } ]
        });
        expect(JSON.parse(content)).toEqual({
            version: HANDWRITING_FORMAT_VERSION, paper: "grid", layout: "infinite",
            objects: [
                { o: "image", id: "i1", url, x: 10, y: 20, w: 300.3, h: 150 },
                { id: "s1", w: 3, p: [ 1, 2, 128 ] },
                { id: "s2", t: "h", w: 20, p: [ 3, 4, 128 ] },
                { o: "text", id: "box", x: 1, y: 2, w: 100, s: 12, html: "<p>a</p>" },
                { o: "text", id: "plain", x: 0, y: 0, w: 50, html: "" }
            ]
        });
        expect(JSON.parse(serializeImportedHandwriting({ paper: "blank", strokes: [] })).objects).toEqual([]);
    });
});

describe("reflectLightness", () => {
    it("mirrors the lightness of a gray exactly", () => {
        // #333333 and #404040 are the near-blacks of OneNote's pens.
        expect([ "#333333", "#404040", "#000000", "#ffffff", "#888" ].map(reflectLightness))
            .toEqual([ "#cccccc", "#bfbfbf", "#ffffff", "#000000", "#777777" ]);
    });

    it("keeps the hue and the saturation of a color, in either direction", () => {
        expect([ "#800000", "#008000", "#000080", "#800080", "#ffe6e6", "#004F8B" ].map(reflectLightness))
            .toEqual([ "#ff7f7f", "#7fff7f", "#7f7fff", "#ff7fff", "#190000", "#74c3ff" ]);
    });

    it("returns nothing for a color that is not written in hexadecimal", () => {
        expect([ "red", "rgb(0, 0, 0)", "#12345", "#ggg", "auto", "" ].map(reflectLightness)).toEqual(Array(6).fill(undefined));
    });
});

describe("adaptInkColor", () => {
    it("lightens dark ink in a dark theme and darkens near-white ink in a light one", () => {
        // Dark ink, which a dark theme would hide: mirrored there only.
        expect(adaptInkColor("#004f8b", true)).toBe("#74c3ff");
        expect(adaptInkColor("#004f8b", false)).toBe("#004f8b");
        // Near-white ink, which a light theme would hide: mirrored there only.
        expect(adaptInkColor("#fff0f0", false)).toBe("#0f0000");
        expect(adaptInkColor("#fff0f0", true)).toBe("#fff0f0");
        // A color readable on both is drawn as it is, and so is one that cannot be read.
        for (const color of [ "#e64d4d", "#ffeb3b", "#4de64d", "red" ]) {
            expect([ adaptInkColor(color, true), adaptInkColor(color, false) ]).toEqual([ color, color ]);
        }
    });
});

describe("stroke points", () => {
    it("saves each point as the difference from the one before, and reads it back", () => {
        // The pressure is saved out of 255, and a triple left incomplete is dropped.
        const encoded = encodePoints([ 1.04, 2, 0.5, 1.5, 2, 1, 9 ]);
        expect(encoded).toEqual([ 10, 20, 128, 5, 0, 127 ]);
        expect(decodePoints(encoded)).toEqual([ 1, 2, 128 / 255, 1.5, 2, 1 ]);
    });

    it("reads nothing from a stroke holding a value that is not a finite number", () => {
        expect(decodePoints([ 1, 2, "3" ])).toBeUndefined();
        expect(decodePoints([ 1, 2, Number.NaN ])).toBeUndefined();
        // Two finite differences whose sum is not.
        expect(decodePoints([ Number.MAX_VALUE, 0, 0, Number.MAX_VALUE, 0, 0 ])).toBeUndefined();
    });

    it("drops a point that falls on the one before it at the saved precision", () => {
        expect(dropRepeatedPoints([ 0, 0, 0.1, 0.04, 0.02, 0.9, 0.1, 0, 0.5 ])).toEqual([ 0, 0, 0.1, 0.1, 0, 0.5 ]);
    });
});

describe("shape points", () => {
    it("builds a line of three points at one pressure", () => {
        expect(lineToPoints({ fromX: 0, fromY: 10, toX: 100, toY: 30 }, 0.4))
            .toEqual([ 0, 10, 0.4, 50, 20, 0.4, 100, 30, 0.4 ]);
    });

    it("crowds the points of a path toward the corners between its segments", () => {
        // The repeated vertex makes a segment of no length, which adds no points.
        const points = pathToPoints([ [ 0, 0 ], [ 8, 0 ], [ 8, 0 ], [ 8, 8 ] ], 0.5);
        const positions: string[] = [];
        for (let i = 0; i < points.length; i += 3) {
            expect(points[i + 2]).toBe(0.5);
            positions.push(`${points[i]},${points[i + 1]}`);
        }
        expect(positions).toEqual([ "0,0", "4,0", "6,0", "7,0", "8,0", "8,1", "8,2", "8,4", "8,8" ]);
    });

    it("runs around a polygon from the middle of its first side", () => {
        const points = polygonToPoints([ [ 0, 0 ], [ 8, 0 ], [ 8, 8 ], [ 0, 8 ] ], 0.5);
        expect(points.slice(0, 3)).toEqual([ 4, 0, 0.5 ]);
        expect(points.slice(-3)).toEqual([ 4, 0, 0.5 ]);
        const positions = new Set<string>();
        for (let i = 0; i < points.length; i += 3) {
            positions.add(`${points[i]},${points[i + 1]}`);
        }
        expect([ "0,0", "8,0", "8,8", "0,8" ].every((corner) => positions.has(corner))).toBe(true);
    });
});
