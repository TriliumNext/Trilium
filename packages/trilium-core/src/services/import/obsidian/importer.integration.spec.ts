import { ZipArchive } from "archiver";
import LZString from "lz-string";
import { PassThrough } from "stream";
import { describe, expect, it } from "vitest";

import { getBecca } from "../../../becca/becca.js";
import type BNote from "../../../becca/entities/bnote.js";
import { getContext } from "../../context.js";
import TaskContext from "../../task_context.js";
import { decodeUtf8 } from "../../utils/binary.js";
import { getZipProvider } from "../../zip_provider.js";
import obsidianImporter from "./importer.js";

/** Builds an in-memory zip from a map of entry name -> contents, optionally stamping per-entry mtimes. */
async function createZipBuffer(files: Record<string, string | Buffer>, dates: Record<string, Date> = {}): Promise<Buffer> {
    const archive = new ZipArchive();
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();
    passthrough.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.pipe(passthrough);
    for (const [name, content] of Object.entries(files)) {
        archive.append(content, { name, date: dates[name] });
    }
    await archive.finalize();
    return Buffer.concat(chunks);
}

/** Builds an Obsidian Excalidraw-plugin Markdown file wrapping `scene` in a compressed-json drawing block. */
function excalidrawFile(scene: object, embeddedFiles = ""): string {
    const compressed = LZString.compressToBase64(JSON.stringify(scene));
    return `---\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n---\n# Excalidraw Data\n${embeddedFiles}%%\n## Drawing\n\`\`\`compressed-json\n${compressed}\n\`\`\`\n%%`;
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

/** Runs the Obsidian importer over `files` and returns the import root note. */
async function importObsidian(files: Record<string, string | Buffer>, fileName?: string, dates?: Record<string, Date>): Promise<BNote> {
    const buffer = await createZipBuffer(files, dates);
    const taskContext = TaskContext.getInstance("obsidian-integration", "importNotes", { safeImport: true });

    return new Promise<BNote>((resolve, reject) => {
        void getContext().init(async () => {
            try {
                const root = getBecca().getNoteOrThrow("root");
                resolve(await obsidianImporter.importObsidian(taskContext, new Uint8Array(buffer), root, fileName));
            } catch (e) {
                reject(e);
            }
        });
    });
}

describe("Obsidian importer — integration", () => {
    it("creates an 'Obsidian import' text root with an import icon", async () => {
        const importRoot = await importObsidian({ "Note.md": "body" });

        expect(importRoot.title).toBe("Obsidian import");
        expect(importRoot.type).toBe("text");
        expect(importRoot.getOwnedLabelValue("iconClass")).toBe("bx bx-import");
    });

    it("mirrors the vault folder structure, rendering each note's Markdown to HTML", async () => {
        const importRoot = await importObsidian({
            "Welcome.md": "This is your new *vault*.",
            "Folder 1/First note.md": "Content goes here.",
            "Folder 2/Folder 2 Note.md": "Nested content."
        });

        // The root holds the top-level note plus one container note per folder, named after the folder.
        const children = importRoot.getChildNotes();
        expect(children.map((n) => n.title)).toEqual(["Folder 1", "Folder 2", "Welcome"]);

        // Each folder note holds its notes; the Markdown body is rendered to HTML.
        const folder1 = children.find((n) => n.title === "Folder 1");
        expect(folder1?.getChildNotes().map((n) => n.title)).toEqual(["First note"]);
        expect(decodeUtf8(folder1?.getChildNotes()[0]?.getContent() ?? "")).toBe("<p>Content goes here.</p>");

        const welcome = children.find((n) => n.title === "Welcome");
        expect(decodeUtf8(welcome?.getContent() ?? "")).toBe("<p>This is your new <em>vault</em>.</p>");
    });

    it("renders an Obsidian callout (with fold marker and custom title) as an admonition", async () => {
        const importRoot = await importObsidian({
            "Note.md": "> [!success]- Nicely done\n> It worked."
        });

        const note = importRoot.getChildNotes().find((n) => n.title === "Note");
        expect(decodeUtf8(note?.getContent() ?? ""))
            .toBe('<aside class="admonition tip"><p><strong>Nicely done</strong></p><p>It worked.</p></aside>');
    });

    it("imports front matter properties as camelCased labels and strips the block from the note body", async () => {
        // Modeled on the vault's "Files with properties" note.
        const importRoot = await importObsidian({
            "Note.md": "---\nfirst: First value\ntags:\n  - Tag\n  - AnotherTag\nCheckbox prop: true\nList:\n  - a\n  - b\n---\nThe body."
        });

        const note = importRoot.getChildNotes().find((n) => n.title === "Note");
        if (!note) {
            throw new Error("note was not imported");
        }

        // The block is gone from the content; only the rendered body remains.
        expect(decodeUtf8(note.getContent())).toBe("<p>The body.</p>");

        // Properties become labels with camelCased names; a list yields one label per item.
        expect(note.getOwnedLabelValue("first")).toBe("First value");
        expect(note.getOwnedLabelValue("checkboxProp")).toBe("true");
        expect(note.getOwnedLabelValues("list")).toEqual(["a", "b"]);
        // tags are an Obsidian special key → individual labels (covered in detail below). A single-token tag
        // is fully lower-cased by toAttributeName (e.g. "AnotherTag" → "anothertag").
        const labelNames = note.getOwnedAttributes().filter((a) => a.type === "label").map((a) => a.name);
        expect(labelNames).toContain("tag");
        expect(labelNames).toContain("anothertag");
    });

    it("maps Obsidian special front matter keys: tags → labels, aliases → #alias, dropping cssclasses/publish/permalink", async () => {
        const importRoot = await importObsidian({
            "Note.md": "---\ntags:\n  - Book\n  - Reading List\naliases:\n  - Alt name\ncssclasses:\n  - foo\npublish: true\npermalink: /x\nfirst: First value\n---\nBody."
        });

        const note = importRoot.getChildNotes().find((n) => n.title === "Note");
        if (!note) {
            throw new Error("note was not imported");
        }
        const labels = note.getOwnedAttributes().filter((a) => a.type === "label");
        const names = labels.map((a) => a.name);

        // tags → individual labels named after the (sanitized) tag.
        expect(names).toContain("book");
        expect(names).toContain("readingList");
        // aliases → #alias labels preserving the alternate name.
        expect(labels.filter((a) => a.name === "alias").map((a) => a.value)).toEqual(["Alt name"]);
        // dropped keys produce no labels; a regular property is unaffected.
        expect(names).not.toContain("cssclasses");
        expect(names).not.toContain("publish");
        expect(names).not.toContain("permalink");
        expect(note.getOwnedLabelValue("first")).toBe("First value");
    });

    it("types front matter properties from .obsidian/types.json with per-note promoted definitions", async () => {
        const importRoot = await importObsidian({
            ".obsidian/types.json": JSON.stringify({ types: { "Date": "date", "Date Time": "datetime", "Number": "number", "Checkbox prop": "checkbox" } }),
            "Note.md": "---\nDate: 2026-06-27\nDate Time: 2026-06-27T15:10:00\nNumber: 5\nCheckbox prop: true\n---\nBody."
        });

        const note = importRoot.getChildNotes().find((n) => n.title === "Note");
        if (!note) {
            throw new Error("note was not imported");
        }

        // Values are formatted for their Trilium type (datetime loses its seconds).
        expect(note.getOwnedLabelValue("date")).toBe("2026-06-27");
        expect(note.getOwnedLabelValue("dateTime")).toBe("2026-06-27T15:10");
        expect(note.getOwnedLabelValue("number")).toBe("5");
        expect(note.getOwnedLabelValue("checkboxProp")).toBe("true");

        // Each property gets a per-note promoted definition carrying the Trilium type and the original name as alias.
        expect(note.getOwnedLabelValue("label:date")).toBe("promoted,single,date,alias=Date");
        expect(note.getOwnedLabelValue("label:dateTime")).toBe("promoted,single,datetime,alias=Date Time");
        expect(note.getOwnedLabelValue("label:number")).toBe("promoted,single,number,alias=Number");
        expect(note.getOwnedLabelValue("label:checkboxProp")).toBe("promoted,single,boolean,alias=Checkbox prop");
    });

    it("preserves a note's modification date from its zip entry, with created falling back to it", async (ctx) => {
        // The standalone/browser zip provider (fflate) doesn't expose entry mtimes, so there's no date to
        // preserve; the note keeps its import-time dates. Skip rather than assert provider-specific behavior.
        if (!(await zipEntryMtimeSupported())) {
            ctx.skip();
        }

        const importRoot = await importObsidian({ "Note.md": "Body." }, undefined, { "Note.md": new Date(2020, 5, 15, 12, 30, 0) });

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

    it("converts ==highlights== to a coloured span and %%comments%% to dropped HTML comments", async () => {
        const importRoot = await importObsidian({
            "Note.md": "A ==highlight== and a %%hidden%% comment."
        });

        const note = importRoot.getChildNotes().find((n) => n.title === "Note");
        // The highlight survives sanitization as a CKEditor background-colour span (the sanitizer drops the
        // trailing semicolon); the comment is rendered as an HTML comment, which the sanitizer then strips.
        expect(decodeUtf8(note?.getContent() ?? "")).toBe('<p>A <span style="background-color:hsl(60, 75%, 60%)">highlight</span> and a  comment.</p>');
    });

    it("drops the .base/.canvas files and the .obsidian config folder, but keeps an orphan attachment", async () => {
        const importRoot = await importObsidian({
            "Note.md": "Body.",
            "Screenshot.png": Buffer.from("\x89PNG\r\n\x1a\nfake"),
            "Untitled.base": "filters: {}",
            "Untitled.canvas": "{}",
            ".obsidian/app.json": "{}",
            ".obsidian/workspace.json": "{}"
        });

        // The Markdown note and the unreferenced attachment are imported; .base/.canvas/.obsidian are not.
        expect(importRoot.getChildNotes().map((n) => n.title)).toEqual(["Note", "Screenshot.png"]);
    });

    it("strips the wrapper folder and names the root after the vault when the outer folder is zipped", async () => {
        // `.obsidian/` sits under "Test vault/", so that folder is the vault root and must be stripped.
        const importRoot = await importObsidian({
            "Test vault/Welcome.md": "Hi.",
            "Test vault/Folder 1/First note.md": "Content goes here.",
            "Test vault/.obsidian/app.json": "{}"
        });

        expect(importRoot.title).toBe("Test vault");
        expect(importRoot.getChildNotes().map((n) => n.title)).toEqual(["Folder 1", "Welcome"]);
        const folder1 = importRoot.getChildNotes().find((n) => n.title === "Folder 1");
        expect(folder1?.getChildNotes().map((n) => n.title)).toEqual(["First note"]);
    });

    it("names the root from the zip filename when the vault contents are zipped directly", async () => {
        // `.obsidian/` is at the zip root, so nothing is stripped; the name comes from the zip file.
        const importRoot = await importObsidian({ "Welcome.md": "Hi.", ".obsidian/app.json": "{}" }, "My Vault.zip");

        expect(importRoot.title).toBe("My Vault");
        expect(importRoot.getChildNotes().map((n) => n.title)).toEqual(["Welcome"]);
    });

    it("falls back to stripping a single shared wrapper folder when there is no .obsidian", async () => {
        const importRoot = await importObsidian({ "Wrapper/A.md": "a", "Wrapper/B.md": "b" });

        expect(importRoot.title).toBe("Wrapper");
        expect(importRoot.getChildNotes().map((n) => n.title)).toEqual(["A", "B"]);
    });

    it("imports image embeds as image attachments and non-image embeds as file reference links", async () => {
        const importRoot = await importObsidian({
            "Attachment test.md": "![[shot.png]]\n\n![[doc.rtf]]",
            "shot.png": Buffer.from("\x89PNG\r\n\x1a\nfake-png"),
            "doc.rtf": Buffer.from("{\\rtf1 hello}"),
            ".obsidian/app.json": "{}"
        }, "Vault.zip");

        const note = importRoot.getChildNotes().find((n) => n.title === "Attachment test");
        if (!note) {
            throw new Error("note was not imported");
        }
        const content = decodeUtf8(note.getContent());

        // The image embed becomes a role:image attachment, its <img> src rewritten to point at it.
        const images = note.getAttachmentsByRole("image");
        expect(images.map((a) => a.title)).toEqual(["shot.png"]);
        expect(content).toContain(`<img src="api/attachments/${images[0]?.attachmentId}/image/`);
        expect(content).not.toContain(`src="/shot.png"`);

        // The non-image embed becomes a role:file attachment with a reference link.
        const files = note.getAttachmentsByRole("file");
        expect(files.map((a) => a.title)).toEqual(["doc.rtf"]);
        expect(content).toContain(`class="reference-link"`);
        expect(content).toContain(`attachmentId=${files[0]?.attachmentId}`);
        expect(content).not.toContain("/doc.rtf");
    });

    it("resolves an embed by name even when the attachment lives in a different folder", async () => {
        const importRoot = await importObsidian({
            "Notes/Page.md": "![[pic.png]]",
            "Assets/pic.png": Buffer.from("\x89PNG\r\n\x1a\nfake")
        });

        const page = importRoot.getChildNotes().find((n) => n.title === "Notes")?.getChildNotes()[0];
        expect(page?.getAttachmentsByRole("image").map((a) => a.title)).toEqual(["pic.png"]);
    });

    it("strips an embed of a database (.base) that has no Trilium representation yet", async () => {
        // Modeled on the vault's "Formatting test" note, which embeds a Base via `![[Untitled.base]]`.
        const importRoot = await importObsidian({
            "Note.md": "Body.\n\n![[Untitled.base]]",
            "Untitled.base": "filters: {}"
        });

        const note = importRoot.getChildNotes().find((n) => n.title === "Note");
        // The base embed is removed cleanly — no broken image and no empty paragraph left behind.
        expect(decodeUtf8(note?.getContent() ?? "")).toBe("<p>Body.</p>");
        expect(note?.getAttachmentsByRole("file")).toHaveLength(0);
    });

    it("materializes an unreferenced (orphan) vault file as a standalone file note at its folder location", async () => {
        const importRoot = await importObsidian({
            "Note.md": "Just a note, linking nothing.",
            "Attachments/report.pdf": Buffer.from("%PDF-1.4 fake"),
            ".obsidian/app.json": "{}"
        }, "Vault.zip");

        const attachmentsFolder = importRoot.getChildNotes().find((n) => n.title === "Attachments");
        const orphan = attachmentsFolder?.getChildNotes()[0];
        if (!orphan) {
            throw new Error("orphan file was not imported");
        }

        // The .pdf extension is stripped from the title (Trilium convention) and preserved in a label.
        expect(orphan.title).toBe("report");
        expect(orphan.type).toBe("file");
        expect(orphan.mime).toBe("application/pdf");
        expect(orphan.getOwnedLabelValue("originalFileName")).toBe("report.pdf");
        expect(decodeUtf8(orphan.getContent())).toBe("%PDF-1.4 fake");
    });

    it("materializes an unreferenced image as an image note", async () => {
        const importRoot = await importObsidian({
            "Note.md": "No embeds here.",
            "logo.png": Buffer.from("\x89PNG\r\n\x1a\nfake-png")
        });

        const orphan = importRoot.getChildNotes().find((n) => n.type === "image");
        expect(orphan?.title).toBe("logo.png");
        expect(orphan?.mime).toBe("image/png");
        expect(orphan?.getOwnedLabelValue("originalFileName")).toBe("logo.png");
    });

    it("does not also create a standalone note for a file that is embedded in a note", async () => {
        const importRoot = await importObsidian({
            "Note.md": "![[shot.png]]",
            "shot.png": Buffer.from("\x89PNG\r\n\x1a\nfake")
        });

        // The image is an inline attachment of the note, not a duplicated standalone note.
        const note = importRoot.getChildNotes().find((n) => n.title === "Note");
        expect(note?.getAttachmentsByRole("image").map((a) => a.title)).toEqual(["shot.png"]);
        expect(importRoot.getChildNotes().some((n) => n.type === "image")).toBe(false);
    });

    it("resolves a wikilink to a reference link and records an internalLink relation (backlink)", async () => {
        const importRoot = await importObsidian({ "A.md": "See [[B]].", "B.md": "I am B." });

        const a = importRoot.getChildNotes().find((n) => n.title === "A");
        const b = importRoot.getChildNotes().find((n) => n.title === "B");
        if (!a || !b) {
            throw new Error("notes were not imported");
        }

        // The link resolves to a reference link (the live-title chip) pointing at B.
        expect(decodeUtf8(a.getContent())).toContain(`<a class="reference-link" href="#root/${b.noteId}">`);
        // ...and drives backlinks both ways.
        expect(a.getRelations().filter((r) => r.name === "internalLink").map((r) => r.value)).toEqual([b.noteId]);
        expect(b.getTargetRelations().filter((r) => r.name === "internalLink").map((r) => r.noteId)).toEqual([a.noteId]);
    });

    it("turns a note embed ![[Note]] into a Trilium include-note with an includeNoteLink relation", async () => {
        // Modeled on the vault's "Reference links" note (`[[Formatting test]]` then `![[Formatting test]]`).
        const importRoot = await importObsidian({ "Reference links.md": "[[Target]]\n\n![[Target]]", "Target.md": "I am the target." });

        const note = importRoot.getChildNotes().find((n) => n.title === "Reference links");
        const target = importRoot.getChildNotes().find((n) => n.title === "Target");
        if (!note || !target) {
            throw new Error("notes were not imported");
        }
        const content = decodeUtf8(note.getContent());

        // The plain wikilink is a reference link; the embed becomes an include-note pointing at the same note.
        expect(content).toContain(`<a class="reference-link" href="#root/${target.noteId}">`);
        expect(content).toContain(`<section class="include-note" data-note-id="${target.noteId}" data-box-size="medium">`);

        // The embed records an includeNoteLink relation (the wikilink an internalLink).
        expect(note.getRelations().filter((r) => r.name === "includeNoteLink").map((r) => r.value)).toEqual([target.noteId]);
        expect(note.getRelations().filter((r) => r.name === "internalLink").map((r) => r.value)).toEqual([target.noteId]);
    });

    it("uses the alias as the link text for [[Target|alias]]", async () => {
        const importRoot = await importObsidian({ "A.md": "[[B|the bee]]", "B.md": "b" });

        const a = importRoot.getChildNotes().find((n) => n.title === "A");
        const b = importRoot.getChildNotes().find((n) => n.title === "B");
        const content = decodeUtf8(a?.getContent() ?? "");
        // An aliased link is a plain internal link carrying the alias text, not a live-title reference link.
        expect(content).toContain(`<a href="#root/${b?.noteId}">the bee</a>`);
        expect(content).not.toContain("reference-link");
    });

    it("resolves a path-qualified wikilink even when the base name is ambiguous", async () => {
        const importRoot = await importObsidian({
            "Linker.md": "[[Folder 1/Note]]",
            "Folder 1/Note.md": "one",
            "Folder 2/Note.md": "two"
        });

        const linker = importRoot.getChildNotes().find((n) => n.title === "Linker");
        const target = importRoot.getChildNotes().find((n) => n.title === "Folder 1")?.getChildNotes()[0];
        expect(decodeUtf8(linker?.getContent() ?? "")).toContain(`href="#root/${target?.noteId}"`);
    });

    it("converts an Excalidraw-plugin drawing into a canvas note titled without the suffix", async () => {
        const importRoot = await importObsidian({
            "Excalidraw/Drawing.excalidraw.md": excalidrawFile({
                type: "excalidraw",
                version: 2,
                source: "https://github.com/zsviczian/obsidian-excalidraw-plugin",
                elements: [{ id: "rect", type: "rectangle", x: 0, y: 0 }],
                appState: { viewBackgroundColor: "#ffffff" },
                files: {}
            }),
            ".obsidian/app.json": "{}"
        });

        const drawing = importRoot.getChildNotes().find((n) => n.title === "Excalidraw")?.getChildNotes()[0];
        if (!drawing) {
            throw new Error("drawing was not imported");
        }

        // The drawing becomes a canvas note, not a text note, titled without its `.excalidraw.md` suffix.
        expect(drawing.title).toBe("Drawing");
        expect(drawing.type).toBe("canvas");
        expect(drawing.mime).toBe("application/json");

        const content = JSON.parse(decodeUtf8(drawing.getContent()));
        expect(content.type).toBe("excalidraw");
        expect(content.elements).toEqual([{ id: "rect", type: "rectangle", x: 0, y: 0 }]);
        // No `excalidraw-plugin`/`tags` labels leak in from the plugin front matter.
        expect(drawing.getOwnedAttributes()).toHaveLength(0);
    });

    it("saves a drawing's embedded image as an image attachment titled with its Excalidraw fileId", async () => {
        const importRoot = await importObsidian({
            "Drawing.excalidraw.md": excalidrawFile({
                type: "excalidraw",
                elements: [{ id: "img", type: "image", fileId: "abc123def456" }],
                appState: {},
                files: {}
            }, "## Embedded Files\nabc123def456: [[shot.png]]\n"),
            "shot.png": Buffer.from("\x89PNG\r\n\x1a\nfake-png")
        });

        const drawing = importRoot.getChildNotes().find((n) => n.title === "Drawing");
        // The image is stored as an `image`-role attachment whose title is the fileId the scene references,
        // matching how the canvas editor persists images so it renders on load.
        const images = drawing?.getAttachmentsByRole("image");
        expect(images?.map((a) => a.title)).toEqual(["abc123def456"]);
    });

    it("resolves a wikilink that targets an Excalidraw drawing by name", async () => {
        const importRoot = await importObsidian({
            "Note.md": "See [[Drawing]].",
            "Drawing.excalidraw.md": excalidrawFile({ type: "excalidraw", elements: [], appState: {}, files: {} })
        });

        const note = importRoot.getChildNotes().find((n) => n.title === "Note");
        const drawing = importRoot.getChildNotes().find((n) => n.title === "Drawing");
        if (!note || !drawing) {
            throw new Error("notes were not imported");
        }

        expect(decodeUtf8(note.getContent())).toContain(`href="#root/${drawing.noteId}"`);
        expect(note.getRelations().filter((r) => r.name === "internalLink").map((r) => r.value)).toEqual([drawing.noteId]);
    });

    it("falls back to a text note when a `.excalidraw.md` file has no usable drawing data", async () => {
        const importRoot = await importObsidian({ "Broken.excalidraw.md": "Just some text, no drawing block." });

        const note = importRoot.getChildNotes().find((n) => n.title === "Broken");
        // A drawing that can't be decoded is imported as ordinary text rather than dropped.
        expect(note?.type).toBe("text");
        expect(decodeUtf8(note?.getContent() ?? "")).toBe("<p>Just some text, no drawing block.</p>");
    });

    it("unwraps unresolvable and ambiguous wikilinks to plain text, recording no relation", async () => {
        const importRoot = await importObsidian({
            "Missing.md": "Go to [[Nowhere]].",
            "Ambiguous.md": "[[Dup]]",
            "Folder 1/Dup.md": "one",
            "Folder 2/Dup.md": "two"
        });

        const missing = importRoot.getChildNotes().find((n) => n.title === "Missing");
        expect(decodeUtf8(missing?.getContent() ?? "")).toBe("<p>Go to Nowhere.</p>");
        expect(missing?.getRelations().filter((r) => r.name === "internalLink")).toHaveLength(0);

        // "Dup" is shared by two notes, so it's ambiguous and left unresolved rather than guessed.
        const ambiguous = importRoot.getChildNotes().find((n) => n.title === "Ambiguous");
        expect(decodeUtf8(ambiguous?.getContent() ?? "")).toBe("<p>Dup</p>");
        expect(ambiguous?.getRelations().filter((r) => r.name === "internalLink")).toHaveLength(0);
    });
});
