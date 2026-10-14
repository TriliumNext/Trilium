import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import froca from "../../../services/froca";
import { randomString } from "../../../services/utils";
import { buildPromotedCells, Cell, PromotedAttributeCell } from "../../PromotedAttributes";
import Icon from "../../react/Icon";
import type { AttributeDefinitionInformation } from "../table/columns";

/** Popups an editor opens outside its own subtree, which a press must not close the editor for. */
const EDITOR_POPUPS = ".tn-dropdown-portal, .aa-dropdown-menu, .dropdown-menu, .modal, .tooltip";

/**
 * One timeline cell of a promoted attribute: its values as text, swapped for the promoted-attribute
 * editor on click.
 */
export default function AttributeCell({ noteId, column, values }: {
    noteId: string;
    column: AttributeDefinitionInformation;
    values: string[];
}) {
    const [ isEditing, setIsEditing ] = useState(false);

    if (isEditing) {
        return <AttributeCellEditor noteId={noteId} column={column} onClose={() => setIsEditing(false)} />;
    }

    return (
        <div className="timeline-attribute-cell" onClick={() => setIsEditing(true)}>
            {column.type === "boolean"
                ? values.includes("true") && <Icon icon="bx bx-check" />
                : values.join(", ")}
        </div>
    );
}

function AttributeCellEditor({ noteId, column, onClose }: {
    noteId: string;
    column: AttributeDefinitionInformation;
    onClose(): void;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    // Its own componentId, so that the timeline reloads the value the editor writes.
    const componentId = useMemo(() => `timeline-cell-${randomString()}`, []);
    const [ cells, setCells ] = useState<Cell[] | undefined>(() => {
        const note = froca.getNoteFromCache(noteId);
        return note ? buildPromotedCells(note) : undefined;
    });
    const note = froca.getNoteFromCache(noteId);
    const cell = cells?.find(c => c.valueName === column.name
        && (c.valueAttr.type === "relation") === (column.type === "relation"));

    useEffect(() => {
        if (!cell) {
            onClose();
            return;
        }

        containerRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();

        function onPointerDown(e: PointerEvent) {
            const target = e.target as Element | null;
            if (!containerRef.current?.contains(target) && !target?.closest(EDITOR_POPUPS)) {
                // Blurred first, since the editors commit on blur and the close unmounts them.
                (document.activeElement as HTMLElement | null)?.blur();
                onClose();
            }
        }

        function onKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") onClose();
        }

        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [ !!cell ]);

    return (note && cell &&
        <div className="timeline-attribute-cell-editor" ref={containerRef}>
            <PromotedAttributeCell note={note} cell={cell} componentId={componentId} setCells={setCells} />
        </div>
    );
}
