import { ZipArchive } from "archiver";
import { PassThrough } from "stream";
import { describe, expect, it } from "vitest";

import { getBecca } from "../../../becca/becca.js";
import type BNote from "../../../becca/entities/bnote.js";
import { getContext } from "../../context.js";
import TaskContext from "../../task_context.js";
import notionImporter from "./importer.js";

/** Builds an in-memory zip from a map of entry name -> contents. */
async function createZipBuffer(files: Record<string, string | Buffer>): Promise<Buffer> {
    const archive = new ZipArchive();
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();
    passthrough.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.pipe(passthrough);
    for (const [name, content] of Object.entries(files)) {
        archive.append(content, { name });
    }
    await archive.finalize();
    return Buffer.concat(chunks);
}

/** Runs the Notion importer over `files` and returns the import root note. */
async function importNotion(files: Record<string, string | Buffer>): Promise<BNote> {
    const buffer = await createZipBuffer(files);
    const taskContext = TaskContext.getInstance("notion-integration", "importNotes", { safeImport: true });

    return new Promise<BNote>((resolve, reject) => {
        void getContext().init(async () => {
            try {
                const root = getBecca().getNoteOrThrow("root");
                resolve(await notionImporter.importNotion(taskContext, new Uint8Array(buffer), root));
            } catch (e) {
                reject(e);
            }
        });
    });
}

const pageHtml = (title: string, id = "386c5eca1b8b80439520cad27a0d2749") =>
    `<html><head><title>${title}</title></head><body><div id="${id}" class="page"><div class="page-body"><p>Hello</p></div></div></body></html>`;

describe("Notion importer — integration", () => {
    it("nests child pages under the parent named by their containing folder", async () => {
        // Notion names the children folder by title only ("Examples"), while the page file keeps its id.
        const importRoot = await importNotion({
            "Examples 579da56a22844fb9a769e27d53067adc.html": pageHtml("Examples", "579da56a22844fb9a769e27d53067adc"),
            "Examples/Hello world 2c6c5eca1b8b80f7b9eaf4f396b755dc.html": pageHtml("Hello world", "2c6c5eca1b8b80f7b9eaf4f396b755dc"),
            "Examples/Quick Note 3aa38acf20c74649b4370fab0195b882.html": pageHtml("Quick Note", "3aa38acf20c74649b4370fab0195b882")
        });

        const examples = importRoot.getChildNotes().find((note) => note.title === "Examples");
        expect(importRoot.getChildNotes().map((note) => note.title)).toEqual(["Examples"]);
        expect(examples?.getChildNotes().map((note) => note.title).sort()).toEqual(["Hello world", "Quick Note"]);
    });

    it("rejects a Notion 'Markdown & CSV' export, guiding the user to re-export as HTML", async () => {
        // A Markdown export has no `.html` pages — pages are `.md` and databases are `.csv`. This importer
        // only understands the HTML export, so it must fail loudly rather than building an empty tree or
        // orphaning every page as a `.md` attachment.
        await expect(
            importNotion({
                "Workout tracker 644acbf2ec344e1eae705a8b33d186b3.md":
                    "# Workout tracker\n\n[Workout Schedule](workout%20tracker/Workout%20Schedule%20644acbf2ec344e1eae705a8b33d186b3.csv)",
                "workout tracker/Workout Schedule 644acbf2ec344e1eae705a8b33d186b3.csv": "Name,Day\nSquats,Monday"
            })
        ).rejects.toThrow(/re-export.*HTML/i);
    });

    it("still imports an HTML export that happens to bundle a `.md` attachment", async () => {
        // A stray `.md` file (a real attachment) inside a valid HTML export must not trip the guard:
        // the export has `.html` pages, so it's clearly the right format.
        const importRoot = await importNotion({
            "Notes 2c6c5eca1b8b80f7b9eaf4f396b755dc.html": pageHtml("Notes", "2c6c5eca1b8b80f7b9eaf4f396b755dc"),
            "Notes/readme.md": "# bundled attachment"
        });

        expect(importRoot.getChildNotes().map((note) => note.title)).toEqual(["Notes"]);
    });

    it("rejects an HTML export made without 'Create folders for subpages' (flat pages still linked as subpages)", async () => {
        // With the option off, the child sits at the archive root (no `Parent/` folder), yet the parent
        // still references it via a flat link-to-page block. The folder structure is gone, so the nesting
        // can't be reconstructed — fail with guidance instead of silently flattening the tree.
        const parentId = "11111111111111111111111111111111";
        const childId = "22222222222222222222222222222222";
        const childFigure = `<figure class="link-to-page"><a href="Child ${childId}.html">Child</a></figure>`;
        await expect(
            importNotion({
                [`Parent ${parentId}.html`]: `<html><head><title>Parent</title></head><body><div id="${parentId}"><div class="page-body">${childFigure}</div></div></body></html>`,
                [`Child ${childId}.html`]: pageHtml("Child", childId)
            })
        ).rejects.toThrow(/Create folders for subpages/i);
    });

    it("imports a single-page export (no folders) without flagging it as a flattened hierarchy", async () => {
        // The folders-disabled guard must never catch a legitimate single page, which also has no folders.
        const importRoot = await importNotion({
            "Solo 2c6c5eca1b8b80f7b9eaf4f396b755dc.html": pageHtml("Solo", "2c6c5eca1b8b80f7b9eaf4f396b755dc")
        });

        expect(importRoot.getChildNotes().map((note) => note.title)).toEqual(["Solo"]);
    });

    it("rejects a folders-disabled export whose database rows were flattened to the root", async () => {
        // A CSV-only database with the folders option off: the row pages sit at the archive root with titles
        // matching the CSV's first column, instead of nesting under the database. Detect via that title match.
        await expect(
            importNotion({
                "Tasks 08d361c59a9940c2a9d7237a4e6cd09a.csv": "Name,Status\nFirst task,Done\nSecond task,Todo",
                "First task 4f195d8c55fb44f4b94a063e643b0297.html": pageHtml("First task", "4f195d8c55fb44f4b94a063e643b0297"),
                "Second task 388c5eca1b8b80929a78da7c68154bd7.html": pageHtml("Second task", "388c5eca1b8b80929a78da7c68154bd7")
            })
        ).rejects.toThrow(/Create folders for subpages/i);
    });

    it("imports a flat export containing an empty database (no rows) without flagging", async () => {
        // An empty database (CSV header only) contributes no row titles, so a legitimately flat export that
        // happens to include one isn't mistaken for a flattened hierarchy.
        const importRoot = await importNotion({
            "Empty DB 08d361c59a9940c2a9d7237a4e6cd09a.csv": "Name,Status",
            "Note A 4f195d8c55fb44f4b94a063e643b0297.html": pageHtml("Note A", "4f195d8c55fb44f4b94a063e643b0297"),
            "Note B 388c5eca1b8b80929a78da7c68154bd7.html": pageHtml("Note B", "388c5eca1b8b80929a78da7c68154bd7")
        });

        expect(importRoot.getChildNotes().map((note) => note.title)).toEqual(expect.arrayContaining(["Note A", "Note B"]));
    });

    it("imports flat top-level pages that only mention each other (no subpage blocks) without flagging", async () => {
        // Several root-level pages with an inline cross-link — but no `link-to-page` subpage blocks — is a
        // legitimately flat export (e.g. a whole workspace), not a flattened hierarchy. It must import.
        const idA = "33333333333333333333333333333333";
        const idB = "44444444444444444444444444444444";
        const importRoot = await importNotion({
            [`Page A ${idA}.html`]: `<html><head><title>Page A</title></head><body><div id="${idA}"><div class="page-body"><p><a href="Page B ${idB}.html">Page B</a></p></div></div></body></html>`,
            [`Page B ${idB}.html`]: pageHtml("Page B", idB)
        });

        expect(importRoot.getChildNotes().map((note) => note.title).sort()).toEqual(["Page A", "Page B"]);
    });

    // Both Notion export shapes of an inline database — a full/workspace export's link to the separately-
    // exported CSV, and a partial export's rendered table — must resolve to an include-note embedding the
    // imported collection. Each shares the same CSV + rows; only the in-page `collectionBlock` differs.
    const expectInlineDatabaseEmbedded = async (collectionBlock: string) => {
        const pageId = "38ac5eca1b8b8075b965f506658aeb1f";
        const dbId = "38ac5eca1b8b808babeaf10c0980fa5b";
        const importRoot = await importNotion({
            [`Inline database test ${pageId}.html`]:
                `<html><head><title>Inline database test</title></head><body><div id="${pageId}"><div class="page-body"><p>Before</p>${collectionBlock}<p>After</p></div></div></body></html>`,
            [`Inline database test/Database title ${dbId}.csv`]: "Name\nFirst\nSecond",
            [`Inline database test/Database title/First 38ac5eca1b8b8069afb5c9fe40e53c42.html`]: pageHtml("First", "38ac5eca1b8b8069afb5c9fe40e53c42"),
            [`Inline database test/Database title/Second 38ac5eca1b8b8025bf73d86d81713eb3.html`]: pageHtml("Second", "38ac5eca1b8b8025bf73d86d81713eb3")
        });

        const page = importRoot.getChildNotes().find((note) => note.title === "Inline database test");
        const database = page?.getChildNotes().find((note) => note.title === "Database title");
        // The database imported as a table collection with its rows nested under it.
        expect(database?.type).toBe("book");
        expect(database?.getChildNotes().map((note) => note.title).sort()).toEqual(["First", "Second"]);
        // The page body embeds that collection inline and no longer references the raw CSV or the table.
        const content = page?.getContent() ?? "";
        expect(content).toContain(`class="include-note"`);
        expect(content).toContain(`data-note-id="${database?.noteId}"`);
        expect(content).toContain(`data-box-size="medium"`);
        expect(content).not.toContain("data-notion-id");
        expect(content).not.toContain(".csv");
        expect(content).not.toContain("collection-content");
    };

    it("embeds a full-export inline database (CSV link) as an include-note for the imported collection", async () => {
        const dbId = "38ac5eca1b8b808babeaf10c0980fa5b";
        await expectInlineDatabaseEmbedded(
            `<div style="display:contents" dir="ltr"><div id="38ac5eca-1b8b-808b-abea-f10c0980fa5b" class="collection-content"><h4 class="collection-title">Database title</h4>` +
            `<a href="Inline%20database%20test/Database%20title%20${dbId}.csv"><code>Inline database test/Database title ${dbId}.csv</code></a></div></div>`
        );
    });

    it("embeds a partial-export inline database (rendered table) as an include-note for the imported collection", async () => {
        await expectInlineDatabaseEmbedded(
            `<div style="display:contents" dir="ltr"><div id="38ac5eca-1b8b-808b-abea-f10c0980fa5b" class="collection-content"><h4 class="collection-title">Database title</h4>` +
            `<div class="collection-content-wrapper"><table class="collection-content"><thead><tr><th>Name</th></tr></thead><tbody>` +
            `<tr id="38ac5eca-1b8b-8069-afb5-c9fe40e53c42"><td class="cell-title"><a href="Inline%20database%20test/Database%20title/First%2038ac5eca1b8b8069afb5c9fe40e53c42.html">First</a></td></tr>` +
            `<tr id="38ac5eca-1b8b-8025-bf73-d86d81713eb3"><td class="cell-title"><a href="Inline%20database%20test/Database%20title/Second%2038ac5eca1b8b8025bf73d86d81713eb3.html">Second</a></td></tr>` +
            `</tbody></table></div></div></div>`
        );
    });

    it("groups a CSV-only database's rows under a container note, instead of orphaning them to the root", async () => {
        // A Notion inline/linked database exports as a `.csv` with no sibling `.html`; its rows live in a
        // folder named after the database. Nothing owns that folder, so without a container they'd be flat.
        const importRoot = await importNotion({
            "Reading List 08d361c59a9940c2a9d7237a4e6cd09a.html": pageHtml("Reading List", "08d361c59a9940c2a9d7237a4e6cd09a"),
            "Reading List/Media 0a556b01dd9c4b70bbba51bf2ee0409b.csv": "Title,Author\nx,y",
            "Reading List/Media/Bon Appetit 4f195d8c55fb44f4b94a063e643b0297.html": pageHtml("Bon Appetit", "4f195d8c55fb44f4b94a063e643b0297")
        });

        const readingList = importRoot.getChildNotes().find((note) => note.title === "Reading List");
        const media = readingList?.getChildNotes().find((note) => note.title === "Media");
        // The synthesized container is itself a table collection, like a database that has its own page.
        expect(media?.type).toBe("book");
        expect(media?.getLabelValue("viewType")).toBe("table");
        expect(media?.getChildNotes().map((note) => note.title)).toEqual(["Bon Appetit"]);
    });

    it("does not create a duplicate container when the database also has its own page", async () => {
        const importRoot = await importNotion({
            "45 cff419ddfc69457aad14bd0381cf0172.html": pageHtml("45", "cff419ddfc69457aad14bd0381cf0172"),
            "45 cff419ddfc69457aad14bd0381cf0172.csv": "a,b\n1,2",
            "45/Brown fox 4731219279d04d78aca408c0a60c4263.html": pageHtml("Brown fox", "4731219279d04d78aca408c0a60c4263")
        });

        const fortyFive = importRoot.getChildNotes().filter((note) => note.title === "45");
        expect(fortyFive.length).toBe(1);
        expect(fortyFive[0].getChildNotes().map((note) => note.title)).toEqual(["Brown fox"]);
    });

    it("imports a database's own page as an empty table collection, dropping its rendered collection table", async () => {
        // A Notion database page's body is the rendered collection table, not real content — a Trilium
        // collection note is empty (its data lives in the row notes), so the table must not become content.
        // The database becomes a `book` with #viewType=table, the only view a Notion export preserves.
        const collectionBody = `<div class="collection-content-wrapper"><table class="collection-content"><thead><tr><th>Name</th><th>Select column</th></tr></thead><tbody><tr id="388c5eca1b8b80929a78da7c68154bd7"><td class="cell-title"><a href="My%20basic%20database/Foo%20388c5eca1b8b80929a78da7c68154bd7.html">Foo</a></td><td><span class="selected-value">First</span></td></tr></tbody></table></div>`;
        const importRoot = await importNotion({
            "My basic database 388c5eca1b8b8078a20fd18330d81306.html": `<html><head><title>My basic database</title></head><body><div id="388c5eca1b8b8078a20fd18330d81306" class="page"><div class="page-body">${collectionBody}</div></div></body></html>`,
            "My basic database 388c5eca1b8b8078a20fd18330d81306.csv": "Name,Select column\nFoo,First",
            "My basic database/Foo 388c5eca1b8b80929a78da7c68154bd7.html": pageHtml("Foo", "388c5eca1b8b80929a78da7c68154bd7")
        });

        const database = importRoot.getChildNotes().find((note) => note.title === "My basic database");
        expect(database?.type).toBe("book");
        expect(database?.getLabelValue("viewType")).toBe("table");
        expect(database?.getContent()).toBe("");
        expect(database?.getChildNotes().map((note) => note.title)).toEqual(["Foo"]);
    });

    it("saves a referenced file as a role:file attachment and links to it from the content", async () => {
        // Notion exports a file block as <figure><div class="source"><a href="<file>">name</a></figure>,
        // with the file bundled in the zip alongside the page.
        const attachmentFigure = `<figure id="386c5eca-1b8b-808b-84d3-cea5b6510570"><div class="source"><a href="Notes/demo.rtf">demo.rtf</a></div></figure>`;
        const importRoot = await importNotion({
            "Notes 386c5eca1b8b80439520cad27a0d2749.html": `<html><head><title>Notes</title></head><body><div id="386c5eca1b8b80439520cad27a0d2749" class="page"><div class="page-body"><div style="display:contents" dir="ltr">${attachmentFigure}</div></div></div></body></html>`,
            "Notes/demo.rtf": "{\\rtf1 hello}"
        });

        const notes = importRoot.getChildNotes().find((note) => note.title === "Notes");
        if (!notes) {
            throw new Error("imported 'Notes' page not found");
        }
        const attachment = notes.getAttachmentsByRole("file").find((a) => a.title === "demo.rtf");
        expect(attachment).toBeDefined();
        expect(notes.getContent()).toContain(`href="#root/${notes.noteId}?viewMode=attachments&attachmentId=${attachment?.attachmentId}"`);
        expect(notes.getContent()).toContain(`class="reference-link"`);
    });

    it("recurses into a root-level nested export zip (the part Notion makes you extract)", async () => {
        const innerZip = await createZipBuffer({ "Inner page 386c5eca1b8b80439520cad27a0d2749.html": pageHtml("Inner page") });
        const importRoot = await importNotion({ "Export-Part-1.zip": innerZip });

        expect(importRoot.getChildNotes().map((note) => note.title)).toContain("Inner page");
    });

    it("descends through two levels of nested export zips", async () => {
        const innermost = await createZipBuffer({ "Inner page 386c5eca1b8b80439520cad27a0d2749.html": pageHtml("Deep page") });
        const middle = await createZipBuffer({ "Export-Part-1.zip": innermost });
        const importRoot = await importNotion({ "Export.zip": middle });

        expect(importRoot.getChildNotes().map((note) => note.title)).toContain("Deep page");
    });

    it("stops descending into nested zips past the depth limit, keeping the innermost as a resource", async () => {
        // depth 0: outer.zip; depth 1: middle.zip; depth 2: innermost.zip — the innermost is at the limit
        // and is kept as a plain resource rather than recursed into, so its page is never imported.
        const innermost = await createZipBuffer({ "Buried 386c5eca1b8b80439520cad27a0d2749.html": pageHtml("Buried page") });
        const middle = await createZipBuffer({ "Export-Part-1.zip": innermost });
        const outer = await createZipBuffer({ "Export.zip": middle });
        const importRoot = await importNotion({ "Outer.zip": outer });

        expect(importRoot.getChildNotes().map((note) => note.title)).not.toContain("Buried page");
    });

    it("skips an explicit directory entry in the zip", async () => {
        const archive = new ZipArchive();
        const chunks: Buffer[] = [];
        const passthrough = new PassThrough();
        passthrough.on("data", (chunk: Buffer) => chunks.push(chunk));
        archive.pipe(passthrough);
        archive.append(Buffer.alloc(0), { name: "Folder/" });
        archive.append(pageHtml("Inside", "2c6c5eca1b8b80f7b9eaf4f396b755dc"), { name: "Folder/Inside 2c6c5eca1b8b80f7b9eaf4f396b755dc.html" });
        await archive.finalize();
        const buffer = Buffer.concat(chunks);

        const taskContext = TaskContext.getInstance("notion-dir-entry", "importNotes", { safeImport: true });
        const importRoot = await new Promise<BNote>((resolve, reject) => {
            void getContext().init(async () => {
                try {
                    resolve(await notionImporter.importNotion(taskContext, new Uint8Array(buffer), getBecca().getNoteOrThrow("root")));
                } catch (e) {
                    reject(e);
                }
            });
        });

        // The directory entry is skipped; only the real page is imported.
        expect(importRoot.getChildNotes().map((note) => note.title)).toEqual(["Inside"]);
    });

    it("skips index.html without creating a note for it", async () => {
        const importRoot = await importNotion({
            "index.html": `<html><head><title>Index</title></head><body><div id="386c5eca1b8b80439520cad27a0d2749"><div class="page-body"><p>toc</p></div></div></body></html>`,
            "Real page 2c6c5eca1b8b80f7b9eaf4f396b755dc.html": pageHtml("Real page", "2c6c5eca1b8b80f7b9eaf4f396b755dc")
        });

        expect(importRoot.getChildNotes().map((note) => note.title)).toEqual(["Real page"]);
    });

    it("drops a page with no resolvable id (no body id, no id in filename)", async () => {
        const importRoot = await importNotion({
            "Notes.html": `<html><head><title>Notes</title></head><body><div class="page"><div class="page-body"><p>x</p></div></div></body></html>`,
            "Real page 2c6c5eca1b8b80f7b9eaf4f396b755dc.html": pageHtml("Real page", "2c6c5eca1b8b80f7b9eaf4f396b755dc")
        });

        expect(importRoot.getChildNotes().map((note) => note.title)).toEqual(["Real page"]);
    });

    it("falls back to the filename for the title when the page has no <title> tag", async () => {
        const importRoot = await importNotion({
            "My filename title 2c6c5eca1b8b80f7b9eaf4f396b755dc.html":
                `<html><head></head><body><div id="2c6c5eca1b8b80f7b9eaf4f396b755dc"><div class="page-body"><p>x</p></div></div></body></html>`
        });

        expect(importRoot.getChildNotes().map((note) => note.title)).toEqual(["My filename title"]);
    });

    it("falls back to 'Untitled' when there is no <title> and the filename is only an id", async () => {
        const importRoot = await importNotion({
            "2c6c5eca1b8b80f7b9eaf4f396b755dc.html":
                `<html><head></head><body><div id="2c6c5eca1b8b80f7b9eaf4f396b755dc"><div class="page-body"><p>x</p></div></div></body></html>`
        });

        expect(importRoot.getChildNotes().map((note) => note.title)).toEqual(["Untitled"]);
    });

    it("imports an empty content note when the page has no .page-body", async () => {
        const importRoot = await importNotion({
            "Empty 2c6c5eca1b8b80f7b9eaf4f396b755dc.html":
                `<html><head><title>Empty</title></head><body><div id="2c6c5eca1b8b80f7b9eaf4f396b755dc"><p>no page-body wrapper</p></div></body></html>`
        });

        const empty = importRoot.getChildNotes().find((note) => note.title === "Empty");
        expect(empty?.getContent()).toBe("");
    });

    it("rewrites a cross-page link to the linked note as a reference link", async () => {
        const idA = "11111111111111111111111111111111";
        const idB = "22222222222222222222222222222222";
        const importRoot = await importNotion({
            [`Page A ${idA}.html`]:
                `<html><head><title>Page A</title></head><body><div id="${idA}"><div class="page-body"><p><a href="Page B ${idB}.html">Page B</a></p></div></div></body></html>`,
            [`Page B ${idB}.html`]: pageHtml("Page B", idB)
        });

        const pageA = importRoot.getChildNotes().find((note) => note.title === "Page A");
        const pageB = importRoot.getChildNotes().find((note) => note.title === "Page B");
        if (!pageA || !pageB) {
            throw new Error("expected both pages imported");
        }
        expect(pageA.getContent()).toContain(`href="#root/${pageB.noteId}"`);
        expect(pageA.getContent()).toContain(`class="reference-link"`);
    });

    it("leaves a cross-page link to a page that wasn't imported untouched", async () => {
        const idA = "11111111111111111111111111111111";
        const missingId = "99999999999999999999999999999999";
        const importRoot = await importNotion({
            [`Page A ${idA}.html`]:
                `<html><head><title>Page A</title></head><body><div id="${idA}"><div class="page-body"><p><a href="Ghost ${missingId}.html">Ghost</a></p></div></div></body></html>`
        });

        const pageA = importRoot.getChildNotes().find((note) => note.title === "Page A");
        expect(pageA?.getContent()).toContain(`href="Ghost ${missingId}.html"`);
    });

    it("applies a page's single timestamp to both created and modified dates", async () => {
        const id = "2c6c5eca1b8b80f7b9eaf4f396b755dc";
        // Only a created_time row is present; the modified date should fall back to it.
        const propertyTable =
            `<table class="properties"><tbody>` +
            `<tr class="property-row property-row-created_time"><th>Created</th><td><time>2024-01-02T03:04:05Z</time></td></tr>` +
            `</tbody></table>`;
        const importRoot = await importNotion({
            "OneDate 2c6c5eca1b8b80f7b9eaf4f396b755dc.html":
                `<html><head><title>OneDate</title></head><body><div id="${id}">${propertyTable}<div class="page-body"><p>x</p></div></div></body></html>`
        });

        const note = importRoot.getChildNotes().find((n) => n.title === "OneDate");
        expect(note?.utcDateCreated).toBe("2024-01-02 03:04:05.000Z");
        expect(note?.utcDateModified).toBe("2024-01-02 03:04:05.000Z");
    });

    it("uses a page's only last-edited timestamp for its creation date too", async () => {
        const id = "2c6c5eca1b8b80f7b9eaf4f396b755dc";
        // Only a last_edited_time row is present; the created date should fall back to it.
        const propertyTable =
            `<table class="properties"><tbody>` +
            `<tr class="property-row property-row-last_edited_time"><th>Edited</th><td><time>2024-05-06T07:08:09Z</time></td></tr>` +
            `</tbody></table>`;
        const importRoot = await importNotion({
            "EditedOnly 2c6c5eca1b8b80f7b9eaf4f396b755dc.html":
                `<html><head><title>EditedOnly</title></head><body><div id="${id}">${propertyTable}<div class="page-body"><p>x</p></div></div></body></html>`
        });

        const note = importRoot.getChildNotes().find((n) => n.title === "EditedOnly");
        expect(note?.utcDateCreated).toBe("2024-05-06 07:08:09.000Z");
        expect(note?.utcDateModified).toBe("2024-05-06 07:08:09.000Z");
    });

    it("falls back to the file basename for an attachment anchor that has no href", async () => {
        const id = "2c6c5eca1b8b80f7b9eaf4f396b755dc";
        // The converter marks any <figure><div class="source"><a>…</a> as a notion-attachment, even when
        // the anchor carries no href; the importer then resolves an empty path (no bundled file).
        const figure = `<figure id="aaa"><div class="source"><a>orphan</a></div></figure>`;
        const importRoot = await importNotion({
            "NoHref 2c6c5eca1b8b80f7b9eaf4f396b755dc.html":
                `<html><head><title>NoHref</title></head><body><div id="${id}"><div class="page-body"><div style="display:contents" dir="ltr">${figure}</div></div></div></body></html>`
        });

        const note = importRoot.getChildNotes().find((n) => n.title === "NoHref");
        // No bundled file resolved, so the anchor loses its marker class and stays a plain link.
        expect(note?.getContent()).not.toContain("notion-attachment");
        expect(note?.getAttachmentsByRole("file")).toHaveLength(0);
    });

    it("preserves Notion's created/last-edited timestamps from the property table", async () => {
        const id = "2c6c5eca1b8b80f7b9eaf4f396b755dc";
        const propertyTable =
            `<table class="properties"><tbody>` +
            `<tr class="property-row property-row-created_time"><th>Created</th><td><time>2024-01-02T03:04:05Z</time></td></tr>` +
            `<tr class="property-row property-row-last_edited_time"><th>Edited</th><td><time>2024-05-06T07:08:09Z</time></td></tr>` +
            `</tbody></table>`;
        const importRoot = await importNotion({
            "Dated 2c6c5eca1b8b80f7b9eaf4f396b755dc.html":
                `<html><head><title>Dated</title></head><body><div id="${id}">${propertyTable}<div class="page-body"><p>x</p></div></div></body></html>`
        });

        const dated = importRoot.getChildNotes().find((note) => note.title === "Dated");
        expect(dated?.utcDateCreated).toBe("2024-01-02 03:04:05.000Z");
        expect(dated?.utcDateModified).toBe("2024-05-06 07:08:09.000Z");
    });

    it("ignores property-row dates that are blank or unparseable", async () => {
        const id = "2c6c5eca1b8b80f7b9eaf4f396b755dc";
        const propertyTable =
            `<table class="properties"><tbody>` +
            `<tr class="property-row property-row-created_time"><th>Created</th><td><time></time></td></tr>` +
            `<tr class="property-row property-row-last_edited_time"><th>Edited</th><td><time>not a date</time></td></tr>` +
            `</tbody></table>`;
        const importRoot = await importNotion({
            "Undated 2c6c5eca1b8b80f7b9eaf4f396b755dc.html":
                `<html><head><title>Undated</title></head><body><div id="${id}">${propertyTable}<div class="page-body"><p>x</p></div></div></body></html>`
        });

        // No timestamps were applied, so the note keeps a fresh (recent) creation date, not 2024.
        const undated = importRoot.getChildNotes().find((note) => note.title === "Undated");
        expect(undated?.utcDateCreated.startsWith("2024-01-02")).toBe(false);
    });

    it("imports a page's text property as a Trilium label", async () => {
        const id = "2c6c5eca1b8b80f7b9eaf4f396b755dc";
        // Real Notion markup: the <th> leads with an icon span (no text) before the column name.
        const propertyTable =
            `<table class="properties"><tbody>` +
            `<tr class="property-row property-row-text"><th><span class="icon property-icon"><img src="x.svg"/></span>Text column</th><td>Basic text</td></tr>` +
            `</tbody></table>`;
        const importRoot = await importNotion({
            "Texty 2c6c5eca1b8b80f7b9eaf4f396b755dc.html":
                `<html><head><title>Texty</title></head><body><div id="${id}">${propertyTable}<div class="page-body"><p>x</p></div></div></body></html>`
        });

        const note = importRoot.getChildNotes().find((n) => n.title === "Texty");
        // The column name is sanitized (space → underscore, case preserved); the value is kept verbatim.
        expect(note?.getOwnedLabelValue("textColumn")).toBe("Basic text");
    });

    it("derives a camelCase attribute name from a text property's name and skips blank values", async () => {
        const id = "2c6c5eca1b8b80f7b9eaf4f396b755dc";
        const propertyTable =
            `<table class="properties"><tbody>` +
            `<tr class="property-row property-row-text"><th>Sub-title (v2)</th><td>Hello world</td></tr>` +
            `<tr class="property-row property-row-text"><th>Empty</th><td></td></tr>` +
            `</tbody></table>`;
        const importRoot = await importNotion({
            "Mixed 2c6c5eca1b8b80f7b9eaf4f396b755dc.html":
                `<html><head><title>Mixed</title></head><body><div id="${id}">${propertyTable}<div class="page-body"><p>x</p></div></div></body></html>`
        });

        const note = importRoot.getChildNotes().find((n) => n.title === "Mixed");
        // The name is split into alphanumeric words and camelCased: "Sub-title (v2)" → "subTitleV2".
        expect(note?.getOwnedLabelValue("subTitleV2")).toBe("Hello world");
        // The blank-valued row contributes no label.
        expect(note?.hasOwnedLabel("empty")).toBe(false);
    });

    it("defines text columns as inheritable promoted attributes on the container, inherited by every row", async () => {
        const dbId = "388c5eca1b8b8078a20fd18330d81306";
        const fooId = "388c5eca1b8b80929a78da7c68154bd7";
        const barId = "388c5eca1b8b80e5903ef480b0523eb1";
        const props = (rows: string) => `<table class="properties"><tbody>${rows}</tbody></table>`;
        const importRoot = await importNotion({
            "My DB 388c5eca1b8b8078a20fd18330d81306.html":
                `<html><head><title>My DB</title></head><body><div id="${dbId}"><div class="page-body"></div></div></body></html>`,
            "My DB/Foo 388c5eca1b8b80929a78da7c68154bd7.html":
                `<html><head><title>Foo</title></head><body><div id="${fooId}">${props(`<tr class="property-row property-row-text"><th><span class="icon property-icon"><img src="x.svg"/></span>Text column</th><td>Basic text</td></tr>`)}<div class="page-body"><p>x</p></div></div></body></html>`,
            "My DB/Bar 388c5eca1b8b80e5903ef480b0523eb1.html":
                `<html><head><title>Bar</title></head><body><div id="${barId}">${props(`<tr class="property-row property-row-text"><th>Other note</th><td>Hi</td></tr>`)}<div class="page-body"><p>y</p></div></div></body></html>`
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "My DB");
        // The container owns one inheritable definition per column seen across all rows (the schema union).
        const textDef = db?.getOwnedLabel("label:textColumn");
        expect(textDef?.value).toBe("promoted,single,text,alias=Text column");
        expect(textDef?.isInheritable).toBe(true);
        expect(db?.getOwnedLabel("label:otherNote")?.value).toBe("promoted,single,text,alias=Other note");

        const foo = db?.getChildNotes().find((n) => n.title === "Foo");
        const bar = db?.getChildNotes().find((n) => n.title === "Bar");
        // Each row inherits the whole schema (including a column it has no value for) without owning a copy.
        expect(foo?.getOwnedLabel("label:otherNote")).toBeNull();
        expect(foo?.getLabelValue("label:otherNote")).toBe("promoted,single,text,alias=Other note");
        // Only the row that had the value owns it; the other inherits an empty field.
        expect(foo?.getOwnedLabelValue("textColumn")).toBe("Basic text");
        expect(foo?.getOwnedLabelValue("otherNote")).toBeNull();
        expect(bar?.getOwnedLabelValue("otherNote")).toBe("Hi");
        expect(bar?.getOwnedLabelValue("textColumn")).toBeNull();
    });

    it("imports a multi-select column as multi-valued labels with a `multi` definition", async () => {
        const dbId = "388c5eca1b8b8078a20fd18330d81306";
        const fullId = "388c5eca1b8b80929a78da7c68154bd7";
        const emptyId = "388c5eca1b8b80e5903ef480b0523eb1";
        // Real markup: one <span class="selected-value"> per option; an unset multi-select is an empty <td>.
        const multi = (options: string) =>
            `<table class="properties"><tbody><tr class="property-row property-row-multi_select"><th><span class="icon property-icon"><img src="x.svg"/></span>Multi-select</th><td>${options}</td></tr></tbody></table>`;
        const importRoot = await importNotion({
            "DB 388c5eca1b8b8078a20fd18330d81306.html":
                `<html><head><title>DB</title></head><body><div id="${dbId}"><div class="page-body"></div></div></body></html>`,
            "DB/Full 388c5eca1b8b80929a78da7c68154bd7.html":
                `<html><head><title>Full</title></head><body><div id="${fullId}">${multi(`<span class="selected-value">c</span><span class="selected-value">d</span><span class="selected-value">e</span>`)}<div class="page-body"><p>x</p></div></div></body></html>`,
            "DB/Empty 388c5eca1b8b80e5903ef480b0523eb1.html":
                `<html><head><title>Empty</title></head><body><div id="${emptyId}">${multi("")}<div class="page-body"><p>y</p></div></div></body></html>`
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "DB");
        // The column is defined once on the container as a multi-valued promoted attribute.
        expect(db?.getOwnedLabel("label:multiSelect")?.value).toBe("promoted,multi,text,alias=Multi-select");

        const full = db?.getChildNotes().find((n) => n.title === "Full");
        const empty = db?.getChildNotes().find((n) => n.title === "Empty");
        // Each selected option becomes its own label, preserving order.
        expect(full?.getOwnedLabels("multiSelect").map((l) => l.value)).toEqual(["c", "d", "e"]);
        // An unset multi-select contributes no value labels, but still inherits the (multi) definition.
        expect(empty?.getOwnedLabels("multiSelect")).toHaveLength(0);
        expect(empty?.getLabelValue("label:multiSelect")).toBe("promoted,multi,text,alias=Multi-select");
    });

    it("imports a select column as a single-valued text label", async () => {
        const dbId = "388c5eca1b8b8078a20fd18330d81306";
        const rowId = "388c5eca1b8b80929a78da7c68154bd7";
        // Notion renders a single-select value as one <span class="selected-value"> in the cell.
        const props = `<table class="properties"><tbody><tr class="property-row property-row-select"><th><span class="icon property-icon"><img src="x.svg"/></span>Select column</th><td><span class="selected-value select-value-color-gray">First</span></td></tr></tbody></table>`;
        const importRoot = await importNotion({
            "DB 388c5eca1b8b8078a20fd18330d81306.html":
                `<html><head><title>DB</title></head><body><div id="${dbId}"><div class="page-body"></div></div></body></html>`,
            "DB/Row 388c5eca1b8b80929a78da7c68154bd7.html":
                `<html><head><title>Row</title></head><body><div id="${rowId}">${props}<div class="page-body"><p>x</p></div></div></body></html>`
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "DB");
        expect(db?.getOwnedLabel("label:selectColumn")?.value).toBe("promoted,single,text,alias=Select column");
        const row = db?.getChildNotes().find((n) => n.title === "Row");
        expect(row?.getOwnedLabelValue("selectColumn")).toBe("First");
    });

    it("imports a status column as a single-valued text label", async () => {
        const dbId = "388c5eca1b8b8078a20fd18330d81306";
        const rowId = "388c5eca1b8b80929a78da7c68154bd7";
        // A status value sits in a <span class="status-value"> after an empty <div class="status-dot">.
        const props = `<table class="properties"><tbody><tr class="property-row property-row-status"><th><span class="icon property-icon"><img src="x.svg"/></span>Status column</th><td><span class="status-value select-value-color-blue"><div class="status-dot status-dot-color-blue"></div>Another in progress</span></td></tr></tbody></table>`;
        const importRoot = await importNotion({
            "DB 388c5eca1b8b8078a20fd18330d81306.html":
                `<html><head><title>DB</title></head><body><div id="${dbId}"><div class="page-body"></div></div></body></html>`,
            "DB/Row 388c5eca1b8b80929a78da7c68154bd7.html":
                `<html><head><title>Row</title></head><body><div id="${rowId}">${props}<div class="page-body"><p>x</p></div></div></body></html>`
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "DB");
        expect(db?.getOwnedLabel("label:statusColumn")?.value).toBe("promoted,single,text,alias=Status column");
        const row = db?.getChildNotes().find((n) => n.title === "Row");
        expect(row?.getOwnedLabelValue("statusColumn")).toBe("Another in progress");
    });

    it("imports number columns as number-typed labels, normalizing formatted values and inheriting the schema", async () => {
        const dbId = "388c5eca1b8b8078a20fd18330d81306";
        const firstId = "388c5eca1b8b80929a78da7c68154bd7";
        const secondId = "388c5eca1b8b80deb7f9ede99b0b2036";
        // A number cell holds the *formatted* display (commas, currency, percent), which the importer
        // normalizes to a bare number. Notion drops the property row entirely when a number is empty, so
        // "Second" carries no number rows at all — yet still inherits the column definitions from the container.
        const numberRows =
            `<tr class="property-row property-row-number"><th><span class="icon property-icon"><img src="x.svg"/></span>A</th><td>12</td></tr>` +
            `<tr class="property-row property-row-number"><th>B</th><td>$1,200.50</td></tr>` +
            `<tr class="property-row property-row-number"><th>C</th><td>25%</td></tr>`;
        const props = `<table class="properties"><tbody>${numberRows}</tbody></table>`;
        const importRoot = await importNotion({
            "DB 388c5eca1b8b8078a20fd18330d81306.html":
                `<html><head><title>DB</title></head><body><div id="${dbId}"><div class="page-body"></div></div></body></html>`,
            "DB/First 388c5eca1b8b80929a78da7c68154bd7.html":
                `<html><head><title>First</title></head><body><div id="${firstId}">${props}<div class="page-body"><p>x</p></div></div></body></html>`,
            "DB/Second 388c5eca1b8b80deb7f9ede99b0b2036.html":
                `<html><head><title>Second</title></head><body><div id="${secondId}"><div class="page-body"><p>y</p></div></div></body></html>`
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "DB");
        expect(db?.getOwnedLabel("label:a")?.value).toBe("promoted,single,number,alias=A");
        expect(db?.getOwnedLabel("label:b")?.value).toBe("promoted,single,number,alias=B");

        const first = db?.getChildNotes().find((n) => n.title === "First");
        expect(first?.getOwnedLabelValue("a")).toBe("12");
        expect(first?.getOwnedLabelValue("b")).toBe("1200.50"); // "$1,200.50" → bare number
        expect(first?.getOwnedLabelValue("c")).toBe("25"); // "25%" → bare number

        // "Second" has no number values of its own, but inherits the column definitions from the container.
        const second = db?.getChildNotes().find((n) => n.title === "Second");
        expect(second?.getOwnedLabelValue("a")).toBeNull();
        expect(second?.getLabelValue("label:a")).toBe("promoted,single,number,alias=A");
    });

    it("imports an auto-increment ID column as a number label, keeping a prefixed ID as text", async () => {
        const dbId = "388c5eca1b8b8078a20fd18330d81306";
        const rowId = "388c5eca1b8b80929a78da7c68154bd7";
        // Notion's ID is an integer counter (a bare number), but a configured prefix turns it into an
        // identifier like "TASK-1" that must stay verbatim. Both render as a property-row-auto_increment_id.
        const rows =
            `<tr class="property-row property-row-auto_increment_id"><th><span class="icon property-icon"><img src="x.svg"/></span>ID</th><td>1</td></tr>` +
            `<tr class="property-row property-row-auto_increment_id"><th>Key</th><td>TASK-1</td></tr>`;
        const props = `<table class="properties"><tbody>${rows}</tbody></table>`;
        const importRoot = await importNotion({
            "DB 388c5eca1b8b8078a20fd18330d81306.html":
                `<html><head><title>DB</title></head><body><div id="${dbId}"><div class="page-body"></div></div></body></html>`,
            "DB/Row 388c5eca1b8b80929a78da7c68154bd7.html":
                `<html><head><title>Row</title></head><body><div id="${rowId}">${props}<div class="page-body"><p>x</p></div></div></body></html>`
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "DB");
        expect(db?.getOwnedLabel("label:id")?.value).toBe("promoted,single,number,alias=ID");
        expect(db?.getOwnedLabel("label:key")?.value).toBe("promoted,single,text,alias=Key");
        const row = db?.getChildNotes().find((n) => n.title === "Row");
        expect(row?.getOwnedLabelValue("id")).toBe("1");
        expect(row?.getOwnedLabelValue("key")).toBe("TASK-1");
    });

    it("imports a formula column by its rendered shape: number, boolean (checkbox), or text (incl. a date formula)", async () => {
        const dbId = "388c5eca1b8b8078a20fd18330d81306";
        const rowId = "388c5eca1b8b80929a78da7c68154bd7";
        // A formula has no type signal on the row — Notion renders the computed value with the matching widget.
        // A number stays bare text, a boolean is a checkbox, and a date renders as plain text (no <time> wrapper).
        const rows =
            `<tr class="property-row property-row-formula"><th><span class="icon property-icon"><img src="x.svg"/></span>Number formula</th><td>15</td></tr>` +
            `<tr class="property-row property-row-formula"><th>Bool formula</th><td><div class="checkbox checkbox-on"></div></td></tr>` +
            `<tr class="property-row property-row-formula"><th>Date formula</th><td>June 24, 2026</td></tr>`;
        const props = `<table class="properties"><tbody>${rows}</tbody></table>`;
        const importRoot = await importNotion({
            "DB 388c5eca1b8b8078a20fd18330d81306.html":
                `<html><head><title>DB</title></head><body><div id="${dbId}"><div class="page-body"></div></div></body></html>`,
            "DB/Row 388c5eca1b8b80929a78da7c68154bd7.html":
                `<html><head><title>Row</title></head><body><div id="${rowId}">${props}<div class="page-body"><p>x</p></div></div></body></html>`
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "DB");
        expect(db?.getOwnedLabel("label:numberFormula")?.value).toBe("promoted,single,number,alias=Number formula");
        expect(db?.getOwnedLabel("label:boolFormula")?.value).toBe("promoted,single,boolean,alias=Bool formula");
        expect(db?.getOwnedLabel("label:dateFormula")?.value).toBe("promoted,single,text,alias=Date formula");
        const row = db?.getChildNotes().find((n) => n.title === "Row");
        expect(row?.getOwnedLabelValue("numberFormula")).toBe("15");
        expect(row?.getOwnedLabelValue("boolFormula")).toBe("true");
        expect(row?.getOwnedLabelValue("dateFormula")).toBe("June 24, 2026");
    });

    it("imports a rollup column by its rendered shape, like a formula (text title, numeric aggregate)", async () => {
        const dbId = "388c5eca1b8b8078a20fd18330d81306";
        const rowId = "388c5eca1b8b80929a78da7c68154bd7";
        // A rollup is computed and untyped on the row (property-row-rollup); a relation-title rollup is plain
        // text, a count/sum aggregate is a bare number — inferred from the cell shape, same as a formula.
        const rows =
            `<tr class="property-row property-row-rollup"><th><span class="icon property-icon"><img src="x.svg"/></span>Titles</th><td>First</td></tr>` +
            `<tr class="property-row property-row-rollup"><th>Count</th><td>2</td></tr>`;
        const props = `<table class="properties"><tbody>${rows}</tbody></table>`;
        const importRoot = await importNotion({
            "DB 388c5eca1b8b8078a20fd18330d81306.html":
                `<html><head><title>DB</title></head><body><div id="${dbId}"><div class="page-body"></div></div></body></html>`,
            "DB/Row 388c5eca1b8b80929a78da7c68154bd7.html":
                `<html><head><title>Row</title></head><body><div id="${rowId}">${props}<div class="page-body"><p>x</p></div></div></body></html>`
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "DB");
        expect(db?.getOwnedLabel("label:titles")?.value).toBe("promoted,single,text,alias=Titles");
        expect(db?.getOwnedLabel("label:count")?.value).toBe("promoted,single,number,alias=Count");
        const row = db?.getChildNotes().find((n) => n.title === "Row");
        expect(row?.getOwnedLabelValue("titles")).toBe("First");
        expect(row?.getOwnedLabelValue("count")).toBe("2");
    });

    it("imports created-by and last-edited-by as single-valued text labels of the user name", async () => {
        const dbId = "388c5eca1b8b8078a20fd18330d81306";
        const rowId = "388c5eca1b8b80929a78da7c68154bd7";
        // Both render like a person cell: a <span class="user"> with a leading avatar (an initial) to strip.
        const user = `<span class="user"><span class="icon text-icon user-icon"><span class="user-icon-inner">E</span></span>Elian Doran</span>`;
        const rows =
            `<tr class="property-row property-row-created_by"><th><span class="icon property-icon"><img src="x.svg"/></span>Created by</th><td>${user}</td></tr>` +
            `<tr class="property-row property-row-last_edited_by"><th>Last edited by</th><td>${user}</td></tr>`;
        const props = `<table class="properties"><tbody>${rows}</tbody></table>`;
        const importRoot = await importNotion({
            "DB 388c5eca1b8b8078a20fd18330d81306.html":
                `<html><head><title>DB</title></head><body><div id="${dbId}"><div class="page-body"></div></div></body></html>`,
            "DB/Row 388c5eca1b8b80929a78da7c68154bd7.html":
                `<html><head><title>Row</title></head><body><div id="${rowId}">${props}<div class="page-body"><p>x</p></div></div></body></html>`
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "DB");
        expect(db?.getOwnedLabel("label:createdBy")?.value).toBe("promoted,single,text,alias=Created by");
        expect(db?.getOwnedLabel("label:lastEditedBy")?.value).toBe("promoted,single,text,alias=Last edited by");
        const row = db?.getChildNotes().find((n) => n.title === "Row");
        expect(row?.getOwnedLabelValue("createdBy")).toBe("Elian Doran");
        expect(row?.getOwnedLabelValue("lastEditedBy")).toBe("Elian Doran");
    });

    it("imports url, email and phone columns as url-typed labels (mailto:/tel: schemes)", async () => {
        const dbId = "388c5eca1b8b8078a20fd18330d81306";
        const rowId = "388c5eca1b8b80929a78da7c68154bd7";
        // All three render as <a class="url-value">; email/phone hrefs are bare addresses.
        const props =
            `<table class="properties"><tbody>` +
            `<tr class="property-row property-row-url"><th><span class="icon property-icon"><img src="x.svg"/></span>URL</th><td><a href="https://triliumnotes.org" class="url-value">https://triliumnotes.org</a></td></tr>` +
            `<tr class="property-row property-row-email"><th><span class="icon property-icon"><img src="y.svg"/></span>Email</th><td><a href="test@acme.org" class="url-value">test@acme.org</a></td></tr>` +
            `<tr class="property-row property-row-phone_number"><th><span class="icon property-icon"><img src="z.svg"/></span>Phone</th><td><a href="12345678" class="url-value">12345678</a></td></tr>` +
            `</tbody></table>`;
        const importRoot = await importNotion({
            "DB 388c5eca1b8b8078a20fd18330d81306.html":
                `<html><head><title>DB</title></head><body><div id="${dbId}"><div class="page-body"></div></div></body></html>`,
            "DB/Row 388c5eca1b8b80929a78da7c68154bd7.html":
                `<html><head><title>Row</title></head><body><div id="${rowId}">${props}<div class="page-body"><p>x</p></div></div></body></html>`
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "DB");
        // Each column gets a url-typed definition.
        expect(db?.getOwnedLabel("label:url")?.value).toBe("promoted,single,url,alias=URL");
        expect(db?.getOwnedLabel("label:email")?.value).toBe("promoted,single,url,alias=Email");
        expect(db?.getOwnedLabel("label:phone")?.value).toBe("promoted,single,url,alias=Phone");

        const row = db?.getChildNotes().find((n) => n.title === "Row");
        expect(row?.getOwnedLabelValue("url")).toBe("https://triliumnotes.org");
        // Email/phone are stored as clickable mailto:/tel: links.
        expect(row?.getOwnedLabelValue("email")).toBe("mailto:test@acme.org");
        expect(row?.getOwnedLabelValue("phone")).toBe("tel:12345678");
    });

    it("imports a dated column with a clock time as a datetime label", async () => {
        const dbId = "388c5eca1b8b8078a20fd18330d81306";
        const rowId = "388c5eca1b8b80929a78da7c68154bd7";
        const props = `<table class="properties"><tbody><tr class="property-row property-row-date"><th><span class="icon property-icon"><img src="x.svg"/></span>Date</th><td><time>June 23, 2026 7:00 PM</time></td></tr></tbody></table>`;
        const importRoot = await importNotion({
            "DB 388c5eca1b8b8078a20fd18330d81306.html":
                `<html><head><title>DB</title></head><body><div id="${dbId}"><div class="page-body"></div></div></body></html>`,
            "DB/Row 388c5eca1b8b80929a78da7c68154bd7.html":
                `<html><head><title>Row</title></head><body><div id="${rowId}">${props}<div class="page-body"><p>x</p></div></div></body></html>`
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "DB");
        expect(db?.getOwnedLabel("label:date")?.value).toBe("promoted,single,datetime,alias=Date");
        const row = db?.getChildNotes().find((n) => n.title === "Row");
        // Local datetime-local format; "7:00 PM" → 19:00 (parse-local + format-local is timezone-independent).
        expect(row?.getOwnedLabelValue("date")).toBe("2026-06-23T19:00");
    });

    it("splits a timeless date range into separate start and end date columns", async () => {
        const dbId = "388c5eca1b8b8078a20fd18330d81306";
        const rowId = "388c5eca1b8b80929a78da7c68154bd7";
        // A date range joins start and end with an arrow (U+2192).
        const props = `<table class="properties"><tbody><tr class="property-row property-row-date"><th><span class="icon property-icon"><img src="x.svg"/></span>Date</th><td><time>June 24, 2026 → June 30, 2026</time></td></tr></tbody></table>`;
        const importRoot = await importNotion({
            "DB 388c5eca1b8b8078a20fd18330d81306.html":
                `<html><head><title>DB</title></head><body><div id="${dbId}"><div class="page-body"></div></div></body></html>`,
            "DB/Row 388c5eca1b8b80929a78da7c68154bd7.html":
                `<html><head><title>Row</title></head><body><div id="${rowId}">${props}<div class="page-body"><p>x</p></div></div></body></html>`
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "DB");
        // The range becomes two date columns: the original (start) and a separate "<name> end".
        expect(db?.getOwnedLabel("label:date")?.value).toBe("promoted,single,date,alias=Date");
        expect(db?.getOwnedLabel("label:dateEnd")?.value).toBe("promoted,single,date,alias=Date end");
        const row = db?.getChildNotes().find((n) => n.title === "Row");
        expect(row?.getOwnedLabelValue("date")).toBe("2026-06-24");
        expect(row?.getOwnedLabelValue("dateEnd")).toBe("2026-06-30");
    });

    it("normalizes a date column that mixes dates and date-times to datetime", async () => {
        const dbId = "388c5eca1b8b8078a20fd18330d81306";
        const withTimeId = "388c5eca1b8b80929a78da7c68154bd7";
        const noTimeId = "388c5eca1b8b80e5903ef480b0523eb1";
        const dateRow = (time: string) =>
            `<table class="properties"><tbody><tr class="property-row property-row-date"><th><span class="icon property-icon"><img src="x.svg"/></span>Date</th><td><time>${time}</time></td></tr></tbody></table>`;
        const importRoot = await importNotion({
            "DB 388c5eca1b8b8078a20fd18330d81306.html":
                `<html><head><title>DB</title></head><body><div id="${dbId}"><div class="page-body"></div></div></body></html>`,
            "DB/WithTime 388c5eca1b8b80929a78da7c68154bd7.html":
                `<html><head><title>WithTime</title></head><body><div id="${withTimeId}">${dateRow("June 23, 2026 7:00 PM")}<div class="page-body"><p>x</p></div></div></body></html>`,
            "DB/NoTime 388c5eca1b8b80e5903ef480b0523eb1.html":
                `<html><head><title>NoTime</title></head><body><div id="${noTimeId}">${dateRow("June 24, 2026")}<div class="page-body"><p>y</p></div></div></body></html>`
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "DB");
        // One row uses a time, so the whole column becomes datetime.
        expect(db?.getOwnedLabel("label:date")?.value).toBe("promoted,single,datetime,alias=Date");
        const withTime = db?.getChildNotes().find((n) => n.title === "WithTime");
        const noTime = db?.getChildNotes().find((n) => n.title === "NoTime");
        expect(withTime?.getOwnedLabelValue("date")).toBe("2026-06-23T19:00");
        // The time-less value is normalized to midnight so it stays valid for the datetime-local input.
        expect(noTime?.getOwnedLabelValue("date")).toBe("2026-06-24T00:00");
    });

    it("orders the promoted definitions by the CSV column order, not row discovery order", async () => {
        // The CSV header is the authoritative column order: Zeta, Alpha, Mu (with stray padding around some
        // names, which must be trimmed to match the trimmed HTML property headers).
        const csv = "Name, Zeta , Alpha,Mu\nRow1,,a,m\nRow2,z,,\n";
        const row1Id = "388c5eca1b8b80929a78da7c68154bd7";
        const row2Id = "388c5eca1b8b80e5903ef480b0523eb1";
        const textCol = (col: string, val: string) => `<tr class="property-row property-row-text"><th>${col}</th><td>${val}</td></tr>`;
        const props = (rows: string) => `<table class="properties"><tbody>${rows}</tbody></table>`;
        const importRoot = await importNotion({
            "My DB 388c5eca1b8b8078a20fd18330d81306.csv": csv,
            // Row1 (discovered first) has Alpha + Mu but not Zeta; Row2 has Zeta.
            "My DB/Row1 388c5eca1b8b80929a78da7c68154bd7.html":
                `<html><head><title>Row1</title></head><body><div id="${row1Id}">${props(textCol("Alpha", "a") + textCol("Mu", "m"))}<div class="page-body"><p>x</p></div></div></body></html>`,
            "My DB/Row2 388c5eca1b8b80e5903ef480b0523eb1.html":
                `<html><head><title>Row2</title></head><body><div id="${row2Id}">${props(textCol("Zeta", "z"))}<div class="page-body"><p>y</p></div></div></body></html>`
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "My DB");
        const definitions = db?.getOwnedAttributes("label").filter((attr) => attr.name.startsWith("label:")) ?? [];
        // CSV order (Zeta, Alpha, Mu) wins, even though Alpha/Mu were discovered before Zeta.
        expect(definitions.map((attr) => attr.name)).toEqual(["label:zeta", "label:alpha", "label:mu"]);
        // Increasing positions keep that order in the promoted-attributes UI (which sorts defs by position).
        expect(definitions.map((attr) => attr.position)).toEqual([10, 20, 30]);
    });

    it("imports a checkbox column as a boolean label", async () => {
        const dbId = "388c5eca1b8b8078a20fd18330d81306";
        const onId = "388c5eca1b8b80929a78da7c68154bd7";
        const offId = "388c5eca1b8b80e5903ef480b0523eb1";
        // Notion renders a checkbox as <div class="checkbox checkbox-on|off">.
        const checkbox = (state: string) => `<table class="properties"><tbody><tr class="property-row property-row-checkbox"><th><span class="icon property-icon"><img src="x.svg"/></span>Checkbox</th><td><div class="checkbox checkbox-${state}"></div></td></tr></tbody></table>`;
        const importRoot = await importNotion({
            "DB 388c5eca1b8b8078a20fd18330d81306.html":
                `<html><head><title>DB</title></head><body><div id="${dbId}"><div class="page-body"></div></div></body></html>`,
            "DB/On 388c5eca1b8b80929a78da7c68154bd7.html":
                `<html><head><title>On</title></head><body><div id="${onId}">${checkbox("on")}<div class="page-body"><p>x</p></div></div></body></html>`,
            "DB/Off 388c5eca1b8b80e5903ef480b0523eb1.html":
                `<html><head><title>Off</title></head><body><div id="${offId}">${checkbox("off")}<div class="page-body"><p>y</p></div></div></body></html>`
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "DB");
        expect(db?.getOwnedLabel("label:checkbox")?.value).toBe("promoted,single,boolean,alias=Checkbox");
        const on = db?.getChildNotes().find((n) => n.title === "On");
        const off = db?.getChildNotes().find((n) => n.title === "Off");
        expect(on?.getOwnedLabelValue("checkbox")).toBe("true");
        expect(off?.getOwnedLabelValue("checkbox")).toBe("false");
    });

    it("imports a place column as a single-valued text label", async () => {
        const dbId = "388c5eca1b8b8078a20fd18330d81306";
        const rowId = "388c5eca1b8b80929a78da7c68154bd7";
        const props = `<table class="properties"><tbody><tr class="property-row property-row-place"><th><span class="icon property-icon"><img src="x.svg"/></span>Place</th><td>Rotterdam, South Holland, Netherlands</td></tr></tbody></table>`;
        const importRoot = await importNotion({
            "DB 388c5eca1b8b8078a20fd18330d81306.html":
                `<html><head><title>DB</title></head><body><div id="${dbId}"><div class="page-body"></div></div></body></html>`,
            "DB/Row 388c5eca1b8b80929a78da7c68154bd7.html":
                `<html><head><title>Row</title></head><body><div id="${rowId}">${props}<div class="page-body"><p>x</p></div></div></body></html>`
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "DB");
        expect(db?.getOwnedLabel("label:place")?.value).toBe("promoted,single,text,alias=Place");
        const row = db?.getChildNotes().find((n) => n.title === "Row");
        // The comma-bearing value is stored verbatim (it's a label value, not part of the definition).
        expect(row?.getOwnedLabelValue("place")).toBe("Rotterdam, South Holland, Netherlands");
    });

    it("imports a person column as multi-valued labels, stripping the avatar initial", async () => {
        const dbId = "388c5eca1b8b8078a20fd18330d81306";
        const rowId = "388c5eca1b8b80929a78da7c68154bd7";
        // Real markup: each person is a <span class="user"> whose .user-icon holds an avatar initial.
        const user = (initial: string, fullName: string) =>
            `<span class="user"><span class="icon text-icon user-icon"><span class="user-icon-inner">${initial}</span></span>${fullName}</span>`;
        const props = `<table class="properties"><tbody><tr class="property-row property-row-person"><th><span class="icon property-icon"><img src="x.svg"/></span>Person</th><td>${user("E", "Elian Doran")}, ${user("A", "Ada Lovelace")}</td></tr></tbody></table>`;
        const importRoot = await importNotion({
            "DB 388c5eca1b8b8078a20fd18330d81306.html":
                `<html><head><title>DB</title></head><body><div id="${dbId}"><div class="page-body"></div></div></body></html>`,
            "DB/Row 388c5eca1b8b80929a78da7c68154bd7.html":
                `<html><head><title>Row</title></head><body><div id="${rowId}">${props}<div class="page-body"><p>x</p></div></div></body></html>`
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "DB");
        expect(db?.getOwnedLabel("label:person")?.value).toBe("promoted,multi,text,alias=Person");
        const row = db?.getChildNotes().find((n) => n.title === "Row");
        // The avatar initials ("E", "A") are dropped, leaving just the names, one label per person.
        expect(row?.getOwnedLabels("person").map((l) => l.value)).toEqual(["Elian Doran", "Ada Lovelace"]);
    });

    it("maps a relation column to real Trilium relations, resolving links and dropping un-imported targets", async () => {
        const dbId = "388c5eca1b8b8078a20fd18330d81306";
        const fooId = "388c5eca1b8b80929a78da7c68154bd7";
        const barId = "388c5eca1b8b80e5903ef480b0523eb1";
        const bazId = "2c6c5eca1b8b80f7b9eaf4f396b755dc";
        const ghostId = "386c5eca1b8b80439520cad27a0d2749"; // referenced but not imported
        const link = (title: string, id: string) => `<a href="${title}%20${id}.html">${title}</a>`;
        const relation = (links: string) =>
            `<table class="properties"><tbody><tr class="property-row property-row-relation"><th><span class="icon property-icon"><img src="x.svg"/></span>Related</th><td>${links}</td></tr></tbody></table>`;
        const importRoot = await importNotion({
            "DB 388c5eca1b8b8078a20fd18330d81306.html":
                `<html><head><title>DB</title></head><body><div id="${dbId}"><div class="page-body"></div></div></body></html>`,
            // Foo → Bar, Baz and an un-imported Ghost; Bar → itself.
            [`DB/Foo ${fooId}.html`]:
                `<html><head><title>Foo</title></head><body><div id="${fooId}">${relation(`${link("Bar", barId)}, ${link("Baz", bazId)}, ${link("Ghost", ghostId)}`)}<div class="page-body"><p>x</p></div></div></body></html>`,
            [`DB/Bar ${barId}.html`]:
                `<html><head><title>Bar</title></head><body><div id="${barId}">${relation(link("Bar", barId))}<div class="page-body"><p>y</p></div></div></body></html>`,
            [`DB/Baz ${bazId}.html`]:
                `<html><head><title>Baz</title></head><body><div id="${bazId}"><div class="page-body"><p>z</p></div></div></body></html>`
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "DB");
        // A relation column becomes a `relation:` promoted definition (multi, and carrying no value type).
        expect(db?.getOwnedLabel("relation:related")?.value).toBe("promoted,multi,alias=Related");

        const foo = db?.getChildNotes().find((n) => n.title === "Foo");
        const bar = db?.getChildNotes().find((n) => n.title === "Bar");
        const baz = db?.getChildNotes().find((n) => n.title === "Baz");
        // Foo relates to the real Bar and Baz notes; the un-imported Ghost target is dropped.
        expect(foo?.getOwnedRelations("related").map((r) => r.value)).toEqual([bar?.noteId, baz?.noteId]);
        // A self-reference resolves to the note itself.
        expect(bar?.getOwnedRelations("related").map((r) => r.value)).toEqual([bar?.noteId]);
    });

    it("saves a file column's bundled files as role:file attachments, skipping external links and adding no definition", async () => {
        const dbId = "388c5eca1b8b8078a20fd18330d81306";
        const rowId = "388c5eca1b8b80929a78da7c68154bd7";
        // A file cell links a bundled file plus an external URL that isn't in the zip.
        const fileCell = `<table class="properties"><tbody><tr class="property-row property-row-file"><th><span class="icon property-icon"><img src="x.svg"/></span>Files &amp; media</th><td><span><a href="report.pdf">report.pdf</a></span><span><a href="https://example.com/external.pdf">external.pdf</a></span></td></tr></tbody></table>`;
        const importRoot = await importNotion({
            "DB 388c5eca1b8b8078a20fd18330d81306.html":
                `<html><head><title>DB</title></head><body><div id="${dbId}"><div class="page-body"></div></div></body></html>`,
            "DB/Row 388c5eca1b8b80929a78da7c68154bd7.html":
                `<html><head><title>Row</title></head><body><div id="${rowId}">${fileCell}<div class="page-body"><p>x</p></div></div></body></html>`,
            "DB/report.pdf": "%PDF-1.4 fake"
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "DB");
        const row = db?.getChildNotes().find((n) => n.title === "Row");
        // The bundled file becomes a role:file attachment; the external link (not in the zip) is skipped.
        const attachment = row?.getAttachmentsByRole("file").find((a) => a.title === "report.pdf");
        expect(row?.getAttachmentsByRole("file").map((a) => a.title)).toEqual(["report.pdf"]);
        // The bundled file is also a reference-link prepended before the original body; the external one,
        // having no attachment, contributes no link (so there's exactly one).
        const content = String(row?.getContent() ?? "");
        expect(content).toContain(`<a class="reference-link" href="#root/${row?.noteId}?viewMode=attachments&attachmentId=${attachment?.attachmentId}">report.pdf</a>`);
        expect(content.match(/reference-link/g)).toHaveLength(1);
        expect(content.indexOf("reference-link")).toBeLessThan(content.indexOf("<p>x</p>"));
        // A file column is content, not metadata — no promoted definition and no value label.
        expect(db?.getOwnedLabel("label:filesMedia")).toBeFalsy();
        expect(row?.getOwnedLabels("filesMedia")).toHaveLength(0);
    });

    it("neutralizes commas and control characters in a column name so the alias can't corrupt the definition", async () => {
        const dbId = "388c5eca1b8b8078a20fd18330d81306";
        const rowId = "388c5eca1b8b80929a78da7c68154bd7";
        // The name carries a comma and a newline — both would break the single-line, comma-delimited definition.
        const props = `<table class="properties"><tbody><tr class="property-row property-row-text"><th>Weight,\nkg</th><td>5</td></tr></tbody></table>`;
        const importRoot = await importNotion({
            "DB 388c5eca1b8b8078a20fd18330d81306.html":
                `<html><head><title>DB</title></head><body><div id="${dbId}"><div class="page-body"></div></div></body></html>`,
            "DB/Row 388c5eca1b8b80929a78da7c68154bd7.html":
                `<html><head><title>Row</title></head><body><div id="${rowId}">${props}<div class="page-body"><p>x</p></div></div></body></html>`
        });

        const db = importRoot.getChildNotes().find((n) => n.title === "DB");
        // Both the comma and the newline become spaces, so the definition stays one line of four tokens.
        expect(db?.getOwnedLabel("label:weightKg")?.value).toBe("promoted,single,text,alias=Weight  kg");
    });

    it("saves a bundled image as an attachment and rewrites its src; leaves external/srcless images alone", async () => {
        const id = "2c6c5eca1b8b80f7b9eaf4f396b755dc";
        const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const body =
            `<div class="page-body">` +
            `<figure class="image"><img src="pic.png"></figure>` +
            `<figure class="image"><img></figure>` +
            `<figure class="image"><img src="https://external/x.png"></figure>` +
            `</div>`;
        const importRoot = await importNotion({
            "Img 2c6c5eca1b8b80f7b9eaf4f396b755dc.html":
                `<html><head><title>Img</title></head><body><div id="${id}">${body}</div></body></html>`,
            "pic.png": pngBytes
        });

        const note = importRoot.getChildNotes().find((n) => n.title === "Img");
        if (!note) {
            throw new Error("expected 'Img' page imported");
        }
        const attachment = note.getAttachments().find((a) => a.role === "image");
        expect(attachment).toBeDefined();
        expect(note.getContent()).toContain("api/attachments/");
        expect(note.getContent()).toContain("https://external/x.png");
    });

    it("handles attachment edge cases: missing file, empty text, unknown extension", async () => {
        const id = "2c6c5eca1b8b80f7b9eaf4f396b755dc";
        // The converter turns <figure><div class="source"><a href=…>…</a></div></figure> into a
        // notion-attachment anchor. Three figures: a missing file, an empty-text anchor, an unknown ext.
        const figures =
            `<figure id="aaa"><div class="source"><a href="missing.bin">x</a></div></figure>` +
            `<figure id="bbb"><div class="source"><a href="empty.weird"></a></div></figure>` +
            `<figure id="ccc"><div class="source"><a href="data.weird">label</a></div></figure>`;
        const importRoot = await importNotion({
            "Files 2c6c5eca1b8b80f7b9eaf4f396b755dc.html":
                `<html><head><title>Files</title></head><body><div id="${id}"><div class="page-body"><div style="display:contents" dir="ltr">${figures}</div></div></div></body></html>`,
            "empty.weird": Buffer.from("e"),
            "data.weird": Buffer.from("d")
        });

        const note = importRoot.getChildNotes().find((n) => n.title === "Files");
        if (!note) {
            throw new Error("expected 'Files' page imported");
        }
        const fileAttachments = note.getAttachmentsByRole("file");
        // Missing file: stays a plain link, no attachment; empty-text + unknown-ext: two attachments.
        expect(fileAttachments.map((a) => a.title).sort()).toEqual(["empty.weird", "label"]);
        const octetStream = fileAttachments.find((a) => a.title === "label");
        expect(octetStream?.mime).toBe("application/octet-stream");
        // The missing-file anchor lost its marker class but is still a plain link.
        expect(note.getContent()).toContain(`href="missing.bin"`);
        expect(note.getContent()).not.toContain("notion-attachment");
    });

    it("synthesizes a 'Database' container for a CSV whose name strips to an empty title", async () => {
        // A CSV named with only a Notion id strips to an empty title and has no owning page, so the
        // container falls back to the "Database" name. Its rows live in the id-named sibling folder.
        const dbId = "08d361c59a9940c2a9d7237a4e6cd09a";
        const importRoot = await importNotion({
            [`${dbId}.csv`]: "a,b\n1,2",
            [`${dbId}/Row 4f195d8c55fb44f4b94a063e643b0297.html`]: pageHtml("Row", "4f195d8c55fb44f4b94a063e643b0297")
        });

        const container = importRoot.getChildNotes().find((note) => note.title === "Database");
        expect(container).toBeDefined();
        expect(container?.getChildNotes().map((note) => note.title)).toEqual(["Row"]);
    });

    it("synthesizes a container named after a CSV that carries no Notion id", async () => {
        // A CSV with no id at all keeps its (non-empty) filename as the container title and an empty id.
        const importRoot = await importNotion({
            "Inventory.csv": "a,b\n1,2",
            "Inventory/Widget 4f195d8c55fb44f4b94a063e643b0297.html": pageHtml("Widget", "4f195d8c55fb44f4b94a063e643b0297")
        });

        const container = importRoot.getChildNotes().find((note) => note.title === "Inventory");
        expect(container).toBeDefined();
        expect(container?.getChildNotes().map((note) => note.title)).toEqual(["Widget"]);
    });
});
