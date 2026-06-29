import { ZipArchive } from "archiver";
import { PassThrough } from "stream";
import { describe, expect, it } from "vitest";

import becca from "../../../becca/becca.js";
import type BNote from "../../../becca/entities/bnote.js";
import { getContext } from "../../context.js";
import TaskContext from "../../task_context.js";
import { decodeUtf8 } from "../../utils/binary.js";
import anytypeImporter from "./importer.js";

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

/** Runs the Anytype importer over `files` and returns the import root note. */
async function importAnytype(files: Record<string, string | Buffer>, fileName?: string): Promise<BNote> {
    const buffer = await createZipBuffer(files);
    const taskContext = TaskContext.getInstance("anytype-integration", "importNotes", { safeImport: true });

    return new Promise<BNote>((resolve, reject) => {
        void getContext().init(async () => {
            try {
                const root = becca.getNoteOrThrow("root");
                resolve(await anytypeImporter.importAnytype(taskContext, new Uint8Array(buffer), root, fileName));
            } catch (e) {
                reject(e);
            }
        });
    });
}

/** Serializes a page object the way Anytype's JSON export does: a root block with header chrome plus one
 * text block per paragraph, and the title carried in `details.name`. */
function pageObject(id: string, name: string, paragraphs: string[], opts: { layout?: number; sbType?: string } = {}): string {
    const contentIds = paragraphs.map((_, i) => `${id}-b${i}`);
    return JSON.stringify({
        sbType: opts.sbType ?? "Page",
        snapshot: {
            data: {
                blocks: [
                    { id, childrenIds: ["header", ...contentIds] },
                    { id: "header", childrenIds: ["title"] },
                    { id: "title", text: { text: "", style: "Title" } },
                    ...paragraphs.map((text, i) => ({ id: contentIds[i], text: { text, style: "Paragraph" } }))
                ],
                details: { id, name, layout: opts.layout ?? 0 },
                objectTypes: ["ot-page"]
            }
        }
    });
}

/** A relation-definition file (relations/<x>.pb.json): names and types a custom property by its key.
 * `includeTime` distinguishes a date-time relation from a plain date (both are format 4). */
function relationObject(key: string, name: string, format: number, includeTime = false): string {
    return JSON.stringify({ sbType: "STRelation", snapshot: { data: { details: { id: `rel-${key}`, relationKey: key, name, relationFormat: format, relationFormatIncludeTime: includeTime } } } });
}

/** A collection page: a dataview block flagged `isCollection`, its members in `details.links`, and one
 * visible view column per supplied relation key. A collection's `resolvedLayout` is the collection layout
 * (14), not the basic-page 0 — so the importer must admit it via its `isCollection` flag, not the layout.
 * `viewType` is the Anytype view layout (Table/List/Gallery/Calendar/Kanban); omitted defaults to Table.
 * `groupRelationKey` is the relation a Kanban groups by / a Calendar dates events from. */
function collectionObject(id: string, name: string, memberIds: string[], columnKeys: string[], viewType?: string, groupRelationKey?: string): string {
    return JSON.stringify({
        sbType: "Page",
        snapshot: {
            data: {
                blocks: [
                    { id, childrenIds: ["header", "dataview"] },
                    { id: "header", childrenIds: ["title"] },
                    { id: "title", text: { text: "", style: "Title" } },
                    { id: "dataview", dataview: { isCollection: true, views: [{ type: viewType, groupRelationKey, relations: columnKeys.map((key) => ({ key, isVisible: true })) }] } }
                ],
                details: { id, name, resolvedLayout: 14, links: memberIds }
            }
        }
    });
}

/** A select / multi-select option-value file (relationsOptions/<x>.pb.json): resolves an option id to its name. */
function optionObject(cid: string, name: string, relationKey: string): string {
    return JSON.stringify({ sbType: "STRelationOption", snapshot: { data: { details: { id: cid, name, relationKey } } } });
}

/** A file-metadata file (filesObjects/<x>.pb.json): resolves a file id to its name, type and bytes path. */
function fileObjectJson(cid: string, name: string, fileExt: string, fileMimeType: string, source: string): string {
    return JSON.stringify({ sbType: "FileObject", snapshot: { data: { details: { id: cid, name, fileExt, fileMimeType, source } } } });
}

/** A title-less "row" object whose content is its custom property values (keyed by relation key). */
function memberObject(id: string, props: Record<string, unknown>): string {
    return JSON.stringify({
        sbType: "Page",
        snapshot: {
            data: {
                blocks: [
                    { id, childrenIds: ["header"] },
                    { id: "header", childrenIds: ["title"] },
                    { id: "title", text: { text: "", style: "Title" } }
                ],
                details: { id, name: "", resolvedLayout: 0, ...props }
            }
        }
    });
}

describe("Anytype importer — integration", () => {
    it("imports each page as a flat child of an 'Anytype import' root, with its text content", async () => {
        const importRoot = await importAnytype({
            "objects/page1.pb.json": pageObject("page1", "First Page", ["Hello world", "Second paragraph"]),
            "objects/page2.pb.json": pageObject("page2", "Second Page", ["Just one line"])
        });

        expect(importRoot.title).toBe("Anytype import");

        const children = importRoot.getChildNotes();
        expect(children.map((note) => note.title).sort()).toEqual(["First Page", "Second Page"]);

        const first = children.find((note) => note.title === "First Page");
        expect(decodeUtf8(first?.getContent() ?? "")).toBe("<p>Hello world</p><p>Second paragraph</p>");
    });

    it("imports only pages, skipping sets, system objects and the relations/types folders", async () => {
        const importRoot = await importAnytype({
            "objects/page1.pb.json": pageObject("page1", "Real Page", ["content"]),
            // A set/collection: sbType Page but layout 3.
            "objects/set1.pb.json": pageObject("set1", "My Set", [], { layout: 3 }),
            // A non-page system object.
            "objects/participant.pb.json": pageObject("participant", "Someone", [], { sbType: "Participant", layout: 19 }),
            // Sibling folders the basic importer ignores.
            "relations/rel1.pb.json": JSON.stringify({ sbType: "STRelation", snapshot: { data: { details: { id: "rel1", name: "Author" } } } }),
            "types/type1.pb.json": JSON.stringify({ sbType: "STType", snapshot: { data: { details: { id: "type1", name: "Article" } } } }),
            "profile": "not json"
        });

        expect(importRoot.getChildNotes().map((note) => note.title)).toEqual(["Real Page"]);
    });

    it("imports a single basic page whose export omits `layout` (only resolvedLayout is set)", async () => {
        // A single-object export of a basic page drops the default `layout` field entirely, with backslash
        // path separators on Windows — both must still resolve to one imported page with its text.
        const page = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "solo", childrenIds: ["header", "solo-b0"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        { id: "solo-b0", text: { text: "Regular text", style: "Paragraph" } }
                    ],
                    details: { id: "solo", name: "Formatting test", resolvedLayout: 0 }
                }
            }
        });
        const importRoot = await importAnytype({ "objects\\solo.pb.json": page });

        const children = importRoot.getChildNotes();
        expect(children.map((note) => note.title)).toEqual(["Formatting test"]);
        expect(decodeUtf8(children[0]?.getContent() ?? "")).toBe("<p>Regular text</p>");
    });

    it("maps heading styles to h2/h3/h4 end-to-end (modeled on the 'Formatting test' page)", async () => {
        const page = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "fmt", childrenIds: ["header", "fmt-1", "fmt-2", "fmt-3", "fmt-4"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        { id: "fmt-1", text: { text: "Regular text", style: "Paragraph" } },
                        { id: "fmt-2", text: { text: "Title", style: "Header1" } },
                        { id: "fmt-3", text: { text: "Heading", style: "Header2" } },
                        { id: "fmt-4", text: { text: "Subheading", style: "Header3" } }
                    ],
                    details: { id: "fmt", name: "Formatting test", resolvedLayout: 0 }
                }
            }
        });
        const importRoot = await importAnytype({ "objects/fmt.pb.json": page });

        const note = importRoot.getChildNotes().find((n) => n.title === "Formatting test");
        expect(decodeUtf8(note?.getContent() ?? "")).toBe("<p>Regular text</p><h2>Title</h2><h3>Heading</h3><h4>Subheading</h4>");
    });

    it("applies inline marks end-to-end (verbatim from the 'Formatting test' page)", async () => {
        const page = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "fmt", childrenIds: ["header", "fmt-1"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        {
                            id: "fmt-1",
                            text: {
                                text: "Bold Italic Strikethrough Underline Bold Italic Underline",
                                style: "Paragraph",
                                marks: {
                                    marks: [
                                        { range: { from: 12, to: 25 }, type: "Strikethrough" },
                                        { range: { from: 5, to: 11 }, type: "Italic" },
                                        { range: { from: 36, to: 57 }, type: "Italic" },
                                        { range: { from: 0, to: 4 }, type: "Bold" },
                                        { range: { from: 36, to: 57 }, type: "Bold" },
                                        { range: { from: 26, to: 35 }, type: "Underscored" },
                                        { range: { from: 36, to: 57 }, type: "Underscored" }
                                    ]
                                }
                            }
                        }
                    ],
                    details: { id: "fmt", name: "Formatting test", resolvedLayout: 0 }
                }
            }
        });
        const importRoot = await importAnytype({ "objects/fmt.pb.json": page });

        const note = importRoot.getChildNotes().find((n) => n.title === "Formatting test");
        expect(decodeUtf8(note?.getContent() ?? "")).toBe(
            "<p><strong>Bold</strong> <em>Italic</em> <s>Strikethrough</s> <u>Underline</u> <strong><em><u>Bold Italic Underline</u></em></strong></p>"
        );
    });

    it("applies text and background colours end-to-end, giving a highlight without a text colour readable default text", async () => {
        const page = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "clr", childrenIds: ["header", "clr-1"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        {
                            id: "clr-1",
                            text: {
                                text: "Grey Red",
                                style: "Paragraph",
                                marks: {
                                    marks: [
                                        // "Grey" is highlighted only (no text colour) — the third-row case.
                                        { range: { from: 0, to: 4 }, type: "BackgroundColor", param: "grey" },
                                        { range: { from: 5, to: 8 }, type: "TextColor", param: "red" }
                                    ]
                                }
                            }
                        }
                    ],
                    details: { id: "clr", name: "Colours", resolvedLayout: 0 }
                }
            }
        });
        const importRoot = await importAnytype({ "objects/clr.pb.json": page });

        const note = importRoot.getChildNotes().find((n) => n.title === "Colours");
        expect(decodeUtf8(note?.getContent() ?? "")).toBe(
            '<p><span style="color:#252525;background-color:#e3e3e3">Grey</span> <span style="color:#e2400c">Red</span></p>'
        );
    });

    it("imports a Code block as a code block with its language preserved (from the 'Formatting test' page)", async () => {
        const page = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "code", childrenIds: ["header", "code-1"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        { id: "code-1", fields: { lang: "clike" }, text: { text: "void main() {\n\tprintf(\"Hello world.\\n\");\n}", style: "Code" } }
                    ],
                    details: { id: "code", name: "Code", resolvedLayout: 0 }
                }
            }
        });
        const importRoot = await importAnytype({ "objects/code.pb.json": page });

        const note = importRoot.getChildNotes().find((n) => n.title === "Code");
        expect(decodeUtf8(note?.getContent() ?? "")).toBe(
            '<pre><code class="language-text-x-csrc">void main() {\n\tprintf("Hello world.\\n");\n}</code></pre>'
        );
    });

    it("imports a Mermaid diagram and a table end-to-end (from the 'More formatting' page)", async () => {
        // A latex/Mermaid block and a table (TableColumns + TableRows layouts; cells keyed `${rowId}-${columnId}`).
        const page = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "pg", childrenIds: ["header", "mmd", "tbl"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        { id: "mmd", latex: { text: "stateDiagram-v2\n    [*] --> Still\n", processor: "Mermaid" } },
                        { id: "tbl", table: {}, childrenIds: ["cols", "rows"] },
                        { id: "cols", layout: { style: "TableColumns" }, childrenIds: ["c1", "c2", "c3"] },
                        { id: "c1", tableColumn: {}, childrenIds: [] },
                        { id: "c2", tableColumn: {}, childrenIds: [] },
                        { id: "c3", tableColumn: {}, childrenIds: [] },
                        { id: "rows", layout: { style: "TableRows" }, childrenIds: ["r1", "r2"] },
                        { id: "r1", tableRow: {}, childrenIds: ["r1-c1", "r1-c2", "r1-c3"] },
                        { id: "r1-c1", text: { text: "A" } },
                        { id: "r1-c2", text: { text: "B" } },
                        { id: "r1-c3", text: { text: "C" } },
                        { id: "r2", tableRow: {}, childrenIds: ["r2-c1", "r2-c2", "r2-c3"] },
                        { id: "r2-c1", text: { text: "1" } },
                        { id: "r2-c2", text: { text: "2" } },
                        { id: "r2-c3", text: { text: "3" } }
                    ],
                    details: { id: "pg", name: "More formatting", resolvedLayout: 0 }
                }
            }
        });
        const importRoot = await importAnytype({ "objects/fmt.pb.json": page });

        const note = importRoot.getChildNotes().find((n) => n.title === "More formatting");
        expect(decodeUtf8(note?.getContent() ?? "")).toBe(
            '<pre><code class="language-mermaid">stateDiagram-v2\n    [*] --&gt; Still\n</code></pre>' +
                '<figure class="table"><table><tbody>' +
                "<tr><td>A</td><td>B</td><td>C</td></tr>" +
                "<tr><td>1</td><td>2</td><td>3</td></tr>" +
                "</tbody></table></figure>"
        );
    });

    it("imports nested lists end-to-end (grouping consecutive items, nesting children)", async () => {
        const page = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "list", childrenIds: ["header", "n1", "n2"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        { id: "n1", text: { text: "One", style: "Numbered" }, childrenIds: ["n1a"] },
                        { id: "n1a", text: { text: "One-A", style: "Numbered" }, childrenIds: [] },
                        { id: "n2", text: { text: "Two", style: "Numbered" }, childrenIds: [] }
                    ],
                    details: { id: "list", name: "Lists", resolvedLayout: 0 }
                }
            }
        });
        const importRoot = await importAnytype({ "objects/list.pb.json": page });

        const note = importRoot.getChildNotes().find((n) => n.title === "Lists");
        expect(decodeUtf8(note?.getContent() ?? "")).toBe("<ol><li>One<ol><li>One-A</li></ol></li><li>Two</li></ol>");
    });

    it("imports a toggle as a collapsible block end-to-end", async () => {
        const page = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "tog", childrenIds: ["header", "t1"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        { id: "t1", text: { text: "Toggle", style: "Toggle" }, childrenIds: ["t1a"] },
                        { id: "t1a", text: { text: "Inside", style: "Paragraph" }, childrenIds: [] }
                    ],
                    details: { id: "tog", name: "Toggles", resolvedLayout: 0 }
                }
            }
        });
        const importRoot = await importAnytype({ "objects/tog.pb.json": page });

        const note = importRoot.getChildNotes().find((n) => n.title === "Toggles");
        expect(decodeUtf8(note?.getContent() ?? "")).toBe('<details class="trilium-collapsible"><summary>Toggle</summary><p>Inside</p></details>');
    });

    it("imports a divider as <hr> end-to-end", async () => {
        const page = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "div", childrenIds: ["header", "p1", "d1"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        { id: "p1", text: { text: "Above", style: "Paragraph" } },
                        { id: "d1", div: { style: "Dots" } }
                    ],
                    details: { id: "div", name: "Divider", resolvedLayout: 0 }
                }
            }
        });
        const importRoot = await importAnytype({ "objects/div.pb.json": page });

        const note = importRoot.getChildNotes().find((n) => n.title === "Divider");
        expect(decodeUtf8(note?.getContent() ?? "")).toBe("<p>Above</p><hr>");
    });

    it("imports callouts as admonitions end-to-end, with Notion-style emoji handling", async () => {
        const page = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "co", childrenIds: ["header", "c1", "c2"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        { id: "c1", text: { text: "Callout with default icon", style: "Callout", iconEmoji: "" } },
                        { id: "c2", text: { text: "Callout with custom emoji", style: "Callout", iconEmoji: "😶‍🌫️" } }
                    ],
                    details: { id: "co", name: "Callouts", resolvedLayout: 0 }
                }
            }
        });
        const importRoot = await importAnytype({ "objects/co.pb.json": page });

        const note = importRoot.getChildNotes().find((n) => n.title === "Callouts");
        expect(decodeUtf8(note?.getContent() ?? "")).toBe(
            '<aside class="admonition tip"><p>Callout with default icon</p></aside>' +
                '<aside class="admonition note"><p>😶‍🌫️ Callout with custom emoji</p></aside>'
        );
    });

    it("imports a Quote (Highlight) block as a blockquote end-to-end", async () => {
        const page = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "q", childrenIds: ["header", "q1"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        { id: "q1", text: { text: "Highlighted that looks like a blockquote.", style: "Quote" } }
                    ],
                    details: { id: "q", name: "Quote", resolvedLayout: 0 }
                }
            }
        });
        const importRoot = await importAnytype({ "objects/q.pb.json": page });

        const note = importRoot.getChildNotes().find((n) => n.title === "Quote");
        expect(decodeUtf8(note?.getContent() ?? "")).toBe("<blockquote><p>Highlighted that looks like a blockquote.</p></blockquote>");
    });

    it("renders a cross-page link as a reference link and records an internalLink relation for backlinks", async () => {
        // "Source" links to "Target" via a block-level link-to-object (Anytype's `link.targetBlockId`).
        const source = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "src", childrenIds: ["header", "src-link"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        { id: "src-link", link: { targetBlockId: "tgt", style: "Page" } }
                    ],
                    details: { id: "src", name: "Source", resolvedLayout: 0 }
                }
            }
        });
        const target = pageObject("tgt", "Target", ["I am linked"]);

        const importRoot = await importAnytype({
            "objects/source.pb.json": source,
            "objects/target.pb.json": target
        });

        const sourceNote = importRoot.getChildNotes().find((n) => n.title === "Source");
        const targetNote = importRoot.getChildNotes().find((n) => n.title === "Target");
        expect(sourceNote).toBeDefined();
        expect(targetNote).toBeDefined();

        // The link block resolves to a reference link pointing at the target note's id.
        expect(decodeUtf8(sourceNote?.getContent() ?? "")).toBe(`<p><a class="reference-link" href="#root/${targetNote?.noteId}">Target</a></p>`);

        // The internalLink relation drives backlink detection ("what links here").
        const internalLinks = sourceNote?.getRelations().filter((r) => r.name === "internalLink") ?? [];
        expect(internalLinks.map((r) => r.value)).toEqual([targetNote?.noteId]);
        // And the target sees the backlink from the source.
        const backlinks = targetNote?.getTargetRelations().filter((r) => r.name === "internalLink") ?? [];
        expect(backlinks.map((r) => r.noteId)).toEqual([sourceNote?.noteId]);
    });

    it("drops a link to an object that wasn't imported, leaving no dangling relation", async () => {
        // The link points at "ghost", which is not present in the export.
        const source = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "src", childrenIds: ["header", "src-p", "src-link"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        { id: "src-p", text: { text: "Body", style: "Paragraph" } },
                        { id: "src-link", link: { targetBlockId: "ghost", style: "Page" } }
                    ],
                    details: { id: "src", name: "Lonely", resolvedLayout: 0 }
                }
            }
        });

        const importRoot = await importAnytype({ "objects/source.pb.json": source });

        const note = importRoot.getChildNotes().find((n) => n.title === "Lonely");
        expect(decodeUtf8(note?.getContent() ?? "")).toBe("<p>Body</p>");
        expect(note?.getRelations().filter((r) => r.name === "internalLink")).toHaveLength(0);
    });

    it("renders an inline mention as a reference link and records an internalLink relation for backlinks", async () => {
        // "Source" mentions "Target" inline via a Mention mark (the target object's id in `param`), mirroring
        // the "Page with block and inline reference links" page.
        const source = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "src", childrenIds: ["header", "src-p"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        { id: "src-p", text: { text: "Inline link: Target here", style: "Paragraph", marks: { marks: [{ range: { from: 13, to: 19 }, type: "Mention", param: "tgt" }] } } }
                    ],
                    details: { id: "src", name: "Source", resolvedLayout: 0 }
                }
            }
        });
        const target = pageObject("tgt", "Target", ["I am linked"]);

        const importRoot = await importAnytype({
            "objects/source.pb.json": source,
            "objects/target.pb.json": target
        });

        const sourceNote = importRoot.getChildNotes().find((n) => n.title === "Source");
        const targetNote = importRoot.getChildNotes().find((n) => n.title === "Target");
        expect(sourceNote).toBeDefined();
        expect(targetNote).toBeDefined();

        // The mention span becomes an inline reference link to the target note, the surrounding text intact.
        expect(decodeUtf8(sourceNote?.getContent() ?? "")).toBe(`<p>Inline link: <a class="reference-link" href="#root/${targetNote?.noteId}">Target</a> here</p>`);

        // ...and drives backlink detection just like a block-level link.
        const internalLinks = sourceNote?.getRelations().filter((r) => r.name === "internalLink") ?? [];
        expect(internalLinks.map((r) => r.value)).toEqual([targetNote?.noteId]);
        const backlinks = targetNote?.getTargetRelations().filter((r) => r.name === "internalLink") ?? [];
        expect(backlinks.map((r) => r.noteId)).toEqual([sourceNote?.noteId]);
    });

    it("preserves a page's created and modified dates from Anytype's detail timestamps", async () => {
        const page = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "d", childrenIds: ["header", "d-b0"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        { id: "d-b0", text: { text: "Body", style: "Paragraph" } }
                    ],
                    // Verbatim timestamps from the "Article 6 Electronic Contracts" page (Unix seconds).
                    details: { id: "d", name: "Dated", resolvedLayout: 0, createdDate: 1735632037, lastModifiedDate: 1735632353 }
                }
            }
        });
        const importRoot = await importAnytype({ "objects/d.pb.json": page });

        const note = importRoot.getChildNotes().find((n) => n.title === "Dated");
        expect(note?.utcDateCreated).toBe("2024-12-31 08:00:37.000Z");
        expect(note?.utcDateModified).toBe("2024-12-31 08:05:53.000Z");
    });

    it("leaves a page with no Anytype dates with valid import-time dates", async () => {
        const importRoot = await importAnytype({ "objects/p.pb.json": pageObject("p", "Undated", ["Body"]) });

        const note = importRoot.getChildNotes().find((n) => n.title === "Undated");
        // Untouched: a date-less page keeps the import-time timestamps, still in the valid UTC format.
        expect(note?.utcDateCreated).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(note?.utcDateModified).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("imports a collection as a book/table whose columns are promoted definitions and members are rows", async () => {
        // Verbatim relation keys from "My custom collection": URL (format 7), Email (format 8).
        const urlKey = "6a3e335dcafa6953a4661c74";
        const emailKey = "6a3e336dcafa6953a4661c75";
        const importRoot = await importAnytype({
            "objects/coll.pb.json": collectionObject("coll", "My custom collection", ["m1", "m2"], [urlKey, emailKey]),
            "objects/m1.pb.json": memberObject("m1", { [urlKey]: "https://triliumnotes.org" }),
            "objects/m2.pb.json": memberObject("m2", { [emailKey]: "contact@acme.com" }),
            "relations/url.pb.json": relationObject(urlKey, "URL", 7),
            "relations/email.pb.json": relationObject(emailKey, "Email", 8)
        });

        // The collection becomes a table-view book; only it lands at the root (members nest beneath it).
        expect(importRoot.getChildNotes().map((n) => n.title)).toEqual(["My custom collection"]);
        const collection = importRoot.getChildNotes()[0];
        expect(collection.type).toBe("book");
        expect(collection.getOwnedLabelValue("viewType")).toBe("table");

        // Each visible column is a single-valued promoted definition, in the view's order.
        expect(collection.getOwnedAttributes().filter((a) => a.name.startsWith("label:")).map((a) => a.name)).toEqual(["label:url", "label:email"]);
        expect(collection.getOwnedLabelValue("label:url")).toBe("promoted,single,url,alias=URL");
        expect(collection.getOwnedLabelValue("label:email")).toBe("promoted,single,url,alias=Email");

        // Members are the table rows, carrying their own values; email gets a clickable mailto: scheme.
        const rows = collection.getChildNotes();
        expect(rows.map((n) => n.title).sort()).toEqual(["Untitled", "Untitled"]);
        const byUrl = rows.find((n) => n.getOwnedLabelValue("url"));
        const byEmail = rows.find((n) => n.getOwnedLabelValue("email"));
        expect(byUrl?.getOwnedLabelValue("url")).toBe("https://triliumnotes.org");
        expect(byEmail?.getOwnedLabelValue("email")).toBe("mailto:contact@acme.com");
    });

    it("maps each Anytype view layout to the matching Trilium collection view type", async () => {
        // The first view's layout (Gallery/List/Kanban/Calendar) drives the book's #viewType; Table/unknown → table.
        const layouts: [string | undefined, string][] = [
            ["Gallery", "grid"],
            ["List", "list"],
            ["Kanban", "board"],
            ["Calendar", "calendar"],
            ["Table", "table"]
        ];
        for (const [anytypeLayout, triliumView] of layouts) {
            const importRoot = await importAnytype({
                "objects/coll.pb.json": collectionObject("coll", `${anytypeLayout} collection`, [], [], anytypeLayout)
            });
            const collection = importRoot.getChildNotes()[0];
            expect(collection.type).toBe("book");
            expect(collection.getOwnedLabelValue("viewType")).toBe(triliumView);
        }
    });

    it("maps a Kanban collection's group relation to #board:groupBy", async () => {
        // Verbatim from the "Kanban collection": grouped by the system "Tag" relation (key "tag", format 11).
        const importRoot = await importAnytype({
            "objects/coll.pb.json": collectionObject("coll", "Kanban collection", [], [], "Kanban", "tag"),
            "relations/tag.pb.json": relationObject("tag", "Tag", 11)
        });

        const collection = importRoot.getChildNotes()[0];
        expect(collection.getOwnedLabelValue("viewType")).toBe("board");
        // The board groups its cards by the attribute the Tag relation resolves to.
        expect(collection.getOwnedLabelValue("board:groupBy")).toBe("tag");
    });

    it("maps a Calendar collection's date relation to #calendar:startDate, dating its members", async () => {
        // Verbatim from the Calendar collection: grouped by the custom "myDate" relation (format 4 date),
        // whose value each member carries as an epoch.
        const dateKey = "6a3e3660cafa6953a4661c94";
        const importRoot = await importAnytype({
            "objects/coll.pb.json": collectionObject("coll", "Calendar collection", ["m1"], [], "Calendar", dateKey),
            "objects/m1.pb.json": memberObject("m1", { [dateKey]: 1782118800 }),
            "relations/mydate.pb.json": relationObject(dateKey, "myDate", 4)
        });

        const collection = importRoot.getChildNotes()[0];
        expect(collection.getOwnedLabelValue("viewType")).toBe("calendar");
        // The calendar reads each event's date from the attribute the myDate relation resolves to. The config
        // must be *inheritable* because the calendar resolves it per member (off the child, not the collection).
        const startDateLabel = collection.getOwnedAttributes().find((a) => a.name === "calendar:startDate");
        expect(startDateLabel?.value).toBe("mydate");
        expect(startDateLabel?.isInheritable).toBe(true);

        // ...so the member both inherits the config and carries its own date under that attribute (local YYYY-MM-DD).
        const day = (() => {
            const d = new Date(1782118800 * 1000);
            const pad = (n: number) => String(n).padStart(2, "0");
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        })();
        const member = collection.getChildNotes()[0];
        expect(member.getLabelValue("calendar:startDate")).toBe("mydate"); // inherited from the collection
        expect(member.getOwnedLabelValue("mydate")).toBe(day);
    });

    it("imports date, date-time and checkbox columns with correctly typed definitions and values", async () => {
        // Verbatim relation keys and member values from "My custom collection".
        const dateKey = "6a3e330acafa6953a4661c6b";
        const dateTimeKey = "6a3e3317cafa6953a4661c6e";
        const checkboxKey = "6a3e3354cafa6953a4661c73";
        const importRoot = await importAnytype({
            "objects/coll.pb.json": collectionObject("coll", "Typed", ["m1"], [dateKey, dateTimeKey, checkboxKey]),
            "objects/m1.pb.json": memberObject("m1", { [dateKey]: 1782461197, [dateTimeKey]: 1782461208, [checkboxKey]: true }),
            "relations/date.pb.json": relationObject(dateKey, "Date", 4),
            "relations/datetime.pb.json": relationObject(dateTimeKey, "Date & Time", 4, true),
            "relations/checkbox.pb.json": relationObject(checkboxKey, "Checkbox", 6)
        });

        const collection = importRoot.getChildNotes()[0];
        // A plain date, a date-time (includeTime) and a checkbox each map to their Trilium label type.
        expect(collection.getOwnedLabelValue("label:date")).toBe("promoted,single,date,alias=Date");
        expect(collection.getOwnedLabelValue("label:dateTime")).toBe("promoted,single,datetime,alias=Date & Time");
        expect(collection.getOwnedLabelValue("label:checkbox")).toBe("promoted,single,boolean,alias=Checkbox");

        // Dates are formatted in local time (computed here via native Date getters so the assertion holds in
        // any timezone); the checkbox is a boolean.
        const local = (epochSeconds: number, withTime = false) => {
            const d = new Date(epochSeconds * 1000);
            const pad = (n: number) => String(n).padStart(2, "0");
            const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            return withTime ? `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
        };
        const row = collection.getChildNotes()[0];
        expect(row.getOwnedLabelValue("date")).toBe(local(1782461197));
        expect(row.getOwnedLabelValue("dateTime")).toBe(local(1782461208, true));
        expect(row.getOwnedLabelValue("checkbox")).toBe("true");
    });

    it("imports select and multi-select columns as single/multi text labels, resolving option names", async () => {
        // Verbatim relation keys from "My custom collection": Select property (format 3), Multi-select (format 11).
        const selectKey = "6a3e29e8cafa6953a4661c17";
        const multiKey = "6a3e2a01cafa6953a4661c1c";
        const importRoot = await importAnytype({
            "objects/coll.pb.json": collectionObject("coll", "Tagged", ["m1"], [selectKey, multiKey]),
            "objects/m1.pb.json": memberObject("m1", { [selectKey]: ["opt-second-cap"], [multiKey]: ["opt-first", "opt-second"] }),
            "relations/select.pb.json": relationObject(selectKey, "Select property", 3),
            "relations/multi.pb.json": relationObject(multiKey, "Multi-select", 11),
            "relationsOptions/o1.pb.json": optionObject("opt-second-cap", "Second", selectKey),
            "relationsOptions/o2.pb.json": optionObject("opt-first", "first", multiKey),
            "relationsOptions/o3.pb.json": optionObject("opt-second", "second", multiKey)
        });

        const collection = importRoot.getChildNotes()[0];
        // Single-select is a single text column; multi-select a multi text column.
        expect(collection.getOwnedLabelValue("label:selectProperty")).toBe("promoted,single,text,alias=Select property");
        expect(collection.getOwnedLabelValue("label:multiSelect")).toBe("promoted,multi,text,alias=Multi-select");

        const row = collection.getChildNotes()[0];
        expect(row.getOwnedLabelValue("selectProperty")).toBe("Second");
        expect(row.getOwnedLabelValues("multiSelect")).toEqual(["first", "second"]);
    });

    it("imports a file property as a role:file attachment with a reference link in the body, not a column", async () => {
        const fileKey = "6a3e3323cafa6953a4661c6f";
        const fileCid = "bafyreifile";
        const importRoot = await importAnytype({
            "objects/coll.pb.json": collectionObject("coll", "Files", ["m1"], [fileKey]),
            "objects/m1.pb.json": memberObject("m1", { [fileKey]: [fileCid] }),
            "relations/file.pb.json": relationObject(fileKey, "File", 5),
            // Anytype mis-tags the MIME (text/plain for a .csv); the importer derives it from the extension.
            "filesObjects/f1.pb.json": fileObjectJson(fileCid, "log", "csv", "text/plain", "files\\log.csv"),
            "files/log.csv": "hello,world\n1,2\n"
        });

        // A file property is never a column.
        const collection = importRoot.getChildNotes()[0];
        expect(collection.getOwnedAttributes().filter((a) => a.name.startsWith("label:"))).toHaveLength(0);

        // The file is a role:"file" attachment, titled from the file's name, with its bytes preserved and its
        // MIME derived from the extension (not Anytype's unreliable text/plain).
        const row = collection.getChildNotes()[0];
        const attachments = row.getAttachmentsByRole("file");
        expect(attachments.map((a) => a.title)).toEqual(["log.csv"]);
        expect(attachments[0].mime).toBe("text/csv");
        expect(decodeUtf8(attachments[0].getContent() ?? "")).toBe("hello,world\n1,2\n");

        // A reference link to the attachment is prepended to the body.
        const content = decodeUtf8(row.getContent() ?? "");
        expect(content).toContain(`class="reference-link"`);
        expect(content).toContain(`href="#root/${row.noteId}?viewMode=attachments&attachmentId=${attachments[0].attachmentId}"`);
        expect(content).toContain(">log.csv</a>");
    });

    it("imports a file object that's a collection member as a file note under the collection", async () => {
        // A file dropped into a collection is listed in its membership (details.links) as a FileObject id, not
        // a page — so it must still become a (file) note beneath the collection rather than being dropped.
        const fileCid = "bafyreifilemember";
        const importRoot = await importAnytype({
            "objects/coll.pb.json": collectionObject("coll", "Docs", [fileCid], []),
            // Anytype records a wrong MIME for the PDF (verbatim from the real export: text/plain); the importer
            // must derive application/pdf from the extension instead.
            "filesObjects/f1.pb.json": fileObjectJson(fileCid, "report", "pdf", "text/plain", "files\\report.pdf"),
            "files/report.pdf": Buffer.from("%PDF-1.4 hi")
        });

        const collection = importRoot.getChildNotes()[0];
        expect(collection.title).toBe("Docs");
        const members = collection.getChildNotes();
        expect(members.map((n) => n.title)).toEqual(["report.pdf"]);
        const fileNote = members[0];
        expect(fileNote.type).toBe("file");
        expect(fileNote.mime).toBe("application/pdf");
        expect(decodeUtf8(fileNote.getContent() ?? "")).toBe("%PDF-1.4 hi");
        expect(fileNote.getOwnedLabelValue("originalFileName")).toBe("report.pdf");
    });

    it("skips a collection's file member whose bytes are missing from the export", async () => {
        // The collection lists a FileObject as a member and its metadata ships, but the raw bytes under files/
        // are absent — so no note can be created for it and it's left out rather than failing the import.
        const fileCid = "bafyreimissingbytes";
        const importRoot = await importAnytype({
            "objects/coll.pb.json": collectionObject("coll", "Docs", [fileCid], []),
            "filesObjects/f1.pb.json": fileObjectJson(fileCid, "report", "pdf", "application/pdf", "files\\report.pdf")
            // No files/report.pdf entry — the bytes are missing.
        });

        const collection = importRoot.getChildNotes()[0];
        expect(collection.title).toBe("Docs");
        expect(collection.getChildNotes()).toHaveLength(0);
    });

    it("imports an image object that's a collection member as an image note", async () => {
        const imgCid = "bafyreiimagemember";
        const importRoot = await importAnytype({
            "objects/coll.pb.json": collectionObject("coll", "Gallery", [imgCid], []),
            "filesObjects/f1.pb.json": fileObjectJson(imgCid, "pic", "png", "image/png", "files\\pic.png"),
            "files/pic.png": Buffer.from("\x89PNG\r\n\x1a\nfake-png")
        });

        const members = importRoot.getChildNotes()[0].getChildNotes();
        expect(members.map((n) => n.type)).toEqual(["image"]);
        expect(members[0].title).toBe("pic.png");
    });

    it("clones a file member into every collection that lists it", async () => {
        // The same file is a member of two collections — its primary parent is the first, and it's cloned into
        // the second (same as a page member).
        const fileCid = "bafyreisharedfile";
        const importRoot = await importAnytype({
            "objects/c1.pb.json": collectionObject("c1", "First", [fileCid], []),
            "objects/c2.pb.json": collectionObject("c2", "Second", [fileCid], []),
            "filesObjects/f1.pb.json": fileObjectJson(fileCid, "shared", "txt", "text/plain", "files\\shared.txt"),
            "files/shared.txt": Buffer.from("shared bytes")
        });

        const collections = importRoot.getChildNotes();
        expect(collections.map((n) => n.title).sort()).toEqual(["First", "Second"]);
        // The very same note (one noteId) appears under both collections.
        const firstMember = collections.find((n) => n.title === "First")?.getChildNotes()[0];
        const secondMember = collections.find((n) => n.title === "Second")?.getChildNotes()[0];
        expect(firstMember?.noteId).toBe(secondMember?.noteId);
        expect(firstMember?.title).toBe("shared.txt");
    });

    it("imports an inline image block as a role:image attachment, rewriting the <img src> to point at it", async () => {
        // An Image file block in the body references a FileObject (its `targetObjectId`), whose bytes ship under files/.
        const imageCid = "bafyreiimage";
        const page = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "pg", childrenIds: ["header", "img"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        { id: "img", file: { type: "Image", name: "shot.png", mime: "image/png", targetObjectId: imageCid, state: "Done", style: "Embed" } }
                    ],
                    details: { id: "pg", name: "Page with image", resolvedLayout: 0 }
                }
            }
        });
        const importRoot = await importAnytype({
            "objects/pg.pb.json": page,
            "filesObjects/f1.pb.json": fileObjectJson(imageCid, "shot", "png", "image/png", "files\\shot.png"),
            "files/shot.png": Buffer.from("\x89PNG\r\n\x1a\nfake-png-bytes")
        });

        const note = importRoot.getChildNotes().find((n) => n.title === "Page with image");
        // The image becomes a role:"image" attachment titled from the file's name.
        const attachments = note?.getAttachmentsByRole("image") ?? [];
        expect(attachments.map((a) => a.title)).toEqual(["shot.png"]);

        // The <img src> is rewritten to the attachment URL (no bare file id left in the body).
        const content = decodeUtf8(note?.getContent() ?? "");
        expect(content).toContain(`<figure class="image"><img src="api/attachments/${attachments[0]?.attachmentId}/image/`);
        expect(content).not.toContain(imageCid);
    });

    it("imports an inline non-image file block as a role:file attachment with a reference link in the body", async () => {
        const fileCid = "bafyreipdf";
        const page = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "pg", childrenIds: ["header", "file"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        { id: "file", file: { type: "PDF", name: "report.pdf", mime: "application/pdf", targetObjectId: fileCid, state: "Done", style: "Link" } }
                    ],
                    details: { id: "pg", name: "Page with file", resolvedLayout: 0 }
                }
            }
        });
        const importRoot = await importAnytype({
            "objects/pg.pb.json": page,
            "filesObjects/f1.pb.json": fileObjectJson(fileCid, "report", "pdf", "application/pdf", "files\\report.pdf"),
            "files/report.pdf": Buffer.from("%PDF-1.4 fake")
        });

        const note = importRoot.getChildNotes().find((n) => n.title === "Page with file");
        const attachments = note?.getAttachmentsByRole("file") ?? [];
        expect(attachments.map((a) => a.title)).toEqual(["report.pdf"]);
        expect(attachments[0]?.mime).toBe("application/pdf");

        // The anchor is rewritten into a Trilium attachment reference-link.
        const content = decodeUtf8(note?.getContent() ?? "");
        expect(content).toContain(`class="reference-link"`);
        expect(content).toContain(`href="#root/${note?.noteId}?viewMode=attachments&attachmentId=${attachments[0]?.attachmentId}"`);
        expect(content).toContain(">report.pdf</a>");
        expect(content).not.toContain("anytype-file");
    });

    it("drops an inline image whose bytes are missing from the export, leaving no broken <img>", async () => {
        const page = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "pg", childrenIds: ["header", "p", "img"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        { id: "p", text: { text: "Body", style: "Paragraph" } },
                        { id: "img", file: { type: "Image", name: "gone.png", targetObjectId: "bafyreimissing", state: "Done", style: "Embed" } }
                    ],
                    details: { id: "pg", name: "Missing image", resolvedLayout: 0 }
                }
            }
        });
        // No filesObjects/files entries for the referenced id.
        const importRoot = await importAnytype({ "objects/pg.pb.json": page });

        const note = importRoot.getChildNotes().find((n) => n.title === "Missing image");
        expect(note?.getAttachmentsByRole("image")).toHaveLength(0);
        const content = decodeUtf8(note?.getContent() ?? "");
        // The broken figure is dropped; the rest of the body survives.
        expect(content).toBe("<p>Body</p>");
    });

    it("strips the bare-id link of an inline non-image file whose bytes are missing, keeping its text", async () => {
        // The anytype-file placeholder can't be resolved (no metadata/bytes), so its class and bare-id href are
        // dropped, leaving the file name as plain (non-linking) text rather than a broken attachment link.
        const page = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "pg", childrenIds: ["header", "file"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        { id: "file", file: { type: "PDF", name: "gone.pdf", targetObjectId: "bafyreimissingfile", state: "Done", style: "Link" } }
                    ],
                    details: { id: "pg", name: "Missing file", resolvedLayout: 0 }
                }
            }
        });
        const importRoot = await importAnytype({ "objects/pg.pb.json": page });

        const note = importRoot.getChildNotes().find((n) => n.title === "Missing file");
        expect(note?.getAttachmentsByRole("file")).toHaveLength(0);
        const content = decodeUtf8(note?.getContent() ?? "");
        expect(content).toBe("<p><a>gone.pdf</a></p>");
    });

    it("skips a file property whose file object's bytes are missing, leaving no attachment or link", async () => {
        // The file property references a FileObject, but its bytes are absent — so no attachment is created and
        // the body keeps no reference link to it.
        const fileKey = "6a3e3323cafa6953a4661c6f";
        const fileCid = "bafyreimissingprop";
        const importRoot = await importAnytype({
            "objects/coll.pb.json": collectionObject("coll", "Files", ["m1"], [fileKey]),
            "objects/m1.pb.json": memberObject("m1", { [fileKey]: [fileCid] }),
            "relations/file.pb.json": relationObject(fileKey, "File", 5),
            "filesObjects/f1.pb.json": fileObjectJson(fileCid, "log", "csv", "text/csv", "files\\log.csv")
            // No files/log.csv entry — the bytes are missing.
        });

        const row = importRoot.getChildNotes()[0].getChildNotes()[0];
        expect(row.getAttachmentsByRole("file")).toHaveLength(0);
        expect(decodeUtf8(row.getContent() ?? "")).not.toContain("reference-link");
    });

    it("imports a collection-scoped export (no wrapper) as a named table whose columns are synthesized from members", async () => {
        // Exporting a single collection omits the collection object itself, so its members all carry the same
        // absent createdInContext — the signal to recover the collection (name from the file, columns from members).
        const ctx = "bafyreicollectioncontext";
        const urlKey = "6a3e335dcafa6953a4661c74";
        const importRoot = await importAnytype(
            {
                "objects/m1.pb.json": memberObject("m1", { createdInContext: ctx, [urlKey]: "https://triliumnotes.org" }),
                "objects/m2.pb.json": memberObject("m2", { createdInContext: ctx }),
                "relations/url.pb.json": relationObject(urlKey, "URL", 7)
            },
            "My custom collection.zip"
        );

        // The root *is* the collection: named from the zip, a table whose column is synthesized from the member.
        expect(importRoot.title).toBe("My custom collection");
        expect(importRoot.type).toBe("book");
        expect(importRoot.getOwnedLabelValue("viewType")).toBe("table");
        expect(importRoot.getOwnedLabelValue("label:url")).toBe("promoted,single,url,alias=URL");

        // The members are its rows, carrying their own values.
        const rows = importRoot.getChildNotes();
        expect(rows).toHaveLength(2);
        expect(rows.find((n) => n.getOwnedLabelValue("url"))?.getOwnedLabelValue("url")).toBe("https://triliumnotes.org");
    });

    it("imports a file member of a collection-scoped export (no membership list) as a file note under the root", async () => {
        // Exporting just the collection drops the wrapper (so no `links` membership) and the file's own
        // createdInContext points at where it was first added, not the collection — so the only signal the
        // bundled, page-unreferenced file is a member is its presence. It still becomes a file note.
        const ctx = "bafyreicollectioncontext";
        const fileCid = "bafyreiscopedfile";
        const importRoot = await importAnytype(
            {
                "objects/m1.pb.json": memberObject("m1", { createdInContext: ctx }),
                "filesObjects/f1.pb.json": fileObjectJson(fileCid, "report", "pdf", "text/plain", "files\\report.pdf"),
                "files/report.pdf": Buffer.from("%PDF-1.4 scoped")
            },
            "Ordered collection.zip"
        );

        expect(importRoot.title).toBe("Ordered collection");
        const children = importRoot.getChildNotes();
        // The page member (Untitled) plus the recovered file member.
        expect(children.map((n) => n.title).sort()).toEqual(["Untitled", "report.pdf"]);
        const fileNote = children.find((n) => n.type === "file");
        expect(fileNote?.mime).toBe("application/pdf");
        expect(decodeUtf8(fileNote?.getContent() ?? "")).toBe("%PDF-1.4 scoped");
    });

    it("does not duplicate a member page's inline file as a separate collection member", async () => {
        // In a collection-scoped export the inline image's FileObject is bundled too; it must stay the page's
        // inline attachment, not also surface as a sibling member note.
        const ctx = "bafyreicollectioncontext";
        const imgCid = "bafyreiinlineimg";
        const page = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [
                        { id: "m1", childrenIds: ["header", "img"] },
                        { id: "header", childrenIds: ["title"] },
                        { id: "title", text: { text: "", style: "Title" } },
                        { id: "img", file: { type: "Image", name: "pic.png", targetObjectId: imgCid, state: "Done", style: "Embed" } }
                    ],
                    details: { id: "m1", name: "Has image", resolvedLayout: 0, createdInContext: ctx }
                }
            }
        });
        const importRoot = await importAnytype(
            {
                "objects/m1.pb.json": page,
                "filesObjects/f1.pb.json": fileObjectJson(imgCid, "pic", "png", "image/png", "files\\pic.png"),
                "files/pic.png": Buffer.from("\x89PNG\r\n\x1a\nfake-png")
            },
            "Gallery.zip"
        );

        const children = importRoot.getChildNotes();
        // Only the member page — the image is its inline attachment, not a separate member note.
        expect(children.map((n) => n.title)).toEqual(["Has image"]);
        expect(children[0].getAttachmentsByRole("image")).toHaveLength(1);
    });

    it("does not surface a file referenced only by an unimported object (a set) as a collection member", async () => {
        // In a collection-scoped export the recovery treats page-unreferenced bundled files as members. A file
        // referenced only by an object we don't import — here a set (layout 3) carrying it as a file property —
        // is not a dropped-in member and must not surface as a stray file note.
        const ctx = "bafyreicollectioncontext";
        const fileKey = "6a3e3323cafa6953a4661c6f";
        const fileCid = "bafyreisetfile";
        const set = JSON.stringify({
            sbType: "Page",
            snapshot: {
                data: {
                    blocks: [{ id: "set1", childrenIds: [] }],
                    details: { id: "set1", name: "My Set", layout: 3, [fileKey]: [fileCid] }
                }
            }
        });
        const importRoot = await importAnytype(
            {
                "objects/m1.pb.json": memberObject("m1", { createdInContext: ctx }),
                "objects/set1.pb.json": set,
                "relations/file.pb.json": relationObject(fileKey, "File", 5),
                "filesObjects/f1.pb.json": fileObjectJson(fileCid, "log", "csv", "text/plain", "files\\log.csv"),
                "files/log.csv": "hello,world\n1,2\n"
            },
            "Ordered collection.zip"
        );

        // Only the page member — the set's file is not a collection member, so it isn't recovered.
        expect(importRoot.getChildNotes().map((n) => n.title)).toEqual(["Untitled"]);
        expect(importRoot.getChildNotes().some((n) => n.type === "file")).toBe(false);
    });

    it("keeps the default 'Anytype import' text root for a regular multi-page export", async () => {
        const importRoot = await importAnytype(
            {
                "objects/p1.pb.json": pageObject("p1", "Page one", ["body"]),
                "objects/p2.pb.json": pageObject("p2", "Page two", ["body"])
            },
            "Some space export.zip"
        );

        expect(importRoot.title).toBe("Anytype import");
        expect(importRoot.type).toBe("text");
    });

    it("produces an empty root when the export has no pages", async () => {
        const importRoot = await importAnytype({
            "types/type1.pb.json": JSON.stringify({ sbType: "STType", snapshot: { data: { details: { id: "type1", name: "Article" } } } })
        });

        expect(importRoot.title).toBe("Anytype import");
        expect(importRoot.getChildNotes()).toHaveLength(0);
    });

    it("rejects an Anytype Protobuf export (binary objects/*.pb), guiding the user to re-export as JSON", async () => {
        // The Protobuf variant ships binary `objects/*.pb` (not the `.pb.json` this importer reads).
        await expect(
            importAnytype({ "objects/bafyreiabc.pb": "binary protobuf bytes, not JSON" }, "My space.zip")
        ).rejects.toThrow(/Protobuf.*re-export.*JSON/is);
    });

    it("rejects an Anytype Markdown export (*.md files), guiding the user to re-export as JSON", async () => {
        // The Markdown variant ships one `*.md` per page, with no `objects/` JSON at all.
        await expect(
            importAnytype({ "article-1.md": "# Article 1\n\nbody", "article-2.md": "# Article 2" }, "My space.zip")
        ).rejects.toThrow(/Markdown.*re-export.*JSON/is);
    });

    it("imports a valid JSON export even if it carries a stray markdown file (the guard only fires with zero pages)", async () => {
        // A real page is present, so the wrong-format detection must not trip on an incidental `.md` entry.
        const importRoot = await importAnytype({
            "objects/p1.pb.json": pageObject("p1", "Real page", ["body"]),
            "notes.md": "# stray markdown"
        });

        expect(importRoot.getChildNotes().map((n) => n.title)).toEqual(["Real page"]);
    });
});
