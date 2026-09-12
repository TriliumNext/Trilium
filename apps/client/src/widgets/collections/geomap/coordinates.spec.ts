/**
 * Reading a point out of the search bar: which of the forms a reader arrives with name one, and
 * what does not name one at all.
 */
import { describe, expect, it } from "vitest";

import { boundsOf, formatCoordinates, parseCoordinates, POINT_ZOOM, pointPlace } from "./coordinates";

/** Sibiu, as each form writes it. Held as `[lng, lat]`, which is how the map holds a point. */
const SIBIU: [number, number] = [ 24.9668, 45.9432 ];

describe("reading a point out of the search bar", () => {
    it("reads a bare pair, however it is separated", () => {
        // What both Google Maps and OpenStreetMap hand over when asked for a place's coordinates,
        // and what `#geolocation` holds.
        expect(parseCoordinates("45.9432, 24.9668")).toEqual(SIBIU);
        expect(parseCoordinates("45.9432,24.9668")).toEqual(SIBIU);
        expect(parseCoordinates("45.9432 24.9668")).toEqual(SIBIU);
        expect(parseCoordinates("  45.9432 , 24.9668  ")).toEqual(SIBIU);
    });

    it("reads a point south and west of nowhere", () => {
        expect(parseCoordinates("-33.8688, -151.2093")).toEqual([ -151.2093, -33.8688 ]);
        expect(parseCoordinates("+45.9432, +24.9668")).toEqual(SIBIU);
        // A whole number of degrees is still a point.
        expect(parseCoordinates("45, 24")).toEqual([ 24, 45 ]);
        expect(parseCoordinates("0, 0")).toEqual([ 0, 0 ]);
    });

    it("reads the URI the map offers a place under", () => {
        expect(parseCoordinates("geo:45.9432,24.9668")).toEqual(SIBIU);
        // The zoom and uncertainty a `geo:` URI can carry are somebody else's business.
        expect(parseCoordinates("geo:45.9432,24.9668?z=15")).toEqual(SIBIU);
        expect(parseCoordinates("geo:45.9432,24.9668;u=35")).toEqual(SIBIU);
    });

    it("reads the URL of the two sites the guide sends a reader to", () => {
        expect(parseCoordinates("https://www.openstreetmap.org/#map=15/45.9432/24.9668"))
            .toEqual(SIBIU);
        expect(parseCoordinates("https://www.openstreetmap.org/?mlat=45.9432&mlon=24.9668"))
            .toEqual(SIBIU);
        expect(parseCoordinates("https://www.google.com/maps/@45.9432,24.9668,15z")).toEqual(SIBIU);
        expect(parseCoordinates("https://maps.google.com/?q=45.9432,24.9668")).toEqual(SIBIU);
        // A place named in the URL as well as placed in it is still gone to by where it stands.
        expect(parseCoordinates("https://www.google.com/maps/place/Sibiu/@45.9432,24.9668,15z"))
            .toEqual(SIBIU);
    });

    it("passes over what does not name a point", () => {
        expect(parseCoordinates("")).toBeNull();
        expect(parseCoordinates("London")).toBeNull();
        // One number is half a point, and a house number is none of one.
        expect(parseCoordinates("45.9432")).toBeNull();
        expect(parseCoordinates("45 Main Street")).toBeNull();
        expect(parseCoordinates("Cafe 45, 24")).toBeNull();
    });

    it("passes over a pair that stands off the Earth", () => {
        // A pair of numbers a reader is looking for rather than somewhere to be flown to.
        expect(parseCoordinates("1234, 5678")).toBeNull();
        expect(parseCoordinates("91, 24")).toBeNull();
        expect(parseCoordinates("45, 181")).toBeNull();
        // The edges themselves are still on it.
        expect(parseCoordinates("90, 180")).toEqual([ 180, 90 ]);
        expect(parseCoordinates("-90, -180")).toEqual([ -180, -90 ]);
    });

    it("names a point by the coordinates as they were typed", () => {
        // Rather than padded out to a fixed precision: four decimals were meant as four.
        expect(formatCoordinates(SIBIU)).toBe("45.9432, 24.9668");
        expect(formatCoordinates([ 0, 0 ])).toBe("0, 0");
    });

    it("makes a place of a point, named by its coordinates and shown close in", () => {
        expect(pointPlace(SIBIU)).toEqual({
            id: "point:24.9668,45.9432",
            name: "45.9432, 24.9668",
            label: "45.9432, 24.9668",
            lat: 45.9432,
            lng: 24.9668,
            zoom: POINT_ZOOM,
            unnamed: true
        });
    });
});

describe("boxing a set of points", () => {
    it("draws the box the points fit into, and nothing for no points at all", () => {
        expect(boundsOf([ [ 10, 40 ], [ 20, 50 ], [ 15, 30 ] ])).toEqual([ [ 10, 30 ], [ 20, 50 ] ]);
        // One point is a box with no width, which is what the caller's maxZoom is for.
        expect(boundsOf([ SIBIU ])).toEqual([ SIBIU, SIBIU ]);
        expect(boundsOf([])).toBeNull();
    });

    it("takes the short way round the seam rather than the long way round the world", () => {
        // Either side of the antimeridian, a stroll apart on the ground. Read raw they span nearly
        // the whole world; the western one is pushed a turn east so the box stays narrow.
        expect(boundsOf([ [ 179, -17 ], [ -179, -18 ] ])).toEqual([ [ 179, -18 ], [ 181, -17 ] ]);
    });

    it("leaves a box narrower than half the world in the frame it was read in", () => {
        // Florida, west of the meridian and nowhere near the seam. Shifting it would send it round
        // the far side of the world, so a narrow box is never reconsidered.
        expect(boundsOf([ [ -81, 25 ], [ -80, 26 ] ])).toEqual([ [ -81, 25 ], [ -80, 26 ] ]);
        // Europe, which straddles the meridian and so holds longitudes of both signs.
        expect(boundsOf([ [ -9, 38 ], [ 24, 60 ] ])).toEqual([ [ -9, 38 ], [ 24, 60 ] ]);
        // Exactly half the world is still whole.
        expect(boundsOf([ [ -90, 0 ], [ 90, 10 ] ])).toEqual([ [ -90, 0 ], [ 90, 10 ] ]);
    });

    it("frames three points across the seam by the ground between them", () => {
        // The seam is a circle's, not a pair's: the far side is the long way round for all of them.
        expect(boundsOf([ [ 170, 0 ], [ -170, 5 ], [ 178, 2 ] ])).toEqual([ [ 170, 0 ], [ 190, 5 ] ]);
    });
});
