/**
 * The drawing session (see DrawShape.tsx): that mounting it arms Terra Draw with the tool's own
 * mode and unmounting stands it down, that a finished shape reaches the caller converted to what
 * its note will carry, and that anything else Terra Draw announces is left alone.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import DrawShape, { type DrawTool, shapeFromFeature } from "./DrawShape";
import { MapStyleLoaded, ParentMap } from "./map";
import type { GeoShape } from "./shapes";

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

    /** A mode, holding the options it was built with so the spec can read them back. */
    const mode = (name: string) => class {
        mode = name;
        constructor(public options?: { drawInteraction?: string }) {}
    };

    return {
        TerraDraw,
        TerraDrawLineStringMode: mode("linestring"),
        TerraDrawPolygonMode: mode("polygon"),
        TerraDrawRectangleMode: mode("rectangle"),
        TerraDrawCircleMode: mode("circle")
    };
});

vi.mock("terra-draw-maplibre-gl-adapter", () => ({
    TerraDrawMapLibreGLAdapter: class { constructor(public config: unknown) {} }
}));

import { TerraDraw } from "terra-draw";

type FakeTerraDraw = InstanceType<typeof TerraDraw> & {
    finish(id: string, action: string, feature: unknown): void;
    /** The modes the session was built with, each holding the options it was given. */
    config: { modes: { mode: string; options?: { drawInteraction?: string } }[] };
    started: boolean;
    stopped: boolean;
    modeName: string | null;
};

function instances(): FakeTerraDraw[] {
    return (TerraDraw as unknown as { instances: FakeTerraDraw[] }).instances;
}

const LINE_FEATURE = {
    properties: {},
    geometry: { type: "LineString", coordinates: [ [ 1, 2 ], [ 3, 4 ] ] }
};
const RING_FEATURE = {
    properties: {},
    geometry: { type: "Polygon", coordinates: [ [ [ 1, 2 ], [ 3, 4 ], [ 5, 6 ], [ 1, 2 ] ] ] }
};
/** A circle as Terra Draw finishes one: a ring around (10, 20), its radius in the properties. */
const CIRCLE_FEATURE = {
    properties: { mode: "circle", radiusKilometers: 0.5 },
    geometry: { type: "Polygon", coordinates: [ [ [ 10, 21 ], [ 11, 20 ], [ 10, 19 ], [ 9, 20 ], [ 10, 21 ] ] ] }
};

describe("DrawShape", () => {
    let container: HTMLElement;
    let onFinish: Mock<(shape: GeoShape) => void>;

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

    /**
     * A circle and a rectangle are two positions, and Terra Draw reads the second one from pointer
     * movement between two clicks unless told otherwise. A finger makes no such movement, so on a
     * touchscreen the tap that placed the first position left nothing able to size the shape.
     * Asking for the drag as well is what lets a finger draw one.
     */
    it("lets the two-corner tools be drawn by dragging, which is all a finger can do", () => {
        for (const tool of [ "circle", "rectangle" ] as const) {
            instances().length = 0;
            renderSession(tool);

            const [ builtMode ] = instances()[0].config.modes;
            expect(builtMode.options?.drawInteraction).toBe("click-move-or-drag");
            act(() => render(null, container));
        }

        // The tools that take a position per click are left alone: every tap is already a vertex.
        for (const tool of [ "line", "polygon" ] as const) {
            instances().length = 0;
            renderSession(tool);

            const [ builtMode ] = instances()[0].config.modes;
            expect(builtMode.options).toBeUndefined();
            act(() => render(null, container));
        }
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

    it("draws a rectangle with its own mode, but what it made is a polygon note", () => {
        renderSession("rectangle");

        const [ session ] = instances();
        expect(session.modeName).toBe("rectangle");

        act(() => session.finish("f1", "draw", RING_FEATURE));
        expect(onFinish).toHaveBeenCalledWith({ type: "polygon", coordinates: [ [ 1, 2 ], [ 3, 4 ], [ 5, 6 ] ] });
    });

    it("hands a finished circle over as its centre and reach, read back out of the ring", () => {
        renderSession("circle");

        expect(instances()[0].modeName).toBe("circle");
        act(() => instances()[0].finish("f1", "draw", CIRCLE_FEATURE));
        expect(onFinish).toHaveBeenCalledWith({ type: "circle", center: [ 10, 20 ], radiusMeters: 500 });
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
        expect(shapeFromFeature("polygon", { properties: {}, geometry: { type: "Polygon", coordinates: [] } } as never)).toBeNull();
    });

    it("refuses a circle whose radius the properties do not carry", () => {
        expect(shapeFromFeature("circle", {
            ...CIRCLE_FEATURE,
            properties: { mode: "circle" }
        } as never)).toBeNull();
    });
});
