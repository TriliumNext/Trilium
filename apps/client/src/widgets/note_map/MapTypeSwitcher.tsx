import { t } from "../../services/i18n";
import ActionButton from "../react/ActionButton";
import { OverlayControlButton } from "../react/OverlayControlGroup";
import { MapType } from "./utils";

interface MapTypeSwitcherProps {
    mapType: MapType;
    setMapType: (mapType: MapType) => void;
}

/**
 * The choice between the two maps a note can be drawn as, drawn the way Trilium draws a choice
 * between several things: a button group, a recessed track with the one on show raised out of it —
 * the same the right pane's tab strip is built from. The map's own overlay offers the same choice
 * with {@link MapTypeOverlayButtons}.
 *
 * Kept in a module of its own so that the pane can offer the choice in a card's header without
 * pulling in the map (and force-graph with it) to do so.
 */
export default function MapTypeSwitcher({ mapType, setMapType }: MapTypeSwitcherProps) {
    return (
        <div class="btn-group map-type-switcher" role="group">
            {MAP_TYPES.map(({ type, icon, text }) => (
                <ActionButton
                    key={type}
                    icon={`bx ${icon}`} text={t(text)}
                    active={mapType === type}
                    onClick={() => setMapType(type)}
                />
            ))}
        </div>
    );
}

/** The same choice as {@link MapTypeSwitcher}, as buttons of an `OverlayControlGroup` over the map. */
export function MapTypeOverlayButtons({ mapType, setMapType }: MapTypeSwitcherProps) {
    return MAP_TYPES.map(({ type, icon, text }) => (
        <OverlayControlButton
            key={type}
            icon={icon} title={t(text)}
            active={mapType === type}
            onClick={() => setMapType(type)}
        />
    ));
}

const MAP_TYPES: { type: MapType; icon: string; text: string }[] = [
    { type: "link", icon: "bx-network-chart", text: "note-map.button-link-map" },
    { type: "tree", icon: "bx-sitemap", text: "note-map.button-tree-map" }
];
