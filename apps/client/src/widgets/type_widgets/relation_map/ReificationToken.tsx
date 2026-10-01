import { t } from "../../../services/i18n";
import { JsPlumbItem } from "./jsplumb";
import type { ReificationTokenPlacement } from "./reification_layout";
import { noteIdToId } from "./utils";

const TOKEN_SOURCE = {
    filter: ".endpoint",
    anchor: "Continuous",
    connectorStyle: { stroke: "#000", strokeWidth: 1 },
    connectionType: "basic"
};

const TOKEN_TARGET = {
    dropOptions: { hoverClass: "dragHover" },
    anchor: "Continuous",
    allowLoopback: false
};

interface ReificationTokenProps extends ReificationTokenPlacement {
    /** A click folds this relation into one circle. A right click opens the menu. */
    onCollapse: (attributeId: string) => void;
    onOpenMenu: (attributeId: string, event: MouseEvent) => void;
}

export function ReificationToken({ noteId, attributeId, title, kind, x, y, onCollapse, onOpenMenu }: ReificationTokenProps) {
    function openMenu(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        onOpenMenu(attributeId, event);
    }

    function collapse(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        if (kind === "relation") {
            onCollapse(attributeId);
            return;
        }
        onOpenMenu(attributeId, event);
    }

    return (
        <JsPlumbItem
            id={noteIdToId(noteId)}
            className={`reification-token ${kind}`}
            x={x}
            y={y}
            title={title}
            onClick={collapse}
            onContextMenu={openMenu}
            sourceConfig={TOKEN_SOURCE}
            targetConfig={TOKEN_TARGET}
        >
            {kind === "label" && <span className="token-title">{title}</span>}
            <div className="endpoint" title={t("relation_map.start_dragging_relations")} />
        </JsPlumbItem>
    );
}
