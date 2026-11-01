/**
 * The hand-drawn shape (see ShapeLayer.tsx): that it goes onto a loaded style and not before, that
 * a line is a stroke alone while an area adds a fill under the same stroke, that it is re-added
 * after a style switch wipes the map, and that it leaves nothing behind when it goes. Then the name
 * a shape answers a hover with, the only thing on the map that names it.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../../../test/easy-froca";
import type { GeoShape } from "./shapes";
import { shapeHitLayers, ShapeLayer, ShapeNames, shapeSourceId } from "./ShapeLayer";
import { MapStyleLoaded, ParentMap } from "./map";
import { MARKER_LAYER } from "./Markers";

/** The popup MapLibre would draw, recording what it was shown and whether it is up. */
const { FakePopup } = vi.hoisted(() => {
    class FakePopup {
        static open: FakePopup[] = [];

        content: HTMLElement | null = null;

        setLngLat() { return this; }
        setDOMContent(content: HTMLElement) { this.content = content; return this; }
        addTo() {
            if (!FakePopup.open.includes(this)) FakePopup.open.push(this);
            return this;
        }
        remove() {
            FakePopup.open = FakePopup.open.filter((popup) => popup !== this);
            return this;
        }
    }

    return { FakePopup };
});

// map.ts reaches for these at load; only the popup is exercised here.
vi.mock("maplibre-gl", () => ({ GeolocateControl: class {}, Popup: FakePopup, setWorkerUrl: vi.fn() }));

/**
 * A map as MapLibre behaves, in the one respect that matters here: a source or a layer can only be
 * added to a style that has finished loading, and asking for one before then throws.
 */
function fakeMap() {
    const sources = new Map<string, unknown>();
    const layers = new Map<string, unknown>();
    const listeners = new Map<string, (() => void)[]>();
    let loaded = false;

    return {
        sources,
        layers,

        on(type: string, listener: () => void) {
            listeners.set(type, [ ...(listeners.get(type) ?? []), listener ]);
        },
        off(type: string, listener: () => void) {
            listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== listener));
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
        removeSource(id: string) {
            sources.delete(id);
        },
        removeLayer(id: string) {
            layers.delete(id);
        },
        /** The style's layers in the order they were added, which is how the hit layers are found. */
        getLayersOrder() {
            return [ ...layers.keys() ];
        },

        /** The style finishing, which is what `style.load` reports. */
        loadStyle() {
            loaded = true;
            for (const listener of listeners.get("style.load") ?? []) {
                listener();
            }
        },
        /** A style switch: everything wiped, then `style.load` again. */
        switchStyle() {
            sources.clear();
            layers.clear();
            this.loadStyle();
        }
    };
}

const NOTE_ID = "shapeNoteId1";
const LINE: GeoShape = { type: "line", coordinates: [ [ 24.13, 45.79 ], [ 24.14, 45.81 ], [ 24.08, 45.89 ] ] };
const POLYGON: GeoShape = { type: "polygon", coordinates: [ [ 24.13, 45.79 ], [ 24.14, 45.81 ], [ 24.08, 45.89 ] ] };

describe("ShapeLayer", () => {
    let container: HTMLElement;
    let map: ReturnType<typeof fakeMap>;

    beforeEach(() => {
        map = fakeMap();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    function renderShape(shape: GeoShape, { styleLoaded = true } = {}) {
        act(() => {
            render(
                <ParentMap.Provider value={map as never}>
                    <MapStyleLoaded.Provider value={styleLoaded}>
                        <ShapeLayer noteId={NOTE_ID} shape={shape} color="purple" />
                    </MapStyleLoaded.Provider>
                </ParentMap.Provider>,
                container
            );
        });
    }

    it("draws a line as its stroke alone, and takes it down when unmounted", () => {
        map.loadStyle();
        renderShape(LINE);

        const source = map.sources.get(shapeSourceId(NOTE_ID)) as {
            data: { properties: { id: string }; geometry: { type: string; coordinates: unknown } };
        };
        expect(source.data.geometry.type).toBe("LineString");
        expect(source.data.geometry.coordinates).toEqual(LINE.coordinates);
        // The note the shape belongs to is carried in the feature, for the hit test to read.
        expect(source.data.properties.id).toBe(NOTE_ID);

        const stroke = map.layers.get(`shape-stroke-${NOTE_ID}`) as { paint: Record<string, unknown> };
        expect(stroke.paint["line-color"]).toBe("purple");
        // No fill under a line, which encloses nothing.
        expect(map.layers.has(`shape-fill-${NOTE_ID}`)).toBe(false);

        act(() => render(null, container));
        expect(map.sources.size).toBe(0);
        expect(map.layers.size).toBe(0);
    });

    it("draws an area as a wash under the stroke, its ring closed back up for GeoJSON", () => {
        map.loadStyle();
        renderShape(POLYGON);

        const source = map.sources.get(shapeSourceId(NOTE_ID)) as {
            data: { geometry: { type: string; coordinates: [number, number][][] } };
        };
        expect(source.data.geometry.type).toBe("Polygon");
        // The label leaves the closing point unwritten, and GeoJSON ends the ring where it began.
        expect(source.data.geometry.coordinates[0]).toEqual([ ...POLYGON.coordinates, POLYGON.coordinates[0] ]);

        const fill = map.layers.get(`shape-fill-${NOTE_ID}`) as { paint: Record<string, unknown> };
        expect(fill.paint["fill-color"]).toBe("purple");
        expect(map.layers.has(`shape-stroke-${NOTE_ID}`)).toBe(true);

        act(() => render(null, container));
        expect(map.layers.size).toBe(0);
    });

    it("draws a circle as the ring its two numbers walk out, worn like any other area", () => {
        map.loadStyle();
        renderShape({ type: "circle", center: [ 2.29, 48.85 ], radiusMeters: 500 });

        const source = map.sources.get(shapeSourceId(NOTE_ID)) as {
            data: { geometry: { type: string; coordinates: [number, number][][] } };
        };
        expect(source.data.geometry.type).toBe("Polygon");
        const ring = source.data.geometry.coordinates[0];
        // The generated ring, closed back up: sixty-four corners and the closing repeat.
        expect(ring).toHaveLength(65);
        expect(ring[0]).toEqual(ring[ring.length - 1]);
        expect(map.layers.has(`shape-fill-${NOTE_ID}`)).toBe(true);
        expect(map.layers.has(`shape-stroke-${NOTE_ID}`)).toBe(true);
    });

    /**
     * The boundary is drawn 3px wide, too thin to click reliably, so a transparent line far wider
     * than that takes the pointer hits, as a GPX track's does. An area is clickable across its
     * inside as well as along its edge.
     */
    it("stands a widened transparent line in for the boundary, an area offering its wash as well", () => {
        map.loadStyle();
        renderShape(LINE);

        const hit = map.layers.get(`shape-hit-${NOTE_ID}`) as { paint: Record<string, unknown> };
        // Drawn at zero opacity rather than hidden: MapLibre drops a layer from a query for
        // `visibility: none` but not for being invisible.
        expect(hit.paint["line-opacity"]).toBe(0);
        expect(hit.paint["line-width"]).toBe(20);
        expect(shapeHitLayers(map as never)).toEqual([ `shape-hit-${NOTE_ID}` ]);

        act(() => render(null, container));
        // The hit line goes with the rest: a query naming a layer the style has lost returns
        // nothing at all, for every shape.
        expect(map.layers.size).toBe(0);

        renderShape(POLYGON);
        expect(shapeHitLayers(map as never)).toEqual([ `shape-fill-${NOTE_ID}`, `shape-hit-${NOTE_ID}` ]);
    });

    it("waits for the style, and is put back when a style switch wipes the map", () => {
        // Mounted before the style has loaded, as a shape whose note arrives early is, so nothing
        // can go on yet.
        renderShape(LINE, { styleLoaded: false });
        expect(map.sources.size).toBe(0);

        // MapStyleLoaded turning true is a new render, and the style reports itself as well.
        act(() => map.loadStyle());
        renderShape(LINE, { styleLoaded: true });
        expect(map.sources.has(shapeSourceId(NOTE_ID))).toBe(true);

        // A style switch takes everything with it, and `style.load` is the cue to put it back.
        act(() => map.switchStyle());
        expect(map.sources.has(shapeSourceId(NOTE_ID))).toBe(true);
        expect(map.layers.has(`shape-stroke-${NOTE_ID}`)).toBe(true);
    });
});

/**
 * A map that reports what is under the pointer and takes listeners bound to named layers, which is
 * what a hover is read through (see `useHoverName`).
 */
function hoverMap(shapeLayers = [ `shape-hit-${NOTE_ID}` ]) {
    const listeners = new Map<string, Set<(e?: unknown) => void>>();
    const canvas = { style: { cursor: "" } };
    let layers = shapeLayers;
    let marker: string | null = null;
    let shape: string | null = NOTE_ID;

    function fire(key: string, event?: unknown) {
        for (const fn of listeners.get(key) ?? []) fn(event);
    }

    return {
        get cursor() { return canvas.style.cursor; },
        /** The cursor another layer's hover has set, which this one must not clear. */
        setCursor(cursor: string) { canvas.style.cursor = cursor; },
        /** Which of the map's notes the pointer is really over, the marker being the smaller target. */
        setUnderPointer({ markerNoteId = null as string | null, shapeNoteId = null as string | null }) {
            marker = markerNoteId;
            shape = shapeNoteId;
        },
        /** A shape drawn while the map is up, which MapLibre reports as a change to the style. */
        addShapeLayer(id: string) {
            layers = [ ...layers, id ];
            fire("styledata");
        },
        /** The layers the pointer is currently watched on. */
        boundLayers() {
            return [ ...listeners.keys() ]
                .filter((key) => key.startsWith("mousemove:") && (listeners.get(key)?.size ?? 0) > 0)
                .flatMap((key) => key.slice("mousemove:".length).split(",").filter(Boolean));
        },
        /** The pointer coming to rest, as MapLibre reports it to a layer-bound listener. */
        hover() {
            for (const key of [ ...listeners.keys() ].filter((k) => k.startsWith("mousemove:"))) {
                fire(key, { point: { x: 10, y: 20 }, lngLat: { lng: 24.13, lat: 45.79 } });
            }
        },
        click() { fire("click"); },
        on(event: string, fnOrLayers: unknown, fn?: (e?: unknown) => void) {
            const key = fn ? `${event}:${fnOrLayers}` : event;
            if (!listeners.has(key)) listeners.set(key, new Set());
            listeners.get(key)?.add((fn ?? fnOrLayers) as (e?: unknown) => void);
        },
        off(event: string, fnOrLayers: unknown, fn?: (e?: unknown) => void) {
            listeners.get(fn ? `${event}:${fnOrLayers}` : event)?.delete((fn ?? fnOrLayers) as () => void);
        },
        getLayersOrder: () => layers,
        getCanvas: () => canvas,
        queryRenderedFeatures(_point: unknown, { layers: queried }: { layers: string[] }) {
            if (queried.includes(MARKER_LAYER)) {
                return marker ? [ { properties: { id: marker }, layer: { id: MARKER_LAYER } } ] : [];
            }
            return shape && queried.length
                ? [ { properties: { id: shape }, layer: { id: queried[0] } } ]
                : [];
        }
    };
}

describe("ShapeNames", () => {
    /** Long enough for the delay the name is held back by, whatever it is set to. */
    const RESTED = 500;
    let container: HTMLElement;

    beforeEach(() => {
        vi.useFakeTimers();
        FakePopup.open = [];
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        vi.useRealTimers();
    });

    function renderNames(map: ReturnType<typeof hoverMap>) {
        act(() => {
            render(
                <ParentMap.Provider value={map as never}>
                    <ShapeNames />
                </ParentMap.Provider>,
                container
            );
        });
    }

    /** What the name currently reads, or `null` where none is up. */
    function nameText() {
        return FakePopup.open[0]?.content?.textContent ?? null;
    }

    it("names the shape the pointer has come to rest on", () => {
        buildNote({ id: NOTE_ID, title: "The lot", "#geoShape": "polygon:45.79,24.13 45.81,24.16 45.89,24.08" });
        const map = hoverMap();
        renderNames(map);

        map.hover();
        // Not while the pointer is merely passing over it.
        expect(nameText()).toBeNull();

        vi.advanceTimersByTime(RESTED);
        expect(nameText()).toBe("The lot");
        expect(map.cursor).toBe("pointer");

        // The name would otherwise stand over whatever the click opened.
        act(() => map.click());
        expect(nameText()).toBeNull();
    });

    /**
     * A pin inside a polygon is the smaller target and the one a click means, and it sets its own
     * cursor, so the shape neither names itself nor clears what the marker set.
     */
    it("says nothing while a marker standing on the shape is what the pointer is on", () => {
        buildNote({ id: NOTE_ID, title: "The lot", "#geoShape": "polygon:45.79,24.13 45.81,24.16 45.89,24.08" });
        buildNote({ id: "markerNoteId1", title: "The well", "#geolocation": "45.8,24.14" });
        const map = hoverMap();
        renderNames(map);
        map.setUnderPointer({ markerNoteId: "markerNoteId1", shapeNoteId: NOTE_ID });
        // The cursor the marker's own hover has just set (see Markers).
        map.setCursor("pointer");

        map.hover();
        vi.advanceTimersByTime(RESTED);

        // Neither the shape's name nor the marker's: the marker answers for itself.
        expect(nameText()).toBeNull();
        expect(map.cursor).toBe("pointer");
    });

    /** A shape drawn while the map is up adds a layer nothing was watching. */
    it("watches a shape drawn after it was bound", () => {
        const map = hoverMap();
        renderNames(map);

        expect(map.boundLayers()).toEqual([ `shape-hit-${NOTE_ID}` ]);

        act(() => map.addShapeLayer("shape-fill-shapeNoteId2"));
        expect(map.boundLayers()).toEqual([ `shape-hit-${NOTE_ID}`, "shape-fill-shapeNoteId2" ]);
    });
});
