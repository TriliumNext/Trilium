import { beforeEach, describe, expect, it, vi } from "vitest";

import FAttribute from "../../../entities/fattribute";
import branches from "../../../services/branches";
import attributes from "../../../services/attributes";
import { executeBulkActions } from "../../../services/bulk_action";
import dialog from "../../../services/dialog";
import toast from "../../../services/toast";
import FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import note_create from "../../../services/note_create";
import noteAttributeCache from "../../../services/note_attribute_cache";
import server from "../../../services/server";
import ws from "../../../services/ws";
import { buildNote } from "../../../test/easy-froca";
import { BoardViewData } from ".";
import BoardApi, { getPendingWrites, PendingColumnWrites } from "./api";
import { ColumnMap } from "./data";
import { BOARD_TEMPLATE_ID, DEFAULT_COLUMN_ICON, getStatusDefinition, INBOX_COLUMN } from "./columns";
import { DEFAULT_CARD_TEMPLATES } from "./card_templates";

vi.mock("../../../services/bulk_action", () => ({
    executeBulkActions: vi.fn(async () => {})
}));

/** Makes the next bulk action fail, as an offline or rejecting server does. */
function failNextBulkAction() {
    vi.mocked(executeBulkActions).mockRejectedValueOnce(new Error("offline"));
}

/** The same for a column rename, which the server makes in one write of its own. */
function failNextRename() {
    vi.spyOn(server, "put").mockRejectedValueOnce(new Error("offline"));
}

/** Holds the next rename open, answering it only once the returned function is called. */
function holdNextRename() {
    let release = () => {};
    vi.spyOn(server, "put").mockImplementationOnce(
        () => new Promise<void>((resolve) => { release = resolve; }));
    return () => release();
}

vi.mock("../../../services/branches", () => ({
    default: {
        cloneNoteToParentNote: vi.fn(async () => {}),
        moveBeforeBranch: vi.fn(async () => {}),
        moveAfterBranch: vi.fn(async () => {})
    }
}));

vi.mock("../../../services/note_create", () => ({
    default: { createNote: vi.fn(async () => ({ note: null, branch: null })) }
}));

vi.mock("../../../services/dialog", () => ({
    default: { confirm: vi.fn(async () => true) }
}));

vi.mock("../../../services/i18n", () => ({
    // i18next is never initialised under test, so the real `t` yields nothing and the alias would
    // silently vanish from the definitions asserted below rather than being checked.
    t: (key: string) => (key === "board_view.status-alias" ? "Status" : key)
}));

function createApi(
    viewConfig: BoardViewData,
    columns: string[],
    parentNote?: FNote,
    statusAttribute = "status",
    byColumn: ColumnMap = new Map()
) {
    const board = parentNote ?? buildNote({ title: "Board" });
    const saved: BoardViewData[] = [];
    const editing: (string | undefined)[] = [];
    const pending: PendingColumnWrites =
        { renames: new Map(), claims: new Map(), inFlight: 0 };
    const api = new BoardApi(
        byColumn,
        columns,
        board,
        statusAttribute,
        viewConfig,
        (newConfig) => saved.push(newConfig),
        (branchId) => editing.push(branchId),
        pending,
        getStatusDefinition(board, statusAttribute)
    );
    return { api, board, saved, editing, pendingRenames: pending.renames };
}

describe("BoardApi column mutations", () => {
    /**
     * #10689: the view re-renders off the identity of the config object it is handed
     * (`useEffect(refresh, [ …, viewConfig ])`). A mutator that edits the config in place and saves
     * the same reference persists the change but never redraws the board.
     */
    it("hands the caller a new config object rather than mutating in place", async () => {
        const viewConfig: BoardViewData = { columns: [ { value: "To Do" }, { value: "Done" } ] };
        const { api, saved } = createApi(viewConfig, [ "To Do", "Done" ]);

        await api.addNewColumn("In Progress");
        await api.removeColumn("To Do");

        expect(saved).toHaveLength(2);
        for (const config of saved) {
            expect(config).not.toBe(viewConfig);
            expect(config.columns).not.toBe(viewConfig.columns);
        }
        expect(saved.map(config => config.columns?.map(col => col.value))).toEqual([
            [ "To Do", "Done", "In Progress" ],
            [ "Done", "In Progress" ]
        ]);
    });

    it("does not save anything for a duplicate column", async () => {
        const { api, saved } = createApi({ columns: [ { value: "To Do" } ] }, [ "To Do" ]);
        expect(await api.addNewColumn("To Do")).toBe(false);
        expect(saved).toHaveLength(0);
    });

    it("puts a new column on either side of the one it is given", async () => {
        const { api, saved } = createApi(
            { columns: [ { value: "To Do" }, { value: "Done" } ] },
            [ "To Do", "Done" ]
        );

        expect(await api.insertColumn("To Do", "after")).toBe("board_view.new-column");
        expect(saved.at(-1)?.columns?.map(col => col.value))
            .toEqual([ "To Do", "board_view.new-column", "Done" ]);

        // The second is placed against the config just written, not the list the view still shows.
        expect(await api.insertColumn("Done", "before")).toBe("board_view.new-column 2");
        expect(saved.at(-1)?.columns?.map(col => col.value)).toEqual([
            "To Do", "board_view.new-column", "board_view.new-column 2", "Done"
        ]);
    });

    it("keeps the icon of a column it puts one beside", async () => {
        const { api, saved } = createApi(
            { columns: [ { value: "To Do", icon: "bx bx-list-ul", color: "#e64d4d" } ] },
            [ "To Do" ]
        );

        await api.insertColumn("To Do", "before");

        expect(saved.at(-1)?.columns)
            .toEqual([
                { value: "board_view.new-column" },
                { value: "To Do", icon: "bx bx-list-ul", color: "#e64d4d" }
            ]);
    });

    it("keeps the icon of every column it reorders", () => {
        const { api, saved } = createApi(
            { columns: [ { value: "To Do", icon: "bx bx-list-ul" }, { value: "Done" } ] },
            [ "To Do", "Done" ]
        );

        api.reorderColumn(0, 2);

        expect(saved.at(-1)?.columns)
            .toEqual([ { value: "Done" }, { value: "To Do", icon: "bx bx-list-ul" } ]);
    });

    it("stores an icon, creating the entry a resolved column may not have yet", async () => {
        const { api, saved } = createApi({ columns: [ { value: "To Do" } ] }, [ "To Do", "Done" ]);

        await api.setColumnIcon("To Do", "bx bx-list-ul");
        expect(saved.at(-1)?.columns).toEqual([ { value: "To Do", icon: "bx bx-list-ul" } ]);

        // "Done" is resolved from the definition, so nothing has written it down yet.
        await api.setColumnIcon("Done", "bx bx-check");
        expect(saved.at(-1)?.columns).toEqual([
            { value: "To Do", icon: "bx bx-list-ul" },
            { value: "Done", icon: "bx bx-check" }
        ]);
    });

    it("clears the icon back to the default rather than storing an empty one", async () => {
        const { api, saved } = createApi(
            { columns: [ { value: "To Do", icon: "bx bx-list-ul" } ] }, [ "To Do" ]);

        await api.setColumnIcon("To Do", undefined);

        expect(saved.at(-1)?.columns).toEqual([ { value: "To Do" } ]);
    });

    it("reads back the icon a column carries, falling back to the default", async () => {
        const { api } = createApi(
            { columns: [ { value: "To Do", icon: "bx bx-list-ul" }, { value: "Done" } ] },
            [ "To Do", "Done", "Backlog" ]);

        expect(api.getColumnIcon("To Do")).toBe("bx bx-list-ul");
        expect(api.getColumnIcon("Done")).toBe(DEFAULT_COLUMN_ICON);
        // Resolved from the definition, so it has no stored entry at all.
        expect(api.getColumnIcon("Backlog")).toBe(DEFAULT_COLUMN_ICON);
    });

    it("reads a relation column's icon off the note the column is", async () => {
        const column = buildNote({ title: "Done", "#iconClass": "bx bx-check" });
        const { api } = createApi({ columns: [] }, [ column.noteId ], undefined, "~status");

        expect(api.getColumnIcon(column.noteId)).toContain("bx bx-check");
    });

    it("reads back the colour a column carries as the classes that tint with it", async () => {
        const { api } = createApi(
            { columns: [ { value: "To Do", color: "#e64d4d" }, { value: "Done" } ] },
            [ "To Do", "Done" ]);

        expect(api.getColumnColorClass("To Do")).toContain("use-note-color");
        expect(api.getColumnColorClass("Done")).toBe("");
    });

    it("stores a colour beside the icon, without either clearing the other", async () => {
        const { api, saved } = createApi({ columns: [ { value: "To Do" } ] }, [ "To Do" ]);

        await api.setColumnIcon("To Do", "bx bx-list-ul");
        await api.setColumnColor("To Do", "#e64d4d");
        expect(saved.at(-1)?.columns).toEqual([
            { value: "To Do", icon: "bx bx-list-ul", color: "#e64d4d" }
        ]);

        // Clearing one leaves the other where it is.
        await api.setColumnColor("To Do", null);
        expect(saved.at(-1)?.columns).toEqual([ { value: "To Do", icon: "bx bx-list-ul" } ]);
    });

    it("archives a column and brings it back, storing nothing once it is not", async () => {
        const { api, saved } = createApi(
            { columns: [ { value: "To Do", icon: "bx bx-list-ul" } ] }, [ "To Do" ]);

        await api.setColumnArchived("To Do", true);
        expect(saved.at(-1)?.columns).toEqual([
            { value: "To Do", icon: "bx bx-list-ul", archived: true }
        ]);

        await api.setColumnArchived("To Do", false);
        expect(saved.at(-1)?.columns).toEqual([ { value: "To Do", icon: "bx bx-list-ul" } ]);
    });

    /**
     * What the column is drawn with is kept by the server, which renames it in the stored columns
     * as well as in the cards and the definition. Checked there; asked for here.
     */
    it("asks the server to rename the column, rather than writing each place itself", async () => {
        const put = vi.spyOn(server, "put").mockResolvedValue(undefined);
        const { api, saved } = createApi(
            { columns: [ { value: "Done", icon: "bx bx-check" } ] }, [ "Done" ]);
        // Cleared: the mock outlives the test that first stood it up, and its calls with it.
        vi.mocked(executeBulkActions).mockClear();

        await api.renameColumn("Done", "Shipped");

        expect(put).toHaveBeenCalledWith(expect.stringMatching(/board\/rename-column$/), {
            attribute: "status", isRelation: false, oldValue: "Done", newValue: "Shipped"
        });
        expect(saved).toEqual([]);
        expect(executeBulkActions).not.toHaveBeenCalled();
    });

    it("records what each column it renames away or deletes became", async () => {
        const { api, pendingRenames } = createApi(
            { columns: [ { value: "To Do" }, { value: "Done" } ] },
            [ "To Do", "Done" ]
        );

        await api.renameColumn("Done", "Shipped");
        expect([ ...pendingRenames ]).toEqual([ [ "Done", "Shipped" ] ]);

        await api.removeColumn("To Do");
        expect([ ...pendingRenames ]).toEqual([ [ "Done", "Shipped" ], [ "To Do", undefined ] ]);

        // A name is only held back while its removal is still landing, never against a column the
        // user deliberately creates under it again.
        await api.addNewColumn("To Do");
        expect([ ...pendingRenames ]).toEqual([ [ "Done", "Shipped" ] ]);
    });

    /**
     * A record left behind by a write that never landed goes on being applied: the column would
     * show under a name nothing carries, or stay hidden though it is still there.
     */
    it("keeps no record of a rename or a deletion the server refused", async () => {
        const { api, saved, pendingRenames } = createApi(
            { columns: [ { value: "To Do" }, { value: "Done" } ] },
            [ "To Do", "Done" ]
        );

        failNextRename();
        await expect(api.renameColumn("Done", "Shipped")).rejects.toThrow("offline");

        failNextBulkAction();
        await expect(api.removeColumn("To Do")).rejects.toThrow("offline");

        expect([ ...pendingRenames ]).toEqual([]);
        expect(saved).toHaveLength(0);
    });

    it("restores the record of an earlier rename when a later one is refused", async () => {
        const { api, pendingRenames } = createApi({ columns: [ { value: "Done" } ] }, [ "Done" ]);

        await api.renameColumn("Done", "Shipped");

        // The refused rename re-pointed the first one on its way in, which has to be put back.
        failNextRename();
        await expect(api.renameColumn("Shipped", "Delivered")).rejects.toThrow("offline");

        expect([ ...pendingRenames ]).toEqual([ [ "Done", "Shipped" ] ]);
    });

    /**
     * Two mutations can be in flight at once, so an undo has to take back what its own call did and
     * nothing else: the record of a mutation still running, or one that has already failed, is not
     * this one's to put back.
     */
    it("takes back only its own record when overlapping mutations fail", async () => {
        const { api, pendingRenames } = createApi(
            { columns: [ { value: "To Do" }, { value: "Done" } ] },
            [ "To Do", "Done" ]
        );

        // Both start before either finishes, and both are refused.
        failNextRename();
        failNextBulkAction();
        const first = api.renameColumn("Done", "Shipped");
        const second = api.removeColumn("To Do");

        await expect(first).rejects.toThrow("offline");
        await expect(second).rejects.toThrow("offline");
        expect([ ...pendingRenames ]).toEqual([]);
    });

    it("leaves a mutation still in flight alone when another one fails", async () => {
        const { api, pendingRenames } = createApi(
            { columns: [ { value: "To Do" }, { value: "Done" } ] },
            [ "To Do", "Done" ]
        );

        let releaseSecond = () => {};
        failNextRename();
        vi.mocked(executeBulkActions).mockImplementationOnce(
            () => new Promise<void>((resolve) => { releaseSecond = resolve; }));

        const failing = api.renameColumn("Done", "Shipped");
        const running = api.removeColumn("To Do");

        await expect(failing).rejects.toThrow("offline");
        // The deletion is still going; its record must have survived the other one's undo.
        expect([ ...pendingRenames ]).toEqual([ [ "To Do", undefined ] ]);

        releaseSecond();
        await running;
    });

    /**
     * The later rename re-points the record the earlier one left, taking the key over. An undo that
     * reverted it anyway would strip a rename still running of the record it needs.
     */
    it("leaves a key a later rename has taken over alone when the earlier one fails", async () => {
        const { api, pendingRenames } = createApi({ columns: [ { value: "Done" } ] }, [ "Done" ]);

        let releaseSecond = () => {};
        failNextRename();
        releaseSecond = holdNextRename();

        const failing = api.renameColumn("Done", "Shipped");
        const running = api.renameColumn("Shipped", "Delivered");

        await expect(failing).rejects.toThrow("offline");
        expect([ ...pendingRenames ])
            .toEqual([ [ "Done", "Delivered" ], [ "Shipped", "Delivered" ] ]);

        releaseSecond();
        await running;
    });

    /**
     * Both writes ask for the same thing and both fail, the earlier one first. Its undo rightly
     * leaves the record alone, the later write still having it; the later undo must then take the
     * record away rather than put back what the earlier one left, which nothing is going to answer
     * for any more.
     */
    it("leaves no record behind when two identical writes both fail", async () => {
        const { api, pendingRenames } = createApi({ columns: [ { value: "Done" } ] }, [ "Done" ]);

        let failSecond = (_: Error) => {};
        failNextRename();
        vi.spyOn(server, "put").mockImplementationOnce(
            () => new Promise<void>((_, reject) => { failSecond = reject; }));

        const first = api.renameColumn("Done", "Shipped");
        const second = api.renameColumn("Done", "Shipped");

        await expect(first).rejects.toThrow("offline");
        expect([ ...pendingRenames ]).toEqual([ [ "Done", "Shipped" ] ]);

        failSecond(new Error("offline"));
        await expect(second).rejects.toThrow("offline");

        // Neither rename landed, so the board has to read the column as it stands.
        expect([ ...pendingRenames ]).toEqual([]);
    });

    /**
     * Two writes can ask for exactly the same thing, and what they leave behind is then the same
     * record. Only the owner tells them apart, so the one that fails cannot take back the other's.
     */
    it("leaves an identical record made by another write alone when one fails", async () => {
        const { api, pendingRenames } = createApi(
            { columns: [ { value: "To Do" }, { value: "Done" } ] },
            [ "To Do", "Done" ]
        );

        let releaseSecond = () => {};
        vi.mocked(executeBulkActions).mockRejectedValueOnce(new Error("offline"));
        vi.mocked(executeBulkActions).mockImplementationOnce(
            () => new Promise<void>((resolve) => { releaseSecond = resolve; }));

        // The same column, deleted twice over before either has answered.
        const failing = api.removeColumn("Done");
        const running = api.removeColumn("Done");

        await expect(failing).rejects.toThrow("offline");
        expect([ ...pendingRenames ]).toEqual([ [ "Done", undefined ] ]);

        releaseSecond();
        await running;
    });

    it("follows a rename through when the one before it has not landed yet", async () => {
        const { api, pendingRenames } = createApi({ columns: [ { value: "Done" } ] }, [ "Done" ]);

        await api.renameColumn("Done", "Shipped");
        await api.renameColumn("Shipped", "Delivered");
        expect([ ...pendingRenames ])
            .toEqual([ [ "Done", "Delivered" ], [ "Shipped", "Delivered" ] ]);

        // Renaming back to a name still pending leaves nothing mapping it to itself.
        await api.renameColumn("Delivered", "Done");
        expect([ ...pendingRenames ]).toEqual([ [ "Shipped", "Done" ], [ "Delivered", "Done" ] ]);
    });

    /**
     * #10689 (second symptom): `columns` is derived render state, so it can lag behind the persisted
     * config. Rebuilding the whole config from it drops every column it has not caught up with.
     */
    it("preserves persisted columns missing from the derived column list", () => {
        const { api, saved } = createApi(
            { columns: [ { value: "To Do" }, { value: "Done" }, { value: "In Progress" } ] },
            [ "To Do", "Done" ]
        );

        api.reorderColumn(0, 2);

        // "In Progress" followed "Done" before the move and still does.
        expect(saved.at(-1)?.columns?.map(col => col.value)).toEqual([ "Done", "In Progress", "To Do" ]);
    });
});

/**
 * Migration 0240 only ever saw the boards that existed when the document was upgraded, and
 * `_template_board` no longer defines the status label, so a board created afterwards has no
 * definition at all until the board view writes one from the columns it resolved.
 */
describe("BoardApi card operations", () => {
    beforeEach(() => {
        // Spies outlive a test otherwise, and one standing in for a write is read by the next.
        vi.restoreAllMocks();
        // Every write the api makes over the wire, answered rather than attempted.
        vi.spyOn(server, "put").mockResolvedValue(undefined);
        vi.mocked(branches.moveBeforeBranch).mockClear();
        vi.mocked(branches.moveAfterBranch).mockClear();
        vi.mocked(note_create.createNote).mockClear();
    });

    /** A board whose second column holds three cards to move among. */
    function createBoardWithCards() {
        const board = buildNote({
            title: "Board",
            children: [
                { title: "First", "#status": "Done" },
                { title: "Second", "#status": "Done" },
                { title: "Third", "#status": "Done" }
            ]
        });

        const items = board.getChildBranches().flatMap(branch => {
            const note = froca.getNoteFromCache(branch.noteId);
            return note ? [ { branch, note } ] : [];
        });
        const byColumn: ColumnMap = new Map([ [ "To Do", [] ], [ "Done", items ] ]);

        return { ...createApi({}, [ "To Do", "Done" ], board, "status", byColumn), items };
    }

    it("files a card moved to another column before the one it was dropped on", async () => {
        const { api, items } = createBoardWithCards();
        const [ first ] = items;

        // The target column is empty, so there is nothing to place it against.
        await api.moveWithinBoard(first.note.noteId, first.branch.branchId, 0, 1, "Done", "To Do");
        expect(branches.moveBeforeBranch).not.toHaveBeenCalled();

        await api.moveWithinBoard(first.note.noteId, first.branch.branchId, 0, 1, "To Do", "Done");
        expect(branches.moveBeforeBranch)
            .toHaveBeenCalledWith([ first.branch.branchId ], items[1].branch.branchId);
    });

    it("reorders within a column, and places past the last card after it", async () => {
        const { api, items } = createBoardWithCards();
        const [ first, , third ] = items;

        await api.moveWithinBoard(first.note.noteId, first.branch.branchId, 0, 2, "Done", "Done");
        expect(branches.moveBeforeBranch)
            .toHaveBeenCalledWith([ first.branch.branchId ], third.branch.branchId);

        await api.moveWithinBoard(first.note.noteId, first.branch.branchId, 0, 3, "Done", "Done");
        expect(branches.moveAfterBranch)
            .toHaveBeenCalledWith([ first.branch.branchId ], third.branch.branchId);
    });

    /**
     * Nothing waits for the board to redraw between two keystrokes, so the column map the API holds
     * still shows the target as it was before the first card arrived.
     */
    it("sends each card past the one it sent before, without waiting for a redraw", async () => {
        const { api, items } = createBoardWithCards();
        const [ first, second ] = items;

        await api.moveToColumnEnd(first.note.noteId, first.branch.branchId, "To Do");
        expect(branches.moveAfterBranch).not.toHaveBeenCalled();

        await api.moveToColumnEnd(second.note.noteId, second.branch.branchId, "To Do");
        expect(branches.moveAfterBranch)
            .toHaveBeenLastCalledWith([ second.branch.branchId ], first.branch.branchId);
    });

    /**
     * That memory stands in for what the column map does not show yet, so it is worth exactly as
     * long as the map: kept across a refresh it names a card that is no longer last, and the next
     * one is filed behind it rather than at the end.
     */
    it("forgets what it sent to a column once the board has drawn that column again", async () => {
        const { api, items } = createBoardWithCards();
        const [ first, second, third ] = items;

        await api.moveToColumnEnd(first.note.noteId, first.branch.branchId, "To Do");

        // The refresh that catches up, and with it a card that now stands last in that column.
        api.update(
            new Map([ [ "To Do", [ first, third ] ], [ "Done", [ second ] ] ]),
            [ "To Do", "Done" ], first.note.getParentNotes()[0], "status", {}, () => {}, () => {});

        // Behind what the board now shows last, not behind what this sent before it.
        await api.moveToColumnEnd(second.note.noteId, second.branch.branchId, "To Do");
        expect(branches.moveAfterBranch)
            .toHaveBeenLastCalledWith([ second.branch.branchId ], third.branch.branchId);
    });

    it("moves nothing for a card dropped where it is, or one it cannot find", async () => {
        const { api, items } = createBoardWithCards();
        const [ first ] = items;

        await api.moveWithinBoard(first.note.noteId, first.branch.branchId, 1, 1, "Done", "Done");
        await api.moveWithinBoard("missingNote", "missingBranch", 0, 2, "Done", "Done");

        expect(branches.moveBeforeBranch).not.toHaveBeenCalled();
        expect(branches.moveAfterBranch).not.toHaveBeenCalled();
    });

    it("takes a card off the board by removing the value it is grouped by", async () => {
        const { api, items } = createBoardWithCards();
        const removeLabel = vi.spyOn(attributes, "removeOwnedLabelByName").mockReturnValue(true);

        await api.removeFromBoard(items[0].note.noteId);
        expect(removeLabel).toHaveBeenCalledWith(items[0].note, "status");

        // A note the cache has never heard of is left alone rather than throwing.
        await api.removeFromBoard("missingNote");
        expect(removeLabel).toHaveBeenCalledTimes(1);
    });

    /**
     * A value the card takes from an ancestor is not the card's to remove, and the board reads the
     * value it ends up with rather than the one it owns.
     */
    it("covers a value the card inherits rather than uncovering it", async () => {
        const board = buildNote({
            title: "Board",
            "#status(inheritable)": "Done",
            children: [ { title: "Card" } ]
        });
        const [ cardId ] = [ ...board.getChildNoteIds() ];
        const { api } = createApi({}, [], board);
        const removeLabel = vi.spyOn(attributes, "removeOwnedLabelByName").mockReturnValue(true);
        const setLabel = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined as never);

        await api.removeFromBoard(cardId);

        expect(setLabel).toHaveBeenCalledWith(cardId, "status", "");
        expect(removeLabel).not.toHaveBeenCalled();
    });

    it("takes a card off a relation board by removing that relation", async () => {
        const board = buildNote({ title: "Board", children: [ { title: "Card" } ] });
        const { api } = createApi({}, [], board, "~status");
        const removeRelation = vi.spyOn(attributes, "removeOwnedRelationByName")
            .mockReturnValue(true);

        await api.removeFromBoard(board.getChildNoteIds()[0]);
        expect(removeRelation).toHaveBeenCalledWith(expect.anything(), "status");
    });

    /**
     * A relation points at a note, so there is no empty one to cover an inherited value with. The
     * card cannot leave its column here, and saying so beats appearing to do nothing.
     */
    it("says why a card cannot leave a column it takes from elsewhere", async () => {
        const board = buildNote({
            title: "Board",
            "~status(inheritable)": "root",
            children: [ { title: "Card" } ]
        });
        const { api } = createApi({}, [], board, "~status");
        const removeRelation = vi.spyOn(attributes, "removeOwnedRelationByName")
            .mockReturnValue(true);
        const message = vi.spyOn(toast, "showMessage").mockReturnValue(undefined);

        await api.removeFromBoard(board.getChildNoteIds()[0]);

        expect(message).toHaveBeenCalledWith("board_view.inherited-column", 3000);
        expect(removeRelation).not.toHaveBeenCalled();
    });

    it("trims the title it renames a card to", async () => {
        const { api, items } = createBoardWithCards();
        const put = vi.spyOn(server, "put").mockResolvedValue(undefined);

        await api.renameCard(items[0].note.noteId, "  Fresh title  ");

        expect(put).toHaveBeenCalledWith(
            "notes/" + items[0].note.noteId + "/title", { title: "Fresh title" });
    });

    it("inserts a card beside another, named and iconed as it was typed", async () => {
        const { api, items } = createBoardWithCards();
        const created = buildNote({ title: "Created" });
        vi.spyOn(server, "put").mockResolvedValue(undefined);
        vi.mocked(note_create.createNote).mockResolvedValue({
            note: created, branch: { branchId: "createdBranch" }
        } as never);

        const result = await api.insertRowAtPosition(
            "Done", items[0].branch.branchId, "after", "Typed", "bx bx-star");

        expect(result).toEqual({ note: created, branch: { branchId: "createdBranch" } });
        expect(note_create.createNote).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                targetBranchId: items[0].branch.branchId,
                target: "after",
                title: "Typed",
                attributes: expect.arrayContaining([
                    expect.objectContaining({ name: "iconClass", value: "bx bx-star" })
                ])
            }));
    });

    /**
     * What a field standing among a column's cards makes: the card goes above the one the field
     * stands over, and a field standing below the last card makes one at the end of the column.
     */
    it("creates a card above the one a field stands over", async () => {
        const { api, items } = createBoardWithCards();
        const created = buildNote({ title: "Created" });
        vi.spyOn(server, "put").mockResolvedValue(undefined);
        vi.mocked(note_create.createNote).mockResolvedValue({
            note: created, branch: { branchId: "createdBranch" }
        } as never);

        expect(await api.createNewItemBefore("Done", items[0].branch.branchId, "First"))
            .toBe(created.noteId);
        expect(note_create.createNote).toHaveBeenLastCalledWith(
            expect.any(String),
            expect.objectContaining({
                targetBranchId: items[0].branch.branchId, target: "before", title: "First"
            }));

        // Below the last card there is nothing to go above, so the card is made at the end.
        expect(await api.createNewItemBefore("Done", undefined, "Last")).toBe(created.noteId);
        const last = vi.mocked(note_create.createNote).mock.calls.at(-1)?.[1];
        expect(last).toEqual(expect.objectContaining({ title: "Last" }));
        expect(last).not.toHaveProperty("target");
    });

    it("reports a card it could not create rather than filing nothing", async () => {
        const { api, items } = createBoardWithCards();
        vi.mocked(note_create.createNote).mockResolvedValue({ note: null, branch: null } as never);

        await expect(api.insertRowAtPosition("Done", items[0].branch.branchId, "after", "Typed"))
            .rejects.toThrow("Failed to create note");
    });

    it("creates a card in a column, and reports a failure without throwing", async () => {
        const { api } = createBoardWithCards();
        const created = buildNote({ title: "Created" });
        const put = vi.spyOn(server, "put").mockResolvedValue(undefined);
        vi.mocked(note_create.createNote).mockResolvedValue({
            note: created, branch: { branchId: "createdBranch" }
        } as never);

        // The column goes in with the note. A write of its own would refresh the whole board a
        // second time, which is what adding a card costs on a board of any size.
        await api.createNewItem("Done", "Created");
        expect(note_create.createNote).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                title: "Created",
                attributes: [ expect.objectContaining({
                    type: "label", name: "status", value: "Done"
                }) ]
            }));
        expect(put).not.toHaveBeenCalled();

        // The board has already drawn the card, so a failure here is logged rather than thrown.
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.mocked(note_create.createNote).mockRejectedValueOnce(new Error("offline"));
        await expect(api.createNewItem("Done", "Another")).resolves.toBeUndefined();
        expect(logged).toHaveBeenCalled();
    });

    /**
     * A column is drawn in the order its notes stand in, so the head of one is the card before its
     * first, not the first child of the board: the columns share one list between them.
     */
    it("makes a card at the head of a column against that column's first card", async () => {
        const { api, items } = createBoardWithCards();
        vi.mocked(note_create.createNote).mockResolvedValue({
            note: buildNote({ title: "Created" }), branch: { branchId: "createdBranch" }
        } as never);

        await api.createNewItem("Done", "First of all", "top");
        expect(note_create.createNote).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                target: "before", targetBranchId: items[0].branch.branchId
            }));

        // An empty column has nothing to be placed against, and the card is simply made.
        await api.createNewItem("Nowhere", "Only one", "top");
        expect(note_create.createNote).toHaveBeenLastCalledWith(
            expect.any(String),
            expect.not.objectContaining({ target: "before" }));
    });

    it("sends a card to the head of its column, and leaves one already there alone", async () => {
        const { api, items } = createBoardWithCards();
        const moveBefore = vi.spyOn(branches, "moveBeforeBranch").mockResolvedValue(undefined);

        const last = items[items.length - 1];
        await api.moveToColumnStart(last.note.noteId, last.branch.branchId, "Done");
        expect(moveBefore).toHaveBeenCalledWith(
            [ last.branch.branchId ], items[0].branch.branchId);

        moveBefore.mockClear();
        await api.moveToColumnStart(items[0].note.noteId, items[0].branch.branchId, "Done");
        expect(moveBefore).not.toHaveBeenCalled();
    });

    /**
     * What a board offers and what it last made a card from live in its own configuration, beside
     * the columns: the templates are the board's, not a column's.
     */
    it("offers the stock templates until the board has its own, and remembers the last used", async () => {
        const { api, saved } = createApi({ columns: [ { value: "To Do" } ] }, [ "To Do" ]);

        expect(api.getCardTemplateIds()).toEqual(DEFAULT_CARD_TEMPLATES);
        expect(api.getLastCardTemplateId()).toBeUndefined();

        await api.setCardTemplateIds([ "type:canvas:application/json", "note:mine" ]);
        expect(saved.at(-1)?.templates).toEqual([ "type:canvas:application/json", "note:mine" ]);
        // Written beside the columns rather than over them.
        expect(saved.at(-1)?.columns).toEqual([ { value: "To Do" } ]);
        expect(api.getCardTemplateIds()).toEqual([ "type:canvas:application/json", "note:mine" ]);

        await api.setLastCardTemplateId("note:mine");
        expect(saved.at(-1)?.template).toBe("note:mine");
        expect(saved.at(-1)?.templates).toEqual([ "type:canvas:application/json", "note:mine" ]);

        // The same one again is not a change, and writing it would refresh the board for nothing.
        const writes = saved.length;
        await api.setLastCardTemplateId("note:mine");
        expect(saved.length).toBe(writes);
    });

    /**
     * A card inserted beside another one is made from the same template as one made in the footer,
     * without the editor it is named in having to know about templates at all.
     */
    it("makes an inserted card from the template last used", async () => {
        const { api } = createBoardWithCards();
        api.setAvailableCardTemplates([
            {
                id: "type:text:text/html", title: "Text", icon: "bx bx-note", group: "type",
                options: { type: "text", mime: "text/html" }
            },
            {
                id: "type:canvas:application/json", title: "Canvas", icon: "bx bx-pen",
                group: "type", options: { type: "canvas", mime: "application/json" }
            }
        ]);
        vi.mocked(note_create.createNote).mockResolvedValue({
            note: buildNote({ title: "Created" }), branch: { branchId: "createdBranch" }
        } as never);

        // Nothing has been used yet, so the first the board offers stands.
        await api.insertRowAtPosition("Done", "branchId", "after", "Typed");
        expect(note_create.createNote).toHaveBeenLastCalledWith(
            expect.any(String), expect.objectContaining({ type: "text" }));

        await api.setLastCardTemplateId("type:canvas:application/json");
        await api.insertRowAtPosition("Done", "branchId", "after", "Typed");
        expect(note_create.createNote).toHaveBeenLastCalledWith(
            expect.any(String), expect.objectContaining({ type: "canvas" }));

        // And a card made in the footer, where the editor hands one over, is made from that.
        await api.createNewItem("Done", "Typed");
        expect(note_create.createNote).toHaveBeenLastCalledWith(
            expect.any(String), expect.objectContaining({ type: "canvas" }));
    });

    /** A board with nothing offered could make no card at all, so an empty set is refused. */
    it("refuses to store an empty set of templates", async () => {
        const { api, saved } = createApi(
            { columns: [], templates: [ "type:text:text/html" ] }, []);

        await api.setCardTemplateIds([]);

        expect(saved).toEqual([]);
        expect(api.getCardTemplateIds()).toEqual([ "type:text:text/html" ]);
    });

    /** What the template names is what the note is made from, in the same write as the card. */
    it("makes a card from the template it is given", async () => {
        const { api } = createBoardWithCards();
        vi.mocked(note_create.createNote).mockResolvedValue({
            note: buildNote({ title: "Created" }), branch: { branchId: "createdBranch" }
        } as never);

        await api.createNewItem("Done", "Drawn", "bottom", undefined, {
            id: "type:canvas:application/json",
            title: "Canvas",
            icon: "bx bx-pen",
            group: "type",
            options: { type: "canvas", mime: "application/json" }
        });

        expect(note_create.createNote).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ type: "canvas", mime: "application/json" }));

        // And the same for a card inserted beside another one.
        await api.insertRowAtPosition("Done", "branchId", "after", "Typed", undefined, {
            id: "note:mine",
            title: "My template",
            icon: "bx bx-star",
            group: "user",
            options: { type: "text", mime: "text/html", templateNoteId: "mine" }
        });

        expect(note_create.createNote).toHaveBeenLastCalledWith(
            expect.any(String),
            expect.objectContaining({ templateNoteId: "mine", type: "text" }));
    });

    it("hands the editing state straight through to the board", () => {
        const { api, editing } = createBoardWithCards();

        api.startEditing("someBranch");
        api.dismissEditingTitle();

        expect(editing).toEqual([ "someBranch", undefined ]);
    });
});

describe("BoardApi.addExistingItem", () => {
    let put: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        put = vi.spyOn(server, "put").mockResolvedValue(undefined);
        vi.mocked(branches.cloneNoteToParentNote).mockClear();
        vi.mocked(dialog.confirm).mockClear().mockResolvedValue(true);
    });

    /**
     * A board holding `insider` a level down, alongside an unrelated `outsider`.
     *
     * The ids are generated rather than fixed: `buildNote` appends to the note attribute cache
     * under the id given, so one reused across tests carries the previous test's attributes.
     */
    function createBoardWith(outsiderAttributes: Record<string, string> = {}) {
        const board = buildNote({
            title: "Board",
            children: [
                { title: "Branch", children: [ { title: "Insider", "#status": "To Do" } ] }
            ]
        });
        const outsider = buildNote({ title: "Outsider", ...outsiderAttributes });
        const branch = froca.getNoteFromCache(board.getChildNoteIds()[0]);

        return {
            api: createApi({ columns: [ { value: "To Do" } ] }, [ "To Do" ], board).api,
            boardId: board.noteId,
            insiderId: branch?.getChildNoteIds()[0] ?? "",
            outsiderId: outsider.noteId
        };
    }

    it("clones a note from outside the board, then files it in the column", async () => {
        const { api, boardId, outsiderId } = createBoardWith();

        expect(await api.addExistingItem("To Do", outsiderId)).toBe(true);
        expect(branches.cloneNoteToParentNote).toHaveBeenCalledWith(outsiderId, boardId);

        const [ url, body ] = put.mock.calls.at(-1) ?? [];
        expect(url).toBe(`notes/${outsiderId}/set-attribute`);
        expect(body).toMatchObject({ type: "label", name: "status", value: "To Do" });
    });

    // The board shows its whole subtree, so a grandchild is already on it.
    it("only changes the column of a note already under the board", async () => {
        const { api, insiderId } = createBoardWith();

        expect(await api.addExistingItem("To Do", insiderId)).toBe(true);
        expect(branches.cloneNoteToParentNote).not.toHaveBeenCalled();
    });

    it("warns before taking a note that carries the grouping label from elsewhere", async () => {
        const { api, outsiderId } = createBoardWith({ "#status": "Done" });

        expect(await api.addExistingItem("To Do", outsiderId)).toBe(true);
        expect(dialog.confirm).toHaveBeenCalledTimes(1);

        vi.mocked(dialog.confirm).mockResolvedValue(false);
        vi.mocked(branches.cloneNoteToParentNote).mockClear();

        expect(await api.addExistingItem("To Do", outsiderId)).toBe(false);
        expect(branches.cloneNoteToParentNote).not.toHaveBeenCalled();
    });

    it("does not warn for a note that carries no value of its own", async () => {
        const { api, outsiderId } = createBoardWith();

        await api.addExistingItem("To Do", outsiderId);
        expect(dialog.confirm).not.toHaveBeenCalled();
    });
});

describe("BoardApi.syncColumnsToDefinition", () => {
    let put: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        // Without restoring first, each spy wraps the previous one and the calls accumulate.
        vi.restoreAllMocks();
        put = vi.spyOn(server, "put").mockResolvedValue(undefined);
    });

    function definitionWritten() {
        const [ url, body ] = put.mock.calls.at(-1) ?? [];
        return { url, ...(body as Record<string, unknown> | undefined) } as {
            url?: string;
            attributeId?: string;
            type?: string;
            name?: string;
            value?: string;
            isInheritable?: boolean;
        };
    }

    it("gives a board with no definition its own promoted select carrying the resolved columns", async () => {
        const { api } = createApi({}, [], buildBoard({}));

        await api.syncColumnsToDefinition([ "To Do", "Done" ]);

        expect(definitionWritten()).toMatchObject({
            // The upsert endpoint, which matches the board's own attribute of this name.
            url: "notes/boardNote/set-attribute",
            type: "label",
            name: "label:status",
            // Promoted, so the column a card sits in is a field the card actually shows.
            value: "promoted,alias=Status,single,select,options=To Do;Done",
            isInheritable: true
        });
    });

    /**
     * Two syncs can be in flight at once — a column edit landing mid-refresh, or a refresh starting
     * before the previous write is back — and both read the same "no definition yet" state. Asking
     * for a new attribute by id would have each create one, leaving the board with two definitions
     * of the same name and every lookup seeing only the first.
     */
    it("addresses the definition by name, so overlapping syncs cannot each create one", async () => {
        const { api } = createApi({}, [], buildBoard({}));

        await Promise.all([
            api.syncColumnsToDefinition([ "To Do" ]),
            api.syncColumnsToDefinition([ "To Do", "Done" ])
        ]);

        expect(put).toHaveBeenCalledTimes(2);
        for (const [ url, body ] of put.mock.calls) {
            expect(url).toBe("notes/boardNote/set-attribute");
            // No id to create a second row under: the server matches the one owned attribute of this
            // name, so whichever request arrives second updates what the first wrote.
            expect(body).not.toHaveProperty("attributeId");
            expect(body).toMatchObject({ name: "label:status" });
        }
    });

    it("names a board grouping by its own label after that label rather than after status", async () => {
        const { api } = createApi({}, [], buildBoard({}), "priority");

        await api.syncColumnsToDefinition([ "High" ]);

        expect(definitionWritten()).toMatchObject({
            name: "label:priority",
            // Still promoted, but unaliased — "Status" is only the name of the default label.
            value: "promoted,single,select,options=High"
        });
    });

    /**
     * Migration 0240 leaves a board that never showed a Status field without one, so re-promoting it
     * here would make a field appear on every card of a board that had deliberately gone without.
     */
    it("keeps an existing definition unpromoted rather than promoting it on the way past", async () => {
        const { api } = createApi({}, [], buildBoard({
            "#label:status": "single,select,options=To Do"
        }));

        await api.syncColumnsToDefinition([ "To Do", "Done" ]);

        expect(definitionWritten().value).toBe("single,select,options=To Do;Done");
    });

    /**
     * The write lands as an entity change, which re-renders the board, which syncs again — so a board
     * whose definition already says what it shows has to write nothing, or it never stops.
     */
    it("writes nothing when the definition already offers exactly those columns", async () => {
        const { api } = createApi({}, [], buildBoard({
            "#label:status": "promoted,single,select,options=To Do;Done"
        }));

        await api.syncColumnsToDefinition([ "To Do", "Done" ]);

        expect(put).not.toHaveBeenCalled();
    });

    it("updates its own definition in place when a column appeared from outside the board", async () => {
        const board = buildBoard({ "#label:status": "promoted,single,select,options=To Do" });
        const { api } = createApi({}, [], board);

        // A note given `#status=Blocked` from the table view shows up as a column here, and the
        // definition has to learn about it as well.
        await api.syncColumnsToDefinition([ "To Do", "Blocked" ]);

        const written = definitionWritten();
        expect(written.value).toBe("promoted,single,select,options=To Do;Blocked");
        // Matched by name on the board itself, so the row it already owns is updated rather than a
        // second definition of the same name being added beside it.
        expect(written.url).toBe(`notes/${board.noteId}/set-attribute`);
        expect(written.name).toBe("label:status");
    });

    it("keeps a differently ordered list, since the order is the one the user arranged", async () => {
        const { api } = createApi({}, [], buildBoard({
            "#label:status": "single,select,options=To Do;Done"
        }));

        await api.syncColumnsToDefinition([ "Done", "To Do" ]);

        expect(definitionWritten().value).toBe("single,select,options=Done;To Do");
    });

    it("copies a definition it does not own into one of its own rather than editing it", async () => {
        const board = buildBoard({}, [
            { noteId: BOARD_TEMPLATE_ID, name: "label:status", value: "promoted,single,text" }
        ]);
        const { api } = createApi({}, [], board);

        await api.syncColumnsToDefinition([ "To Do" ]);

        const written = definitionWritten();
        // The endpoint only ever matches attributes owned by this note, so the template's own row is
        // left alone and the board gains one of its own.
        expect(written.url).toBe(`notes/${board.noteId}/set-attribute`);
        // What the template said is kept, so a board whose field was promoted keeps a promoted field.
        expect(written.value).toBe("promoted,single,select,options=To Do");
    });

    it.each<[ string, string, UntouchableBoard ]>([
        [ "grouping by a relation", "~status", {} ],
        [ "a definition owned by an ancestor", "status", {
            inherited: { noteId: "someAncestor", name: "label:status", value: "promoted,single,text" }
        } ],
        [ "a multi-valued definition", "status", { owned: { "#label:status": "promoted,multi,text" } } ],
        [ "a definition typed as something else", "status", { owned: { "#label:status": "promoted,single,date" } } ]
    ])("leaves the definition alone for %s", async (_label, groupBy, { owned, inherited }) => {
        const board = buildBoard(owned ?? {}, inherited ? [ inherited ] : []);
        const { api } = createApi({}, [], board, groupBy);

        await api.syncColumnsToDefinition([ "To Do" ]);

        expect(put).not.toHaveBeenCalled();
    });

    it("does not invent an empty definition, but does empty one the board owns", async () => {
        const { api: withoutDefinition } = createApi({}, [], buildBoard({}));
        await withoutDefinition.syncColumnsToDefinition([]);
        expect(put).not.toHaveBeenCalled();

        const { api: withDefinition } = createApi({}, [], buildBoard({
            "#label:status": "promoted,single,select,options=To Do"
        }));
        await withDefinition.syncColumnsToDefinition([]);
        expect(definitionWritten().value).toBe("promoted,single,select");
    });
});

/** A board whose definition the sync must not touch, however it came to have one. */
interface UntouchableBoard {
    owned?: Record<string, string>;
    inherited?: { noteId: string; name: string; value: string };
}

/**
 * A board note, optionally reached by definitions it does not own.
 *
 * Froca's mock does not resolve templates, so an inherited definition is pushed onto the note's
 * attribute cache directly — after the owned ones, which is the order `__getCachedAttributes`
 * produces and which the nearest-wins deduplication depends on.
 */
function buildBoard(
    ownedAttributes: Record<string, string>,
    inheritedDefinitions: { noteId: string; name: string; value: string }[] = []
): FNote {
    // buildNote appends to whatever the cache already holds for the id, so the previous test's
    // definitions would otherwise still be on the note.
    delete noteAttributeCache.attributes["boardNote"];

    const board = buildNote({ id: "boardNote", title: "Board", "#viewType": "board", ...ownedAttributes });

    for (const [ index, { noteId, name, value } ] of inheritedDefinitions.entries()) {
        noteAttributeCache.attributes[board.noteId].push(new FAttribute(froca, {
            noteId,
            attributeId: `inherited${index}`,
            type: "label",
            name,
            value,
            position: index,
            isInheritable: true
        }));
    }

    return board;
}

describe("pending writes shared between the views of a board", () => {
    /**
     * Two tabs on one board read the same notes, definition and attachment, so a write in flight on
     * one has to be a write in flight on the other. A view with a record of its own would resolve a
     * column being deleted elsewhere out of the sources that still carry it, and write it back.
     */
    it("hands every view of one board the same record, and another board its own", () => {
        const writes = getPendingWrites("board1|status");

        expect(getPendingWrites("board1|status")).toBe(writes);
        expect(getPendingWrites("board1|priority")).not.toBe(writes);
        expect(getPendingWrites("board2|status")).not.toBe(writes);
    });

    /**
     * A view is handed the record once and holds it while it is mounted, so a record dropped for
     * being empty would leave the views that already have it talking to nobody.
     */
    it("keeps a board's record after the writes on it have all landed", () => {
        const writes = getPendingWrites("board3|status");
        writes.renames.set("Done", undefined);
        writes.renames.delete("Done");

        expect(getPendingWrites("board3|status")).toBe(writes);
    });
});

describe("removing a column with the question put first", () => {
    it("drops it only once agreed, and says so when the write is refused", async () => {
        const { api, saved } = createApi(
            { columns: [ { value: "To Do" }, { value: "Done" } ] },
            [ "To Do", "Done" ]
        );
        const confirm = vi.spyOn(dialog, "confirm").mockResolvedValue(false);
        const error = vi.spyOn(toast, "showError").mockReturnValue(undefined);

        expect(await api.confirmAndRemoveColumn("Done")).toBe(false);
        expect(confirm).toHaveBeenCalled();
        expect(saved).toEqual([]);

        confirm.mockResolvedValue(true);
        expect(await api.confirmAndRemoveColumn("Done")).toBe(true);
        expect(saved.at(-1)?.columns?.map(column => column.value)).toEqual([ "To Do" ]);
        expect(error).not.toHaveBeenCalled();

        // A refusal from the server is reported rather than passing for a deletion.
        vi.mocked(executeBulkActions).mockRejectedValueOnce(new Error("offline"));
        expect(await api.confirmAndRemoveColumn("To Do")).toBe(false);
        expect(error).toHaveBeenCalledWith("board_view.save-error");
    });
});

describe("duplicating a card", () => {
    it("copies it into the board and puts the copy straight after the original", async () => {
        const { api, board } = createApi({ columns: [ { value: "To Do" } ] }, [ "To Do" ]);
        const post = vi.spyOn(server, "post")
            .mockResolvedValue({ branch: { branchId: "copyBranch" } } as never);
        // The global ws stub carries no such method, so it is put there the way bulk_action does.
        const wait = vi.fn(async () => {});
        ws.waitForMaxKnownEntityChangeId = wait as typeof ws.waitForMaxKnownEntityChangeId;

        await api.duplicateItem("card1", "card1Branch");

        expect(post).toHaveBeenCalledWith(`notes/card1/duplicate/${board.noteId}`);
        // Waited for, since the branch the server names has to be in froca before it can be moved.
        expect(wait).toHaveBeenCalled();
        expect(branches.moveAfterBranch).toHaveBeenCalledWith([ "copyBranch" ], "card1Branch");
    });
});

describe("what the board calls the field it groups by", () => {
    it("uses the promoted alias, and the stock word where the definition gives none", () => {
        const named = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            "#label:status": "promoted,alias=Stage,single,select,options=To Do"
        });
        const bare = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            "#label:status": "promoted,single,select,options=To Do"
        });

        expect(createApi({}, [], named).api.getStatusLabel()).toBe("Stage");
        // i18next is never initialised under test, so the fallback comes back as its key.
        expect(createApi({}, [], bare).api.getStatusLabel()).toBe("board_view.status-header");
    });

    /** Handed back by the parser for a bare , which names nothing. */
    it("falls back where the alias is empty", () => {
        const empty = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            "#label:status": "promoted,alias=,single,select,options=To Do"
        });

        expect(createApi({}, [], empty).api.getStatusLabel()).toBe("board_view.status-header");
    });
});

describe("renaming a column to nothing", () => {
    /**
     * The value a column carries is what its cards are grouped by, so an empty name would write an
     * empty label over all of them and take the column with it.
     */
    it("leaves the column and its cards alone", async () => {
        const { api, saved } = createApi(
            { columns: [ { value: "To Do" }, { value: "Done" } ] },
            [ "To Do", "Done" ]
        );
        // A module mock outlives a test, so what earlier ones asked for is cleared first.
        vi.mocked(executeBulkActions).mockClear();

        await api.renameColumn("Done", "");
        await api.renameColumn("Done", "   ");

        expect(executeBulkActions).not.toHaveBeenCalled();
        expect(saved).toEqual([]);
    });
});

describe("collapsing a column", () => {
    it("stores the flag and clears it rather than storing it false", async () => {
        const { api, saved } = createApi(
            { columns: [ { value: "To Do" }, { value: "Done" } ] }, [ "To Do", "Done" ]);

        expect(api.isColumnCollapsed("To Do")).toBe(false);

        await api.setColumnCollapsed("To Do", true);
        expect(saved.at(-1)?.columns).toEqual([ { value: "To Do", collapsed: true }, { value: "Done" } ]);

        await api.setColumnCollapsed("To Do", false);
        expect(saved.at(-1)?.columns).toEqual([ { value: "To Do" }, { value: "Done" } ]);
    });

    /**
     * Turning it on collapses the column as well, so the entry does something the reader can see
     * rather than only deciding what the next open does.
     */
    it("collapses the column as it is set to stay collapsed", async () => {
        const { api, saved } = createApi({ columns: [ { value: "To Do" } ] }, [ "To Do" ]);

        expect(api.isColumnKeptCollapsed("To Do")).toBe(false);

        await api.setColumnKeepCollapsed("To Do", true);
        expect(saved.at(-1)?.columns)
            .toEqual([ { value: "To Do", collapsed: true, keepCollapsed: true } ]);

        // Turning it off on a strip leaves the column collapsed: opening it is what clears that.
        await api.setColumnKeepCollapsed("To Do", false);
        expect(saved.at(-1)?.columns).toEqual([ { value: "To Do", collapsed: true } ]);

        // Turning it off on a column drawn open keeps it open, rather than letting the next
        // column selected shut it again.
        await api.setColumnKeepCollapsed("To Do", true);
        await api.setColumnKeepCollapsed("To Do", false, true);
        expect(saved.at(-1)?.columns).toEqual([ { value: "To Do" } ]);
    });

    /**
     * The inbox is drawn at the head of the board without ever having been written, so the first
     * thing picked for it is also the first entry it gets. Appended, that entry would send the
     * column to the end of the board, the stored order being what the board reads first.
     */
    it("writes a column with no entry yet where the board draws it", async () => {
        const { api, saved } = createApi(
            { columns: [ { value: "To Do" }, { value: "Done" } ] },
            [ INBOX_COLUMN, "To Do", "Done" ]);

        await api.setColumnCollapsed(INBOX_COLUMN, true);
        expect(saved.at(-1)?.columns).toEqual([
            { value: INBOX_COLUMN, collapsed: true }, { value: "To Do" }, { value: "Done" }
        ]);

        // One drawn between two stored columns lands between them.
        const middle = createApi(
            { columns: [ { value: "To Do" }, { value: "Done" } ] },
            [ "To Do", "Doing", "Done" ]);
        await middle.api.setColumnCollapsed("Doing", true);
        expect(middle.saved.at(-1)?.columns?.map(column => column.value))
            .toEqual([ "To Do", "Doing", "Done" ]);
    });

    /** The icon goes in with the column, rather than as a second write and a second refresh. */
    it("stores a new column with the icon picked for it", async () => {
        const { api, saved } = createApi({ columns: [ { value: "To Do" } ] }, [ "To Do" ]);

        await api.addNewColumn("Blocked", false, "bx bx-star");
        expect(saved.at(-1)?.columns)
            .toEqual([ { value: "To Do" }, { value: "Blocked", icon: "bx bx-star" } ]);

        await api.addNewColumn("Doing", true, "bx bx-run");
        expect(saved.at(-1)?.columns?.[0]).toEqual({ value: "Doing", icon: "bx bx-run" });
    });

    /**
     * A column drawn from the definition or from a value its cards carry has no stored entry until
     * something is picked for it, and collapsing the board is what picks for all of them at once.
     */
    it("collapses every column, and opens the ones that are not kept collapsed", async () => {
        const { api, saved } = createApi(
            { columns: [ { value: "To Do", keepCollapsed: true } ] }, [ "To Do", "Done" ]);

        await api.setAllColumnsCollapsed(true);
        expect(saved.at(-1)?.columns).toEqual([
            { value: "To Do", keepCollapsed: true, collapsed: true },
            { value: "Done", collapsed: true }
        ]);

        await api.setAllColumnsCollapsed(false);
        expect(saved.at(-1)?.columns).toEqual([
            { value: "To Do", keepCollapsed: true, collapsed: true },
            { value: "Done" }
        ]);
    });

    it("leaves the column's other properties alone", async () => {
        const { api, saved } = createApi(
            { columns: [ { value: "To Do", icon: "bx bx-star", limit: 3 } ] }, [ "To Do" ]);

        await api.setColumnCollapsed("To Do", true);

        expect(saved.at(-1)?.columns).toEqual([
            { value: "To Do", icon: "bx bx-star", limit: 3, collapsed: true }
        ]);
    });
});

describe("reordering columns the board is not showing all of", () => {
    /**
     * A column the config keeps but the board does not show, such as a disabled inbox, is missing
     * from the list the reorder counts in. It is kept rather than dropped or moved to the end.
     */
    it("keeps a stored column the render list does not carry", () => {
        const { api, saved } = createApi(
            { columns: [
                { value: "", icon: "bx bx-inbox" }, { value: "To Do" }, { value: "Done" }
            ] },
            [ "To Do", "Done" ]
        );

        // "Done" before "To Do", counted among the two the board shows.
        api.reorderColumn(1, 0);

        expect(saved.at(-1)?.columns).toEqual([
            { value: "", icon: "bx bx-inbox" },
            { value: "Done" },
            { value: "To Do" }
        ]);
    });

    /**
     * The hidden column follows the same column it followed before. Reinserting it at the index it
     * held in the config would place it between whichever columns the move left there.
     */
    it("keeps a hidden column beside the column it followed", () => {
        const { api, saved } = createApi(
            { columns: [
                { value: "To Do" }, { value: "" }, { value: "Done" }
            ] },
            [ "To Do", "Done" ]
        );

        // "Done" before "To Do", counted among the two the board shows.
        api.reorderColumn(1, 0);

        expect(saved.at(-1)?.columns).toEqual([
            { value: "Done" },
            { value: "To Do" },
            { value: "" }
        ]);
    });

    it("keeps a run of hidden columns in order behind the same column", () => {
        const { api, saved } = createApi(
            { columns: [
                { value: "To Do" }, { value: "" }, { value: "Archived" }, { value: "Done" }
            ] },
            [ "To Do", "Done" ]
        );

        api.reorderColumn(1, 0);

        expect(saved.at(-1)?.columns).toEqual([
            { value: "Done" },
            { value: "To Do" },
            { value: "" },
            { value: "Archived" }
        ]);
    });
});

describe("the icon the inbox column wears", () => {
    it("is an inbox until one is picked for it", () => {
        const { api } = createApi(
            { columns: [ { value: "" }, { value: "To Do" } ] }, [ "", "To Do" ]);

        expect(api.getColumnIcon("")).toBe("bx bxs-inbox");
        // Every other column keeps the stock one.
        expect(api.getColumnIcon("To Do")).toBe(DEFAULT_COLUMN_ICON);
    });

    it("gives way to the one picked for it", () => {
        const { api } = createApi(
            { columns: [ { value: "", icon: "bx bx-star" } ] }, [ "" ]);

        expect(api.getColumnIcon("")).toBe("bx bx-star");
    });
});

describe("renaming a column that names itself", () => {
    /** The inbox stands for the cards carrying no value, so its name is its own, not theirs. */
    it("writes the inbox a name of its own and leaves its cards alone", async () => {
        const { api, saved } = createApi(
            { columns: [ { value: "", icon: "bx bxs-inbox" }, { value: "To Do" } ] },
            [ "", "To Do" ]
        );
        vi.mocked(executeBulkActions).mockClear();

        await api.setColumnTitle("", "Unsorted");

        expect(saved.at(-1)?.columns).toEqual([
            { value: "", icon: "bx bxs-inbox", displayName: "Unsorted" },
            { value: "To Do" }
        ]);
        expect(api.getColumnTitle("")).toBe("Unsorted");
        // Its cards carry no value, so there is none to write across them.
        expect(executeBulkActions).not.toHaveBeenCalled();
    });

    it("renames any other column by the value its cards carry", async () => {
        const { api } = createApi(
            { columns: [ { value: "" }, { value: "To Do" } ] }, [ "", "To Do" ]);
        const put = vi.spyOn(server, "put").mockResolvedValue(undefined);

        await api.setColumnTitle("To Do", "Doing");

        expect(put).toHaveBeenCalledWith(expect.stringMatching(/board\/rename-column$/),
            expect.objectContaining({ oldValue: "To Do", newValue: "Doing" }));
    });

    it("leaves either kind alone when given nothing", async () => {
        const { api, saved } = createApi({ columns: [ { value: "" } ] }, [ "" ]);
        vi.mocked(executeBulkActions).mockClear();

        await api.setColumnTitle("", "   ");

        expect(saved).toEqual([]);
        expect(api.getColumnTitle("")).toBe("board_view.inbox");
    });
});

describe("filing a card under the inbox", () => {
    /**
     * Landing in the inbox means carrying no value at all. A relation the card takes from elsewhere
     * would still point somewhere once the owned one goes, so the card would arrive in that column
     * rather than the inbox: it is refused and said so, instead of moved somewhere unasked.
     */
    it("refuses a relation card that would still point somewhere", async () => {
        const board = buildNote({
            title: "Board",
            "~status(inheritable)": "root",
            children: [ { title: "Card", "~status": "root" } ]
        });
        const { api } = createApi({}, [], board, "~status");
        const removeRelation = vi.spyOn(attributes, "removeOwnedRelationByName")
            .mockReturnValue(true);
        const message = vi.spyOn(toast, "showMessage").mockReturnValue(undefined);

        await api.changeColumn(board.getChildNoteIds()[0], "");

        expect(message).toHaveBeenCalledWith("board_view.inherited-column", 3000);
        expect(removeRelation).not.toHaveBeenCalled();
    });

    /** Taking the card off the board is a lesser thing to ask, and still takes what it owns. */
    it("still removes what such a card owns when it is taken off the board", async () => {
        const board = buildNote({
            title: "Board",
            "~status(inheritable)": "root",
            children: [ { title: "Card", "~status": "root" } ]
        });
        const { api } = createApi({}, [], board, "~status");
        const removeRelation = vi.spyOn(attributes, "removeOwnedRelationByName")
            .mockReturnValue(true);

        await api.removeFromBoard(board.getChildNoteIds()[0]);

        expect(removeRelation).toHaveBeenCalled();
    });
});

describe("the promoted attributes a card shows", () => {
    /** A board defining two promoted labels, which is what the cards can show. */
    function boardWithAttributes() {
        return buildNote({
            title: "Board",
            "#label:dueDate(inheritable)": "promoted,single,date",
            "#label:owner(inheritable)": "promoted,single,text"
        });
    }

    /**
     * A board is usually given `#hidePromotedAttributes` so its own title row stays clear, and it
     * groups by a label its cards draw as columns rather than as a value.
     */
    it("lists what the cards can draw, whatever the board hides on itself", () => {
        const board = buildNote({
            title: "Board",
            "#hidePromotedAttributes": "",
            "#label:status(inheritable)": "promoted,single,text",
            "#label:dueDate(inheritable)": "promoted,single,date",
            "#label:internal(inheritable)": "single,text"
        });
        const { api } = createApi({}, [], board);

        // The label it groups by is drawn as a column, and an unpromoted one is still drawn.
        expect(api.getVisiblePromotedAttributeNames()).toEqual([ "dueDate", "internal" ]);
    });

    it("shows every one of them until the reader arranges them", () => {
        const { api } = createApi({}, [], boardWithAttributes());

        expect(api.getVisiblePromotedAttributeNames()).toEqual([ "dueDate", "owner" ]);
        expect(api.getStoredPromotedAttributes()).toBeUndefined();
    });

    it("follows the stored order, and leaves out what is hidden", () => {
        const stored = [ { name: "owner" }, { name: "dueDate", hidden: true } ];
        const { api } = createApi({ promotedAttributes: stored }, [], boardWithAttributes());

        expect(api.getVisiblePromotedAttributeNames()).toEqual([ "owner" ]);
        expect(api.getPromotedAttributes().map(attribute => attribute.name))
            .toEqual([ "owner", "dueDate" ]);
        expect(api.getStoredPromotedAttributes()).toBe(stored);
    });

    it("stores the whole list, an attribute the board has dropped along with it", async () => {
        const { api, saved } = createApi(
            { promotedAttributes: [ { name: "gone" } ] }, [], boardWithAttributes());

        await api.setPromotedAttributes(api.getPromotedAttributes().map(
            attribute => attribute.name === "owner" ? { ...attribute, hidden: true } : attribute));

        expect(saved.at(-1)?.promotedAttributes)
            .toEqual([ { name: "dueDate" }, { name: "owner", hidden: true } ]);
    });
});
