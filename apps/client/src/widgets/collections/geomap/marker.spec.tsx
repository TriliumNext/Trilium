import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../test/render";

// --- Module mocks (hoisted above the component import) ---------------------------------------------

// A fake Leaflet marker that records event handlers so we can drive click/mousedown/moveend/contextmenu.
interface FakeMarker {
    coordinates: unknown;
    options: unknown;
    handlers: Record<string, Array<(...args: unknown[]) => void>>;
    on: ReturnType<typeof vi.fn>;
    addTo: ReturnType<typeof vi.fn>;
    removeFrom: ReturnType<typeof vi.fn>;
    getLatLng: ReturnType<typeof vi.fn>;
    fire(name: string, ...args: unknown[]): void;
}

interface FakeGpx {
    xml: string;
    options: unknown;
    addTo: ReturnType<typeof vi.fn>;
    removeFrom: ReturnType<typeof vi.fn>;
}

const created: {
    markers: FakeMarker[];
    gpxTracks: FakeGpx[];
} = { markers: [], gpxTracks: [] };

// The lat/lng a dragged marker reports when moveend fires.
const draggedLatLng = { lat: 11, lng: 22 };

function makeFakeMarker(coordinates: unknown, options: unknown): FakeMarker {
    const handlers: FakeMarker["handlers"] = {};
    const m: FakeMarker = {
        coordinates,
        options,
        handlers,
        on: vi.fn((name: string, fn: (...args: unknown[]) => void) => {
            (handlers[name] ??= []).push(fn);
            return m;
        }),
        addTo: vi.fn(() => m),
        removeFrom: vi.fn(() => m),
        getLatLng: vi.fn(() => draggedLatLng),
        fire(name: string, ...args: unknown[]) {
            for (const h of handlers[name] ?? []) h(...args);
        }
    };
    return m;
}

vi.mock("leaflet-gpx", () => ({}));

vi.mock("leaflet", () => {
    const markerFn = vi.fn((coordinates: unknown, options: unknown) => {
        const m = makeFakeMarker(coordinates, options);
        created.markers.push(m);
        return m;
    });

    class GPX {
        xml: string;
        options: unknown;
        addTo = vi.fn(() => this);
        removeFrom = vi.fn(() => this);
        constructor(xml: string, options: unknown) {
            this.xml = xml;
            this.options = options;
            created.gpxTracks.push(this as unknown as FakeGpx);
        }
    }

    return {
        marker: markerFn,
        GPX,
        // Type-only / class placeholders referenced by the source.
        DivIcon: class {},
        Icon: class {},
        LatLng: class {},
        Marker: class {},
        LeafletMouseEvent: class {}
    };
});

import { ComponentChildren } from "preact";

import Marker, { GpxTrack } from "./marker";
import { ParentMap } from "./map";

// --- Helpers --------------------------------------------------------------------------------------

// Unmount a container rendered via the shared `renderInto` (the shared helper also auto-tears down
// in an afterEach, but several tests need to unmount mid-test to assert cleanup behaviour).
function unmount(container: HTMLElement) {
    act(() => render(null, container));
}

// A minimal stand-in for a Leaflet map; Marker.addTo/removeFrom just receive it.
const fakeMap = { id: "fake-map" } as never;

function withMap(node: ComponentChildren, map: unknown = fakeMap) {
    return <ParentMap.Provider value={map as never}>{node}</ParentMap.Provider>;
}

beforeEach(() => {
    created.markers.length = 0;
    created.gpxTracks.length = 0;
});

// --- Tests ----------------------------------------------------------------------------------------

describe("Marker (geomap)", () => {
    const onContextMenu = vi.fn();

    it("does nothing without a parent map (early return) but still renders a div", () => {
        const root = renderInto(
            <ParentMap.Provider value={null}>
                <Marker coordinates={[1, 2]} onContextMenu={onContextMenu} />
            </ParentMap.Provider>
        );
        expect(root.querySelector("div")).not.toBeNull();
        expect(created.markers.length).toBe(0);
    });

    it("creates a marker with the given coordinates and icon and adds it to the map", () => {
        const icon = { iconKind: "div" } as never;
        renderInto(withMap(<Marker coordinates={[3, 4]} icon={icon} onContextMenu={onContextMenu} />));
        expect(created.markers.length).toBe(1);
        const m = created.markers[0];
        expect(m.coordinates).toEqual([3, 4]);
        expect(m.options).toMatchObject({ icon });
        // No draggable options when draggable is falsy.
        expect(m.options).not.toHaveProperty("draggable");
        expect(m.addTo).toHaveBeenCalledWith(fakeMap);
    });

    it("sets draggable/autoPan options when draggable is true", () => {
        renderInto(withMap(<Marker coordinates={[5, 6]} draggable onContextMenu={onContextMenu} />));
        const m = created.markers[0];
        expect(m.options).toMatchObject({ draggable: true, autoPan: true, autoPanSpeed: 5 });
    });

    it("wires onClick and forwards the call", () => {
        const onClick = vi.fn();
        renderInto(withMap(<Marker coordinates={[1, 1]} onClick={onClick} onContextMenu={onContextMenu} />));
        const m = created.markers[0];
        m.fire("click");
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("wires onMouseDown and forwards the original DOM event", () => {
        const onMouseDown = vi.fn();
        renderInto(withMap(<Marker coordinates={[1, 1]} onMouseDown={onMouseDown} onContextMenu={onContextMenu} />));
        const m = created.markers[0];
        const originalEvent = { type: "mousedown" } as unknown as MouseEvent;
        m.fire("mousedown", { originalEvent });
        expect(onMouseDown).toHaveBeenCalledWith(originalEvent);
    });

    it("wires onDragged (moveend) and forwards the marker's new coordinates", () => {
        const onDragged = vi.fn();
        renderInto(withMap(<Marker coordinates={[1, 1]} draggable onDragged={onDragged} onContextMenu={onContextMenu} />));
        const m = created.markers[0];
        // The handler reads e.target.getLatLng().
        m.fire("moveend", { target: m });
        expect(m.getLatLng).toHaveBeenCalled();
        expect(onDragged).toHaveBeenCalledWith(draggedLatLng);
    });

    it("wires onContextMenu and forwards the leaflet event", () => {
        const ctxHandler = vi.fn();
        renderInto(withMap(<Marker coordinates={[1, 1]} onContextMenu={ctxHandler} />));
        const m = created.markers[0];
        const evt = { latlng: draggedLatLng } as never;
        m.fire("contextmenu", evt);
        expect(ctxHandler).toHaveBeenCalledWith(evt);
    });

    it("does not register optional handlers when callbacks are omitted", () => {
        renderInto(withMap(<Marker coordinates={[1, 1]} onContextMenu={onContextMenu} />));
        const m = created.markers[0];
        expect(m.handlers["click"]).toBeUndefined();
        expect(m.handlers["mousedown"]).toBeUndefined();
        expect(m.handlers["moveend"]).toBeUndefined();
        // onContextMenu is always provided, so its handler is registered.
        expect(m.handlers["contextmenu"]?.length).toBe(1);
    });

    it("removes the marker from the map on unmount", () => {
        const root = renderInto(withMap(<Marker coordinates={[1, 1]} onContextMenu={onContextMenu} />));
        const m = created.markers[0];
        unmount(root);
        expect(m.removeFrom).toHaveBeenCalledWith(fakeMap);
    });

    it("recreates the marker when coordinates change (re-running the effect)", () => {
        const root = renderInto(withMap(<Marker coordinates={[1, 1]} onContextMenu={onContextMenu} />));
        expect(created.markers.length).toBe(1);
        const firstMarker = created.markers[0];
        act(() => render(withMap(<Marker coordinates={[9, 9]} onContextMenu={onContextMenu} />), root));
        // Old marker removed, new marker created with the new coordinates.
        expect(firstMarker.removeFrom).toHaveBeenCalledWith(fakeMap);
        expect(created.markers.length).toBe(2);
        expect(created.markers[1].coordinates).toEqual([9, 9]);
    });
});

describe("GpxTrack (geomap)", () => {
    const options = { polyline_options: { color: "red" } } as never;

    it("does nothing without a parent map (early return) but still renders a div", () => {
        const root = renderInto(
            <ParentMap.Provider value={null}>
                <GpxTrack gpxXmlString="<gpx/>" options={options} />
            </ParentMap.Provider>
        );
        expect(root.querySelector("div")).not.toBeNull();
        expect(created.gpxTracks.length).toBe(0);
    });

    it("creates a GPX track from the xml + options and adds it to the map", () => {
        renderInto(withMap(<GpxTrack gpxXmlString="<gpx>data</gpx>" options={options} />));
        expect(created.gpxTracks.length).toBe(1);
        const track = created.gpxTracks[0];
        expect(track.xml).toBe("<gpx>data</gpx>");
        expect(track.options).toBe(options);
        expect(track.addTo).toHaveBeenCalledWith(fakeMap);
    });

    it("removes the track from the map on unmount", () => {
        const root = renderInto(withMap(<GpxTrack gpxXmlString="<gpx/>" options={options} />));
        const track = created.gpxTracks[0];
        unmount(root);
        expect(track.removeFrom).toHaveBeenCalledWith(fakeMap);
    });

    it("re-creates the track when the xml string changes", () => {
        const root = renderInto(withMap(<GpxTrack gpxXmlString="<gpx>a</gpx>" options={options} />));
        const first = created.gpxTracks[0];
        act(() => render(withMap(<GpxTrack gpxXmlString="<gpx>b</gpx>" options={options} />), root));
        expect(first.removeFrom).toHaveBeenCalledWith(fakeMap);
        expect(created.gpxTracks.length).toBe(2);
        expect(created.gpxTracks[1].xml).toBe("<gpx>b</gpx>");
    });
});
