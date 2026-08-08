import { describe, expect, it } from "vitest";

import { parseGeoShape, serializeLine } from "./shapes";

describe("serializeLine", () => {
    it("writes lat,lng pairs behind the line prefix, rounded but not padded", () => {
        expect(serializeLine([
            [ 2.2946944444, 48.8580925 ],
            [ 2.35, 48.86 ]
        ])).toBe("line:48.858093,2.294694 48.86,2.35");
    });

    it("round-trips through parseGeoShape", () => {
        const coordinates: [number, number][] = [
            [ 13.404954, 52.520008 ],
            [ 13.412, 52.531 ],
            [ -0.1276, 51.5072 ]
        ];
        expect(parseGeoShape(serializeLine(coordinates))).toEqual({ type: "line", coordinates });
    });
});

describe("parseGeoShape", () => {
    it("reads a line back in GeoJSON lng,lat order", () => {
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

    it("refuses what is not a line", () => {
        // Another kind's prefix, no prefix at all, and plain junk alike.
        expect(parseGeoShape("polygon:1,2 3,4 5,6")).toBeNull();
        expect(parseGeoShape("1,2 3,4")).toBeNull();
        expect(parseGeoShape("")).toBeNull();
        // Too few points: one point is no line.
        expect(parseGeoShape("line:1,2")).toBeNull();
        // Malformed vertices: a missing half, a non-number, a stray comma.
        expect(parseGeoShape("line:1,2 3")).toBeNull();
        expect(parseGeoShape("line:1,2 x,4")).toBeNull();
        expect(parseGeoShape("line:1,2 3,4,5")).toBeNull();
    });
});
