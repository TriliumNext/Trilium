import type { Map as MapLibreGLMap } from "maplibre-gl";
import { useContext, useLayoutEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import OverlayControlGroup, { OverlayControlButton } from "../../react/OverlayControlGroup";
import type { DrawTool } from "./DrawShape";
import { ParentMap } from "./map";

interface DrawToolbarProps {
    /** Whether the map can be edited. A read-only map carries no drawing tools at all. */
    isReadOnly: boolean;
    /** The tool the map is armed to draw with, whose button is shown active. */
    drawingTool: DrawTool | null;
    /** Arms the map to draw with the tool, or disarms it (see index.tsx). */
    onToggleDrawing: (tool: DrawTool) => void;
}

/**
 * The drawing tools, across the head of the map where there is room and in a column down its
 * leading edge where there is not.
 *
 * A group of its own rather than four more buttons on {@link EditToolbar}: the scale control holds
 * one foot corner and {@link MapToolbar} the other, leaving room for about three buttons between
 * them at phone width. A column grows into the map's height instead of towards either corner.
 *
 * Each button shows the shape its tool draws. The armed tool's button is shown active, and its
 * tooltip says what a second press does, as the marker button's does.
 */
export default function DrawToolbar({ isReadOnly, drawingTool, onToggleDrawing }: DrawToolbarProps) {
    const map = useContext(ParentMap);
    const acrossTheHead = useRoomAcrossTheHead(map);

    // No tools where there is no map to draw on (see the WebGL fallback in map.tsx), and none on
    // a read-only map, where all four buttons would be disabled.
    if (!map || isReadOnly) return null;

    return (
        <OverlayControlGroup
            className="geo-draw-toolbar"
            placement={acrossTheHead ? "top-center" : "middle-start"}
            vertical={!acrossTheHead}
            overCanvas
        >
            {DRAW_TOOLS.map(({ tool, icon, title }) => (
                <OverlayControlButton
                    key={tool}
                    title={drawingTool === tool ? t("geo-map.draw-cancel") : title()}
                    icon={icon}
                    active={drawingTool === tool}
                    onClick={() => onToggleDrawing(tool)}
                />
            ))}
        </OverlayControlGroup>
    );
}

/** How wide the map must be for the centred tools to clear the search bar and the detail pane. */
const HEAD_BAR_MIN_WIDTH = 920;

/**
 * Whether the map has room for the tools across its head, tracked as it is resized. Measured rather
 * than read off the device: a map sharing a desktop screen with another note is as narrow as a
 * phone's, and carries the same search bar and detail pane at its head.
 *
 * Measured in a layout effect, since the map arrives a render after the toolbar and an unmeasured
 * toolbar draws as the column.
 */
function useRoomAcrossTheHead(map: MapLibreGLMap | null) {
    const [ hasRoom, setHasRoom ] = useState(false);

    useLayoutEffect(() => {
        if (!map) return;

        const container = map.getContainer();
        function measure() {
            setHasRoom(container.clientWidth >= HEAD_BAR_MIN_WIDTH);
        }

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(container);
        return () => observer.disconnect();
    }, [ map ]);

    return hasRoom;
}

/** The tools in the order they appear, each with the icon of the shape it draws. */
const DRAW_TOOLS: { tool: DrawTool; icon: string; title: () => string }[] = [
    { tool: "line", icon: "bx-vector", title: () => t("geo-map.draw-line") },
    { tool: "polygon", icon: "bx-shape-polygon", title: () => t("geo-map.draw-polygon") },
    { tool: "rectangle", icon: "bx-shape-square", title: () => t("geo-map.draw-rectangle") },
    { tool: "circle", icon: "bx-shape-circle", title: () => t("geo-map.draw-circle") }
];
