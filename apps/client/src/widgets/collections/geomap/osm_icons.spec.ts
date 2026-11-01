/** Which icon a place is drawn with, from how OpenStreetMap classifies it. */
import { describe, expect, it } from "vitest";

import { placeIcon } from "./osm_icons";

describe("Place icons", () => {
    it("draws a place by its own kind, where OSM names one", () => {
        expect(placeIcon({ category: "shop", type: "supermarket", addressType: "shop" })).toBe("bx bx-cart");
        expect(placeIcon({ category: "amenity", type: "cafe", addressType: "amenity" })).toBe("bx bx-coffee");
        expect(placeIcon({ category: "amenity", type: "parking", addressType: "amenity" })).toBe("bx bxs-parking");
        expect(placeIcon({ category: "natural", type: "volcano", addressType: "volcano" })).toBe("bx bx-landscape");
        expect(placeIcon({ category: "aeroway", type: "aerodrome", addressType: "aeroway" })).toBe("bx bx-paper-plane");
    });

    it("tells administrative areas apart by their address type, which is all that distinguishes them", () => {
        // Every one of these is filed under the same category and type.
        const boundary = { category: "boundary", type: "administrative" };

        expect(placeIcon({ ...boundary, addressType: "country" })).toBe("bx bx-flag");
        expect(placeIcon({ ...boundary, addressType: "county" })).toBe("bx bx-map-alt");
        expect(placeIcon({ ...boundary, addressType: "city" })).toBe("bx bx-buildings");
        expect(placeIcon({ ...boundary, addressType: "village" })).toBe("bx bx-home-alt");
        expect(placeIcon({ ...boundary, addressType: "suburb" })).toBe("bx bx-building-house");
    });

    it("falls back on what a place broadly is, then on nothing at all", () => {
        // A trade no table names is still a shop, and a road is still a road.
        expect(placeIcon({ category: "shop", type: "locksmith", addressType: "shop" })).toBe("bx bx-store");
        expect(placeIcon({ category: "highway", type: "secondary", addressType: "road" })).toBe("bx bx-directions");

        // Nothing here claims these, so the caller falls back on DEFAULT_PLACE_ICON in their stead.
        expect(placeIcon({ category: "sport", type: "curling" })).toBeUndefined();
        expect(placeIcon({})).toBeUndefined();
    });
});
