import { useContext, useEffect, useRef } from "preact/hooks";
import { type GeoJSONStoreFeatures, TerraDraw, TerraDrawCircleMode, TerraDrawLineStringMode, TerraDrawPolygonMode, TerraDrawRectangleMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";

import { MapStyleLoaded, ParentMap } from "./map";
import { type GeoShape, polygonFromRing, ringCenter } from "./shapes";

/** The drawing tools, each backed by a Terra Draw mode of its own. */
export type DrawTool = "line" | "polygon" | "rectangle" | "circle";

interface DrawShapeProps {
    tool: DrawTool;
    /** Receives the finished shape. The component keeps drawing until the caller unmounts it. */
    onFinish: (shape: GeoShape) => void;
}

/**
 * A drawing session, mounted while the map is armed to draw.
 *
 * Terra Draw owns the map only while this is mounted, and the layers it adds for the growing shape
 * and its vertex handles go with it. A finished shape is handed to `onFinish` to become a note,
 * which {@link ShapeLayer} then draws. Nothing persisted depends on Terra Draw.
 */
export default function DrawShape({ tool, onFinish }: DrawShapeProps) {
    const parentMap = useContext(ParentMap);
    const styleLoaded = useContext(MapStyleLoaded);

    // Read through a ref so a new callback identity does not tear down a half-drawn shape.
    const onFinishRef = useRef(onFinish);
    onFinishRef.current = onFinish;

    useEffect(() => {
        // The adapter adds its layers to the style, so it waits for one to load, as every
        // layer-adding child of the map does (see MapStyleLoaded).
        if (!parentMap || !styleLoaded) return;

        const mode = buildMode(tool);
        const draw = new TerraDraw({
            adapter: new TerraDrawMapLibreGLAdapter({ map: parentMap }),
            modes: [ mode ]
        });

        draw.on("finish", (id, { action }) => {
            if (action !== "draw") return;

            const feature = draw.getSnapshotFeature(id);
            const shape = feature && shapeFromFeature(tool, feature);
            if (shape) {
                onFinishRef.current(shape);
            }
        });

        draw.start();
        draw.setMode(mode.mode);

        return () => {
            try {
                draw.stop();
            } catch {
                // The map may already have been removed, taking the session's layers with it.
            }
        };
    }, [ parentMap, styleLoaded, tool ]);

    return <div />;
}

/**
 * How the circle and rectangle tools read their second corner. Terra Draw's default, `click-move`,
 * reads it from pointer movement between two clicks, which a finger never produces: its movement
 * while down is reported as a drag. Accepting the drag as well leaves the mouse unchanged and lets
 * touch size the shape.
 */
const TWO_CORNER_INTERACTION = "click-move-or-drag";

/** The Terra Draw mode a tool draws with. */
function buildMode(tool: DrawTool) {
    switch (tool) {
        case "line":
            return new TerraDrawLineStringMode();
        case "polygon":
            return new TerraDrawPolygonMode();
        case "rectangle":
            return new TerraDrawRectangleMode({ drawInteraction: TWO_CORNER_INTERACTION });
        case "circle":
            return new TerraDrawCircleMode({ drawInteraction: TWO_CORNER_INTERACTION });
    }
}

/**
 * The finished feature as the shape its note carries, or null where the feature is not the kind the
 * tool draws, which leaves the session armed.
 *
 * Every area tool produces a ring, so all of them go through the polygon branch, dropping the
 * closing repeat the label does not spell (see shapes.ts). A circle is the exception: Terra Draw
 * draws it as a many-cornered polygon carrying `radiusKilometers`, and the note stores the centre
 * and the radius instead of the ring that approximates them.
 */
export function shapeFromFeature(tool: DrawTool, feature: GeoJSONStoreFeatures): GeoShape | null {
    if (tool === "line") {
        return feature.geometry.type === "LineString"
            ? { type: "line", coordinates: feature.geometry.coordinates as [number, number][] }
            : null;
    }

    if (feature.geometry.type !== "Polygon") return null;
    const ring = feature.geometry.coordinates[0] as [number, number][] | undefined;
    if (!ring) return null;

    if (tool === "circle") {
        const radiusKilometers = Number(feature.properties.radiusKilometers);
        const center = ringCenter(polygonFromRing(ring).coordinates);
        if (!center || !Number.isFinite(radiusKilometers) || radiusKilometers <= 0) return null;
        return { type: "circle", center, radiusMeters: radiusKilometers * 1000 };
    }

    return polygonFromRing(ring);
}
