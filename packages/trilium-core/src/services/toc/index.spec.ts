import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
    assignHeadingIds, DOCX_MIME, EPUB_MIME_TYPES, findTocFormatName, getBlobTag, MAX_TOC_HEADINGS,
    ODT_MIME, OFFICE_MIME_TYPES, OFFICE_PREVIEW_TOO_LARGE_MESSAGE, PDF_TOC_READER, type TocCache
} from "@triliumnext/commons";
import { OfficeConverter } from "officeparser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../../becca/becca.js";
import BAttachment from "../../becca/entities/battachment.js";
import type BNote from "../../becca/entities/bnote.js";
import {
    ConflictError, ContentNotAvailableError, DetailedConflictError, NotFoundError, ValidationError
} from "../../errors.js";
import { getContext } from "../context.js";
import { getLog } from "../log.js";
import noteService from "../notes.js";
import protectedSessionService from "../protected_session.js";
import { getSql } from "../sql/index.js";
import TaskContext from "../task_context.js";
import { decodeUtf8, encodeUtf8 } from "../utils/binary.js";
import { EPUB_TOC_READER } from "./epub.js";
import {
    buildToc, createLevelTracker, findTocFormat, type GeneratedToc, getToc, readCachedToc,
    registerTocGenerator, saveClientToc, TOC_CACHE_ROLE, type TocDocumentRef, type TocGenerator,
    unregisterTocGenerator
} from "./index.js";
import { DOCX_TOC_READER, ODT_TOC_READER } from "./office.js";

const PROPERTIES = { reader: PDF_TOC_READER };
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const PROTECTED_KEY = encodeUtf8("0123456789abcdef");

let counter = 0;
let info: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    info = vi.spyOn(getLog(), "info").mockImplementation(() => {});
    error = vi.spyOn(getLog(), "error").mockImplementation(() => {});
});

afterEach(() => {
    for (const format of [ "pdf", "docx", "odt", "epub" ]) {
        unregisterTocGenerator(format);
    }
    protectedSessionService.resetDataKey();
    vi.restoreAllMocks();
});

describe("getToc", () => {
    it("builds and saves the cache of a PDF note once, then reads it without the generator", async () => {
        const generator = register();
        const note = createPdf("Alpha");

        const first = await toc(noteRef(note));
        const cache = readyCache(first);
        const [ attachment ] = caches(note);
        expect(caches(note)).toHaveLength(1);
        expect(attachment).toMatchObject({ role: TOC_CACHE_ROLE, mime: "application/json", title: "toc-cache.json" });
        expect(readJson(attachment)).toStrictEqual(cache);
        expect(cache).toStrictEqual({
            version: 1,
            targetBlobHash: note.blobId,
            headings: [
                { id: expect.stringMatching(/^[0-9a-z]{14}$/), title: "Alpha", level: 1, page: 1 },
                { id: expect.stringMatching(new RegExp(`\\.${getBlobTag(String(note.blobId))}$`)), title: "Summary", level: 2, page: 2 },
                { id: expect.any(String), title: "Summary", level: 2 }
            ],
            pdf: PROPERTIES
        });
        expect(info).toHaveBeenCalledWith(expect.stringMatching(
            new RegExp(`^Created ToC cache for note '${note.noteId}'\\. Found 3 headings in \\d+ ms\\.$`)));

        const second = await toc(noteRef(note));
        expect(readyCache(second)).toStrictEqual(cache);
        expect(generator).toHaveBeenCalledTimes(1);
    });

    it("binds every heading of a table of contents that the generator cut", async () => {
        register(async () => ({ ...outlineOf("Alpha"), isCut: true }));
        const note = createPdf("Alpha");

        const { headings } = readyCache(await toc(noteRef(note)));

        const tag = getBlobTag(String(note.blobId));
        expect(headings.filter(({ id }) => !id.endsWith(`.${tag}`))).toStrictEqual([]);
    });

    it("rebuilds for a new blob into the same attachment, and logs the update", async () => {
        const generator = register();
        const note = createPdf("Alpha");
        await toc(noteRef(note));
        const [ attachment ] = caches(note);

        setContent(note, "Beta");
        const cache = readyCache(await toc(noteRef(note)));

        expect(cache.headings[0].title).toBe("Beta");
        expect(caches(note).map(({ attachmentId }) => attachmentId)).toStrictEqual([ attachment.attachmentId ]);
        expect(readJson(caches(note)[0]).targetBlobHash).toBe(note.blobId);
        expect(generator).toHaveBeenCalledTimes(2);
        expect(info).toHaveBeenCalledWith(expect.stringMatching(/^Updated ToC cache for note '/));
    });

    it("rebuilds a cache that does not pass every check", async () => {
        const generator = register();
        const note = createPdf("Alpha");
        await toc(noteRef(note));
        const [ attachment ] = caches(note);
        const valid = readJson(attachment);

        const invalid = [
            "not JSON", "[]", JSON.stringify({ ...valid, version: 2 }),
            JSON.stringify({ ...valid, pdf: { reader: PDF_TOC_READER, failed: true } }),
            JSON.stringify({ ...valid, pdf: { reader: PDF_TOC_READER + 1 } }),
            JSON.stringify({ ...valid, pdf: null }),
            JSON.stringify({ ...valid, targetBlobHash: 5 }),
            JSON.stringify({ ...valid, headings: {} }),
            JSON.stringify({ ...valid, headings: [ { ...valid.headings[0], id: 1 } ] }),
            JSON.stringify({ ...valid, headings: [ { ...valid.headings[0], title: null } ] }),
            JSON.stringify({ ...valid, headings: [ { ...valid.headings[0], level: 0 } ] }),
            JSON.stringify({ ...valid, headings: [ "Alpha" ] })
        ];
        for (const content of invalid) {
            setContent(attachment, content);
            expect(readyCache(await toc(noteRef(note))), content).toStrictEqual(valid);
        }
        expect(generator).toHaveBeenCalledTimes(invalid.length + 1);
    });

    it("reads a cache whose content comes as bytes", async () => {
        const generator = register();
        const note = createPdf("Alpha");
        const cache = readyCache(await toc(noteRef(note)));
        const [ attachment ] = caches(note);
        getContext().init(() => {
            attachment.mime = "application/octet-stream";
            // Other bytes than the stored string, so that a new blob holds them as bytes.
            attachment.setContent(encodeUtf8(JSON.stringify(cache, null, 1)), { forceSave: true });
        });

        expect(readyCache(await toc(noteRef(note)))).toStrictEqual(cache);
        expect(generator).toHaveBeenCalledTimes(1);
    });

    it("runs one build for concurrent requests of a blob", async () => {
        const held = holdGenerator();
        const note = createPdf("Alpha");

        const requests = [ toc(noteRef(note)), toc(noteRef(note)) ];
        held.release("Alpha");
        const [ first, second ] = await Promise.all(requests);

        expect(held.generator).toHaveBeenCalledTimes(1);
        expect(readyCache(second)).toStrictEqual(readyCache(first));
        expect(caches(note)).toHaveLength(1);
    });

    it("answers that the viewer builds, without writing, when no generator reads the format", async () => {
        const note = createPdf("Alpha");

        const result = await toc(noteRef(note));

        expect(result).toMatchObject({ status: "client", format: { name: "pdf" } });
        expect(caches(note)).toHaveLength(0);
    });

    it("answers nothing for a document without a format, and refuses one that is gone", async () => {
        register();
        const { note } = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root", title: "Not a PDF", type: "text", content: "<p>x</p>"
        }));

        expect(await toc(noteRef(note))).toBeNull();
        const picture = getContext().init(() => note.saveAttachment({
            role: "file", mime: "image/png", title: "picture.png", content: "png"
        }));
        expect(await toc({ kind: "attachment", attachmentId: String(picture.attachmentId) })).toBeNull();
        await expect(toc({ kind: "note", noteId: "doesNotExist" })).rejects.toThrow(NotFoundError);
        await expect(toc({ kind: "attachment", attachmentId: "doesNotExist" })).rejects.toThrow(NotFoundError);
    });

    it("binds headings of a protected PDF to its protected blob, and needs the protected session", async () => {
        register();
        const note = createPdf("Alpha");
        protectedSessionService.setDataKey(PROTECTED_KEY);
        getContext().init(() => noteService.protectNoteRecursively(note, true, false,
            new TaskContext("toc-spec", "protectNotes", { protect: true })));

        const cache = readyCache(await toc(noteRef(note)));
        const tag = getBlobTag(String(note.blobId));
        expect(cache.headings[1].id).toMatch(new RegExp(`\\.${tag}\\.p$`));
        expect(caches(note)[0].isProtected).toBe(true);

        protectedSessionService.resetDataKey();
        await expect(toc(noteRef(note))).rejects.toThrow(ContentNotAvailableError);
        expect(() => readCachedToc(noteRef(note))).toThrow(ContentNotAvailableError);
    });

    it("keeps the cache of an attachment on its note, under the attachment's id", async () => {
        register();
        const note = createPdf("Owner");
        const attachment = saveAttachment(note, "Attached");

        const cache = readyCache(await toc({ kind: "attachment", attachmentId: String(attachment.attachmentId) }));

        expect(cache.headings[0].title).toBe("Attached");
        expect(cache.targetBlobHash).toBe(attachment.blobId);
        expect(caches(note).map(({ title }) => title)).toStrictEqual([ `${attachment.attachmentId}.toc-cache.json` ]);
        expect(info).toHaveBeenCalledWith(expect.stringMatching(
            new RegExp(`^Created ToC cache for attachment '${attachment.attachmentId}'\\.`)));
    });

    it("builds without saving for a document whose note cannot keep a cache", async () => {
        register();
        const note = createPdf("Virtual");
        const attachment = saveAttachment(note, "Attached");
        note.isVirtual = true;
        try {
            expect(readyCache(await toc(noteRef(note))).headings).toHaveLength(3);
            const ref: TocDocumentRef = { kind: "attachment", attachmentId: String(attachment.attachmentId) };
            expect(readyCache(await toc(ref)).headings[0].title).toBe("Attached");
        } finally {
            note.isVirtual = false;
        }
        expect(caches(note)).toHaveLength(0);

        const revision = getContext().init(() => note.saveRevision());
        const [ revisionAttachment ] = revision.getAttachments();
        const ref: TocDocumentRef = { kind: "attachment", attachmentId: String(revisionAttachment.attachmentId) };
        expect(readyCache(await toc(ref)).headings[0].title).toBe("Attached");
        expect(caches(note)).toHaveLength(0);
    });

    it("leaves a file of the user's titled like the cache alone", async () => {
        register();
        const note = createPdf("Alpha");
        const userFile = getContext().init(() => note.saveAttachment({
            role: "file", mime: "application/json", title: "toc-cache.json", content: "{\"mine\":true}"
        }));

        await toc(noteRef(note));

        expect(String(becca.getAttachmentOrThrow(String(userFile.attachmentId)).getContent())).toBe("{\"mine\":true}");
        expect(caches(note)).toHaveLength(1);
    });

    describe("the sweep", () => {
        it("prunes duplicates of the title it saves and orphaned caches, and nothing else", async () => {
            register();
            const note = createPdf("Owner");
            const x = saveAttachment(note, "X");
            const y = saveAttachment(note, "Y");
            const yRef: TocDocumentRef = { kind: "attachment", attachmentId: String(y.attachmentId) };
            const yCache = readyCache(await toc(yRef));
            const yTitle = `${y.attachmentId}.toc-cache.json`;
            // A stale duplicate of Y's cache, as a sync from another instance could bring it.
            const yStale = addCache(note, yTitle, { ...yCache, targetBlobHash: "someOtherBlob1234567" });
            const orphan = addCache(note, "gone12345678.toc-cache.json", yCache);
            const unknown = addCache(note, "renamed by hand", yCache);
            const xTitle = `${x.attachmentId}.toc-cache.json`;
            const [ xKept, xDuplicate ] = [ addCache(note, xTitle, yCache), addCache(note, xTitle, yCache) ]
                .sort((a, b) => String(a.attachmentId) < String(b.attachmentId) ? -1 : 1);
            const noteCache = addCache(note, "toc-cache.json", yCache);

            await toc({ kind: "attachment", attachmentId: String(x.attachmentId) });

            const titles = caches(note).map(({ title }) => title).sort();
            expect(titles).toStrictEqual([ xTitle, "toc-cache.json", yTitle, yTitle ].sort());
            expect(isDeleted(orphan)).toBe(true);
            expect(isDeleted(unknown)).toBe(true);
            expect(isDeleted(xDuplicate)).toBe(true);
            expect(isDeleted(yStale)).toBe(false);
            expect(isDeleted(noteCache)).toBe(false);
            // Saved into the cache of its title with the smallest id.
            expect(readJson(becca.getAttachmentOrThrow(String(xKept.attachmentId))).targetBlobHash)
                .toBe(x.blobId);
            expect(readyCache(await toc(yRef))).toStrictEqual(yCache);
        });
    });

    describe("a build whose document changes", () => {
        it("writes nothing, and its request answers from the cache that the newer build saved", async () => {
            const held = holdGenerator();
            const note = createPdf("Alpha");

            const stale = toc(noteRef(note));
            setContent(note, "Beta");
            const fresh = toc(noteRef(note));
            held.release("Beta");
            const freshCache = readyCache(await fresh);
            held.release("Alpha");

            expect(readyCache(await stale)).toStrictEqual(freshCache);
            expect(freshCache.headings[0].title).toBe("Beta");
            expect(caches(note)).toHaveLength(1);
            expect(readJson(caches(note)[0]).targetBlobHash).toBe(note.blobId);
        });

        it("reads an attachment again from the database before it saves", async () => {
            const held = holdGenerator();
            const note = createPdf("Owner");
            const attachment = saveAttachment(note, "Alpha");
            const ref: TocDocumentRef = { kind: "attachment", attachmentId: String(attachment.attachmentId) };

            const stale = toc(ref);
            setContent(becca.getAttachmentOrThrow(String(attachment.attachmentId)), "Beta");
            held.release("Alpha");
            await vi.waitFor(() => expect(held.generator).toHaveBeenCalledTimes(2));
            const retried = toc(ref);
            held.release("Beta");

            expect(readyCache(await stale).headings[0].title).toBe("Beta");
            expect(readyCache(await retried).headings[0].title).toBe("Beta");
            expect(caches(note)).toHaveLength(1);
        });

        it("keeps a cache that another instance saved for the blob meanwhile", async () => {
            const held = holdGenerator();
            const note = createPdf("Alpha");
            const request = toc(noteRef(note));
            const synced = {
                version: 1, targetBlobHash: String(note.blobId), headings: [], pdf: PROPERTIES
            };
            addCache(note, "toc-cache.json", synced);

            held.release("Alpha");

            expect(readyCache(await request).headings).toHaveLength(3);
            expect(caches(note).map(readJson)).toStrictEqual([ synced ]);
        });

        it("answers 404 for a document deleted while it was read, and writes nothing", async () => {
            const held = holdGenerator();
            const note = createPdf("Alpha");

            const request = toc(noteRef(note));
            getContext().init(() => note.deleteNote());
            held.release("Alpha");

            await expect(request).rejects.toThrow(NotFoundError);
            expect(note.getAttachmentsByRole(TOC_CACHE_ROLE)).toHaveLength(0);
        });

        it("answers 409 for a document that changed during two builds in a row", async () => {
            const held = holdGenerator();
            const note = createPdf("Alpha");

            const request = toc(noteRef(note));
            setContent(note, "Beta");
            held.release("Alpha");
            await vi.waitFor(() => expect(held.generator).toHaveBeenCalledTimes(2));
            setContent(note, "Gamma");
            held.release("Beta");

            await expect(request).rejects.toThrow(ConflictError);
            expect(caches(note)).toHaveLength(0);
        });
    });

    describe("failures", () => {
        it("caches an outline without headings like any other", async () => {
            const generator = register(async () => ({ headings: [], properties: PROPERTIES }));
            const note = createPdf("Empty");

            expect(readyCache(await toc(noteRef(note))).headings).toStrictEqual([]);
            expect(readyCache(await toc(noteRef(note))).headings).toStrictEqual([]);
            expect(generator).toHaveBeenCalledTimes(1);
            expect(info).toHaveBeenCalledWith(expect.stringMatching(/Found 0 headings in \d+ ms\.$/));
        });

        it("writes nothing for a failure that can pass, and reads the file again at the next request", async () => {
            const note = createPdf("Alpha");
            register(() => Promise.reject(new Error("The worker stopped.")));

            expect(await toc(noteRef(note))).toStrictEqual({ status: "unreadable" });
            expect(error).toHaveBeenCalledWith(
                `Failed to read the ToC of note '${note.noteId}': Error: The worker stopped.`);
            register(() => Promise.reject("Timeout"));
            expect(await toc(noteRef(note))).toStrictEqual({ status: "unreadable" });
            expect(error).toHaveBeenCalledWith(`Failed to read the ToC of note '${note.noteId}': Timeout`);
            expect(caches(note)).toHaveLength(0);

            register();
            expect(readyCache(await toc(noteRef(note))).headings).toHaveLength(3);
        });

        it("treats an invalid table of contents from a generator as a failure", async () => {
            const note = createPdf("Alpha");
            register(async () => ({ headings: [ { title: "Deep", level: 2 } ], properties: PROPERTIES }));

            expect(await toc(noteRef(note))).toStrictEqual({ status: "unreadable" });
            expect(error).toHaveBeenCalledWith(expect.stringContaining("read an invalid table of contents"));
            expect(caches(note)).toHaveLength(0);
        });

        it("remembers a file that pdf.js can never open for its blob only", async () => {
            const generator = register(() => Promise.reject(namedError("InvalidPDFException")));
            const note = createPdf("Broken");

            expect(await toc(noteRef(note))).toStrictEqual({ status: "unreadable" });
            expect(await toc(noteRef(note))).toStrictEqual({ status: "unreadable" });
            expect(generator).toHaveBeenCalledTimes(1);
            expect(info).toHaveBeenCalledWith(`Failed to read the ToC of note '${note.noteId}': InvalidPDFException`);
            expect(caches(note)).toHaveLength(0);

            setContent(note, "Still broken");
            await toc(noteRef(note));
            expect(generator).toHaveBeenCalledTimes(2);
        });

        it("forgets the oldest of the files it remembers past its limit", async () => {
            const generator = register(() => Promise.reject(namedError("PasswordException")));
            const note = createPdf("Locked 0");
            await toc(noteRef(note));
            for (let index = 1; index <= 1_000; index++) {
                setContent(note, `Locked ${index}`);
                await toc(noteRef(note));
            }
            expect(generator).toHaveBeenCalledTimes(1_001);

            setContent(note, "Locked 0");
            await toc(noteRef(note));
            expect(generator).toHaveBeenCalledTimes(1_002);
        }, 60_000);
    });
});

describe("documents of Word and OpenDocument", () => {
    it("build with the format's own generator, for notes and attachments", async () => {
        for (const [ name, mime ] of [ [ "docx", DOCX_MIME ], [ "odt", ODT_MIME ] ]) {
            const bytes = new Uint8Array(
                fs.readFileSync(path.join(FIXTURES, `toc_contract.${name}`)));
            const contract = JSON.parse(
                fs.readFileSync(path.join(FIXTURES, `toc_contract_${name}.json`), "utf-8"));
            const note = createDocument(bytes, mime);
            const attachment = getContext().init(() => note.saveAttachment({
                role: "file", mime, title: `attached.${name}`, content: bytes
            }));

            for (const ref of [ noteRef(note), attachmentRef(attachment) ]) {
                const cache = readyCache(await toc(ref));
                expect(cache.headings.map(({ id }) => id)).toStrictEqual(contract.ids);
                const reader = name === "docx" ? DOCX_TOC_READER : ODT_TOC_READER;
                expect(cache[name]).toStrictEqual({ reader, bookmarks: contract.bookmarks });
            }
        }
    });

    it("let a registered generator take precedence, and never ask a viewer to build", async () => {
        const generator = registerFor("docx");
        const note = createDocument("Alpha", DOCX_MIME);
        const request = () => ({
            targetBlobHash: note.blobId, headings: [], properties: { reader: DOCX_TOC_READER },
            elapsedMs: 1
        });

        expect(readCachedToc(noteRef(note))).toStrictEqual({ status: "missing" });
        expect(() => save(noteRef(note), request())).toThrow(ValidationError);
        expect(readyCache(await toc(noteRef(note))).headings[0].title).toBe("Alpha");
        expect(generator).toHaveBeenCalledOnce();

        unregisterTocGenerator("docx");
        setContent(note, "Beta");
        expect(readCachedToc(noteRef(note))).not.toHaveProperty("pendingToc");
        expect(() => save(noteRef(note), request())).toThrow(ValidationError);
    });

    it("rebuild the caches of the format whose reader changed, and keep the other's", async () => {
        const docx = registerFor("docx");
        const odt = registerFor("odt");
        const docxNote = createDocument("Alpha", DOCX_MIME);
        const odtNote = createDocument("Alpha", ODT_MIME);
        addCache(docxNote, "toc-cache.json", {
            version: 1, targetBlobHash: String(docxNote.blobId), headings: [],
            docx: { reader: DOCX_TOC_READER - 1 }
        });
        addCache(odtNote, "toc-cache.json", {
            version: 1, targetBlobHash: String(odtNote.blobId), headings: [],
            odt: { reader: ODT_TOC_READER, bookmarks: [] }
        });

        expect(readyCache(await toc(noteRef(docxNote))).headings).toHaveLength(1);
        expect(readyCache(await toc(noteRef(odtNote))).headings).toHaveLength(0);
        expect(docx).toHaveBeenCalledOnce();
        expect(odt).not.toHaveBeenCalled();
    });

    describe("failures", () => {
        it.each([
            [
                "a code that says the bytes cannot be read", officeIssue("FILE_CORRUPTED"),
                "FILE_CORRUPTED"
            ],
            [
                "the refusal of a file too large",
                new ValidationError(`${OFFICE_PREVIEW_TOO_LARGE_MESSAGE} (1 bytes).`),
                "ValidationError"
            ]
        ])("remember %s, and name it in the log", async (_, failure, logged) => {
            const generator = registerFor("docx", () => Promise.reject(failure));
            const note = createDocument("Alpha", DOCX_MIME);

            expect(await toc(noteRef(note))).toStrictEqual({ status: "unreadable" });
            expect(await toc(noteRef(note))).toStrictEqual({ status: "unreadable" });
            expect(generator).toHaveBeenCalledOnce();
            const line = `Failed to read the ToC of note '${note.noteId}': ${logged}`;
            expect(info).toHaveBeenCalledWith(line);
        });

        it.each([
            [
                "an error with only the header of officeparser",
                new Error("[OfficeParser]: Secret title"), "Error"
            ],
            [ "a code about the call", officeIssue("INVALID_INPUT"), "INVALID_INPUT" ],
            [ "a code about the run", officeIssue("OPERATION_ABORTED"), "OPERATION_ABORTED" ]
        ])("read again after %s, never logging its message", async (_, failure, logged) => {
            const generator = registerFor("docx", () => Promise.reject(failure));
            const note = createDocument("Alpha", DOCX_MIME);

            expect(await toc(noteRef(note))).toStrictEqual({ status: "unreadable" });
            const line = `Failed to read the ToC of note '${note.noteId}': ${logged}`;
            expect(error).toHaveBeenLastCalledWith(line);
            generator.mockImplementation(async (content) => officeOutlineOf(decodeUtf8(content)));
            expect(readyCache(await toc(noteRef(note))).headings[0].title).toBe("Alpha");
            expect(generator).toHaveBeenCalledTimes(2);
        });

        it("remember a PDF that cannot be read apart from the DOCX of its blob", async () => {
            const pdf = register(() => Promise.reject(namedError("InvalidPDFException")));
            const note = createPdf("Alpha");
            expect(await toc(noteRef(note))).toStrictEqual({ status: "unreadable" });

            const docx = registerFor("docx");
            setMime(note, DOCX_MIME);

            expect(readyCache(await toc(noteRef(note))).docx)
                .toStrictEqual({ reader: DOCX_TOC_READER, bookmarks: [] });
            expect(docx).toHaveBeenCalledOnce();
            expect(pdf).toHaveBeenCalledOnce();
        });

        it("run a build of their own while a PDF build of the same blob is held", async () => {
            let rejectPdf: (error: unknown) => void = () => {};
            register(() => new Promise((_, reject) => {
                rejectPdf = reject;
            }));
            const note = createPdf("Alpha");
            const pdfRequest = toc(noteRef(note));
            const docx = registerFor("docx");
            setMime(note, DOCX_MIME);

            expect(readyCache(await toc(noteRef(note))).headings[0].title).toBe("Alpha");
            rejectPdf(namedError("InvalidPDFException"));
            expect(await pdfRequest).toStrictEqual({ status: "unreadable" });
            expect(readyCache(await toc(noteRef(note))).docx)
                .toStrictEqual({ reader: DOCX_TOC_READER, bookmarks: [] });
            expect(docx).toHaveBeenCalledOnce();
        });
    });
});

describe("saveClientToc", () => {
    const headings = [
        { title: "Chapter 1", level: 1, page: 1, id: "sentByTheClient" },
        { title: "Summary", level: 2, page: 2 },
        { title: "Summary", level: 2 }
    ];

    function request(note: BNote, overrides: Record<string, unknown> = {}) {
        return { targetBlobHash: note.blobId, headings, properties: PROPERTIES, elapsedMs: 41.6, ...overrides };
    }

    it("saves what the viewer read, with ids that the server computes, and logs the viewer's time", () => {
        const note = createPdf("Alpha");

        const response = save(noteRef(note), request(note));

        const blobId = String(note.blobId);
        const ids = assignHeadingIds(headings, getBlobTag(blobId), false);
        expect(response).toStrictEqual({
            status: "ready",
            blobId,
            headings: [
                {
                    id: ids[0], title: "Chapter 1", level: 1, page: 1,
                    params: { page: "1", heading: ids[0] }
                },
                {
                    id: ids[1], title: "Summary", level: 2, page: 2,
                    params: { page: "2", heading: ids[1] }
                },
                { id: ids[2], title: "Summary", level: 2 }
            ]
        });
        expect(readJson(caches(note)[0])).toStrictEqual({
            version: 1, targetBlobHash: blobId, headings: [
                { id: ids[0], title: "Chapter 1", level: 1, page: 1 },
                { id: ids[1], title: "Summary", level: 2, page: 2 },
                { id: ids[2], title: "Summary", level: 2 }
            ],
            pdf: PROPERTIES
        });
        expect(info).toHaveBeenCalledWith(
            `Created ToC cache for note '${note.noteId}'. Found 3 headings in 42 ms.`);
    });

    it("keeps where each PDF heading starts on its page", () => {
        const note = createPdf("Alpha");
        const anchored = [ { title: "Chapter 1", level: 1, page: 1, left: 72, top: -0.5 } ];

        const response = save(noteRef(note), request(note, { headings: anchored }));

        expect(response)
            .toMatchObject({ status: "ready", headings: [ { page: 1, left: 72, top: -0.5 } ] });
        expect(readJson(caches(note)[0]).headings[0]).toMatchObject({ left: 72, top: -0.5 });
    });

    it("binds every heading of a table of contents that the viewer cut", () => {
        const note = createPdf("Alpha");

        const response = save(noteRef(note), request(note, { isCut: true }));

        const ids = assignHeadingIds(headings, getBlobTag(String(note.blobId)), false,
            { isCut: true });
        expect(response.status === "ready" && response.headings.map(({ id }) => id))
            .toStrictEqual(ids);
        expect(ids[0]).toContain(".");
    });

    it("normalizes the titles again", () => {
        const note = createPdf("Alpha");

        const response = save(noteRef(note), request(note, {
            headings: [ { title: "  Two\u0008  words ", level: 1, page: 1 } ]
        }));

        expect(response.status === "ready" && response.headings[0].title).toBe("Two words");
    });

    it("keeps a valid cache that exists already", () => {
        const note = createPdf("Alpha");
        const first = save(noteRef(note), request(note));

        const second = save(noteRef(note), request(note, { headings: [] }));

        expect(second).toStrictEqual(first);
        expect(caches(note)).toHaveLength(1);
    });

    it("refuses a table of contents of another blob, and saves nothing", () => {
        const note = createPdf("Alpha");

        expect(() => save(noteRef(note), request(note, { targetBlobHash: "anotherBlob123456789" })))
            .toThrow(DetailedConflictError);
        try {
            save(noteRef(note), request(note, { targetBlobHash: "anotherBlob123456789" }));
        } catch (e) {
            expect((e as DetailedConflictError<{ reason: string }>).details).toMatchObject({ reason: "changed" });
        }
        expect(caches(note)).toHaveLength(0);
    });

    it("refuses a document it cannot take a table of contents for", () => {
        const note = createPdf("Alpha");
        const { note: text } = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root", title: "Not a PDF", type: "text", content: "<p>x</p>"
        }));

        expect(() => save({ kind: "note", noteId: "doesNotExist" }, request(note))).toThrow(NotFoundError);
        expect(() => save(noteRef(text), request(note))).toThrow(ValidationError);

        register();
        expect(() => save(noteRef(note), request(note))).toThrow(ValidationError);
        expect(caches(note)).toHaveLength(0);
    });

    it("refuses a request that is not a table of contents", () => {
        const note = createPdf("Alpha");
        const invalid: unknown[] = [
            null, [], {}, request(note, { targetBlobHash: 5 }), request(note, { headings: {} }),
            request(note, { properties: [] }), request(note, { elapsedMs: "5" }),
            request(note, { isCut: "yes" }),
            request(note, { elapsedMs: Number.POSITIVE_INFINITY }), request(note, { elapsedMs: -1 }),
            request(note, { headings: Array.from({ length: MAX_TOC_HEADINGS + 1 }, () => ({ title: "x", level: 1 })) }),
            request(note, { headings: [ "Chapter 1" ] }),
            request(note, { headings: [ { title: 5, level: 1 } ] }),
            request(note, { headings: [ { title: "x".repeat(501), level: 1 } ] }),
            request(note, { headings: [ { title: "x", level: 0 } ] }),
            request(note, { headings: [ { title: "x", level: 1.5 } ] }),
            request(note, { headings: [ { title: "x", level: 2 } ] }),
            request(note, { headings: [ { title: "x", level: 1 }, { title: "y", level: 3 } ] }),
            request(note, { headings: [ { title: "x", level: 1, page: 0 } ] }),
            request(note, { headings: [ { title: "x", level: 1, page: "3" } ] }),
            request(note, { headings: [ { title: "x", level: 1, page: 2.5 } ] }),
            request(note, { headings: [ { title: "x", level: 1, page: 1, top: "700" } ] }),
            request(note, { headings: [ { title: "x", level: 1, page: 1, left: null } ] }),
            request(note, { properties: undefined }),
            request(note, { properties: { reader: PDF_TOC_READER, failed: true } }),
            request(note, { properties: { reader: PDF_TOC_READER + 1 } })
        ];
        for (const body of invalid) {
            expect(() => save(noteRef(note), body), JSON.stringify(body)).toThrow(ValidationError);
        }
        expect(caches(note)).toHaveLength(0);
    });

    it("never reads the content of a protected PDF, and binds its headings to the protected blob", () => {
        const note = createPdf("Alpha");
        protectedSessionService.setDataKey(PROTECTED_KEY);
        getContext().init(() => noteService.protectNoteRecursively(note, true, false,
            new TaskContext("toc-spec", "protectNotes", { protect: true })));
        const getContent = vi.spyOn(note, "getContent");

        const response = save(noteRef(note), request(note));

        expect(getContent).not.toHaveBeenCalled();
        const tag = String(note.blobId).slice(0, 10);
        expect(response.status === "ready" && response.headings[1].id).toMatch(new RegExp(`\\.${tag}\\.p$`));
    });

    it("answers without saving for a document whose note cannot keep a cache", () => {
        const note = createPdf("Alpha");
        note.isVirtual = true;
        try {
            expect(save(noteRef(note), request(note))).toMatchObject({ status: "ready" });
        } finally {
            note.isVirtual = false;
        }
        expect(caches(note)).toHaveLength(0);
    });
});

describe("readCachedToc", () => {
    it("answers ready, stale and missing without building or writing", async () => {
        const generator = register();
        const note = createPdf("Alpha");
        expect(readCachedToc(noteRef(note))).toStrictEqual({ status: "missing" });

        const cache = readyCache(await toc(noteRef(note)));
        const headings = withPdfParams(cache);
        expect(readCachedToc(noteRef(note)))
            .toStrictEqual({ status: "ready", blobId: note.blobId, headings });

        setContent(note, "Beta");
        expect(readCachedToc(noteRef(note)))
            .toStrictEqual({ status: "stale", blobId: cache.targetBlobHash, headings });
        expect(generator).toHaveBeenCalledTimes(1);
        expect(caches(note)).toHaveLength(1);
    });

    it("sends the link parameters of each PDF heading, and none for a heading without a page",
        async () => {
        register();
        const note = createPdf("Alpha");
        const cache = readyCache(await toc(noteRef(note)));

        const answer = readCachedToc(noteRef(note));

        const [ alpha, summary, pageless ] = cache.headings;
        expect(answer).toStrictEqual({ status: "ready", blobId: note.blobId, headings: [
            { ...alpha, params: { page: "1", heading: alpha.id } },
            { ...summary, params: { page: "2", heading: summary.id } },
            pageless
        ] });
    });

    it("adds that the viewer builds on a platform without a generator", () => {
        const note = createPdf("Alpha");
        expect(readCachedToc(noteRef(note))).toStrictEqual({ status: "missing", pendingToc: { format: "pdf" } });

        const ready = save(noteRef(note), {
            targetBlobHash: note.blobId, headings: [ { title: "Alpha", level: 1, page: 1 } ],
            properties: PROPERTIES, elapsedMs: 3
        });
        setContent(note, "Beta");
        expect(readCachedToc(noteRef(note))).toStrictEqual({
            status: "stale", blobId: ready.status === "ready" && ready.blobId,
            headings: ready.status === "ready" && ready.headings, pendingToc: { format: "pdf" }
        });
    });

    it("answers none for a document without a format, and refuses one that is not readable", () => {
        const { note } = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root", title: "Not a PDF", type: "text", content: "<p>x</p>"
        }));
        expect(readCachedToc(noteRef(note))).toStrictEqual({ status: "none" });
        expect(() => readCachedToc({ kind: "note", noteId: "doesNotExist" })).toThrow(NotFoundError);
    });

    it("reads the valid cache the lists use, and the newest stale one only without it", async () => {
        register();
        const note = createPdf("Alpha");
        const stale = readyCache(await toc(noteRef(note)));
        setContent(note, "Beta");
        const valid = readyCache(await toc(noteRef(note)));
        // A stale cache saved after the valid one, as a sync can bring it.
        const synced = addCache(note, "toc-cache.json", { ...stale, headings: [] });
        const later = addCache(note, "toc-cache.json", stale);
        setDate(synced, "2100-01-01 00:00:00.000Z");
        setDate(later, "2100-01-01 00:00:00.000Z");

        expect(readCachedToc(noteRef(note))).toMatchObject({ status: "ready", headings: valid.headings });
        expect(readyCache(await toc(noteRef(note)))).toStrictEqual(valid);
        expect(caches(note)).toHaveLength(3);

        setContent(note, "Gamma");
        const [ first, second ] = [ synced, later ]
            .sort((a, b) => String(a.attachmentId) < String(b.attachmentId) ? -1 : 1);
        expect(readCachedToc(noteRef(note))).toMatchObject({ status: "stale", headings: readJson(first).headings });

        // The newest one cannot be read: the next one by date is.
        setContent(first, "not JSON");
        setDate(first, "2100-01-01 00:00:00.000Z");
        expect(readCachedToc(noteRef(note))).toMatchObject({ status: "stale", headings: readJson(second).headings });
    });
});

describe("a cache in revisions and copies", () => {
    it("is left out of a revision and of a note made from the PDF as a template", async () => {
        register();
        const note = createPdf("Alpha");
        await toc(noteRef(note));
        saveAttachment(note, "A file of the user's");
        expect(note.getAttachments().map(({ role }) => role).sort()).toStrictEqual([ "file", TOC_CACHE_ROLE ]);

        const revision = getContext().init(() => note.saveRevision());
        expect(revision.getAttachments().map(({ role }) => role)).toStrictEqual([ "file" ]);

        const { note: copy } = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root", title: "From the template", type: "file", mime: "application/pdf",
            content: "", templateNoteId: note.noteId
        }));
        expect(copy.getAttachments().map(({ role }) => role)).toStrictEqual([ "file" ]);
    });
});

describe("EPUB e-books", () => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(FIXTURES, "toc_contract.epub")));
    const contract = JSON.parse(
        fs.readFileSync(path.join(FIXTURES, "toc_contract_epub.json"), "utf-8"));

    it("build with the format's own generator, for notes and attachments of both types",
        async () => {
        for (const mime of EPUB_MIME_TYPES) {
            const note = createDocument(bytes, mime);
            const attachment = getContext().init(() => note.saveAttachment({
                role: "file", mime, title: "attached.epub", content: bytes
            }));

            for (const ref of [ noteRef(note), attachmentRef(attachment) ]) {
                const cache = readyCache(await toc(ref));
                expect(cache.headings.map(({ id }) => id)).toStrictEqual(contract.ids);
                const shown = (headings: unknown[]) =>
                    (headings as { isShown?: false }[]).map(({ isShown }) => isShown);
                expect(shown(cache.headings)).toStrictEqual(shown(contract.headings));
                expect(cache.epub).toStrictEqual({ reader: EPUB_TOC_READER });
            }
        }
    });

    it("send a link to the entries that the preview shows, and none to the others", async () => {
        const note = createDocument(bytes, EPUB_MIME_TYPES[0]);
        await toc(noteRef(note));

        const answer = readCachedToc(noteRef(note));

        if (answer.status !== "ready") {
            throw new Error(`Expected a ready answer, got ${answer.status}`);
        }
        const isShown = (contract.headings as { isShown?: false }[])
            .map(({ isShown }) => isShown !== false);
        expect(isShown).toContain(false);
        expect(answer.headings.map(({ id, params }) => params ?? id)).toStrictEqual(
            contract.ids.map((id: string, index: number) =>
                (isShown[index] ? { heading: id } : id)));
    });

    it("store nothing after a pass that fails once, and build at the next request", async () => {
        const note = createDocument(bytes, EPUB_MIME_TYPES[0]);
        const convert = OfficeConverter.convert.bind(OfficeConverter);
        vi.spyOn(OfficeConverter, "convert")
            .mockImplementationOnce(() => Promise.reject(new RangeError("Out of memory")))
            .mockImplementation(convert);

        expect(await toc(noteRef(note))).toStrictEqual({ status: "unreadable" });
        expect(note.getAttachmentsByRole(TOC_CACHE_ROLE)).toHaveLength(0);
        // The log names the error, never its message, which can quote the file.
        expect(error).toHaveBeenCalledWith(expect.stringMatching(/: RangeError$/));

        expect(readyCache(await toc(noteRef(note))).headings).toHaveLength(contract.ids.length);
    });

    it("remember a book that the pass refuses, and never read it again for that blob", async () => {
        const altered = new Uint8Array(bytes);
        const view = new DataView(altered.buffer);
        // The CRC-32 of the first chapter, in its central directory record.
        for (let at = altered.length - 22; at >= 0; at--) {
            if (view.getUint32(at, true) === 0x02014b50
                && decodeUtf8(altered.subarray(at + 46, at + 46 + view.getUint16(at + 28, true)))
                    === "OEBPS/ch1.xhtml") {
                view.setUint32(at + 16, view.getUint32(at + 16, true) ^ 1, true);
                break;
            }
        }
        const note = createDocument(altered, EPUB_MIME_TYPES[0]);
        const convert = vi.spyOn(OfficeConverter, "convert");

        expect(await toc(noteRef(note))).toStrictEqual({ status: "unreadable" });
        expect(info).toHaveBeenCalledWith(expect.stringMatching(/: CRC$/));
        const conversions = convert.mock.calls.length;
        expect(await toc(noteRef(note))).toStrictEqual({ status: "unreadable" });
        expect(convert).toHaveBeenCalledTimes(conversions);
    });
});

describe("findTocFormat", () => {
    it("reads PDF, Word and OpenDocument text files and EPUB e-books only", () => {
        expect(findTocFormat("file", "application/pdf")?.name).toBe("pdf");
        expect(findTocFormat("file", DOCX_MIME)?.name).toBe("docx");
        expect(findTocFormat("file", ODT_MIME)?.name).toBe("odt");
        for (const mime of EPUB_MIME_TYPES) {
            expect(findTocFormat("file", mime)?.name).toBe("epub");
        }
        expect(findTocFormat("file", "application/rtf")).toBeUndefined();
        expect(findTocFormat("file", "application/zip")).toBeUndefined();
        expect(findTocFormat("text", "application/pdf")).toBeUndefined();
    });
});

describe("findTocFormatName", () => {
    it("names the format that findTocFormat() finds, for every office type and PDF", () => {
        const mimes = [ "application/pdf", ...OFFICE_MIME_TYPES, "application/zip", "text/html" ];
        for (const type of [ "file", "text", "image" ]) {
            for (const mime of mimes) {
                expect(findTocFormatName(type, mime), `${type} ${mime}`)
                    .toBe(findTocFormat(type, mime)?.name);
            }
        }
        expect(findTocFormatName("file", DOCX_MIME)).toBe("docx");
    });
});

describe("buildToc", () => {
    it("builds and saves the cache once, then answers it without the generator", async () => {
        const generator = register();
        const note = createPdf("Alpha");

        const built = await build(noteRef(note));

        expect(caches(note)).toHaveLength(1);
        const cache = readJson(caches(note)[0]) as TocCache;
        expect(built).toStrictEqual(
            { status: "ready", blobId: note.blobId, headings: withPdfParams(cache) });
        unregisterTocGenerator("pdf");
        expect(await build(noteRef(note))).toStrictEqual(built);
        expect(generator).toHaveBeenCalledTimes(1);
    });

    it("answers none, unreadable, and the stale cache that a viewer rebuilds", async () => {
        const { note: text } = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root", title: "Not a PDF", type: "text", content: "<p>x</p>"
        }));
        expect(await build(noteRef(text))).toStrictEqual({ status: "none" });

        const viewerBuilt = createPdf("Alpha");
        save(noteRef(viewerBuilt), {
            targetBlobHash: viewerBuilt.blobId, headings: [ { title: "Alpha", level: 1, page: 1 } ],
            properties: PROPERTIES, elapsedMs: 3
        });
        const blobId = viewerBuilt.blobId;
        setContent(viewerBuilt, "Beta");
        expect(await build(noteRef(viewerBuilt))).toStrictEqual({
            status: "stale", blobId, headings: [ expect.objectContaining({ title: "Alpha" }) ],
            pendingToc: { format: "pdf" }
        });

        register(() => Promise.reject(namedError("InvalidPDFException")));
        expect(await build(noteRef(createPdf("Broken")))).toStrictEqual({ status: "unreadable" });
    });

    it("answers for the newer blob of a document that changes during the build", async () => {
        const held = holdGenerator();
        const note = createPdf("Alpha");

        const request = build(noteRef(note));
        setContent(note, "Beta");
        held.release("Alpha");
        await vi.waitFor(() => expect(held.generator).toHaveBeenCalledTimes(2));
        held.release("Beta");

        expect(await request).toMatchObject({
            status: "ready", blobId: note.blobId, headings: [ { title: "Beta" }, {}, {} ]
        });
    });
});

describe("createLevelTracker", () => {
    it("nests each depth under the nearest smaller depth passed before it", () => {
        const toLevel = createLevelTracker();

        expect([ 2, 1, 3, 2, 6, 6, 4, 1 ].map((depth) => toLevel(depth)))
            .toStrictEqual([ 1, 1, 2, 2, 3, 3, 3, 1 ]);
    });
});

/** `getToc()` in a request context, as the routes call it. */
function toc(ref: TocDocumentRef) {
    return getContext().init(() => getToc(ref));
}

/** `buildToc()` in a request context, as the route calls it. */
function build(ref: TocDocumentRef) {
    return getContext().init(() => buildToc(ref));
}

/** The headings of the PDF `cache` as the routes send them, with their link parameters. */
function withPdfParams(cache: TocCache) {
    return (cache.headings as { id: string; page?: number }[]).map((heading) =>
        heading.page === undefined
            ? heading
            : { ...heading, params: { page: String(heading.page), heading: heading.id } });
}

/** `saveClientToc()` in a request context, as the route calls it. */
function save(ref: TocDocumentRef, request: unknown) {
    return getContext().init(() => saveClientToc(ref, request));
}

/** Registers a generator that reads `Title` and two `Summary` headings from content `Title`. */
function register(generator: TocGenerator = async (content) => outlineOf(decodeUtf8(content))) {
    const mock = vi.fn(generator);
    registerTocGenerator("pdf", mock);
    return mock;
}

/** Registers a generator whose reads wait until `release()` is called with their content. */
function holdGenerator() {
    const waiting: { content: string; resolve: (toc: GeneratedToc) => void }[] = [];
    const generator = register((content) => new Promise((resolve) => {
        waiting.push({ content: decodeUtf8(content), resolve });
    }));
    return {
        generator,
        release(content: string) {
            const index = waiting.findIndex((read) => read.content === content);
            const [ read ] = waiting.splice(index, 1);
            read.resolve(outlineOf(content));
        }
    };
}

function outlineOf(title: string): GeneratedToc {
    return {
        headings: [
            { title, level: 1, page: 1 }, { title: "Summary", level: 2, page: 2 },
            { title: "Summary", level: 2 }
        ],
        properties: PROPERTIES
    };
}

/** Registers a generator of `format` that reads one heading, its content, from the content. */
function registerFor(
    format: string,
    generator: TocGenerator = async (content) => officeOutlineOf(decodeUtf8(content))
) {
    const mock = vi.fn(generator);
    registerTocGenerator(format, mock);
    return mock;
}

function officeOutlineOf(title: string): GeneratedToc {
    return {
        headings: [ { title, level: 1 } ], properties: { reader: DOCX_TOC_READER, bookmarks: [] }
    };
}

function createDocument(content: string | Uint8Array, mime: string) {
    counter++;
    return getContext().init(() => noteService.createNewNote({
        parentNoteId: "root", title: `toc-spec-${counter}`, type: "file", mime, content
    })).note;
}

/** Changes the MIME type of `note` in place, keeping its blob, as `PUT .../type` does. */
function setMime(note: BNote, mime: string) {
    getContext().init(() => {
        note.mime = mime;
        note.save();
    });
}

function attachmentRef(attachment: BAttachment): TocDocumentRef {
    return { kind: "attachment", attachmentId: String(attachment.attachmentId) };
}

/** An error of `officeparser` with the code `code`, whose message quotes the file. */
function officeIssue(code: string) {
    const error = new Error(`[OfficeParser]: ${code} in Secret title`);
    return Object.assign(error, { officeIssue: { code } });
}

function createPdf(content: string) {
    counter++;
    return getContext().init(() => noteService.createNewNote({
        parentNoteId: "root", title: `toc-spec-${counter}`, type: "file", mime: "application/pdf", content
    })).note;
}

function saveAttachment(note: BNote, content: string) {
    counter++;
    return getContext().init(() => note.saveAttachment({
        role: "file", mime: "application/pdf", title: `attachment-${counter}.pdf`, content
    }));
}

/** A cache attachment of `note`, as a sync from another instance could bring it. */
function addCache(note: BNote, title: string, cache: TocCache) {
    return getContext().init(() => {
        const attachment = new BAttachment({
            ownerId: note.noteId, role: TOC_CACHE_ROLE, mime: "application/json", title,
            isProtected: note.isProtected
        });
        attachment.setContent(JSON.stringify(cache), { forceSave: true });
        return attachment;
    });
}

function setContent(entity: BNote | BAttachment, content: string) {
    getContext().init(() => entity.setContent(content));
}

function setDate(attachment: BAttachment, utcDateModified: string) {
    getSql().execute("UPDATE attachments SET utcDateModified = ? WHERE attachmentId = ?",
        [ utcDateModified, String(attachment.attachmentId) ]);
}

function noteRef(note: BNote): TocDocumentRef {
    return { kind: "note", noteId: note.noteId };
}

function caches(note: BNote) {
    return note.getAttachmentsByRole(TOC_CACHE_ROLE);
}

function readJson(attachment: BAttachment) {
    return JSON.parse(String(attachment.getContent()));
}

function isDeleted(attachment: BAttachment) {
    return !becca.getAttachment(String(attachment.attachmentId));
}

function readyCache(result: Awaited<ReturnType<typeof getToc>>): TocCache {
    if (result?.status !== "ready") {
        throw new Error(`Expected a ready table of contents, got ${JSON.stringify(result)}`);
    }
    return result.cache;
}

function namedError(name: string) {
    const error = new Error(`${name} from pdf.js`);
    error.name = name;
    return error;
}
