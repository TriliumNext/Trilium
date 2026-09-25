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

    /**
     * A column reference names a column by an id rather than by the value its cards carry, which a
     * rename rewrites. Assigning the id here rather than in the client is what settles a race: two
     * clients copying a reference to the same column each offer an id, and both are answered with
     * the one that arrived first.
     */
    describe("assigning a column its reference id", () => {
        it("assigns the offered id to a column that has none, keeping what it holds", async () => {
            const board = await buildBoard([ "Alpha", "Beta" ]);

            const res = await api.put<{ id: string, stored: boolean }>(
                `/api/notes/${board.noteId}/board/column-id`,
                { body: { value: "Beta", id: "colBeta00001" } });

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ id: "colBeta00001", stored: true });
            expect(configOf(board.noteId).columns).toEqual([
                { value: "Alpha" },
                { value: "Beta", color: "#ff0000", id: "colBeta00001" }
            ]);
        });

        it("answers with the id a column already has, ignoring the one offered", async () => {
            const board = await buildBoard([ "Alpha" ]);
            await api.put(`/api/notes/${board.noteId}/board/column-id`,
                { body: { value: "Alpha", id: "colFirst0001" } });

            const res = await api.put<{ id: string, stored: boolean }>(
                `/api/notes/${board.noteId}/board/column-id`,
                { body: { value: "Alpha", id: "colSecond001" } });

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ id: "colFirst0001", stored: true });
            expect(configOf(board.noteId).columns?.[0].id).toBe("colFirst0001");
        });

        /** A column drawn from the definition or from its cards has no stored entry to hold an id. */
        it("writes an entry for a column the configuration does not list", async () => {
            const board = await buildBoard([ "Alpha", "Beta" ]);

            const res = await api.put<{ id: string }>(
                `/api/notes/${board.noteId}/board/column-id`,
                { body: { value: "Gamma", id: "colGamma0001" } });

            expect(res.status).toBe(200);
            expect(configOf(board.noteId).columns).toEqual([
                { value: "Alpha" },
                { value: "Beta", color: "#ff0000" },
                { value: "Gamma", id: "colGamma0001" }
            ]);
        });

        it("writes into the column list of the grouping it is given", async () => {
            const board = await buildBoard([ "Alpha" ]);

            await api.put(`/api/notes/${board.noteId}/board/column-id`,
                { body: { groupBy: "priority", value: "High", id: "colHigh00001" } });

            expect(configOf(board.noteId).priorityViewColumns)
                .toEqual([ { value: "High", id: "colHigh00001" } ]);
            expect(configOf(board.noteId).columns?.some(column => column.id)).toBe(false);
        });

        /**
         * `board.json` is the only place a column id is kept, so an id reported as stored when it
         * was not would hand the client a link that resolves to nothing. Saying so sends the client
         * to write the id itself, with the rest of the configuration the board is drawing.
         */
        it("says it stored nothing for a configuration it cannot read", async () => {
            // A board of its own per case: an attachment is added rather than replaced, and the
            // first one with the title is the one that is read.
            for (const content of [ "{ truncated", "null", "[]", "42" ]) {
                const board = await createTextNote(api, { title: "Board" });
                await api.post(`/api/notes/${board.noteId}/attachments`, {
                    body: {
                        title: "board.json", role: "viewConfig", mime: "application/json", content
                    }
                });

                const res = await api.put<{ id: string, stored: boolean }>(
                    `/api/notes/${board.noteId}/board/column-id`,
                    { body: { value: "Alpha", id: "colAlpha0001" } });

                expect(res.status, content).toBe(200);
                expect(res.body, content).toMatchObject({ id: "colAlpha0001", stored: false });
                // Left as it was, so it can still be repaired by hand.
                expect(attachmentOf(board.noteId), content).toBe(content);
            }
        });

        it("refuses a blank id and a missing column, without writing anything", async () => {
            const board = await buildBoard([ "Alpha" ]);
            const before = JSON.stringify(configOf(board.noteId));

            for (const body of [ { value: "Alpha", id: "  " }, { id: "colAlpha0001" } ]) {
                const res = await api.put(`/api/notes/${board.noteId}/board/column-id`, { body });
                expect(res.status, JSON.stringify(body)).toBe(400);
            }

            expect(JSON.stringify(configOf(board.noteId))).toBe(before);
        });
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

    type StoredColumns = { value: string, color?: string, icon?: string, id?: string }[];

    function configOf(boardId: string): Record<string, StoredColumns> & { columns: StoredColumns } {
        const attachment = becca.getNoteOrThrow(boardId).getAttachmentByTitle("board.json");
        return JSON.parse(attachment?.getContent().toString() ?? "{}");
    }

    /** The raw content of `board.json`, for a configuration no parser should be handed. */
    function attachmentOf(boardId: string) {
        return becca.getNoteOrThrow(boardId).getAttachmentByTitle("board.json")
            ?.getContent().toString();
    }

    function storedColumns(boardId: string) {
        return configOf(boardId).columns.map(column => column.value);
    }
});
