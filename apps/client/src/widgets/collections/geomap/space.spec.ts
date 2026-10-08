import { MercatorCoordinate } from "maplibre-gl";
import { describe, expect, it } from "vitest";

import { buildNote } from "../../../test/easy-froca";
import { geoSpace, imageSpace, isShapeNote, locationOf, shapeOf } from "./space";

describe("geoSpace", () => {
    it("stores latitude first and hands MapLibre longitude first", () => {
        expect(geoSpace.parseLocation("45.796,24.147")).toEqual([ 24.147, 45.796 ]);
        expect(geoSpace.serializeLocation([ 24.147, 45.796 ])).toBe("45.796,24.147");
        expect(geoSpace.formatLocation([ 24.147, 45.796 ])).toBe("45.796000, 24.147000");
    });
});

describe("imageSpace", () => {
    const space = imageSpace({ width: 2048, height: 1024 });

    it("round-trips a pixel position through MapLibre's coordinates", () => {
        const point = space.parseLocation("120.5,45");
        expect(point).not.toBeNull();
        if (!point) return;
        expect(space.serializeLocation(point)).toBe("120.5,45");
        expect(space.formatLocation(point)).toBe("121, 45");
        expect(space.formatLocation(point, true)).toBe("120.5, 45");
        expect(space.parseLocation("not a point")).toBeNull();
    });

    it("lays the image out linearly in Mercator units, top-left corner first", () => {
        const [ topLeft, topRight, bottomRight, bottomLeft ] = space.corners;
        expect(space.parseLocation("0,0")).toEqual(topLeft);
        expect(space.parseLocation("2048,1024")).toEqual(bottomRight);
        expect(topLeft[1]).toBeGreaterThan(bottomLeft[1]);
        expect(topRight[0]).toBeGreaterThan(topLeft[0]);

        // The pixel halfway across is halfway across in Mercator units, which latitude is not.
        const mercator = (pixel: string) => {
            const point = space.parseLocation(pixel);
            if (!point) throw new Error(`unreadable ${pixel}`);
            return MercatorCoordinate.fromLngLat({ lng: point[0], lat: point[1] });
        };
        const top = mercator("0,0");
        const middle = mercator("1024,512");
        const bottom = mercator("2048,1024");
        expect(middle.x).toBeCloseTo((top.x + bottom.x) / 2, 12);
        expect(middle.y).toBeCloseTo((top.y + bottom.y) / 2, 12);
    });

    it("keeps the camera's bounds inside one world, and allows zooming two levels past the pixels", () => {
        const [ [ west, south ], [ east, north ] ] = space.maxBounds;
        expect(west).toBeGreaterThan(-180);
        expect(east).toBeLessThan(180);
        expect(south).toBeGreaterThan(-85);
        expect(north).toBeLessThan(85);
        // 2048 pixels fill 256 at zoom 0, so zoom 3 is a pixel per pixel.
        expect(space.maxZoom).toBe(5);
    });

    it("round-trips lines and circles written in pixels", () => {
        for (const value of [ "line:10,20 30,40", "polygon:0,0 100,0 100,50", "circle:100,200 50" ]) {
            expect(space.serializeShape(shapeOrThrow(space.parseShape(value)))).toBe(value);
        }
    });

    it("draws a circle as a circle on the image, wherever on it the circle stands", () => {
        const shape = shapeOrThrow(space.parseShape("circle:1000,10 40"));
        if (shape.type !== "circle" || !shape.ring) throw new Error("expected a circle with a ring");

        for (const lngLat of shape.ring) {
            const pixel = space.serializeLocation(lngLat).split(",").map(Number);
            expect(Math.hypot(pixel[0] - 1000, pixel[1] - 10)).toBeCloseTo(40, 1);
        }
    });

    it("reads the labels of its own space only", () => {
        const marker = buildNote({ title: "Tavern", "#imagePosition": "10,20", "#geolocation": "1,2" });
        const shape = buildNote({ title: "Road", "#imageShape": "line:0,0 10,10" });

        expect(locationOf(marker, space)).toEqual(space.parseLocation("10,20"));
        expect(locationOf(marker, geoSpace)).toEqual([ 2, 1 ]);
        expect(isShapeNote(shape, space)).toBe(true);
        expect(isShapeNote(shape, geoSpace)).toBe(false);
        expect(shapeOf(marker, space)).toBeNull();
    });
});

function shapeOrThrow<T>(shape: T | null): T {
    if (!shape) throw new Error("unreadable shape");
    return shape;
}
