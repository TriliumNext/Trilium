import { beforeAll, describe, expect, it } from "vitest";

import becca from "../../becca/becca";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

let api: CoreApiTester;

describe("Board API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("renames a column in the cards, the definition and the stored configuration at once", async () => {
        const board = await buildBoard([ "Alpha", "Alpha", "Beta" ]);

        const res = await api.put<{ cards: number }>(
            `/api/notes/${board.noteId}/board/rename-column`,
            { body: { attribute: "status", oldValue: "Alpha", newValue: "Gamma" } });

        expect(res.status).toBe(200);
        expect(res.body.cards).toBe(2);
        expect(statuses(board.noteId)).toEqual([ "Gamma", "Gamma", "Beta" ]);
        // In place in both, so the column keeps the position it is drawn in.
        expect(definitionOptions(board.noteId)).toEqual([ "Gamma", "Beta" ]);
        expect(storedColumns(board.noteId)).toEqual([ "Gamma", "Beta" ]);
    });

    it("keeps what a column is drawn with, and leaves the other columns alone", async () => {
        const board = await buildBoard([ "Alpha", "Beta" ]);

        await api.put(`/api/notes/${board.noteId}/board/rename-column`,
            { body: { attribute: "status", oldValue: "Beta", newValue: "Delta" } });

        const columns = configOf(board.noteId).columns;
        expect(columns.map(column => column.value)).toEqual([ "Alpha", "Delta" ]);
        expect(columns[1].color).toBe("#ff0000");
        expect(columns[0].color).toBeUndefined();
    });

    it("refuses a blank name, and says so rather than writing anything", async () => {
        const board = await buildBoard([ "Alpha" ]);

        const res = await api.put(`/api/notes/${board.noteId}/board/rename-column`,
            { body: { attribute: "status", oldValue: "Alpha", newValue: "  " } });

        expect(res.status).toBe(400);
        expect(statuses(board.noteId)).toEqual([ "Alpha" ]);
    });

    it("does nothing at all for a column renamed to the name it already has", async () => {
        const board = await buildBoard([ "Alpha" ]);

        const res = await api.put<{ cards: number }>(
            `/api/notes/${board.noteId}/board/rename-column`,
            { body: { attribute: "status", oldValue: "Alpha", newValue: "Alpha" } });

        expect(res.status).toBe(200);
        expect(res.body.cards).toBe(0);
        expect(statuses(board.noteId)).toEqual([ "Alpha" ]);
    });

    it("renames a column of a board grouped by a relation", async () => {
        const board = await buildBoard([]);
        const target = await createTextNote(api, { title: "Target" });
        const other = await createTextNote(api, { title: "Other" });
        const card = await createTextNote(api, { parentNoteId: board.noteId, title: "Card" });
        await api.put(`/api/notes/${card.noteId}/set-attribute`, {
            body: { type: "relation", name: "status", value: target.noteId }
        });

        const res = await api.put<{ cards: number }>(
            `/api/notes/${board.noteId}/board/rename-column`, {
                body: {
                    attribute: "status", isRelation: true,
                    oldValue: target.noteId, newValue: other.noteId
                }
            });

        expect(res.status).toBe(200);
        expect(res.body.cards).toBe(1);
        expect(becca.getNoteOrThrow(card.noteId).getOwnedRelationValue("status")).toBe(other.noteId);
    });

    /**
     * A board holds a column list per grouping, and one of them can carry a column of the same name
     * as another's. A rename belongs to the grouping it was made on and to no other.
     */
    it("renames a column of the grouping it was made on, leaving other lists alone", async () => {
        const board = await createTextNote(api, { title: "Board" });
        const card = await createTextNote(api, { parentNoteId: board.noteId, title: "Card" });
        await api.put(`/api/notes/${card.noteId}/set-attribute`,
            { body: { type: "label", name: "priority", value: "High" } });
        await api.post(`/api/notes/${board.noteId}/attachments`, {
            body: {
                title: "board.json", role: "viewConfig", mime: "application/json",
                content: JSON.stringify({
                    columns: [ { value: "High", color: "#ff0000" } ],
                    priorityViewColumns: [
                        { value: "High", icon: "bx bx-up-arrow" }, { value: "Low" }
                    ]
                })
            }
        });

        const res = await api.put<{ cards: number }>(
            `/api/notes/${board.noteId}/board/rename-column`,
            { body: { attribute: "priority", oldValue: "High", newValue: "Urgent" } });

        expect(res.status).toBe(200);
        expect(res.body.cards).toBe(1);
        expect(configOf(board.noteId).priorityViewColumns).toEqual([
            { value: "Urgent", icon: "bx bx-up-arrow" }, { value: "Low" }
        ]);
        expect(configOf(board.noteId).columns).toEqual([ { value: "High", color: "#ff0000" } ]);
    });

    /** A board with one card per value given, the second column carrying a colour of its own. */
    async function buildBoard(values: string[]) {
        const board = await createTextNote(api, { title: "Board" });
        const columns = [ ...new Set(values) ];

        await api.put(`/api/notes/${board.noteId}/set-attribute`, {
            body: {
                type: "label", name: "label:status", isInheritable: true,
                value: `promoted,single,select,options=${columns.join(";")}`
            }
        });

        for (const value of values) {
            const card = await createTextNote(api,
                { parentNoteId: board.noteId, title: `Card ${value}` });
            await api.put(`/api/notes/${card.noteId}/set-attribute`,
                { body: { type: "label", name: "status", value } });
        }

        await api.post(`/api/notes/${board.noteId}/attachments`, {
            body: {
                title: "board.json", role: "viewConfig", mime: "application/json",
                content: JSON.stringify({
                    columns: columns.map((value, index) =>
                        index === 1 ? { value, color: "#ff0000" } : { value })
                })
            }
        });

        return board;
    }

    function statuses(boardId: string) {
        return becca.getNoteOrThrow(boardId).getChildNotes()
            .map(card => card.getOwnedLabelValue("status"));
    }

    function definitionOptions(boardId: string) {
        const definition = becca.getNoteOrThrow(boardId).getOwnedLabelValue("label:status") ?? "";
        return definition.split("options=")[1]?.split(";") ?? [];
    }

    type StoredColumns = { value: string, color?: string, icon?: string }[];

    function configOf(boardId: string): Record<string, StoredColumns> & { columns: StoredColumns } {
        const attachment = becca.getNoteOrThrow(boardId).getAttachmentByTitle("board.json");
        return JSON.parse(attachment?.getContent().toString() ?? "{}");
    }

    function storedColumns(boardId: string) {
        return configOf(boardId).columns.map(column => column.value);
    }
});
