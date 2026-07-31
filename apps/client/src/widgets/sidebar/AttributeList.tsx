import "./AttributeList.css";

import { promotedAttributeDefinitionParser } from "@triliumnext/commons";
import clsx from "clsx";
import { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import FAttribute from "../../entities/fattribute";
import FNote from "../../entities/fnote";
import contextMenu, { MenuItem } from "../../menus/context_menu";
import { copyAttributesToClipboard, getHeldAttributes, holdAttributes, mergePastedAttributes, readAttributes, writeAttributes } from "../../services/attribute_clipboard";
import type { Attribute } from "../../services/attribute_parser";
import attributes, { isBuiltinAttribute } from "../../services/attributes";
import dialog from "../../services/dialog";
import { t } from "../../services/i18n";
import server from "../../services/server";
import toast from "../../services/toast";
import { getErrorMessage, isMobile } from "../../services/utils";
import { AttributeDetail, AttributeDetailOpts, AttributeForm, AttrType, DEFINITION_TYPES, getAttrType, RELATION_DEFINITION_TYPE } from "../attribute_widgets/attribute_detail";
import { ColorChip, renderLabelValue } from "../attribute_widgets/label_value_display";
import ActionButton from "../react/ActionButton";
import { FormListItem } from "../react/FormList";
import HelpButton from "../react/HelpButton";
import { useActiveNoteContext, useTriliumEvent, useTriliumOptionJson } from "../react/hooks";
import Icon from "../react/Icon";
import { DetailPane, MasterPane, useMasterDetail, useMasterDetailPage } from "../react/master_detail";
import NoItems from "../react/NoItems";
import NoteLink from "../react/NoteLink";
import { ParentComponent } from "../react/react_utils";
import { ATTRIBUTE_HELP_PAGE } from "../ribbon/components/AttributeHelp";
import OptionsSection from "../type_widgets/options/components/OptionsSection";
import AttributeCreationEditor from "./AttributeCreationEditor";
import AttributeValueEditor, { resolveValueField } from "./AttributeValueEditor";
import RightPanelWidget, { CollapsibleWidgets } from "./RightPanelWidget";

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
    // The rows picked out to be copied, by attributeId: a selection outlives the row objects, which a
    // reload rebuilds, and an attribute not yet saved has nothing to be copied by anyway.
    const [ selection, setSelection ] = useState<ReadonlySet<string>>(EMPTY_SELECTION);
    // Where a range drawn with shift is measured from: the row last picked out on its own.
    const selectionAnchor = useRef<string | null>(null);
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
    // The selection goes with them: it picks out rows of the note being left, and the clipboard holds
    // whatever was copied out of it already.
    useEffect(() => {
        setDetail(null);
        setValueEdit(null);
        setCreating(null);
        clearSelection();

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

            // A row deleted elsewhere takes its place in the selection with it, so what is copied is
            // always what is still shown.
            pruneSelection();

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
        // A press with no modifier on it is about the one attribute it landed on, so it takes the
        // selection over rather than leaving it standing behind the form to be copied by surprise.
        clearSelection();

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

    //#region Selection and the clipboard
    /**
     * Every row that can be picked out, in the order the panel draws them — the three cards read as
     * one list, so a range drawn with shift runs from any row to any other. The internal card is left
     * out: its rows are Trilium's own bookkeeping, rewritten whenever the note's content is saved,
     * which there is nothing to be gained by carrying elsewhere. A row is picked out by its
     * attributeId, so a draft still being created is not among them — it is not an attribute yet.
     */
    const selectableRows = [ ...sections.owned, ...sections.inherited, ...sections.definitions ]
        .filter((entry) => entry.attribute.attributeId);
    const selectableIds = selectableRows.flatMap((entry) => entry.attribute.attributeId ?? []);

    /**
     * Whether rows are being picked out, which is the panel's second standing: every row shows the
     * checkbox only the pointed-at one shows otherwise, the actions over the rows picked out are at
     * the foot of the card, and a row's own — its pencil, its trash — are put away, being about the
     * one row. There is no mode to turn on and off beside the selection itself: picking the first
     * row out is what starts it, and letting the last one go is what ends it.
     */
    const isSelecting = selection.size > 0;

    /** The picked-out rows in the order they are drawn, whichever cards they were picked out from. */
    function selectedAttributes() {
        return selectableRows
            .filter((entry) => entry.attribute.attributeId && selection.has(entry.attribute.attributeId))
            .map((entry) => entry.attribute);
    }

    function clearSelection() {
        selectionAnchor.current = null;
        setSelection(EMPTY_SELECTION);
    }

    /** Drops from the selection whatever the note no longer holds, so what is copied is what is shown. */
    function pruneSelection() {
        setSelection((current) => {
            if (current.size === 0) {
                return current;
            }

            const shown = new Set([ ...owned.current, ...inherited.current ].flatMap((attribute) => attribute.attributeId ?? []));
            const next = new Set([ ...current ].filter((attributeId) => shown.has(attributeId)));

            return next.size === current.size ? current : next;
        });
    }

    /**
     * Picks a row out or takes it back out. A range is drawn from the row last picked out on its own,
     * replacing whatever was picked out before it — what shift asks for; otherwise the one row is
     * added or removed, as a list of files is picked through and as a checkbox means.
     */
    function selectRow(attributeId: string, range = false) {
        // Whatever is being edited is wrapped up: picking rows out is about the rows, not the value.
        commit();
        commitValueEdit();
        commitCreation();

        if (range && selectionAnchor.current) {
            const from = selectableIds.indexOf(selectionAnchor.current);
            const to = selectableIds.indexOf(attributeId);

            if (from >= 0 && to >= 0) {
                setSelection(new Set(selectableIds.slice(Math.min(from, to), Math.max(from, to) + 1)));
                return;
            }
        }

        const next = new Set(selection);
        if (next.has(attributeId)) {
            next.delete(attributeId);
        } else {
            next.add(attributeId);
        }

        selectionAnchor.current = attributeId;
        setSelection(next);
    }

    /**
     * The copy key, which the panel receives by holding the focus (see {@link clipboardProps}). With
     * no rows picked out it is left alone: the press is then about whatever text is selected in the
     * panel, which is the browser's to copy.
     */
    function copySelection(e: ClipboardEvent) {
        const picked = selectedAttributes();
        if (picked.length === 0) {
            return;
        }

        e.preventDefault();
        writeAttributes(e.clipboardData, picked);
        // What is held is what says whether pasting is on offer at all, so the offer is redrawn.
        rerender();
        toast.showMessage(t("attribute_list_panel.copied", { count: picked.length }));
    }

    /**
     * The same from a button or a menu, where there is no event to write onto. What is held is set
     * before the system clipboard is written to: it is what says whether pasting is on offer, and
     * the offer has no reason to wait on a round trip the panel does not read back.
     */
    function copyPickedAttributes(picked: Attribute[]) {
        holdAttributes(picked);
        rerender();
        toast.showMessage(t("attribute_list_panel.copied", { count: picked.length }));

        void copyAttributesToClipboard(picked);
    }

    /**
     * The paste key. What the clipboard holds is read as the text the attributes editor spells
     * attributes out in — which is what this panel copies, and what that editor holds — so a paste
     * from either lands here whole, as does one written out by hand.
     */
    async function pasteAttributes(e: ClipboardEvent) {
        if (!note) {
            return;
        }
        e.preventDefault();

        let pasted: Attribute[];
        try {
            pasted = readAttributes(e.clipboardData);
        } catch (error: unknown) {
            // What was on the clipboard was not attributes; the parser says what it made of it.
            toast.showError(t("attribute_list_panel.paste_failed", { message: getErrorMessage(error) }));
            return;
        }

        if (pasted.length === 0) {
            toast.showMessage(t("attribute_list_panel.nothing_to_paste"));
            return;
        }

        await applyPaste(pasted);
    }

    /** The attributes folded into the note's own and saved, wherever the paste came from. */
    async function applyPaste(pasted: Attribute[]) {
        if (!note) {
            return;
        }

        // The edit in flight is wrapped up first, so the paste folds into a settled list.
        commit();
        commitValueEdit();
        commitCreation();

        const { attributes, added, replaced } = mergePastedAttributes(
            owned.current,
            pasted,
            (attribute) => isMultiValued(note, attribute)
        );

        owned.current = attributes;
        rerender();
        await save();

        toast.showMessage(t("attribute_list_panel.pasted", { count: added + replaced }));
    }

    /**
     * The menu a row is right-pressed for, over the rows picked out — which a press on a row that is
     * not among them narrows down to that row alone, as a file manager does. Copying is offered for
     * any row and deleting only where every picked row is the note's own: an inherited attribute is
     * the source note's to delete.
     */
    function showRowMenu(attribute: Attribute, e: MouseEvent) {
        e.preventDefault();
        e.stopPropagation();

        const attributeId = attribute.attributeId;
        let picked = selectedAttributes();

        if (!attributeId || !selection.has(attributeId)) {
            picked = [ attribute ];
            selectionAnchor.current = attributeId ?? null;
            setSelection(attributeId ? new Set([ attributeId ]) : EMPTY_SELECTION);
        }

        const items: MenuItem<never>[] = [
            {
                title: t("attribute_list_panel.copy", { count: picked.length }),
                uiIcon: "bx bx-copy",
                handler: () => void copyPickedAttributes(picked)
            },
            ...pasteMenuItems()
        ];

        if (picked.every((candidate) => owned.current.includes(candidate))) {
            items.push({ kind: "separator" });
            items.push({
                title: t("attribute_list_panel.delete_selection", { count: picked.length }),
                uiIcon: "bx bx-trash",
                handler: () => void deleteSelection(picked)
            });
        }

        void contextMenu.show({ x: e.pageX, y: e.pageY, items, selectMenuItemHandler: () => {} });
    }

    /**
     * The menu the card itself is right-pressed for, beside the rows — which is where a note with no
     * attributes at all is pasted onto, there being no row to press. Nothing is shown where there is
     * nothing to paste: the browser's own menu is the better answer then.
     */
    function showPanelMenu(e: MouseEvent) {
        const items = pasteMenuItems();
        if (items.length === 0) {
            return;
        }

        e.preventDefault();
        void contextMenu.show({ x: e.pageX, y: e.pageY, items, selectMenuItemHandler: () => {} });
    }

    /**
     * Pasting as a menu offers it, which is what Trilium last copied rather than what the system
     * clipboard holds — a menu cannot read that one (see the clipboard service), and the note tree's
     * own paste works from the same kind of store. The paste key is the way in to everything else,
     * the attributes editor's text included.
     */
    function pasteMenuItems(): MenuItem<never>[] {
        const heldAttributes = getHeldAttributes();
        if (heldAttributes.length === 0 || !note) {
            return [];
        }

        return [ {
            title: t("attribute_list_panel.paste", { count: heldAttributes.length }),
            uiIcon: "bx bx-paste",
            handler: () => void applyPaste(heldAttributes)
        } ];
    }

    /** Deletes the rows picked out, confirmed once for the lot as a single row's press is for the one. */
    async function deleteSelection(picked: Attribute[]) {
        if (picked.length === 1) {
            await deleteAttribute(picked[0]);
            return;
        }

        if (!await dialog.confirm(t("attribute_list_panel.delete_selection_confirm", { count: picked.length }))) {
            return;
        }

        owned.current = owned.current.filter((candidate) => !picked.includes(candidate));
        clearSelection();
        setDetail(null);
        rerender();

        await save();
    }

    /**
     * What every card carries so that the copy and paste keys reach the panel rather than the note
     * behind it: a clipboard event goes to whatever holds the focus, so a press anywhere in a card
     * takes it. Presses inside an open editor are left alone — taking the focus off a field would
     * commit the very edit the press is part of.
     */
    const clipboardProps = {
        tabIndex: -1,
        onCopy: copySelection,
        onPaste: (e: ClipboardEvent) => void pasteAttributes(e),
        onKeyDown: (e: KeyboardEvent) => {
            if (e.key === "Escape" && selection.size > 0) {
                e.stopPropagation();
                clearSelection();
            }
        },
        onMouseDownCapture: (e: MouseEvent) => {
            if (e.target instanceof Element && e.target.closest(".attribute-editor-overlay")) {
                return;
            }

            if (e.currentTarget instanceof HTMLElement) {
                e.currentTarget.focus({ preventScroll: true });
            }
        }
    };
    //#endregion

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
        selection,
        selecting: isSelecting,
        onOpen: openDetail,
        onSelect: selectRow,
        onShowMenu: showRowMenu,
        onEditValue: startValueEdit,
        onDelete: (attribute: Attribute) => void deleteAttribute(attribute)
    };

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
        // One card holding the lot, the sections being headings within it rather than cards of their
        // own: they are one list to the eye and one list to a selection — a range runs from any row to
        // any other — and four headers is a great deal of a hand-wide pane to spend on saying which
        // run is which. It also leaves the selection's own bar somewhere to belong: a bar at the foot
        // of one card among several belonged to a card the picked rows need not have been in at all.
        //
        // Collapsing moves to the headings with it. The card cannot be collapsed away, being all its
        // tab has (see RightPanelWidget), which is what the context below says.
        <CollapsibleWidgets.Provider value={false}>
            <AttributeSection
                id="attributes"
                title={t("attributes_panel.title")}
                grow
                buttons={note && (
                    <>
                        <HelpButton helpPage={ATTRIBUTE_HELP_PAGE} />
                        <AddAttributeButton
                            text={t("attribute_editor.add_a_new_attribute")}
                            attrTypes={ALL_ATTRIBUTE_KINDS}
                            onSelect={addAttribute}
                        />
                    </>
                )}
            >
                {/* Presses inside the list do not dismiss the popup (see `parent` above), which leaves
                    closing on a press next to a row up to this handler. The whole list is what the
                    note's own attributes are pasted onto, so it offers pasting beside its rows too. */}
                <div
                    class={clsx("attribute-list-panel", isSelecting && "selecting")}
                    ref={containerRef}
                    onClick={commit}
                    onContextMenu={showPanelMenu}
                    {...clipboardProps}
                >
                    {/* A heading of their own, as every other run has: the card names the panel
                        rather than this run, so without one the note's own attributes read as
                        belonging to no run at all. Their values read from the trailing edge, as the
                        inherited ones' do — the two runs of plain attributes reading as one ledger. */}
                    <AttributeGroup
                        id="attributes-owned"
                        title={t("attribute_list_panel.owned", { count: sections.owned.length })}
                    >
                        {sections.owned.length > 0 ? (
                            <AttributeRowList rows={sections.owned} alignValuesEnd {...rowProps} />
                        ) : (
                            <NoItems icon="bx bx-hash" text={t("attribute_list_panel.no_attributes")} />
                        )}

                        {/* Inside the run it adds to rather than at the foot of everything, and put
                            away with it. A phone adds from the header, page flow and all. */}
                        {!IS_MOBILE && note && (
                            <AddAttributeRow onAdd={(e) => addAttribute("label", e)} />
                        )}
                    </AttributeGroup>

                    {sections.inherited.length > 0 && (
                        <AttributeGroup
                            id="attributes-inherited"
                            title={t("attribute_list_panel.inherited", { count: sections.inherited.length })}
                        >
                            <AttributeRowList rows={sections.inherited} alignValuesEnd {...rowProps} />
                        </AttributeGroup>
                    )}

                    {sections.definitions.length > 0 && (
                        // The definitions keep prose order: their "value" is a summary of settings
                        // rather than a value, so there is no column of values for it to line up in.
                        <AttributeGroup
                            id="attributes-definitions"
                            title={t("attribute_list_panel.definitions", { count: sections.definitions.length })}
                        >
                            <AttributeRowList rows={sections.definitions} {...rowProps} />
                        </AttributeGroup>
                    )}

                    {internalRows.length > 0 && (
                        <AttributeGroup
                            id="attributes-internal"
                            title={t("attribute_list_panel.internal", { count: internalRows.length })}
                        >
                            <AttributeRowList rows={internalRows} readOnly {...rowProps} />
                        </AttributeGroup>
                    )}

                    {/* At the foot of the whole list, the rows it acts on being picked out anywhere
                        in it. It holds there while the list is scrolled (see the stylesheet). */}
                    {note && isSelecting && (
                        <AttributeSelectionBar
                            count={selection.size}
                            canDelete={selectedAttributes().every((candidate) => owned.current.includes(candidate))}
                            canPaste={getHeldAttributes().length > 0}
                            onCopy={() => void copyPickedAttributes(selectedAttributes())}
                            onPaste={() => void applyPaste(getHeldAttributes())}
                            onDelete={() => void deleteSelection(selectedAttributes())}
                            onClear={clearSelection}
                        />
                    )}
                </div>
            </AttributeSection>
        </CollapsibleWidgets.Provider>
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

/**
 * One run of rows under a heading that folds it away: the note's own attributes, what reaches it
 * from elsewhere, the definitions behind either, and — in a development build — what Trilium wrote
 * for itself. The card names the panel rather than any one of them, so each says what it is itself.
 *
 * A card each is what they were before, which spent four headers' worth of a hand-wide pane on
 * saying which run was which. What is kept from those cards is the folding — a template's dozens of
 * inherited attributes can still be put away — and what it is remembered under, so a pane that had
 * them put away has them put away still.
 */
function AttributeGroup({ id, title, children }: { id: string; title: string; children: ComponentChildren }) {
    const [ collapsedItems, setCollapsedItems ] = useTriliumOptionJson<string[]>("rightPaneCollapsedItems");
    const [ collapsed, setCollapsed ] = useState(collapsedItems.includes(id));

    function toggle() {
        const remembered = new Set(collapsedItems);
        if (collapsed) {
            remembered.delete(id);
        } else {
            remembered.add(id);
        }

        setCollapsed(!collapsed);
        void setCollapsedItems([ ...remembered ]);
    }

    return (
        // Named by its id as the card it stands in for was, which is what a stylesheet — or a test —
        // knows the run by.
        <div class={clsx("attribute-group", id, collapsed && "collapsed")}>
            <div
                class="attribute-group-header"
                onClick={(e) => {
                    // Kept from the list, whose handler would close a form this press is not about.
                    e.stopPropagation();
                    toggle();
                }}
            >
                <Icon className="attribute-group-chevron" icon="bx bx-chevron-down" />
                <span class="attribute-group-title">{title}</span>
            </div>

            {!collapsed && children}
        </div>
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
    /** The attributeIds of the rows picked out to be copied. */
    selection: ReadonlySet<string>;
    /** Whether rows are being picked out, which every row is drawn for rather than only the picked. */
    selecting: boolean;
    /**
     * Set the values against the rows' trailing edge, so that they line up in a column of their own:
     * the name reads from the one edge and the value from the other, and the gap between them says
     * how much room is left rather than being dead space after every short value. For the runs of
     * plain attributes; a definition's summary keeps prose order, having no value to line up.
     */
    alignValuesEnd?: boolean;
    /**
     * The rows stand for attributes Trilium writes and keeps up to date itself, which leaves them
     * nothing to offer: nothing to edit, nothing to delete, no note to name as their source (they are
     * always the current one's), no split to draw between the note's own names and Trilium's — every
     * one of them is Trilium's, which is what the card they are in says — and nothing to be picked
     * out for, being rewritten from the note's content rather than carried anywhere.
     */
    readOnly?: boolean;
    onOpen: (attribute: Attribute, isOwned: boolean, anchor: HTMLElement | null, e: MouseEvent) => void;
    /** Picks the row out, or takes it back out of the selection; `range` is what shift asks for. */
    onSelect: (attributeId: string, range?: boolean) => void;
    onShowMenu: (attribute: Attribute, e: MouseEvent) => void;
    /** Asks for the in-place editor over the attribute's value; wired to editable labels alone. */
    onEditValue: (attribute: Attribute) => void;
    onDelete: (attribute: Attribute) => void;
}

/**
 * One card's worth of rows, in two lists: what the note was given a name for, and below a rule, what
 * Trilium reads for itself. What a row offers follows from whether the note owns its attribute rather
 * than from the card it is in: the definitions card holds the note's own alongside a template's.
 */
function AttributeRowList({ rows, note, activeAttribute, valueEditor, selection, selecting, readOnly, alignValuesEnd, onOpen, onSelect, onShowMenu, onEditValue, onDelete }: AttributeRowListProps) {
    function renderRows(group: AttributeEntry[]) {
        return (
            // The rows are menu items on a phone (see AttributeRow), and the theme dresses a menu item
            // through the menu around it — so the list stands in as that menu, the way the other lists
            // of menu items outside a dropdown do (`dropdown-menu static show`, as in the code-note
            // switcher). Static: it opens nowhere and is positioned by nothing.
            <ul class={clsx(
                "attribute-rows",
                alignValuesEnd && "align-values-end",
                IS_MOBILE && "dropdown-menu tn-dropdown-menu static show"
            )}>
                {group.map(({ attribute, isOwned, isSystem }, index) => (
                    <AttributeRow
                        key={attribute.attributeId ?? `new-${index}`}
                        attribute={attribute}
                        note={note}
                        active={activeAttribute === attribute}
                        valueEditor={valueEditor?.attribute === attribute ? valueEditor.element : undefined}
                        isSystem={isSystem && !readOnly}
                        // A row is picked out by the attribute behind it, which a draft has yet to
                        // become; the internal card's rows are not picked out at all (see above).
                        selected={!readOnly && !!attribute.attributeId && selection.has(attribute.attributeId)}
                        selecting={!readOnly && selecting}
                        onSelect={!readOnly && attribute.attributeId
                            ? (range) => onSelect(attribute.attributeId ?? "", range)
                            : undefined}
                        onShowMenu={!readOnly ? (e) => onShowMenu(attribute, e) : undefined}
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
    /** Whether the row is picked out to be copied. */
    selected?: boolean;
    /** Whether rows are being picked out, which every row shows its checkbox for. */
    selecting?: boolean;
    /** Names the note the attribute is inherited from, for attributes not owned by the current note. */
    showOwner?: boolean;
    onOpen: (anchor: HTMLElement | null, e: MouseEvent) => void;
    /** Picks the row out; absent for the rows that are not picked out at all (see the list above). */
    onSelect?: (range?: boolean) => void;
    onShowMenu?: (e: MouseEvent) => void;
    /** Starts the in-place edit of the value; absent for rows whose value is not edited in place. */
    onEditValue?: () => void;
    onDelete?: () => void;
}

function AttributeRow({ attribute, note, active, valueEditor, isSystem, selected, selecting, showOwner, onOpen, onSelect, onShowMenu, onEditValue, onDelete }: AttributeRowProps) {
    const rowRef = useRef<HTMLLIElement>(null);
    // Set by a press held long enough to pick the row out, and read by the press's own release, which
    // would otherwise open the form behind the selection it just made.
    const heldDown = useRef(false);
    const attrType = getAttributeKind(attribute);
    const markerClass = getKindMarkerClass(attribute, attrType, isSystem);
    const kindIcon = getKindIcon(attribute, attrType);
    const kindTooltip = getKindTooltip(attribute, attrType, isSystem);
    const rowClass = clsx("attribute-row", active && "active", valueEditor && "editing", selected && "selected");
    /** Whether the whole row picks, which is what it does once rows are being picked out. */
    const selectsWholeRow = !!selecting && !!onSelect;

    /**
     * A phone has no modifier to hold down, so it has the press itself held instead: held long enough,
     * it picks the row out rather than opening it, which is how a phone's lists are picked through.
     * Once rows are being picked out a plain tap picks too — there being no checkbox to aim a thumb at
     * on a row that is a menu item — which is the turn those lists take as well.
     */
    useEffect(() => {
        const row = rowRef.current;
        if (!IS_MOBILE || !row || !onSelect) return;

        let timer: ReturnType<typeof setTimeout> | undefined;
        const start = () => {
            heldDown.current = false;
            timer = setTimeout(() => {
                heldDown.current = true;
                onSelect();
            }, LONG_PRESS_DURATION);
        };
        // A press that travels is the list being scrolled, and is no longer a press on the row.
        const cancel = () => clearTimeout(timer);

        row.addEventListener("touchstart", start, { passive: true });
        row.addEventListener("touchmove", cancel, { passive: true });
        row.addEventListener("touchend", cancel);
        row.addEventListener("touchcancel", cancel);

        return () => {
            clearTimeout(timer);
            row.removeEventListener("touchstart", start);
            row.removeEventListener("touchmove", cancel);
            row.removeEventListener("touchend", cancel);
            row.removeEventListener("touchcancel", cancel);
        };
    }, [ onSelect ]);

    /**
     * Once rows are being picked out, the whole row is what picks: a checkbox is a small thing to
     * aim at, and the press that missed it would otherwise open the form and let the selection go.
     * Taken in the capture phase and kept there, so that nothing the row holds acts on the press
     * instead — a value that would open its editor, a relation's target that would be navigated to.
     */
    function selectFromRow(e: MouseEvent) {
        // The release of the press that picked the row out, which has had its say already.
        if (heldDown.current) {
            heldDown.current = false;
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // The checkbox is left its own press: refused, its tick is put back after this has run,
        // which would leave the box a press behind the selection it is drawn from.
        if (e.target instanceof Element && e.target.closest(".attribute-kind-check")) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        onSelect?.(e.shiftKey);
    }

    // A menu item takes no capture handler of its own, so a phone's rows are bound theirs by hand.
    useEffect(() => {
        const row = rowRef.current;
        if (!IS_MOBILE || !row || !selectsWholeRow) return;

        row.addEventListener("click", selectFromRow, true);
        return () => row.removeEventListener("click", selectFromRow, true);
        // The handler itself is left out: it is written anew on every render, where what it does
        // turns only on the two below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ selectsWholeRow, onSelect ]);

    function open(e: MouseEvent) {
        // Keep the container's closing handler from undoing this.
        e.stopPropagation();

        // Already answered above, by the press that picked the row out or the one that let it go.
        if (selecting && onSelect) {
            return;
        }

        if (heldDown.current) {
            heldDown.current = false;
            return;
        }

        // Held down, the modifiers that pick rows out mean the press is about the selection rather
        // than about the one attribute the popup would show — which is how the first row is picked
        // out, there being no row yet whose whole face picks.
        if (onSelect && (e.ctrlKey || e.metaKey || e.shiftKey)) {
            // Nothing of the press is the browser's here: a shift-press would otherwise take the text
            // between the two rows as a selection, over the rows being picked out.
            e.preventDefault();
            onSelect(e.shiftKey);
            return;
        }

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
                // A picked-out row takes the mark a menu item is checked with, in the slot its kind
                // icon holds — the same trade the checkbox makes for itself on a desktop below.
                checked={selected}
                onClick={open}
            >
                {contents}
            </FormListItem>
        );
    }

    return (
        <li
            ref={rowRef}
            class={rowClass}
            onClickCapture={selectsWholeRow ? selectFromRow : undefined}
            onClick={open}
            onContextMenu={onShowMenu}
        >
            {/* The icon is what carries the row's one tooltip: everything else about a row is already
                written on it, and what the icon (badge and all) stands for is exactly what is not. */}
            <span class={clsx("attribute-kind", markerClass)} title={kindTooltip}>
                <Icon icon={kindIcon} />

                {/* The way rows are picked out, standing in the kind icon's slot rather than taking a
                    column of its own: the pane is narrow, and a column would take from the names what
                    it took for itself. Only the row being pointed at offers one — until rows are being
                    picked out, when every row shows its own, as a list of mail does. */}
                {onSelect && (
                    <span
                        class="attribute-kind-check"
                        onClick={(e) => {
                            // Kept from the row, whose press would open the form over the selection.
                            // The tick itself is left to the browser: refusing it puts the box back
                            // after this handler has run, leaving it a press behind the selection it
                            // is drawn from. What the press means either way is the same, so the two
                            // agree — and the box is drawn from the selection on every render after.
                            e.stopPropagation();
                            onSelect(e.shiftKey);
                        }}
                    >
                        {/* Not the form's checkbox component: that one is a labelled row of a settings
                            page, where this is the glyph of an icon's slot. */}
                        <input type="checkbox" class="form-check-input" checked={selected} tabIndex={-1} />
                    </span>
                )}
            </span>

            {contents}
        </li>
    );
}

/** How long a press is held before it picks a row out rather than opening it. */
const LONG_PRESS_DURATION = 500;

/**
 * Whether a row is a menu item, read once: what the app is running on does not change under it, and
 * the rows are redrawn on every keystroke the popup takes.
 */
const IS_MOBILE = isMobile();

/** Shared so that clearing a selection that is already empty is not a change to be redrawn for. */
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

/**
 * Whether the note's definitions say the attribute's field holds a set rather than a single value,
 * which is what a paste over a name the note already carries turns on: a set takes the pasted value
 * alongside what it holds, where a single value is replaced by it.
 */
export function isMultiValued(note: FNote | null | undefined, attribute: Attribute) {
    const definition = note?.getAttributeDefinitions()
        .find((candidate) => candidate.name === `${attribute.type}:${attribute.name}`)
        ?.getDefinition();

    return definition?.multiplicity === "multi";
}

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
 * What can be done to the rows picked out, at the foot of the card holding them: how many they are,
 * and the three things there are to do with them. It stands where the add row stands and takes its
 * turn (see the card above), so that picking rows out costs the list no room of its own — and it
 * says in words what the keys and the row menu offer without saying anything.
 *
 * Deleting is offered only where every picked row is the note's own, an inherited attribute being the
 * source note's to delete; pasting only where something has been copied to paste.
 */
function AttributeSelectionBar({ count, canDelete, canPaste, onCopy, onPaste, onDelete, onClear }: {
    count: number;
    canDelete: boolean;
    canPaste: boolean;
    onCopy: () => void;
    onPaste: () => void;
    onDelete: () => void;
    onClear: () => void;
}) {
    /** Kept from the card, whose own handler would close the form the button is not about. */
    const act = (action: () => void) => (e: MouseEvent) => {
        e.stopPropagation();
        action();
    };

    return (
        <div class="attribute-selection-bar">
            <span class="attribute-selection-count">{t("attribute_list_panel.selected", { count })}</span>

            <ActionButton
                icon="bx bx-copy"
                text={t("attribute_list_panel.copy", { count })}
                onClick={act(onCopy)}
            />

            {canPaste && (
                <ActionButton
                    icon="bx bx-paste"
                    text={t("attribute_list_panel.paste", { count: getHeldAttributes().length })}
                    onClick={act(onPaste)}
                />
            )}

            {canDelete && (
                <ActionButton
                    className="attribute-delete-button"
                    icon="bx bx-trash"
                    text={t("attribute_list_panel.delete_selection", { count })}
                    onClick={act(onDelete)}
                />
            )}

            {/* The way out, which is letting every row go: there is no mode standing apart from the
                selection to be turned off (see `isSelecting`). */}
            <ActionButton
                icon="bx bx-x"
                text={t("attribute_list_panel.clear_selection")}
                onClick={act(onClear)}
            />
        </div>
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
