import { describe, expect, it } from "vitest";

import { circleRing, closeRing, parseGeoShape, polygonFromRing, ringCenter, serializeGeoShape } from "./shapes";

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

    it("writes a circle as its centre and its reach, not the ring that would approximate it", () => {
        expect(serializeGeoShape({
            type: "circle",
            center: [ 2.2946944444, 48.8580925 ],
            radiusMeters: 512.3456
        })).toBe("circle:48.858093,2.294694 512.3");
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

        const circle = { type: "circle", center: [ 13.404954, 52.520008 ], radiusMeters: 500 } as const;
        expect(parseGeoShape(serializeGeoShape(circle))).toEqual(circle);
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

    it("holds a circle to a centre and a positive reach", () => {
        expect(parseGeoShape("circle:48.85,2.29 500")).toEqual({
            type: "circle",
            center: [ 2.29, 48.85 ],
            radiusMeters: 500
        });
        // No radius, two centres, a reach of nothing, and one of nonsense.
        expect(parseGeoShape("circle:48.85,2.29")).toBeNull();
        expect(parseGeoShape("circle:48.85,2.29 48.86,2.35 500")).toBeNull();
        expect(parseGeoShape("circle:48.85,2.29 0")).toBeNull();
        expect(parseGeoShape("circle:48.85,2.29 far")).toBeNull();
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
        expect(ringCenter([])).toBeNull();
    });

    it("walks a circle out as a ring of points its reach away from the centre", () => {
        const center: [number, number] = [ 2.294694, 48.858093 ];
        const radiusMeters = 500;
        const ring = circleRing(center, radiusMeters);

        expect(ring).toHaveLength(64);
        // Not closed — the closing repeat is closeRing's to add, as for any other ring.
        expect(ring[0]).not.toEqual(ring[ring.length - 1]);
        // Every point stands the same distance out, give or take the arithmetic.
        for (const point of ring) {
            expect(haversineMeters(center, point)).toBeCloseTo(radiusMeters, 0);
        }
        // And the ring stands around where it was asked to.
        const [ lng, lat ] = ringCenter(ring) ?? [ NaN, NaN ];
        expect(lng).toBeCloseTo(center[0], 4);
        expect(lat).toBeCloseTo(center[1], 4);
    });
});

/** The distance between two points the way the ring generator must honour it: over the sphere. */
function haversineMeters([ lng1, lat1 ]: [number, number], [ lng2, lat2 ]: [number, number]): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
