import { BulkAction, type DefinitionObject, promotedAttributeDefinitionParser } from "@triliumnext/commons";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import branches from "../../../services/branches";
import { executeBulkActions } from "../../../services/bulk_action";
import cssClassManager from "../../../services/css_class_manager";
import dialog from "../../../services/dialog";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import note_create from "../../../services/note_create";
import { type NoteTypeOption, resolveNoteTypeOptions } from "../../../services/note_types";
import server from "../../../services/server";
import ws from "../../../services/ws";
import toast from "../../../services/toast";
import {
    type PromotedAttribute, resolvePromotedAttributes, storedPromotedAttributes,
    visiblePromotedAttributeNames
} from "../promoted_attributes";
import { BoardColumnData, BoardViewData } from ".";
import { currentCardTemplate, DEFAULT_CARD_TEMPLATES } from "./card_templates";
import {
    type BoardStatusDefinition, canStoreColumnsInDefinition, DEFAULT_COLUMN_ICON,
    DEFAULT_GROUP_BY, INBOX_COLUMN, INBOX_COLUMN_ICON
} from "./columns";
import { ColumnMap } from "./data";

/** Which end of a column a new card is made at. */
export type CardPlacement = "top" | "bottom";

/** One write's claim on a column, held until that write lands or is taken back. */
interface ColumnClaim {
    /**
     * Stands for the write that made the claim, since what two writes leave behind need not tell
     * them apart: one board read twice over can ask for the very same rename or deletion.
     */
    owner: object;
    value: string | undefined;
    /** Whether a record is left at all, as against the column being left to read as it stands. */
    records: boolean;
}

/**
 * The columns a board has in flight.
 *
 * Every write claims the columns it touches, and `renames` is what the last claim on each says.
 * Claims are kept rather than a value and its predecessor because writes finish in any order: one
 * taken back from under another leaves the one above it standing, and a column with no claims left
 * has no record at all, whichever of the two failed first.
 */
export interface PendingColumnWrites {
    renames: Map<string, string | undefined>;
    claims: Map<string, ColumnClaim[]>;
    /**
     * How many writes are running on the board right now.
     *
     * Counted apart from the records because a record outlives its write: it is given up only once
     * no source names the old value, and a definition the board cannot write keeps naming it for
     * good. What must not be put on disk is an answer no write has given yet, which is this.
     */
    inFlight: number;
}

/** Drops the record of a column the board now reads the same way from every source. */
export function settleColumn(pending: PendingColumnWrites, column: string) {
    pending.renames.delete(column);
    pending.claims.delete(column);
}

/**
 * The writes in flight on each board, by the note it is and the label it groups by.
 *
 * Shared by every view of one board rather than held per view, because what a record stands in for
 * is shared too: the notes, the definition and the attachment. A second tab open on the same board
 * refreshes on the same entity changes, and one that knew nothing of a deletion under way would
 * resolve the column from whichever source still carries it and write it back.
 */
const pendingWritesByBoard = new Map<string, PendingColumnWrites>();

/**
 * The record every view of one board writes into, made on first use and kept for good.
 *
 * Never dropped, however empty: a view is handed the record once, when it first draws a board, and
 * holds that object for as long as it is mounted. Dropping an empty one would hand the next view a
 * different record, and the two would stop hearing about each other's writes. What is left behind
 * is one string and two empty maps per board opened.
 */
export function getPendingWrites(board: string) {
    const existing = pendingWritesByBoard.get(board);
    if (existing) {
        return existing;
    }

    const writes: PendingColumnWrites = { renames: new Map(), claims: new Map(), inFlight: 0 };
    pendingWritesByBoard.set(board, writes);
    return writes;
}

export default class BoardApi {

    private isRelationMode: boolean;
    /** The branch last sent to the end of each column, by {@link moveToColumnEnd}. */
    private sentToColumnEnd = new Map<string, string>();
    statusAttribute: string;

    /** The config as the board last handed it over, against which a fresh one is recognised. */
    private viewConfigSource: BoardViewData | undefined;
    private viewConfig: BoardViewData;

    constructor(
        private byColumn: ColumnMap | undefined,
        public columns: string[],
        private parentNote: FNote,
        statusAttribute: string,
        viewConfig: BoardViewData | undefined,
        private saveConfig: (newConfig: BoardViewData) => void,
        private setBranchIdToEdit: (branchId: string | undefined) => void,
        private pending: PendingColumnWrites =
            { renames: new Map(), claims: new Map(), inFlight: 0 },
        private statusDefinition?: BoardStatusDefinition
    ) {
        this.viewConfigSource = viewConfig;
        this.viewConfig = viewConfig ?? {};
        this.isRelationMode = statusAttribute.startsWith("~");

        if (statusAttribute.startsWith("~") || statusAttribute.startsWith("#")) {
            statusAttribute = statusAttribute.substring(1);
        }
        this.statusAttribute = statusAttribute;
    };

    /**
     * Points the api at the board as it now stands.
     *
     * A refresh calls this instead of building a new api, so that the object every card holds keeps
     * its identity and a move redraws only the cards whose position changed.
     */
    update(
        byColumn: ColumnMap | undefined,
        columns: string[],
        parentNote: FNote,
        statusAttribute: string,
        viewConfig: BoardViewData | undefined,
        saveConfig: (newConfig: BoardViewData) => void,
        setBranchIdToEdit: (branchId: string | undefined) => void,
        statusDefinition?: BoardStatusDefinition
    ) {
        // What was sent to the end of a column stands in for what the map does not show yet, so it
        // is given up with the map it stands in for. Kept across a refresh, it would name a branch
        // that is no longer last and put the next card before it.
        if (byColumn !== this.byColumn) {
            this.sentToColumnEnd.clear();
        }

        this.byColumn = byColumn;
        this.columns = columns;
        this.parentNote = parentNote;
        // Only a config the board has actually replaced, since `storeColumns` moves this one ahead
        // of what the board holds and an unrelated render must not take that back.
        if (viewConfig !== this.viewConfigSource) {
            this.viewConfigSource = viewConfig;
            this.viewConfig = viewConfig ?? {};
        }
        this.saveConfig = saveConfig;
        this.setBranchIdToEdit = setBranchIdToEdit;
        this.statusDefinition = statusDefinition;
        this.isRelationMode = statusAttribute.startsWith("~");
        this.statusAttribute = statusAttribute.replace(/^[~#]/, "");
    }

    /**
     * Creates a card at one end of a column.
     *
     * Cards are drawn in the order the board's children stand in, so a card created under the
     * board lands at the bottom. The top is created before the column's own first card: all
     * columns share one list of children, so the board's first child is not this column's.
     */
    async createNewItem(
        column: string, title: string, placement: CardPlacement = "bottom", icon?: string,
        template: NoteTypeOption | undefined = this.getCurrentCardTemplate()
    ) {
        const first = placement === "top"
            ? this.byColumn?.get(column)?.[0]?.branch.branchId
            : undefined;

        try {
            const { note } = await note_create.createNote(this.parentNote.noteId, {
                activate: false,
                title,
                isProtected: this.parentNote.isProtected,
                ...(template?.options ?? {}),
                attributes: this.attributesFor(column, icon),
                ...(first ? { target: "before", targetBranchId: first } : {})
            });

            return note?.noteId;
        } catch (error) {
            console.error("Failed to create new item:", error);
        }
    }

    /**
     * Creates a card above another one, for a field standing among a column's cards.
     *
     * Without a card to go above, which is where the field stands below the last one, the card is
     * made at the end of the column.
     */
    async createNewItemBefore(
        column: string, beforeBranchId: string | undefined, title: string, icon?: string,
        template: NoteTypeOption | undefined = this.getCurrentCardTemplate()
    ) {
        if (!beforeBranchId) {
            return this.createNewItem(column, title, "bottom", icon, template);
        }

        const { note } = await this.insertRowAtPosition(
            column, beforeBranchId, "before", title, icon, template);
        return note.noteId;
    }

    /** What a new card carries besides its title: the column it lands in, and its icon. */
    private attributesFor(column: string, icon?: string) {
        return [
            ...this.groupingFor(column),
            ...(icon
                ? [ {
                    type: "label" as const,
                    name: "iconClass",
                    value: icon,
                    isInheritable: false
                } ]
                : [])
        ];
    }

    /**
     * What a new card carries so that it lands in the column it was added to.
     *
     * Written with the note rather than after it: a write of its own is a second round trip and a
     * second refresh, which on a large board is most of what adding a card costs. The inbox is the
     * column held by having no value at all, so it carries nothing.
     */
    private groupingFor(column: string) {
        if (column === INBOX_COLUMN) {
            return [];
        }

        return [ {
            type: this.isRelationMode ? "relation" as const : "label" as const,
            name: this.statusAttribute,
            value: column,
            isInheritable: false
        } ];
    }

    /**
     * Puts a note that already exists into a column, cloning it onto the board unless it is already
     * somewhere beneath it.
     *
     * A note that already carries a value for the label the board groups by is on some other board
     * grouped the same way, or is about to look like it: the value is the note's, not the board's,
     * so writing ours moves it there too. Worth knowing but not worth refusing, since a note
     * tracked on two boards is a fair thing to want.
     *
     * @returns whether the note was added, `false` when the user backed out.
     */
    async addExistingItem(column: string, noteId: string, beforeBranchId?: string) {
        const note = await froca.getNote(noteId, true);
        if (!note) return false;

        const isAlreadyOnBoard = note.hasAncestor(this.parentNote.noteId);
        const currentValue = this.isRelationMode
            ? note.getRelationValue(this.statusAttribute)
            : note.getLabelValue(this.statusAttribute);

        if (!isAlreadyOnBoard && currentValue) {
            const confirmed = await dialog.confirm(t("board_view.existing-item-conflict", {
                label: this.statusAttribute
            }));
            if (!confirmed) return false;
        }

        if (!isAlreadyOnBoard) {
            await branches.cloneNoteToParentNote(noteId, this.parentNote.noteId);
        }

        await this.changeColumn(noteId, column);

        if (beforeBranchId) {
            await this.moveIntoPlace(noteId, beforeBranchId);
        }

        return true;
    }

    /**
     * Puts a card that was just added above another one, which is where a field standing among a
     * column's cards adds it, rather than leaving it at the end of the column.
     *
     * The wait is what makes the move possible: a note cloned onto the board is given its branch by
     * the server, and that branch has to be in froca before it can be moved.
     */
    private async moveIntoPlace(noteId: string, beforeBranchId: string) {
        await ws.waitForMaxKnownEntityChangeId();

        const note = await froca.getNote(noteId);
        const branchId = note?.getParentBranches()
            .find(branch => branch.parentNoteId === this.parentNote.noteId)?.branchId;

        if (branchId && branchId !== beforeBranchId) {
            await branches.moveBeforeBranch([ branchId ], beforeBranchId);
        }
    }

    async changeColumn(noteId: string, newColumn: string) {
        if (newColumn === INBOX_COLUMN) {
            return this.moveToInbox(noteId);
        }

        if (this.isRelationMode) {
            await attributes.setRelation(noteId, this.statusAttribute, newColumn);
        } else {
            await attributes.setLabel(noteId, this.statusAttribute, newColumn);
        }
    }

    /**
     * Files a card under the inbox, which means leaving it with no grouping value at all.
     *
     * Different from {@link removeFromBoard}, which removes only the value the card owns and may
     * uncover an inherited one. Reaching the inbox is stricter: an inherited relation would still
     * point somewhere, so the card would end up in that column instead.
     */
    private moveToInbox(noteId: string) {
        const note = froca.getNoteFromCache(noteId);
        if (!note) return;

        if (this.isRelationMode && this.isInherited(note, "relation")) {
            toast.showMessage(t("board_view.inherited-column"), 3000);
            return;
        }

        return this.removeFromBoard(noteId);
    }

    /**
     * Adds a column at one end of the board.
     *
     * @param atStart whether it goes at the head of the board rather than after the last column.
     */
    async addNewColumn(columnName: string, atStart = false, icon?: string) {
        if (!columnName.trim()) {
            return;
        }

        const columns = this.viewConfig?.columns ?? [];

        // Add the new column to persisted data if it doesn't exist
        if (columns.some(col => col.value === columnName)) return false;
        settleColumn(this.pending, columnName);

        // The icon goes in with the column rather than after it: a write of its own would be a
        // second refresh of the board for a column that has only just been drawn.
        const added: BoardColumnData = icon ? { value: columnName, icon } : { value: columnName };

        if (!atStart) {
            this.storeColumns([ ...columns, added ]);
            return true;
        }

        // The whole order has to be written for the column to stand before the others: the stored
        // list is what the board reads first, and a column missing from it keeps its derived place
        // at the end whatever is put in front. The inbox holds the head where it has one.
        const order = columns.map(col => col.value);
        for (const derived of this.columns) {
            if (!order.includes(derived)) {
                order.push(derived);
            }
        }

        const byValue = new Map(columns.map(col => [ col.value, col ]));
        const placed: BoardColumnData[] = order.map(value => byValue.get(value) ?? { value });
        placed.splice(order[0] === INBOX_COLUMN ? 1 : 0, 0, added);
        this.storeColumns(placed);
        return true;
    }

    /**
     * Puts a new column beside an existing one, and hands back the name it was given for the caller
     * to open its title editor with.
     *
     * Named rather than left blank: a column is known by its value, so until it has one there is
     * nothing to place it by, nothing to store and nothing to rename. The stock name is numbered
     * where it is already taken, so adding several in a row cannot silently do nothing.
     */
    async insertColumn(relativeTo: string, direction: "before" | "after") {
        const stored = this.viewConfig?.columns ?? [];
        const taken = new Set([ ...this.columns, ...stored.map(col => col.value) ]);

        const stockName = t("board_view.new-column");
        let name = stockName;
        for (let suffix = 2; taken.has(name); suffix++) {
            name = `${stockName} ${suffix}`;
        }

        // Placed by the stored order rather than the derived one, which lags a column just added:
        // `columns` is rebuilt only when the view re-renders, while the config is written here.
        // Columns the config does not know yet keep their derived places, at the end.
        const order = stored.map(col => col.value);
        for (const derived of this.columns) {
            if (!order.includes(derived)) {
                order.push(derived);
            }
        }

        const neighbour = order.indexOf(relativeTo);
        order.splice(
            neighbour < 0 ? order.length : neighbour + (direction === "after" ? 1 : 0), 0, name);

        // Entries carry more than their name, so each is moved rather than rebuilt.
        const byValue = new Map(stored.map(col => [ col.value, col ]));
        this.storeColumns(order.map(value => byValue.get(value) ?? { value }));

        return name;
    }

    /**
     * Asks before taking a column off the board, the grouping label going from every card in it.
     * Both the menu and the Delete key come through here, so the question is put once and the same
     * way, and a refusal from the server is reported rather than passing for a deletion.
     *
     * @returns whether the column went, for a caller with something to do afterwards.
     */
    async confirmAndRemoveColumn(column: string) {
        if (!await dialog.confirm(t("board_view.delete-column-confirmation"))) {
            return false;
        }

        try {
            await this.removeColumn(column);
            return true;
        } catch (e) {
            console.error("Failed to delete the board column:", e);
            toast.showError(t("board_view.save-error"));
            return false;
        }
    }

    async removeColumn(column: string) {
        // Remove the value from the notes.
        const noteIds = this.byColumn?.get(column)?.map(item => item.note.noteId) || [];

        const action: BulkAction = this.isRelationMode
            ? { name: "deleteRelation", relationName: this.statusAttribute }
            : { name: "deleteLabel", labelName: this.statusAttribute };
        await this.retiredWhile(column, undefined,
            () => executeBulkActions(noteIds, [ action ], { silent: true }));

        this.storeColumns((this.viewConfig?.columns ?? []).filter(col => col.value !== column));
    }

    async renameColumn(oldValue: string, newValue: string) {
        // A column is identified by the value its cards carry, so a blank name would write an
        // empty label over every card and leave nothing to group by. The old name is kept.
        if (!newValue.trim()) {
            return;
        }

        // One write, which the server makes over the cards, the stored columns and the definition
        // together. Renaming them from here one at a time leaves a window in which they disagree,
        // and another client reading the board during it resolves the old name back from whichever
        // of them still carries it and writes that back, undoing the rename.
        const renamed = await this.retiredWhile(oldValue, newValue, () =>
            server.put<{ config?: BoardViewData }>(
                `notes/${this.parentNote.noteId}/board/rename-column`, {
                    attribute: this.statusAttribute,
                    isRelation: this.isRelationMode,
                    oldValue,
                    newValue
                }));

        // Taken from the answer rather than waited for: until the change arrives, this still holds
        // the configuration it read before the rename, and a refresh landing in between would write
        // that back and bring the old name with it.
        if (renamed?.config) {
            this.viewConfig = renamed.config;
            this.viewConfigSource = renamed.config;
        }
    }

    /** Stores the icon a column shows, or clears it back to the default when given nothing. */
    async setColumnIcon(column: string, icon: string | undefined) {
        this.updateColumn(column, { icon });
    }

    /** Stores the colour a column is tinted with, or clears it when given nothing. */
    async setColumnColor(column: string, color: string | null) {
        this.updateColumn(column, { color: color ?? undefined });
    }

    /**
     * The title shown for a column. For most columns this is the grouping value itself; the
     * inbox has no value, so it uses a name stored in the config.
     */
    getColumnTitle(column: string) {
        const named = this.viewConfig?.columns?.find(col => col.value === column)?.displayName;
        return named || (column === INBOX_COLUMN ? t("board_view.inbox") : column);
    }

    /**
     * Renames a column however that column is named.
     *
     * Most columns are identified by the value their cards carry, so renaming writes that value
     * to every card in the column. The inbox has no value, so it stores a display name instead and
     * its cards are left untouched.
     */
    async setColumnTitle(column: string, title: string) {
        if (!title.trim()) {
            return;
        }

        return column === INBOX_COLUMN
            ? this.updateColumn(column, { displayName: title.trim() })
            : this.renameColumn(column, title);
    }

    /**
     * The icon a column heading shows, for anything else that stands in for the column.
     *
     * In relation mode the column is a note, so the icon is that note's own — the same one
     * `NoteLink` puts in the heading — and `setColumnIcon` is not offered there.
     */
    getColumnIcon(column: string) {
        if (this.isRelationMode) {
            return froca.getNoteFromCache(column)?.getIcon();
        }

        const stored = this.viewConfig?.columns?.find(col => col.value === column)?.icon;
        if (stored) {
            return stored;
        }

        return column === INBOX_COLUMN ? INBOX_COLUMN_ICON : DEFAULT_COLUMN_ICON;
    }

    /**
     * The classes tinting anything that stands in for a column with the colour picked for it, empty
     * while it carries none. The colour is stored per column in both modes, unlike the icon.
     */
    getColumnColorClass(column: string) {
        const color = this.viewConfig?.columns?.find(col => col.value === column)?.color;
        return cssClassManager.createClassForColor(color ?? null);
    }

    /**
     * What to call the field the board groups by, for a heading standing over its columns.
     *
     * The promoted alias is what a card shows the field as, so it is the name a reader already
     * knows. A board whose definition gives none, or none of its own, falls back to the stock word.
     */
    getStatusLabel() {
        return this.statusDefinition?.definition.promotedAlias || t("board_view.status-header");
    }

    /**
     * Whether the board keeps an inbox column. The stored entry outlives being switched off, so
     * its icon, colour and position come back with it.
     */
    async setInboxEnabled(enabled: boolean) {
        await attributes.setBooleanWithInheritance(
            this.parentNote, "enableInboxColumn", enabled);
    }

    /** Hides the inbox column, which is what its own menu offers. */
    async disableInbox() {
        await this.setInboxEnabled(false);
    }

    /** Whether the board draws the notes filed as archived, cards and columns alike. */
    async setArchivedShown(shown: boolean) {
        await attributes.setBooleanWithInheritance(this.parentNote, "includeArchived", shown);
    }

    /** The note limit set for a column, absent if disabled. */
    getColumnLimit(column: string) {
        return this.viewConfig?.columns?.find(col => col.value === column)?.limit;
    }

    /** Sets a column's note limit. Pass `undefined` to disable it. */
    async setColumnLimit(column: string, limit: number | undefined) {
        await this.updateColumn(column, { limit });
    }

    /** Whether the inbox also collects notes deeper than the board's direct children. */
    async setInboxNested(nested: boolean) {
        await this.updateColumn(INBOX_COLUMN, { nested });
    }

    /** Whether a column is archived, which the board shows only while archived notes are shown. */
    isColumnArchived(column: string) {
        return !!this.viewConfig?.columns?.find(col => col.value === column)?.archived;
    }

    /**
     * Archives a column or brings it back. An archived one is shown only while the board is set to
     * show archived notes, and greyed out where it is.
     */
    async setColumnArchived(column: string, archived: boolean) {
        this.updateColumn(column, { archived });
    }

    /**
     * Everything a card could be made from, as the board read them.
     *
     * Held here so that a card made from somewhere other than the editor with the pill in it, an
     * insert beside another card above all, is made from the same template: the alternative is
     * handing every card on the board a list it would redraw for.
     */
    private availableTemplates: NoteTypeOption[] = [];

    setAvailableCardTemplates(templates: NoteTypeOption[]) {
        this.availableTemplates = templates;
    }

    /** What a card is made from now: the one last used, or the first the board offers. */
    getCurrentCardTemplate() {
        return currentCardTemplate(
            resolveNoteTypeOptions(this.getCardTemplateIds(), this.availableTemplates),
            this.getLastCardTemplateId());
    }

    /** The templates the board offers, or the stock set until the reader has picked for it. */
    getCardTemplateIds() {
        const stored = this.viewConfig?.templates;
        return stored?.length ? stored : DEFAULT_CARD_TEMPLATES;
    }

    /** Which of them a new card is made from, until another is picked. */
    getLastCardTemplateId() {
        return this.viewConfig?.template;
    }

    /** The order and what is hidden, as the view config holds it. */
    getStoredPromotedAttributes() {
        return this.viewConfig?.promotedAttributes;
    }

    /** The promoted attributes the board defines, in the order the reader put them. */
    getPromotedAttributes() {
        return resolvePromotedAttributes(
            this.parentNote, this.viewConfig?.promotedAttributes, [ this.statusAttribute ]);
    }

    /** Which of them a card draws, in order. */
    getVisiblePromotedAttributeNames() {
        return visiblePromotedAttributeNames(this.getPromotedAttributes());
    }

    /**
     * Stores the order and what is hidden.
     *
     * The whole list is written, so an attribute the board no longer defines is dropped from the
     * config by the same call that arranges the rest.
     */
    async setPromotedAttributes(attributes: PromotedAttribute[]) {
        this.storeConfig({ promotedAttributes: storedPromotedAttributes(attributes) });
    }

    /** Sets what the board offers. An empty set would leave nothing to make a card from. */
    async setCardTemplateIds(templates: string[]) {
        if (!templates.length) {
            return;
        }

        this.storeConfig({ templates });
    }

    /** Remembers what the last card was made from, so the next one is made from it too. */
    async setLastCardTemplateId(template: string) {
        if (template === this.viewConfig?.template) {
            return;
        }

        this.storeConfig({ template });
    }

    /** Whether a column is stored as collapsed, which draws it as a strip without its cards. */
    isColumnCollapsed(column: string) {
        return !!this.viewConfig?.columns?.find(col => col.value === column)?.collapsed;
    }

    /** Collapses a column to a strip, or opens it again. */
    async setColumnCollapsed(column: string, collapsed: boolean) {
        this.updateColumn(column, { collapsed });
    }

    /**
     * Collapses every column, or opens the ones that are not kept collapsed.
     *
     * One write for the board: a column resolved from the definition or from a value its cards
     * carry is drawn without ever having been stored, so this is also where it gets an entry.
     */
    async setAllColumnsCollapsed(collapsed: boolean) {
        const stored = new Map((this.viewConfig?.columns ?? []).map(col => [ col.value, col ]));
        const order = [ ...stored.keys() ];
        for (const derived of this.columns) {
            if (!stored.has(derived)) {
                order.push(derived);
            }
        }

        this.storeColumns(order.map(value => {
            const column = { ...(stored.get(value) ?? { value }) };
            if (collapsed) {
                column.collapsed = true;
            } else if (!column.keepCollapsed) {
                // A column kept collapsed keeps the flag: opening it is what the peek is for.
                delete column.collapsed;
            }

            return column;
        }));
    }

    /** Whether a column collapses again once it has been opened. */
    isColumnKeptCollapsed(column: string) {
        return !!this.viewConfig?.columns?.find(col => col.value === column)?.keepCollapsed;
    }

    /**
     * Sets whether a column collapses again once it has been opened.
     *
     * Turning it on collapses the column as well, so that the entry does something the reader can
     * see rather than only deciding what happens the next time the column is opened.
     *
     * @param isOpen whether the column is drawn open. Turning the flag off then clears `collapsed`
     *               as well, so the column the reader is looking at stays open.
     */
    async setColumnKeepCollapsed(column: string, keepCollapsed: boolean, isOpen = false) {
        if (keepCollapsed) {
            this.updateColumn(column, { keepCollapsed: true, collapsed: true });
            return;
        }

        this.updateColumn(column,
            isOpen ? { keepCollapsed: false, collapsed: false } : { keepCollapsed: false });
    }

    /**
     * Writes properties onto a column, dropping each one given as nothing so that it goes back to
     * its default rather than being stored empty.
     *
     * The column may have no stored entry at all: one resolved from the definition or from a value
     * a note carries is shown without ever being written, so the first pick for it creates one.
     */
    private updateColumn(column: string, patch: Partial<BoardColumnData>) {
        const columns = this.viewConfig?.columns ?? [];
        const patched = (stored: BoardColumnData): BoardColumnData => {
            const updated = { ...stored, ...patch };
            if (!updated.icon) delete updated.icon;
            if (!updated.color) delete updated.color;
            if (!updated.archived) delete updated.archived;
            if (!updated.collapsed) delete updated.collapsed;
            if (!updated.keepCollapsed) delete updated.keepCollapsed;
            if (!updated.displayName) delete updated.displayName;
            if (!updated.limit) delete updated.limit;
            return updated;
        };

        if (columns.some(col => col.value === column)) {
            this.storeColumns(columns.map(col => col.value === column ? patched(col) : col));
            return;
        }

        // A column with no entry yet is written where the board draws it, after the last column
        // before it that has one. Appended, it would move to the end of the board the moment
        // anything was picked for it: the stored order is what the board reads first, and a column
        // with no entry keeps a place of its own only until it has one. The inbox is drawn at the
        // head without ever having been written, so collapsing it used to send it to the back.
        const drawn = this.columns.indexOf(column);
        const previous = drawn < 0 ? undefined : this.columns.slice(0, drawn).reverse()
            .find(value => columns.some(col => col.value === value));
        const at = drawn < 0
            ? columns.length
            : previous ? columns.findIndex(col => col.value === previous) + 1 : 0;

        const placed = [ ...columns ];
        placed.splice(at, 0, patched({ value: column }));
        this.storeColumns(placed);
    }

    reorderColumn(fromIndex: number, toIndex: number) {
        if (!this.columns || fromIndex === toIndex) return;

        const newColumns = [...this.columns];
        const [movedColumn] = newColumns.splice(fromIndex, 1);

        // Adjust toIndex after removing the element
        // When moving forward (right), the removal shifts indices left
        let adjustedToIndex = toIndex;
        if (fromIndex < toIndex) {
            adjustedToIndex = toIndex - 1;
        }

        newColumns.splice(adjustedToIndex, 0, movedColumn);

        // `columns` is render state: it omits entries the view has yet to catch up with, and any
        // the board is hiding, such as a disabled inbox. Those are neither dropped nor appended at
        // the end.
        const stored = this.viewConfig?.columns ?? [];
        const storedColumns = new Map(stored.map(col => [ col.value, col ]));
        // Reordering only moves entries, so each keeps its stored icon instead of being rebuilt
        // from its name.
        const reordered: BoardColumnData[] =
            newColumns.map(value => storedColumns.get(value) ?? { value });

        // A hidden column goes back after the column it followed in the config, not at the index it
        // held there: the move has shifted the visible columns, so that index points elsewhere now.
        // Each one becomes the anchor for the next, which keeps a run of them in order.
        let anchor: string | undefined;
        for (const column of stored) {
            if (newColumns.includes(column.value)) {
                anchor = column.value;
                continue;
            }

            const at = anchor === undefined
                ? 0
                : reordered.findIndex(entry => entry.value === anchor) + 1;
            reordered.splice(at, 0, column);
            anchor = column.value;
        }

        this.storeColumns(reordered);

        return newColumns;
    }

    /**
     * Runs the write that moves a column, with the record of it in place from the start so that a
     * refresh in the middle reads the sources as they are about to be.
     *
     * Taken back out if the write does not land: left in, a rename nothing carries would keep the
     * column under the name it failed to take, and a deletion that failed would keep hiding one
     * that is still there, cards and all.
     */
    private async retiredWhile<T>(
        oldValue: string, newValue: string | undefined, write: () => Promise<T>
    ) {
        const undoRetirement = this.retireColumn(oldValue, newValue);
        this.pending.inFlight++;

        try {
            return await write();
        } catch (e) {
            undoRetirement();
            throw e;
        } finally {
            this.pending.inFlight--;
        }
    }

    /**
     * Records what a column became, so that `resolveBoardColumns` reads whichever of the notes, the
     * view config and the definition has not been written yet as though it already were. That must
     * be said outright: a value the board just renamed and one added from elsewhere look the same.
     * {@link getBoardData} clears the record once no source lists the old value.
     *
     * @param newValue the name that replaced it, or `undefined` where the column was deleted.
     * @returns a function taking back exactly the claims this call made, leaving those of any write
     *          still in flight to say what the column reads as.
     */
    private retireColumn(oldValue: string, newValue?: string) {
        const { renames, claims } = this.pending;
        const owner = {};
        const touched: string[] = [];

        // The last claim on a column is the one the board reads, so this runs after every claim
        // made and every claim taken back. A column no write claims any longer has no record.
        const restate = (key: string) => {
            const claim = claims.get(key)?.at(-1);
            if (claim?.records) {
                renames.set(key, claim.value);
            } else {
                renames.delete(key);
            }
        };

        const write = (key: string, value: string | undefined, records: boolean) => {
            claims.set(key, [ ...claims.get(key) ?? [], { owner, value, records } ]);
            touched.push(key);
            restate(key);
        };

        // A rename of a column whose own rename has not landed yet has to be followed through, or
        // the old value the stale sources still carry would resolve to a name that is itself gone.
        for (const [ from, to ] of renames) {
            if (to === oldValue) {
                write(from, newValue, true);
            }
        }

        write(oldValue, newValue, true);

        if (newValue) {
            // Covers a rename back to a name still pending, whose record the loop above just turned
            // into one mapping the name to itself.
            write(newValue, undefined, false);
        }

        return () => {
            for (const key of touched) {
                const stack = claims.get(key);
                const at = stack?.findIndex(claim => claim.owner === owner) ?? -1;
                if (!stack || at < 0) continue;

                stack.splice(at, 1);
                if (!stack.length) {
                    claims.delete(key);
                }
                restate(key);
            }
        };
    }

    /**
     * Persists a new column list, into the definition the board groups by as well as into the view
     * config — every column change funnels through here, so the two cannot drift apart.
     *
     * The config is always replaced with a fresh object instead of being edited in place: the board
     * re-renders off the identity of the config it was handed, so an in-place edit would be written
     * to disk but stay invisible until the view is re-entered.
     */
    /** Writes part of the board's own configuration, leaving the rest of it as it stands. */
    private storeConfig(patch: Partial<BoardViewData>) {
        this.viewConfig = { ...this.viewConfig, ...patch };
        this.saveConfig(this.viewConfig);
    }

    private storeColumns(columns: BoardColumnData[]) {
        this.viewConfig = { ...this.viewConfig, columns };
        this.saveConfig(this.viewConfig);
        // Not awaited — every caller is the tail of a user gesture the board has already rendered —
        // so the failure is caught here rather than left to reject unhandled. The columns are still
        // in the view config, so the board is not wrong, only out of step with the definition.
        this.syncColumnsToDefinition(columns.map(({ value }) => value))
            .catch((e) => {
                console.error("Failed to store the board columns in the attribute definition:", e);
                toast.showError(t("board_view.column-definition-save-error"));
            });
    }

    /**
     * Brings the board's own definition in line with the columns it shows, so that the same list is
     * what the promoted field offers, what the table view's dropdown offers, and what the board shows.
     *
     * Called both when the user changes a column and on every render, because a column can appear
     * without the board's column UI ever being used: a note given a new value from the table view, a
     * script or a synced instance shows up as a column here, and the definition has to learn about it
     * too. The render call is also what gives a newly created board its definition — nothing else
     * would, since migration 0240 only ever saw the boards that existed when it ran.
     *
     * Writing only on a real difference is what makes that safe to call every time: the write lands as
     * an entity change, which re-renders the board, which would write again.
     */
    async syncColumnsToDefinition(columns: string[]) {
        if (this.isRelationMode || !canStoreColumnsInDefinition(this.statusDefinition)) {
            return;
        }

        // The definition lists the values a card can carry; the inbox has no value.
        columns = columns.filter(column => column !== INBOX_COLUMN);

        // A board showing nothing has no column list to describe and must not gain an empty
        // definition; one that already owns one is still emptied, since that is its last column going.
        if (!columns.length && !this.statusDefinition?.isOwned) {
            return;
        }

        const current = this.statusDefinition?.options ?? [];
        const isUpToDate = this.statusDefinition?.definition.labelType === "select"
            && current.length === columns.length
            && current.every((option, index) => option === columns[index]);
        if (isUpToDate) {
            return;
        }

        // What a board with no definition of its own is given. Promoted, because the column a card
        // sits in is the point of the board, and a field that is not promoted is one the card never
        // shows — the status would be reachable only by dragging the card. Named only where the name
        // is ours to give: a board grouping by anything else is named by its own label.
        const created: DefinitionObject = {
            isPromoted: true,
            promotedAlias: this.statusAttribute === DEFAULT_GROUP_BY ? t("board_view.status-alias") : undefined
        };

        // An existing definition is updated as it stands, so a board deliberately left unpromoted —
        // by the user, or by migration 0240 where it had no field to begin with — does not gain one.
        const definition = {
            ...(this.statusDefinition?.definition ?? created),
            labelType: "select" as const,
            selectOptions: columns
        };

        // Written by name rather than by attribute id, so that two syncs which overlap — a column
        // edit landing mid-refresh, or one refresh starting before the previous write is back —
        // converge on one row instead of each creating one. Addressing it by id cannot: both would
        // have read the same "no definition yet" state and both would ask for a new attribute. Only
        // the board's own attributes are matched, so a definition it merely inherits is still copied
        // into one of its own rather than edited where it lives.
        await attributes.setLabel(
            this.parentNote.noteId,
            `label:${this.statusAttribute}`,
            promotedAttributeDefinitionParser.serialize(definition, "label"),
            // A definition that is not inheritable would not reach the notes on the board at all.
            this.statusDefinition?.attribute.isInheritable ?? true
        );
    }

    /** Creates a card beside another one, which is what a field between two cards makes. */
    async insertRowAtPosition(
        column: string,
        relativeToBranchId: string,
        direction: "before" | "after",
        title: string,
        icon?: string,
        template: NoteTypeOption | undefined = this.getCurrentCardTemplate()) {
        const { note, branch } = await note_create.createNote(this.parentNote.noteId, {
            activate: false,
            targetBranchId: relativeToBranchId,
            target: direction,
            title,
            isProtected: this.parentNote.isProtected,
            ...(template?.options ?? {}),
            attributes: this.attributesFor(column, icon)
        });

        if (!note || !branch) {
            throw new Error("Failed to create note");
        }

        return { note, branch };
    }

    openNote(noteId: string) {
        appContext.triggerCommand("openInPopup", { noteIdOrPath: noteId });
    }

    startEditing(branchId: string) {
        this.setBranchIdToEdit(branchId);
    }

    dismissEditingTitle() {
        this.setBranchIdToEdit(undefined);
    }

    renameCard(noteId: string, newTitle: string) {
        return server.put(`notes/${noteId}/title`, { title: newTitle.trim() });
    }

    /**
     * Copies a card into the board, the way the tree duplicates a note, and puts the copy straight
     * after the one it was made from.
     *
     * The copy carries the original's attributes, the grouping label among them, so it lands in the
     * same column without being told to. The wait is what makes the move possible: the branch is
     * named by the server and has to be in froca before it can be placed.
     */
    async duplicateItem(noteId: string, branchId: string) {
        const { branch } = await server.post<{ branch: { branchId: string } }>(
            `notes/${noteId}/duplicate/${this.parentNote.noteId}`);

        await ws.waitForMaxKnownEntityChangeId();
        await branches.moveAfterBranch([ branch.branchId ], branchId);
    }

    /** Whether the grouping value comes from another note, such as a template or a parent. */
    private isInherited(note: FNote, type: "label" | "relation") {
        return note.getAttributes(type, this.statusAttribute)
            .some(attribute => attribute.noteId !== note.noteId);
    }

    removeFromBoard(noteId: string) {
        const note = froca.getNoteFromCache(noteId);
        if (!note) return;
        if (this.isRelationMode) {
            // A relation must point at a note, so an inherited one cannot be shadowed the way a
            // label is below. It can only be changed on the note that defines it.
            if (!note.getOwnedAttributes("relation", this.statusAttribute).length
                    && this.isInherited(note, "relation")) {
                toast.showMessage(t("board_view.inherited-column"), 3000);
                return;
            }

            return attributes.removeOwnedRelationByName(note, this.statusAttribute);
        }

        // An inherited value cannot be removed from the card, and removing the owned one would
        // only uncover it. An owned empty value shadows it instead, which counts as no value.
        if (this.isInherited(note, "label")) {
            return attributes.setLabel(noteId, this.statusAttribute, "");
        }

        return attributes.removeOwnedLabelByName(note, this.statusAttribute);
    }

    /**
     * Moves a card to the end of another column, where a new one would go.
     *
     * {@link moveWithinBoard} leaves a card crossing columns where the tree already had it, which
     * is where a drop between two cards wants it. A card sent across by the keyboard is aimed at no
     * card in particular, so it goes where the reader would look for it.
     */
    async moveToColumnEnd(noteId: string, branchId: string, targetColumn: string) {
        // What is already at the end, as far as this instance can know: nothing waits for the board
        // to redraw between two keystrokes, so the column map still shows the target as it was
        // before the card the last press sent. Anything sent since is remembered here instead, and
        // the memory lasts exactly as long as the map it stands in for, both being rebuilt by the
        // refresh that catches up.
        const last = this.sentToColumnEnd.get(targetColumn)
            ?? (this.byColumn?.get(targetColumn) ?? []).at(-1)?.branch.branchId;

        await this.changeColumn(noteId, targetColumn);
        if (last && last !== branchId) {
            await branches.moveAfterBranch([ branchId ], last);
        }

        this.sentToColumnEnd.set(targetColumn, branchId);
    }

    /** Whether a card stands at the head of its column, with nowhere left to be moved up to. */
    isFirstInColumn(branchId: string, column: string) {
        return this.byColumn?.get(column)?.[0]?.branch.branchId === branchId;
    }

    /**
     * Moves a card to the head of the column it stands in, where Ctrl+Home also sends it.
     *
     * The card's own place is looked up here rather than asked of the caller: the menu is opened on
     * a card, which knows the column it is in but not where it stands among the others.
     */
    async moveToColumnStart(noteId: string, branchId: string, column: string) {
        const items = this.byColumn?.get(column) ?? [];
        const at = items.findIndex(item => item.branch.branchId === branchId);
        if (at <= 0) {
            return;
        }

        await this.moveWithinBoard(noteId, branchId, at, 0, column, column);
    }

    async moveWithinBoard(noteId: string, sourceBranchId: string, sourceIndex: number, targetIndex: number, sourceColumn: string, targetColumn: string) {
        const targetItems = this.byColumn?.get(targetColumn) ?? [];

        const note = froca.getNoteFromCache(noteId);
        if (!note) return;

        if (sourceColumn !== targetColumn) {
            // Moving to a different column
            await this.changeColumn(noteId, targetColumn);

            // If there are items in the target column, reorder
            if (targetItems.length > 0 && targetIndex < targetItems.length) {
                const targetBranch = targetItems[targetIndex].branch;
                await branches.moveBeforeBranch([ sourceBranchId ], targetBranch.branchId);
            }
        } else if (sourceIndex !== targetIndex) {
            // Reordering within the same column
            let targetBranchId: string | null = null;

            if (targetIndex < targetItems.length) {
                // Moving before an existing item
                const adjustedIndex = sourceIndex < targetIndex ? targetIndex : targetIndex;
                if (adjustedIndex < targetItems.length) {
                    targetBranchId = targetItems[adjustedIndex].branch.branchId;
                    if (targetBranchId) {
                        await branches.moveBeforeBranch([ sourceBranchId ], targetBranchId);
                    }
                }
            } else if (targetIndex > 0) {
                // Moving to the end - place after the last item
                const lastItem = targetItems[targetItems.length - 1];
                await branches.moveAfterBranch([ sourceBranchId ], lastItem.branch.branchId);
            }
        }
    }

}

