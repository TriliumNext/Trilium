import { LabelType } from "@triliumnext/commons";
import { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { CellComponent, ColumnDefinition, EmptyCallback, FormatterParams, ValueBooleanCallback, ValueVoidCallback } from "tabulator-tables";

import froca from "../../../services/froca.js";
import Icon from "../../react/Icon.jsx";
import NoteAutocomplete from "../../react/NoteAutocomplete.jsx";
import { renderReactWidget } from "../../react/react_utils.jsx";

type ColumnType = LabelType | "relation";

export interface AttributeDefinitionInformation {
    name: string;
    title?: string;
    type?: ColumnType;
}

const labelTypeMappings: Record<ColumnType, Partial<ColumnDefinition>> = {
    text: {
        editor: "input"
    },
    boolean: {
        formatter: "tickCross",
        editor: "tickCross"
    },
    date: {
        editor: "date",
    },
    datetime: {
        editor: "datetime"
    },
    number: {
        editor: "number",
        sorter: "number"
    },
    time: {
        editor: "input"
    },
    url: {
        formatter: "link",
        editor: "input"
    },
    color: {
        editor: "input",
        formatter: "color",
        editorParams: {
            elementAttributes: {
                type: "color"
            }
        }
    },
    relation: {
        editor: wrapEditor(RelationEditor),
        formatter: wrapFormatter(NoteFormatter)
    }
};

interface BuildColumnArgs {
    info: AttributeDefinitionInformation[];
    movableRows: boolean;
    existingColumnData: ColumnDefinition[] | undefined;
    rowNumberHint: number;
    position?: number;
}

interface RowNumberFormatterParams {
    movableRows?: boolean;
}

export function buildColumnDefinitions({ info, movableRows, existingColumnData, rowNumberHint, position }: BuildColumnArgs) {
    let columnDefs: ColumnDefinition[] = [
        {
            title: "#",
            headerSort: false,
            hozAlign: "center",
            resizable: false,
            frozen: true,
            rowHandle: movableRows,
            width: calculateIndexColumnWidth(rowNumberHint, movableRows),
            formatter: wrapFormatter(({ cell, formatterParams }) => <div>
                {(formatterParams as RowNumberFormatterParams).movableRows && <><span class="bx bx-dots-vertical-rounded" />{" "}</>}
                {cell.getRow().getPosition(true)}
            </div>),
            formatterParams: { movableRows } satisfies RowNumberFormatterParams
        },
        {
            field: "noteId",
            title: "Note ID",
            formatter: wrapFormatter(({ cell }) => <code>{cell.getValue()}</code>),
            visible: false
        },
        {
            field: "title",
            title: "Title",
            editor: "input",
            formatter: wrapFormatter(({ cell }) => {
                const { noteId, iconClass, colorClass } = cell.getRow().getData();
                return <span className={`reference-link ${colorClass}`} data-href={`#root/${noteId}`}>
                    <Icon icon={iconClass} />{" "}{cell.getValue()}
                </span>;
            }),
            width: 400
        }
    ];

    const seenFields = new Set<string>();
    for (const { name, title, type } of info) {
        const prefix = (type === "relation" ? "relations" : "labels");
        const field = `${prefix}.${name}`;

        if (seenFields.has(field)) {
            continue;
        }

        columnDefs.push({
            field,
            title: title ?? name,
            editor: "input",
            rowHandle: false,
            ...labelTypeMappings[type ?? "text"],
        });
        seenFields.add(field);
    }

    if (existingColumnData) {
        columnDefs = restoreExistingData(columnDefs, existingColumnData, position);
    }

    return columnDefs;
}

export function restoreExistingData(newDefs: ColumnDefinition[], oldDefs: ColumnDefinition[], position?: number) {
    // 1. Keep existing columns, but restore their properties like width, visibility and order.
    const newItemsByField = new Map<string, ColumnDefinition>(
        newDefs.map(def => [def.field!, def])
    );
    const existingColumns = oldDefs
        .filter(item => (item.field && newItemsByField.has(item.field!)) || item.title === "#")
        .map(oldItem => {
            const data = newItemsByField.get(oldItem.field!)!;
            if (oldItem.resizable !== false && oldItem.width !== undefined) {
                data.width = oldItem.width;
            }
            if (oldItem.visible !== undefined) {
                data.visible = oldItem.visible;
            }
            return data;
        }) as ColumnDefinition[];

    // 2. Determine new columns.
    const existingFields = new Set(existingColumns.map(item => item.field));
    const newColumns = newDefs
        .filter(item => !existingFields.has(item.field!));

    // Clamp position to a valid range
    const insertPos = position !== undefined
        ? Math.min(Math.max(position, 0), existingColumns.length)
        : existingColumns.length;

    // 3. Insert new columns at the specified position
    return [
        ...existingColumns.slice(0, insertPos),
        ...newColumns,
        ...existingColumns.slice(insertPos)
    ];
}

function calculateIndexColumnWidth(rowNumberHint: number, movableRows: boolean): number {
    let columnWidth = 16 * (rowNumberHint.toString().length || 1);
    if (movableRows) {
        columnWidth += 32;
    }
    return columnWidth;
}

interface FormatterOpts {
    cell: CellComponent
    formatterParams: FormatterParams;
}

interface EditorOpts {
    cell: CellComponent,
    success: ValueBooleanCallback,
    cancel: ValueVoidCallback,
    editorParams: {}
}

function wrapFormatter(Component: (opts: FormatterOpts) => JSX.Element): ((cell: CellComponent, formatterParams: {}, onRendered: EmptyCallback) => string | HTMLElement) {
    return (cell, formatterParams, onRendered) => {
        const elWithParams = <Component cell={cell} formatterParams={formatterParams} />;
        return renderReactWidget(null, elWithParams)[0];
    };
}

function wrapEditor(Component: (opts: EditorOpts) => JSX.Element): ((
    cell: CellComponent,
    onRendered: EmptyCallback,
    success: ValueBooleanCallback,
    cancel: ValueVoidCallback,
    editorParams: {},
) => HTMLElement | false) {
    return (cell, _, success, cancel, editorParams) => {
        const elWithParams = <Component cell={cell} success={success} cancel={cancel} editorParams={editorParams} />;
        return renderReactWidget(null, elWithParams)[0];
    };
}

function NoteFormatter({ cell }: FormatterOpts) {
    const noteId = cell.getValue();
    const [ note, setNote ] = useState(noteId ? froca.getNoteFromCache(noteId) : null);

    useEffect(() => {
        if (!noteId || note?.noteId === noteId) return;
        froca.getNote(noteId).then(setNote);
    }, [ noteId ]);

    return <span className={`reference-link ${note?.getColorClass()}`} data-href={`#root/${noteId}`}>
        {note && <><Icon icon={note?.getIcon()} />{" "}{note.title}</>}
    </span>;
}

function RelationEditor({ cell, success }: EditorOpts) {
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => inputRef.current?.focus());

    return <NoteAutocomplete
        inputRef={inputRef}
        noteId={cell.getValue()}
        opts={{
            allowCreatingNotes: true,
            hideAllButtons: true
        }}
        noteIdChanged={success}
    />;
}
