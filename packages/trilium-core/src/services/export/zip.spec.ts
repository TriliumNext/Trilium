import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PassThrough } from "stream";
import { beforeAll, describe, expect, it } from "vitest";

import type BBranch from "../../becca/entities/bbranch.js";
import type BNote from "../../becca/entities/bnote.js";
import type { ExportFormat, NoteMetaFile } from "../../meta.js";
import { getContext } from "../context.js";
import noteService from "../notes.js";
import sql_init from "../sql_init.js";
import { getZipProvider } from "../zip_provider.js";
import zip from "./zip.js";

// happy-dom (standalone/WASM) exposes `window`; the Node server suite does not.
const isBrowserRuntime = typeof window !== "undefined";

let counter = 0;

/**
 * Creates a fresh note under the given parent in the shared in-memory fixture
 * DB. Each call uses a unique title so the `it()`s in this file (which share
 * one DB copy per fork) don't collide.
 */
function createNote(
    parentNoteId: string,
    overrides: Partial<{ title: string; content: string; type: BNote["type"]; mime: string }> = {}
): { note: BNote; branch: BBranch } {
    counter++;
    return getContext().init(() =>
        noteService.createNewNote({
            parentNoteId,
            title: overrides.title ?? `zip-spec-${counter}`,
            content: overrides.content ?? "<p>hello</p>",
            type: overrides.type ?? "text",
            mime: overrides.mime
        })
    );
}

/** A minimal Express-`res`-like writable that collects everything piped into it. */
class FakeResponse extends PassThrough {
    headers: Record<string, string> = {};
    statusCode = 200;
    sentBody: string | undefined;
    removedHeaders: string[] = [];

    setHeader(name: string, value: string) {
        this.headers[name] = value;
        return this;
    }

    removeHeader(name: string) {
        this.removedHeaders.push(name);
        delete this.headers[name];
        return this;
    }

    status(code: number) {
        this.statusCode = code;
        return this;
    }

    send(body: string) {
        this.sentBody = body;
        return this;
    }
}

/** Drains a FakeResponse and returns the full piped buffer once the archive finalizes. */
function collect(res: FakeResponse): Promise<Buffer> {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    return new Promise((resolve, reject) => {
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
    });
}

/** Unzips the produced archive into a `{ fileName -> contents }` map. */
async function readArchive(buffer: Buffer): Promise<Record<string, Buffer>> {
    const entries: Record<string, Buffer> = {};
    await getZipProvider().readZipFile(buffer, async (entry, readContent) => {
        entries[entry.fileName] = Buffer.from(await readContent());
    });
    return entries;
}

async function exportSubtree(branch: BBranch, format: ExportFormat = "html") {
    const taskContext = (await import("../task_context.js")).default;
    const ctx = new taskContext("no-progress-reporting", "export", null);
    const res = new FakeResponse();
    const done = collect(res);
    await zip.exportToZip(ctx, branch, format, res as unknown as Record<string, unknown>);
    const buffer = await done;
    return { buffer, res, entries: await readArchive(buffer) };
}

function parseMeta(entries: Record<string, Buffer>): NoteMetaFile {
    return JSON.parse(entries["!!!meta.json"].toString("utf-8"));
}

// Gated to Node: these real-DB export tests rely on Node stream semantics.
// The in-memory exportToZip tests pipe into a PassThrough and await its `end`
// event, but the BrowserZipProvider.finalize() writes synchronously via
// res.send() and never ends the stream, so completion never fires (timeout).
// The exportToZipFile tests need a writable file stream, which the browser
// provider does not support (createFileStream throws). The browser zip provider
// has different streaming semantics and is validated separately.
describe.skipIf(isBrowserRuntime)("zip export (real DB)", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    describe("exportToZip", () => {
        it("produces a meta file plus the note's data file and sets the zip headers", async () => {
            const { note } = createNote("root", { title: "ExportRoot", content: "<p>body text</p>" });
            const branch = note.getParentBranches()[0];

            const { entries, res } = await exportSubtree(branch, "html");

            // The meta manifest is always present and describes the exported root.
            const meta = parseMeta(entries);
            expect(meta.formatVersion).toBe(2);
            expect(typeof meta.appVersion).toBe("string");

            const rootMeta = meta.files[0];
            expect(rootMeta.noteId).toBe(note.noteId);
            expect(rootMeta.isClone).toBe(false);
            expect(rootMeta.type).toBe("text");
            // HTML export of a text note maps to an .html data file.
            expect(rootMeta.dataFileName).toMatch(/\.html$/);
            expect(rootMeta.format).toBe("html");

            // The corresponding data file is in the archive and contains the body.
            const dataFile = entries[rootMeta.dataFileName!];
            expect(dataFile).toBeDefined();
            expect(dataFile.toString("utf-8")).toContain("body text");

            // Streaming a download sets the disposition + content-type headers.
            expect(res.headers["Content-Type"]).toBe("application/zip");
            expect(res.headers["Content-Disposition"]).toContain("ExportRoot.zip");

            // The HTML provider injects extra navigation/index/style files marked noImport.
            expect(meta.files.some((f) => f.noImport && f.dataFileName === "navigation.html")).toBe(true);
            expect(meta.files.some((f) => f.noImport && f.dataFileName === "index.html")).toBe(true);
            expect(meta.files.some((f) => f.noImport && f.dataFileName === "style.css")).toBe(true);
            expect(entries["navigation.html"]).toBeDefined();
            expect(entries["index.html"]).toBeDefined();
            expect(entries["style.css"]).toBeDefined();
        });

        it("exports a subtree with nested children into a directory hierarchy", async () => {
            const { note: parent } = createNote("root", { title: "Parent", content: "" });
            const { note: child } = createNote(parent.noteId, { title: "Child", content: "<p>child body</p>" });
            const branch = parent.getParentBranches()[0];

            const { entries } = await exportSubtree(branch, "html");
            const meta = parseMeta(entries);

            const rootMeta = meta.files[0];
            expect(rootMeta.noteId).toBe(parent.noteId);
            // A parent with children gets a directory and a nested child entry.
            expect(rootMeta.dirFileName).toBeTruthy();
            expect(rootMeta.children).toHaveLength(1);

            const childMeta = rootMeta.children![0];
            expect(childMeta.noteId).toBe(child.noteId);

            // The child's data file lives under the parent's directory.
            const childPath = `${rootMeta.dirFileName}/${childMeta.dataFileName}`;
            expect(entries[childPath]).toBeDefined();
            expect(entries[childPath].toString("utf-8")).toContain("child body");
            // The directory entry itself is emitted.
            expect(entries[`${rootMeta.dirFileName}/`]).toBeDefined();
        });

        it("exports text notes as markdown when the markdown format is requested", async () => {
            const { note } = createNote("root", { title: "MdNote", content: "<h2>Heading</h2>" });
            const branch = note.getParentBranches()[0];

            const { entries } = await exportSubtree(branch, "markdown");
            const rootMeta = parseMeta(entries).files[0];

            expect(rootMeta.format).toBe("markdown");
            expect(rootMeta.dataFileName).toMatch(/\.md$/);
            // Markdown conversion turns the HTML heading into a markdown heading.
            expect(entries[rootMeta.dataFileName!].toString("utf-8")).toContain("## Heading");
        });

        it("carries owned attributes into the note meta but drops out-of-export relations", async () => {
            // A note living outside the exported subtree: a relation to it is valid
            // to save but must be filtered out of the export meta.
            const { note: outsider } = createNote("root", { title: "Outsider", content: "<p>o</p>" });
            const { note } = createNote("root", { title: "Attributed", content: "<p>x</p>" });
            getContext().init(() => {
                note.addLabel("myLabel", "labelValue");
                // Relation to "root" is a named noteId and is preserved.
                note.addRelation("rootRel", "root");
                // Relation to a note not contained in this export is dropped.
                note.addRelation("outsideRel", outsider.noteId);
            });
            const branch = note.getParentBranches()[0];

            const { entries } = await exportSubtree(branch, "html");
            const rootMeta = parseMeta(entries).files[0];
            const attrs = rootMeta.attributes ?? [];

            const label = attrs.find((a) => a.name === "myLabel");
            expect(label).toMatchObject({ type: "label", value: "labelValue" });

            expect(attrs.some((a) => a.name === "rootRel")).toBe(true);
            expect(attrs.some((a) => a.name === "outsideRel")).toBe(false);
        });

        it("excludes notes marked with #excludeFromExport", async () => {
            const { note: parent } = createNote("root", { title: "WithExcluded", content: "" });
            const { note: kept } = createNote(parent.noteId, { title: "Kept", content: "<p>kept</p>" });
            const { note: excluded } = createNote(parent.noteId, { title: "Excluded", content: "<p>no</p>" });
            getContext().init(() => excluded.addLabel("excludeFromExport"));
            const branch = parent.getParentBranches()[0];

            const { entries } = await exportSubtree(branch, "html");
            const rootMeta = parseMeta(entries).files[0];
            const childIds = (rootMeta.children ?? []).map((c) => c.noteId);

            expect(childIds).toContain(kept.noteId);
            expect(childIds).not.toContain(excluded.noteId);
        });

        it("emits a .clone data file when the same note appears twice in the subtree", async () => {
            const { note: parent } = createNote("root", { title: "CloneHolder", content: "" });
            const { note: folderA } = createNote(parent.noteId, { title: "FolderA", content: "" });
            const { note: folderB } = createNote(parent.noteId, { title: "FolderB", content: "" });
            const { note: original } = createNote(folderA.noteId, { title: "Original", content: "<p>orig</p>" });

            // Clone the note into a second folder inside the same exported subtree.
            const cloningService = (await import("../cloning.js")).default;
            const cloneRes = getContext().init(() => cloningService.cloneNoteToParentNote(original.noteId, folderB.noteId));
            expect(cloneRes.success).toBe(true);

            const branch = parent.getParentBranches()[0];
            const { entries } = await exportSubtree(branch, "html");
            const rootMeta = parseMeta(entries).files[0];

            // Flatten the meta tree to find every occurrence of the note.
            const occurrences: { isClone?: boolean; dataFileName?: string; dirPath?: string }[] = [];
            function walk(meta: NoteMetaFile["files"][number], dirPath: string) {
                if (meta.noteId === original.noteId) {
                    occurrences.push({ isClone: meta.isClone, dataFileName: meta.dataFileName, dirPath });
                }
                for (const child of meta.children ?? []) {
                    walk(child, meta.dirFileName ? `${dirPath}${meta.dirFileName}/` : dirPath);
                }
            }
            walk(rootMeta, "");

            // The note appears twice: once as the real export, once as a clone marker.
            expect(occurrences).toHaveLength(2);
            const clones = occurrences.filter((o) => o.isClone);
            expect(clones).toHaveLength(1);

            const clonePath = `${clones[0].dirPath}${clones[0].dataFileName}`;
            expect(entries[clonePath].toString("utf-8")).toContain("clone of a note");
        });
    });

    describe("exportToZipFile", () => {
        let tempDir: string;

        beforeAll(() => {
            tempDir = mkdtempSync(join(tmpdir(), "trilium-zip-export-"));
        });

        it("writes a valid, readable zip archive to the given path", async () => {
            const { note } = createNote("root", { title: "FileExport", content: "<p>to file</p>" });
            const zipPath = join(tempDir, `export-${note.noteId}.zip`);

            await getContext().init(() => zip.exportToZipFile(note.noteId, "html", zipPath));

            const buffer = readFileSync(zipPath);
            const entries = await readArchive(buffer);
            const rootMeta = parseMeta(entries).files[0];

            expect(rootMeta.noteId).toBe(note.noteId);
            expect(entries[rootMeta.dataFileName!].toString("utf-8")).toContain("to file");

            rmSync(zipPath, { force: true });
        });

        it("throws a ValidationError for a non-existent note", async () => {
            await expect(
                getContext().init(() => zip.exportToZipFile("missingNoteId123", "html", join(tempDir, "never.zip")))
            ).rejects.toThrow(/not found/);
        });
    });
});
