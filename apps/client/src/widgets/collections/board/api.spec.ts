import { beforeEach, describe, expect, it, vi } from "vitest";

import FAttribute from "../../../entities/fattribute";
import FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import noteAttributeCache from "../../../services/note_attribute_cache";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import { BoardViewData } from ".";
import BoardApi from "./api";
import { BOARD_TEMPLATE_ID, getStatusDefinition } from "./columns";

vi.mock("../../../services/bulk_action", () => ({
    executeBulkActions: vi.fn(async () => {})
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
    statusAttribute = "status"
) {
    const board = parentNote ?? buildNote({ title: "Board" });
    const saved: BoardViewData[] = [];
    const api = new BoardApi(
        new Map(),
        columns,
        board,
        statusAttribute,
        viewConfig,
        (newConfig) => saved.push(newConfig),
        () => {},
        getStatusDefinition(board, statusAttribute)
    );
    return { api, saved, board };
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
        await api.renameColumn("Done", "Shipped");
        await api.removeColumn("To Do");

        expect(saved).toHaveLength(3);
        for (const config of saved) {
            expect(config).not.toBe(viewConfig);
            expect(config.columns).not.toBe(viewConfig.columns);
        }
        expect(saved.map(config => config.columns?.map(col => col.value))).toEqual([
            [ "To Do", "Done", "In Progress" ],
            [ "To Do", "Shipped", "In Progress" ],
            [ "Shipped", "In Progress" ]
        ]);
    });

    it("does not save anything for a duplicate column", async () => {
        const { api, saved } = createApi({ columns: [ { value: "To Do" } ] }, [ "To Do" ]);
        expect(await api.addNewColumn("To Do")).toBe(false);
        expect(saved).toHaveLength(0);
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

        expect(saved.at(-1)?.columns?.map(col => col.value)).toEqual([ "Done", "To Do", "In Progress" ]);
    });
});

/**
 * Migration 0240 only ever saw the boards that existed when the document was upgraded, and
 * `_template_board` no longer defines the status label, so a board created afterwards has no
 * definition at all until the board view writes one from the columns it resolved.
 */
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
