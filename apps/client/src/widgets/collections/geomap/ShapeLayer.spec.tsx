/**
 * The hand-drawn shape (see ShapeLayer.tsx): that it goes onto a loaded style and not before, that
 * a line is a stroke alone while an area wears a wash under the same stroke, that it is put back
 * after a style switch wipes the map, and that it leaves nothing behind when it goes.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GeoShape } from "./shapes";
import { ShapeLayer, shapeSourceId } from "./ShapeLayer";
import { MapStyleLoaded, ParentMap } from "./map";

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

        /** The style finishing, which is what `style.load` announces. */
        loadStyle() {
            loaded = true;
            for (const listener of listeners.get("style.load") ?? []) {
                listener();
            }
        },
        /** A style switch as the shape experiences one: everything wiped, then `style.load` again. */
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
        // The note the shape stands for rides in the feature, for whatever comes to hit-test it.
        expect(source.data.properties.id).toBe(NOTE_ID);

        const stroke = map.layers.get(`shape-stroke-${NOTE_ID}`) as { paint: Record<string, unknown> };
        expect(stroke.paint["line-color"]).toBe("purple");
        // No wash under a line: it encloses nothing.
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
        // The label leaves the closing point unwritten; GeoJSON wants the ring ended where it began.
        expect(source.data.geometry.coordinates[0]).toEqual([ ...POLYGON.coordinates, POLYGON.coordinates[0] ]);

        const fill = map.layers.get(`shape-fill-${NOTE_ID}`) as { paint: Record<string, unknown> };
        expect(fill.paint["fill-color"]).toBe("purple");
        expect(map.layers.has(`shape-stroke-${NOTE_ID}`)).toBe(true);

        act(() => render(null, container));
        expect(map.layers.size).toBe(0);
    });

    it("waits for the style, and is put back when a style switch wipes the map", () => {
        // Mounted before the style has loaded — as a shape whose note arrives early always is —
        // nothing can go on yet.
        renderShape(LINE, { styleLoaded: false });
        expect(map.sources.size).toBe(0);

        // MapStyleLoaded flipping true is a new render; the style itself also announces itself.
        act(() => map.loadStyle());
        renderShape(LINE, { styleLoaded: true });
        expect(map.sources.has(shapeSourceId(NOTE_ID))).toBe(true);

        // A style switch takes everything with it, and `style.load` is the cue to put it back.
        act(() => map.switchStyle());
        expect(map.sources.has(shapeSourceId(NOTE_ID))).toBe(true);
        expect(map.layers.has(`shape-stroke-${NOTE_ID}`)).toBe(true);
    });
});
