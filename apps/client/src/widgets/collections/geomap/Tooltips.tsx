import { type MapGeoJSONFeature, MapMouseEvent, Popup } from "maplibre-gl";
import { useContext, useEffect } from "preact/hooks";

import { ParentMap } from "./map";
import { MARKER_LAYER } from "./Markers";

export default function Tooltips() {
    const map = useContext(ParentMap);

    useEffect(() => {
        if (!map) return;

        const tooltip = new Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 12,
            className: "marker-tooltip"
        });

        function onMouseEnter(e: MapMouseEvent & { features?: MapGeoJSONFeature[]; }) {
            const feature = e.features?.[0];
            if (!feature || !map || feature.geometry.type !== "Point") return;

            tooltip
                .setLngLat(feature.geometry.coordinates as [ number, number ])
                .setHTML(`<strong>${feature.properties.name}</strong>`)
                .addTo(map);
        }

        function onMouseLeave() {
            tooltip.remove();
        }

        map.on("mouseenter", MARKER_LAYER, onMouseEnter);
        map.on("mouseleave", MARKER_LAYER, onMouseLeave);

        return () => {
            map.off("mouseenter", MARKER_LAYER, onMouseEnter);
            map.off("mouseleave", MARKER_LAYER, onMouseLeave);
        };
    }, [ map ]);

    return null;
}
