import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { EventCallBackMethods, Tabulator } from "tabulator-tables";

import type FNote from "../../../entities/fnote";
import AttributeDetailWidget from "../../attribute_widgets/attribute_detail";
import { useLegacyWidget } from "../../react/hooks";
import useColTableEditing from "./col_editing";
import useRowTableEditing from "./row_editing";

/** The editing events {@link TableEditing} hands the table, which binds them to Tabulator. */
export type TableEditingEvents = Pick<EventCallBackMethods, "cellEdited" | "rowMoved">;

interface TableEditingProps {
    tabulatorRef: RefObject<Tabulator | null>;
    note: FNote;
    /** Where the column being added goes, which the table's columns are built with. */
    newAttributePosition: RefObject<number | undefined>;
    /** Takes the function that forgets the column being added, once the columns are built with it. */
    setResetNewAttributePosition(reset: () => void): void;
    /** Takes the events that write a cell or a moved row, once. */
    setEvents(events: TableEditingEvents): void;
}

/**
 * What makes a table editable: writing an edited cell or a moved row, creating rows, and adding,
 * changing and deleting columns through the attribute editor. Loaded on its own, so that a
 * read-only table never loads it.
 */
export default function TableEditing({
    tabulatorRef, note, newAttributePosition, setResetNewAttributePosition, setEvents
}: TableEditingProps) {
    const [ attributeDetailWidgetEl, attributeDetailWidget ] =
        useLegacyWidget(() => new AttributeDetailWidget().contentSized());
    const rowEditingEvents = useRowTableEditing(tabulatorRef, attributeDetailWidget, note);
    const { resetNewAttributePosition } =
        useColTableEditing(tabulatorRef, attributeDetailWidget, note, newAttributePosition);

    // The events change on every render; the table is handed stable ones that call the latest.
    const eventsRef = useRef(rowEditingEvents);
    eventsRef.current = rowEditingEvents;
    useEffect(() => {
        setEvents({
            cellEdited: (cell) => eventsRef.current.cellEdited?.(cell),
            rowMoved: (row) => eventsRef.current.rowMoved?.(row)
        });
    }, [ setEvents ]);
    useEffect(() => setResetNewAttributePosition(resetNewAttributePosition));

    return attributeDetailWidgetEl;
}
