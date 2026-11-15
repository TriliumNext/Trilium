import "./PromotedAttributes.css";

import type { UpdateAttributeResponse } from "@triliumnext/commons";
import clsx from "clsx";
import { ComponentChild } from "preact";
import { Dispatch, StateUpdater, useCallback, useEffect, useState } from "preact/hooks";

import FAttribute from "../entities/fattribute";
import FNote from "../entities/fnote";
import attributes from "../services/attributes";
import { t } from "../services/i18n";
import server from "../services/server";
import ws from "../services/ws";
import LabelValueInput, { useLabelValueSuggestions } from "./attribute_widgets/label_value_input";
import MultiValueInput from "./attribute_widgets/multi_value_input";
import RelationValuesInput from "./attribute_widgets/relation_values_input";
import { type Cell, usePromotedAttributeData } from "./promoted_attribute_cells";
import FormAutocomplete from "./react/FormAutocomplete";
import { useUniqueName } from "./react/hooks/dom";
import { useNoteContext } from "./react/hooks/note_context";
import NoteAutocomplete from "./react/NoteAutocomplete";

interface CellProps {
    note: FNote;
    componentId: string;
    cell: Cell,
    setCells: Dispatch<StateUpdater<Cell[] | undefined>>;
}

export default function PromotedAttributes({ omit }: {
    /**
     * Names of definitions to leave out, for a host that shows what they hold better than a field
     * would — the geo map's marker pane leaves out the location it is already standing on.
     *
     * Left out of the grid only: the note keeps the attribute and every other view of it still
     * offers the field, this being about where a value is best edited rather than whether it counts.
     */
    omit?: readonly string[];
} = {}) {
    const { note, componentId, noteContext } = useNoteContext();
    const [ cells, setCells ] = usePromotedAttributeData(note, componentId, noteContext);
    const shown = omit?.length ? cells?.filter((cell) => !omit.includes(cell.valueName)) : cells;
    return <PromotedAttributesContent note={note} componentId={componentId} cells={shown} setCells={setCells} />;
}

export function PromotedAttributesContent({ note, componentId, cells, setCells }: {
    note: FNote | null | undefined;
    componentId: string;
    cells: Cell[] | undefined;
    setCells: Dispatch<StateUpdater<Cell[] | undefined>>;
}) {
    return (
        <div className="promoted-attributes-widget">
            {cells && cells.length > 0 && <div className="promoted-attributes-container">
                {note && cells?.map(cell => <PromotedAttributeCell
                    key={cell.uniqueId}
                    cell={cell}
                    setCells={setCells}
                    componentId={componentId} note={note}
                />)}
            </div>}
        </div>
    );
}

function PromotedAttributeCell(props: CellProps) {
    const { valueName, valueAttr, definition } = props.cell;
    const inputId = useUniqueName(`value-${valueAttr.name}`);

    const holdsSet = !!props.cell.values;

    let correspondingInput: ComponentChild;
    let className: string | undefined;
    switch (valueAttr.type) {
        case "label":
            correspondingInput = holdsSet
                ? <MultiLabelInput inputId={inputId} {...props} />
                : <LabelInput inputId={inputId} {...props} />;
            className = `promoted-attribute-label-${definition.labelType}`;
            break;
        case "relation":
            correspondingInput = holdsSet
                ? <MultiRelationInput inputId={inputId} {...props} />
                : <RelationInput inputId={inputId} {...props} />;
            className = "promoted-attribute-relation";
            break;
        default:
            ws.logError(t(`promoted_attributes.unknown_attribute_type`, { type: valueAttr.type }));
            break;
    }

    return (
        <div className={clsx("promoted-attribute-cell", className)}>
            {/* A single flag names itself after its own box, a checkbox before its name reading as the
                sentence it is. A field of flags is a field like any other: the chips in it stand for
                values, not for the field being on, so the name goes ahead of it as elsewhere. */}
            {(definition.labelType !== "boolean" || holdsSet) &&
                <label for={inputId}>{definition.promotedAlias ?? valueName}</label>}
            {correspondingInput}
        </div>
    );
}

function LabelInput(props: CellProps & { inputId: string }) {
    const { inputId, note, cell, componentId, setCells } = props;
    const { valueName, valueAttr, definition, definitionAttr } = cell;
    const [ valueDraft, setDraft ] = useState(valueAttr.value);
    const labelType = definition.labelType ?? "text";
    const commit = useCallback(
        (value: string) => updateAttribute(note, cell, componentId, value, setCells),
        [ cell, componentId, note, setCells ]);

    const createOption = useCreateSelectOption(definitionAttr, componentId, setCells);
    const suggestValues = useLabelValueSuggestions(valueName);

    // React to model changes.
    useEffect(() => {
        setDraft(valueAttr.value);
    }, [ valueAttr.value ]);

    const inputProps = {
        className: "form-control promoted-attribute-input",
        tabIndex: 200 + definitionAttr.position,
        id: inputId,
        placeholder: t("promoted_attributes.unset-field-placeholder"),
        "data-attribute-id": valueAttr.attributeId,
        "data-attribute-type": valueAttr.type,
        "data-attribute-name": valueAttr.name
    };

    // A text value commits on blur like the other types, so a picked suggestion only fills in the
    // draft.
    const input = labelType === "text"
        ? <FormAutocomplete
            {...inputProps}
            currentValue={valueDraft ?? ""}
            source={suggestValues}
            openOnFocus
            onChange={setDraft}
            onBlur={commit}
        />
        : <LabelValueInput
            labelType={labelType}
            value={valueAttr.value ?? ""}
            onCommit={commit}
            commitOn="blur"
            numberPrecision={definition.numberPrecision}
            selectOptions={definition.selectOptions}
            onCreateOption={labelType === "select" ? createOption : undefined}
            inputProps={inputProps}
        />;

    if (labelType === "boolean") {
        return <>
            <div>
                <label className="tn-checkbox">{input}</label>
            </div>
            <label for={inputId}>{definition.promotedAlias ?? valueName}</label>
        </>;
    }
    return <div className="input-group">{input}</div>;
}

/**
 * The field a label allowing several values is edited through: one field holding the whole set as
 * chips, rather than a field per value with buttons beside each for adding and removing one.
 *
 * The set is written back by name — every value under it at once — so nothing here holds an attribute
 * of its own: which attribute ends up carrying which value is neither knowable from here nor worth
 * knowing, the note holding a set rather than an ordered list of rows.
 */
function MultiLabelInput({ inputId, note, cell, componentId, setCells }: CellProps & { inputId: string }) {
    const { valueName, definition, definitionAttr, values, uniqueId } = cell;
    const labelType = definition.labelType ?? "text";
    const createOption = useCreateSelectOption(definitionAttr, componentId, setCells);
    const suggestValues = useLabelValueSuggestions(valueName);

    const commit = useCallback(async (edited: string[]) => {
        await attributes.setLabelValues(note, valueName, edited, componentId);
        // The grid ignores reloads it is itself the source of (see usePromotedAttributeData), so the
        // set it shows is patched in place, as updateAttribute does for a single value — otherwise
        // the chips would not follow the value just taken.
        setCells(prev => prev?.map(c => c.uniqueId === uniqueId ? { ...c, values: edited } : c));
    }, [ note, valueName, componentId, uniqueId, setCells ]);

    return (
        <div className="promoted-attribute-values">
            <MultiValueInput
                labelType={labelType}
                values={values ?? []}
                // Matches the single-value field, which offers suggestions for `text` alone.
                source={labelType === "text" ? suggestValues : undefined}
                options={definition.selectOptions}
                onCreateOption={labelType === "select" ? createOption : undefined}
                inputId={inputId}
                tabIndex={200 + definitionAttr.position}
                onCommit={commit}
            />
        </div>
    );
}

/**
 * Adds an option to a `select` definition from the very field being typed into. Written to whichever
 * note owns the definition — typically a parent or a template — so every note sharing the field
 * offers the new option from now on.
 */
function useCreateSelectOption(definitionAttr: FAttribute, componentId: string, setCells: Dispatch<StateUpdater<Cell[] | undefined>>) {
    return useCallback(async (option: string) => {
        const newDefinition = await attributes.addSelectOption(definitionAttr, option, componentId);
        // The grid ignores reloads it is itself the source of (see usePromotedAttributeData), so the
        // cells sharing the definition are patched in place, as updateAttribute does for a value —
        // otherwise the list keeps offering the old options until something else changes.
        setCells(prev => prev?.map(c =>
            c.definitionAttr.attributeId === definitionAttr.attributeId
                ? { ...c, definition: newDefinition }
                : c
        ));
    }, [ definitionAttr, componentId, setCells ]);
}

function RelationInput({ inputId, ...props }: CellProps & { inputId: string }) {
    return (
        <NoteAutocomplete
            id={inputId}
            tabIndex={200 + props.cell.definitionAttr.position}
            noteId={props.cell.valueAttr.value}
            opts={{ allowCreatingNotes: true }}
            noteIdChanged={async (value) => {
                const { note, cell, componentId, setCells } = props;
                await updateAttribute(note, cell, componentId, value, setCells);
            }}
        />
    );
}

/**
 * The field a relation allowing several targets is edited through: one field holding the whole set
 * as chips naming their notes, written back by name as {@link MultiLabelInput} writes a set of
 * labels — every target under the name at once, through no one attribute in particular.
 */
function MultiRelationInput({ inputId, note, cell, componentId, setCells }: CellProps & { inputId: string }) {
    const { valueName, definitionAttr, values, uniqueId } = cell;

    const commit = useCallback(async (edited: string[]) => {
        await attributes.setRelationValues(note, valueName, edited, componentId);
        // The grid ignores reloads it is itself the source of (see usePromotedAttributeData), so the
        // set it shows is patched in place — otherwise the chips would not follow the pick just made.
        setCells(prev => prev?.map(c => c.uniqueId === uniqueId ? { ...c, values: edited } : c));
    }, [ note, valueName, componentId, uniqueId, setCells ]);

    return (
        <div className="promoted-attribute-values">
            <RelationValuesInput
                values={values ?? []}
                inputId={inputId}
                tabIndex={200 + definitionAttr.position}
                onCommit={commit}
            />
        </div>
    );
}

async function updateAttribute(note: FNote, cell: Cell, componentId: string, value: string | undefined, setCells: Dispatch<StateUpdater<Cell[] | undefined>>) {
    if (value === cell.valueAttr.value) return;
    const { attributeId } = await server.put<UpdateAttributeResponse>(
        `notes/${note.noteId}/attribute`,
        {
            attributeId: cell.valueAttr.attributeId,
            type: cell.valueAttr.type,
            name: cell.valueName,
            value: value || ""
        },
        componentId
    );
    setCells(prev =>
        prev?.map(c =>
            c.uniqueId === cell.uniqueId
                ? { ...c, valueAttr: {
                    ...c.valueAttr,
                    attributeId,
                    value
                } }
                : c
        )
    );
}
