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
import type { ZipArchive, ZipArchiveEntryOptions, ZipProvider } from "../zip_provider.js";
import { getZipProvider, initZipProvider } from "../zip_provider.js";
import zip, { shouldStoreUncompressed } from "./zip.js";

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

        it("strips CKEditor's data-list-item-id from HTML and Markdown exports", async () => {
            // A plain list converts to Markdown syntax (turndown drops attributes), but a list
            // inside a table survives as raw HTML — both must come out without the editor-only id.
            const content = `<ul><li data-list-item-id="e0123">Bullet</li></ul>`
                + `<table><tbody><tr><td><ul><li data-list-item-id="e4567">Cell</li></ul></td></tr></tbody></table>`;
            const { note } = createNote("root", { title: "ListIds", content });
            const branch = note.getParentBranches()[0];

            for (const format of ["html", "markdown"] as const) {
                const { entries } = await exportSubtree(branch, format);
                const dataFileName = parseMeta(entries).files[0].dataFileName ?? "";
                const exported = entries[dataFileName].toString("utf-8");

                expect(exported).not.toContain("data-list-item-id");
                // The list content itself still round-trips.
                expect(exported).toContain("Bullet");
                expect(exported).toContain("Cell");
            }
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

        it("keeps note titles longer than 30 characters in the data file name", async () => {
            // Regression for #10112: the base file name used to be hard-capped at
            // 30 characters, mangling long titles in the export.
            const longTitle = "This is a very long note title well beyond the old thirty char cap";
            expect(longTitle.length).toBeGreaterThan(30);
            const { note } = createNote("root", { title: longTitle, content: "<p>long</p>" });
            const branch = note.getParentBranches()[0];

            const { entries } = await exportSubtree(branch, "html");
            const rootMeta = parseMeta(entries).files[0];

            expect(rootMeta.dataFileName).toBe(`${longTitle}.html`);
            expect(entries[`${longTitle}.html`]).toBeDefined();
        });

        it("keeps the full UTF-8 title for accented note names (issue #10112)", async () => {
            // The reporter's archive showed "Jean 15.1-8 - prédication corr.md",
            // i.e. a longer accented title chopped at 30 chars before ".md".
            const accentedTitle = "Jean 15.1-8 - prédication corrigée";
            expect(accentedTitle.length).toBeGreaterThan(30);
            const { note } = createNote("root", { title: accentedTitle, content: "<h2>Heading</h2>" });
            const branch = note.getParentBranches()[0];

            const { entries } = await exportSubtree(branch, "markdown");
            const rootMeta = parseMeta(entries).files[0];

            expect(rootMeta.dataFileName).toBe(`${accentedTitle}.md`);
            expect(entries[`${accentedTitle}.md`]).toBeDefined();
        });

        it("keeps long attachment names and strips illegal characters from them", async () => {
            const { note } = createNote("root", { title: "AttachHost", content: "<p>host</p>" });
            const longAttachmentTitle = "long attachment / with : illegal * chars beyond thirty characters";
            getContext().init(() =>
                note.saveAttachment({ role: "file", mime: "text/plain", title: longAttachmentTitle, content: "data" })
            );
            const branch = note.getParentBranches()[0];

            const { entries } = await exportSubtree(branch, "html");
            const rootMeta = parseMeta(entries).files[0];

            const attMeta = (rootMeta.attachments ?? [])[0];
            expect(attMeta).toBeDefined();
            const attFileName = attMeta.dataFileName ?? "";
            // Not capped at 30: the old behaviour cropped to 30 chars + extension.
            expect(attFileName.length).toBeGreaterThan(33);
            // Illegal filename characters are stripped (previously left untouched).
            expect(attFileName).not.toMatch(/[/\\:*?"<>|]/);
            expect(entries[attFileName]).toBeDefined();
        });

        it("round-trips binary attachment content byte-for-byte", async () => {
            const { note } = createNote("root", { title: "BinaryAttachHost", content: "<p>host</p>" });
            // Bytes that are not valid UTF-8 (0x00, 0xFF, lone 0x80 continuation byte)
            // so any accidental string coercion in the export path would corrupt them.
            const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x80, 0x01, 0xfe]);
            getContext().init(() =>
                note.saveAttachment({ role: "image", mime: "image/png", title: "pixel.png", content: binaryContent })
            );
            const branch = note.getParentBranches()[0];

            const { entries } = await exportSubtree(branch, "html");
            const rootMeta = parseMeta(entries).files[0];

            const attMeta = (rootMeta.attachments ?? [])[0];
            expect(attMeta).toBeDefined();
            const attFileName = attMeta.dataFileName ?? "";
            expect(entries[attFileName]).toBeDefined();
            // The exported bytes must equal the stored bytes exactly.
            expect(Buffer.compare(entries[attFileName], binaryContent)).toBe(0);
        });

        it("resolves embedded mermaid/canvas images to their rendered image attachment", async () => {
            // A mermaid/canvas note is not an image itself: `api/images/<noteId>` serves its
            // generated `*-export.svg` attachment. An <img> embedding such a note must therefore
            // resolve to that attachment, not to the note's own data file (the mermaid source or,
            // in the share export, the note's HTML page).
            const cases = [
                { type: "mermaid", mime: "text/mermaid", content: "flowchart TD\n A --> B", attachment: "mermaid-export.svg" },
                { type: "canvas", mime: "application/json", content: "{}", attachment: "canvas-export.svg" }
            ] as const;

            for (const { type, mime, content, attachment } of cases) {
                const hostTitle = `${type}Host`;
                const { note: host } = createNote("root", { title: hostTitle, content: "" });
                const { note: diagram } = createNote(host.noteId, { title: "Diagram", type, mime, content });

                getContext().init(() => {
                    diagram.saveAttachment({ role: "image", mime: "image/svg+xml", title: attachment, content: "<svg/>" });
                    host.setContent(`<p><img src="api/images/${diagram.noteId}/Diagram"></p>`);
                });

                const { entries } = await exportSubtree(host.getParentBranches()[0], "html");
                const rootMeta = parseMeta(entries).files[0];
                const exported = entries[rootMeta.dataFileName ?? ""].toString("utf-8");

                // The SVG really is in the archive, next to the diagram note's own data file.
                const svgPath = `${hostTitle}/Diagram_${attachment}`;
                expect(entries[svgPath], svgPath).toBeDefined();

                expect(exported, type).toContain(`src="${svgPath}"`);
                // ...and not at the diagram note's data file, which no browser can render as an image.
                expect(exported, type).not.toMatch(/src="[^"]*Diagram\.(txt|json|html)"/);
            }
        });

        it("pipes the archive to the response before appending any content", async () => {
            // Memory efficiency: the archive must start streaming to the response
            // before note/attachment content is appended, so blobs drain to the
            // client as they are added rather than all being buffered in memory.
            const { note } = createNote("root", { title: "StreamOrder", content: "<p>x</p>" });
            getContext().init(() =>
                note.saveAttachment({ role: "file", mime: "text/plain", title: "a.txt", content: "data" })
            );
            const branch = note.getParentBranches()[0];

            const events: string[] = [];
            const original = getZipProvider();
            const spy: ZipProvider = {
                detectFilenameEncoding: (b) => original.detectFilenameEncoding(b),
                readZipFile: (b, fn, enc) => original.readZipFile(b, fn, enc),
                createFileStream: (p) => original.createFileStream(p),
                createZipArchive() {
                    const real = original.createZipArchive();
                    const wrapper: ZipArchive = {
                        append(content: string | Uint8Array, options: ZipArchiveEntryOptions) {
                            events.push(`append:${options.name}`);
                            real.append(content, options);
                        },
                        pipe(dest: unknown) {
                            events.push("pipe");
                            real.pipe(dest);
                        },
                        finalize() {
                            events.push("finalize");
                            return real.finalize();
                        }
                    };
                    return wrapper;
                }
            };

            initZipProvider(spy);
            try {
                const taskContext = (await import("../task_context.js")).default;
                const ctx = new taskContext("no-progress-reporting", "export", null);
                const res = new FakeResponse();
                const done = collect(res);
                await zip.exportToZip(ctx, branch, "html", res as unknown as Record<string, unknown>);
                await done;
            } finally {
                initZipProvider(original);
            }

            // The pipe is the very first archive operation and precedes every append.
            const pipeIdx = events.indexOf("pipe");
            const firstAppendIdx = events.findIndex((e) => e.startsWith("append:"));
            expect(pipeIdx).toBe(0);
            expect(firstAppendIdx).toBeGreaterThan(pipeIdx);
            // Content really was appended (note data + attachment), and finalize closes it.
            expect(events).toContain("append:!!!meta.json");
            expect(events[events.length - 1]).toBe("finalize");
        });

        it("keeps the extension on very long multi-byte titles within the 255-byte limit", async () => {
            // A title of 3-byte CJK characters long enough that, once the upstream
            // 255-byte sanitize cap fills the base, appending the extension would
            // push past 255 bytes. The extension must survive and the whole name
            // must stay within the filesystem's 255-byte limit.
            const cjkTitle = "汉".repeat(120);
            const { note } = createNote("root", { title: cjkTitle, content: "<h2>Heading</h2>" });
            const branch = note.getParentBranches()[0];

            const { entries } = await exportSubtree(branch, "markdown");
            const rootMeta = parseMeta(entries).files[0];

            const name = rootMeta.dataFileName ?? "";
            expect(name.endsWith(".md")).toBe(true);
            expect(Buffer.byteLength(name, "utf-8")).toBeLessThanOrEqual(255);
            expect(entries[name]).toBeDefined();
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

    describe("exportBranchToZipFile", () => {
        let tempDir: string;

        beforeAll(() => {
            tempDir = mkdtempSync(join(tmpdir(), "trilium-zip-branch-export-"));
        });

        it("streams a subtree export for the given branch to a file path", async () => {
            const { note, branch } = createNote("root", { title: "BranchFileExport", content: "<p>branch to file</p>" });
            const zipPath = join(tempDir, `branch-export-${note.noteId}.zip`);
            const { branchId } = branch;
            if (!branchId) {
                throw new Error("branch was not saved");
            }

            await getContext().init(() =>
                zip.exportBranchToZipFile(branchId, "html", zipPath, "no-progress-reporting")
            );

            const buffer = readFileSync(zipPath);
            const entries = await readArchive(buffer);
            const rootMeta = parseMeta(entries).files[0];

            expect(rootMeta.noteId).toBe(note.noteId);
            const dataFileName = rootMeta.dataFileName ?? "";
            expect(entries[dataFileName].toString("utf-8")).toContain("branch to file");

            rmSync(zipPath, { force: true });
        });

        it("throws a ValidationError for a non-existent branch", async () => {
            await expect(
                getContext().init(() =>
                    zip.exportBranchToZipFile("missingBranch123", "html", join(tempDir, "never.zip"), "no-progress-reporting")
                )
            ).rejects.toThrow(/not found/);
        });
    });
});

describe("shouldStoreUncompressed", () => {
    it("stores already-compressed payloads uncompressed", () => {
        for (const mime of [
            "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
            "video/mp4", "video/webm", "audio/mpeg", "audio/ogg",
            "application/pdf", "application/zip", "application/gzip",
            "application/x-7z-compressed", "font/woff2",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
            "application/vnd.oasis.opendocument.spreadsheet", // ods
            "application/epub+zip"
        ]) {
            expect(shouldStoreUncompressed(mime), mime).toBe(true);
        }
    });

    it("compresses text and other deflate-friendly payloads", () => {
        for (const mime of [
            "text/html", "text/plain", "text/markdown", "application/json",
            "application/xml", "application/javascript",
            "image/svg+xml", "image/bmp", "image/x-icon", "image/tiff",
            "audio/wav", "audio/x-wav", "audio/aiff"
        ]) {
            expect(shouldStoreUncompressed(mime), mime).toBe(false);
        }
    });

    it("normalizes case and ignores parameters, and treats missing mime as compressible", () => {
        expect(shouldStoreUncompressed("IMAGE/JPEG")).toBe(true);
        expect(shouldStoreUncompressed("image/png; charset=binary")).toBe(true);
        expect(shouldStoreUncompressed("  text/html ; charset=utf-8 ")).toBe(false);
        expect(shouldStoreUncompressed(undefined)).toBe(false);
        expect(shouldStoreUncompressed(null)).toBe(false);
        expect(shouldStoreUncompressed("")).toBe(false);
    });
});
