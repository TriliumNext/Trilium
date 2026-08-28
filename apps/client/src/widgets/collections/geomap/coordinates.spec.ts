/**
 * Reading a point out of the search bar: which of the forms a reader arrives with name one, and
 * what does not name one at all.
 */
import { describe, expect, it } from "vitest";

import { formatCoordinates, parseCoordinates } from "./coordinates";

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
});
