import clsx from "clsx";

import { t } from "../../services/i18n";
import ActionButton from "../react/ActionButton";
import { CloneCombine, MapType } from "./utils";

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
 * The choice among the maps a note can be drawn as, drawn the way Trilium draws a choice
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
            <MapTypeButton
                type="clone" icon="bx bx-git-merge" text={t("note-map.button-clone-map")}
                currentMapType={mapType} setMapType={setMapType} frame={frame}
            />
        </div>
    );
}

interface CloneCombineSwitcherProps {
    combine: CloneCombine;
    setCombine: (combine: CloneCombine) => void;
    frame?: boolean;
    className?: string;
}

/**
 * How a search's clone-map seeds combine. Same recessed-track group as {@link MapTypeSwitcher},
 * and kept beside it so the pane can offer both in a card header without loading the map. Any keeps
 * a note if at least one seed sits on a clone path below it; All only if every seed does.
 */
export function CloneCombineSwitcher({ combine, setCombine, frame, className }: CloneCombineSwitcherProps) {
    return (
        <div class={clsx("btn-group clone-combine-switcher", className)} role="group">
            <CombineButton
                value="any" icon="bx bx-git-branch" text={t("note-map.button-clone-any")}
                current={combine} setCombine={setCombine} frame={frame}
            />
            <CombineButton
                value="all" icon="bx bx-check-double" text={t("note-map.button-clone-all")}
                current={combine} setCombine={setCombine} frame={frame}
            />
        </div>
    );
}

function CombineButton({ icon, text, value, current, setCombine, frame }: {
    icon: string;
    text: string;
    value: CloneCombine;
    current: CloneCombine;
    setCombine: (combine: CloneCombine) => void;
    frame?: boolean;
}) {
    return (
        <ActionButton
            icon={icon} text={text}
            active={current === value}
            onClick={() => setCombine(value)}
            frame={frame}
        />
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
