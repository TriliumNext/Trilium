import { render } from "preact";
import { useContext } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) ---------------------------------------------

// A fake Leaflet map that records event handlers so we can drive moveend/zoomend/click/etc.
interface FakeMap {
    handlers: Record<string, Array<(...args: unknown[]) => void>>;
    off: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    setView: ReturnType<typeof vi.fn>;
    getZoom: ReturnType<typeof vi.fn>;
    getBounds: ReturnType<typeof vi.fn>;
    invalidateSize: ReturnType<typeof vi.fn>;
    fire(name: string, ...args: unknown[]): void;
}

const created: {
    maps: FakeMap[];
    tileLayers: Array<{ url: string; opts: unknown; addTo: ReturnType<typeof vi.fn>; removeFrom: ReturnType<typeof vi.fn> }>;
    maplibreLayers: Array<{ opts: unknown; addTo: ReturnType<typeof vi.fn>; removeFrom: ReturnType<typeof vi.fn> }>;
    scaleControls: Array<{ addTo: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }>;
    maplibreImported: number;
} = { maps: [], tileLayers: [], maplibreLayers: [], scaleControls: [], maplibreImported: 0 };

function makeFakeMap(): FakeMap {
    const handlers: FakeMap["handlers"] = {};
    const map: FakeMap = {
        handlers,
        off: vi.fn((name?: string, fn?: (...args: unknown[]) => void) => {
            if (!name) {
                for (const key of Object.keys(handlers)) delete handlers[key];
                return;
            }
            if (fn && handlers[name]) {
                handlers[name] = handlers[name].filter((h) => h !== fn);
            } else {
                delete handlers[name];
            }
        }),
        remove: vi.fn(),
        on: vi.fn((name: string, fn: (...args: unknown[]) => void) => {
            (handlers[name] ??= []).push(fn);
        }),
        setView: vi.fn(),
        getZoom: vi.fn(() => 7),
        getBounds: vi.fn(() => ({ getCenter: () => ({ lat: 1, lng: 2 }) })),
        invalidateSize: vi.fn(),
        fire(name: string, ...args: unknown[]) {
            for (const h of handlers[name] ?? []) h(...args);
        }
    };
    return map;
}

vi.mock("leaflet/dist/leaflet.css", () => ({}));

vi.mock("@maplibre/maplibre-gl-leaflet", () => {
    created.maplibreImported++;
    return {};
});

vi.mock("leaflet", () => {
    function makeLayer(store: { addTo: ReturnType<typeof vi.fn>; removeFrom: ReturnType<typeof vi.fn> }) {
        store.addTo = vi.fn(() => store);
        store.removeFrom = vi.fn(() => store);
        return store;
    }

    const L = {
        map: vi.fn(() => {
            const m = makeFakeMap();
            created.maps.push(m);
            return m;
        }),
        tileLayer: vi.fn((url: string, opts: unknown) => {
            const layer = makeLayer({} as never) as never as { url: string; opts: unknown; addTo: ReturnType<typeof vi.fn>; removeFrom: ReturnType<typeof vi.fn> };
            layer.url = url;
            layer.opts = opts;
            created.tileLayers.push(layer);
            return layer;
        }),
        maplibreGL: vi.fn((opts: unknown) => {
            const layer = makeLayer({} as never) as never as { opts: unknown; addTo: ReturnType<typeof vi.fn>; removeFrom: ReturnType<typeof vi.fn> };
            layer.opts = opts;
            created.maplibreLayers.push(layer);
            return layer;
        })
    };

    const control = {
        scale: vi.fn(() => {
            const ctrl = { addTo: vi.fn(() => ctrl), remove: vi.fn() };
            created.scaleControls.push(ctrl);
            return ctrl;
        })
    };

    class LatLng {
        constructor(public lat: number, public lng: number) {}
    }

    return {
        default: L,
        control,
        LatLng,
        // Type-only exports referenced by the source; provide harmless placeholders.
        Layer: class {},
        LeafletMouseEvent: class {}
    };
});

// Stub a controllable ResizeObserver so useElementSize fires deterministically.
const resizeObservers: Array<{ cb: () => void; observe: ReturnType<typeof vi.fn>; unobserve: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];

import { ComponentChildren } from "preact";

import { MAP_LAYERS, type MapLayer } from "./map_layer";
import Map, { ParentMap } from "./map";

// --- Helpers --------------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
function renderInto(vnode: ComponentChildren) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(vnode as never, container as HTMLDivElement));
    return container;
}

const rasterLayer = MAP_LAYERS["openstreetmap"];
const vectorDarkLayer = MAP_LAYERS["versatiles-eclipse"];
const vectorStringStyle: MapLayer = { name: "Inline", type: "vector", style: "https://example.com/style.json" };

function baseProps(overrides: Partial<Parameters<typeof Map>[0]> = {}) {
    return {
        coordinates: [10, 20] as [number, number],
        zoom: 5,
        layerData: rasterLayer,
        viewportChanged: vi.fn(),
        children: null,
        scale: false,
        ...overrides
    };
}

async function flush() {
    // Drain several macrotasks: the vector load() chains two awaits (a dynamic JSON
    // import then the maplibre import) before pushing the layer, so a single tick
    // is not always enough — especially under coverage instrumentation.
    for (let i = 0; i < 8; i++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
}

async function flushUntil(predicate: () => boolean) {
    for (let i = 0; i < 50 && !predicate(); i++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
}

beforeEach(() => {
    created.maps.length = 0;
    created.tileLayers.length = 0;
    created.maplibreLayers.length = 0;
    created.scaleControls.length = 0;
    created.maplibreImported = 0;
    resizeObservers.length = 0;

    class FakeResizeObserver {
        cb: () => void;
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
        constructor(cb: () => void) {
            this.cb = cb;
            resizeObservers.push(this);
        }
    }
    Object.assign(window, { ResizeObserver: FakeResizeObserver });
});

afterEach(() => {
    if (container) {
        act(() => render(null, container as HTMLDivElement));
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("Map (geomap)", () => {
    it("renders the container with the base class and creates a Leaflet map", () => {
        const root = renderInto(<Map {...baseProps()} />);
        const div = root.querySelector(".geo-map-container");
        expect(div).not.toBeNull();
        expect(div?.className).toBe("geo-map-container ");
        expect(created.maps.length).toBe(1);
        // setView is applied with the provided coordinates/zoom.
        const map = created.maps[0];
        expect(map.setView).toHaveBeenCalledWith([10, 20], 5);
    });

    it("applies the dark theme class for dark layers", async () => {
        const root = renderInto(<Map {...baseProps({ layerData: vectorDarkLayer })} />);
        const div = root.querySelector(".geo-map-container");
        expect(div?.className).toBe("geo-map-container dark");
        await flush();
    });

    it("adds a raster tile layer with attribution and wrapping options", async () => {
        renderInto(<Map {...baseProps({ layerData: rasterLayer })} />);
        await flush();
        expect(created.tileLayers.length).toBe(1);
        const tile = created.tileLayers[0];
        expect(tile.url).toBe(rasterLayer.type === "raster" ? rasterLayer.url : "");
        expect(tile.opts).toMatchObject({ detectRetina: true, noWrap: true });
        // Layer is attached to the created map.
        expect(tile.addTo).toHaveBeenCalledWith(created.maps[0]);
    });

    it("loads a vector layer from a resolver function (importing maplibre)", async () => {
        renderInto(<Map {...baseProps({ layerData: vectorDarkLayer })} />);
        await flushUntil(() => created.maplibreLayers.length >= 1);
        expect(created.maplibreLayers.length).toBe(1);
        expect(created.maplibreLayers[0].opts).toHaveProperty("style");
        await flushUntil(() => created.maplibreLayers[0].addTo.mock.calls.length > 0);
        expect(created.maplibreLayers[0].addTo).toHaveBeenCalledWith(created.maps[0]);
    });

    it("loads a vector layer from a string style without calling a resolver", async () => {
        renderInto(<Map {...baseProps({ layerData: vectorStringStyle })} />);
        await flushUntil(() => created.maplibreLayers.length >= 1);
        expect(created.maplibreLayers.length).toBe(1);
        expect(created.maplibreLayers[0].opts).toMatchObject({ style: "https://example.com/style.json" });
    });

    it("invokes viewportChanged with the map center and zoom on move/zoom end", () => {
        const viewportChanged = vi.fn();
        renderInto(<Map {...baseProps({ viewportChanged })} />);
        const map = created.maps[0];
        map.fire("moveend");
        expect(viewportChanged).toHaveBeenCalledWith({ lat: 1, lng: 2 }, 7);
        map.fire("zoomend");
        expect(viewportChanged).toHaveBeenCalledTimes(2);
    });

    it("wires optional click, contextmenu and zoom handlers", () => {
        const onClick = vi.fn();
        const onContextMenu = vi.fn();
        const onZoom = vi.fn();
        renderInto(<Map {...baseProps({ onClick, onContextMenu, onZoom })} />);
        const map = created.maps[0];
        map.fire("click", { type: "click" });
        map.fire("contextmenu", { type: "contextmenu" });
        map.fire("zoom");
        expect(onClick).toHaveBeenCalledWith({ type: "click" });
        expect(onContextMenu).toHaveBeenCalledWith({ type: "contextmenu" });
        expect(onZoom).toHaveBeenCalledTimes(1);
    });

    it("does not register optional handlers when they are omitted", () => {
        renderInto(<Map {...baseProps()} />);
        const map = created.maps[0];
        expect(map.handlers["click"]).toBeUndefined();
        expect(map.handlers["contextmenu"]).toBeUndefined();
        expect(map.handlers["zoom"]).toBeUndefined();
    });

    it("adds a scale control only when scale is enabled", () => {
        renderInto(<Map {...baseProps({ scale: false })} />);
        expect(created.scaleControls.length).toBe(0);

        if (container) {
            act(() => render(null, container as HTMLDivElement));
            container.remove();
            container = undefined;
        }

        renderInto(<Map {...baseProps({ scale: true })} />);
        expect(created.scaleControls.length).toBe(1);
        const scaledMap = created.maps[created.maps.length - 1];
        expect(created.scaleControls[0].addTo).toHaveBeenCalledWith(scaledMap);
    });

    it("invalidates the map size when the container resizes", () => {
        renderInto(<Map {...baseProps()} />);
        const map = created.maps[0];
        const invalidateCallsBefore = map.invalidateSize.mock.calls.length;
        act(() => resizeObservers.forEach((o) => o.cb()));
        expect(map.invalidateSize.mock.calls.length).toBeGreaterThan(invalidateCallsBefore);
    });

    it("exposes the underlying map via apiRef", () => {
        const apiRef = { current: null as unknown };
        renderInto(<Map {...baseProps({ apiRef: apiRef as never })} />);
        expect(apiRef.current).toBe(created.maps[0]);
    });

    it("syncs the external containerRef and provides the map through context", () => {
        const containerRef = { current: null as HTMLDivElement | null };
        let observedMap: unknown = "unset";
        function Consumer() {
            observedMap = useContext(ParentMap);
            return <span className="consumer" />;
        }
        const root = renderInto(
            <Map {...baseProps({ containerRef: containerRef as never })}>
                <Consumer />
            </Map>
        );
        expect(containerRef.current).toBe(root.querySelector(".geo-map-container"));
        expect(root.querySelector(".consumer")).not.toBeNull();
        // After mount + re-render, the provider value is the created map.
        expect(observedMap).toBe(created.maps[0]);
    });

    it("tears down the map and its handlers on unmount", () => {
        renderInto(<Map {...baseProps({ scale: true, onClick: vi.fn() })} />);
        const map = created.maps[0];
        const scaleCtrl = created.scaleControls[0];
        const tile = created.tileLayers[0];
        if (container) {
            act(() => render(null, container as HTMLDivElement));
            container.remove();
            container = undefined;
        }
        expect(map.off).toHaveBeenCalledWith();
        expect(map.remove).toHaveBeenCalled();
        expect(scaleCtrl.remove).toHaveBeenCalled();
        expect(tile?.removeFrom).toHaveBeenCalledWith(map);
    });

    it("re-applies the view when coordinates or zoom props change", () => {
        const props = baseProps();
        const root = renderInto(<Map {...props} />);
        const map = created.maps[0];
        const callsBefore = map.setView.mock.calls.length;
        act(() => render(<Map {...props} coordinates={[30, 40]} zoom={9} />, root));
        const lastCall = map.setView.mock.calls.at(-1);
        expect(map.setView.mock.calls.length).toBeGreaterThan(callsBefore);
        expect(lastCall).toEqual([[30, 40], 9]);
    });

    it("swaps layers when layerData changes, removing the old layer", async () => {
        const props = baseProps({ layerData: rasterLayer });
        const root = renderInto(<Map {...props} />);
        await flush();
        const firstTile = created.tileLayers[0];

        act(() => render(<Map {...props} layerData={vectorStringStyle} />, root));
        await flushUntil(() => created.maplibreLayers.length >= 1);

        // Old raster layer detached; a new maplibre layer attached.
        expect(firstTile.removeFrom).toHaveBeenCalledWith(created.maps[0]);
        expect(created.maplibreLayers.length).toBe(1);
        await flushUntil(() => created.maplibreLayers[0].addTo.mock.calls.length > 0);
        expect(created.maplibreLayers[0].addTo).toHaveBeenCalledWith(created.maps[0]);
    });
});
