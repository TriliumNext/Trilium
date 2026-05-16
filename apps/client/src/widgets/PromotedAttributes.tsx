import "./PromotedAttributes.css";

import { DefinitionObject, LabelType, UpdateAttributeResponse } from "@triliumnext/commons";
import clsx from "clsx";
import { ComponentChild, createElement, HTMLInputTypeAttribute, InputHTMLAttributes, MouseEventHandler, TargetedEvent, TargetedInputEvent } from "preact";
import { Dispatch, StateUpdater, useCallback, useEffect, useRef, useState } from "preact/hooks";

import NoteContext from "../components/note_context";
import FAttribute from "../entities/fattribute";
import FNote from "../entities/fnote";
import { Attribute } from "../services/attribute_parser";
import attributes from "../services/attributes";
import { t } from "../services/i18n";
import { extractAttributeDefinitionTypeAndName } from "../services/promoted_attribute_definition_parser";
import server from "../services/server";
import { randomString } from "../services/utils";
import ws from "../services/ws";
import { useNoteContext, useNoteLabel, useTriliumEvent, useUniqueName } from "./react/hooks";
import NoteAutocomplete from "./react/NoteAutocomplete";

interface Cell {
    uniqueId: string;
    definitionAttr: FAttribute;
    definition: DefinitionObject;
    valueAttr: Attribute;
    valueName: string;
}

interface CellProps {
    note: FNote;
    componentId: string;
    cell: Cell,
    cells: Cell[],
    shouldFocus: boolean;
    setCells: Dispatch<StateUpdater<Cell[] | undefined>>;
    setCellToFocus(cell: Cell): void;
}

type OnChangeEventData = TargetedEvent<HTMLInputElement | HTMLTextAreaElement, Event> | InputEvent | JQuery.TriggeredEvent<HTMLInputElement, undefined, HTMLInputElement, HTMLInputElement>;
type OnChangeListener = (e: OnChangeEventData) => void | Promise<void>;

export default function PromotedAttributes() {
    const { note, componentId, noteContext } = useNoteContext();
    const [ cells, setCells ] = usePromotedAttributeData(note, componentId, noteContext);
    return <PromotedAttributesContent note={note} componentId={componentId} cells={cells} setCells={setCells} />;
}

export function PromotedAttributesContent({ note, componentId, cells, setCells }: {
    note: FNote | null | undefined;
    componentId: string;
    cells: Cell[] | undefined;
    setCells: Dispatch<StateUpdater<Cell[] | undefined>>;
}) {
    const [ cellToFocus, setCellToFocus ] = useState<Cell>();

    return (
        <div className="promoted-attributes-widget">
            {cells && cells.length > 0 && <div className="promoted-attributes-container">
                {note && cells?.map(cell => <PromotedAttributeCell
                    key={cell.uniqueId}
                    cell={cell}
                    cells={cells} setCells={setCells}
                    shouldFocus={cell === cellToFocus} setCellToFocus={setCellToFocus}
                    componentId={componentId} note={note}
                />)}
            </div>}
        </div>
    );
}

/**
 * Handles the individual cells (instances for promoted attributes including empty attributes). Promoted attributes with "multiple" multiplicity will have
 * each value represented as a separate cell.
 *
 * The cells are returned as a state since they can also be altered internally if needed, for example to add a new empty cell.
 */
export function usePromotedAttributeData(note: FNote | null | undefined, componentId: string, noteContext: NoteContext | undefined): [ Cell[] | undefined, Dispatch<StateUpdater<Cell[] | undefined>> ] {
    const [ viewType ] = useNoteLabel(note, "viewType");
    const [ cells, setCells ] = useState<Cell[]>();

    function refresh() {
        if (!note || viewType === "table" || noteContext?.viewScope?.viewMode !== "default") {
            setCells([]);
            return;
        }
        const promotedDefAttrs = note.getPromotedDefinitionAttributes();
        const ownedAttributes = note.getOwnedAttributes();
        // attrs are not resorted if position changes after the initial load
        // promoted attrs are sorted primarily by order of definitions, but with multi-valued promoted attrs
        // the order of attributes is important as well
        ownedAttributes.sort((a, b) => a.position - b.position);

        const cells: Cell[] = [];
        for (const definitionAttr of promotedDefAttrs) {
            const [ valueType, valueName ] = extractAttributeDefinitionTypeAndName(definitionAttr.name);

            let valueAttrs = ownedAttributes.filter((el) => el.name === valueName && el.type === valueType) as Attribute[];

            if (valueAttrs.length === 0) {
                valueAttrs.push({
                    attributeId: "",
                    type: valueType,
                    name: valueName,
                    value: ""
                });
            }

            if (definitionAttr.getDefinition().multiplicity === "single") {
                valueAttrs = valueAttrs.slice(0, 1);
            }

            for (const valueAttr of valueAttrs) {
                const definition = definitionAttr.getDefinition();

                // if not owned, we'll force creation of a new attribute instead of updating the inherited one
                if (valueAttr.noteId !== note.noteId) {
                    valueAttr.attributeId = "";
                }

                const uniqueId = randomString();
                cells.push({  definitionAttr, definition, valueAttr, valueName, uniqueId });
            }
        }
        setCells(cells);
    }

    useEffect(refresh, [ note, viewType, noteContext ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows(componentId).find((attr) => attributes.isAffecting(attr, note))) {
            refresh();
        }
    });

    return [ cells, setCells ];
}

function PromotedAttributeCell(props: CellProps) {
    const { valueName, valueAttr, definition } = props.cell;
    const inputId = useUniqueName(`value-${valueAttr.name}`);

    useEffect(() => {
        if (!props.shouldFocus) return;
        const inputEl = document.getElementById(inputId);
        if (inputEl) {
            inputEl.focus();
        }
    }, [ props.shouldFocus ]);

    let correspondingInput: ComponentChild;
    let className: string | undefined;
    switch (valueAttr.type) {
        case "label":
            correspondingInput = <LabelInput inputId={inputId} {...props} />;
            className = `promoted-attribute-label-${definition.labelType}`;
            break;
        case "relation":
            correspondingInput = <RelationInput inputId={inputId} {...props} />;
            className = "promoted-attribute-relation";
            break;
        default:
            ws.logError(t(`promoted_attributes.unknown_attribute_type`, { type: valueAttr.type }));
            break;
    }

    return (
        <div className={clsx("promoted-attribute-cell", className)}>
            {definition.labelType !== "boolean" && <label for={inputId}>{definition.promotedAlias ?? valueName}</label>}
            {correspondingInput}
            <MultiplicityCell {...props} />
        </div>
    );
}

const LABEL_MAPPINGS: Record<LabelType, HTMLInputTypeAttribute | undefined> = {
    text: "text",
    textarea: undefined,
    number: "number",
    boolean: "checkbox",
    date: "date",
    datetime: "datetime-local",
    time: "time",
    color: "hidden", // handled separately.
    url: "url"
};

function LabelInput(props: CellProps & { inputId: string }) {
    const { inputId, note, cell, componentId, setCells } = props;
    const { valueName, valueAttr, definition, definitionAttr } = cell;
    const [ valueDraft, setDraft ] = useState(valueAttr.value);
    const onChangeListener = useCallback(async (e: OnChangeEventData) => {
        const inputEl = e.target as HTMLInputElement;
        let value: string;

        if (inputEl.type === "checkbox") {
            value = inputEl.checked ? "true" : "false";
        } else {
            value = inputEl.value;
        }

        await updateAttribute(note, cell, componentId, value, setCells);
    }, [ cell, componentId, note, setCells ]);
    const extraInputProps: InputHTMLAttributes = {};

    useTextLabelAutocomplete(inputId, valueAttr, definition, (e) => {
        if (e.currentTarget instanceof HTMLInputElement) {
            setDraft(e.currentTarget.value);
        }
    });

    // React to model changes.
    useEffect(() => {
        setDraft(valueAttr.value);
    }, [ valueAttr.value ]);

    switch (definition.labelType) {
        case "number": {
            let step = 1;
            for (let i = 0; i < (definition.numberPrecision || 0) && i < 10; i++) {
                step /= 10;
            }
            extraInputProps.step = step;
            break;
        }
        case "url": {
            extraInputProps.placeholder = t("promoted_attributes.url_placeholder");
            break;
        }
    }


    const inputNode = createElement(definition.labelType === "textarea" ? "textarea" : "input", {
        className: "form-control promoted-attribute-input",
        tabIndex: 200 + definitionAttr.position,
        id: inputId,
        type: LABEL_MAPPINGS[definition.labelType ?? "text"],
        value: valueDraft,
        checked: definition.labelType === "boolean" ? valueAttr.value === "true" : undefined,
        placeholder: t("promoted_attributes.unset-field-placeholder"),
        "data-attribute-id": valueAttr.attributeId,
        "data-attribute-type": valueAttr.type,
        "data-attribute-name": valueAttr.name,
        onBlur: onChangeListener,
        ...extraInputProps
    });

    if (definition.labelType === "boolean") {
        return <>
            <div>
                <label className="tn-checkbox">{inputNode}</label>
            </div>
            <label for={inputId}>{definition.promotedAlias ?? valueName}</label>
        </>;
    }
    return (
        <div className="input-group">
            {inputNode}
            { definition.labelType === "color" && <ColorPicker {...props} onChange={onChangeListener} inputId={inputId} />}
            { definition.labelType === "url" && (
                <InputButton
                    className="open-external-link-button"
                    icon="bx bx-window-open"
                    title={t("promoted_attributes.open_external_link")}
                    onClick={(e) => {
                        const inputEl = document.getElementById(inputId) as HTMLInputElement | null;
                        const url = inputEl?.value;
                        if (url) {
                            window.open(url, "_blank");
                        }
                    }}
                />
            )}
        </div>
    );

}


// We insert a separate input since the color input does not support empty value.
// This is a workaround to allow clearing the color input.
function ColorPicker({ cell, onChange, inputId }: CellProps & {
    onChange: (e: TargetedEvent<HTMLInputElement, Event>) => Promise<void>,
    inputId: string;
}) {
    const defaultColor = "#ffffff";
    const colorInputRef = useRef<HTMLInputElement>(null);
    return (
        <>
            <input
                ref={colorInputRef}
                className="form-control promoted-attribute-input"
                type="color"
                value={cell.valueAttr.value || defaultColor}
                onChange={onChange}
            />
            <InputButton
                icon="bx bxs-tag-x"
                title={t("promoted_attributes.remove_color")}
                onClick={(e) => {
                    // Indicate to the user the color was reset.
                    if (colorInputRef.current) {
                        colorInputRef.current.value = defaultColor;
                    }

                    // Trigger the actual attribute change by injecting it into the hidden field.
                    const inputEl = document.getElementById(inputId) as HTMLInputElement | null;
                    if (!inputEl) return;
                    inputEl.value = "";
                    onChange({
                        ...e,
                        target: inputEl
                    } as unknown as TargetedInputEvent<HTMLInputElement>);
                }}
            />
        </>
    );
}

function RelationInput({ inputId, ...props }: CellProps & { inputId: string }) {
    return (
        <NoteAutocomplete
            id={inputId}
            noteId={props.cell.valueAttr.value}
            noteIdChanged={async (value) => {
                const { note, cell, componentId, setCells } = props;
                await updateAttribute(note, cell, componentId, value, setCells);
            }}
        />
    );
}

function MultiplicityCell({ cell, cells, setCells, setCellToFocus, note, componentId }: CellProps) {
    return (cell.definition.multiplicity === "multi" &&
        <td className="multiplicity">
            <PromotedActionButton
                icon="bx bx-plus"
                title={t("promoted_attributes.add_new_attribute")}
                onClick={() => {
                    const index = cells.indexOf(cell);
                    const newCell: Cell = {
                        ...cell,
                        uniqueId: randomString(),
                        valueAttr: {
                            attributeId: "",
                            type: cell.valueAttr.type,
                            name: cell.valueName,
                            value: ""
                        }
                    };
                    setCells([
                        ...cells.slice(0, index + 1),
                        newCell,
                        ...cells.slice(index + 1)
                    ]);
                    setCellToFocus(newCell);
                }}
            />{' '}
            <PromotedActionButton
                icon="bx bx-trash"
                title={t("promoted_attributes.remove_this_attribute")}
                onClick={async () => {
                    // Remove the attribute from the server if it exists.
                    const { attributeId, type } = cell.valueAttr;
                    const valueName = cell.valueName;
                    if (attributeId) {
                        await server.remove(`notes/${note.noteId}/attributes/${attributeId}`, componentId);
                    }

                    const index = cells.indexOf(cell);
                    const isLastOneOfType = cells.filter(c => c.valueAttr.type === type && c.valueAttr.name === valueName).length < 2;
                    const newOnesToInsert: Cell[] = [];
                    if (isLastOneOfType) {
                        newOnesToInsert.push({
                            ...cell,
                            valueAttr: {
                                attributeId: "",
                                type: cell.valueAttr.type,
                                name: cell.valueName,
                                value: ""
                            }
                        });
                    }
                    setCells(cells.toSpliced(index, 1, ...newOnesToInsert));
                }}
            />
        </td>
    );
}

function PromotedActionButton({ icon, title, onClick }: {
    icon: string,
    title: string,
    onClick: MouseEventHandler<HTMLSpanElement>
}) {
    return (
        <span
            className={clsx("tn-tool-button pointer", icon)}
            title={title}
            onClick={onClick}
        />
    );
}

function InputButton({ icon, className, title, onClick }: {
    icon: string;
    className?: string;
    title: string;
    onClick: MouseEventHandler<HTMLSpanElement>;
}) {
    return (
        <span
            className={clsx("input-group-text", className, icon)}
            title={title}
            onClick={onClick}
        />
    );
}

function useTextLabelAutocomplete(inputId: string, valueAttr: Attribute, definition: DefinitionObject, onChangeListener: OnChangeListener) {
    const [ attributeValues, setAttributeValues ] = useState<{ value: string }[] | null>(null);

    // Obtain data.
    useEffect(() => {
        if (definition.labelType !== "text") {
            return;
        }

        server.get<string[]>(`attribute-values/${encodeURIComponent(valueAttr.name)}`).then((_attributesValues) => {
            setAttributeValues(_attributesValues.map((attribute) => ({ value: attribute })));
        });
    }, [ definition.labelType, valueAttr.name ]);

    // Initialize autocomplete.
    useEffect(() => {
        if (attributeValues?.length === 0) return;
        const el = document.getElementById(inputId) as HTMLInputElement | null;
        if (!el) return;

        const $input = $(el);
        $input.autocomplete(
            {
                appendTo: document.querySelector("body"),
                hint: false,
                autoselect: false,
                openOnFocus: true,
                minLength: 0,
                tabAutocomplete: false
            },
            [
                {
                    displayKey: "value",
                    source (term, cb) {
                        term = term.toLowerCase();

                        const filtered = (attributeValues ?? []).filter((attr) => attr.value.toLowerCase().includes(term));

                        cb(filtered);
                    }
                }
            ]
        );

        $input.off("autocomplete:selected");
        $input.on("autocomplete:selected", onChangeListener);

        return () => $input.autocomplete("destroy");
    }, [ inputId, attributeValues, onChangeListener ]);
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
