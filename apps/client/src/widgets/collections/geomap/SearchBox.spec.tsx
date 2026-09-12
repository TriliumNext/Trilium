/**
 * The geo map search bar: what a query lists, when the geocoder is allowed to run, and what picking
 * a row does to the map. The geocoder is the dummy provider, so these cover the bar rather than any
 * one geocoder.
 */
import type { Map as MapLibreGLMap } from "maplibre-gl";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import { buildNote } from "../../../test/easy-froca";
import { renderInto } from "../../../test/render";
import { DEFAULT_GEOCODING_PROVIDER_NAME, GEOCODING_PROVIDERS, type GeoSearchResult } from "./geocoding";
import { GPX_MIME } from "./GpxTrack";
import { ParentMap } from "./map";
import type { SearchResult } from "./results";
import SearchBox from "./SearchBox";

/** The pin is drawn on the map by its own component, which has a spec of its own; here it only has to
 *  stand in the right place, so it is rendered as something the DOM can be asked about. */
vi.mock("./PlaceMarker", () => ({
    default: ({ center, name, outline }: { center: [number, number]; name: string; outline?: GeoJSON.Geometry }) =>
        <div className="place-marker" data-center={center.join(",")} data-name={name} data-outline={outline?.type} />
}));

vi.mock("../../../utils/formatters", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../utils/formatters")>()),
    getMeasurementSystem: () => "metric"
}));

// i18next is not initialized under test, so t() returns "". The key stands in for the text, with any
// interpolated values after it, which is enough to tell the rows apart.
vi.mock("../../../services/i18n", () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key)
}));

const TOKYO: GeoSearchResult = {
    id: "1", label: "Tokyo, Japan", name: "Tokyo", lat: 35.6762, lng: 139.6503,
    bounds: [ [ 139.5, 35.5 ], [ 139.9, 35.8 ] ]
};

/** A result the geocoder gave no extent for, which is what the fallback zoom is left for. */
const UNBOUNDED: GeoSearchResult = { id: "9", label: "Somewhere", name: "Somewhere", lat: 10, lng: 20 };

/** Stands in for the geocoder, which would otherwise reach for the network. */
function mockGeocoder(results: GeoSearchResult[]) {
    return vi.spyOn(GEOCODING_PROVIDERS[DEFAULT_GEOCODING_PROVIDER_NAME], "search")
        .mockResolvedValue(results);
}

/** Where a fake map is looking, which is what a search is told to prefer. */
const VIEWPORT = { west: 19.8, south: 39.5, east: 20.1, north: 39.8 };

/** The middle of that view, which is what a row's distance is measured from. */
const CENTRE = { lng: 19.95, lat: 39.65 };

/** A map that can be flown somewhere or framed on something, and that says what it is showing. */
function fakeMap() {
    return {
        flyTo: vi.fn(),
        fitBounds: vi.fn(),
        getCenter: () => ({ toArray: () => [ CENTRE.lng, CENTRE.lat ] as [number, number] }),
        getBounds: () => ({
            getWest: () => VIEWPORT.west,
            getSouth: () => VIEWPORT.south,
            getEast: () => VIEWPORT.east,
            getNorth: () => VIEWPORT.north
        })
    };
}

/** Two notes on the map and one that is only in its subtree, having no location to be drawn at. */
function mapNotes(): FNote[] {
    return [
        buildNote({ title: "London hotel", "#geolocation": "51.5,-0.12" }),
        buildNote({ title: "London office", "#geolocation": "51.6,-0.1" }),
        buildNote({ title: "London packing list" }),
        buildNote({ title: "Tokyo trip", "#geolocation": "35.6,139.7" })
    ];
}

/** What the bar has reported picking, the map being what stands a result on itself (see index.tsx). */
let picked: ({ results: SearchResult[]; index: number } | null)[] = [];

/** The place of the last result reported, or none where the bar reported moving on from the search. */
function pickedPlace() {
    const last = picked.at(-1);
    const result = last && last.results[last.index];
    return result?.kind === "place" ? result.place : null;
}

function renderSearchBox(map: ReturnType<typeof fakeMap> | null, notes: FNote[] = []) {
    picked = [];
    let container: HTMLElement | undefined;
    act(() => {
        container = renderInto(
            <ParentMap.Provider value={map as unknown as MapLibreGLMap}>
                <SearchBox notes={notes} onPickResult={(result) => picked.push(result)} />
            </ParentMap.Provider>
        );
    });
    if (!container) throw new Error("the search bar was not rendered");
    return container;
}

function field(container: HTMLElement) {
    const input = container.querySelector<HTMLInputElement>("input.geo-search-input");
    if (!input) throw new Error("the search bar has no field");
    return input;
}

/** Lets the debounced lookup and anything it started run to completion. */
async function settle() {
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

/** Types into the field and runs out the debounced lookup. */
async function type(container: HTMLElement, text: string) {
    const input = field(container);
    // Two acts: the field has to re-render as open before the effect that schedules the lookup runs,
    // so advancing the timers in the same act would find nothing scheduled.
    await act(async () => {
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
}

/**
 * Every row of the list, headings included. The dropdown is portalled to the body, so it is looked
 * for there rather than in the container.
 */
function rows() {
    return [ ...document.querySelectorAll<HTMLElement>(".form-autocomplete-dropdown li") ];
}

/** The rows that can be taken, which is every row but the headings. */
function entries() {
    return rows().filter((row) => row.classList.contains("form-autocomplete-item"));
}

/** What a row is called: the first line of a place, and the whole of any other row. */
function nameOf(row: HTMLElement) {
    return row.querySelector(".geo-search-entry-name")?.textContent
        ?? row.querySelector(".geo-search-entry-lines")?.textContent
        ?? row.textContent;
}

function labels() {
    return rows().map(nameOf);
}

/** Presses a key in the field, as the reader reaching for the keyboard rather than the pointer. */
async function press(container: HTMLElement, key: string) {
    await act(async () => {
        field(container).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
    await settle();
}

/** Picks the row that reads as the given name, the list standing in distance order rather than a
 *  settled one. */
async function pickNamed(name: string) {
    const row = rows().find((candidate) => nameOf(candidate) === name);
    if (!row) throw new Error(`the list offers no "${name}": ${labels().join(", ")}`);

    await act(async () => { row.click(); });
    await settle();
}

/** Picks a row and lets whatever it started settle. */
async function pick(index: number) {
    await act(async () => { entries()[index].click(); });
    await settle();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("geo map SearchBox", () => {
    it("lists the map's own markers by title, skipping notes with nowhere to fly to", async () => {
        mockGeocoder([]);
        const container = renderSearchBox(fakeMap(), mapNotes());

        await type(container, "london");

        // "London packing list" has no location, so it has no marker to offer.
        expect(labels()).toEqual([
            "London hotel",
            "London office",
            "geo-map.search-online(london)"
        ]);
    });

    it("matches a title past its accents and in whatever order the terms are typed", async () => {
        mockGeocoder([]);
        const container = renderSearchBox(fakeMap(), [
            buildNote({ title: "Zürich Hauptbahnhof", "#geolocation": "47.37,8.54" }),
            buildNote({ title: "Paris Hotel", "#geolocation": "48.85,2.35" })
        ]);

        // Matched by the terms the app filters its own lists by, which fold accents on both sides.
        await type(container, "zurich");
        expect(labels()).toEqual([ "Zürich Hauptbahnhof", "geo-map.search-online(zurich)" ]);

        // Every term rather than the whole query in one piece, so their order is the typist's.
        await type(container, "hotel paris");
        expect(labels()).toEqual([ "Paris Hotel", "geo-map.search-online(hotel paris)" ]);
    });

    it("offers the nearest of the notes that match, rather than the first the map holds", async () => {
        mockGeocoder([]);
        // More matches than the list has room for, the nearest of them held last: a cap taken while
        // gathering would offer the nine furthest and leave the one at hand out altogether.
        const far = Array.from({ length: 9 }, (_, index) =>
            buildNote({ title: `Cafe ${index}`, "#geolocation": "10,10" }));
        const container = renderSearchBox(
            fakeMap(), [ ...far, buildNote({ title: "Cafe next door", "#geolocation": "39.66,19.96" }) ]);

        await type(container, "cafe");

        // The last of them stands beside what the map is showing (see CENTRE), so it comes first —
        // and the list holds the eight it has room for, with the geocoder's row under them.
        expect(labels()[0]).toBe("Cafe next door");
        expect(labels()).toHaveLength(9);
        expect(labels().at(-1)).toBe("geo-map.search-online(cafe)");
    });

    it("offers a GPX track by its title, which stands on no location of its own", async () => {
        mockGeocoder([]);
        const map = fakeMap();
        const track = buildNote({ title: "Ridge walk", mime: GPX_MIME });
        const container = renderSearchBox(map, [ ...mapNotes(), track ]);

        await type(container, "ridge");
        expect(labels()[0]).toBe("Ridge walk");

        await pick(0);

        // Reported with no point to stand on, so the pane fits the whole route (see DetailPane)
        // rather than the map flying to one end of it.
        expect(picked.at(-1)?.results[0]).toEqual({ kind: "note", noteId: track.noteId, center: undefined });
        expect(map.flyTo).not.toHaveBeenCalled();
        expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it("offers a point named outright, above whatever was searched for", async () => {
        mockGeocoder([]);
        const map = fakeMap();
        const container = renderSearchBox(map, mapNotes());

        await type(container, "45.9432, 24.9668");

        // Above the rest: the reader named where they were going rather than looked for it.
        expect(labels()[0]).toBe("geo-map.go-to-coordinates(45.9432, 24.9668)");

        await pick(0);

        // Pinned and offered for keeping as a searched place is, and shown as closely as it was
        // meant rather than at the level a place of unsaid extent gets.
        expect(pickedPlace()).toMatchObject({
            name: "45.9432, 24.9668",
            lat: 45.9432,
            lng: 24.9668,
            // Named by where it stands and nothing else, so a note kept from it is named as a
            // placed marker is rather than after its own coordinates (see createNoteForPlace).
            unnamed: true
        });
        expect(map.flyTo).toHaveBeenCalledWith({ center: [ 24.9668, 45.9432 ], zoom: 16 });
    });

    it("offers nothing for a query below the minimum length", async () => {
        const container = renderSearchBox(fakeMap(), mapNotes());

        await type(container, "l");

        expect(entries()).toHaveLength(0);
    });

    it("does not reach the geocoder until its row is picked", async () => {
        const search = mockGeocoder([ TOKYO ]);
        const container = renderSearchBox(fakeMap(), mapNotes());

        await type(container, "tokyo");
        expect(search).not.toHaveBeenCalled();
        expect(labels()).toEqual([ "Tokyo trip", "geo-map.search-online(tokyo)" ]);

        await pick(1);

        expect(search).toHaveBeenCalledWith("tokyo", {
            // The geocoder is told where the map is looking, so a name shared by two places is
            // answered with the one at hand.
            viewport: [ [ VIEWPORT.west, VIEWPORT.south ], [ VIEWPORT.east, VIEWPORT.north ] ]
        });
        // The row is replaced by what it found, under a heading of its own: a place the geocoder
        // turned up is a different answer from a note already standing on the map.
        expect(labels()).toEqual([
            "geo-map.results-on-map", "Tokyo trip",
            "geo-map.results-far", "Tokyo"
        ]);
    });

    it("flies to a marker, and closes the list rather than leaving it open over the map", async () => {
        mockGeocoder([]);
        const map = fakeMap();
        const container = renderSearchBox(map, mapNotes());

        await type(container, "tokyo trip");
        await pick(0);

        expect(map.flyTo).toHaveBeenCalledWith({ center: [ 139.7, 35.6 ], zoom: expect.any(Number) });
        // The field keeps what was typed, so the next search starts from it.
        expect(field(container).value).toBe("tokyo trip");
        expect(entries()).toHaveLength(0);
    });

    it("frames a place on the ground it covers, so a street is not shown as its city", async () => {
        mockGeocoder([ TOKYO ]);
        const map = fakeMap();
        const container = renderSearchBox(map, []);

        await type(container, "tokyo");
        await pick(0);
        await pick(0);

        expect(map.fitBounds).toHaveBeenCalledWith(TOKYO.bounds, {
            padding: expect.any(Number),
            // A house covers a few metres, which framed on its own would fill the screen with a roof.
            maxZoom: expect.any(Number)
        });
        expect(map.flyTo).not.toHaveBeenCalled();
        // Not the place's whole label, which is an address the field has no room for.
        expect(field(container).value).toBe("tokyo");
    });

    it("falls back to a zoom for a place the geocoder gave no extent for", async () => {
        mockGeocoder([ UNBOUNDED ]);
        const map = fakeMap();
        const container = renderSearchBox(map, mapNotes());

        await type(container, "somewhere");
        await pick(0);
        await pick(0);

        expect(map.fitBounds).not.toHaveBeenCalled();
        expect(map.flyTo).toHaveBeenCalledWith({ center: [ UNBOUNDED.lng, UNBOUNDED.lat ], zoom: expect.any(Number) });

        // A note marks a spot rather than an area, so it is shown closer in than a place of unknown
        // size.
        const [ { zoom: placeZoom } ] = map.flyTo.mock.calls[0];
        await type(container, "tokyo trip");
        await pick(0);
        const [ { zoom: markerZoom } ] = map.flyTo.mock.calls[1];
        expect(markerZoom).toBeGreaterThan(placeZoom);
    });

    it("says so when the geocoder finds nothing, and when it cannot be reached", async () => {
        mockGeocoder([]);
        const container = renderSearchBox(fakeMap(), []);

        await type(container, "atlantis");
        await pick(0);
        expect(labels()).toEqual([ "geo-map.no-places-found" ]);

        mockGeocoder([]).mockRejectedValue(new Error("rate limited"));
        await type(container, "berlin");
        await pick(0);
        expect(labels()).toEqual([ "geo-map.search-failed" ]);
    });

    it("offers the geocoder again once the query moves on from what it answered", async () => {
        mockGeocoder([ { id: "2", label: "Berlin, Germany", name: "Berlin", lat: 52.52, lng: 13.405 } ]);
        const container = renderSearchBox(fakeMap(), []);

        await type(container, "berlin");
        await pick(0);
        expect(labels()).toEqual([ "Berlin" ]);

        await type(container, "berlin de");
        expect(labels()).toEqual([ "geo-map.search-online(berlin de)" ]);
    });

    it("reports the place picked, whole, and reports moving on from it", async () => {
        mockGeocoder([ TOKYO ]);
        const container = renderSearchBox(fakeMap(), mapNotes());

        await type(container, "tokyo");
        await pickNamed("geo-map.search-online(tokyo)");
        await pickNamed("Tokyo");

        // Whole, so what stands it on the map has its boundary and its bounds to hand.
        expect(pickedPlace()).toBe(TOKYO);
        // And with everything the list offered, so the rest can be stepped through after it.
        expect(picked.at(-1)?.results).toHaveLength(2);

        // A note of the map's own is one of the results too, and taking it stands the map there.
        await type(container, "tokyo trip");
        await pick(0);
        expect(picked.at(-1)?.results[picked.at(-1)?.index ?? -1])
            .toEqual({ kind: "note", noteId: expect.any(String), center: [ 139.7, 35.6 ] });
    });

    it("names the geocoder on the rows it answers for, before the asking and during it", async () => {
        const provider = GEOCODING_PROVIDERS[DEFAULT_GEOCODING_PROVIDER_NAME];
        mockGeocoder([ TOKYO ]);
        const container = renderSearchBox(fakeMap(), []);

        const detailOf = (name: string) => rows()
            .find((row) => nameOf(row) === name)
            ?.querySelector(".geo-search-entry-address")?.textContent;

        await type(container, "tokyo");
        // What is about to leave the map, said where it is read rather than in a setting somewhere.
        expect(detailOf("geo-map.search-online(tokyo)")).toBe(provider.name);
        expect(provider.name).toContain("Nominatim");

        await pickNamed("geo-map.search-online(tokyo)");

        // And where the places it turned up came from.
        expect(detailOf("Tokyo")).toBe("Japan");
    });

    it("gives a place two lines: what it is called, and the address that places it", async () => {
        mockGeocoder([
            { ...TOKYO, label: "Tokyo, Ōta, Japan" },
            // A label that does not begin with the name has nothing to repeat, so it is left whole.
            { id: "3", label: "Shibuya Crossing", name: "Scramble", lat: 35.6, lng: 139.7 }
        ]);
        const container = renderSearchBox(fakeMap(), []);

        await type(container, "tokyo");
        await pick(0);

        const lines = entries().map((entry) => [
            entry.querySelector(".geo-search-entry-name")?.textContent,
            entry.querySelector(".geo-search-entry-address")?.textContent
        ]);
        expect(lines).toEqual([
            [ "Tokyo", "Ōta, Japan" ],
            [ "Scramble", "Shibuya Crossing" ]
        ]);
    });

    it("says how far off each place stands, and says nothing of the rows that are nowhere", async () => {
        mockGeocoder([ TOKYO ]);
        const container = renderSearchBox(fakeMap(), mapNotes());

        await type(container, "tokyo");

        const distances = () => entries().map((entry) =>
            entry.querySelector(".geo-search-entry-distance")?.textContent ?? null);

        // The note is on the other side of the world from the view, which is in Corfu.
        const [ tokyoTrip, geocoderRow ] = distances();
        expect(tokyoTrip).toMatch(/^gpx_preview\.unit_km/);
        expect(Number(tokyoTrip?.replace(/\D/g, ""))).toBeGreaterThan(9000);
        // The row that runs the geocoder names no place, so it stands nowhere.
        expect(geocoderRow).toBeNull();

        await pick(1);

        // The place the geocoder found is measured the same way.
        expect(distances()[1]).toMatch(/^gpx_preview\.unit_km/);
    });

    it("stands the first row ready, so Enter takes it without arrowing down to it", async () => {
        mockGeocoder([ TOKYO ]);
        const map = fakeMap();
        const container = renderSearchBox(map, mapNotes());

        await type(container, "tokyo");
        expect(entries()[0].className).toContain("active");

        // The map's own note stands first, so Enter goes there rather than to the geocoder.
        await press(container, "Enter");

        expect(map.flyTo).toHaveBeenCalledWith({ center: [ 139.7, 35.6 ], zoom: expect.any(Number) });
        expect(field(container).value).toBe("tokyo");
    });

    it("runs the geocoder on Enter where the map has nothing of its own, and takes the first place on the next", async () => {
        const search = mockGeocoder([ TOKYO ]);
        const map = fakeMap();
        const container = renderSearchBox(map, []);

        // Nothing of the map's own matches, so the row that stands ready is the geocoder's.
        await type(container, "tokyo");
        await press(container, "Enter");
        expect(search).toHaveBeenCalledOnce();

        await press(container, "Enter");

        expect(map.fitBounds).toHaveBeenCalledWith(TOKYO.bounds, expect.anything());
        expect(field(container).value).toBe("tokyo");
    });

    it("puts the map's own notes, what is at hand and what is far off each under their own heading", async () => {
        // Half of Corfu away, a good way up the coast, and another country entirely.
        mockGeocoder([
            { id: "near", label: "Jumbo, Corfu", name: "Jumbo", lat: CENTRE.lat + 0.09, lng: CENTRE.lng },
            { id: "far", label: "Jumbo, Ohio", name: "Jumbo", lat: 40.4, lng: -82.9 }
        ]);
        const container = renderSearchBox(fakeMap(), [
            buildNote({ title: "Jumbo receipt", "#geolocation": `${CENTRE.lat + 0.04},${CENTRE.lng}` })
        ]);

        await type(container, "jumbo");
        await pickNamed("geo-map.search-online(jumbo)");

        expect(labels()).toEqual([
            // The map's own first, whatever the distances say.
            "geo-map.results-on-map", "Jumbo receipt",
            "geo-map.results-nearby", "Jumbo",
            "geo-map.results-far", "Jumbo"
        ]);
        // A heading names the rows below it rather than offering anything, so it is not among the
        // rows that can be taken.
        expect(entries().map(nameOf)).toEqual([ "Jumbo receipt", "Jumbo", "Jumbo" ]);
    });

    it("leaves the headings off where every result is on one side of the line", async () => {
        mockGeocoder([ TOKYO ]);
        const container = renderSearchBox(fakeMap(), []);

        await type(container, "tokyo");
        await pickNamed("geo-map.search-online(tokyo)");

        // Nothing at hand to tell it apart from: one name over one run of rows says nothing.
        expect(labels()).toEqual([ "Tokyo" ]);
    });

    it("puts the rows back on Enter once one of them has been taken", async () => {
        mockGeocoder([ TOKYO ]);
        const container = renderSearchBox(fakeMap(), mapNotes());

        const offered = [ "Tokyo trip", "geo-map.search-online(tokyo)" ];

        await type(container, "tokyo");
        expect(labels()).toEqual(offered);

        // The first row is taken, and the list stands down rather than staying open on it.
        await press(container, "Enter");
        expect(entries()).toHaveLength(0);

        // The query was right, so looking at what it offers again should not mean retyping it.
        await press(container, "Enter");
        expect(labels()).toEqual(offered);
    });

    it("puts the rows back on Enter after Escape has sent them away", async () => {
        mockGeocoder([ TOKYO ]);
        const container = renderSearchBox(fakeMap(), mapNotes());

        await type(container, "tokyo");
        await press(container, "Escape");
        expect(entries()).toHaveLength(0);

        await press(container, "Enter");

        expect(labels()).toEqual([ "Tokyo trip", "geo-map.search-online(tokyo)" ]);
    });

    it("puts the rows back when the field is come back to, without a key being pressed", async () => {
        mockGeocoder([ TOKYO ]);
        const container = renderSearchBox(fakeMap(), mapNotes());
        const offered = [ "Tokyo trip", "geo-map.search-online(tokyo)" ];

        await act(async () => { field(container).focus(); });
        await type(container, "tokyo");
        expect(labels()).toEqual(offered);

        // Clicking away from the field, as a press on the map does, takes the list with it.
        await act(async () => { field(container).blur(); });
        await settle();
        expect(entries()).toHaveLength(0);

        // Coming back to the field is asking for what it was offering; Enter is not reaching it
        // while the map has the focus, so it cannot be what brings the list back.
        await act(async () => { field(container).focus(); });
        await settle();

        expect(labels()).toEqual(offered);
    });

    it("offers to clear the field only once there is something in it to clear", async () => {
        mockGeocoder([ TOKYO ]);
        const container = renderSearchBox(fakeMap(), mapNotes());
        const clearButton = () => container.querySelector<HTMLButtonElement>(".geo-search-clear");
        const isShown = () => clearButton()?.classList.contains("shown");

        // Standing in the bar either way, so the field beside it does not move as it comes and goes.
        expect(clearButton()).not.toBeNull();
        expect(isShown()).toBe(false);

        await type(container, "tokyo");
        expect(isShown()).toBe(true);

        await pickNamed("geo-map.search-online(tokyo)");
        await pickNamed("Tokyo");
        expect(pickedPlace()).toBe(TOKYO);

        await act(async () => { clearButton()?.click(); });
        await settle();

        expect(field(container).value).toBe("");
        expect(isShown()).toBe(false);
        // Clearing the field is what takes the search off the map, panel and pin alike.
        expect(picked.at(-1)).toBeNull();
        // Rarely the end of searching, so the field is where the reader was left.
        expect(document.activeElement).toBe(field(container));
    });

    it("reports moving on from a place once the field is emptied", async () => {
        mockGeocoder([ TOKYO ]);
        const container = renderSearchBox(fakeMap(), []);

        await type(container, "tokyo");
        await pickNamed("geo-map.search-online(tokyo)");
        await pickNamed("Tokyo");
        expect(pickedPlace()).toBe(TOKYO);

        await type(container, "");

        expect(picked.at(-1)).toBeNull();
    });

    it("renders nothing when the map failed to initialize", () => {
        expect(renderSearchBox(null).querySelector(".geo-search-toolbar")).toBeNull();
    });
});
