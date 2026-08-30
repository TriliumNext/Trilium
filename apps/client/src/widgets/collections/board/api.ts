import { BulkAction, type DefinitionObject, promotedAttributeDefinitionParser } from "@triliumnext/commons";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import branches from "../../../services/branches";
import { executeBulkActions } from "../../../services/bulk_action";
import dialog from "../../../services/dialog";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import note_create from "../../../services/note_create";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { BoardColumnData, BoardViewData } from ".";
import { type BoardStatusDefinition, canStoreColumnsInDefinition, DEFAULT_GROUP_BY } from "./columns";
import { ColumnMap } from "./data";

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
}

/** Drops the record of a column the board now reads the same way from every source. */
export function settleColumn(pending: PendingColumnWrites, column: string) {
    pending.renames.delete(column);
    pending.claims.delete(column);
}

export default class BoardApi {

    private isRelationMode: boolean;
    /** The branch last sent to the end of each column, by {@link moveToColumnEnd}. */
    private sentToColumnEnd = new Map<string, string>();
    statusAttribute: string;

    constructor(
        private byColumn: ColumnMap | undefined,
        public columns: string[],
        private parentNote: FNote,
        statusAttribute: string,
        private viewConfig: BoardViewData,
        private saveConfig: (newConfig: BoardViewData) => void,
        private setBranchIdToEdit: (branchId: string | undefined) => void,
        private pending: PendingColumnWrites = { renames: new Map(), claims: new Map() },
        private statusDefinition?: BoardStatusDefinition
    ) {
        this.isRelationMode = statusAttribute.startsWith("~");

        if (statusAttribute.startsWith("~") || statusAttribute.startsWith("#")) {
            statusAttribute = statusAttribute.substring(1);
        }
        this.statusAttribute = statusAttribute;
    };

    async createNewItem(column: string, title: string) {
        try {
            // Create a new note as a child of the parent note
            const { note: newNote, branch: newBranch } = await note_create.createNote(this.parentNote.noteId, {
                activate: false,
                title,
                isProtected: this.parentNote.isProtected
            });

            if (newNote && newBranch) {
                await this.changeColumn(newNote.noteId, column);
            }
        } catch (error) {
            console.error("Failed to create new item:", error);
        }
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
    async addExistingItem(column: string, noteId: string) {
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
        return true;
    }

    async changeColumn(noteId: string, newColumn: string) {
        if (this.isRelationMode) {
            await attributes.setRelation(noteId, this.statusAttribute, newColumn);
        } else {
            await attributes.setLabel(noteId, this.statusAttribute, newColumn);
        }
    }

    async addNewColumn(columnName: string) {
        if (!columnName.trim()) {
            return;
        }

        const columns = this.viewConfig?.columns ?? [];

        // Add the new column to persisted data if it doesn't exist
        if (columns.some(col => col.value === columnName)) return false;
        settleColumn(this.pending, columnName);
        this.storeColumns([ ...columns, { value: columnName } ]);
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
        const noteIds = this.byColumn?.get(oldValue)?.map(item => item.note.noteId) || [];

        // Change the value in the notes.
        const action: BulkAction = this.isRelationMode
            ? { name: "updateRelationTarget", relationName: this.statusAttribute, targetNoteId: newValue }
            : { name: "updateLabelValue", labelName: this.statusAttribute, labelValue: newValue };
        await this.retiredWhile(oldValue, newValue,
            () => executeBulkActions(noteIds, [ action ], { silent: true }));

        // Rename the column in the persisted data.
        this.storeColumns((this.viewConfig?.columns ?? [])
            .map(col => col.value === oldValue ? { ...col, value: newValue } : col));
    }

    /** Stores the icon a column shows, or clears it back to the default when given nothing. */
    async setColumnIcon(column: string, icon: string | undefined) {
        this.updateColumn(column, { icon });
    }

    /** Stores the colour a column is tinted with, or clears it when given nothing. */
    async setColumnColor(column: string, color: string | null) {
        this.updateColumn(column, { color: color ?? undefined });
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
            return updated;
        };

        this.storeColumns(columns.some(col => col.value === column)
            ? columns.map(col => col.value === column ? patched(col) : col)
            : [ ...columns, patched({ value: column }) ]);
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

        // `columns` is derived render state and can lag behind the persisted config (it is rebuilt
        // only once the view re-renders), so anything it hasn't caught up with yet is kept at the
        // end instead of being dropped from the config.
        const storedColumns = new Map(
            (this.viewConfig?.columns ?? []).map(col => [ col.value, col ]));
        const missingColumns = (this.viewConfig?.columns ?? []).filter(col => !newColumns.includes(col.value));
        this.storeColumns([
            // Reordering moves the entries, so each keeps the icon it holds rather than being
            // rebuilt from its name.
            ...newColumns.map(value => storedColumns.get(value) ?? { value }),
            ...missingColumns
        ]);

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

        try {
            return await write();
        } catch (e) {
            undoRetirement();
            throw e;
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

    async insertRowAtPosition(
        column: string,
        relativeToBranchId: string,
        direction: "before" | "after") {
        const { note, branch } = await note_create.createNote(this.parentNote.noteId, {
            activate: false,
            targetBranchId: relativeToBranchId,
            target: direction,
            title: t("board_view.new-item")
        });

        if (!note || !branch) {
            throw new Error("Failed to create note");
        }

        const { noteId } = note;
        await this.changeColumn(noteId, column);
        this.startEditing(branch.branchId);

        return note;
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

    removeFromBoard(noteId: string) {
        const note = froca.getNoteFromCache(noteId);
        if (!note) return;
        if (this.isRelationMode) {
            return attributes.removeOwnedRelationByName(note, this.statusAttribute);
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

