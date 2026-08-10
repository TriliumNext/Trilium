import "./AttributeCreationEditor.css";

import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import type FNote from "../../entities/fnote";
import type { Attribute } from "../../services/attribute_parser";
import { t } from "../../services/i18n";
import utils from "../../services/utils";
import { AttributeNameSuggestion, fetchAttributeNames } from "../attribute_widgets/attribute_detail";
import LabelValueInput from "../attribute_widgets/label_value_input";
import FormAutocomplete from "../react/FormAutocomplete";
import Icon from "../react/Icon";
import NoteAutocomplete from "../react/NoteAutocomplete";
import AttributeEditorOverlay from "./AttributeEditorOverlay";
import { resolveValueField, TARGET_NOTE_OPTS } from "./AttributeValueEditor";

interface AttributeCreationEditorProps {
    /** The note the attribute is created on, read for the definition that types the value field. */
    note: FNote;
    /** The draft the host appended to its rows; the name and value are written into it as typed. */
    attribute: Attribute;
    /** Close keeping the draft — which the host saves, or discards if it was never given a name. */
    onCommit(): void;
    /** Close un-creating the draft. */
    onRevert(): void;
}

/**
 * A label or relation created in a row of its own, without opening the detail form: the two things a
 * plain attribute is made of side by side — the name, completed from the names already in use, and
 * the value the name calls for (see {@link resolveValueField}) or the note search a relation's target
 * is picked in. Everything else the form collects — inheritability, a definition's settings — is
 * rare enough to stay with the form, reachable from the row once it exists.
 *
 * Stands on the {@link AttributeEditorOverlay} shell: leaving keeps the draft, escape drops it. In
 * the name box, enter walks on to the value field once the completion has had its say.
 *
 * Which of the two kinds is being created is the draft's to start with, but not fixed: the `#`/`~`
 * the attributes editor opens its syntax with switch it from the head of the name box, and the kind
 * icon leading the row switches it by mouse — so one way in (the add row at the list's foot, which
 * always opens a label) serves both kinds.
 */
export default function AttributeCreationEditor({ note, attribute, onCommit, onRevert }: AttributeCreationEditorProps) {
    const containerRef = useRef<HTMLSpanElement>(null);
    const nameRef = useRef<HTMLInputElement>(null);
    // Held as state rather than read off the draft, because the draft can change kinds under the
    // editor's hands: the attributes editor spells a kind as the `#`/`~` its syntax opens with, and
    // typing either at the head of the name here switches the draft the same way (see commitName) —
    // as does the kind icon leading the row, for the mouse.
    const [ kind, setKind ] = useState<"label" | "relation">(attribute.type === "relation" ? "relation" : "label");
    const isRelation = kind === "relation";
    // The one other field state here: the value lives in the draft alone, but the name is what the
    // value field's kind hangs off, so typing it has to re-render.
    const [ name, setName ] = useState(attribute.name);
    // Committing mid-composition would filter the characters being composed out from under the IME;
    // the same guard the detail form keeps (https://github.com/zadam/trilium/pull/3812).
    const isComposing = useRef(false);

    const suggestNames = useCallback((query: string) => fetchAttributeNames(kind, query), [ kind ]);
    const renderNameSuggestion = useCallback(
        (suggestion: string) => <AttributeNameSuggestion type={kind} name={suggestion} />, [ kind ]);

    // What the name as it stands would be typed as, so a name with a definition behind it gets its
    // field the moment the name settles — type `due`, and the value side becomes its date picker.
    const typed = useMemo(
        () => isRelation ? undefined : resolveValueField(note, name),
        [ isRelation, note, name ]);

    useEffect(() => nameRef.current?.focus(), []);

    function switchKind(newKind: "label" | "relation") {
        if (newKind === kind) {
            return;
        }

        setKind(newKind);
        attribute.type = newKind;
        // A value typed for the one kind means nothing to the other: a note is not named by the text
        // a label held, nor a label by a noteId. The field is remounted empty by the kind switch.
        attribute.value = "";
    }

    function commitName(newName: string) {
        // The `#`/`~` the attributes editor opens its syntax with act as kind switches here, at the
        // head of the name where the syntax puts them; the filter below then strips them, as it
        // strips both characters wherever they turn up.
        if (newName.startsWith("#")) {
            switchKind("label");
        } else if (newName.startsWith("~")) {
            switchKind("relation");
        }

        // Invalid characters are simply ignored, as the detail form ignores them.
        const filtered = utils.filterAttributeName(newName);
        setName(filtered);
        attribute.name = filtered;
    }

    /** Enter in the name box walks on to the value field, the completion having had its say first. */
    function focusValueField() {
        containerRef.current
            ?.querySelector<HTMLElement>(".attribute-creation-value input:not([type=hidden]), .attribute-creation-value textarea, .attribute-creation-value select")
            ?.focus();
    }

    return (
        <AttributeEditorOverlay
            overlayRef={containerRef}
            className="attribute-creation-editor"
            onCommit={onCommit}
            onRevert={onRevert}
            onKeyDown={(e) => {
                if (e.key !== "Enter") return;

                if (e.target instanceof Element && e.target.closest(".attribute-creation-name")) {
                    e.preventDefault();
                    e.stopPropagation();
                    focusValueField();
                // Enter is the note search's own key — it is what picks — so only a label's value
                // commits on it; a textarea keeps it for its newlines unless held with the modifier.
                } else if (typed && (typed.labelType !== "textarea" || e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    e.stopPropagation();
                    onCommit();
                }
            }}
        >
            {/* The kind, where the row would carry its icon — and the mouse's way of switching it,
                the mousedown guard above keeping the press from blurring the name box meanwhile. */}
            <span
                className="attribute-creation-kind"
                title={isRelation
                    ? t("attribute_list_panel.creation_kind_relation")
                    : t("attribute_list_panel.creation_kind_label")}
                onClick={() => switchKind(isRelation ? "label" : "relation")}
            >
                <Icon icon={isRelation ? "bx bx-transfer" : "bx bx-hash"} />
            </span>
            <span className="attribute-creation-name">
                <FormAutocomplete
                    inputRef={nameRef}
                    currentValue={name}
                    placeholder={t("attribute_detail.name")}
                    source={suggestNames}
                    renderItem={renderNameSuggestion}
                    openOnFocus
                    onChange={(newName) => isComposing.current ? setName(newName) : commitName(newName)}
                    onCompositionStart={() => isComposing.current = true}
                    onCompositionEnd={(e) => {
                        isComposing.current = false;
                        commitName(e.currentTarget.value);
                    }}
                />
            </span>
            <span className="attribute-creation-value">
                {isRelation ? (
                    <NoteAutocomplete
                        noteId={attribute.value || undefined}
                        opts={TARGET_NOTE_OPTS}
                        noteIdChanged={(noteId) => {
                            attribute.value = noteId ?? "";
                        }}
                    />
                ) : typed && (
                    // A flag's switch inside the label the theme dresses a checkbox through; bare, it
                    // comes out a broken sliver. No commit per toggle here, unlike the value editor's
                    // (see LabelField there): the name may still be waiting to be typed.
                    <FlagWrapper isFlag={typed.labelType === "boolean"}>
                        <LabelValueInput
                            // Remounted when the name resolves to another kind of field, reseeded from
                            // whatever the draft holds by then.
                            labelType={typed.labelType}
                            value={attribute.value ?? ""}
                            onCommit={(value) => {
                                attribute.value = value;
                            }}
                            commitOn="input"
                            numberPrecision={typed.numberPrecision}
                            selectOptions={typed.selectOptions}
                            hideOpenButton
                            inputProps={{
                                className: "form-control",
                                ...(typed.labelType === "select" && {
                                    placeholder: t("promoted_attributes.unset-field-placeholder")
                                })
                            }}
                        />
                    </FlagWrapper>
                )}
            </span>
        </AttributeEditorOverlay>
    );
}

/** The `tn-checkbox` label a flag's switch is dressed through; everything else passes bare. */
function FlagWrapper({ isFlag, children }: { isFlag: boolean; children: ComponentChildren }) {
    return isFlag ? <label className="tn-checkbox">{children}</label> : <>{children}</>;
}
