import { describe, expect, it } from "vitest";

import { describeGeoView, type GeoViewSnapshot, MAX_LISTED_PINS } from "./llm_context";

/** Cluj-Napoca's center and a view that holds the city, as `[lng, lat]`. */
const CENTER: [number, number] = [ 23.6236, 46.7712 ];
const VIEW: Omit<GeoViewSnapshot, "pins"> = {
    bounds: [ 23.55, 46.73, 23.70, 46.81 ],
    center: CENTER,
    zoom: 13.4
};

describe("describeGeoView", () => {
    it("states the viewport and lists the pins on screen by distance, counting the rest", () => {
        const text = describeGeoView({
            ...VIEW,
            pins: [
                { noteId: "far", title: "Bucharest", point: [ 26.1025, 44.4268 ] },
                { noteId: "park", title: "Central Park", point: [ 23.61, 46.77 ] },
                { noteId: "sel", title: "Cathedral", point: [ 23.5901, 46.7699 ] }
            ],
            selectedNoteId: "sel"
        });
        expect(text).toContain("Center: 46.77120, 23.62360 (latitude, longitude), zoom level 13.4 (a town or district)");
        expect(text).toContain("Visible area: latitude 46.73000 to 46.81000, longitude 23.55000 to 23.70000");
        expect(text).toContain("2 pinned notes on screen, nearest to the center first:\n"
            + "- Central Park (noteId: park) at 46.77000, 23.61000, 1.0 km from the center\n"
            + "- Cathedral (noteId: sel) at 46.76990, 23.59010, 2.6 km from the center (selected)\n"
            + "1 more pinned note is off screen.");
        expect(text).toContain("Selected note (open in the detail pane): Cathedral (noteId: sel) at 46.76990, 23.59010, 2.6 km from the center, on screen.");
        // Named before the listing, where the model looks first for what "it" means.
        expect(text.indexOf("Selected note")).toBeLessThan(text.indexOf("pinned notes on screen"));
    });

    it("names the nearest pin when none is on screen, and the selected one when it is off screen", () => {
        const text = describeGeoView({
            ...VIEW,
            pins: [ { noteId: "far", title: "Bucharest", point: [ 26.1025, 44.4268 ] } ],
            selectedNoteId: "far"
        });
        expect(text).toContain("None of the 1 pinned notes are on screen; the nearest is Bucharest (noteId: far) at 44.42680, 26.10250, 324 km from the center.");
        expect(text).toContain("Selected note (open in the detail pane): Bucharest (noteId: far) at 44.42680, 26.10250, 324 km from the center, off screen.");
        expect(describeGeoView({ ...VIEW, pins: [] })).toContain("No notes on this map are pinned yet.");
    });

    it("names the place picked from the search, which is not a note", () => {
        const text = describeGeoView({
            ...VIEW,
            pins: [],
            place: { name: "St. Michael's Church", where: "Cluj-Napoca, Romania", point: [ 23.5891, 46.7702 ] }
        });
        expect(text).toContain("A place from the map's search is marked with a temporary pin (it is not a note yet): St. Michael's Church (Cluj-Napoca, Romania) at 46.77020, 23.58910, 2.6 km from the center. The user can keep it as a note.");

        const bare = describeGeoView({ ...VIEW, pins: [], place: { name: "46.7702, 23.5891", where: "", point: [ 23.5891, 46.7702 ] } });
        expect(bare).toContain("pin (it is not a note yet): 46.7702, 23.5891 at 46.77020, 23.58910");
        expect(bare).not.toContain("()");
    });

    it("lists only the nearest pins on a crowded screen", () => {
        const pins = Array.from({ length: MAX_LISTED_PINS + 3 }, (_, i) => ({
            noteId: `n${i}`, title: `Pin ${i}`, point: [ 23.6236 + i * 0.001, 46.7712 ] as [number, number]
        }));
        const text = describeGeoView({ ...VIEW, zoom: 1, pins });
        expect(text).toContain("(the whole world)");
        expect(text).toContain("- Pin 0 (noteId: n0) at 46.77120, 23.62360, 0 m from the center");
        expect(text).toContain(`- Pin ${MAX_LISTED_PINS - 1} (noteId:`);
        expect(text).not.toContain(`- Pin ${MAX_LISTED_PINS} (noteId:`);
        expect(text).toContain("…and 3 more on screen");
    });
});
