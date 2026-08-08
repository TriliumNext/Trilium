/**
 * The drawing session (see DrawShape.tsx): that mounting it arms Terra Draw with the tool's own
 * mode and unmounting stands it down, that a finished shape reaches the caller converted to what
 * its note will carry, and that anything else Terra Draw announces is left alone.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DrawShape, { type DrawTool, shapeFromFeature } from "./DrawShape";
import { MapStyleLoaded, ParentMap } from "./map";

vi.mock("terra-draw", () => {
    /** Terra Draw as this component uses it: events, a snapshot, and a lifecycle. */
    class TerraDraw {
        static instances: TerraDraw[] = [];
        listeners = new Map<string, (id: string, context: { action: string }) => void>();
        features = new Map<string, unknown>();
        started = false;
        stopped = false;
        modeName: string | null = null;

        constructor(public config: { modes: { mode: string }[] }) {
            TerraDraw.instances.push(this);
        }
        on(event: string, listener: (id: string, context: { action: string }) => void) {
            this.listeners.set(event, listener);
        }
        start() { this.started = true; }
        stop() { this.stopped = true; }
        setMode(name: string) { this.modeName = name; }
        getSnapshotFeature(id: string) { return this.features.get(id); }

        /** A shape being finished, as the real library would announce it. */
        finish(id: string, action: string, feature: unknown) {
            this.features.set(id, feature);
            this.listeners.get("finish")?.(id, { action });
        }
    }

    return {
        TerraDraw,
        TerraDrawLineStringMode: class { mode = "linestring"; },
        TerraDrawPolygonMode: class { mode = "polygon"; }
    };
});

vi.mock("terra-draw-maplibre-gl-adapter", () => ({
    TerraDrawMapLibreGLAdapter: class { constructor(public config: unknown) {} }
}));

import { TerraDraw } from "terra-draw";

type FakeTerraDraw = InstanceType<typeof TerraDraw> & {
    finish(id: string, action: string, feature: unknown): void;
    started: boolean;
    stopped: boolean;
    modeName: string | null;
};

function instances(): FakeTerraDraw[] {
    return (TerraDraw as unknown as { instances: FakeTerraDraw[] }).instances;
}

const LINE_FEATURE = {
    geometry: { type: "LineString", coordinates: [ [ 1, 2 ], [ 3, 4 ] ] }
};
const RING_FEATURE = {
    geometry: { type: "Polygon", coordinates: [ [ [ 1, 2 ], [ 3, 4 ], [ 5, 6 ], [ 1, 2 ] ] ] }
};

describe("DrawShape", () => {
    let container: HTMLElement;
    let onFinish: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        instances().length = 0;
        onFinish = vi.fn();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    function renderSession(tool: DrawTool, { map = {} as never, styleLoaded = true } = {}) {
        act(() => {
            render(
                <ParentMap.Provider value={map}>
                    <MapStyleLoaded.Provider value={styleLoaded}>
                        <DrawShape tool={tool} onFinish={onFinish} />
                    </MapStyleLoaded.Provider>
                </ParentMap.Provider>,
                container
            );
        });
    }

    it("arms Terra Draw with the tool's own mode, and stands it down on unmount", () => {
        renderSession("polygon");

        const [ session ] = instances();
        expect(session.started).toBe(true);
        expect(session.modeName).toBe("polygon");

        act(() => render(null, container));
        expect(session.stopped).toBe(true);
    });

    it("waits for a style to draw on, like every layer-adding child of the map", () => {
        renderSession("line", { styleLoaded: false });
        expect(instances()).toHaveLength(0);
    });

    it("hands a finished line over as the shape its note will carry", () => {
        renderSession("line");

        act(() => instances()[0].finish("f1", "draw", LINE_FEATURE));
        expect(onFinish).toHaveBeenCalledWith({ type: "line", coordinates: [ [ 1, 2 ], [ 3, 4 ] ] });
    });

    it("hands a finished ring over with its closing repeat left behind", () => {
        renderSession("polygon");

        act(() => instances()[0].finish("f1", "draw", RING_FEATURE));
        expect(onFinish).toHaveBeenCalledWith({ type: "polygon", coordinates: [ [ 1, 2 ], [ 3, 4 ], [ 5, 6 ] ] });
    });

    it("leaves alone what is not a drawing being finished", () => {
        renderSession("line");

        // Another action's finish (a drag in some future select mode), and a finish whose
        // feature is not what the tool draws.
        act(() => instances()[0].finish("f1", "dragFeature", LINE_FEATURE));
        act(() => instances()[0].finish("f2", "draw", RING_FEATURE));
        expect(onFinish).not.toHaveBeenCalled();
    });
});

describe("shapeFromFeature", () => {
    it("refuses a geometry that is not what the tool draws", () => {
        expect(shapeFromFeature("line", RING_FEATURE as never)).toBeNull();
        expect(shapeFromFeature("polygon", LINE_FEATURE as never)).toBeNull();
    });

    it("survives a polygon with no ring at all", () => {
        expect(shapeFromFeature("polygon", { geometry: { type: "Polygon", coordinates: [] } } as never)).toBeNull();
    });
});
