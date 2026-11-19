import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
    type CachedTocResponse, MAX_TOC_DEPTH, type NoteReferencesResponse, PDF_TOC_READER
} from "@triliumnext/commons";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../../becca/becca";
import type BNote from "../../becca/entities/bnote";
import { getContext } from "../../services/context";
import { getLog } from "../../services/log";
import noteService from "../../services/notes";
import protectedSessionService from "../../services/protected_session";
import TaskContext from "../../services/task_context";
import {
    registerTocGenerator, TOC_CACHE_ROLE, type TocGenerator, unregisterTocGenerator
} from "../../services/toc/index";
import { CoreApiTester } from "../../test/api_tester";
import { encodeUtf8 } from "../../services/utils/binary";

/**
 * Drives the ToC and reference routes of PDF notes and attachments through {@link CoreApiTester},
 * so this spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;
let counter = 0;

const PROPERTIES = { reader: PDF_TOC_READER };
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../services/toc/fixtures");

beforeAll(() => {
    api = CoreApiTester.build();
});

beforeEach(() => {
    vi.spyOn(getLog(), "info").mockImplementation(() => {});
    vi.spyOn(getLog(), "error").mockImplementation(() => {});
});

afterEach(() => {
    unregisterTocGenerator("pdf");
    protectedSessionService.resetDataKey();
    vi.restoreAllMocks();
});

describe("references of a PDF", () => {
    it("lists the headings that lead to a page, with their page and id, shown at most at depth 32", async () => {
        registerTocGenerator("pdf", async () => ({
            headings: [
                { title: "Chapter 1", level: 1, page: 1 },
                { title: "Nowhere", level: 1 },
                ...Array.from({ length: 39 }, (_, index) => ({ title: `Level ${index + 2}`, level: index + 2, page: 3 }))
            ],
            properties: PROPERTIES
        }));
        const note = createPdf();

        const { status, body } = await api.get<NoteReferencesResponse>(`/api/notes/${note.noteId}/references`);

        expect(status).toBe(200);
        expect(body.blobId).toBe(note.blobId);
        expect(body.pendingToc).toBeUndefined();
        const [ chapter, ...deep ] = body.targets;
        const cached = readCache(note);
        expect(chapter).toStrictEqual({
            kind: "heading", title: "Chapter 1", level: 1,
            params: { page: "1", heading: cached.headings[0].id }
        });
        expect(body.targets.map(({ title }) => title)).not.toContain("Nowhere");
        expect(deep.at(-1)).toMatchObject({ title: "Level 40", level: MAX_TOC_DEPTH });
        expect(cached.headings.at(-1)).toMatchObject({ title: "Level 40", level: 40 });
    });

    it("reads the cache without reading the note again, and takes no references", async () => {
        registerTocGenerator("pdf", async () => ({
            headings: [ { title: "Chapter 1", level: 1, page: 1 } ], properties: PROPERTIES
        }));
        const note = createPdf();
        await api.get(`/api/notes/${note.noteId}/references`);
        const getContent = vi.spyOn(becca.getNoteOrThrow(note.noteId), "getContent");

        const { body } = await api.get<NoteReferencesResponse>(`/api/notes/${note.noteId}/references`);

        expect(body.targets).toHaveLength(1);
        expect(getContent).not.toHaveBeenCalled();
        const refused = await api.post(`/api/notes/${note.noteId}/references`, {
            body: { kind: "heading", index: 0, title: "Chapter 1" }
        });
        expect(refused.status).toBe(400);
    });

    it("lists nothing for a file that cannot be read", async () => {
        registerTocGenerator("pdf", () => Promise.reject(new Error("Unreadable")));
        const note = createPdf();

        const { status, body } = await api.get<NoteReferencesResponse>(`/api/notes/${note.noteId}/references`);

        expect(status).toBe(200);
        expect(body.targets).toStrictEqual([]);
    });

    it("reports that the viewer builds the table of contents where no generator reads it", async () => {
        const note = createPdf();

        const { body } = await api.get<NoteReferencesResponse>(`/api/notes/${note.noteId}/references`);

        expect(body).toStrictEqual({ targets: [], blobId: note.blobId, pendingToc: { format: "pdf" } });
        expect(note.getAttachmentsByRole(TOC_CACHE_ROLE)).toHaveLength(0);
    });

    it("lists the headings of a PDF attachment", async () => {
        registerTocGenerator("pdf", fixedGenerator("Attached"));
        const note = createPdf();
        const attachment = getContext().init(() => note.saveAttachment({
            role: "file", mime: "application/pdf", title: "attached.pdf", content: "%PDF attached"
        }));

        const { status, body } = await api.get<NoteReferencesResponse>(
            `/api/attachments/${attachment.attachmentId}/references`);

        expect(status).toBe(200);
        expect(body.blobId).toBe(attachment.blobId);
        expect(body.targets.map(({ title }) => title)).toStrictEqual([ "Attached" ]);
        expect((await api.get("/api/attachments/doesNotExist/references")).status).toBe(404);
    });
});

describe("the ToC cache routes", () => {
    it("reads, saves and reads again the cache of a note", async () => {
        const note = createPdf();
        const url = `/api/notes/${note.noteId}/toc`;
        expect((await api.get<CachedTocResponse>(url)).body)
            .toStrictEqual({ status: "missing", pendingToc: { format: "pdf" } });

        const saved = await api.put<CachedTocResponse>(url, { body: {
            targetBlobHash: note.blobId, headings: [ { title: "Chapter 1", level: 1, page: 1 } ],
            properties: PROPERTIES, elapsedMs: 12
        } });

        expect(saved.status).toBe(200);
        expect(saved.body).toMatchObject({ status: "ready", blobId: note.blobId, headings: [ { title: "Chapter 1" } ] });
        expect((await api.get<CachedTocResponse>(url)).body).toStrictEqual(saved.body);
    });

    it("answers 409 for a table of contents of another blob, and 404 or 400 for a document without one", async () => {
        const note = createPdf();
        const body = { targetBlobHash: "anotherBlob123456789", headings: [], properties: PROPERTIES, elapsedMs: 1 };

        const conflict = await api.put(`/api/notes/${note.noteId}/toc`, { body });
        expect(conflict.status).toBe(409);
        expect(conflict.body).toMatchObject({ reason: "changed" });

        expect((await api.put("/api/notes/doesNotExist/toc", { body })).status).toBe(404);
        expect((await api.put("/api/notes/root/toc", { body })).status).toBe(400);
        expect((await api.get<CachedTocResponse>("/api/notes/root/toc")).body).toStrictEqual({ status: "none" });
    });

    it("reads and saves the cache of an attachment", async () => {
        const note = createPdf();
        const attachment = getContext().init(() => note.saveAttachment({
            role: "file", mime: "application/pdf", title: "attached.pdf", content: "%PDF attached"
        }));
        const url = `/api/attachments/${attachment.attachmentId}/toc`;

        const saved = await api.put<CachedTocResponse>(url, { body: {
            targetBlobHash: attachment.blobId, headings: [ { title: "Appendix", level: 1, page: 2 } ],
            properties: PROPERTIES, elapsedMs: 3
        } });

        expect(saved.body).toMatchObject({ status: "ready", headings: [ { title: "Appendix", page: 2 } ] });
        expect((await api.get(url)).body).toStrictEqual(saved.body);
        expect(note.getAttachmentsByRole(TOC_CACHE_ROLE).map(({ title }) => title))
            .toStrictEqual([ `${attachment.attachmentId}.toc-cache.json` ]);
    });
});

describe("the contract between the readers", () => {
    const contractPdf = new Uint8Array(fs.readFileSync(path.join(FIXTURES, "toc_contract.pdf")));
    const contract = JSON.parse(fs.readFileSync(path.join(FIXTURES, "toc_contract.json"), "utf-8"));

    async function saveContract(note: BNote) {
        const { body } = await api.put<CachedTocResponse>(`/api/notes/${note.noteId}/toc`, { body: {
            targetBlobHash: note.blobId, headings: contract.headings, properties: PROPERTIES, elapsedMs: 9
        } });
        return body.status === "ready" ? body.headings.map(({ id }) => id) : body;
    }

    it("saves what the viewer reads from the contract PDF with the ids that the server reads", async () => {
        const note = createPdf(contractPdf);

        expect(note.blobId).toBe(contract.blobId);
        expect(await saveContract(note)).toStrictEqual(contract.ids);
    });

    it("binds the headings of the protected contract PDF to its protected blob", async () => {
        const note = createPdf(contractPdf);
        protectedSessionService.setDataKey(encodeUtf8("0123456789abcdef"));
        getContext().init(() => noteService.protectNoteRecursively(note, true, false,
            new TaskContext("toc-routes", "protectNotes", { protect: true })));

        expect(note.blobId).toBe(contract.protectedBlobId);
        expect(await saveContract(note)).toStrictEqual(contract.protectedIds);
    });
});

function createPdf(content: string | Uint8Array = `%PDF ${counter + 1}`): BNote {
    counter++;
    return getContext().init(() => noteService.createNewNote({
        parentNoteId: "root", title: `toc-routes-${counter}`, type: "file", mime: "application/pdf",
        content
    })).note;
}

function fixedGenerator(title: string): TocGenerator {
    return async () => ({ headings: [ { title, level: 1, page: 1 } ], properties: PROPERTIES });
}

function readCache(note: BNote) {
    const [ attachment ] = note.getAttachmentsByRole(TOC_CACHE_ROLE);
    return JSON.parse(String(attachment.getContent())) as { headings: { id: string; title: string; level: number }[] };
}
