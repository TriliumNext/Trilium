import "./AttributeValueEditor.css";

import type { LabelType } from "@triliumnext/commons";
import { useEffect, useLayoutEffect, useMemo, useRef } from "preact/hooks";

import type FNote from "../../entities/fnote";
import type { Attribute } from "../../services/attribute_parser";
import { getBuiltinLabelSelectOptions, getBuiltinLabelValueType, isBuiltinAttribute } from "../../services/attributes";
import { t } from "../../services/i18n";
import LabelValueInput, { getTypedInputForLabel } from "../attribute_widgets/label_value_input";
import NoteAutocomplete from "../react/NoteAutocomplete";
import AttributeEditorOverlay from "./AttributeEditorOverlay";

interface AttributeValueEditorProps {
    /** The note the label belongs to, read for the definition that says what kind of field to offer. */
    note: FNote;
    attribute: Attribute;
    /** Receives the value as it is typed; the host writes it into the row it holds, and saves on commit. */
    onEdit(value: string): void;
    /** Close keeping the edits, which the host saves. */
    onCommit(): void;
    /** Close putting the value back as it was. */
    onRevert(): void;
}

/**
 * An attribute's value edited in the row that previews it, without opening the detail form: for a
 * label the same field its promoted counterpart offers — a date picker for a date, a palette for a
 * colour, a dropdown for a closed set, a plain box where nothing says more about the value than that
 * it is one — and for a relation the note search its target is picked in everywhere else. Only the
 * value is edited here — the name, the flags and the definitions stay with the form the rest of the
 * row opens.
 *
 * The field stands on the {@link AttributeEditorOverlay} shell, which is what says when the edit is
 * over: leaving keeps it, escape puts the value back.
 */
export default function AttributeValueEditor({ note, attribute, onEdit, onCommit, onRevert }: AttributeValueEditorProps) {
    const containerRef = useRef<HTMLSpanElement>(null);
    const isRelation = attribute.type === "relation";

    // The overlay is held off the row's leading edge so the name stays readable (see the stylesheet)
    // — but only as far as the name actually reaches, told to the stylesheet here: a short name would
    // otherwise sit apart from its editor, with an odd gap where the cap had room to spare. Measured
    // once, before the paint that would show the gap: nothing here edits the name.
    useLayoutEffect(() => {
        const editor = containerRef.current;
        const row = editor?.parentElement;
        const name = row?.querySelector<HTMLElement>(".attribute-name");
        if (!editor || !row || !name) return;

        const rowRect = row.getBoundingClientRect();
        const nameRect = name.getBoundingClientRect();
        const nameEnd = getComputedStyle(row).direction === "rtl"
            ? rowRect.right - nameRect.left
            : nameRect.right - rowRect.left;
        editor.style.setProperty("--value-editor-name-end", `${Math.ceil(nameEnd) + ROW_GAP}px`);
    }, []);
    // What a label is typed as; a relation's field follows from being one.
    const typed = useMemo(
        () => isRelation ? undefined : resolveValueField(note, attribute.name),
        [ isRelation, note, attribute.name ]);

    // The editor exists because its row was pressed, so the field is ready to type into at once — and
    // what is there is selected, a short value being more often replaced than appended to. A colour
    // goes further: picking is all there is to do to it, so the picker's dialog opens with the editor
    // rather than waiting to be asked by a second press on the swatch.
    useEffect(() => {
        const field = containerRef.current?.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select");
        field?.focus();
        if ((field instanceof HTMLInputElement && SELECT_ALL_TYPES.has(field.type)) || field instanceof HTMLTextAreaElement) {
            field.select();
        } else if (field instanceof HTMLInputElement && field.type === "color") {
            try {
                // Optional because not every engine offers it, and guarded because it refuses to open
                // without the user activation the press provides — which a test's render lacks.
                field.showPicker?.();
            } catch {
                // The swatch is still there to be pressed, as it would be without the head start.
            }
        }
    }, []);

    return (
        <AttributeEditorOverlay
            overlayRef={containerRef}
            className="attribute-value-editor"
            onCommit={onCommit}
            onRevert={onRevert}
            // Enter is the note search's own key — it is what picks — so only a label commits on it;
            // a textarea keeps it for its newlines unless it is held down with the modifier.
            onKeyDown={(e) => {
                if (e.key === "Enter" && typed && (typed.labelType !== "textarea" || e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    e.stopPropagation();
                    onCommit();
                }
            }}
        >
            {typed ? (
                <LabelField typed={typed} attribute={attribute} onEdit={onEdit} onCommit={onCommit} />
            ) : (
                <NoteAutocomplete
                    noteId={attribute.value || undefined}
                    opts={TARGET_NOTE_OPTS}
                    noteIdChanged={(noteId) => onEdit(noteId ?? "")}
                />
            )}
        </AttributeEditorOverlay>
    );
}

/**
 * The field a label's value is typed into, dressed by its kind. A flag gets two things of its own:
 * the `tn-checkbox` label the theme dresses a checkbox through — bare, the switch comes out a broken
 * sliver — and a commit per toggle, the toggle being the whole of a flag's edit: nothing further to
 * type, so the switch both writes and closes.
 */
function LabelField({ typed, attribute, onEdit, onCommit }: {
    typed: ReturnType<typeof resolveValueField>;
    attribute: Attribute;
    onEdit(value: string): void;
    onCommit(): void;
}) {
    const isBoolean = typed.labelType === "boolean";
    const input = (
        <LabelValueInput
            labelType={typed.labelType}
            value={attribute.value ?? ""}
            onCommit={(value) => {
                onEdit(value);
                if (isBoolean) {
                    onCommit();
                }
            }}
            commitOn="input"
            numberPrecision={typed.numberPrecision}
            selectOptions={typed.selectOptions}
            // The row has no room to spare beside the field for the button opening a
            // link-like value; the detail form keeps it, having the room.
            hideOpenButton
            inputProps={{
                className: "form-control",
                // Names the dropdown's empty entry, as the detail form does for the same field.
                ...(typed.labelType === "select" && {
                    placeholder: t("promoted_attributes.unset-field-placeholder")
                })
            }}
        />
    );

    return isBoolean ? <label className="tn-checkbox">{input}</label> : input;
}

/** The input types whose content `select()` applies to; the pickers select nothing and mind nothing. */
const SELECT_ALL_TYPES = new Set([ "text", "number", "url", "email", "tel" ]);

/** The breath between the name and the overlay's edge: the gap the row lays its items out with. */
const ROW_GAP = 6;

/** Constant so it does not re-initialise the autocomplete on every render, as in the detail form —
 *  less the buttons beside the box (go to, search, recent), which are more furniture than a row has
 *  room for; the field a relation holding several targets offers leaves them out the same way. */
export const TARGET_NOTE_OPTS = { allowCreatingNotes: true, hideAllButtons: true };

/**
 * What kind of field the label's value is edited through: for a system label the same closed sets and
 * kinds the detail form offers, exclusions included (a flag means what its presence means, so no
 * checkbox over it); for the rest whatever definition reaches the note for the name, promoted or not,
 * down to the plain text box a label defined by nothing is typed into.
 *
 * Exported for the row's preview, which reads the same answer to know a colour when it shows one.
 */
export function resolveValueField(note: FNote, name: string): {
    labelType: LabelType;
    selectOptions?: readonly string[];
    numberPrecision?: number;
} {
    if (isBuiltinAttribute("label", name)) {
        const labelType = getTypedInputForLabel(getBuiltinLabelValueType(name));
        return {
            labelType: labelType ?? "text",
            selectOptions: labelType ? getBuiltinLabelSelectOptions(name) : undefined
        };
    }

    const definition = note.getAttributeDefinitions()
        .find((definitionAttr) => definitionAttr.name === `label:${name}`)
        ?.getDefinition();

    return {
        labelType: definition?.labelType ?? "text",
        selectOptions: definition?.selectOptions,
        numberPrecision: definition?.numberPrecision
    };
}
