import type {
    BlocksConflictResponse, CreateReferenceResponse, MarkedHeadingsResponse, NoteBlocksResponse,
    NoteReferencesResponse, NoteSaveBase, SaveConflictResponse, SavedAttachmentRow,
    SaveNoteBlocksResponse, SaveNoteDataRequest, SaveNoteDataResponse
} from "@triliumnext/commons";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import becca from "../../becca/becca";
import { load } from "../../becca/becca_loader";
import { getContext } from "../../services/context";
import eraseService from "../../services/erase";
import noteService from "../../services/notes";
import {
    readContent, type ReferenceProvider, registerReferenceProvider, unregisterReferenceProvider
} from "../../services/references/index";
import { getSql } from "../../services/sql/index";
import { registerVirtualNoteProvider, unregisterVirtualNoteProvider } from "../../services/virtual_notes";
import ws from "../../services/ws";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core note routes through {@link CoreApiTester} (no Express),
 * so this spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;

function countNoteRevisions(noteId: string) {
    return getSql().getValue<number>("SELECT COUNT(*) FROM revisions WHERE noteId = ?", [ noteId ]);
}

function noteIsDeleted(noteId: string): number | null {
    const row = getSql().getRowOrNull<{ isDeleted: number }>(
        "SELECT isDeleted FROM notes WHERE noteId = ?",
        [ noteId ]
    );
    return row ? row.isDeleted : null;
}

describe("Notes API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    describe("reading", () => {
        it("returns note metadata for an existing note", async () => {
            const res = await api.get<{ noteId: string; type: string }>("/api/notes/root");
            expect(res.status).toBe(200);
            expect(res.body.noteId).toBe("root");
            expect(res.body.type).toBeTruthy();
        });

        it("returns timestamp metadata", async () => {
            const res = await api.get("/api/notes/root/metadata");
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({
                dateCreated: expect.any(String),
                utcDateCreated: expect.any(String),
                dateModified: expect.any(String),
                utcDateModified: expect.any(String)
            });
        });

        it("returns the timestamps of several notes at once, skipping the ones it cannot find", async () => {
            const note = await createTextNote(api, { title: "Bulk metadata" });

            const res = await api.post<Record<string, { utcDateCreated: string }>>(
                "/api/notes/metadata",
                { body: { noteIds: [ "root", note.noteId, "missingNote123" ] } });

            expect(res.status).toBe(200);
            expect(Object.keys(res.body).sort()).toEqual([ note.noteId, "root" ].sort());
            expect(res.body[note.noteId]).toMatchObject({
                dateCreated: expect.any(String),
                utcDateCreated: expect.any(String),
                dateModified: expect.any(String),
                utcDateModified: expect.any(String)
            });
        });

        it("400s a bulk metadata request whose noteIds are not a list of strings", async () => {
            expect((await api.post("/api/notes/metadata", { body: {} })).status).toBe(400);
            expect((await api.post("/api/notes/metadata", { body: { noteIds: "root" } })).status)
                .toBe(400);
            expect((await api.post("/api/notes/metadata", { body: { noteIds: [ 1 ] } })).status)
                .toBe(400);
        });

        it("returns the note blob", async () => {
            const res = await api.get<{ blobId: string; content: string }>("/api/notes/root/blob");
            expect(res.status).toBe(200);
            expect(res.body.blobId).toBeTruthy();
            expect(typeof res.body.content).toBe("string");
        });

        it("404s for a missing note", async () => {
            const res = await api.get("/api/notes/missingNote123");
            expect(res.status).toBe(404);
        });
    });

    describe("creating", () => {
        it("creates a child note under root", async () => {
            interface CreateResponse {
                note: { noteId: string; title: string };
                branch: { parentNoteId: string };
            }
            const res = await api.post<CreateResponse>(
                "/api/notes/root/children?target=into",
                { body: { title: "Created via API", type: "text", content: "<p>body</p>" } }
            );

            expect(res.status).toBe(200);
            expect(res.body.note.noteId).toBeTruthy();
            expect(res.body.note.title).toBe("Created via API");
            expect(res.body.branch.parentNoteId).toBe("root");
        });

        // What "cut selection into sub-note" does: the new note is handed HTML carrying the source
        // note's pictures, and the source then drops them from its own content, scheduling those
        // attachments for erasure. The new note has to end up owning copies, not pointing at them.
        it("copies a foreign attachment referenced by the content it is created with", async () => {
            const source = await createTextNote(api, { content: "<p>source</p>" });
            const save = await api.post(`/api/notes/${source.noteId}/attachments`, {
                body: { role: "image", mime: "image/png", title: "picture.png", content: "picture bytes" }
            });
            expect(save.status).toBe(204);

            const [ original ] = (await api.get<{ attachmentId: string }[]>(
                `/api/notes/${source.noteId}/attachments`
            )).body;

            const created = await api.post<{ note: { noteId: string } }>(
                "/api/notes/root/children?target=into",
                {
                    body: {
                        title: "Cut selection",
                        type: "text",
                        content: `<p><img src="api/attachments/${original.attachmentId}/image/picture.png"></p>`
                    }
                }
            );
            expect(created.status).toBe(200);
            const { noteId } = created.body.note;

            const copies = await api.get<{ attachmentId: string; ownerId: string; title: string }[]>(
                `/api/notes/${noteId}/attachments`
            );
            expect(copies.body).toHaveLength(1);
            expect(copies.body[0].ownerId).toBe(noteId);
            expect(copies.body[0].attachmentId).not.toBe(original.attachmentId);

            const blob = await api.get<{ content: string }>(`/api/notes/${noteId}/blob`);
            expect(blob.body.content).toContain(`api/attachments/${copies.body[0].attachmentId}/image/`);
            expect(blob.body.content).not.toContain(original.attachmentId);
        });

        it("400s when the target query param is invalid", async () => {
            const res = await api.post("/api/notes/root/children", {
                body: { title: "no target", type: "text" }
            });
            expect(res.status).toBe(400);
        });
    });

    describe("updating", () => {
        it("changes a note title and returns the updated note", async () => {
            const { noteId } = await createTextNote(api, { title: "Before" });

            const res = await api.put<{ title: string }>(`/api/notes/${noteId}/title`, {
                body: { title: "After" }
            });
            expect(res.status).toBe(200);
            expect(res.body.title).toBe("After");
        });

        it("updates note content", async () => {
            const { noteId } = await createTextNote(api, { content: "<p>old</p>" });

            const update = await api.put(`/api/notes/${noteId}/data`, {
                body: { content: "<p>new</p>" }
            });
            expect(update.status).toBe(204);

            const blob = await api.get<{ content: string }>(`/api/notes/${noteId}/blob`);
            expect(blob.body.content).toContain("new");
        });
    });

    describe("saving with a base", () => {
        /** The base of the note `noteId` as it is now. */
        function getBase(noteId: string): NoteSaveBase {
            const note = becca.getNoteOrThrow(noteId);
            return { blobId: note.blobId ?? "", type: note.type, mime: note.mime };
        }

        function save(noteId: string, body: SaveNoteDataRequest) {
            return api.put<SaveNoteDataResponse & SaveConflictResponse>(
                `/api/notes/${noteId}/data`, { body }
            );
        }

        it("saves on its base and answers the next one, and refuses a stale base", async () => {
            const { noteId } = await createTextNote(api, { content: "<p>One</p>" });
            const note = becca.getNoteOrThrow(noteId);
            const base = getBase(noteId);

            const saved = await save(noteId, { content: "<p>Two</p>", base });
            expect(saved.status).toBe(200);
            expect(saved.body).toStrictEqual({ blobId: note.blobId, attachments: [] });
            expect(note.getContent()).toBe("<p>Two</p>");

            const refused = await save(noteId, { content: "<p>Three</p>", base });
            expect(refused.status).toBe(409);
            expect(refused.body).toMatchObject({
                reason: "version", blobId: note.blobId, type: "text", mime: "text/html",
                isVersioned: true, content: "<p>Two</p>"
            });
            expect(note.getContent()).toBe("<p>Two</p>");

            // The answer is the content as stored when the server changed what was sent.
            const linked = `<p><a href="https://example.com/#root/${noteId}">Self</a></p>`;
            const rewritten = await save(noteId, { content: linked, base: getBase(noteId) });
            expect(rewritten.body.content).toBe(`<p><a href="#root/${noteId}">Self</a></p>`);
            expect(rewritten.body.content).toBe(note.getContent());

            for (const malformedBase of [ { blobId: 1 }, null ]) {
                const malformed = await save(noteId, {
                    content: "<p>x</p>", base: malformedBase as never
                });
                expect(malformed.status).toBe(400);
            }
        });

        it("refuses a base of another format, but not another language of code", async () => {
            const { noteId } = await createTextNote(api, { content: "<p>Text</p>" });
            const textBase = getBase(noteId);
            const note = becca.getNoteOrThrow(noteId);
            getContext().init(() => {
                note.type = "code";
                note.mime = "text/x-markdown";
                note.save();
            });

            const refused = await save(noteId, { content: "<p>Edited</p>", base: textBase });
            expect(refused.status).toBe(409);
            expect(refused.body).toMatchObject({ reason: "format", type: "code" });
            expect(note.getContent()).toBe("<p>Text</p>");

            const markdownBase = getBase(noteId);
            getContext().init(() => {
                note.mime = "text/plain";
                note.save();
            });
            expect((await save(noteId, { content: "Edited", base: markdownBase })).body)
                .toMatchObject({ reason: "format" });
            const codeBase = getBase(noteId);
            getContext().init(() => {
                note.mime = "application/javascript;env=frontend";
                note.save();
            });
            expect((await save(noteId, { content: "Edited", base: codeBase })).status).toBe(200);
        });

        it("keeps the other version as a revision, on the blob that a conflict named", async () => {
            const { noteId } = await createTextNote(api, { content: "<p>Mine</p>" });
            const note = becca.getNoteOrThrow(noteId);
            const base = getBase(noteId);
            await save(noteId, { content: "<p>Theirs</p>", base });

            const conflict = (await save(noteId, { content: "<p>Mine, edited</p>", base })).body;
            const revisions = countNoteRevisions(noteId);
            await save(noteId, { content: "<p>A third</p>", base: getBase(noteId) });
            const stale = await save(noteId, {
                content: "<p>Mine, edited</p>",
                base: { ...base, blobId: conflict.blobId },
                keepOther: true
            });
            expect(stale.status).toBe(409);
            expect(countNoteRevisions(noteId)).toBe(revisions);

            const kept = await save(noteId, {
                content: "<p>Mine, edited</p>", base: getBase(noteId), keepOther: true
            });
            expect(kept.status).toBe(200);
            expect(note.getContent()).toBe("<p>Mine, edited</p>");
            expect(countNoteRevisions(noteId)).toBe(revisions + 1);
            expect(note.getRevisions().map((revision) => revision.getContent()))
                .toContain("<p>A third</p>");

            // A note that keeps no revisions says so, and the version it replaces is not kept.
            getContext().init(() => note.setLabel("disableVersioning"));
            const unversioned = await save(noteId, { content: "<p>x</p>", base });
            expect(unversioned.body.isVersioned).toBe(false);
            await save(noteId, {
                content: "<p>Mine again</p>", base: getBase(noteId), keepOther: true
            });
            expect(countNoteRevisions(noteId)).toBe(revisions + 1);
        });

        it("checks the attachment rows of a save with a base", async () => {
            const { noteId } = await createTextNote(api, { content: "<p>Host</p>" });
            const note = becca.getNoteOrThrow(noteId);
            const row = { role: "file", mime: "text/plain", title: "notes.txt", content: "one" };
            const saveRows = (rows: SavedAttachmentRow[]) => save(noteId, {
                content: "<p>Host</p>", base: getBase(noteId), attachments: rows
            });
            const readAttachment = (attachmentId = "") =>
                becca.getAttachmentOrThrow(attachmentId).getContent();

            // Two writers saw no attachment of the title: the second one is refused.
            const created = await saveRows([ row ]);
            expect(created.status).toBe(200);
            const [ { attachmentId, blobId: readAt } ] = note.getAttachments();
            expect(created.body.attachments).toStrictEqual([
                { attachmentId, title: "notes.txt", blobId: readAt }
            ]);
            const second = await saveRows([ { ...row, content: "two" } ]);
            expect(second.status).toBe(409);
            // The conflict names the attachment of the title, as it is now.
            expect(second.body.attachments).toStrictEqual([
                { attachmentId, title: "notes.txt", blobId: readAt }
            ]);

            // A row replaces an attachment at the blob that it read, and is refused on another one.
            const replaced = await saveRows([
                { ...row, content: "three", attachmentId, blobId: readAt }
            ]);
            expect(replaced.status).toBe(200);
            expect(readAttachment(attachmentId)).toBe("three");
            const stale = await saveRows([
                { ...row, content: "four", attachmentId, blobId: readAt }
            ]);
            expect(stale.status).toBe(409);
            expect(readAttachment(attachmentId)).toBe("three");

            // Keeping this version replaces the attachment at the blob that the conflict named,
            // and is refused once a third writer replaced it since.
            const named = becca.getAttachmentOrThrow(attachmentId ?? "").blobId;
            expect(stale.body.attachments).toStrictEqual([
                { attachmentId, title: "notes.txt", blobId: named }
            ]);
            const keep = (blobId?: string) => save(noteId, {
                content: "<p>Host</p>", base: getBase(noteId), keepOther: true,
                attachments: [ { ...row, content: "four", attachmentId, blobId } ]
            });
            expect((await keep(readAt)).status).toBe(409);
            expect(readAttachment(attachmentId)).toBe("three");
            expect((await keep(named)).status).toBe(200);
            expect(readAttachment(attachmentId)).toBe("four");

            // Keeping a version needs the base that it keeps it over.
            const keepWithoutBase = await save(noteId, { content: "<p>x</p>", keepOther: true });
            expect(keepWithoutBase.status).toBe(400);
            expect(note.getContent()).toBe("<p>Host</p>");

            // A save without a base replaces the attachment of the title, as before.
            const unconditional = await save(noteId, {
                content: "<p>Host</p>", attachments: [ row ]
            });
            expect(unconditional.status).toBe(204);
            expect(note.getAttachments().map((other) => other.getContent()))
                .toStrictEqual([ "one" ]);

            // A conflict names only the attachments that the note has.
            const unknown = await save(noteId, {
                content: "<p>Host</p>", base: { ...getBase(noteId), blobId: "stale" },
                attachments: [ { ...row, title: "new.txt" }, { ...row, attachmentId: "gone1" } ]
            });
            expect(unknown.status).toBe(409);
            expect(unknown.body.attachments).toStrictEqual([]);
        });
    });

    describe("editing blocks", () => {
        const blocks = `<p data-trilium-block-id="a">A</p><p data-trilium-block-id="b">B</p>`;

        it("reads and replaces the blocks of a text note", async () => {
            const { noteId } = await createTextNote(api, {
                content: `<p>Before</p>${blocks}<p>After</p>`
            });

            const read = await api.get<NoteBlocksResponse>(`/api/notes/${noteId}/blocks`, {
                query: { block: "a:b" }
            });
            expect(read.status).toBe(200);
            expect(read.body.content).toBe(blocks);
            expect(read.body.note).toBe(becca.getNoteOrThrow(noteId).getContent());

            const update = await api.put(`/api/notes/${noteId}/blocks`, {
                query: { block: "a:b" },
                body: { content: `<p data-trilium-block-id="a">New</p>` }
            });
            expect(update.status).toBe(204);

            const blob = await api.get<{ content: string }>(`/api/notes/${noteId}/blob`);
            expect(blob.body.content)
                .toBe(`<p>Before</p><p data-trilium-block-id="a">New</p><p>After</p>`);
        });

        it("refuses a save of blocks changed since they were read, but not of others", async () => {
            const excerpt = `<p data-trilium-block-id="a">a</p><h2>Middle</h2>`
                + `<p data-trilium-block-id="z">z</p>`;
            const { noteId } = await createTextNote(api, { content: `<p>Outside</p>${excerpt}` });
            const note = becca.getNoteOrThrow(noteId);
            const url = `/api/notes/${noteId}/blocks`;
            const read = await api.get<NoteBlocksResponse>(url, { query: { block: "a:z" } });
            const edited = excerpt.replace(">a<", ">a, edited<");

            // Another window gives the heading in the range an id.
            const referencesUrl = `/api/notes/${noteId}/references`;
            const listed = await api.get<NoteReferencesResponse>(referencesUrl);
            const reference = await api.post<CreateReferenceResponse>(referencesUrl, {
                body: { kind: "heading", index: 0, title: "Middle", blobId: listed.body.blobId }
            });
            const withId = String(note.getContent());
            const refused = await api.put<BlocksConflictResponse>(url, {
                query: { block: "a:z" }, body: { content: edited, base: { hash: read.body.hash } }
            });
            expect(refused.status).toBe(409);
            expect(refused.body).toMatchObject({ reason: "version", isVersioned: true });
            expect(note.getContent()).toBe(withId);
            expect(withId).toContain(reference.body.params.block);

            // A change outside the blocks leaves them as they were read.
            const again = await api.get<NoteBlocksResponse>(url, { query: { block: "a:z" } });
            getContext().init(() => note.setContent(withId.replace("Outside", "Outside, edited")));
            const saved = await api.put<SaveNoteBlocksResponse>(url, {
                query: { block: "a:z" },
                body: {
                    content: again.body.content.replace(">a<", ">a, edited<"),
                    base: { hash: again.body.hash }
                }
            });
            expect(saved.status).toBe(200);
            expect(note.getContent()).toContain("Outside, edited");
            expect(note.getContent()).toContain("a, edited");
            expect(note.getContent()).toContain(reference.body.params.block);
            const after = await api.get<NoteBlocksResponse>(url, { query: { block: "a:z" } });
            expect(saved.body).toStrictEqual({
                hash: after.body.hash, note: note.getContent(), attachments: []
            });

            // Keeping this version saves over the blocks of the conflict, after a revision.
            const revisions = countNoteRevisions(noteId);
            const kept = await api.put<SaveNoteBlocksResponse>(url, {
                query: { block: "a:z" },
                body: { content: excerpt, base: { hash: after.body.hash }, keepOther: true }
            });
            expect(kept.status).toBe(200);
            expect(countNoteRevisions(noteId)).toBe(revisions + 1);
            expect(note.getContent()).toBe(`<p>Outside, edited</p>${excerpt}`);
        });

        it("answers a conflict over an attachment with the hash of the blocks", async () => {
            const { noteId } = await createTextNote(api, { content: blocks });
            const note = becca.getNoteOrThrow(noteId);
            const url = `/api/notes/${noteId}/blocks`;
            const row = { role: "file", mime: "text/plain", title: "drawing.txt", content: "one" };
            await api.put(`/api/notes/${noteId}/data`, {
                body: { content: blocks, attachments: [ row ] }
            });
            const [ { attachmentId = "", blobId: readAt } ] = note.getAttachments();
            const read = await api.get<NoteBlocksResponse>(url, { query: { block: "a:b" } });
            const drawing = () => becca.getAttachmentOrThrow(attachmentId);
            const replaceDrawing = (content: string) => getContext().init(() =>
                drawing().setContent(content, { forceSave: true }));
            const saveBlocks = (body: Record<string, unknown>) => api.put<BlocksConflictResponse>(
                url, {
                    query: { block: "a:b" },
                    body: { content: blocks.replace(">A<", ">Mine<"), ...body }
                });
            const editedRow = (blobId?: string) =>
                [ { ...row, content: "mine", attachmentId, blobId } ];

            // Another writer replaces the drawing that the excerpt edited.
            replaceDrawing("theirs");
            const conflict = await saveBlocks({
                base: { hash: read.body.hash }, attachments: editedRow(readAt)
            });
            expect(conflict.status).toBe(409);
            const named = drawing().blobId;
            expect(conflict.body).toStrictEqual({
                reason: "version", message: expect.any(String), hash: read.body.hash,
                attachments: [ { attachmentId, title: "drawing.txt", blobId: named } ],
                isVersioned: true
            });

            // A third writer replaces it again before the user keeps this version.
            replaceDrawing("a third");
            const kept = await saveBlocks({
                base: { hash: read.body.hash }, keepOther: true, attachments: editedRow(named)
            });
            expect(kept.status).toBe(409);
            expect(drawing().getContent()).toBe("a third");
            expect(note.getContent()).toBe(blocks);
            // Keeping a version needs the base that it keeps it over.
            expect((await saveBlocks({ keepOther: true })).status).toBe(400);
            expect(note.getContent()).toBe(blocks);
        });

        it("says why a save of gone blocks, or of a converted note, is refused", async () => {
            const { noteId } = await createTextNote(api, { content: `${blocks}<p>After</p>` });
            const note = becca.getNoteOrThrow(noteId);
            const url = `/api/notes/${noteId}/blocks`;
            const read = await api.get<NoteBlocksResponse>(url, { query: { block: "a:b" } });
            const saveBlocks = (base?: { hash: string }) => api.put<BlocksConflictResponse>(url, {
                query: { block: "a:b" }, body: { content: blocks, base }
            });

            const withoutB = `<p data-trilium-block-id="a">A</p><p>After</p>`;
            getContext().init(() => note.setContent(withoutB));
            expect((await saveBlocks({ hash: read.body.hash })).body)
                .toStrictEqual({ reason: "range", message: expect.any(String) });
            expect((await saveBlocks()).status).toBe(404);

            getContext().init(() => {
                note.type = "code";
                note.mime = "text/x-markdown";
                note.save();
            });
            expect((await saveBlocks({ hash: read.body.hash })).body)
                .toStrictEqual({ reason: "format", message: expect.any(String) });
            expect((await saveBlocks()).status).toBe(400);
        });

        it("rejects missing blocks and malformed requests", async () => {
            const { noteId } = await createTextNote(api, { content: blocks });
            const url = `/api/notes/${noteId}/blocks`;
            const codeNote = await api.post<{ note: { noteId: string } }>(
                "/api/notes/root/children?target=into",
                { body: { title: "Code", type: "code", mime: "text/plain", content: blocks } }
            );
            const codeUrl = `/api/notes/${codeNote.body.note.noteId}/blocks`;

            expect((await api.get(url, { query: { block: "a:x" } })).status).toBe(404);
            expect((await api.get(url)).status).toBe(400);
            expect((await api.get(codeUrl, { query: { block: "a" } })).status).toBe(400);
            expect((await api.put(url, { query: { block: "a:x" }, body: { content: "" } })).status)
                .toBe(404);
            expect((await api.put(url, { query: { block: "a" }, body: {} })).status).toBe(400);
            for (const base of [ {}, null ]) {
                const malformed = await api.put(url, {
                    query: { block: "a" }, body: { content: "", base }
                });
                expect(malformed.status).toBe(400);
            }
        });

        it("answers the hash of the blocks a save names, or none once they are gone", async () => {
            const { noteId } = await createTextNote(api, { content: blocks });
            const url = `/api/notes/${noteId}/blocks`;
            const read = await api.get<NoteBlocksResponse>(url, { query: { block: "a:b" } });

            // The editor joined the two paragraphs, so the blocks after the save are "a" alone.
            const joined = await api.put<SaveNoteBlocksResponse>(url, {
                query: { block: "a:b" },
                body: {
                    content: `<p data-trilium-block-id="a">AB</p>`,
                    base: { hash: read.body.hash }, block: "a"
                }
            });
            const after = await api.get<NoteBlocksResponse>(url, { query: { block: "a" } });
            expect(joined.body.hash).toBe(after.body.hash);

            const gone = await api.put<SaveNoteBlocksResponse>(url, {
                query: { block: "a" },
                body: { content: "<p>No id</p>", base: { hash: after.body.hash } }
            });
            expect(gone.body).toMatchObject({ hash: null, note: "<p>No id</p>" });
        });

        it("fails a save of blocks that fails for a reason other than a conflict", async () => {
            const { noteId } = await createTextNote(api, { content: blocks });
            const url = `/api/notes/${noteId}/blocks`;
            const read = await api.get<NoteBlocksResponse>(url, { query: { block: "a" } });
            const failing = vi.spyOn(noteService, "updateNoteData").mockImplementation(() => {
                throw new Error("Disk full");
            });

            const failed = await api.put(url, {
                query: { block: "a" }, body: { content: blocks, base: { hash: read.body.hash } }
            });
            failing.mockRestore();
            expect(failed.status).toBe(500);
            expect(becca.getNoteOrThrow(noteId).getContent()).toBe(blocks);
        });
    });

    describe("references", () => {
        const content = `<h2>Intro</h2><p><a id="start"></a>Text</p>`
            + `<h3 data-trilium-block-id="kept1">Details</h3>`;

        function addReference(noteId: string, body: unknown) {
            return api.post<CreateReferenceResponse>(`/api/notes/${noteId}/references`, { body });
        }

        function listReferences(noteId: string) {
            return api.get<NoteReferencesResponse>(`/api/notes/${noteId}/references`);
        }

        /** The request for a reference to the heading at `index` with the text `title`. */
        function heading(index: number, title: string) {
            return { kind: "heading", index, title };
        }

        function countRevisions(noteId: string) {
            return getSql().getValue<number>(
                "SELECT COUNT(*) FROM revisions WHERE noteId = ?", [ noteId ]
            );
        }

        async function createNoteOfType(type: string, mime: string) {
            const res = await api.post<{ note: { noteId: string } }>(
                "/api/notes/root/children?target=into",
                { body: { title: "Other", type, mime, content } }
            );
            return res.body.note.noteId;
        }

        it("lists the headings and anchors of a text note", async () => {
            const { noteId } = await createTextNote(api, { content });

            const res = await listReferences(noteId);
            expect(res.status).toBe(200);
            expect(res.body).toStrictEqual({
                targets: [
                    { kind: "heading", title: "Intro", level: 2 },
                    { kind: "heading", title: "Details", level: 3, params: { block: "kept1" } },
                    { kind: "anchor", title: "start", params: { bookmark: "start" } }
                ],
                blobId: becca.getNoteOrThrow(noteId).blobId
            });
        });

        it("refuses a pick from a listing of another blob, and takes one of the same", async () => {
            const listedContent = "<h2>Status</h2><p>budget</p>";
            const { noteId } = await createTextNote(api, { content: listedContent });
            const note = becca.getNoteOrThrow(noteId);
            const { blobId } = (await listReferences(noteId)).body;

            // The heading is deleted and written again elsewhere with the same title, which is
            // unique in the listing and unique now.
            const moved = "<p>budget</p><h2>Status</h2><p>hiring plan</p>";
            getContext().init(() => note.setContent(moved));
            const refused = await addReference(noteId, { ...heading(0, "Status"), blobId });
            expect(refused.status).toBe(409);
            expect(refused.body).toMatchObject({ reason: "listing" });
            expect(note.getContent()).toBe(moved);

            const listed = await listReferences(noteId);
            const taken = await addReference(noteId, {
                ...heading(0, "Status"), blobId: listed.body.blobId
            });
            expect(taken.status).toBe(200);
            expect(note.getContent())
                .toContain(`<h2 data-trilium-block-id="${taken.body.params.block}">`);
        });

        it("refuses a pick by position once headings of one title were reordered", async () => {
            const listedContent = `<h2 data-trilium-block-id="kept">Same</h2><h2>Same</h2>`;
            const { noteId } = await createTextNote(api, { content: listedContent });
            const note = becca.getNoteOrThrow(noteId);
            const { blobId } = (await listReferences(noteId)).body;

            const reordered = `<h2>Same</h2><h2 data-trilium-block-id="kept">Same</h2>`;
            getContext().init(() => note.setContent(reordered));
            const refused = await addReference(noteId, { ...heading(1, "Same"), blobId });
            expect(refused.status).toBe(409);
            expect(note.getContent()).toBe(reordered);
        });

        it("refuses a save based on the blob before a reference was written", async () => {
            const { noteId } = await createTextNote(api, { content });
            const note = becca.getNoteOrThrow(noteId);
            const base = { blobId: note.blobId ?? "", type: note.type, mime: note.mime };

            expect((await addReference(noteId, heading(0, "Intro"))).status).toBe(200);
            const withId = note.getContent();
            const save = await api.put(`/api/notes/${noteId}/data`, {
                body: { content: `${content}<p>Edit</p>`, base }
            });
            expect(save.status).toBe(409);
            expect(note.getContent()).toBe(withId);
        });

        it("finds a Markdown heading by the line its block starts on", async () => {
            const markdown = "## <template>Hidden</template>\n\n"
                + "## Install <a data-trilium-block-id=\"first\"></a>\n\n"
                + "## Install <a data-trilium-block-id=\"second\"></a>";
            const res = await api.post<{ note: { noteId: string } }>(
                "/api/notes/root/children?target=into",
                { body: { title: "Markdown", type: "code", mime: "text/x-markdown", content: "" } }
            );
            const note = becca.getNoteOrThrow(res.body.note.noteId);
            getContext().init(() => note.setContent(markdown));
            const blobId = note.blobId ?? "";
            const byLine = (line: number, title: string, body: object = { blobId }) =>
                addReference(note.noteId, { kind: "heading", line, title, ...body });

            const found = await byLine(5, "Install");
            expect(found.status).toBe(200);
            expect(found.body).toStrictEqual({ params: { block: "second" } });
            expect((await byLine(4, "Install")).status).toBe(409);
            expect((await byLine(5, "Other")).status).toBe(409);
            const stale = await byLine(5, "Install", { blobId: "stale" });
            expect(stale.status).toBe(409);
            expect(stale.body).toMatchObject({ reason: "listing" });
            expect((await byLine(5, "Install", {})).status).toBe(400);
            expect((await byLine(5, "Install", { blobId: "" })).status).toBe(400);
            expect((await byLine(0, "Install")).status).toBe(400);
            expect((await byLine(5, "Install", { blobId, index: 2 })).status).toBe(400);
            expect(note.getContent()).toBe(markdown);

            // A text note finds its headings by position only.
            const text = await createTextNote(api, { content });
            const textBlobId = becca.getNoteOrThrow(text.noteId).blobId;
            expect((await addReference(text.noteId, {
                kind: "heading", line: 1, title: "Intro", blobId: textBlobId
            })).status).toBe(400);
        });

        describe("marked", () => {
            function listMarked(noteId: string) {
                return api.get<MarkedHeadingsResponse>(`/api/notes/${noteId}/references/marked`);
            }

            /** The position that `markedContent` gives the heading whose opening tag ends it. */
            function findPosition(marked: MarkedHeadingsResponse, before: string) {
                const pattern = new RegExp(`data-trilium-heading-index="${marked.markToken}\\.`
                    + `(\\d+)"${before}`);
                return Number(pattern.exec(marked.markedContent)?.[1]);
            }

            it("marks the headings of the blob it reads, and saves nothing", async () => {
                const { noteId } = await createTextNote(api, { content });
                const note = becca.getNoteOrThrow(noteId);
                const { blobId } = note;

                const res = await listMarked(noteId);
                expect(res.status).toBe(200);
                const { markToken } = res.body;
                expect(res.body).toStrictEqual({
                    blobId,
                    headings: [
                        { kind: "heading", title: "Intro", level: 2 },
                        { kind: "heading", title: "Details", level: 3, params: { block: "kept1" } }
                    ],
                    markedContent: content
                        .replace("<h2", `<h2 data-trilium-heading-index="${markToken}.0"`)
                        .replace("<h3", `<h3 data-trilium-heading-index="${markToken}.1"`),
                    markToken: expect.stringMatching(/^[A-Za-z0-9]{12}$/)
                });
                expect(content).not.toContain(markToken);
                expect(note.getContent()).toBe(content);
                expect(note.blobId).toBe(blobId);
            });

            it("gives an id to the heading at the marked position alone", async () => {
                const twins = `<h2>Same</h2><p>a\\b</p><h2>Same</h2>`;
                const { noteId } = await createTextNote(api, { content: twins });
                const note = becca.getNoteOrThrow(noteId);
                const marked = (await listMarked(noteId)).body;
                const position = findPosition(marked, `>Same</h2>$`);
                expect(position).toBe(1);

                const created = await addReference(noteId, {
                    ...heading(position, "Same"), blobId: marked.blobId
                });
                const id = created.body.params.block;
                expect(note.getContent())
                    .toBe(`<h2>Same</h2><p>a\\b</p><h2 data-trilium-block-id="${id}">Same</h2>`);

                // Table rows without a table: the server reads A, B, C in source order.
                const rows = `<tr><td><h2>A</h2></td></tr><tr><h2>B</h2><td><h2>C</h2></td></tr>`;
                getContext().init(() => note.setContent(rows));
                const markedRows = (await listMarked(noteId)).body;
                const positionOfB = findPosition(markedRows, ">B</h2>");
                const createdB = await addReference(noteId, {
                    ...heading(positionOfB, "B"), blobId: markedRows.blobId
                });
                expect(note.getContent()).toBe(rows.replace(
                    "<h2>B", `<h2 data-trilium-block-id="${createdB.body.params.block}">B`
                ));
            });

            it("lists the headings that take no id on a read-only virtual note", async () => {
                registerVirtualNoteProvider({
                    namespace: "_vmark",
                    parentNoteId: "_hidden",
                    getSubtree: () => [ { id: "_vmarkPage", title: "Page", type: "text" } ],
                    getContent: () => "<h2>Shipped</h2>"
                });
                getContext().init(() => load());
                try {
                    expect((await listMarked("_vmarkPage")).body.headings)
                        .toStrictEqual([ { kind: "heading", title: "Shipped", level: 2 } ]);
                } finally {
                    unregisterVirtualNoteProvider("_vmark");
                    getContext().init(() => load());
                }
            });

            it("refuses notes whose headings it cannot mark", async () => {
                const markdownId = await createNoteOfType("code", "text/x-markdown");
                expect((await listMarked(markdownId)).status).toBe(400);
                const pdfId = await createNoteOfType("file", "application/pdf");
                expect((await listMarked(pdfId)).status).toBe(400);
                expect((await listMarked("missingNote")).status).toBe(404);

                const { noteId } = await createTextNote(api, { content });
                const note = becca.getNoteOrThrow(noteId);
                note.isProtected = true;
                try {
                    expect((await listMarked(noteId)).status).toBe(400);
                } finally {
                    note.isProtected = false;
                }
            });
        });

        it("gives a heading of a read-only note a block id once, without a revision", async () => {
            const { noteId } = await createTextNote(api, { content });
            const readOnly = await api.put(`/api/notes/${noteId}/set-attribute`, {
                body: { type: "label", name: "readOnly", value: "" }
            });
            expect(readOnly.status).toBe(204);
            const note = becca.getNoteOrThrow(noteId);
            expect(note.hasLabel("readOnly")).toBe(true);

            // A regular save of a note created before the revision interval takes a revision.
            const control = becca.getNoteOrThrow((await createTextNote(api, { content })).noteId);
            note.utcDateCreated = "2020-01-01 00:00:00.000Z";
            control.utcDateCreated = note.utcDateCreated;
            await api.put(`/api/notes/${control.noteId}/data`, {
                body: { content: `${content}<p>Edit</p>` }
            });
            expect(countRevisions(control.noteId)).toBe(1);

            const created = await addReference(noteId, heading(0, "Intro"));
            expect(created.status).toBe(200);
            const blockId = created.body.params.block;
            expect(blockId).toMatch(/^[A-Za-z0-9]{12}$/);
            expect(note.getContent())
                .toBe(content.replace("<h2>", `<h2 data-trilium-block-id="${blockId}">`));
            expect(countRevisions(noteId)).toBe(0);

            const { blobId } = note;
            expect((await addReference(noteId, heading(0, "Intro"))).body)
                .toStrictEqual({ params: { block: blockId } });
            expect((await addReference(noteId, heading(1, "Details"))).body)
                .toStrictEqual({ params: { block: "kept1" } });
            expect(note.blobId).toBe(blobId);

            const listed = await listReferences(noteId);
            expect(listed.body.targets[0]).toStrictEqual(
                { kind: "heading", title: "Intro", level: 2, params: { block: blockId } }
            );
        });

        it("gives a heading of a Markdown note a marker, without a revision", async () => {
            const markdown = "## Intro\n\nText <a id=\"start\"></a>\n\n"
                + "## Details <a data-trilium-block-id=\"kept1\"></a>";
            const res = await api.post<{ note: { noteId: string } }>(
                "/api/notes/root/children?target=into",
                { body: { title: "Markdown", type: "code", mime: "text/x-markdown", content: "" } }
            );
            const note = becca.getNoteOrThrow(res.body.note.noteId);
            getContext().init(() => note.setContent(markdown));

            const listed = await listReferences(note.noteId);
            expect(listed.body).toStrictEqual({
                targets: [
                    { kind: "heading", title: "Intro", level: 2 },
                    { kind: "heading", title: "Details", level: 2, params: { block: "kept1" } },
                    { kind: "anchor", title: "start", params: { bookmark: "start" } }
                ],
                blobId: note.blobId
            });

            const created = await addReference(note.noteId, {
                ...heading(0, "Intro"), blobId: listed.body.blobId
            });
            expect(created.status).toBe(200);
            const blockId = created.body.params.block;
            expect(note.getContent()).toBe(markdown.replace(
                "## Intro", `## Intro <a data-trilium-block-id="${blockId}"></a>`
            ));
            expect(countRevisions(note.noteId)).toBe(0);
            expect((await addReference(note.noteId, heading(5, "Gone"))).status).toBe(409);
        });

        it("answers 409 for a target that changed, without writing it or naming it", async () => {
            const { noteId } = await createTextNote(api, { content });
            const { blobId } = becca.getNoteOrThrow(noteId);

            const res = await addReference(noteId, heading(0, "Secret plans"));
            expect(res.status).toBe(409);
            expect(JSON.stringify(res.body)).not.toContain("Secret");
            // An anchor has its reference, its name, so no anchor needs one.
            const anchor = await addReference(noteId, { kind: "anchor", index: 0, title: "start" });
            expect(anchor.status).toBe(409);
            expect(becca.getNoteOrThrow(noteId).blobId).toBe(blobId);
        });

        it("rejects malformed requests, and notes without content to read", async () => {
            const { noteId } = await createTextNote(api, { content });
            const bodies = [
                undefined, null, [ "heading", 0, "Intro" ], {}, { index: 0, title: "Intro" },
                { kind: "heading", title: "Intro" }, { kind: "heading", index: 0 },
                { kind: "paragraph", index: 0, title: "Intro" }, heading(-1, "Intro"),
                heading(0.5, "Intro"), { kind: "heading", index: "0", title: "Intro" },
                heading(0, ""), { kind: "heading", index: 0, title: 1 },
                { ...heading(0, "Intro"), blobId: 1 }
            ];
            for (const body of bodies) {
                expect((await addReference(noteId, body)).status).toBe(400);
            }

            // A note that no provider reads has no targets, and none to give a reference.
            const codeNoteId = await createNoteOfType("code", "text/html");
            expect((await listReferences(codeNoteId)).body).toStrictEqual({ targets: [] });
            expect((await addReference(codeNoteId, heading(0, "Intro"))).status).toBe(400);
            expect((await listReferences("missingNote")).status).toBe(404);
            expect((await addReference("missingNote", heading(0, "Intro"))).status).toBe(404);

            const note = becca.getNoteOrThrow(noteId);
            note.isProtected = true;
            try {
                expect((await listReferences(noteId)).status).toBe(400);
                expect((await addReference(noteId, heading(0, "Intro"))).status).toBe(400);
            } finally {
                note.isProtected = false;
            }
            expect(note.getContent()).toBe(content);
        });

        describe("of a read-only virtual note", () => {
            const pageContent = `<h2>Shipped</h2><h2 data-trilium-block-id="kept">Kept</h2>`
                + `<p><a id="top"></a></p>`;

            beforeAll(() => {
                registerVirtualNoteProvider({
                    namespace: "_vref",
                    parentNoteId: "_hidden",
                    getSubtree: () => [ { id: "_vrefPage", title: "Page", type: "text" } ],
                    getContent: () => pageContent
                });
                getContext().init(() => load());
            });

            afterAll(() => {
                unregisterVirtualNoteProvider("_vref");
                getContext().init(() => load());
            });

            it("lists only the targets that have a reference, and refuses to add one", async () => {
                expect((await listReferences("_vrefPage")).body).toStrictEqual({
                    targets: [
                        { kind: "heading", title: "Kept", level: 2, params: { block: "kept" } },
                        { kind: "anchor", title: "top", params: { bookmark: "top" } }
                    ]
                });
                expect((await addReference("_vrefPage", heading(0, "Shipped"))).status).toBe(400);
                expect(becca.getNoteOrThrow("_vrefPage").getContent()).toBe(pageContent);
            });
        });

        describe("of a note that a registered provider reads", () => {
            const provider: ReferenceProvider = {
                isFor: (type, mime) => type === "code" && mime === "text/x-test-references",
                // Asynchronous, as a provider that loads its parser on demand is.
                findTargets: async (source) => [
                    { kind: "heading", title: "Unlinked", level: 1 },
                    // The text of the first heading of the content: `<h2>Intro</h2>`.
                    {
                        kind: "heading", title: String(readContent(source)).slice(4, 9), level: 1,
                        params: { block: "b" }
                    }
                ]
            };

            beforeAll(() => registerReferenceProvider(provider));
            afterAll(() => unregisterReferenceProvider(provider));

            it("lists only linked targets of a provider that creates no references", async () => {
                const noteId = await createNoteOfType("code", "text/x-test-references");

                expect((await listReferences(noteId)).body.targets).toStrictEqual([
                    { kind: "heading", title: "Intro", level: 1, params: { block: "b" } }
                ]);
                expect((await addReference(noteId, heading(0, "Unlinked"))).status).toBe(400);
            });
        });
    });

    describe("deleting and undeleting", () => {
        it("soft-deletes a note, then undeletes it", async () => {
            const { noteId } = await createTextNote(api, { title: "To delete" });
            expect(noteIsDeleted(noteId)).toBe(0);

            const del = await api.delete(`/api/notes/${noteId}`, {
                query: { taskId: "test-delete", last: "true" }
            });
            expect(del.status).toBe(204);
            expect(noteIsDeleted(noteId)).toBe(1);

            const undel = await api.put<{ undeleted: boolean }>(`/api/notes/${noteId}/undelete`);
            expect(undel.status).toBe(200);
            expect(undel.body.undeleted).toBe(true);
            expect(noteIsDeleted(noteId)).toBe(0);
        });

        it("reports failure (and restores nothing) when the note's parent is still deleted", async () => {
            const parent = await createTextNote(api, { title: "Deleted parent" });
            const child = await createTextNote(api, { parentNoteId: parent.noteId, title: "Orphaned child" });

            // Deleting the parent soft-deletes the whole subtree, including the child.
            const del = await api.delete(`/api/notes/${parent.noteId}`, {
                query: { taskId: "test-parent-delete", last: "true" }
            });
            expect(del.status).toBe(204);
            expect(noteIsDeleted(child.noteId)).toBe(1);

            // Undeleting the child directly can't succeed — its only parent is itself still deleted.
            const undel = await api.put<{ undeleted: boolean }>(`/api/notes/${child.noteId}/undelete`);
            expect(undel.status).toBe(200);
            expect(undel.body.undeleted).toBe(false);
            expect(noteIsDeleted(child.noteId)).toBe(1);
        });

        it("400s for a fallback parent that is not a note id", async () => {
            const { noteId } = await createTextNote(api, { title: "Bad fallback" });
            const res = await api.put(`/api/notes/${noteId}/undelete`, { body: { fallbackParentNoteId: 5 } });
            expect(res.status).toBe(400);
        });

        it("restores an orphaned note under the fallback parent when one is given", async () => {
            const parent = await createTextNote(api, { title: "Doomed parent" });
            const child = await createTextNote(api, { parentNoteId: parent.noteId, title: "Rehomed child" });
            const newHome = await createTextNote(api, { title: "Inbox stand-in" });

            // Deleting the parent orphans the child: its only original location is gone.
            const del = await api.delete(`/api/notes/${parent.noteId}`, {
                query: { taskId: "test-fallback-delete", last: "true" }
            });
            expect(del.status).toBe(204);
            expect(noteIsDeleted(child.noteId)).toBe(1);

            const undel = await api.put<{ undeleted: boolean; restoredToFallbackParent: boolean }>(
                `/api/notes/${child.noteId}/undelete`,
                { body: { fallbackParentNoteId: newHome.noteId } }
            );

            expect(undel.status).toBe(200);
            expect(undel.body.undeleted).toBe(true);
            expect(undel.body.restoredToFallbackParent).toBe(true);

            // The child is alive again under its new home; the original parent stays deleted.
            expect(noteIsDeleted(child.noteId)).toBe(0);
            expect(noteIsDeleted(parent.noteId)).toBe(1);
            expect(becca.getNote(child.noteId)?.getParentNotes().map((note) => note.noteId))
                .toContain(newHome.noteId);
        });

        it("re-links an inbox-restored orphan under its original parent when that parent is later restored", async () => {
            const parent = await createTextNote(api, { title: "Parent restored later" });
            const child = await createTextNote(api, { parentNoteId: parent.noteId, title: "Orphan rehomed" });
            const inbox = await createTextNote(api, { title: "Inbox stand-in 2" });

            // Deleting the parent orphans the child.
            await api.delete(`/api/notes/${parent.noteId}`, {
                query: { taskId: "test-relink-delete", last: "true" }
            });

            // The user restores just the child, into the inbox.
            const undelChild = await api.put<{ restoredToFallbackParent: boolean }>(
                `/api/notes/${child.noteId}/undelete`,
                { body: { fallbackParentNoteId: inbox.noteId } }
            );
            expect(undelChild.body.restoredToFallbackParent).toBe(true);

            // Later, the user restores the whole parent.
            const undelParent = await api.put<{ undeleted: boolean }>(`/api/notes/${parent.noteId}/undelete`);
            expect(undelParent.body.undeleted).toBe(true);
            expect(noteIsDeleted(parent.noteId)).toBe(0);

            // The child is the SAME note (not a copy), now cloned under both its new home and its
            // original parent — so restoring the parent brings back a complete subtree.
            const parentIds = becca.getNote(child.noteId)?.getParentNotes().map((note) => note.noteId);
            expect(parentIds).toContain(inbox.noteId);
            expect(parentIds).toContain(parent.noteId);
        });

        it("reports failure (instead of crashing) when undeleting an already-erased note", async () => {
            const { noteId } = await createTextNote(api, { title: "Erase then undelete" });
            const del = await api.delete(`/api/notes/${noteId}`, {
                query: { taskId: "test-erase-undelete", eraseNotes: "true", last: "true" }
            });
            expect(del.status).toBe(204);
            expect(noteIsDeleted(noteId)).toBeNull(); // row is gone entirely

            const undel = await api.put<{ undeleted: boolean }>(`/api/notes/${noteId}/undelete`);
            expect(undel.status).toBe(200);
            expect(undel.body.undeleted).toBe(false);
        });

        it("400s when deleting without a taskId", async () => {
            const { noteId } = await createTextNote(api, { title: "Needs taskId" });
            const res = await api.delete(`/api/notes/${noteId}`);
            expect(res.status).toBe(400);
        });

        it("erases a note immediately when eraseNotes is set", async () => {
            const { noteId } = await createTextNote(api, { title: "Erase now" });

            const del = await api.delete(`/api/notes/${noteId}`, {
                query: { taskId: "test-erase", eraseNotes: "true", last: "true" }
            });
            expect(del.status).toBe(204);
            // Erasing removes the row entirely rather than just flagging it deleted.
            expect(noteIsDeleted(noteId)).toBeNull();
        });

        it("holds a multi-note erase back until the last request of the task group", async () => {
            const first = await createTextNote(api, { title: "Batch erase note 1" });
            const second = await createTextNote(api, { title: "Batch erase note 2" });
            const taskId = "test-note-erase-batch";

            const firstRes = await api.delete(`/api/notes/${first.noteId}`, {
                query: { taskId, last: "false", eraseNotes: "true" }
            });
            expect(firstRes.status).toBe(204);

            // Soft-deleted, but not erased: the client is still sending the rest of the batch, and
            // an erase here would reload it out from under them.
            expect(noteIsDeleted(first.noteId)).toBe(1);

            const secondRes = await api.delete(`/api/notes/${second.noteId}`, {
                query: { taskId, last: "true", eraseNotes: "true" }
            });
            expect(secondRes.status).toBe(204);

            // The last request erases everything the group deleted, in one go.
            expect(noteIsDeleted(first.noteId)).toBeNull();
            expect(noteIsDeleted(second.noteId)).toBeNull();
        });
    });

    describe("deleting a selection", () => {
        it("deletes every branch of the selection, and erases them when asked", async () => {
            const first = await createTextNote(api, { title: "Selection note 1" });
            const second = await createTextNote(api, { title: "Selection note 2" });
            const child = await createTextNote(api,
                { parentNoteId: first.noteId, title: "Selection child" });

            const res = await api.post("/api/delete-notes", {
                body: {
                    branchIdsToDelete: [ first.branchId, second.branchId ],
                    taskId: "test-batch-delete"
                }
            });

            expect(res.status).toBe(204);
            expect(noteIsDeleted(first.noteId)).toBe(1);
            expect(noteIsDeleted(second.noteId)).toBe(1);
            // Deleting a note takes its subtree with it, as the per-note route does.
            expect(noteIsDeleted(child.noteId)).toBe(1);

            const toErase = await createTextNote(api, { title: "Selection to erase" });
            const eraseRes = await api.post("/api/delete-notes", {
                body: {
                    branchIdsToDelete: [ toErase.branchId ],
                    eraseNotes: true,
                    taskId: "test-batch-erase"
                }
            });

            expect(eraseRes.status).toBe(204);
            // One request covers the whole selection, so nothing holds the erase back.
            expect(noteIsDeleted(toErase.noteId)).toBeNull();
        });

        it("removes only the selected branch of a clone, unless all clones are asked", async () => {
            const otherParent = await createTextNote(api, { title: "Other clone parent" });
            const cloned = await createTextNote(api, { title: "Cloned note" });

            const clone = await api.put<{ branchId: string }>(
                `/api/notes/${cloned.noteId}/clone-to-note/${otherParent.noteId}`,
                { body: {} }
            );
            expect(clone.status).toBe(200);

            const res = await api.post("/api/delete-notes", {
                body: {
                    branchIdsToDelete: [ cloned.branchId ],
                    taskId: "test-batch-clone-delete"
                }
            });

            expect(res.status).toBe(204);
            // The note outlives the branch: it still hangs under the other parent.
            expect(noteIsDeleted(cloned.noteId)).toBe(0);
            expect(becca.getNote(cloned.noteId)?.getParentNotes().map((note) => note.noteId))
                .toEqual([ otherParent.noteId ]);

            const allClones = await createTextNote(api, { title: "Cloned note, all clones" });
            await api.put(
                `/api/notes/${allClones.noteId}/clone-to-note/${otherParent.noteId}`, { body: {} });

            const allRes = await api.post("/api/delete-notes", {
                body: {
                    branchIdsToDelete: [ allClones.branchId ],
                    deleteAllClones: true,
                    taskId: "test-batch-all-clones-delete"
                }
            });

            expect(allRes.status).toBe(204);
            expect(noteIsDeleted(allClones.noteId)).toBe(1);
        });

        it("skips a branch an earlier one of the selection already took down", async () => {
            const parent = await createTextNote(api, { title: "Selection ancestor" });
            const child = await createTextNote(api,
                { parentNoteId: parent.noteId, title: "Selection descendant" });

            // The tree only ever selects top-most nodes, but other callers (a note title menu,
            // the table view) can name both.
            const res = await api.post("/api/delete-notes", {
                body: {
                    branchIdsToDelete: [ parent.branchId, child.branchId ],
                    taskId: "test-batch-nested-delete"
                }
            });

            expect(res.status).toBe(204);
            expect(noteIsDeleted(parent.noteId)).toBe(1);
            expect(noteIsDeleted(child.noteId)).toBe(1);
        });

        it("reports the caller's total, and announces the erasing phase", async () => {
            const progress = vi.spyOn(ws, "sendMessageToAllClients").mockImplementation(() => {});

            try {
                const { branchId } = await createTextNote(api, { title: "Progress-reported" });

                const res = await api.post("/api/delete-notes", {
                    body: {
                        branchIdsToDelete: [ branchId ],
                        eraseNotes: true,
                        totalCount: 4,
                        taskId: "test-batch-progress"
                    }
                });
                expect(res.status).toBe(204);

                const counts = progress.mock.calls
                    .map(([ message ]) => message)
                    .filter((message) => message.type === "taskProgressCount");

                // The first message leaves the constructor before the total is known; every later
                // one carries it, so the client can draw a bar.
                expect(counts.length).toBeGreaterThan(1);
                expect(counts[0].totalCount).toBeUndefined();
                expect(counts.at(-1)).toMatchObject({ totalCount: 4, phase: "erasing" });
            } finally {
                progress.mockRestore();
            }
        });

        it("tells the task system when it fails, and keeps the selection", async () => {
            const { noteId, branchId } = await createTextNote(api, { title: "Delete that fails" });
            const messages = vi.spyOn(ws, "sendMessageToAllClients").mockImplementation(() => {});
            const erase = vi.spyOn(eraseService, "eraseNotesWithDeleteIds")
                .mockImplementation(() => {
                    throw new Error("erase blew up");
                });

            try {
                const res = await api.post("/api/delete-notes", {
                    body: {
                        branchIdsToDelete: [ branchId ],
                        eraseNotes: true,
                        taskId: "test-batch-failure"
                    }
                });
                expect(res.status).toBe(500);

                const sent = messages.mock.calls.map(([ message ]) => message);

                // Without a terminal message the client's progress toast stays up, and it has no
                // close button of its own.
                expect(sent.filter((message) => message.type === "taskError")).toEqual([
                    expect.objectContaining({
                        taskId: "test-batch-failure",
                        taskType: "deleteNotes",
                        message: expect.stringContaining("erase blew up")
                    })
                ]);
                expect(sent.filter((message) => message.type === "taskSucceeded")).toEqual([]);

                // The throw rolls the transaction back, so nothing of the selection is gone.
                expect(noteIsDeleted(noteId)).toBe(0);
            } finally {
                erase.mockRestore();
                messages.mockRestore();
            }
        });

        it("400s without a taskId or a branch id array", async () => {
            const { noteId, branchId } = await createTextNote(api, { title: "Needs a task id" });

            const noTaskId = await api.post("/api/delete-notes", {
                body: { branchIdsToDelete: [ branchId ] }
            });
            expect(noTaskId.status).toBe(400);

            const noBranchIds = await api.post("/api/delete-notes", {
                body: { taskId: "test-batch-no-branches" }
            });
            expect(noBranchIds.status).toBe(400);

            const noBody = await api.post("/api/delete-notes");
            expect(noBody.status).toBe(400);

            // Neither one deleted anything.
            expect(noteIsDeleted(noteId)).toBe(0);
        });

        it("reports a failure that is not an Error", async () => {
            const { branchId } = await createTextNote(api, { title: "Delete that throws a string" });
            const messages = vi.spyOn(ws, "sendMessageToAllClients").mockImplementation(() => {});
            const erase = vi.spyOn(eraseService, "eraseNotesWithDeleteIds")
                .mockImplementation(() => {
                    throw "plain failure";
                });

            try {
                const res = await api.post("/api/delete-notes", {
                    body: { branchIdsToDelete: [ branchId ], eraseNotes: true, taskId: "test-batch-string" }
                });
                expect(res.status).toBe(500);
                expect(messages.mock.calls.map(([ message ]) => message)).toContainEqual(expect.objectContaining({
                    type: "taskError", message: expect.stringContaining("plain failure")
                }));
            } finally {
                erase.mockRestore();
                messages.mockRestore();
            }
        });
    });

    describe("creating with targets", () => {
        it("creates a sibling note after a target branch", async () => {
            const anchor = await createTextNote(api, { title: "Anchor" });

            interface CreateResponse {
                note: { noteId: string };
                branch: { parentNoteId: string };
            }
            const res = await api.post<CreateResponse>(
                "/api/notes/root/children",
                { query: { target: "after", targetBranchId: anchor.branchId }, body: { title: "After sibling", type: "text", content: "" } }
            );
            expect(res.status).toBe(200);
            expect(res.body.note.noteId).toBeTruthy();
            expect(res.body.branch.parentNoteId).toBe("root");
        });
    });

    describe("revisions and conversion", () => {
        it("force-saves a revision and returns its id", async () => {
            const { noteId } = await createTextNote(api, { title: "Snapshot me" });
            const res = await api.post<{ revisionId: string }>(`/api/notes/${noteId}/revision`, {
                body: { description: "manual" }
            });
            expect(res.status).toBe(200);
            expect(res.body.revisionId).toBeTruthy();
        });

        it("400s force-saving a revision of a protected note without a protected session", async () => {
            const { noteId } = await createTextNote(api, { title: "Protected revision" });
            becca.notes[noteId].isProtected = true;

            const res = await api.post(`/api/notes/${noteId}/revision`, { body: {} });
            expect(res.status).toBe(400);

            becca.notes[noteId].isProtected = false;
        });

        it("returns a null attachment for a note ineligible for conversion", async () => {
            const { noteId } = await createTextNote(api, { title: "Not an image" });
            const res = await api.post<{ attachment: unknown }>(`/api/notes/${noteId}/convert-to-attachment`);
            expect(res.status).toBe(200);
            expect(res.body.attachment).toBeNull();
        });

        it("converts a text note to Markdown", async () => {
            const { noteId } = await createTextNote(api, { title: "To Markdown", content: "<p>text</p>" });
            const res = await api.post<{ type: string }>(`/api/notes/${noteId}/convert-format`);
            expect(res.status).toBe(200);
            expect(res.body.type).toBe("code");
            expect(becca.getNoteOrThrow(noteId).mime).toBe("text/x-markdown");
        });
    });

    describe("title and type", () => {
        it("400s changing the title of a protected note without a protected session", async () => {
            const { noteId } = await createTextNote(api, { title: "Locked" });
            becca.notes[noteId].isProtected = true;

            const res = await api.put(`/api/notes/${noteId}/title`, { body: { title: "Nope" } });
            expect(res.status).toBe(400);

            becca.notes[noteId].isProtected = false;
        });

        it("leaves the note untouched when the title is unchanged", async () => {
            const { noteId } = await createTextNote(api, { title: "Same title" });
            const res = await api.put<{ title: string }>(`/api/notes/${noteId}/title`, {
                body: { title: "Same title" }
            });
            expect(res.status).toBe(200);
            expect(res.body.title).toBe("Same title");
        });

        it("sets the note type and mime", async () => {
            const { noteId } = await createTextNote(api, { title: "Type me" });
            const res = await api.put(`/api/notes/${noteId}/type`, {
                body: { type: "code", mime: "text/x-python" }
            });
            expect(res.status).toBe(204);

            const note = await api.get<{ type: string; mime: string }>(`/api/notes/${noteId}`);
            expect(note.body.type).toBe("code");
            expect(note.body.mime).toBe("text/x-python");
        });

        it("rejects a type outside the note type set and leaves the note unchanged", async () => {
            const { noteId } = await createTextNote(api, { title: "Bad type" });
            for (const type of ["EVILTYPE", "html", undefined, 42]) {
                const res = await api.put(`/api/notes/${noteId}/type`, {
                    body: { type, mime: "application/x-anything" }
                });
                expect(res.status).toBe(400);
            }

            expect(becca.getNoteOrThrow(noteId).type).toBe("text");
            expect(becca.getNoteOrThrow(noteId).mime).toBe("text/html");
        });
    });

    describe("structural operations", () => {
        it("sorts child notes", async () => {
            const parent = await createTextNote(api, { title: "Sort parent" });
            await createTextNote(api, { parentNoteId: parent.noteId, title: "Zebra" });
            await createTextNote(api, { parentNoteId: parent.noteId, title: "Alpha" });

            const res = await api.put(`/api/notes/${parent.noteId}/sort-children`, {
                body: { sortBy: "title", sortDirection: "asc", foldersFirst: false, sortNatural: false, sortLocale: "" }
            });
            expect(res.status).toBe(204);

            const children = becca.notes[parent.noteId].getChildNotes();
            expect(children[0].title).toBe("Alpha");
        });

        it("protects a note recursively", async () => {
            const { noteId } = await createTextNote(api, { title: "Protect target" });

            // The actual (un)protect requires an active protected session, which the
            // in-process tester does not have, so stub the recursive worker and assert
            // the handler drives it (with subtree) and reports task success.
            const spy = vi.spyOn(noteService, "protectNoteRecursively").mockImplementation(() => {});
            try {
                const res = await api.put(`/api/notes/${noteId}/protect/1`, { query: { subtree: "1" } });
                expect(res.status).toBe(204);
                expect(spy).toHaveBeenCalledWith(becca.notes[noteId], true, true, expect.anything());
            } finally {
                spy.mockRestore();
            }
        });

        it("duplicates a subtree under a parent", async () => {
            const original = await createTextNote(api, { title: "Original subtree" });
            await createTextNote(api, { parentNoteId: original.noteId, title: "Child" });

            interface DuplicateResponse {
                note: { noteId: string; title: string };
            }
            const res = await api.post<DuplicateResponse>(
                `/api/notes/${original.noteId}/duplicate/root`
            );
            expect(res.status).toBe(200);
            expect(res.body.note.noteId).not.toBe(original.noteId);
            expect(res.body.note.title).toContain("Original subtree");
            expect(becca.getNoteOrThrow(res.body.note.noteId).getChildNotes()).toHaveLength(1);
        });

        it("duplicates only the note when the body asks for no children", async () => {
            const original = await createTextNote(api, { title: "Original note only" });
            await createTextNote(api, { parentNoteId: original.noteId, title: "Child" });

            const res = await api.post<{ note: { noteId: string } }>(
                `/api/notes/${original.noteId}/duplicate/root`, { body: { withChildren: false } }
            );
            expect(res.status).toBe(200);
            expect(becca.getNoteOrThrow(res.body.note.noteId).getChildNotes()).toHaveLength(0);
        });
    });

    describe("erase and preview operations", () => {
        it("erases deleted notes now", async () => {
            const { noteId } = await createTextNote(api, { title: "Will be erased" });
            await api.delete(`/api/notes/${noteId}`, { query: { taskId: "erase-deleted", last: "true" } });

            const res = await api.post("/api/notes/erase-deleted-notes-now");
            expect(res.status).toBe(204);
            expect(noteIsDeleted(noteId)).toBeNull();
        });

        it("erases unused attachments now", async () => {
            const res = await api.post("/api/notes/erase-unused-attachments-now");
            expect(res.status).toBe(204);
        });

        it("previews a subtree to be deleted and surfaces broken relations", async () => {
            // parent → child, with an outside note holding a relation to the child;
            // deleting the parent recurses into the child and breaks the outside relation.
            const parent = await createTextNote(api, { title: "Preview parent" });
            const child = await createTextNote(api, { parentNoteId: parent.noteId, title: "Preview child" });
            const outside = await createTextNote(api, { title: "Preview outside" });

            const rel = await api.put(
                `/api/notes/${outside.noteId}/relations/refToChild/to/${child.noteId}`,
                { body: {} }
            );
            expect(rel.status).toBeLessThan(300);

            const res = await api.post<{ noteIdsToBeDeleted: string[]; brokenRelations: Array<{ noteId: string }> }>(
                "/api/delete-notes-preview",
                { body: { branchIdsToDelete: [ parent.branchId ], deleteAllClones: true } }
            );
            expect(res.status).toBe(200);
            expect(res.body.noteIdsToBeDeleted).toEqual(expect.arrayContaining([ parent.noteId, child.noteId ]));
            expect(res.body.brokenRelations.some((attr) => attr.noteId === outside.noteId)).toBe(true);
        });

        it("keeps a clone with another strong parent out of the delete preview", async () => {
            const note = await createTextNote(api, { title: "Previewed clone" });
            const otherParent = await createTextNote(api, { title: "Previewed clone parent" });
            const clone = await api.put(`/api/notes/${note.noteId}/clone-to-note/${otherParent.noteId}`, { body: {} });
            expect(clone.status).toBe(200);

            const res = await api.post<{ noteIdsToBeDeleted: string[] }>(
                "/api/delete-notes-preview",
                { body: { branchIdsToDelete: [ note.branchId ], deleteAllClones: false } }
            );
            expect(res.body.noteIdsToBeDeleted).not.toContain(note.noteId);
        });

        it("skips missing branches in the delete preview", async () => {
            const res = await api.post<{ noteIdsToBeDeleted: string[] }>(
                "/api/delete-notes-preview",
                { body: { branchIdsToDelete: [ "missingBranch123" ], deleteAllClones: false } }
            );
            expect(res.status).toBe(200);
            expect(res.body.noteIdsToBeDeleted).toEqual([]);
        });

        it("skips weak branches (e.g. bookmarks) in the delete preview", async () => {
            const note = await createTextNote(api, { title: "Weakly linked" });

            // A clone under _lbBookmarks produces a weak branch, which the preview ignores.
            interface CloneResponse { branchId: string }
            const clone = await api.put<CloneResponse>(
                `/api/notes/${note.noteId}/clone-to-note/_lbBookmarks`,
                { body: {} }
            );
            expect(clone.status).toBe(200);
            expect(clone.body.branchId).toBeTruthy();

            const res = await api.post<{ noteIdsToBeDeleted: string[] }>(
                "/api/delete-notes-preview",
                { body: { branchIdsToDelete: [ clone.body.branchId ], deleteAllClones: true } }
            );
            expect(res.status).toBe(200);
            expect(res.body.noteIdsToBeDeleted).toEqual([]);
        });
    });

    describe("read-only virtual notes", () => {
        beforeAll(() => {
            registerVirtualNoteProvider({
            namespace: "_vapi",
            parentNoteId: "_hidden",
            getSubtree: () => [{ id: "_vapiPage", title: "Page", type: "text" }],
            getContent: () => "<p>shipped</p>"
        });
        getContext().init(() => load());
        });

        afterAll(() => {
            unregisterVirtualNoteProvider("_vapi");
            getContext().init(() => load());
        });

        it("refuses content and revision writes as a client error", async () => {
            expect((await api.put("/api/notes/_vapiPage/data", { body: { content: "<p>edited</p>" } })).status).toBe(400);
            expect((await api.post("/api/notes/_vapiPage/revision")).status).toBe(400);
            expect(becca.getNoteOrThrow("_vapiPage").getContent()).toBe("<p>shipped</p>");
        });
    });
});
