import { ZipArchive } from "archiver";
import { PassThrough } from "stream";
import { describe, expect, it } from "vitest";

import becca from "../../../becca/becca.js";
import type BNote from "../../../becca/entities/bnote.js";
import { getContext } from "../../context.js";
import TaskContext from "../../task_context.js";
import { decodeUtf8 } from "../../utils/binary.js";
import { getZipProvider } from "../../zip_provider.js";
import logseqImporter from "./importer.js";

/** Builds an in-memory zip from a map of entry name -> contents, optionally stamping per-entry mtimes. */
async function createZipBuffer(files: Record<string, string | Buffer>, dates: Record<string, Date> = {}): Promise<Buffer> {
    const archive = new ZipArchive();
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();
    passthrough.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.pipe(passthrough);
    for (const [name, content] of Object.entries(files)) {
        // A name ending in "/" is an explicit directory entry, which OS-created graph zips include.
        archive.append(name.endsWith("/") ? null : content, { name, date: dates[name] });
    }
    await archive.finalize();
    return Buffer.concat(chunks);
}

/**
 * Whether the active zip provider exposes per-entry modification times. The server reader (yauzl) does; the
 * standalone/browser reader (fflate) doesn't, so date-preservation can't be asserted there.
 */
async function zipEntryMtimeSupported(): Promise<boolean> {
    const buffer = await createZipBuffer({ "probe.txt": "x" }, { "probe.txt": new Date(2020, 0, 1) });
    let supported = false;
    await getZipProvider().readZipFile(new Uint8Array(buffer), async (entry) => {
        supported = entry.lastModified instanceof Date;
    });
    return supported;
}

/** Runs the Logseq importer over `files` and returns the import root note. */
async function importLogseq(files: Record<string, string | Buffer>, fileName?: string, dates?: Record<string, Date>): Promise<BNote> {
    const buffer = await createZipBuffer(files, dates);
    const taskContext = TaskContext.getInstance("logseq-integration", "importNotes", { safeImport: true });

    return new Promise<BNote>((resolve, reject) => {
        void getContext().init(async () => {
            try {
                const root = becca.getNoteOrThrow("root");
                resolve(await logseqImporter.importLogseq(taskContext, new Uint8Array(buffer), root, fileName));
            } catch (e) {
                reject(e);
            }
        });
    });
}

describe("Logseq importer — integration", () => {
    it("creates a 'Logseq import' text root with an import icon", async () => {
        const importRoot = await importLogseq({ "logseq/config.edn": "{}", "pages/Note.md": "body" });

        expect(importRoot.title).toBe("Logseq import");
        expect(importRoot.type).toBe("text");
        expect(importRoot.getOwnedLabelValue("iconClass")).toBe("bx bx-import");
    });

    it("mirrors the graph folder structure, rendering each note's Markdown to HTML", async () => {
        const importRoot = await importLogseq({
            "logseq/config.edn": "{:meta/version 1}",
            "journals/2026_08_10.md": "- A *journal* entry.",
            "pages/contents.md": "Contents.",
            "pages/Private___Sport___Jogging.md": "Jogging."
        });

        // One container note per folder, named after the folder; the config folder contributes nothing.
        const children = importRoot.getChildNotes();
        expect(children.map((n) => n.title)).toEqual(["journals", "pages"]);

        const journals = children.find((n) => n.title === "journals");
        expect(journals?.getChildNotes().map((n) => n.title)).toEqual(["2026_08_10"]);
        expect(decodeUtf8(journals?.getChildNotes()[0]?.getContent() ?? "")).toBe("<ul><li>A <em>journal</em> entry.</li></ul>");

        // The `A___B___C` namespace encoding is not decoded yet — the file name is the title verbatim.
        const pages = children.find((n) => n.title === "pages");
        expect(pages?.getChildNotes().map((n) => n.title)).toEqual(["contents", "Private___Sport___Jogging"]);
    });

    it("skips the logseq/ config folder at either zip layout, naming the root after the graph folder", async () => {
        // Zipping the graph's outer folder nests everything under it, and puts logseq/ one level down.
        const importRoot = await importLogseq({
            "Demograph/logseq/config.edn": "{:meta/version 1}",
            "Demograph/logseq/custom.css": "body {}",
            "Demograph/logseq/bak/logseq/config/2026-08-10.edn": "{}",
            "Demograph/pages/contents.md": "-"
        });

        expect(importRoot.title).toBe("Demograph");
        expect(importRoot.getChildNotes().map((n) => n.title)).toEqual(["pages"]);
    });

    it("keeps a page whose name merely starts with the config folder's, and one called 'logseq'", async () => {
        const importRoot = await importLogseq({
            "logseq/config.edn": "{}",
            "pages/logseq.md": "About the tool.",
            "logseq-notes/Note.md": "Not config."
        });

        expect(importRoot.getChildNotes().map((n) => n.title)).toEqual(["logseq-notes", "pages"]);
        expect(importRoot.getChildNotes().find((n) => n.title === "pages")?.getChildNotes().map((n) => n.title)).toEqual(["logseq"]);
    });

    it("falls back to the zip's file name for the root title when the graph contents were zipped directly", async () => {
        const importRoot = await importLogseq({ "logseq/config.edn": "{}", "pages/Note.md": "body" }, "MyGraph.zip");

        expect(importRoot.title).toBe("MyGraph");
    });

    it("ignores explicit directory entries and gives a folder's notes a single container", async () => {
        const importRoot = await importLogseq({
            "logseq/config.edn": "{}",
            "pages/": "",
            "pages/A.md": "a",
            "pages/B.md": "b"
        });

        expect(importRoot.getChildNotes().map((n) => n.title)).toEqual(["pages"]);
        expect(importRoot.getChildNotes()[0]?.getChildNotes().map((n) => n.title)).toEqual(["A", "B"]);
    });

    it("imports assets and drawings as standalone image/file notes at their graph location", async () => {
        const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
        const importRoot = await importLogseq({
            "logseq/config.edn": "{}",
            "assets/image_1786381781820_0.png": png,
            "draws/2026-08-10-19-22-24.excalidraw": "{\"elements\":[]}",
            "pages/Note.md": "body"
        });

        const assets = importRoot.getChildNotes().find((n) => n.title === "assets");
        const image = assets?.getChildNotes()[0];
        expect(image?.type).toBe("image");
        expect(image?.mime).toBe("image/png");
        expect(image?.title).toBe("image_1786381781820_0.png");
        expect(image?.getOwnedLabelValue("originalFileName")).toBe("image_1786381781820_0.png");

        // A drawing is a plain file for now (no canvas conversion); its extension is dropped from the title
        // by the shared convention, and preserved in the label.
        const draws = importRoot.getChildNotes().find((n) => n.title === "draws");
        const drawing = draws?.getChildNotes()[0];
        expect(drawing?.type).toBe("file");
        expect(drawing?.title).toBe("2026-08-10-19-22-24");
        expect(drawing?.getOwnedLabelValue("originalFileName")).toBe("2026-08-10-19-22-24.excalidraw");
    });

    it("leaves Logseq's own syntax as literal Markdown for now", async () => {
        const importRoot = await importLogseq({
            "logseq/config.edn": "{}",
            "journals/2026_08_10.md": "weight:: 80.5 kg\n\n- # [[Work/Project_A]]\n\t- TODO Do this and that"
        });

        const note = importRoot.getChildNotes()[0]?.getChildNotes()[0];
        // Properties, page references and TODO markers are not interpreted — only the Markdown around them is.
        expect(decodeUtf8(note?.getContent() ?? "")).toContain("weight:: 80.5 kg");
        expect(decodeUtf8(note?.getContent() ?? "")).toContain("[[Work/Project_A]]");
        expect(decodeUtf8(note?.getContent() ?? "")).toContain("TODO Do this and that");
    });

    it("preserves the file's modification time from the zip entry", async (ctx) => {
        // The standalone/browser zip provider (fflate) doesn't expose entry mtimes, so there's no date to
        // preserve; the note keeps its import-time dates. Skip rather than assert provider-specific behavior.
        if (!(await zipEntryMtimeSupported())) {
            ctx.skip();
        }

        const importRoot = await importLogseq({ "Note.md": "Body." }, undefined, { "Note.md": new Date(2020, 5, 15, 12, 30, 0) });

        const note = importRoot.getChildNotes().find((n) => n.title === "Note");
        if (!note) {
            throw new Error("note was not imported");
        }
        // The date comes from the zip entry (2020), not the import time, and created falls back to modified.
        // Exact-instant fidelity isn't asserted: archiver (writing) and yauzl (reading) interpret DOS time
        // zones differently, so this synthetic round-trip skews by the local offset — real OS-written zips
        // store local DOS time that yauzl reads back correctly.
        expect(note.utcDateModified?.startsWith("2020-")).toBe(true);
        expect(note.utcDateCreated).toBe(note.utcDateModified);
    });

    it("ignores the DOS-epoch sentinel a date-less zip entry yields", async () => {
        const importRoot = await importLogseq({ "Note.md": "Body." }, undefined, { "Note.md": new Date(1980, 0, 1) });

        const note = importRoot.getChildNotes().find((n) => n.title === "Note");
        // 1980 is the ZIP format's zero date, not a real modification time, so the import-time dates stand.
        expect(note?.utcDateModified?.startsWith("1980-")).toBe(false);
    });

    it("skips dot-prefixed entries such as .DS_Store", async () => {
        const importRoot = await importLogseq({
            "logseq/config.edn": "{}",
            ".DS_Store": "junk",
            "pages/.hidden.md": "hidden",
            "pages/Note.md": "body"
        });

        expect(importRoot.getChildNotes().map((n) => n.title)).toEqual(["pages"]);
        expect(importRoot.getChildNotes()[0]?.getChildNotes().map((n) => n.title)).toEqual(["Note"]);
    });
});
