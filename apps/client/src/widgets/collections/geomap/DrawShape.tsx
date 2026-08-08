import { useContext, useEffect, useRef } from "preact/hooks";
import { type GeoJSONStoreFeatures, TerraDraw, TerraDrawLineStringMode, TerraDrawPolygonMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";

import { MapStyleLoaded, ParentMap } from "./map";
import { type GeoShape, polygonFromRing } from "./shapes";

/** The drawing tools on offer, each arming Terra Draw with a mode of its own. */
export type DrawTool = "line" | "polygon";

interface DrawShapeProps {
    tool: DrawTool;
    /** Handed the finished shape. Standing the session down again is the caller's move — the
     *  component draws for as long as it is mounted, like GhostPin haunts. */
    onFinish: (shape: GeoShape) => void;
}

/**
 * A drawing session: mounted while the map is armed to draw, gone when it is not.
 *
 * Terra Draw is the pencil here and nothing more. It owns the map only while this is mounted —
 * click by click, the growing shape and its vertex handles are its own ephemeral layers — and the
 * moment a shape is finished, it is handed to the caller to become a note and the session's
 * rendering is thrown away. What the reader sees from then on is {@link ShapeLayer}, drawing the
 * note's label the way every persisted thing on this map is drawn. Keeping the library inside
 * these brackets is the point: nothing persisted ever depends on it.
 */
export default function DrawShape({ tool, onFinish }: DrawShapeProps) {
    const parentMap = useContext(ParentMap);
    const styleLoaded = useContext(MapStyleLoaded);

    // Read through a ref so a new callback identity does not tear down a half-drawn shape.
    const onFinishRef = useRef(onFinish);
    onFinishRef.current = onFinish;

    useEffect(() => {
        // The adapter puts its working layers on the style, so it must wait for one to be there —
        // the same wait every layer-adding child of the map keeps (see MapStyleLoaded).
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

/** The Terra Draw mode a tool draws with — each knows its own name for `setMode`. */
function buildMode(tool: DrawTool) {
    switch (tool) {
        case "line":
            return new TerraDrawLineStringMode();
        case "polygon":
            return new TerraDrawPolygonMode();
    }
}

/**
 * The finished feature as the shape its note will carry, or null for one that is not the kind the
 * tool draws — nothing to make a note of then, and the session simply stays armed.
 *
 * Every area tool comes through the polygon branch: whatever hand movement made it, what was made
 * is a ring, and a ring is a polygon note (with its closing repeat left behind — the label does
 * not spell it; see shapes.ts).
 */
export function shapeFromFeature(tool: DrawTool, feature: GeoJSONStoreFeatures): GeoShape | null {
    if (tool === "line") {
        return feature.geometry.type === "LineString"
            ? { type: "line", coordinates: feature.geometry.coordinates as [number, number][] }
            : null;
    }

    if (feature.geometry.type !== "Polygon") return null;
    const ring = feature.geometry.coordinates[0] as [number, number][] | undefined;
    return ring ? polygonFromRing(ring) : null;
}
