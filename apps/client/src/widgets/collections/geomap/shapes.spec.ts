import { describe, expect, it } from "vitest";

import { closeRing, parseGeoShape, polygonFromRing, serializeGeoShape } from "./shapes";

describe("serializeGeoShape", () => {
    it("writes lat,lng pairs behind the kind's prefix, rounded but not padded", () => {
        expect(serializeGeoShape({
            type: "line",
            coordinates: [
                [ 2.2946944444, 48.8580925 ],
                [ 2.35, 48.86 ]
            ]
        })).toBe("line:48.858093,2.294694 48.86,2.35");

        expect(serializeGeoShape({
            type: "polygon",
            coordinates: [ [ 1, 2 ], [ 3, 4 ], [ 5, 6 ] ]
        })).toBe("polygon:2,1 4,3 6,5");
    });

    it("round-trips through parseGeoShape", () => {
        const coordinates: [number, number][] = [
            [ 13.404954, 52.520008 ],
            [ 13.412, 52.531 ],
            [ -0.1276, 51.5072 ]
        ];
        for (const type of [ "line", "polygon" ] as const) {
            expect(parseGeoShape(serializeGeoShape({ type, coordinates }))).toEqual({ type, coordinates });
        }
    });
});

describe("parseGeoShape", () => {
    it("reads a shape back in GeoJSON lng,lat order", () => {
        expect(parseGeoShape("line:48.858093,2.294694 48.86,2.35")).toEqual({
            type: "line",
            coordinates: [
                [ 2.294694, 48.858093 ],
                [ 2.35, 48.86 ]
            ]
        });
    });

    it("tolerates surrounding and repeated whitespace", () => {
        expect(parseGeoShape("line: 1,2  3,4 ")?.coordinates).toEqual([ [ 2, 1 ], [ 4, 3 ] ]);
    });

    it("refuses what is not a shape", () => {
        // An unknown kind, no kind at all, and plain junk alike.
        expect(parseGeoShape("blob:1,2 3,4 5,6")).toBeNull();
        expect(parseGeoShape("1,2 3,4")).toBeNull();
        expect(parseGeoShape("")).toBeNull();
        // Malformed points: a missing half, a non-number, a stray comma.
        expect(parseGeoShape("line:1,2 3")).toBeNull();
        expect(parseGeoShape("line:1,2 x,4")).toBeNull();
        expect(parseGeoShape("line:1,2 3,4,5")).toBeNull();
    });

    it("holds each kind to its own minimum: one point is no line, and two no area", () => {
        expect(parseGeoShape("line:1,2")).toBeNull();
        expect(parseGeoShape("line:1,2 3,4")).not.toBeNull();
        expect(parseGeoShape("polygon:1,2 3,4")).toBeNull();
        expect(parseGeoShape("polygon:1,2 3,4 5,6")).not.toBeNull();
    });
});

describe("rings", () => {
    it("drops the closing repeat a drawing tool spells out, and leaves an open ring alone", () => {
        const open: [number, number][] = [ [ 1, 2 ], [ 3, 4 ], [ 5, 6 ] ];
        expect(polygonFromRing([ ...open, [ 1, 2 ] ]).coordinates).toEqual(open);
        expect(polygonFromRing(open).coordinates).toEqual(open);
    });

    it("closes a ring back up for GeoJSON", () => {
        expect(closeRing([ [ 1, 2 ], [ 3, 4 ], [ 5, 6 ] ])).toEqual([ [ 1, 2 ], [ 3, 4 ], [ 5, 6 ], [ 1, 2 ] ]);
    });

    it("survives a ring with nothing in it", () => {
        expect(polygonFromRing([]).coordinates).toEqual([]);
    });
});
