/**
 * The GPX track: the line between the flags, and the flags themselves.
 *
 * Two things kept the line from being drawn. It was added only if `map.isStyleLoaded()` said so, or
 * else on the next `style.load` — but `style.load` fires once per style and this component mounts
 * late (it waits on the note's content to be fetched), so the event was routinely long gone by the
 * time it listened; and `isStyleLoaded()` answers for the tiles as much as for the style, so it is
 * false while they are still arriving. Missing both, the line was never added at all.
 *
 * The second was that every point in the file was strung into one line, so a track recorded in
 * segments was drawn with a straight line across each gap between them.
 *
 * The marks used to be DOM elements apiece — a leftover of the Leaflet map — which nothing
 * hit-testing the style could see. They are features of the track's own source now, stamped by a
 * symbol layer with pins from the shared rasterizer (see Markers), and only that layer waits on the
 * rasterizing: the line must go up at once, as it always has.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GpxTrack, trackHitLayers } from "./GpxTrack";
import { MapStyleLoaded, ParentMap } from "./map";
import { LABEL_PAINT, markerImageId } from "./Markers";

vi.mock("../../../services/icon_glyphs", () => ({
    renderIconImage: vi.fn(async () => "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")
}));

/**
 * A map as MapLibre behaves, in the one respect that matters here: a source or a layer can only be
 * added to a style that has finished loading, and asking for one before then throws.
 */
function fakeMap() {
    const sources = new Map<string, unknown>();
    const layers = new Map<string, unknown>();
    const images = new Map<string, unknown>();
    const listeners = new Map<string, (() => void)[]>();
    let loaded = false;

    return {
        sources,
        layers,
        images,
        /** What `map.isStyleLoaded()` answers — false while the tiles are still coming in. */
        tilesLoaded: false,

        on(type: string, listener: () => void) {
            listeners.set(type, [ ...(listeners.get(type) ?? []), listener ]);
        },
        off(type: string, listener: () => void) {
            listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== listener));
        },
        isStyleLoaded() {
            return loaded && this.tilesLoaded;
        },
        getSource(id: string) {
            return sources.get(id);
        },
        getLayer(id: string) {
            return layers.get(id);
        },
        addSource(id: string, source: unknown) {
            if (!loaded) throw new Error("Style is not done loading");
            sources.set(id, source);
        },
        addLayer(layer: { id: string }) {
            if (!loaded) throw new Error("Style is not done loading");
            layers.set(layer.id, layer);
        },
        getLayersOrder() {
            return [ ...layers.keys() ];
        },
        hasImage(id: string) {
            return images.has(id);
        },
        addImage(id: string, image: unknown) {
            images.set(id, image);
        },
        removeSource(id: string) {
            sources.delete(id);
        },
        removeLayer(id: string) {
            layers.delete(id);
        },

        /** The style finishing, which is what `style.load` announces. */
        loadStyle() {
            loaded = true;
            for (const listener of listeners.get("style.load") ?? []) {
                listener();
            }
        }
    };
}

/** A track of two segments a short pause apart — near enough to stay one journey (see the jump
 *  splitting in services/gpx) — plus a waypoint off to one side. */
const TWO_SEGMENT_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="45.9" lon="24.1"><name>A rest</name></wpt>
  <trk>
    <trkseg>
      <trkpt lat="45.79" lon="24.13" />
      <trkpt lat="45.81" lon="24.14" />
    </trkseg>
    <trkseg>
      <trkpt lat="45.813" lon="24.142" />
      <trkpt lat="45.89" lon="24.08" />
    </trkseg>
  </trk>
</gpx>`;

/** The note the track belongs to, which every one of its layers is named after. */
const NOTE_ID = "gpxNoteId1";

/** What the marks are drawn with, under the ids the shared rasterizer files pins by (see Markers). */
const PIN_COLOR = "purple";
const NOTE_ICON = "bx bx-cycling";
const START_IMAGE = markerImageId(PIN_COLOR, NOTE_ICON);
const END_IMAGE = markerImageId(PIN_COLOR, "bx bxs-flag-checkered");
const WAYPOINT_IMAGE = markerImageId(PIN_COLOR, "bx bx-pin");

describe("GpxTrack", () => {
    let container: HTMLElement;
    let map: ReturnType<typeof fakeMap>;

    beforeEach(() => {
        map = fakeMap();
        container = document.createElement("div");
        document.body.appendChild(container);

        // A pin is drawn by handing an SVG blob to an <img> and waiting for it to load, which no DOM
        // stand-in actually does. Without this the build never resolves and the marks never go up.
        vi.stubGlobal("Image", class {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_value: string) {
                setTimeout(() => this.onload?.());
            }
        });
        vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:pin", revokeObjectURL: () => {} });
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        vi.unstubAllGlobals();
    });

    /** Mounts the track under a map whose style has loaded (or not), as the context reports it. */
    function renderTrack({ styleLoaded, gpx = TWO_SEGMENT_GPX, hideLabels = false, isDarkTheme = false }: {
        styleLoaded: boolean; gpx?: string; hideLabels?: boolean; isDarkTheme?: boolean;
    }) {
        act(() => {
            render(
                <ParentMap.Provider value={map as never}>
                    <MapStyleLoaded.Provider value={styleLoaded}>
                        <GpxTrack
                            noteId={NOTE_ID}
                            title="A Sunday ride"
                            gpxXmlString={gpx}
                            trackColor="red"
                            pinColor={PIN_COLOR}
                            iconClass={NOTE_ICON}
                            hideLabels={hideLabels}
                            isDarkTheme={isDarkTheme}
                        />
                    </MapStyleLoaded.Provider>
                </ParentMap.Provider>,
                container
            );
        });
    }

    /** Drains the pin rasterizing (icon render → svg decode → marks layer). */
    async function settle() {
        await act(async () => {
            for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve));
        });
    }

    /** A layer the track added, by the id it is named after the note with. */
    function layer(kind: "layer" | "hit" | "label" | "marks") {
        return map.layers.get(`gpx-${kind}-${NOTE_ID}`) as
            { filter?: unknown; layout?: Record<string, unknown>; paint: Record<string, unknown> } | undefined;
    }

    /** Everything the one source carries: the line, and a mark per flag. */
    function features() {
        const source = map.sources.get(`gpx-source-${NOTE_ID}`) as
            { data: GeoJSON.FeatureCollection } | undefined;
        return source?.data.features ?? [];
    }

    /** The marks alone, in the order they were read out of the file. */
    function marks() {
        return features().filter((feature) => feature.geometry.type === "Point") as
            (GeoJSON.Feature & { geometry: GeoJSON.Point })[];
    }

    /** The geometry of the line the track drew. */
    function trackCoordinates() {
        const line = features().find((feature) => feature.geometry.type === "MultiLineString");
        return line?.geometry as GeoJSON.MultiLineString | undefined;
    }

    /** What the source says the line stands for. */
    function trackProperties() {
        return features().find((feature) => feature.geometry.type === "MultiLineString")?.properties;
    }

    it("draws the line when it mounts after the style loaded, with the tiles still coming in", () => {
        // The style is long since loaded and `style.load` is spent — the case that used to lose.
        map.loadStyle();
        expect(map.isStyleLoaded()).toBe(false);

        renderTrack({ styleLoaded: true });

        expect(layer("layer")?.paint["line-color"]).toBe("red");
        expect(trackCoordinates()?.type).toBe("MultiLineString");
    });

    it("draws the line once the style loads, when it mounts before that", () => {
        renderTrack({ styleLoaded: false });

        // Nothing yet: there is no style to add to.
        expect(map.layers.size).toBe(0);

        act(() => map.loadStyle());

        expect(layer("layer")).toBeDefined();
        expect(trackCoordinates()?.coordinates).toHaveLength(2);
    });

    it("keeps the segments apart, rather than joining them across the gap", () => {
        map.loadStyle();
        renderTrack({ styleLoaded: true });

        expect(trackCoordinates()).toEqual({
            type: "MultiLineString",
            coordinates: [
                [ [ 24.13, 45.79 ], [ 24.14, 45.81 ] ],
                [ [ 24.142, 45.813 ], [ 24.08, 45.89 ] ]
            ]
        });
    });

    it("flags where the whole track begins and ends, not every segment", () => {
        map.loadStyle();
        renderTrack({ styleLoaded: true });

        // The start wears the note's own pin and says its name; the end wears the chequered flag.
        // Both carry the note, so whatever the pointer lands on can be traced back to it.
        const flags = marks().filter((mark) => mark.properties?.icon !== WAYPOINT_IMAGE);
        expect(flags.map((mark) => ({ ...mark.properties, at: mark.geometry.coordinates }))).toEqual([
            { id: NOTE_ID, icon: START_IMAGE, name: "A Sunday ride", at: [ 24.13, 45.79 ] },
            { id: NOTE_ID, icon: END_IMAGE, name: "", at: [ 24.08, 45.89 ] }
        ]);
    });

    it("marks the waypoints, each saying its own name", () => {
        map.loadStyle();
        renderTrack({ styleLoaded: true });

        const waypoints = marks().filter((mark) => mark.properties?.icon === WAYPOINT_IMAGE);
        expect(waypoints.map((mark) => mark.geometry))
            .toEqual([ { type: "Point", coordinates: [ 24.1, 45.9 ] } ]);
        // The waypoint's own <name>, not the note's: a file full of named crossings would
        // otherwise put up pins that answer only to a click.
        expect(waypoints[0].properties).toMatchObject({ id: NOTE_ID, name: "A rest" });
    });

    it("marks the waypoints of a file that draws no line at all", async () => {
        map.loadStyle();
        renderTrack({
            styleLoaded: true,
            gpx: `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><wpt lat="1" lon="2" /></gpx>`
        });
        await settle();

        expect(layer("layer")).toBeUndefined();
        expect(layer("marks")).toBeDefined();
        expect(marks()).toHaveLength(1);
    });

    /**
     * The marks are the second half of the track to go up: their pins come out of the shared
     * rasterizer (see Markers), which is asynchronous, and the line must not wait on them — it used
     * to, back when the icons were resolved before anything was drawn at all.
     */
    it("stamps the marks once their pins are drawn, without holding the line back", async () => {
        map.loadStyle();
        renderTrack({ styleLoaded: true });

        // The line is up at once; the marks are still waiting on their pins.
        expect(layer("layer")).toBeDefined();
        expect(layer("marks")).toBeUndefined();

        await settle();

        expect(layer("marks")?.layout?.["icon-image"]).toEqual([ "get", "icon" ]);
        // Stamped with the very pins the note markers stamp, filed under the same names.
        for (const id of [ START_IMAGE, END_IMAGE, WAYPOINT_IMAGE ]) {
            expect(map.images.has(id)).toBe(true);
        }
    });

    /**
     * A file may hold several tracks, and each is a journey of its own: a line of its own — named
     * by the feature's `track` index, which is how a click on one says which it hit (see the pane's
     * focus in DetailPane) — flagged with its own start and end, and labelled with its own name
     * where the file gives one. One pair of flags strung across the file marked a start in one town
     * and an end in another as though something ran between.
     */
    it("draws each of the file's tracks as a journey of its own", () => {
        map.loadStyle();
        renderTrack({
            styleLoaded: true,
            gpx: `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Day one</name><trkseg>
    <trkpt lat="45.79" lon="24.13" /><trkpt lat="45.81" lon="24.14" />
  </trkseg></trk>
  <trk><trkseg>
    <trkpt lat="46.20" lon="24.50" /><trkpt lat="46.30" lon="24.60" />
  </trkseg></trk>
</gpx>`
        });

        const lines = features().filter((feature) => feature.geometry.type === "MultiLineString");
        expect(lines.map((line) => line.properties)).toEqual([
            // Named for itself where the file names it, for the note where it does not.
            { id: NOTE_ID, track: 0, name: "Day one" },
            { id: NOTE_ID, track: 1, name: "A Sunday ride" }
        ]);

        // A pair of flags per journey, the start of each saying its own name.
        expect(marks().map((mark) => ({ ...mark.properties, at: mark.geometry.coordinates }))).toEqual([
            { id: NOTE_ID, icon: START_IMAGE, name: "Day one", at: [ 24.13, 45.79 ] },
            { id: NOTE_ID, icon: END_IMAGE, name: "", at: [ 24.14, 45.81 ] },
            { id: NOTE_ID, icon: START_IMAGE, name: "A Sunday ride", at: [ 24.5, 46.2 ] },
            { id: NOTE_ID, icon: END_IMAGE, name: "", at: [ 24.6, 46.3 ] }
        ]);
    });

    it("draws a route as it draws a track", () => {
        map.loadStyle();
        renderTrack({
            styleLoaded: true,
            gpx: `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <rte><rtept lat="1" lon="2" /><rtept lat="3" lon="4" /></rte>
</gpx>`
        });

        expect(trackCoordinates()?.coordinates).toEqual([ [ [ 2, 1 ], [ 4, 3 ] ] ]);
    });

    it("skips a point that does not say where it is, rather than placing it at zero", () => {
        map.loadStyle();
        renderTrack({
            styleLoaded: true,
            gpx: `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="45.79" lon="24.13" />
    <trkpt lon="24.14" />
    <trkpt lat="45.81" lon="24.15" />
  </trkseg></trk>
</gpx>`
        });

        expect(trackCoordinates()?.coordinates).toEqual([ [ [ 24.13, 45.79 ], [ 24.15, 45.81 ] ] ]);
    });

    it("puts the line and its marks back when the style is switched under it", async () => {
        map.loadStyle();
        renderTrack({ styleLoaded: true });
        await settle();
        expect(map.layers.size).toBe(4);

        // A style is a world of its own: switching one takes everything on it away, images included.
        map.layers.clear();
        map.sources.clear();
        map.images.clear();
        await act(async () => map.loadStyle());
        await settle();

        expect(map.layers.size).toBe(4);
        expect(map.images.has(START_IMAGE)).toBe(true);
        expect(trackCoordinates()?.type).toBe("MultiLineString");
    });

    it("writes the note's name along the line, in the fontstack the styles carry", () => {
        map.loadStyle();
        renderTrack({ styleLoaded: true });

        const label = layer("label");
        expect(label?.layout?.["symbol-placement"]).toBe("line");
        expect(label?.layout?.["text-field"]).toEqual([ "get", "name" ]);
        expect(label?.layout?.["text-font"]).toEqual([ "Open Sans Regular" ]);
        expect(trackProperties()).toEqual({ id: NOTE_ID, track: 0, name: "A Sunday ride" });
    });

    it("draws the name the way the marker titles are drawn, light map or dark", () => {
        map.loadStyle();
        renderTrack({ styleLoaded: true, isDarkTheme: true });

        expect(layer("label")?.paint).toMatchObject(LABEL_PAINT.dark);
    });

    it("leaves the names off when the map's titles are hidden", async () => {
        map.loadStyle();
        renderTrack({ styleLoaded: true, hideLabels: true });

        expect(layer("label")).toBeUndefined();
        // The line and the target for pointing at it are still there.
        expect(layer("layer")).toBeDefined();
        expect(layer("hit")).toBeDefined();

        // The marks keep their pins and lose only their words.
        await settle();
        expect(layer("marks")?.layout?.["text-field"]).toBe("");
    });

    it("gives the line a target wide enough to be pointed at, without drawing it", () => {
        map.loadStyle();
        renderTrack({ styleLoaded: true });

        const hit = layer("hit");
        expect(hit?.paint["line-opacity"]).toBe(0);
        // Wider than the three pixels the line is drawn with, or nobody could hit it.
        expect(hit?.paint["line-width"]).toBeGreaterThan(layer("layer")?.paint["line-width"] as number);
    });

    it("offers its target and its marks to whatever hit-tests the tracks", async () => {
        map.loadStyle();
        renderTrack({ styleLoaded: true });
        await settle();

        // The line and the label are not offered: what is pointable is the widened target and the
        // flags — a flag is as much the track as the line is.
        expect(trackHitLayers(map as never)).toEqual([ `gpx-hit-${NOTE_ID}`, `gpx-marks-${NOTE_ID}` ]);

        act(() => render(null, container));

        // And a track that has gone is no longer named, so a query cannot ask for a layer that the
        // style has since lost.
        expect(trackHitLayers(map as never)).toEqual([]);
    });

    it("names its layers after the note, so a rerun does not churn through fresh ones", async () => {
        map.loadStyle();
        renderTrack({ styleLoaded: true });
        await settle();
        const first = [ ...map.layers.keys() ];

        // The same track drawn again.
        renderTrack({ styleLoaded: true });
        await settle();

        expect([ ...map.layers.keys() ]).toEqual(first);
        expect(first).toEqual([ `gpx-layer-${NOTE_ID}`, `gpx-hit-${NOTE_ID}`, `gpx-label-${NOTE_ID}`, `gpx-marks-${NOTE_ID}` ]);
    });

    it("draws nothing for a file with no points, and does not throw over it", async () => {
        map.loadStyle();
        renderTrack({
            styleLoaded: true,
            gpx: `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1" />`
        });
        await settle();

        expect(map.layers.size).toBe(0);
        expect(map.sources.size).toBe(0);
    });

    it("takes the track off the map when it goes", async () => {
        map.loadStyle();
        renderTrack({ styleLoaded: true });
        await settle();
        expect(map.layers.size).toBe(4);

        act(() => render(null, container));

        expect(map.layers.size).toBe(0);
        expect(map.sources.size).toBe(0);
    });
});
