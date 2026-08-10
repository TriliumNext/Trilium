import "./AttributeList.css";

import { promotedAttributeDefinitionParser } from "@triliumnext/commons";
import clsx from "clsx";
import { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import FAttribute from "../../entities/fattribute";
import FNote from "../../entities/fnote";
import contextMenu, { MenuItem } from "../../menus/context_menu";
import type { Attribute } from "../../services/attribute_parser";
import attributes, { isBuiltinAttribute } from "../../services/attributes";
import dialog from "../../services/dialog";
import { t } from "../../services/i18n";
import server from "../../services/server";
import { isMobile } from "../../services/utils";
import { AttributeDetail, AttributeDetailOpts, AttributeForm, AttrType, DEFINITION_TYPES, getAttrType, RELATION_DEFINITION_TYPE } from "../attribute_widgets/attribute_detail";
import { ColorChip, renderLabelValue } from "../attribute_widgets/label_value_display";
import ActionButton from "../react/ActionButton";
import { FormListItem } from "../react/FormList";
import { useActiveNoteContext, useTriliumEvent } from "../react/hooks";
import Icon from "../react/Icon";
import { DetailPane, MasterPane, useMasterDetail, useMasterDetailPage } from "../react/master_detail";
import NoItems from "../react/NoItems";
import NoteLink from "../react/NoteLink";
import { ParentComponent } from "../react/react_utils";
import OptionsSection from "../type_widgets/options/components/OptionsSection";
import AttributeCreationEditor from "./AttributeCreationEditor";
import AttributeValueEditor, { resolveValueField } from "./AttributeValueEditor";
import RightPanelWidget, { CollapsibleWidgets } from "./RightPanelWidget";
import SidebarHelp from "./SidebarHelp";

/**
 * The note's attributes as a list, one row per attribute: the kind (label, relation, or either's
 * definition) is carried by an icon instead of by the `#`/`~`/`label:` syntax the attributes editor
 * spells out, and the value is shown as a preview rather than in full. Rows open the same detail
 * form the editor uses, which is where an attribute is actually edited — except an owned attribute's
 * value, the edit that is made again and again: a label's is edited in place by pressing the preview
 * itself, through the field its definition calls for, and a relation's target is repicked from the
 * pencil on its row, the value staying the link it is (see {@link AttributeValueEditor}).
 *
 * The form floats beside its row where there is room for it — a panel with a note's width beside it —
 * and is a page of its own inside a master-detail host (a modal on a phone), which slides it in over
 * the list and heads it with a way back.
 */
export default function AttributeList() {
    const { note } = useActiveNoteContext();
    const { isMasterDetail } = useMasterDetail();
    const parentComponent = useContext(ParentComponent);
    const containerRef = useRef<HTMLDivElement>(null);
    const [ detail, setDetail ] = useState<AttributeDetailOpts | null>(null);
    // The row whose value is being typed straight into it — the in-place alternative to the popup for
    // a label — and the value to put back if the edit is thrown away rather than kept.
    const [ valueEdit, setValueEdit ] = useState<{ attribute: Attribute; original: string } | null>(null);
    // The draft a label or relation is created through in a row of its own, already among the owned
    // rows; un-creating it is taking it back out of them.
    const [ creating, setCreating ] = useState<Attribute | null>(null);
    const componentId = parentComponent?.componentId;

    // The owned rows double as the detail popup's working copy: it edits the very objects it is handed,
    // so both lists are kept in refs (whose identity the popup holds on to) and redrawn by hand.
    const owned = useRef<Attribute[]>([]);
    const inherited = useRef<Attribute[]>([]);
    const internal = useRef<Attribute[]>([]);
    const [ , setRevision ] = useState(0);
    const rerender = () => setRevision((revision) => revision + 1);

    // The draft of the note being left, handed over by the check below for the effect to persist: the
    // note it belongs to is no longer the one the list is showing, so it cannot be saved from here.
    const draftToFlush = useRef<{ noteId: string; attributes: Attribute[] } | null>(null);

    // Collected while rendering rather than in an effect, which would leave one frame listing the
    // attributes of the note navigated away from. The initial `undefined` is what collects the first.
    const shownNoteId = useRef<string | null>();
    if (shownNoteId.current !== (note?.noteId ?? null)) {
        // An attribute left open for editing — in the popup or in its own row — is closed by the
        // change of note, and closing keeps what was typed into it — as a press outside does — rather
        // than dropping it. Which the list cannot do itself once it holds another note's attributes,
        // hence the hand-over. A creation left without a name is the one thing not kept: nameless, it
        // is nothing yet, and the endpoint would refuse it for the whole list's sake.
        if ((detail?.isOwned || valueEdit || creating) && shownNoteId.current) {
            draftToFlush.current = {
                noteId: shownNoteId.current,
                attributes: owned.current.filter((attribute) => attribute.name)
            };
        }

        shownNoteId.current = note?.noteId ?? null;
        owned.current = collectOwned(note);
        inherited.current = collectInherited(note);
        internal.current = collectInternal(note);
    }

    // Every editor works on one attribute of the note being left, so all of them close with the note.
    useEffect(() => {
        setDetail(null);
        setValueEdit(null);
        setCreating(null);

        const draft = draftToFlush.current;
        draftToFlush.current = null;
        if (draft) {
            void persist(draft.noteId, draft.attributes);
        }
    }, [ note ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        // While any editor is open, the changes this widget itself made are skipped: its edits are
        // the freshest state, and reloading over them would discard what is being typed. Once all are
        // closed our own saves count too, which is how the list drops a row the server refused to keep
        // (a relation left without a target note).
        const changed = detail || valueEdit || creating ? loadResults.getAttributeRows(componentId) : loadResults.getAttributeRows();
        if (note && changed.some((attr) => attributes.isAffecting(attr, note))) {
            owned.current = collectOwned(note);
            inherited.current = collectInherited(note);
            internal.current = collectInternal(note);

            // The rebuild replaced the row objects, so an in-place edit over one of the old ones has
            // nothing left to write to; it is dropped rather than left dangling over the fresher state.
            if (valueEdit && !owned.current.includes(valueEdit.attribute)) {
                setValueEdit(null);
            }
            if (creating && !owned.current.includes(creating)) {
                setCreating(null);
            }

            rerender();
        }
    });

    /** Persists the whole draft: the endpoint replaces the note's owned attributes with the list. */
    async function save() {
        if (note) {
            await persist(note.noteId, owned.current);
        }
    }

    /** Named apart from {@link save} so a draft can be saved to the note it belongs to, whichever the
     *  list has moved on to. */
    async function persist(noteId: string, attributes: Attribute[]) {
        await server.put(`notes/${noteId}/attributes`, attributes, componentId);
    }

    function openDetail(attribute: Attribute, isOwned: boolean, anchor: HTMLElement | null, e: MouseEvent) {
        setDetail({
            allAttributes: isOwned ? owned.current : undefined,
            attribute,
            isOwned,
            x: e.pageX,
            y: e.pageY,
            anchor: anchor ?? undefined,
            // Presses on another row swap the shown attribute instead of dismissing the popup first.
            parent: spawningArea()
        });
    }

    /**
     * What the popup treats as the widget it was spawned from: the two sections are separate cards, so
     * it takes in the whole tab holding them, and a row of either swaps the shown attribute rather than
     * dismissing the popup and re-opening it. Falls back to the section itself outside of a tab.
     */
    function spawningArea() {
        return containerRef.current?.closest<HTMLElement>(".right-pane-tab-body") ?? containerRef.current ?? undefined;
    }

    function addAttribute(attrType: AttributeKind, e: MouseEvent) {
        // Whatever was being edited is wrapped up first, the new row taking over from it.
        commit();
        commitValueEdit();
        commitCreation();

        // A plain label or relation is two things — a name and a value — which its own row can take:
        // it is created there, in a nameless draft the creation editor fills in. The popup stays for
        // the definitions, whose settings need the form, and for a phone, which keeps the page flow
        // for every kind.
        if (!IS_MOBILE && (attrType === "label" || attrType === "relation")) {
            const attribute: Attribute = { type: attrType, name: "", value: "", isInheritable: false };

            owned.current = [ ...owned.current, attribute ];
            setCreating(attribute);
            return;
        }

        const attribute = createAttribute(attrType);

        owned.current = [ ...owned.current, attribute ];
        setDetail({
            allAttributes: owned.current,
            attribute,
            isOwned: true,
            x: e.pageX,
            y: e.pageY,
            focus: "name",
            // There is no row to anchor to yet: the attribute only joins the list once it is saved.
            anchor: containerRef.current ?? undefined,
            parent: spawningArea()
        });
    }

    /** Closes the form keeping its edits: a list of rows has no save step of its own. */
    function commit() {
        const isOwned = detail?.isOwned;

        setDetail(null);
        if (isOwned) {
            void save();
        }
    }

    /** Opens the in-place editor over a row's value, taking over from whatever else was being edited. */
    function startValueEdit(attribute: Attribute) {
        if (detail) {
            commit();
        }
        commitCreation();

        // A flag has nothing to type: the press that would open an editor just turns it over, saved
        // at once — the one-toggle edit an editor could only have added a second press to.
        if (note && attribute.type === "label" && resolveValueField(note, attribute.name).labelType === "boolean") {
            attribute.value = attribute.value === "true" ? "false" : "true";
            rerender();
            void save();
            return;
        }

        setValueEdit({ attribute, original: attribute.value ?? "" });
    }

    /** Closes the in-place editor keeping what was typed, saved only where it changed anything. */
    function commitValueEdit() {
        const changed = valueEdit && valueEdit.attribute.value !== valueEdit.original;

        setValueEdit(null);
        if (changed) {
            void save();
        }
    }

    /** Closes the in-place editor putting the value back as it was, saving nothing. */
    function revertValueEdit() {
        if (valueEdit) {
            valueEdit.attribute.value = valueEdit.original;
        }
        setValueEdit(null);
    }

    /**
     * Closes the creation row keeping what it was given — which, still nameless, is nothing: an
     * attribute is its name at the least, so a draft without one is quietly taken back out rather
     * than sent to an endpoint that would refuse the whole list over it.
     */
    function commitCreation() {
        if (!creating) {
            return;
        }

        setCreating(null);
        if (creating.name) {
            void save();
        } else {
            owned.current = owned.current.filter((attribute) => attribute !== creating);
            rerender();
        }
    }

    /** Closes the creation row un-creating its draft, saving nothing. */
    function revertCreation() {
        if (creating) {
            owned.current = owned.current.filter((attribute) => attribute !== creating);
        }
        setCreating(null);
        rerender();
    }

    // A master-detail host heads the page it shows the form on with the attribute's name, and goes back
    // to the list by closing it. Nothing happens outside such a host, where the form is a popup.
    useMasterDetailPage(detail ? getDisplayName(detail.attribute, getAttributeKind(detail.attribute)) : null, commit);

    /**
     * Deleting is a press away in every row, and the row is all there is to tell one attribute from
     * another, so it is confirmed first — from the popup too, which deletes the very same thing.
     */
    async function deleteAttribute(attribute: Attribute) {
        const name = getDisplayName(attribute, getAttributeKind(attribute));
        if (!await dialog.confirm(t("attribute_list_panel.delete_confirm", { name }))) {
            return;
        }

        owned.current = owned.current.filter((candidate) => candidate !== attribute);
        setDetail(null);
        rerender();

        await save();
    }

    const sections = splitIntoSections(owned.current, inherited.current);
    const internalRows = internal.current.map((attribute) => toEntry(attribute, true));
    // Not built for an attribute the list no longer holds: a reload can rebuild the rows out from
    // under the editor within this very render, before the state has caught up (see above).
    const activeValueEdit = valueEdit && owned.current.includes(valueEdit.attribute) ? valueEdit : null;
    const activeCreation = creating && owned.current.includes(creating) ? creating : null;
    // At most one of the two is open — starting either commits the other — and both stand over their
    // row the same way, so they share the one editor slot a row offers.
    const valueEditor = note && activeValueEdit ? {
        attribute: activeValueEdit.attribute,
        element: (
            <AttributeValueEditor
                note={note}
                attribute={activeValueEdit.attribute}
                // Written straight into the row's attribute, as the popup writes its edits; the rows
                // are not redrawn for it, the field itself being the only thing showing the value.
                onEdit={(value) => {
                    activeValueEdit.attribute.value = value;
                }}
                onCommit={commitValueEdit}
                onRevert={revertValueEdit}
            />
        )
    } : note && activeCreation ? {
        attribute: activeCreation,
        element: (
            <AttributeCreationEditor
                note={note}
                attribute={activeCreation}
                onCommit={commitCreation}
                onRevert={revertCreation}
            />
        )
    } : undefined;
    const rowProps = {
        note,
        activeAttribute: detail?.attribute,
        valueEditor,
        onOpen: openDetail,
        onEditValue: startValueEdit,
        onDelete: (attribute: Attribute) => void deleteAttribute(attribute)
    };
    // The cards a section has nothing for are left out, so an ordinary note sees one or two of the four.
    const shownCards = 1
        + (sections.inherited.length ? 1 : 0)
        + (sections.definitions.length ? 1 : 0)
        + (internalRows.length ? 1 : 0);

    // The same callbacks whichever of the two the form is shown in.
    const formCallbacks = {
        // A press outside keeps the edits, matching the attributes editor (which saves on blur); the
        // close button and escape go through onCancel and revert instead.
        onCancel: () => {
            if (note) {
                owned.current = collectOwned(note);
            }
            setDetail(null);
            rerender();
        },
        // The form edits the attribute in place, so there is nothing to apply here: the rows only need
        // to be redrawn to follow along as it is typed into.
        onAttributesChanged: rerender,
        // An inherited attribute is shown read-only, so it has neither of the two.
        onSaveAndClose: detail?.isOwned ? commit : undefined,
        onDelete: detail?.isOwned ? () => void deleteAttribute(detail.attribute) : undefined
    };
    const sectionList = (
        <>
            {/* A card each, so a section is collapsed on its own and the inherited attributes — which a
                template can run to dozens of — can be put away without taking the note's own with them.
                Which is also why the collapsing is offered here rather than left to the tab: the tab
                counts this whole panel as one widget (see RightPanelContainer), being one entry in its
                list. Down to a single card, collapsing it away is not on offer. */}
            <CollapsibleWidgets.Provider value={shownCards > 1}>
                <AttributeSection
                    id="attributes"
                    title={t("attribute_list_panel.owned", { count: sections.owned.length })}
                    grow
                    buttons={note && (
                        <>
                            <SidebarHelp section="attributes" />
                            <AddAttributeButton
                                text={t("attribute_editor.add_a_new_attribute")}
                                attrTypes={ALL_ATTRIBUTE_KINDS}
                                onSelect={addAttribute}
                            />
                        </>
                    )}
                >
                    {/* Presses inside the sections do not dismiss the popup (see `parent` above), which
                        leaves closing on a press next to a row up to this handler. */}
                    {/* The values read from the trailing edge here and in the inherited card below,
                        the two lists of plain attributes reading as one ledger. The definitions keep
                        prose order: their "value" is a summary of settings, not a value. */}
                    <div class="attribute-list-panel align-values-end" ref={containerRef} onClick={commit}>
                        {sections.owned.length > 0 ? (
                            <AttributeRowList rows={sections.owned} {...rowProps} />
                        ) : (
                            <NoItems icon="bx bx-hash" text={t("attribute_list_panel.no_attributes")} />
                        )}

                        {/* Only on a desktop: a phone adds from the header, page flow and all. */}
                        {!IS_MOBILE && note && (
                            <AddAttributeRow onAdd={(e) => addAttribute("label", e)} />
                        )}
                    </div>
                </AttributeSection>

                {sections.inherited.length > 0 && (
                    <AttributeSection
                        id="attributes-inherited"
                        title={t("attribute_list_panel.inherited", { count: sections.inherited.length })}
                        buttons={<SidebarHelp section="attributes-inherited" />}
                    >
                        <div class="attribute-list-panel align-values-end" onClick={commit}>
                            <AttributeRowList rows={sections.inherited} {...rowProps} />
                        </div>
                    </AttributeSection>
                )}

                {sections.definitions.length > 0 && (
                    <AttributeSection
                        id="attributes-definitions"
                        title={t("attribute_list_panel.definitions", { count: sections.definitions.length })}
                        buttons={<>
                            <SidebarHelp section="attributes-definitions" />
                            {note && (
                                <AddAttributeButton
                                    text={t("attribute_list_panel.add_definition")}
                                    attrTypes={DEFINITION_KINDS}
                                    onSelect={addAttribute}
                                />
                            )}
                        </>}
                    >
                        <div class="attribute-list-panel" onClick={commit}>
                            <AttributeRowList rows={sections.definitions} {...rowProps} />
                        </div>
                    </AttributeSection>
                )}

                {internalRows.length > 0 && (
                    <AttributeSection
                        id="attributes-internal"
                        title={t("attribute_list_panel.internal", { count: internalRows.length })}
                    >
                        <div class="attribute-list-panel" onClick={commit}>
                            <AttributeRowList rows={internalRows} readOnly {...rowProps} />
                        </div>
                    </AttributeSection>
                )}
            </CollapsibleWidgets.Provider>
        </>
    );

    // Inside a master-detail host the list and the form are its two panes, which it slides over each
    // other — so they are handed over as siblings rather than nested in a wrapper of ours.
    if (isMasterDetail) {
        return (
            <>
                <MasterPane>{sectionList}</MasterPane>
                <DetailPane className="attribute-detail-page">
                    {detail && (
                        <AttributeForm
                            // Reseeded from whichever attribute the page is showing, the fields being
                            // seeded once per show (see AttributeForm).
                            key={detail.attribute.attributeId ?? "new"}
                            opts={detail}
                            attrType={getAttrType(detail.attribute)}
                            currentNoteId={note?.noteId}
                            {...formCallbacks}
                        />
                    )}
                </DetailPane>
            </>
        );
    }

    return (
        <>
            {sectionList}

            {createPortal(
                <AttributeDetail
                    opts={detail}
                    currentNoteId={note?.noteId}
                    onDismiss={commit}
                    {...formCallbacks}
                />,
                document.body)}
        </>
    );
}

interface AttributeSectionProps {
    /** What the right pane remembers the section by, collapsed state and all. */
    id: string;
    title: string;
    children: ComponentChildren;
    buttons?: ComponentChildren;
    /** Passed on to {@link RightPanelWidget}, which is the only host that has room to give. */
    grow?: boolean;
}

/**
 * One section, drawn as the layout it is in draws a titled group of things: a card of the right pane on
 * a desktop, foldable and remembered as folded; the same card the settings pages are built from on a
 * phone, where the panel is a page of its own and a title is read rather than pressed.
 */
function AttributeSection({ id, title, children, buttons, grow }: AttributeSectionProps) {
    if (IS_MOBILE) {
        // The id names the section here too, as a class: it is what the right pane knows the section by,
        // and there is no reason for a stylesheet (or a test) to know it by anything else.
        return <OptionsSection className={id} title={title} actions={buttons}>{children}</OptionsSection>;
    }

    return (
        <RightPanelWidget id={id} title={title} buttons={buttons} grow={grow}>
            {children}
        </RightPanelWidget>
    );
}

interface AttributeRowListProps {
    rows: AttributeEntry[];
    /** The note the rows belong to, read for the definitions that type their values. */
    note?: FNote | null;
    /** The attribute the detail popup is showing, marked as such in the list. */
    activeAttribute?: Attribute;
    /** The in-place editor over one row's value, shown by that row in the value's place. */
    valueEditor?: { attribute: Attribute; element: ComponentChildren };
    /**
     * The rows stand for attributes Trilium writes and keeps up to date itself, which leaves them
     * nothing to offer: nothing to edit, nothing to delete, no note to name as their source (they are
     * always the current one's), and no split to draw between the note's own names and Trilium's —
     * every one of them is Trilium's, which is what the card they are in says.
     */
    readOnly?: boolean;
    onOpen: (attribute: Attribute, isOwned: boolean, anchor: HTMLElement | null, e: MouseEvent) => void;
    /** Asks for the in-place editor over the attribute's value; wired to editable labels alone. */
    onEditValue: (attribute: Attribute) => void;
    onDelete: (attribute: Attribute) => void;
}

/**
 * One card's worth of rows, in two lists: what the note was given a name for, and below a rule, what
 * Trilium reads for itself. What a row offers follows from whether the note owns its attribute rather
 * than from the card it is in: the definitions card holds the note's own alongside a template's.
 */
function AttributeRowList({ rows, note, activeAttribute, valueEditor, readOnly, onOpen, onEditValue, onDelete }: AttributeRowListProps) {
    function renderRows(group: AttributeEntry[]) {
        return (
            // The rows are menu items on a phone (see AttributeRow), and the theme dresses a menu item
            // through the menu around it — so the list stands in as that menu, the way the other lists
            // of menu items outside a dropdown do (`dropdown-menu static show`, as in the code-note
            // switcher). Static: it opens nowhere and is positioned by nothing.
            <ul class={clsx("attribute-rows", IS_MOBILE && "dropdown-menu tn-dropdown-menu static show")}>
                {group.map(({ attribute, isOwned, isSystem }, index) => (
                    <AttributeRow
                        key={attribute.attributeId ?? `new-${index}`}
                        attribute={attribute}
                        note={note}
                        active={activeAttribute === attribute}
                        valueEditor={valueEditor?.attribute === attribute ? valueEditor.element : undefined}
                        isSystem={isSystem && !readOnly}
                        // An attribute of another note names it; the current note's own would name itself.
                        showOwner={!isOwned && !readOnly}
                        // A read-only row opens the popup as an inherited one does: to be read, not edited.
                        onOpen={(anchor, e) => onOpen(attribute, isOwned && !readOnly, anchor, e)}
                        // A label's value is typed straight into its row, and a relation's target is
                        // repicked in it (from the pencil — the value itself is a link, and stays
                        // one). Definitions, whose value is a summary of settings, keep the popup. On
                        // a phone the row is a menu item and opens its page whole.
                        onEditValue={isOwned && !readOnly && !IS_MOBILE && !isDefinition(getAttributeKind(attribute))
                            ? () => onEditValue(attribute)
                            : undefined}
                        onDelete={isOwned && !readOnly ? () => onDelete(attribute) : undefined}
                    />
                ))}
            </ul>
        );
    }

    // The system attributes are sorted last (see splitIntoSections), so one index is the whole boundary.
    const boundary = readOnly ? -1 : rows.findIndex((entry) => entry.isSystem);
    const userDefined = boundary < 0 ? rows : rows.slice(0, boundary);
    const system = boundary < 0 ? [] : rows.slice(boundary);

    return (
        <>
            {userDefined.length > 0 && renderRows(userDefined)}
            {userDefined.length > 0 && system.length > 0 && <hr class="attribute-rows-divider" />}
            {system.length > 0 && renderRows(system)}
        </>
    );
}

interface AttributeRowProps {
    attribute: Attribute;
    /** The note the row belongs to, read for the definition that types its value. */
    note?: FNote | null;
    /** Whether the detail popup is currently showing this attribute. */
    active: boolean;
    /** The in-place editor over this row's value, rendered in the value's place. */
    valueEditor?: ComponentChildren;
    /** Whether the name is one Trilium reads for itself rather than one the note was given. */
    isSystem?: boolean;
    /** Names the note the attribute is inherited from, for attributes not owned by the current note. */
    showOwner?: boolean;
    onOpen: (anchor: HTMLElement | null, e: MouseEvent) => void;
    /** Starts the in-place edit of the value; absent for rows whose value is not edited in place. */
    onEditValue?: () => void;
    onDelete?: () => void;
}

function AttributeRow({ attribute, note, active, valueEditor, isSystem, showOwner, onOpen, onEditValue, onDelete }: AttributeRowProps) {
    const rowRef = useRef<HTMLLIElement>(null);
    const attrType = getAttributeKind(attribute);
    const markerClass = getKindMarkerClass(attribute, attrType, isSystem);
    const kindIcon = getKindIcon(attribute, attrType);
    const kindTooltip = getKindTooltip(attribute, attrType, isSystem);
    const rowClass = clsx("attribute-row", active && "active", valueEditor && "editing");

    function open(e: MouseEvent) {
        // Keep the container's closing handler from undoing this.
        e.stopPropagation();
        onOpen(rowRef.current, e);
    }

    const contents = (
        <>
            <span class="attribute-name">{getDisplayName(attribute, attrType)}</span>

            {/* Beside the name it qualifies — being inheritable is the attribute's standing, not part
                of its value — which also leaves the values' trailing edge to the values alone. */}
            {attribute.isInheritable && (
                <Icon
                    className="attribute-marker"
                    icon="bx bx-sitemap"
                    title={t("attribute_list_panel.inheritable")}
                />
            )}

            {/* Where the attribute reaches the note from, and so beside the marker of its being able
                to: the source is part of its standing too, and the trailing edge stays the values'. */}
            {showOwner && attribute.noteId && (
                <NoteLink containerClassName="attribute-owner" notePath={attribute.noteId} noPreview />
            )}

            {valueEditor ?? <AttributeValue attribute={attribute} note={note} attrType={attrType} onEdit={onEditValue} />}

            {/* The row's actions float over its trailing end on hover rather than reserving room in
                it (see the stylesheet), so the values keep the whole edge to themselves. Put away
                while the row's editor is open, whose field already is the edit. */}
            {(onDelete || (onEditValue && attrType === "relation")) && !valueEditor && (
                <span class="attribute-row-actions">
                    {/* A relation's value is a link and stays one, so its edit has a way in of its own. */}
                    {onEditValue && attrType === "relation" && (
                        <ActionButton
                            className="attribute-edit-button"
                            icon="bx bx-pencil"
                            text={t("attribute_list_panel.change_target")}
                            onClick={(e) => {
                                e.stopPropagation();
                                onEditValue();
                            }}
                        />
                    )}

                    {onDelete && (
                        <ActionButton
                            className="attribute-delete-button"
                            // The trash the menus mark deletion with, worn red as they wear it —
                            // a cross beside an editor reads as "close", and this is not that.
                            icon="bx bx-trash"
                            text={t("attribute_list_panel.delete")}
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete();
                            }}
                        />
                    )}
                </span>
            )}
        </>
    );

    // On a phone the rows are menu items, drawn as everything else the note's menu leads to is: the
    // panel is reached from that menu (see the note attributes modal), and a row there is something
    // pressed with a thumb rather than pointed at.
    if (IS_MOBILE) {
        return (
            <FormListItem
                itemRef={rowRef}
                className={rowClass}
                icon={kindIcon}
                // The badge hangs off the icon's own corner here, there being no wrapper to hang it on.
                iconClassName={clsx("attribute-kind", markerClass)}
                title={kindTooltip}
                onClick={open}
            >
                {contents}
            </FormListItem>
        );
    }

    return (
        <li ref={rowRef} class={rowClass} onClick={open}>
            {/* The icon is what carries the row's one tooltip: everything else about a row is already
                written on it, and what the icon (badge and all) stands for is exactly what is not. */}
            <span class={clsx("attribute-kind", markerClass)} title={kindTooltip}>
                <Icon icon={kindIcon} />
            </span>

            {contents}
        </li>
    );
}

/**
 * Whether a row is a menu item, read once: what the app is running on does not change under it, and
 * the rows are redrawn on every keystroke the popup takes.
 */
const IS_MOBILE = isMobile();

/**
 * What the attribute is, as an icon. A definition takes the icon of the field it sets up, the same one
 * the popup offers that field under — it needs no marker of its own, being only ever listed in a card
 * of definitions. Everything else is the icon of a label or of a relation.
 */
function getKindIcon(attribute: Attribute, attrType: AttributeKind) {
    if (isDefinition(attrType)) {
        // A definition written by hand can name a field the popup knows nothing of, leaving the icon of
        // the label it defines to stand for it.
        return getDefinitionType(attribute, attrType)?.icon ?? "bx bx-hash";
    }

    return attrType === "relation" ? "bx bx-transfer" : "bx bx-hash";
}

/**
 * The badge the kind icon carries on its corner, where there is one to carry: a cog for the names
 * Trilium reads for itself, and a chevron for a definition whose field is promoted — lifted, that is,
 * out of the attributes and into the note's own ribbon. At most one of the two, which no attribute is
 * ever both of: no built-in name is a definition. The class alone: what either badge means is a line
 * of the icon's own tooltip (see {@link getKindTooltip}), the two being read as one mark.
 */
function getKindMarkerClass(attribute: Attribute, attrType: AttributeKind, isSystem?: boolean) {
    if (isSystem) {
        return "marker-system";
    }

    if (isDefinition(attrType) && isPromotedDefinition(attribute, attrType)) {
        return "marker-promoted";
    }

    return undefined;
}

/**
 * What the kind icon answers on hover — the row's one tooltip, saying exactly what is drawn rather
 * than written: what the attribute is (a definition alongside the type of field it sets up), whether
 * that field is promoted, and, for a name Trilium reads for itself, a word on what that means. Each
 * on a line of its own, the native tooltip being plain text with only the line break to shape it.
 */
function getKindTooltip(attribute: Attribute, attrType: AttributeKind, isSystem?: boolean) {
    const lines: string[] = [];

    if (attrType === "label-definition") {
        // A relation definition is left as its kind names it: the field it sets up points at a note,
        // which "relation definition" already says.
        const type = getDefinitionType(attribute, attrType)?.title;
        lines.push(type ? `${KIND_TITLES[attrType]}${SUMMARY_SEPARATOR}${type}` : KIND_TITLES[attrType]);
    } else {
        lines.push(KIND_TITLES[attrType]);
    }

    if (isDefinition(attrType) && isPromotedDefinition(attribute, attrType)) {
        lines.push(t("attribute_detail.promoted"));
    }

    if (isSystem) {
        lines.push(t("attribute_list_panel.system_hint"));
    }

    return lines.join("\n");
}

/** Whether the definition sets its field up as promoted, which is what the chevron badge marks. */
function isPromotedDefinition(attribute: Attribute, attrType: AttributeKind) {
    return isDefinition(attrType) && promotedAttributeDefinitionParser.parse(attribute.value ?? "").isPromoted;
}

/** The entry of the popup's definition-type list that the definition is currently set to. */
function getDefinitionType(attribute: Attribute, attrType: AttributeKind) {
    // A relation definition is named after what it points at rather than after a field it fills in.
    const value = attrType === "relation-definition"
        ? RELATION_DEFINITION_TYPE
        : promotedAttributeDefinitionParser.parse(attribute.value ?? "").labelType ?? "text";

    return DEFINITION_TYPES.find((definitionType) => definitionType.value === value);
}

/**
 * A preview of what the attribute holds — the row stands for the attribute, the popup shows it in
 * full. A label's preview is also where its value is edited: pressing it swaps the text for the field
 * (see {@link AttributeValueEditor}), where the row around it opens the popup.
 */
function AttributeValue({ attribute, note, attrType, onEdit }: {
    attribute: Attribute;
    /** The note the attribute is shown on, read for the definition that types the value. */
    note?: FNote | null;
    attrType: AttributeKind;
    /** Starts the in-place edit; only ever handed to a label's preview. */
    onEdit?: () => void;
}) {
    if (attrType === "relation") {
        // A relation just created from the add menu has no target yet — and with no link to follow,
        // its slot is free to be the way into picking one, as a label's value is into typing.
        return attribute.value
            ? <NoteLink containerClassName="attribute-value" notePath={attribute.value} showNoteIcon noPreview />
            : (
                <span
                    class={clsx("attribute-value", "empty", onEdit && "editable")}
                    onClick={onEdit ? (e) => {
                        e.stopPropagation();
                        onEdit();
                    } : undefined}
                >
                    {t("attribute_list_panel.no_target")}
                </span>
            );
    }

    if (isDefinition(attrType)) {
        return <DefinitionSummary attribute={attribute} />;
    }

    // A colour is read by eye rather than by its text, so the preview is the colour itself — the same
    // chip a table cell reads it as — with the stored text kept to the chip's tooltip. An empty value
    // still shows the chip, as the empty ring it draws: unset is an answer a colour field can give.
    // A flag likewise previews as the mark a table cell reads it as, and the press that would edit
    // any other value just turns it over (see startValueEdit) — hence the pointer, not the text beam.
    const labelType = note ? resolveValueField(note, attribute.name).labelType : undefined;
    const isColor = labelType === "color";
    const isFlag = labelType === "boolean";

    // An editable slot holding nothing gets a placeholder instead of the blank: the row centres its
    // items, which collapses an empty span to a height of nothing — width but no height, a click
    // target that cannot be hit. The placeholder holds the slot open and names the way in, though only
    // over the row being pointed at (see the stylesheet): many a bare label is a flag meaning what its
    // presence means, and a standing "no value" against every one of them would read as a lack.
    const placeholder = !isColor && !isFlag && !attribute.value && onEdit;

    // A label with no value still gets its slot: it is what takes up the room between the name and what
    // the row ends with, so a bare label lines its markers and its delete button up with every other row's.
    return (
        <span
            class={clsx("attribute-value", onEdit && "editable", isFlag && "flag", placeholder && "empty value-placeholder")}
            title={isColor || isFlag || placeholder ? undefined : attribute.value}
            // Kept from the row, which would open the popup over the field this press asks for.
            onClick={onEdit ? (e) => {
                e.stopPropagation();
                onEdit();
            } : undefined}
        >
            {isColor ? <ColorChip color={attribute.value ?? ""} />
                : isFlag ? renderLabelValue(attribute.value ?? "", "boolean")
                    : placeholder ? t("attribute_list_panel.no_value")
                        : attribute.value}
        </span>
    );
}

/**
 * What a definition sets up, beyond the two things its icon and its badge already say — the type of
 * field it defines, and whether that field is promoted: a mark for a field holding a set, the inverse
 * a relation declares, and at the trailing edge — as the other cards keep their values — the name the
 * field was given of its own, the nearest thing a definition has to a value. A plain single-value
 * definition summarises to that alone, or to nothing at all.
 */
function DefinitionSummary({ attribute }: { attribute: Attribute }) {
    const definition = promotedAttributeDefinitionParser.parse(attribute.value ?? "");
    const displayName = definition.promotedAlias?.trim();

    return (
        <span class="attribute-value definition">
            {definition.multiplicity === "multi" && (
                <Icon
                    className="definition-marker"
                    icon="bx bx-layer"
                    title={t("attribute_detail.multi_value")}
                />
            )}

            {definition.inverseRelation && (
                // A returning arrow rather than words; the tooltip names the inverse and what it does.
                <Icon
                    className="definition-marker"
                    icon="bx bx-reply"
                    title={t("attribute_list_panel.inverse_hint", { name: definition.inverseRelation })}
                />
            )}

            {displayName && (
                // Written by hand and shown as written, unlike the words of Trilium's own beside it
                // (see AttributeList.css).
                <span class="definition-display-name" title={t("attribute_detail.promoted_alias")}>
                    {displayName}
                </span>
            )}
        </span>
    );
}

const SUMMARY_SEPARATOR = " · ";

type AttributeKind = NonNullable<AttrType>;

export function getAttributeKind(attribute: Attribute): AttributeKind {
    // The popup resolves the kind of what it is about to edit the same way; an attribute that is
    // neither a label nor a relation cannot reach a list built from the note's own attributes.
    return getAttrType(attribute) ?? attribute.type;
}

function isDefinition(attrType: AttributeKind) {
    return attrType === "label-definition" || attrType === "relation-definition";
}

/** Definitions are stored prefixed (`label:foo`), but the prefix is what the icon already says. */
export function getDisplayName(attribute: Attribute, attrType: AttributeKind) {
    return isDefinition(attrType)
        ? attribute.name.substring(attribute.name.indexOf(":") + 1)
        : attribute.name;
}

const KIND_TITLES: Record<AttributeKind, string> = {
    label: t("attribute_list_panel.type_label"),
    relation: t("attribute_list_panel.type_relation"),
    "label-definition": t("attribute_list_panel.type_label_definition"),
    "relation-definition": t("attribute_list_panel.type_relation_definition")
};

/**
 * A card's add button: it offers the kinds the card is about, so the definitions card offers the two
 * definitions alone while the note's own attributes are added from the top of the panel, whether or not
 * a definitions card exists yet to add one from.
 */
function AddAttributeButton({ text, attrTypes, onSelect }: {
    text: string;
    attrTypes: AttributeKind[];
    onSelect: (attrType: AttributeKind, e: MouseEvent) => void;
}) {
    return (
        <ActionButton
            icon="bx bx-plus"
            text={text}
            onClick={(e) => {
                // Keep the press from reaching the card header, which would collapse the card.
                e.stopPropagation();
                showAddMenu(e, attrTypes, (attrType) => onSelect(attrType, e));
            }}
        />
    );
}

/**
 * The way in at the foot of the list: a ghost of a row that creates a label in place when pressed —
 * a label because that is nearly always the kind being added, and the creation editor it opens can
 * be switched to a relation from its own name box or kind icon (see AttributeCreationEditor). The
 * card header's menu stays the way to every kind, definitions included.
 */
function AddAttributeRow({ onAdd }: { onAdd: (e: MouseEvent) => void }) {
    return (
        <div
            class="attribute-add-row"
            onClick={(e) => {
                // The container's click handler would close the very editor this opens.
                e.stopPropagation();
                onAdd(e);
            }}
        >
            <Icon icon="bx bx-plus" />
            {t("attribute_list_panel.add_attribute")}
        </div>
    );
}

/** What each card's add button offers, in the order the attributes editor's own menu offers it. */
const ADD_MENU_ENTRIES: { attrType: AttributeKind; title: string; icon: string }[] = [
    { attrType: "label", title: t("attribute_editor.add_new_label"), icon: "bx bx-hash" },
    { attrType: "relation", title: t("attribute_editor.add_new_relation"), icon: "bx bx-transfer" },
    { attrType: "label-definition", title: t("attribute_editor.add_new_label_definition"), icon: "bx bx-hash" },
    { attrType: "relation-definition", title: t("attribute_editor.add_new_relation_definition"), icon: "bx bx-transfer" }
];

const ALL_ATTRIBUTE_KINDS = ADD_MENU_ENTRIES.map((entry) => entry.attrType);

/** The kinds the definitions card can add: the last two of the menu above, on their own. */
const DEFINITION_KINDS: AttributeKind[] = [ "label-definition", "relation-definition" ];

function showAddMenu(e: MouseEvent, attrTypes: AttributeKind[], onSelect: (attrType: AttributeKind) => void) {
    const offered = ADD_MENU_ENTRIES.filter((entry) => attrTypes.includes(entry.attrType));
    const items: MenuItem<never>[] = [];

    for (const [ index, entry ] of offered.entries()) {
        // A definition is set apart from what it defines, where the two are offered together.
        if (index > 0 && isDefinition(entry.attrType) && !isDefinition(offered[index - 1].attrType)) {
            items.push({ kind: "separator" });
        }

        items.push({ title: entry.title, uiIcon: entry.icon, handler: () => onSelect(entry.attrType) });
    }

    void contextMenu.show({
        x: e.pageX,
        y: e.pageY,
        orientation: "left",
        items,
        selectMenuItemHandler: () => {}
    });
}

/** The defaults the attributes editor's add menu creates, so both entry points agree. */
function createAttribute(attrType: AttributeKind): Attribute {
    switch (attrType) {
        case "label":
            return { type: "label", name: "myLabel", value: "", isInheritable: false };
        case "relation":
            return { type: "relation", name: "myRelation", value: "", isInheritable: false };
        case "label-definition":
            return { type: "label", name: "label:myLabel", value: "promoted,single,text", isInheritable: false };
        case "relation-definition":
            return { type: "label", name: "relation:myRelation", value: "promoted,single", isInheritable: false };
    }
}

/** An attribute as a row: what the row offers depends on whether the current note owns it. */
export interface AttributeEntry {
    attribute: Attribute;
    isOwned: boolean;
    /** Whether Trilium reads this name for itself, as opposed to the note having been given it. */
    isSystem: boolean;
}

export interface AttributeSections {
    /** The note's own labels and relations. */
    owned: AttributeEntry[];
    /** Labels and relations reaching it from elsewhere. */
    inherited: AttributeEntry[];
    /**
     * The definitions among either, the note's own first. They share a card rather than following the
     * split above: they are the schema behind an attribute and not something the note is tagged with,
     * there are rarely more than a handful, and a row already names the note its definition lives on —
     * which for a definition (nearly always a template's) is the more precise answer anyway.
     */
    definitions: AttributeEntry[];
}

export function splitIntoSections(owned: Attribute[], inherited: Attribute[]): AttributeSections {
    const isDefinitionEntry = ({ attribute }: AttributeEntry) => isDefinition(getAttributeKind(attribute));
    const ownedEntries = owned.map((attribute) => toEntry(attribute, true));
    const inheritedEntries = inherited.map((attribute) => toEntry(attribute, false));

    return {
        owned: sortSystemLast(ownedEntries.filter((entry) => !isDefinitionEntry(entry))),
        inherited: sortSystemLast(inheritedEntries.filter((entry) => !isDefinitionEntry(entry))),
        definitions: sortSystemLast([ ...ownedEntries, ...inheritedEntries ].filter(isDefinitionEntry))
    };
}

function toEntry(attribute: Attribute, isOwned: boolean): AttributeEntry {
    return { attribute, isOwned, isSystem: isBuiltinAttribute(attribute.type, attribute.name) };
}

/**
 * The names the note was given first, the ones Trilium reads for itself after them: the note's own
 * vocabulary is what its reader is looking for, and `cssClass` or `template` is plumbing they set once.
 * A stable sort, so each group keeps the order it was collected in.
 */
function sortSystemLast(entries: AttributeEntry[]) {
    return entries.toSorted((a, b) => Number(a.isSystem) - Number(b.isSystem));
}

function collectOwned(note: FNote | null | undefined): Attribute[] {
    return listOwned(note?.getOwnedAttributes() ?? []);
}

function collectInherited(note: FNote | null | undefined): Attribute[] {
    return listInherited(note?.getAttributes() ?? [], note?.noteId);
}

/**
 * The attributes Trilium writes for itself. They are bookkeeping rather than metadata — of interest
 * when working on Trilium and noise to everyone else — so they are collected in a development build
 * alone, as the attributes pane listed them in one before this panel took them over.
 */
function collectInternal(note: FNote | null | undefined): Attribute[] {
    return glob.isDev ? listInternal(note?.getOwnedAttributes() ?? []) : [];
}

/** The note's own attributes, in the order it holds them. */
export function listOwned(ownedAttributes: FAttribute[]): Attribute[] {
    return ownedAttributes
        // Attributes Trilium maintains itself (the links of the note's content) are not metadata the
        // note was given, and are preserved across a save regardless, so they are left out.
        .filter((attribute) => !attribute.isAutoLink)
        .toSorted((a, b) => a.position - b.position)
        .map(toPlainAttribute);
}

/** Everything reaching the note from elsewhere, out of the effective attributes it is mixed into. */
export function listInherited(effectiveAttributes: FAttribute[], noteId: string | undefined): Attribute[] {
    return effectiveAttributes
        .filter((attribute) => attribute.noteId !== noteId && !attribute.isAutoLink)
        // Inherited attributes stay grouped by the note they come from:
        // https://github.com/zadam/trilium/issues/3761
        .toSorted((a, b) => a.noteId === b.noteId ? a.position - b.position : a.noteId.localeCompare(b.noteId))
        .map(toPlainAttribute);
}

/**
 * The other half of what the note holds: exactly the attributes the two lists above leave out, which
 * Trilium wrote from the note's own content (a link in it is a `~internalLink`) and rewrites whenever
 * that content is saved. Only the note's own, an inherited one being the source note's bookkeeping.
 */
export function listInternal(ownedAttributes: FAttribute[]): Attribute[] {
    return ownedAttributes
        .filter((attribute) => attribute.isAutoLink)
        .toSorted((a, b) => a.position - b.position)
        .map(toPlainAttribute);
}

/**
 * The rows and the detail popup work on plain attributes, which the popup is free to edit in place
 * without touching the cached entity behind them.
 */
function toPlainAttribute(attribute: FAttribute): Attribute {
    return {
        attributeId: attribute.attributeId,
        noteId: attribute.noteId,
        type: attribute.type,
        name: attribute.name,
        value: attribute.value,
        isInheritable: attribute.isInheritable
    };
}
