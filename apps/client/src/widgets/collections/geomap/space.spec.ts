import { MercatorCoordinate } from "maplibre-gl";
import { describe, expect, it } from "vitest";

import { buildNote } from "../../../test/easy-froca";
import { geoSpace, imageSpace, isShapeNote, locationOf, parseImageExtent, shapeOf } from "./space";

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

describe("imageSpace with named corners", () => {
    const size = { width: 1000, height: 500 };
    // A y-up world whose origin is the middle of the image, as a game map often is.
    const extent = parseImageExtent("-2000,1000 2000,-1000");
    const space = imageSpace(size, extent);
    const pixels = imageSpace(size);

    it("puts the corners and the origin where the map names them", () => {
        expect(space.parseLocation("-2000,1000")).toEqual(pixels.parseLocation("0,0"));
        expect(space.parseLocation("2000,-1000")).toEqual(pixels.parseLocation("1000,500"));
        expect(space.parseLocation("0,0")).toEqual(pixels.parseLocation("500,250"));
        // Up is up: a larger y stands higher on the image.
        const higher = space.parseLocation("0,500");
        const origin = space.parseLocation("0,0");
        expect(higher && origin && higher[1] > origin[1]).toBe(true);
    });

    it("stores what it reads, rounded to a hundredth of a pixel and shown to a whole one", () => {
        const point = space.parseLocation("123.456,-78.9");
        if (!point) throw new Error("unreadable");
        // 4 units a pixel: a hundredth of a pixel is 0.04, which takes two decimals.
        expect(space.serializeLocation(point)).toBe("123.46,-78.9");
        expect(space.formatLocation(point)).toBe("123, -79");
        expect(space.formatLocation(point, true)).toBe("123.46, -78.9");

        const fine = imageSpace(size, parseImageExtent("0,0 1,0.5"));
        const finePoint = fine.parseLocation("0.123456,0.25");
        if (!finePoint) throw new Error("unreadable");
        expect(fine.serializeLocation(finePoint)).toBe("0.12346,0.25");
    });

    it("keeps a marker on the same ground when the image is replaced by a larger one", () => {
        const larger = imageSpace({ width: 4000, height: 2000 }, extent);
        const pixelsOfLarger = imageSpace({ width: 4000, height: 2000 });

        expect(larger.parseLocation("1000,500")).toEqual(space.parseLocation("1000,500"));
        expect(pixelsOfLarger.formatLocation(larger.parseLocation("1000,500") ?? [ 0, 0 ])).toBe("3000, 500");
    });

    it("measures circles in the map's units, as an ellipse where the axes differ", () => {
        // 1 unit a pixel across, 4 units a pixel down.
        const stretched = imageSpace(size, parseImageExtent("0,0 1000,2000"));
        const shape = shapeOrThrow(stretched.parseShape("circle:500,1000 200"));
        if (shape.type !== "circle" || !shape.ring) throw new Error("expected a circle with a ring");

        const ringPixels = shape.ring.map((point) => pixels.serializeLocation(point).split(",").map(Number));
        const width = Math.max(...ringPixels.map(([ x ]) => x)) - Math.min(...ringPixels.map(([ x ]) => x));
        const height = Math.max(...ringPixels.map(([ , y ]) => y)) - Math.min(...ringPixels.map(([ , y ]) => y));
        expect(width).toBeCloseTo(400, 0);
        expect(height).toBeCloseTo(100, 0);

        expect(stretched.serializeShape(shape)).toBe("circle:500,1000 200");
        for (const value of [ "line:-2000,1000 0,0", "polygon:0,0 100,0 100,-50" ]) {
            expect(space.serializeShape(shapeOrThrow(space.parseShape(value)))).toBe(value);
        }
    });

    it("reads corners only where both are pairs spanning something", () => {
        expect(parseImageExtent("-2000,1000 2000,-1000")).toEqual({ topLeft: [ -2000, 1000 ], bottomRight: [ 2000, -1000 ] });
        expect(parseImageExtent("  0,0   10,5 ")).toEqual({ topLeft: [ 0, 0 ], bottomRight: [ 10, 5 ] });
        // Four numbers in a row are not two corners.
        for (const value of [ "", "0,0", "0,0 10", "0,0 0,5", "0,0 10,0", "a,b c,d", "0,0 1,1 2,2", "-100,-100,1200,512", null, undefined ]) {
            expect(parseImageExtent(value)).toBeNull();
        }
    });
});

function shapeOrThrow<T>(shape: T | null): T {
    if (!shape) throw new Error("unreadable shape");
    return shape;
}
