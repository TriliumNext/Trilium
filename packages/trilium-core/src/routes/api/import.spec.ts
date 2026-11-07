import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { getBecca } from "../../becca/becca.js";
import enexImportService from "../../services/import/enex";
import singleImportService from "../../services/import/single";
import TaskContext from "../../services/task_context";
import { getSql } from "../../services/sql/index";
import { unwrapStringOrBuffer } from "../../services/utils/binary";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core import routes through {@link CoreApiTester} (no
 * Express) end to end — the REAL import services (single/zip/opml/enex) run
 * against the in-memory fixture DB, creating real notes/attachments that we
 * then assert against becca and the SQL store. Runs under both the node
 * (better-sqlite3) and standalone (sql.js WASM) suites.
 *
 * The single spy we keep is documented at its use site (the ENEX
 * array-result early-return, which `importEnex` can never produce with a real
 * input — its return type is a single BNote).
 */
let api: CoreApiTester;
let parentNoteId: string;
let branchId: string;

function file(originalname: string, buffer: Buffer | string, mimetype = "text/plain") {
    return { originalname, mimetype, buffer, size: Buffer.byteLength(buffer) };
}

function noteContent(noteId: string): string {
    return unwrapStringOrBuffer(getBecca().getNote(noteId)!.getContent());
}

describe("Import API (core)", () => {
    beforeAll(async () => {
        api = CoreApiTester.build();
        ({ noteId: parentNoteId, branchId } = await createTextNote(api, {
            title: "Import parent",
            content: "<p>parent body</p>"
        }));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe("importNotesToBranch", () => {
        it("rejects when no file is uploaded", async () => {
            const res = await api.post(`/api/notes/${parentNoteId}/notes-import`, { body: {} });
            expect(res.status).toBe(400);
        });

        it("imports a single plain-text file, creating a real note", async () => {
            const res = await api.post<{ noteId: string; title: string }>(
                `/api/notes/${parentNoteId}/notes-import`,
                { body: {}, file: file("greeting.txt", "Hello content") }
            );

            expect(res.status).toBe(200);
            expect(res.body.noteId).toBeTruthy();

            const note = getBecca().getNote(res.body.noteId);
            expect(note).toBeTruthy();
            expect(note!.getParentBranches().some((b) => b.parentNoteId === parentNoteId)).toBe(true);
            // plain text is wrapped in HTML paragraphs by the real importer
            expect(noteContent(res.body.noteId)).toContain("Hello content");
        });

        it("imports a single HTML file, deriving the title from <title>", async () => {
            const res = await api.post<{ noteId: string; title: string }>(
                `/api/notes/${parentNoteId}/notes-import`,
                {
                    body: {},
                    file: file("page.html", "<title>My Heading</title><p>body text</p>", "text/html")
                }
            );

            expect(res.status).toBe(200);
            expect(res.body.title).toBe("My Heading");
            expect(noteContent(res.body.noteId)).toContain("body text");
        });

        it("imports a real Trilium .zip produced by a round-trip export", async () => {
            const zip = await api.get<Buffer>(
                `/api/branches/${branchId}/export/subtree/html/exportTask`
            );
            expect(Buffer.isBuffer(zip.body)).toBe(true);

            const before = getBecca().getNote(parentNoteId)!.getChildNotes().length;
            const res = await api.post<{ noteId: string }>(
                `/api/notes/${parentNoteId}/notes-import`,
                { body: {}, file: { originalname: "roundtrip.zip", mimetype: "application/zip", buffer: zip.body } }
            );

            expect(res.status).toBe(200);
            expect(res.body.noteId).toBeTruthy();
            expect(getBecca().getNote(res.body.noteId)).toBeTruthy();
            expect(getBecca().getNote(parentNoteId)!.getChildNotes().length).toBeGreaterThan(before);
        });

        it("returns 500 when the zip importer throws on garbage bytes", async () => {
            const res = await api.post(`/api/notes/${parentNoteId}/notes-import`, {
                body: {},
                file: { originalname: "bad.zip", mimetype: "application/zip", buffer: Buffer.from("not a zip") }
            });

            expect(res.status).toBe(500);
        });

        it("imports an .opml document (single root) and creates the note", async () => {
            const opml = `<?xml version="1.0"?>
                <opml version="2.0"><body>
                    <outline text="OPML Root" _note="&lt;p&gt;opml content&lt;/p&gt;"/>
                </body></opml>`;
            const res = await api.post<{ noteId: string; title: string }>(
                `/api/notes/${parentNoteId}/notes-import`,
                { body: {}, file: file("doc.opml", opml) }
            );

            expect(res.status).toBe(200);
            expect(res.body.title).toBe("OPML Root");
            expect(noteContent(res.body.noteId)).toContain("opml content");
        });

        it("returns the array result early for an unsupported .opml version", async () => {
            // The real importOpml returns a `[400, message]` tuple for an
            // unsupported version, which the route returns verbatim (the
            // Array.isArray early-return branch).
            const opml = `<?xml version="1.0"?><opml version="9.9"><body></body></opml>`;
            const res = await api.post(`/api/notes/${parentNoteId}/notes-import`, {
                body: {},
                file: file("old.opml", opml)
            });

            expect(res.status).toBe(400);
        });

        it("imports an .enex notebook, creating the root note", async () => {
            const enex = `<?xml version="1.0" encoding="UTF-8"?>
                <en-export>
                    <note>
                        <title>Enex Note</title>
                        <content><![CDATA[<en-note><div>enex body</div></en-note>]]></content>
                        <created>20181121T193703Z</created>
                    </note>
                </en-export>`;
            const res = await api.post<{ noteId: string; title: string }>(
                `/api/notes/${parentNoteId}/notes-import`,
                { body: {}, file: file("book.enex", enex) }
            );

            expect(res.status).toBe(200);
            // root note title is the filename without the .enex extension
            expect(res.body.title).toBe("book");
            const root = getBecca().getNote(res.body.noteId)!;
            expect(root.getChildNotes().some((c) => c.title === "Enex Note")).toBe(true);
        });

        it("returns the array result early for .enex importers that return an array", async () => {
            // importEnex's return type is a single BNote — it can never produce
            // an array with a real input, so this Array.isArray early-return
            // branch is only reachable via a stub.
            vi.spyOn(enexImportService, "importEnex").mockResolvedValue([{ b: 2 }] as never);

            const res = await api.post(`/api/notes/${parentNoteId}/notes-import`, {
                body: {},
                file: file("arr.enex", "<en-export></en-export>")
            });

            expect(res.status).toBe(200);
            expect(res.body).toEqual([{ b: 2 }]);
        });

        it("returns 500 when no note is generated (empty opml body)", async () => {
            // A well-formed OPML with an empty body yields no note → the route's
            // `if (!note)` 500 branch, all with a real input.
            const opml = `<?xml version="1.0"?><opml version="2.0"><body></body></opml>`;
            const res = await api.post(`/api/notes/${parentNoteId}/notes-import`, {
                body: {},
                file: file("empty.opml", opml)
            });

            expect(res.status).toBe(500);
        });

        it("schedules taskSucceeded when last === 'true'", async () => {
            const succeeded = vi.spyOn(TaskContext.prototype, "taskSucceeded");
            vi.useFakeTimers();

            const res = await api.post<{ noteId: string }>(
                `/api/notes/${parentNoteId}/notes-import`,
                { body: { last: "true" }, file: file("last.txt", "tail note") }
            );

            expect(res.status).toBe(200);
            const importedNoteId = res.body.noteId;
            vi.runAllTimers();
            expect(succeeded).toHaveBeenCalledWith(
                expect.objectContaining({ parentNoteId, importedNoteId })
            );
        });
    });

    describe("importAttachmentsToNote", () => {
        it("rejects when no file is uploaded", async () => {
            const res = await api.post(`/api/notes/${parentNoteId}/attachments-import`, { body: {} });
            expect(res.status).toBe(400);
        });

        it("imports a real attachment onto the note (204)", async () => {
            const before = getSql().getValue<number>(
                `SELECT COUNT(*) FROM attachments WHERE ownerId = ?`,
                [parentNoteId]
            );

            const res = await api.post(`/api/notes/${parentNoteId}/attachments-import`, {
                body: {},
                file: file("attach.txt", "attachment payload")
            });

            expect(res.status).toBe(204);
            const after = getSql().getValue<number>(
                `SELECT COUNT(*) FROM attachments WHERE ownerId = ?`,
                [parentNoteId]
            );
            expect(after).toBe(before + 1);
            expect(getBecca().getNote(parentNoteId)!.getAttachments().some((a) => a.title === "attach.txt")).toBe(true);
        });

        it("returns 500 when the attachment importer throws", async () => {
            // The real `importAttachment` writes synchronously and has no input
            // that throws synchronously against the in-memory fixture (image
            // processing is async, saveAttachment tolerates any content). A
            // single spy isolates the route's catch → 500 branch.
            vi.spyOn(singleImportService, "importAttachment").mockImplementation(() => {
                throw new Error("boom");
            });

            const res = await api.post(`/api/notes/${parentNoteId}/attachments-import`, {
                body: {},
                file: file("x.bin", "payload", "application/octet-stream")
            });

            expect(res.status).toBe(500);
        });

        it("schedules taskSucceeded when last === 'true'", async () => {
            const succeeded = vi.spyOn(TaskContext.prototype, "taskSucceeded");
            vi.useFakeTimers();

            const res = await api.post(`/api/notes/${parentNoteId}/attachments-import`, {
                body: { last: "true" },
                file: file("tail.txt", "tail attachment")
            });

            expect(res.status).toBe(204);
            vi.runAllTimers();
            expect(succeeded).toHaveBeenCalledWith(expect.objectContaining({ parentNoteId }));
        });
    });
});
