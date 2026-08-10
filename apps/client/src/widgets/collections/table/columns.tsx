import "./columns.css";

import { LabelType } from "@triliumnext/commons";
import clsx from "clsx";
import { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { CellComponent, ColumnComponent, ColumnDefinition, EmptyCallback, FormatterParams, RowComponent, ValueBooleanCallback, ValueVoidCallback } from "tabulator-tables";

import froca from "../../../services/froca.js";
import { safeUrlHref } from "../../../utils/url.js";
import { applyLinkScheme, asLabelValues, formatLabelDate, LabelValueChips } from "../../attribute_widgets/label_value_display.jsx";
import LabelValueInput from "../../attribute_widgets/label_value_input.jsx";
import MultiValueInput from "../../attribute_widgets/multi_value_input.jsx";
import RelationValuesInput, { RelationValueChips } from "../../attribute_widgets/relation_values_input.jsx";
import { useGrowsUpwards } from "../../react/grows_upwards.js";
import Icon from "../../react/Icon.jsx";
import NoteAutocomplete from "../../react/NoteAutocomplete.jsx";
import { renderReactWidget } from "../../react/react_utils.jsx";
import type { TableData } from "./rows.js";

type ColumnType = LabelType | "relation";

export interface AttributeDefinitionInformation {
    name: string;
    title?: string;
    type?: ColumnType;
    /** The values a `select` column offers, from the definition that declared it. */
    options?: string[];
    /** Whether the column holds a set of values rather than one, shown and edited as chips. */
    isMulti?: boolean;
}

const labelTypeMappings: Record<ColumnType, Partial<ColumnDefinition>> = {
    text: {
        editor: "input"
    },
    textarea: {
        editor: "textarea",
        formatter: "textarea",
        editorParams: {
            shiftEnterSubmit: true
        }
    },
    select: {
        // The options come from the column's definition, so `editorParams` is attached per column
        // in `buildColumnDefinitions` rather than here.
        editor: wrapEditor(SelectEditor)
    },
    boolean: {
        // The same chip a set of flags wears, one chip for the one value, so a column of flags
        // reads the same whether each note holds one or several. Toggling stays Tabulator's own.
        formatter: wrapFormatter(FlagFormatter),
        editor: "tickCross",
        // Values arrive as strings ("true"/"false") from stored labels but as real booleans
        // once toggled via the editor; the boolean sorter normalizes both, whereas the default
        // string sorter treats boolean `false` as empty and orders it inconsistently.
        sorter: "boolean"
    },
    date: {
        editor: "date",
        // Values are stored as ISO ("YYYY-MM-DD"), which Tabulator would otherwise render as-is.
        formatter: (cell) => formatLabelDate(cell.getValue(), false)
    },
    datetime: {
        editor: "datetime",
        formatter: (cell) => formatLabelDate(cell.getValue(), true)
    },
    number: {
        editor: "number",
        sorter: "number"
    },
    time: {
        // No `format` param, so the editor stays on the stored "HH:mm" and needs no luxon — the same
        // value, through the same native field, as the promoted attribute of this type.
        editor: "time"
    },
    url: {
        formatter: "link",
        formatterParams: {
            url: (cell) => safeUrlHref(cell.getValue())
        },
        editor: "input"
    },
    email: {
        // The stored value is the bare address; the link formatter's url callback gives it its
        // scheme without repeating one an older value (imported as a url) may already carry.
        formatter: "link",
        formatterParams: {
            url: (cell) => applyLinkScheme(cell.getValue(), "mailto:")
        },
        editor: "input"
    },
    phone: {
        formatter: "link",
        formatterParams: {
            url: (cell) => applyLinkScheme(cell.getValue(), "tel:")
        },
        editor: "input"
    },
    color: {
        editor: wrapEditor(ColorEditor),
        formatter: wrapFormatter(ColorFormatter)
    },
    relation: {
        editor: wrapEditor(RelationEditor),
        formatter: wrapFormatter(NoteFormatter),
        // The cell's value is the target's noteId while what it shows is the target's title, so the
        // default string sorter would order the rows by an id the user never sees. The titles are
        // read from the row data, where they were resolved as the rows were built — a sort compares
        // synchronously, so they could not be fetched from here.
        sorter: (a, b, aRow, bRow, column) =>
            relationTitle(aRow, column).localeCompare(relationTitle(bRow, column))
    }
};

/** The title a relation cell shows, carried in the row's data under the relation's own name. */
function relationTitle(row: RowComponent, column: ColumnComponent): string {
    const name = (column.getField() ?? "").slice("relations.".length);
    const { relationTitles } = row.getData() as Partial<TableData>;
    return relationTitles?.[name] ?? "";
}

interface BuildColumnArgs {
    info: AttributeDefinitionInformation[];
    movableRows: boolean;
    existingColumnData: ColumnDefinition[] | undefined;
    rowNumberHint: number;
    position?: number;
    /**
     * Adds an option to a select column's definition, for the entry its editor offers on a value
     * the column does not list yet. Omitted, such a value cannot be created from a cell.
     */
    onCreateSelectOption?: (columnName: string, option: string) => void | Promise<void>;
    /**
     * The options a select column offers, asked for as a cell is opened. A definition can gain an
     * option from the very editor that is open, which the columns as built know nothing about — so
     * where this is left out, or answers nothing, a cell falls back to the options it was built with.
     */
    currentSelectOptions?: (columnName: string) => string[] | undefined;
}

export function buildColumnDefinitions({ info, movableRows, existingColumnData, rowNumberHint, position, onCreateSelectOption, currentSelectOptions }: BuildColumnArgs) {
    let columnDefs: ColumnDefinition[] = [
        {
            title: "#",
            headerSort: false,
            hozAlign: "center",
            resizable: false,
            frozen: true,
            rowHandle: movableRows,
            width: calculateIndexColumnWidth(rowNumberHint, movableRows),
            formatter: (cell) => rowNumberFormatter(cell, movableRows)
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
    for (const { name, title, type, options, isMulti } of info) {
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
            // What a cell's editor needs beyond the value itself, which for a select is the options
            // it offers. Handed as a function because that is the shape Tabulator types for params
            // of an editor's own — which also means the options are answered for as each cell is
            // opened, late enough to include one the definition has just been given.
            ...((type === "select" || isMulti) && {
                editorParams: (): Record<string, unknown> => ({
                    labelType: type ?? "text",
                    options: currentSelectOptions?.(name) ?? options ?? [],
                    isMulti,
                    onCreateOption: onCreateSelectOption
                        && ((option: string) => onCreateSelectOption(name, option))
                } satisfies ValuesEditorParams)
            }),
            // A set is shown as the chips it is edited as, whatever it holds — and sorted by those
            // values rather than by the array Tabulator would otherwise compare as an object. A set
            // of relations keeps the relation sorter: its values are noteIds, and the titles the
            // cell shows are what the rows should order by, carried in `relationTitles` for one
            // target and several alike.
            ...(isMulti && {
                editor: wrapEditor(ValuesEditor),
                formatter: wrapFormatter(ValuesFormatter),
                formatterParams: { type: type ?? "text" },
                ...(type !== "relation" && {
                    sorter: ((a, b) => joinValues(a).localeCompare(joinValues(b))) as ColumnDefinition["sorter"]
                })
            })
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

// `watchPosition` is provided by Tabulator but missing from the current type definitions.
type RowComponentWithPositionWatch = RowComponent & {
    watchPosition(callback: (position: number) => void): void;
};

function rowNumberFormatter(cell: CellComponent, movableRows: boolean): HTMLElement {
    const container = document.createElement("div");

    if (movableRows) {
        const handle = document.createElement("span");
        handle.className = "bx bx-dots-vertical-rounded";
        container.append(handle, " ");
    }

    const number = document.createElement("span");
    container.append(number);

    // The row-number column has no field, so Tabulator never re-runs its formatter when the
    // rows are re-sorted or reordered, leaving stale numbers (see #10347). Watching the row
    // position keeps the displayed number in sync, mirroring Tabulator's built-in "rownum".
    const row = cell.getRow() as RowComponentWithPositionWatch;
    const currentPosition = row.getPosition();
    if (currentPosition) {
        number.innerText = String(currentPosition);
    }
    row.watchPosition((position) => {
        number.innerText = String(position);
    });

    return container;
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

/**
 * A select cell is edited through the very field the promoted-attribute grid offers, so a column and
 * the note's own field behave alike — the options listed on opening, typing filtering them, and an
 * unlisted value offered as one to create.
 *
 * The field is focused from the wrapper because it is reached through {@link LabelValueInput}, which
 * hands no reference to the box it builds; the list then opens as it does for any focused combobox.
 */
function SelectEditor({ cell, success, editorParams }: EditorOpts) {
    const { options, onCreateOption } = editorParams as ValuesEditorParams;
    const containerRef = useRef<HTMLDivElement>(null);
    useEffect(() => containerRef.current?.querySelector("input")?.focus(), []);

    return (
        <div ref={containerRef} className="table-values-editor">
            {/* Framed as the field of a cell holding several values is, and by the very same class, so
                that a column reads alike whichever it holds. A box on its own would come out unframed:
                an editor stands over its cell rather than in it, and a cell being edited strips the
                border and background from the boxes within — which is right where one sits in the cell,
                and leaves this one adrift on the editor's own surface. */}
            <div className="tn-field">
                <LabelValueInput
                    labelType="select"
                    value={cell.getValue() ?? ""}
                    selectOptions={options}
                    onCommit={success}
                    onCreateOption={onCreateOption}
                />
            </div>
        </div>
    );
}

/**
 * A cell holding several values is edited as the chips it shows, through the very field the note's own
 * promoted grid offers. All this adds is what a cell needs and a note does not: standing over the row
 * rather than in it, and saying when the edit is over.
 *
 * Reporting a value as it is taken would close the editor on the first one — reporting is Tabulator's
 * "the edit is done" — so the set is held here and handed over once, when the cell is left.
 */
function ValuesEditor({ cell, success, editorParams }: EditorOpts) {
    const { labelType, options, onCreateOption } = editorParams as ValuesEditorParams;
    const containerRef = useRef<HTMLDivElement>(null);
    useEffect(() => containerRef.current?.querySelector("input")?.focus(), []);

    const [ values, setValues ] = useState<string[]>(() => asLabelValues(cell.getValue()));
    // The set as the handler below will read it. Written as the edit is made rather than left to the
    // next render, because leaving the field both takes what was typed and ends the edit — in that
    // order, and within the one event, which a value only reachable through a render would miss.
    const editedValues = useRef(values);
    function editValues(edited: string[]) {
        editedValues.current = edited;
        setValues(edited);
    }

    useEffect(() => {
        const editor = containerRef.current;
        if (!editor) return;

        const onFocusOut = (e: FocusEvent) => {
            // Focus moving within the editor — the box to a chip's remove button, or back — is not
            // leaving it. Picking from a list does not blur at all: the list keeps the focus in the
            // box, which is what lets it stay open across picks.
            if (e.relatedTarget instanceof Node && editor.contains(e.relatedTarget)) return;

            // Nothing in the page took the focus over, and either the editor still holds it or the
            // window itself has lost it — which is what opening a native picker's dialog does. The
            // cell has not been left, and ending the edit here would take the dialog down with it
            // before it could report the colour picked.
            if (!e.relatedTarget && (!document.hasFocus() || editor.contains(document.activeElement))) {
                return;
            }

            success(editedValues.current);
        };

        editor.addEventListener("focusout", onFocusOut);
        return () => editor.removeEventListener("focusout", onFocusOut);
    }, [ success ]);

    // The editor grows downwards as values are taken, which the pane the table scrolls in cuts off at
    // its foot — on the last row there is nothing below the cell to grow into.
    const growsUpwards = useGrowsUpwards(containerRef);

    return (
        <div ref={containerRef} className={clsx("table-values-editor", growsUpwards && "grows-upwards")}>
            {/* The very fields the note's own promoted grid offers, so that a definition is edited
                the same way whichever way the note is opened. */}
            {labelType === "relation" ? (
                <RelationValuesInput values={values} onCommit={editValues} />
            ) : (
                <MultiValueInput
                    labelType={labelType}
                    values={values}
                    options={options}
                    onCreateOption={onCreateOption}
                    onCommit={editValues}
                />
            )}
        </div>
    );
}

/** A multi-valued cell as the chips it is edited as, so reading and editing show the same set. */
function ValuesFormatter({ cell, formatterParams }: FormatterOpts) {
    const { type } = formatterParams as { type?: ColumnType };
    if (type === "relation") {
        return <RelationValueChips values={asLabelValues(cell.getValue())} />;
    }
    return <LabelValueChips
        values={asLabelValues(cell.getValue())}
        labelType={type}
    />;
}

/** The values as one string, for comparing two sets in a sort. */
function joinValues(value: unknown) {
    return asLabelValues(value).join(", ");
}

/**
 * What a column hands its editor beyond the value: the kind of value it holds, and — a select being
 * the one type whose values are a closed set — the options it offers and how to add one. A type
 * rather than an interface so that it still reads as the loose record Tabulator types params as.
 */
export type ValuesEditorParams = {
    labelType: ColumnType;
    options: string[];
    isMulti?: boolean;
    /** Absent where the definition cannot be written to, which leaves the field a plain picker. */
    onCreateOption?: (option: string) => void | Promise<void>;
};

/**
 * A colour cell is edited through the very field the promoted grid and the attribute editor offer: a
 * picker, and beside it the button that empties it. A bare colour input cannot be emptied — it has no
 * such value — so a cell opened by accident used to fall to black, with no way back to unset.
 *
 * The colour is taken from the picker's own `change` rather than through the field's commit, which a
 * colour input fires at every step of a drag through it: reporting is Tabulator's "the edit is done",
 * so the first step would tear the editor out from under the open picker. `change` comes once, when
 * the pick is settled, which is also when a cell is finished with.
 *
 * The picker is reached through the container because {@link LabelValueInput} hands no reference to
 * what it builds, as {@link SelectEditor} reaches its box for the same reason.
 */
function ColorEditor({ cell, success }: EditorOpts) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const picker = containerRef.current?.querySelector<HTMLInputElement>("input[type=color]");
        if (!picker) return;

        picker.focus();
        const onPicked = () => success(picker.value);
        picker.addEventListener("change", onPicked);
        return () => picker.removeEventListener("change", onPicked);
    }, [ success ]);

    return (
        // Standing over the cell as the multi-valued editor does, and by the same class — not for
        // room, a swatch and a button asking for less than a cell has, but because a cell has
        // however much its row does: in a row grown taller by another cell's wrapped lines, an
        // editor laid within is stretched into the full editing frame, the pair afloat mid-panel.
        <div ref={containerRef} className="table-values-editor table-color-editor">
            {/* Framed as the editor's other fields are, so the pair reads as a field on the
                editor's surface rather than adrift on it. */}
            <div className="tn-field">
                <div className="input-group">
                    <LabelValueInput
                        labelType="color"
                        value={cell.getValue() ?? ""}
                        // Nothing is what the clear button hands back, and only it — a picker always
                        // names a colour. There being nothing to follow a clear with, it finishes
                        // the edit itself.
                        onCommit={(value) => !value && success("")}
                    />
                </div>
            </div>
        </div>
    );
}

/**
 * A colour cell as the chip a set of colours wears, one chip for the one value, so a colour column
 * reads the same whether each note holds one or several. A chip rather than flooding the cell, as
 * Tabulator's own colour formatter fills it: the chip is a surface of its own, leaving the row its
 * striping, hover and selection.
 */
function ColorFormatter({ cell }: FormatterOpts) {
    const value = cell.getValue();
    const color = typeof value === "string" ? value : "";
    // A formatter hands back an element, so an unset cell is an empty one rather than nothing at all.
    if (!color) return <span />;

    return <LabelValueChips values={[ color ]} labelType="color" />;
}

/** A flag cell as the chip a set of flags shows, with an unset cell holding no chip at all. */
function FlagFormatter({ cell }: FormatterOpts) {
    const value = cell.getValue();
    // A stored label arrives as the text "true"/"false", but one just toggled through the tickCross
    // editor is a real boolean; the chip reads the stored spelling of either.
    const flag = typeof value === "boolean" ? String(value) : value;
    if (typeof flag !== "string" || !flag) return <span />;

    return <LabelValueChips values={[ flag ]} labelType="boolean" />;
}

/**
 * A relation cell's editor stands over its cell as the multi-valued editor does, and by the same
 * class: what is typed into it is a note's title, which a column sized for the title it *shows* is
 * rarely wide enough to search by — the box takes at least the cell's width, and grows past it up to
 * the editor's usual ceiling. The list of matches is appended to the body, so it outgrows the cell
 * either way; it is the box being typed into that needs the room.
 */
function RelationEditor({ cell, success }: EditorOpts) {
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => inputRef.current?.focus());

    return (
        <div className="table-values-editor">
            {/* Framed as the editor's other fields are: an editing cell strips the border and
                background from the boxes within, which leaves an unwrapped one adrift on the
                editor's own surface. */}
            <div className="tn-field">
                <NoteAutocomplete
                    inputRef={inputRef}
                    noteId={cell.getValue()}
                    opts={{
                        allowCreatingNotes: true,
                        hideAllButtons: true
                    }}
                    noteIdChanged={success}
                />
            </div>
        </div>
    );
}
