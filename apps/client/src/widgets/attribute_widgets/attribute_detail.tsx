import "./attribute_detail.css";
import "./attribute_name_suggestion.css";

import { type DefinitionObject, type LabelType, promotedAttributeDefinitionParser } from "@triliumnext/commons";
import { ComponentChildren, ComponentProps } from "preact";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context.js";
import { isDefinitionName } from "../../entities/fattribute.js";
import contextMenu, { MenuItem } from "../../menus/context_menu.js";
import type { Attribute } from "../../services/attribute_parser.js";
import { getBuiltinLabelSelectOptions, getBuiltinLabelValueType, isBuiltinAttribute } from "../../services/attributes.js";
import { isExperimentalFeatureEnabled } from "../../services/experimental_features.js";
import { focusSavedElement, saveFocusedElement } from "../../services/focus.js";
import froca from "../../services/froca.js";
import { t } from "../../services/i18n.js";
import server from "../../services/server.js";
import { isIMEComposing } from "../../services/shortcuts.js";
import utils from "../../services/utils.js";
import BasicWidget from "../basic_widget.js";
import NoteContextAwareWidget from "../note_context_aware_widget.js";
import { Badge, BadgeWithDropdown } from "../react/Badge.jsx";
import Button from "../react/Button.jsx";
import FormAutocomplete, { AUTOCOMPLETE_DROPDOWN_SELECTOR } from "../react/FormAutocomplete.jsx";
import FormDropdownList from "../react/FormDropdownList.jsx";
import { FormDropdownDivider, FormListItem } from "../react/FormList.jsx";
import FormTextBox, { FormTextBoxWithUnit } from "../react/FormTextBox.jsx";
import HelpTooltipButton from "../react/HelpTooltipButton.jsx";
import { suspendModalFocusTraps } from "../react/modal_focustrap.js";
import NoteAutocomplete from "../react/NoteAutocomplete.jsx";
import NoteLink, { NewNoteLink } from "../react/NoteLink.jsx";
import { disposeReactWidget, ParentComponent, renderReactWidgetAtElement } from "../react/react_utils.jsx";
import OptionsRow, { OptionsRowWithToggle } from "../type_widgets/options/components/OptionsRow.jsx";
import { ATTR_HELP, AttrHelpEntry } from "./attr_help.js";
import LabelValueInput, { getTypedInputForLabel } from "./label_value_input.js";
import ValuesInput from "./values_input.jsx";

export interface AttributeDetailOpts {
    allAttributes?: Attribute[];
    attribute: Attribute;
    isOwned: boolean;
    x: number;
    y: number;
    focus?: "name";
    /**
     * The element the popup was spawned from. Mouse presses inside it do not dismiss the
     * popup, leaving the spawning widget free to swap the shown attribute on click.
     */
    parent?: HTMLElement;
    hideMultiplicity?: boolean;
    /**
     * Places the popup beside this element instead of at `x`/`y`. For hosts whose attributes are shown
     * far from the note attributes pane the coordinates are otherwise resolved against, e.g. the
     * attributes panel in the right pane.
     */
    anchor?: HTMLElement;
}

/**
 * Transitional adapter keeping the legacy widget contract (`showAttributeDetail()`/`hide()`)
 * while the actual UI is progressively ported to the {@link AttributeDetail} Preact component.
 * Will be removed once the consumers can render the component directly.
 */
export default class AttributeDetailWidget extends NoteContextAwareWidget {
    private opts: AttributeDetailOpts | null = null;

    doRender() {
        // No initial renderComponent() here: doRender() runs synchronously inside the
        // parent's render phase (via useLegacyWidget's useMemo), and a nested Preact
        // render() there corrupts the outer component's hook state.
        this.$widget = $("<div>");
    }

    async refresh() {
        // switching note/tab should close the widget
        this.hide();
    }

    async noteSwitched() {
        this.hide();
    }

    showAttributeDetail(opts: AttributeDetailOpts) {
        if (!opts.attribute) {
            // the attribute can be null at runtime, e.g. when the editor content fails to parse
            this.hide();
            return;
        }

        this.opts = opts;
        // The widget has no note context, so isEnabled() is falsy and render()
        // stamps the container with hidden-int; visibility is driven manually,
        // exactly like the legacy widget did. The container must be visible
        // before rendering: the positioning layout effect runs synchronously
        // inside renderComponent() and needs to measure the popup.
        this.toggleInt(true);
        this.renderComponent();
    }

    hide() {
        this.opts = null;
        this.renderComponent();
        this.toggleInt(false);
    }

    cleanup() {
        disposeReactWidget(this.$widget[0]);
    }

    private async cancelAndClose() {
        await this.triggerCommand("reloadAttributes");

        this.hide();
    }

    private async saveAndClose() {
        await this.triggerCommand("saveAttributes");

        this.hide();
    }

    private async deleteAndClose() {
        await this.triggerCommand("updateAttributeList", {
            // the popup edits the very attribute object it was handed, so identity
            // is what identifies the attribute to remove
            attributes: (this.opts?.allAttributes ?? []).filter((attr) => attr !== this.opts?.attribute)
        });

        await this.triggerCommand("saveAttributes");

        this.hide();
    }

    private renderComponent() {
        renderReactWidgetAtElement(
            this,
            <AttributeDetail
                opts={this.opts}
                currentNoteId={this.noteId}
                onDismiss={() => this.hide()}
                onCancel={() => this.cancelAndClose()}
                onAttributesChanged={(attributes) => this.triggerCommand("updateAttributeList", { attributes })}
                onSaveAndClose={() => this.saveAndClose()}
                onDelete={() => this.deleteAndClose()}
            />,
            this.$widget[0]);
    }
}

export interface AttributeDetailProps extends AttributeFormCallbacks {
    /** The attribute to show; `null` keeps the popup closed. A different attribute is a new show. */
    opts: AttributeDetailOpts | null;
    /** The note being viewed, excluded from the related notes list. */
    currentNoteId?: string | null;
    /** Plain close, e.g. on click outside the popup. */
    onDismiss: () => void;
}

/**
 * The attribute detail popup: a floating editor for one attribute, positioned at the coordinates in
 * {@link AttributeDetailProps.opts}. Render it unconditionally and drive it through `opts`.
 */
export function AttributeDetail({ opts, currentNoteId, onDismiss, onCancel, ...formCallbacks }: AttributeDetailProps) {
    const popupRef = useRef<HTMLDivElement>(null);
    const parentComponent = useContext(ParentComponent);
    const shown = !!opts;
    const { onSaveAndClose } = formCallbacks;

    // The form is keyed on this counter, so it is remounted and reseeded whenever the popup is shown
    // something other than what it already holds. Being handed the same attribute over again is not
    // that (see isSameShow): a row pressed a second time would otherwise tear the form down and
    // fetch the related notes afresh, which is seen as the popup flickering.
    const showCount = useRef(0);
    const lastOpts = useRef<AttributeDetailOpts | null>(null);
    const isNewShow = !isSameShow(lastOpts.current, opts);
    lastOpts.current = opts;

    if (isNewShow) {
        showCount.current++;

        if (opts) {
            // Deliberately captured while rendering: an effect would run after the form has
            // mounted and possibly focused its name field, recording that instead.
            saveFocusedElement();
        }
    }

    /** Closes discarding the pending edits, returning focus where it was before the popup opened. */
    function cancel() {
        onCancel();
        focusSavedElement();
    }

    function saveAndClose() {
        onSaveAndClose?.();
        focusSavedElement();
    }

    // Positioning needs the popup's rendered size, so it runs after the DOM is
    // built but before paint.
    useLayoutEffect(() => {
        const popup = popupRef.current;
        if (!popup || !opts) {
            return;
        }

        // Classic-layout coordinates are relative to the hosting widget, mirroring how the
        // legacy widget resolved its own parent in the component tree.
        const hostWidget = parentComponent instanceof BasicWidget ? parentComponent : null;
        const reposition = () =>
            positionPopup(popup, opts, hostWidget?.$widget?.offset() ?? { top: 0, left: 0 });
        reposition();

        // The placement holds only for the size it measured, and editing changes that size — a
        // select definition grows a row per option — so the popup is re-placed as it resizes,
        // sliding back on screen instead of pushing its lower controls past the viewport edge.
        // Settles because re-placing an unchanged size sets the very same styles.
        const resizeObserver = new ResizeObserver(reposition);
        resizeObserver.observe(popup);
        return () => resizeObserver.disconnect();
    }, [ opts, parentComponent ]);

    // Dismiss on click outside the popup, except in floating UI logically belonging
    // to it (autocomplete dropdowns and context menus are appended to the body).
    // Unlike the legacy widget, the listener only exists while the popup is shown.
    const spawner = opts?.parent;
    useEffect(() => {
        if (!shown) {
            return;
        }

        const onMouseDown = (e: MouseEvent) => {
            if (!(e.target instanceof Element)
                || popupRef.current?.contains(e.target)
                // The spawning widget decides for itself on click whether to show another
                // attribute or close; dismissing here first would hide and immediately
                // re-show the popup, which reads as a flicker.
                || spawner?.contains(e.target)
                // Modals count as belonging to the popup: creating a note straight from the target
                // note field opens the note type chooser, and dismissing on its clicks would tear
                // the popup down before the created note could be filled in. The type menu belongs
                // to it too: it is portaled to the body (see the dropdown's `portalToBody`), so a
                // press on one of its items lands outside the popup element.
                || e.target.closest(`${AUTOCOMPLETE_DROPDOWN_SELECTOR}, .algolia-autocomplete, #context-menu-container, .modal, .modal-backdrop, .attr-input-label-type`)) {
                return;
            }
            onDismiss();
        };

        window.addEventListener("mousedown", onMouseDown);
        return () => window.removeEventListener("mousedown", onMouseDown);
    }, [ shown, spawner, onDismiss ]);

    // The popup is rendered outside whatever modal it was opened from (its host portals it to the body,
    // and a modal counts as belonging to it — see above), which Bootstrap's focus-trap would otherwise
    // keep pulling focus back out of, leaving the fields unusable. Suspended while the popup is shown.
    useEffect(() => {
        if (!shown) {
            return;
        }

        return suspendModalFocusTraps();
    }, [ shown ]);

    if (!opts) {
        return null;
    }

    const attrType = getAttrType(opts.attribute);

    return (
        <div
            ref={popupRef}
            class="attr-detail tn-tool-dialog"
            // Handled here rather than through the shortcut service so the keys stay scoped
            // to the popup subtree and unbind with it.
            onKeyDown={(e) => {
                if (isIMEComposing(e)) {
                    return;
                }

                if (e.key === "Escape") {
                    e.stopPropagation();
                    cancel();
                } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    e.stopPropagation();
                    saveAndClose();
                }
            }}
        >
            <AttributeForm
                key={showCount.current}
                opts={opts}
                attrType={attrType}
                currentNoteId={currentNoteId}
                {...formCallbacks}
                onCancel={cancel}
                onSaveAndClose={onSaveAndClose && saveAndClose}
            />
        </div>
    );
}

/**
 * Whether the popup is being shown what it is already showing. The form seeds its fields from the
 * attribute once and is remounted to seed them again, so two shows whose fields would come out the
 * same are one show — however many objects the host built along the way, which is more than one:
 * the attributes editor re-parses its text on every press and the inherited list builds a fresh
 * attribute per press, so identity says a great deal less here than the values do.
 *
 * A show asking for the focus is always a new one. It is asking to be acted upon, and mounting is
 * the only time the form acts on it — but only where it is genuinely being asked again: the very
 * same request handed back is the host re-rendering around a popup it has not touched, which every
 * keystroke does (the name typed into the form is reported straight back out to it).
 */
export function isSameShow(previous: AttributeDetailOpts | null, next: AttributeDetailOpts | null) {
    if (!previous || !next) {
        return previous === next;
    }

    if (previous === next) {
        return true;
    }

    return !next.focus
        && previous.isOwned === next.isOwned
        && previous.hideMultiplicity === next.hideMultiplicity
        && previous.attribute.noteId === next.attribute.noteId
        && previous.attribute.type === next.attribute.type
        && previous.attribute.name === next.attribute.name
        && previous.attribute.value === next.attribute.value
        && !!previous.attribute.isInheritable === !!next.attribute.isInheritable;
}

interface AttributeFormCallbacks {
    /** Close discarding unsaved changes (close button, escape). */
    onCancel: () => void;
    /** Reports the edited attribute list back to the spawning widget, which re-renders from it. */
    onAttributesChanged?: (attributes: Attribute[]) => void;
    /** Omitted for read-only popups, which show no save or delete button. */
    onSaveAndClose?: () => void;
    onDelete?: () => void;
}

/**
 * The editable part of the popup, and of whatever else edits an attribute — a pane of a master-detail
 * modal shows the same form, having no room to float one over itself. Remounted per show (keyed on
 * `showId`) so the field state is simply seeded from the attribute instead of being synchronized to it
 * on every change.
 */
export function AttributeForm({ opts, attrType: initialAttrType, currentNoteId, onCancel, onAttributesChanged, onSaveAndClose, onDelete }: AttributeFormCallbacks & {
    opts: AttributeDetailOpts;
    attrType: AttrType;
    currentNoteId?: string | null;
}) {
    const { attribute, allAttributes, isOwned, focus } = opts;
    // Held rather than read from the attribute, which the popup can change the kind of: a definition
    // switched between holding a value and pointing at a note is renamed in place, and the spawning
    // widget the kind would otherwise be resolved by does not re-render the popup.
    const [ attrType, setAttrType ] = useState(initialAttrType);
    // Definitions describe the attribute they define, so they complete against its own type.
    const nameType = attrType === "relation" || attrType === "relation-definition" ? "relation" : "label";
    const suggestAttributeNames = useCallback((query: string) => fetchAttributeNames(nameType, query), [ nameType ]);
    const renderNameSuggestion = useCallback(
        (suggestion: string) => <AttributeNameSuggestion type={nameType} name={suggestion} />, [ nameType ]);
    // Whatever a relation is the inverse of is itself a relation.
    const suggestRelationNames = useCallback((query: string) => fetchAttributeNames("relation", query), []);
    const renderRelationSuggestion = useCallback(
        (suggestion: string) => <AttributeNameSuggestion type="relation" name={suggestion} />, []);
    const [ name, setName ] = useState(() => stripDefinitionPrefix(attribute.name, attrType));
    const [ value, setValue ] = useState(attribute.value ?? "");
    const [ isInheritable, setIsInheritable ] = useState(!!attribute.isInheritable);
    const [ definition, setDefinition ] = useState(() => parseDefinition(attribute, attrType));
    const nameRef = useRef<HTMLInputElement>(null);
    /**
     * A system label whose value has a kind of its own is typed into the field that fits it — a palette
     * for `#color`, a date picker for `#startDate`, a dropdown of the choices for `#sortDirection`. The
     * rest keep the autocomplete, which is worth more to them than a plain box would be: it offers the
     * values the name has been given before.
     */
    const typedInput = useMemo(() => {
        if (attrType !== "label") {
            return undefined;
        }
        const labelType = getTypedInputForLabel(getBuiltinLabelValueType(name));
        // The options belong to the name, not to a definition the user wrote, so they are read from the
        // same place the type came from rather than passed in.
        return labelType && { labelType, selectOptions: getBuiltinLabelSelectOptions(name) };
    }, [ attrType, name ]);
    // The values known for a label name never change while the popup is open, so they are fetched
    // once per name and filtered locally afterwards.
    const knownValues = useRef<{ name: string; values: string[] }>();
    const suggestLabelValues = useCallback(async (query: string) => {
        if (!name.trim()) {
            return [];
        }

        if (knownValues.current?.name !== name) {
            knownValues.current = {
                name,
                values: await server.get<string[]>(`attribute-values/${encodeURIComponent(name)}`)
            };
        }

        const term = query.toLowerCase();
        return knownValues.current.values.filter((value) => value.toLowerCase().includes(term));
    }, [ name ]);
    // Committing mid-composition makes the spawning editor re-render and swallow the
    // characters being composed: https://github.com/zadam/trilium/pull/3812
    const isComposing = useRef(false);
    const nameHelp = lookupAttributeHelp(attrType, name);
    const isSystem = isSystemAttribute(attrType, name);

    useEffect(() => {
        if (focus === "name") {
            nameRef.current?.focus();
            nameRef.current?.select();
        }
    }, [ focus ]);

    // The attribute object is shared with the spawning widget: it is edited in place so that
    // its identity survives, which is how the delete path recognizes it.
    function commitName(newName: string) {
        // invalid characters are simply ignored (from the user's perspective they are not even entered)
        const filteredName = utils.filterAttributeName(newName);

        setName(filteredName);
        attribute.name = addDefinitionPrefix(filteredName, attrType);
        onAttributesChanged?.(allAttributes ?? []);
    }

    function commitValue(newValue: string) {
        setValue(newValue);
        attribute.value = newValue;
        onAttributesChanged?.(allAttributes ?? []);
    }

    /** Definitions keep their settings serialized in the value, so any change rebuilds the whole thing. */
    function commitDefinition(changes: Partial<DefinitionObject>, kind = attrType) {
        const newDefinition = { ...definition, ...changes };

        setDefinition(newDefinition);
        attribute.value = promotedAttributeDefinitionParser.serialize(
            newDefinition, kind === "label-definition" ? "label" : "relation");
        onAttributesChanged?.(allAttributes ?? []);
    }

    /**
     * What a definition sets up is a field, and pointing at a note is one more kind of field to the eye
     * that reads the form — so the two kinds of definition are offered as two values of one type rather
     * than as two things. What tells them apart underneath is the name they are stored under, `label:foo`
     * against `relation:foo`, and the settings the value carries: a label type against an inverse.
     */
    function commitDefinitionType(type: string) {
        const isRelation = type === RELATION_DEFINITION_TYPE;
        const newAttrType = isRelation ? "relation-definition" : "label-definition";

        setAttrType(newAttrType);
        attribute.name = addDefinitionPrefix(name, newAttrType);
        // The label type is kept in the definition while the popup is open, so switching to a relation
        // and back leaves the field as it was rather than back at the default.
        commitDefinition(isRelation ? {} : { labelType: type as LabelType }, newAttrType);
    }

    // A relation stores the target note's id as its value; clearing the field clears the target.
    const commitTargetNote = useCallback((targetNoteId?: string) => {
        attribute.value = targetNoteId ?? "";
        onAttributesChanged?.(allAttributes ?? []);
    }, [ attribute, allAttributes, onAttributesChanged ]);

    return (
        <>
            <div class="attr-detail-header">
                <h5 class="attr-detail-title">{attrType ? ATTR_TITLES[attrType] : ""}</h5>

                {/* Beside the related-notes badge rather than by the name field, for the same reason: a
                    mark that comes and going as the name is typed would resize the popup under the
                    pointer. The help button by the field explains what a name does; this says the name
                    is Trilium's at all, which most system attributes have no explanation to say for
                    them. */}
                {isSystem && (
                    <Badge
                        outline
                        className="attr-detail-system-badge"
                        text={t("attribute_names.system")}
                        tooltip={t("attribute_names.system_description")}
                    />
                )}

                {/* Sits in the header, and not in a section of its own, so that the popup keeps the size it
                    was positioned at: the lookup behind it is asynchronous and re-runs as the attribute is
                    edited, and a block coming and going below the form would resize the popup under the
                    pointer. */}
                <RelatedNotesBadge attribute={attribute} currentNoteId={currentNoteId} />

                <button
                    class="close-attr-detail-button icon-action bx bx-x"
                    title={t("attribute_detail.close_button_title")}
                    onClick={onCancel}
                />
            </div>

            {!isOwned && attribute.noteId && (
                <div class="attr-is-owned-by">
                    {/* TODO: the attribute type is not translated, as in the widget this was ported from. */}
                    {attribute.type === "label" ? "Label" : "Relation"}
                    {` ${t("attribute_detail.is_owned_by_note")} `}
                    <NoteLink notePath={attribute.noteId} />
                </div>
            )}

            <div class="attr-edit-rows">
                <OptionsRow name="attr-name" label={t("attribute_detail.name")}>
                    <AttributeNameField
                        help={nameHelp}
                        className="attr-input-name"
                        inputRef={nameRef}
                        currentValue={name}
                        readOnly={!isOwned}
                        source={suggestAttributeNames}
                        renderItem={renderNameSuggestion}
                        openOnFocus
                        onChange={(newName) => isComposing.current ? setName(newName) : commitName(newName)}
                        onCompositionStart={() => isComposing.current = true}
                        onCompositionEnd={(e) => {
                            isComposing.current = false;
                            commitName(e.currentTarget.value);
                        }}
                    />
                </OptionsRow>

                {attrType === "relation" && (
                    <OptionsRow
                        name="attr-target-note"
                        label={t("attribute_detail.target_note")}
                        description={t("attribute_detail.target_note_title")}
                    >
                        <NoteAutocomplete
                            noteId={attribute.value || undefined}
                            readOnly={!isOwned}
                            opts={TARGET_NOTE_OPTS}
                            noteIdChanged={commitTargetNote}
                        />
                    </OptionsRow>
                )}

                {attrType === "label" && (
                    <OptionsRow name="attr-value" label={t("attribute_detail.value")}>
                        {typedInput ? (
                            <TypedValueField isSelect={typedInput.labelType === "select"}>
                                <LabelValueInput
                                    labelType={typedInput.labelType}
                                    selectOptions={typedInput.selectOptions}
                                    value={value}
                                    onCommit={commitValue}
                                    inputProps={{
                                        className: "form-control attr-input-value",
                                        readOnly: !isOwned,
                                        // Names the dropdown's empty entry, which would otherwise be a
                                        // blank row one has to guess the meaning of. Only for a select:
                                        // for the typed boxes it would override the placeholder the
                                        // field sets for itself.
                                        ...(typedInput.labelType === "select" && {
                                            placeholder: t("promoted_attributes.unset-field-placeholder")
                                        })
                                    }}
                                />
                            </TypedValueField>
                        ) : (
                            <FormAutocomplete
                                className="attr-input-value"
                                currentValue={value}
                                readOnly={!isOwned}
                                source={suggestLabelValues}
                                openOnFocus
                                onChange={(newValue) => isComposing.current ? setValue(newValue) : commitValue(newValue)}
                                onCompositionStart={() => isComposing.current = true}
                                onCompositionEnd={(e) => {
                                    isComposing.current = false;
                                    commitValue(e.currentTarget.value);
                                }}
                            />
                        )}
                    </OptionsRow>
                )}

                {/* No description: the values name themselves, and what they do to the field is plain
                    enough once one is picked. */}
                {isDefinition(attrType) && (
                    <OptionsRow name="attr-label-type" label={t("attribute_detail.label_type")}>
                        <FormDropdownList
                            className="attr-input-label-type"
                            // The popup is a scroll container, so an inline menu could only grow by
                            // scrolling the form under itself — and the type list only gets longer.
                            portalToBody
                            values={DEFINITION_TYPES}
                            keyProperty="value"
                            titleProperty="title"
                            iconProperty="icon"
                            dividerBeforeProperty="startsGroup"
                            currentValue={attrType === "relation-definition"
                                ? RELATION_DEFINITION_TYPE
                                : definition.labelType ?? "text"}
                            disabled={!isOwned}
                            onChange={commitDefinitionType}
                        />
                    </OptionsRow>
                )}

                {attrType === "label-definition" && definition.labelType === "number" && (
                    <OptionsRow
                        name="attr-number-precision"
                        label={t("attribute_detail.precision")}
                        description={t("attribute_detail.precision_title")}
                    >
                        <FormTextBoxWithUnit
                            className="attr-input-number-precision"
                            type="number"
                            min={0}
                            unit={t("attribute_detail.digits")}
                            currentValue={definition.numberPrecision?.toString() ?? ""}
                            disabled={!isOwned}
                            onChange={(precision) => commitDefinition({
                                numberPrecision: precision === "" ? undefined : parseInt(precision, 10)
                            })}
                        />
                    </OptionsRow>
                )}

                {attrType === "label-definition" && definition.labelType === "select" && (
                    <OptionsRow
                        name="attr-select-options"
                        label={t("attribute_detail.select_options")}
                        description={t("attribute_detail.select_options_title")}
                    >
                        {/* The same chips the values themselves are edited through elsewhere, only
                            typed free: the options are being invented here, so there is nothing to
                            offer or pick from. */}
                        <ValuesInput
                            labelType="text"
                            values={definition.selectOptions ?? []}
                            disabled={!isOwned}
                            placeholder={t("attribute_detail.select_options_placeholder")}
                            addButtonText={t("attribute_detail.add_option")}
                            removeButtonText={t("attribute_detail.remove_option")}
                            onCommit={(selectOptions) => commitDefinition({ selectOptions })}
                        />
                    </OptionsRow>
                )}

                {attrType === "relation-definition" && (
                    <OptionsRow
                        name="attr-inverse-relation"
                        label={t("attribute_detail.inverse_relation")}
                        description={t("attribute_detail.inverse_relation_title")}
                    >
                        <FormAutocomplete
                            className="attr-input-inverse-relation"
                            currentValue={definition.inverseRelation ?? ""}
                            disabled={!isOwned}
                            source={suggestRelationNames}
                            renderItem={renderRelationSuggestion}
                            openOnFocus
                            onChange={(inverseRelation) => commitDefinition({
                                // A relation name, so the same characters are dropped as in the name field
                                inverseRelation: utils.filterAttributeName(inverseRelation)
                            })}
                        />
                    </OptionsRow>
                )}

                {/* No description: what a display name is needs no explaining. */}
                {isDefinition(attrType) && (
                    <OptionsRow name="attr-promoted-alias" label={t("attribute_detail.promoted_alias")}>
                        <FormTextBox
                            className="attr-input-promoted-alias"
                            currentValue={definition.promotedAlias ?? ""}
                            disabled={!isOwned}
                            onChange={(promotedAlias) => commitDefinition({ promotedAlias })}
                        />
                    </OptionsRow>
                )}

                {/* What is filled in comes first, what is switched on after it, so that the toggles read
                    as one block rather than as interruptions between the fields. */}
                {isDefinition(attrType) && !opts.hideMultiplicity && (
                    <OptionsRowWithToggle
                        name="attr-multiplicity"
                        label={t("attribute_detail.multiplicity")}
                        description={t("attribute_detail.multiplicity_title")}
                        currentValue={definition.multiplicity === "multi"}
                        disabled={!isOwned}
                        onChange={(multiple) => commitDefinition({ multiplicity: multiple ? "multi" : "single" })}
                    />
                )}

                <OptionsRowWithToggle
                    name="attr-inheritable"
                    label={t("attribute_detail.inheritable")}
                    description={t("attribute_detail.inheritable_title")}
                    currentValue={isInheritable}
                    disabled={!isOwned}
                    onChange={(checked) => {
                        setIsInheritable(checked);
                        attribute.isInheritable = checked;
                        onAttributesChanged?.(allAttributes ?? []);
                    }}
                />

                {isDefinition(attrType) && (
                    <OptionsRowWithToggle
                        name="attr-promoted"
                        label={t("attribute_detail.promoted")}
                        description={t("attribute_detail.promoted_title")}
                        currentValue={!!definition.isPromoted}
                        disabled={!isOwned}
                        onChange={(isPromoted) => commitDefinition({ isPromoted })}
                    />
                )}

            </div>

            {isOwned && (
                <div class="attr-save-delete-button-container">
                    <Button
                        className="attr-save-changes-and-close-button"
                        kind="primary"
                        size="small"
                        text={t("attribute_detail.save_and_close_button")}
                        keyboardShortcut="Ctrl+Enter"
                        onClick={() => onSaveAndClose?.()}
                    />

                    <Button
                        className="attr-delete-button"
                        size="small"
                        text={t("attribute_detail.delete")}
                        onClick={() => onDelete?.()}
                    />
                </div>
            )}
        </>
    );
}

/**
 * Wraps the value field in the group that frames it together with the buttons beside it — a colour's
 * picker and its reset, a link's open button — which is what an input group is for.
 *
 * A dropdown is handed straight through instead. It has no buttons to be grouped with, and the themes
 * dress a bare one completely: the group would draw a second frame around it, and, since it blanks the
 * background of the fields inside it so that its own shows through, would take with it the arrow the
 * themes draw on that very background — leaving a dropdown that does not look like one.
 */
function TypedValueField({ isSelect, children }: { isSelect: boolean; children: ComponentChildren }) {
    return isSelect ? <>{children}</> : <div className="input-group">{children}</div>;
}

/**
 * The name field and, for a name Trilium attaches a meaning to, the button explaining what it does. The
 * explanations run to several lines and most names have none, so they are not shown under the field.
 */
function AttributeNameField({ help, ...autocompleteProps }: { help?: AttrHelpEntry } & ComponentProps<typeof FormAutocomplete>) {
    return (
        <div class="attr-name-field">
            {/* The row's label is bound to the field by the id the row hands down, which lands here. */}
            <FormAutocomplete {...autocompleteProps} />
            {help && <HelpTooltipButton {...help} />}
        </div>
    );
}

/**
 * One row of an attribute name completion, marking the names Trilium itself attaches a meaning to.
 * The mark answers what a list of bare names cannot: whether picking one buys behaviour, or is only
 * a name. The inline editor's `#`/`~` completion lists the same names and marks them the same way.
 *
 * Exported, with {@link fetchAttributeNames}, for whatever else completes an attribute name — the
 * attribute panel's in-row creation — so every name box offers the same list the same way.
 */
export function AttributeNameSuggestion({ type, name }: { type: "label" | "relation"; name: string }) {
    return (
        <span class="attr-name-suggestion">
            <span class="attr-name-suggestion-name">{name}</span>
            {isBuiltinAttribute(type, name) && <Badge outline text={t("attribute_names.system")} />}
        </span>
    );
}

/**
 * Whether the attribute being edited is one Trilium reads for itself, and so is marked as such.
 *
 * A definition is excluded on purpose: `label:archived` sets up a field named after a system attribute
 * without being one, and the popup edits it under the stripped name — so the name alone would answer
 * yes where {@link isBuiltinAttribute}, which sees the whole name, answers no.
 */
export function isSystemAttribute(attrType: AttrType, name: string) {
    return (attrType === "label" || attrType === "relation") && isBuiltinAttribute(attrType, name);
}

/** Normalised so that the shorthand entries, which are the description alone, read like the rest. */
export function lookupAttributeHelp(attrType: AttrType, name: string): AttrHelpEntry | undefined {
    const entry = attrType ? ATTR_HELP[attrType]?.[name] : undefined;
    return typeof entry === "string" ? { description: entry } : entry;
}

/** Constant so it does not re-initialise the autocomplete on every render. */
const TARGET_NOTE_OPTS = { allowCreatingNotes: true };

/**
 * The value standing for a definition that points at a note rather than holding a value of its own.
 * Not a label type: it is what the definition is named after, `relation:foo` rather than `label:foo`.
 */
export const RELATION_DEFINITION_TYPE = "relation";

/** Exported so that hosts listing definitions can name their label type as the popup does. */
export const LABEL_TYPES = [
    { value: "text", title: t("attribute_detail.text"), icon: "bx bx-text" },
    { value: "textarea", title: t("attribute_detail.textarea"), icon: "bx bx-align-left" },
    { value: "number", title: t("attribute_detail.number"), icon: "bx bx-hash" },
    { value: "boolean", title: t("attribute_detail.boolean"), icon: "bx bx-toggle-left" },
    { value: "select", title: t("attribute_detail.select_type"), icon: "bx bx-list-ul" },
    { value: "date", title: t("attribute_detail.date"), icon: "bx bx-calendar" },
    { value: "datetime", title: t("attribute_detail.date_time"), icon: "bx bx-calendar-event" },
    { value: "time", title: t("attribute_detail.time"), icon: "bx bx-time" },
    { value: "url", title: t("attribute_detail.url"), icon: "bx bx-link" },
    { value: "email", title: t("attribute_detail.email"), icon: "bx bx-envelope" },
    { value: "phone", title: t("attribute_detail.phone"), icon: "bx bx-phone" },
    { value: "color", title: t("attribute_detail.color_type"), icon: "bx bx-palette" }
];

/**
 * What a definition can set its field up to hold, the note it can point at instead included. The last
 * of them is set apart: the others only decide which field the value is typed into, while this one
 * decides what the attribute is, renaming it and leaving whatever was filled in under the old name.
 *
 * Exported so that hosts listing definitions can show them by the same icon the popup edits them with.
 */
export const DEFINITION_TYPES: { value: string; title: string; icon: string; startsGroup?: boolean }[] = [
    ...LABEL_TYPES,
    {
        value: RELATION_DEFINITION_TYPE,
        title: t("attribute_detail.relation_type"),
        icon: "bx bx-transfer",
        startsGroup: true
    }
];

export function fetchAttributeNames(type: "label" | "relation", query: string) {
    return server.get<string[]>(`attribute-names/?type=${type}&query=${encodeURIComponent(query)}`);
}

function isDefinition(attrType: AttrType) {
    return attrType === "label-definition" || attrType === "relation-definition";
}

function parseDefinition(attribute: Attribute, attrType: AttrType): DefinitionObject {
    return isDefinition(attrType) ? promotedAttributeDefinitionParser.parse(attribute.value || "") : {};
}

const DISPLAYED_NOTES = 10;
/** Edits keep arriving while typing, so the lookup waits for a pause instead of running per keystroke. */
const RELATED_NOTES_DEBOUNCE_MS = 1000;

interface SearchRelatedResponse {
    // TODO: Deduplicate once we split client from server.
    results: {
        noteId: string;
        notePathArray: string[];
    }[];
    count: number;
}

interface RelatedNotesResult {
    /** The first {@link DISPLAYED_NOTES} other notes carrying the attribute, by best path. */
    notes: { notePath: string; icon: string; title: string }[];
    /** How many notes other than the current one carry the attribute, however many of them are listed. */
    otherCount: number;
}

/**
 * How many notes carry the same attribute, listing them on click. The count alone answers the question
 * the popup cannot otherwise: whether the name being typed is one already in use somewhere, or a new one
 * (which, mid-edit, usually means a typo).
 */
function RelatedNotesBadge({ attribute, currentNoteId }: { attribute: Attribute; currentNoteId?: string | null }) {
    const [ related, setRelated ] = useState<RelatedNotesResult>();
    const latestRequest = useRef(0);
    const isInitialLookup = useRef(true);
    const { type, name, value } = attribute;

    useEffect(() => {
        const requestId = ++latestRequest.current;

        async function lookup() {
            const { results, count } = await server.post<SearchRelatedResponse>("search-related", attribute);
            const otherNotes = results.filter((result) => result.notePathArray.at(-1) !== currentNoteId);
            const notes = await froca.getNotes(otherNotes
                .slice(0, DISPLAYED_NOTES)
                .map((result) => result.notePathArray.at(-1) ?? ""));

            // A newer edit superseded this lookup while it was awaiting.
            if (latestRequest.current !== requestId) {
                return;
            }

            const hoistedNoteId = appContext.tabManager.getActiveContext()?.hoistedNoteId;
            setRelated({
                notes: notes.map((note) => ({
                    notePath: note.getBestNotePathString(hoistedNoteId),
                    icon: note.getIcon(),
                    title: note.title
                })),
                // The server counts every match, the current note included, but only returns the first
                // twenty of them — so past twenty matches, a current note that did not make the cut leaves
                // the count one too high. Being out by one is immaterial at that size.
                otherCount: Math.max(count - (otherNotes.length < results.length ? 1 : 0), 0)
            });
        }

        // The attribute the popup opened on is looked up right away; later edits are debounced.
        if (isInitialLookup.current) {
            isInitialLookup.current = false;
            void lookup();
            return;
        }

        const timeout = setTimeout(() => void lookup(), RELATED_NOTES_DEBOUNCE_MS);
        return () => clearTimeout(timeout);
        // `attribute` is edited in place, so its fields rather than its identity are the real inputs.
    }, [ type, name, value, currentNoteId ]); // eslint-disable-line react-hooks/exhaustive-deps

    // Nothing at all until the first lookup lands, rather than a placeholder: the badge shares its row with
    // the title and the close button, so it can appear without moving anything around it.
    if (!related) {
        return null;
    }

    if (!related.otherCount) {
        return (
            <Badge
                className="related-notes-badge"
                outline
                text={t("attribute_detail.no_other_notes")}
                tooltip={t("attribute_detail.no_other_notes_title", { attributeType: type, attributeName: name })}
            />
        );
    }

    // On a phone the list is a bottom-sheet menu, as everything a thumb presses opens one: the
    // dropdown is nested in what is a sliding pane of the note attributes modal there, whose
    // scroll containers and slide transforms clip and misplace it. No tooltip — nothing hovers.
    if (IS_MOBILE) {
        return (
            <Badge
                className="related-notes-badge"
                icon="bx bx-file"
                text={t("attribute_detail.other_notes_count", { count: related.otherCount })}
                onClick={(e) => showRelatedNotesMenu(e, related, attribute)}
            />
        );
    }

    return (
        <BadgeWithDropdown
            className="related-notes-badge"
            icon="bx bx-file"
            text={t("attribute_detail.other_notes_count", { count: related.otherCount })}
            tooltip={t("attribute_detail.other_notes_with_name", { attributeType: type, attributeName: name })}
            // The menu stays nested in the popup: the badge places it with `position: fixed`, and the popup
            // sets `contain: none` and no transform, so it is not a containing block and does not clip it.
            dropdownOptions={{ dropdownContainerClassName: "related-notes-menu" }}
        >
            {/* The icon comes from the item rather than from the link, so that the note entries and the
                search entry below them line up on the same slot. */}
            {related.notes.map(({ notePath, icon }) => (
                <FormListItem key={notePath} icon={icon}>
                    <NewNoteLink notePath={notePath} noPreview />
                </FormListItem>
            ))}

            <FormDropdownDivider />

            <FormListItem
                icon="bx bx-search-alt"
                onClick={() => void appContext.triggerCommand("searchNotes", { searchString: formatAttributeForSearch(attribute) })}
            >{t("attribute_detail.show_all_in_search")}</FormListItem>
        </BadgeWithDropdown>
    );
}

/** Whether the badge opens a menu rather than a dropdown, read once: it does not change under the app. */
const IS_MOBILE = utils.isMobile();

/**
 * The related notes as the bottom-sheet menu the phone presents its menus in (the context menu
 * service puts it there itself, behind a cover). One entry per note, and the search entry after
 * them, exactly as the desktop dropdown lists them. Navigating needs no closing of its own:
 * setNote closes the active dialog, the note attributes modal included, and searchNotes
 * navigates to the search note the same way.
 */
export function showRelatedNotesMenu(e: MouseEvent, related: RelatedNotesResult, attribute: Attribute) {
    const items: MenuItem<string>[] = [
        // The title is HTML to the menu, which the note's title is not.
        ...related.notes.map(({ notePath, icon, title }) => ({
            title: utils.escapeHtml(title),
            uiIcon: icon,
            handler: () => void appContext.tabManager.getActiveContext()?.setNote(notePath)
        })),
        { kind: "separator" as const },
        {
            title: t("attribute_detail.show_all_in_search"),
            uiIcon: "bx bx-search-alt",
            handler: () => void appContext.triggerCommand("searchNotes", { searchString: formatAttributeForSearch(attribute) })
        }
    ];

    // The coordinates go unused at the bottom of the screen, where the menu is placed on a phone.
    void contextMenu.show({
        x: e.pageX,
        y: e.pageY,
        items,
        selectMenuItemHandler: () => {}
    });
}

/** The query for every note carrying the attribute, mirroring the name-only search behind the count. */
export function formatAttributeForSearch({ type, name }: Attribute) {
    // Names are filtered as they are typed, so there is nothing in one that would need quoting.
    return `${type === "label" ? "#" : "~"}${name}`;
}

/**
 * The two kinds of definition share a title: which of them it is now being one of the values of the
 * type below, a title naming it too would say it twice and would rename the popup as the type is
 * changed — while what the title is for is the distinction the form cannot show, between a value this
 * note carries and a declaration of what the attribute it names is for.
 */
const ATTR_TITLES: Record<string, string> = {
    label: t("attribute_detail.label"),
    "label-definition": t("attribute_detail.definition"),
    relation: t("attribute_detail.relation"),
    "relation-definition": t("attribute_detail.definition")
};

const isNewLayout = isExperimentalFeatureEnabled("new-layout");

export function positionPopup(popup: HTMLElement, { x, y, anchor }: AttributeDetailOpts, parentOffset: { top: number; left: number }) {
    const outerWidth = popup.offsetWidth;
    const outerHeight = popup.offsetHeight;
    const windowHeight = document.documentElement.clientHeight;

    if (!outerWidth || !outerHeight || !windowHeight) {
        console.warn("Can't position popup, is it attached?");
        return;
    }

    if (anchor) {
        positionPopupBesideAnchor(popup, anchor);
    } else if (isNewLayout) {
        // The popup always sits above the note attributes pane so it never covers it;
        // when the pane is closed (e.g. opened from the collection column editor),
        // it docks to the status bar instead.
        const attrPane = document.querySelector(".bottom-panel.attribute-list");
        const paneShown = attrPane instanceof HTMLElement && !attrPane.classList.contains("hidden-ext");
        const anchorTop = paneShown
            ? attrPane.getBoundingClientRect().top
            : document.body.clientHeight - (document.querySelector<HTMLElement>(".component.status-bar")?.offsetHeight ?? 0);

        // Centered on the click, clamped to the viewport. Deliberately not using
        // getDetailPosition(): its legacy right-pin quirk reads as a plain 0 here,
        // which kept the popup flush left regardless of the click position.
        const windowWidth = document.documentElement.clientWidth;
        const left = Math.max(Math.min(x - outerWidth / 2, windowWidth - outerWidth - 10), 10);

        popup.style.left = `${left}px`;
        popup.style.right = "";
        popup.style.top = "unset";
        popup.style.bottom = `${document.body.clientHeight - anchorTop}px`;
        popup.style.maxHeight = `${anchorTop}px`;
    } else {
        const detPosition = getDetailPosition(x, parentOffset.left, outerWidth);

        popup.style.left = toCssPos(detPosition.left);
        popup.style.right = toCssPos(detPosition.right);
        popup.style.top = `${y - parentOffset.top + 70}px`;
        popup.style.bottom = "";
        // `>=` so that re-placing a popup already at the cap keeps the cap: with `>` it would
        // un-cap, grow, and be capped again by the resize-driven re-placement, ping-ponging forever.
        popup.style.maxHeight = outerHeight + y >= windowHeight - 50 ? `${windowHeight - y - 50}px` : "10000px";
    }
}

/** How far the popup stays from its anchor, and from the edges of the viewport. */
const ANCHOR_GAP = 8;
const VIEWPORT_MARGIN = 10;

/**
 * Beside the anchor rather than over it: the hosts that anchor sit against an edge of the viewport
 * (the right pane), so the popup takes whichever side of the anchor has the room for it.
 */
function positionPopupBesideAnchor(popup: HTMLElement, anchor: HTMLElement) {
    const anchorRect = anchor.getBoundingClientRect();
    const windowWidth = document.documentElement.clientWidth;
    const windowHeight = document.documentElement.clientHeight;

    // Set before measuring the height below, which the cap may well decide.
    popup.style.maxHeight = `${windowHeight - 2 * VIEWPORT_MARGIN}px`;

    const outerWidth = popup.offsetWidth;
    const outerHeight = popup.offsetHeight;
    const left = anchorRect.left >= outerWidth + ANCHOR_GAP + VIEWPORT_MARGIN
        ? anchorRect.left - outerWidth - ANCHOR_GAP
        : Math.min(anchorRect.right + ANCHOR_GAP, windowWidth - outerWidth - VIEWPORT_MARGIN);

    popup.style.left = `${Math.max(left, VIEWPORT_MARGIN)}px`;
    popup.style.right = "";
    // Level with the anchor, slid up as far as needed to stay wholly on screen.
    popup.style.top = `${Math.max(Math.min(anchorRect.top, windowHeight - outerHeight - VIEWPORT_MARGIN), VIEWPORT_MARGIN)}px`;
    popup.style.bottom = "";
}

function getDetailPosition(x: number, offsetLeft: number, outerWidth: number) {
    let left: number | string = x - offsetLeft - outerWidth / 2;
    let right: number | string = "";

    if (left < 0) {
        left = 10;
    } else {
        const rightEdge = left + outerWidth;

        // Kept bug-for-bug from the legacy widget: this compares against the popup's own
        // width instead of the viewport's, so it holds whenever left >= 0 and the popup
        // effectively pins to the right edge except for far-left clicks.
        if (rightEdge > outerWidth - 10) {
            left = "";
            right = 10;
        }
    }

    return { left, right };
}

/** An empty string clears the property, matching the jQuery `.css()` behavior. */
function toCssPos(value: number | string) {
    return typeof value === "number" ? `${value}px` : value;
}

export type AttrType = "label" | "label-definition" | "relation" | "relation-definition" | undefined;

export function getAttrType(attribute: Attribute): AttrType {
    if (attribute.type === "label") {
        // A bare prefix (`#label:`) defines nothing, so it stays an ordinary label — editing it as a
        // definition would only offer a name-less one back.
        if (isDefinitionName(attribute.name)) {
            return attribute.name.startsWith("label:") ? "label-definition" : "relation-definition";
        }
        return "label";
    } else if (attribute.type === "relation") {
        return "relation";
    }
}

/** Definitions are stored prefixed (`label:foo`), but the popup edits the bare name. */
export function stripDefinitionPrefix(name: string, attrType: AttrType) {
    if (attrType === "label-definition") {
        return name.substring("label:".length);
    } else if (attrType === "relation-definition") {
        return name.substring("relation:".length);
    }
    return name;
}

export function addDefinitionPrefix(name: string, attrType: AttrType) {
    if (attrType === "label-definition") {
        return `label:${name}`;
    } else if (attrType === "relation-definition") {
        return `relation:${name}`;
    }
    return name;
}
