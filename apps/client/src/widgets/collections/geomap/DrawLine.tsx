import { useContext, useEffect, useRef } from "preact/hooks";
import { TerraDraw, TerraDrawLineStringMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";

import { MapStyleLoaded, ParentMap } from "./map";

interface DrawLineProps {
    /** Handed the finished line's `[lng, lat]` vertices. Standing the session down again is the
     *  caller's move — the component draws for as long as it is mounted, like GhostPin haunts. */
    onFinish: (coordinates: [number, number][]) => void;
}

/**
 * A line-drawing session: mounted while the map is armed to draw, gone when it is not.
 *
 * Terra Draw is the pencil here and nothing more. It owns the map only while this is mounted —
 * click by click, the growing line and its vertex handles are its own ephemeral layers — and the
 * moment a line is finished, the vertices are handed to the caller to become a note and the
 * session's rendering is thrown away. What the reader sees from then on is {@link LineShape},
 * drawing the note's label the way every persisted thing on this map is drawn. Keeping the
 * library inside these brackets is the point: nothing persisted ever depends on it.
 */
export default function DrawLine({ onFinish }: DrawLineProps) {
    const parentMap = useContext(ParentMap);
    const styleLoaded = useContext(MapStyleLoaded);

    // Read through a ref so a new callback identity does not tear down a half-drawn line.
    const onFinishRef = useRef(onFinish);
    onFinishRef.current = onFinish;

    useEffect(() => {
        // The adapter puts its working layers on the style, so it must wait for one to be there —
        // the same wait every layer-adding child of the map keeps (see MapStyleLoaded).
        if (!parentMap || !styleLoaded) return;

        const draw = new TerraDraw({
            adapter: new TerraDrawMapLibreGLAdapter({ map: parentMap }),
            modes: [ new TerraDrawLineStringMode() ]
        });

        draw.on("finish", (id, { action }) => {
            if (action !== "draw") return;

            const feature = draw.getSnapshotFeature(id);
            if (feature?.geometry.type !== "LineString") return;

            onFinishRef.current(feature.geometry.coordinates as [number, number][]);
        });

        draw.start();
        draw.setMode("linestring");

        return () => {
            try {
                draw.stop();
            } catch {
                // The map may already have been removed, taking the session's layers with it.
            }
        };
    }, [ parentMap, styleLoaded ]);

    return <div />;
}
