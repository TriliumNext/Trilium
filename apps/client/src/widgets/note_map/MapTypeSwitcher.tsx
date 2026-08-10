import clsx from "clsx";

import { t } from "../../services/i18n";
import ActionButton from "../react/ActionButton";
import { MapType } from "./utils";

interface MapTypeSwitcherProps {
    mapType: MapType;
    setMapType: (mapType: MapType) => void;
    /**
     * Raised buttons, for the map's own floating overlay where they stand over the graph. The pane's
     * header wants them flat, as the tab strip above it is.
     */
    frame?: boolean;
    className?: string;
}

/**
 * The choice between the two maps a note can be drawn as, drawn the way Trilium draws a choice
 * between several things: a button group, a recessed track with the one on show raised out of it —
 * the same the right pane's tab strip is built from.
 *
 * Kept in a module of its own so that the pane can offer the choice in a card's header without
 * pulling in the map (and force-graph with it) to do so.
 */
export default function MapTypeSwitcher({ mapType, setMapType, frame, className }: MapTypeSwitcherProps) {
    return (
        <div class={clsx("btn-group map-type-switcher", className)} role="group">
            <MapTypeButton
                type="link" icon="bx bx-network-chart" text={t("note-map.button-link-map")}
                currentMapType={mapType} setMapType={setMapType} frame={frame}
            />
            <MapTypeButton
                type="tree" icon="bx bx-sitemap" text={t("note-map.button-tree-map")}
                currentMapType={mapType} setMapType={setMapType} frame={frame}
            />
        </div>
    );
}

function MapTypeButton({ icon, text, type, currentMapType, setMapType, frame }: {
    icon: string;
    text: string;
    type: MapType;
    currentMapType: MapType;
    setMapType: (mapType: MapType) => void;
    frame?: boolean;
}) {
    return (
        <ActionButton
            icon={icon} text={text}
            active={currentMapType === type}
            onClick={() => setMapType(type)}
            frame={frame}
        />
    );
}
