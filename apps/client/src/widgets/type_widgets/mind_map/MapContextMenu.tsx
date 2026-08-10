import "./MapContextMenu.css";

import type { MindElixirInstance } from "mind-elixir";
import { useCallback, useEffect, useState } from "preact/hooks";

import contextMenu from "../../../menus/context_menu";
import { t } from "../../../services/i18n";
import { type ArrowRequest, buildNodeMenuItems, findArrowTarget, runNodeMenuCommand } from "./context_menu";

interface MapContextMenuProps {
    mind: MindElixirInstance;
}

/**
 * The menu a node is right-clicked for, and the one thing it asks for that a menu cannot finish on
 * its own: the far end of an arrow, which is chosen by clicking a second node.
 *
 * Mind Elixir draws a menu of its own, which is left out (`contextMenu: false`, see MindMap.tsx)
 * along with its two bars. What it never stopped doing is telling us that one was asked for — the
 * word comes from the map's pointer handling rather than from the menu — and it selects the node
 * under the pointer before saying so, so the selection is already the right one when it arrives.
 *
 * The component draws nothing but the hint over the map while an arrow is waiting for its far end.
 */
export default function MapContextMenu({ mind }: MapContextMenuProps) {
    const [ pendingArrow, setPendingArrow ] = useState<ArrowRequest | null>(null);

    useNodeMenu(mind, setPendingArrow);
    useArrowTarget(mind, pendingArrow, useCallback(() => setPendingArrow(null), []));

    return pendingArrow && <div className="mind-map-arrow-hint">{t("mind-map.clickTips")}</div>;
}

/** Opens Trilium's own menu wherever the map says one was asked for. */
function useNodeMenu(mind: MindElixirInstance, requestArrow: (request: ArrowRequest) => void) {
    useEffect(() => {
        const show = (e: MouseEvent) => {
            const node = mind.currentNode;
            if (!node) return;

            contextMenu.show({
                x: e.pageX,
                y: e.pageY,
                items: buildNodeMenuItems(node.nodeObj),
                selectMenuItemHandler: ({ command }) => runNodeMenuCommand(mind, command, requestArrow)
            });
        };

        mind.bus.addListener("showContextMenu", show);
        return () => mind.bus.removeListener("showContextMenu", show);
    }, [ mind, requestArrow ]);
}

/**
 * Waits for the node an arrow asked for should end at, and draws it there.
 *
 * A click anywhere else on the map gives the arrow up, as does Escape — the way out Mind Elixir's
 * own gesture went without, leaving the next click on the map to be spent on an arrow the user had
 * stopped wanting.
 */
function useArrowTarget(mind: MindElixirInstance, request: ArrowRequest | null, done: () => void) {
    useEffect(() => {
        if (!request) return;

        const onClick = (e: MouseEvent) => {
            e.preventDefault();

            const to = findArrowTarget(e.target);
            // Drawn to itself an arrow has nowhere to run, and the map draws nothing.
            if (to && to !== request.from) {
                mind.createArrow(request.from, to, request.bidirectional ? { bidirectional: true } : undefined);
            }
            done();
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            // The map is listening for Escape as well, and has its own use for it.
            e.stopPropagation();
            done();
        };

        mind.map.addEventListener("click", onClick);
        document.addEventListener("keydown", onKeyDown, true);

        return () => {
            mind.map.removeEventListener("click", onClick);
            document.removeEventListener("keydown", onKeyDown, true);
        };
    }, [ mind, request, done ]);
}
