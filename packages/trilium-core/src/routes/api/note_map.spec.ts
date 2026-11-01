import { trimIndentation } from "@triliumnext/commons";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { getBecca } from "../../becca/becca.js";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";
import { buildNote, buildNotes } from "../../test/becca_easy_mocking";
import note_map from "./note_map";

interface LinkMapResponse {
    notes: [string, string, string, string | null][];
    noteIdToDescendantCountMap: Record<string, number>;
    links: { id: string; sourceNoteId: string; targetNoteId: string; name: string }[];
}

interface TreeMapResponse {
    notes: [string, string, string, string | null][];
    noteIdToDescendantCountMap: Record<string, number>;
    links: { sourceNoteId: string; targetNoteId: string }[];
}

describe("Note map service", () => {
    it("correctly identifies backlinks", () => {
        const note = buildNote({ id: "dUtgloZIckax", title: "Backlink text" });
        buildNotes([
            {
                title: "First",
                id: "first",
                "~internalLink": "dUtgloZIckax",
                content: trimIndentation`\
                    <p>
                        The quick brownie
                    </p>
                    <p>
                        <a class="reference-link" href="#root/dUtgloZIckax">
                            Backlink text
                        </a>
                    </p>
                    <figure class="image">
                        <img style="aspect-ratio:960/1280;" src="api/attachments/llY9IHS3ZSqE/image/5877566469045340078_121.jpg" width="960" height="1280">
                    </figure>
                `
            },
            {
                title: "Second",
                id: "second",
                "~internalLink": "dUtgloZIckax",
                content: trimIndentation`\
                    <p>
                        <a class="reference-link" href="#root/dUtgloZIckax">
                            Backlink text
                        </a>
                    </p>
                    <p>
                        <a class="reference-link" href="#root/dUtgloZIckax/wsq5D7wgKWrg">
                            First
                        </a>
                    </p>
                    <p>
                        <a class="reference-link" href="#root/dUtgloZIckax/TvyONGWYgV7N">
                            Second
                        </a>
                    </p>
                `
            }
        ]);

        const backlinksResponse = note_map.getBacklinks({
            params: {
                noteId: note.noteId
            }
        } as any);
        expect(backlinksResponse).toMatchObject([
            {
                excerpts: [
                    trimIndentation`\
                    <div class="ck-content backlink-excerpt"><p>
                        The quick brownie
                    </p>
                    <p>
                        <a class="reference-link backlink-link" href="#root/dUtgloZIckax">
                            Backlink text
                        </a>
                    </p>
                    <figure class="image">
                    ${"    "}
                    </figure>
                    </div>`
                ],
                noteId: "first",
            },
            {
                excerpts: [
                    trimIndentation`\
                    <div class="ck-content backlink-excerpt"><p>
                        <a class="reference-link backlink-link" href="#root/dUtgloZIckax">
                            Backlink text
                        </a>
                    </p>
                    <p>
                        <a class="reference-link" href="#root/dUtgloZIckax/wsq5D7wgKWrg">
                            First
                        </a>
                    </p>
                    <p>
                        <a class="reference-link" href="#root/dUtgloZIckax/TvyONGWYgV7N">
                            Second
                        </a>
                    </p>
                    </div>`
                ],
                noteId: "second"
            }
        ]);
    });
});

function req(noteId: string, body: Record<string, unknown> = {}) {
    return { params: { noteId }, body } as any;
}

describe("Note map service (branch coverage)", () => {
    it("backlink-count counts non-search source relations only", () => {
        const target = buildNote({ id: "bcTarget", title: "BC Target" });
        // text source -> counted
        buildNote({ id: "bcSourceText", title: "Source", type: "text", "~internalLink": "bcTarget" });
        // search source -> filtered out by getFilteredBacklinks
        buildNote({ id: "bcSourceSearch", title: "Search src", type: "search", "~ancestor": "bcTarget" });

        const res = note_map.getBacklinkCount(req(target.noteId));
        expect(res).toEqual({ count: 1 });
    });

    it("backlinks: non-text source yields no excerpts; excerpt cap drops to plain entries", () => {
        const target = buildNote({ id: "blTarget2", title: "Target2" });

        // non-text source (code) -> early return without excerpts
        buildNote({ id: "blCodeSrc", title: "Code", type: "code", "~internalLink": "blTarget2", content: "ignored" });

        const res = note_map.getBacklinks(req(target.noteId));
        const codeEntry = res.find((b) => b.noteId === "blCodeSrc");
        expect(codeEntry).toEqual({ noteId: "blCodeSrc", relationName: "internalLink" });
    });

    it("backlinks: text source over the excerpt cap returns relationName only", () => {
        const target = buildNote({ id: "capTarget", title: "Cap target" });
        const sources: Parameters<typeof buildNotes>[0] = [];
        for (let i = 0; i < 55; i++) {
            sources.push({
                id: `capSrc${i}`,
                title: `S${i}`,
                type: "text" as const,
                "~internalLink": "capTarget",
                content: `<p><a href="#root/capTarget">x</a></p>`
            });
        }
        buildNotes(sources);

        const res = note_map.getBacklinks(req(target.noteId));
        // beyond 50 excerpt computations, entries fall back to { noteId, relationName }
        const overCap = res.filter((b: any) => "relationName" in b);
        expect(overCap.length).toBeGreaterThan(0);
    });

    it("getTreeMap: filters excludeFromNoteMap notes and embedded image children", () => {
        // The map root has a text child that embeds an image (imageLink + parent of the image).
        // The image note is filtered out of the tree because it's an image with no children,
        // it has an incoming imageLink relation, and its imageLink source is also its parent.
        const mapRoot = buildNote({
            id: "treeRoot",
            title: "Tree root",
            children: [
                { id: "treeKeep", title: "Keep" },
                { id: "treeExcluded", title: "Excluded", "#excludeFromNoteMap": "true" },
                {
                    id: "treeImgParent",
                    title: "Img parent",
                    type: "text",
                    "~imageLink": "treeImg",
                    children: [ { id: "treeImg", title: "Embedded img", type: "image" } ]
                }
            ]
        });

        const res = note_map.getTreeMap(req(mapRoot.noteId)) as TreeMapResponse;
        const ids = res.notes.map((n) => n[0]);
        expect(ids).toContain("treeKeep");
        expect(ids).not.toContain("treeExcluded");
        expect(ids).not.toContain("treeImg");
        expect(ids).toContain("treeImgParent");
    });

    it("getTreeMap: keeps image note that is not referenced as imageLink by its parent", () => {
        const mapRoot = buildNote({
            id: "treeRoot2",
            title: "Tree root 2",
            children: [
                { id: "treeImgKeep", title: "Standalone image", type: "image" }
            ]
        });
        const res = note_map.getTreeMap(req(mapRoot.noteId)) as TreeMapResponse;
        expect(res.notes.map((n) => n[0])).toContain("treeImgKeep");
    });

    it("getTreeMap: when root has excludeFromNoteMap, nothing is filtered out", () => {
        const mapRoot = buildNote({
            id: "treeRootExcl",
            title: "Excluded root",
            "#excludeFromNoteMap": "true",
            children: [
                { id: "treeChildExcl", title: "Child", "#excludeFromNoteMap": "true" }
            ]
        });
        const res = note_map.getTreeMap(req(mapRoot.noteId)) as TreeMapResponse;
        const ids = res.notes.map((n) => n[0]);
        expect(ids).toContain("treeRootExcl");
        expect(ids).toContain("treeChildExcl");
    });

    it("getLinkMap: includes neighbors, applies includeRelations / excludeRelations filters", () => {
        const mapRoot = buildNote({
            id: "lmRoot",
            title: "LM root",
            "#color": "red",
            children: [
                { id: "lmChildA", title: "A", "~friend": "lmChildB" },
                { id: "lmChildB", title: "B", "~enemy": "lmChildA" }
            ]
        });

        const all = note_map.getLinkMap(req(mapRoot.noteId)) as LinkMapResponse;
        const linkNames = all.links.map((l) => l.name);
        expect(linkNames).toContain("friend");
        expect(linkNames).toContain("enemy");

        const included = note_map.getLinkMap(req(mapRoot.noteId, { includeRelations: [ "friend" ] })) as LinkMapResponse;
        expect(included.links.map((l) => l.name)).toEqual([ "friend" ]);

        const excluded = note_map.getLinkMap(req(mapRoot.noteId, { excludeRelations: [ "friend" ] })) as LinkMapResponse;
        const exNames = excluded.links.map((l) => l.name);
        expect(exNames).toContain("enemy");
        expect(exNames).not.toContain("friend");
    });

    it("getLinkMap: imageLink retained only when target is not a child of the source", () => {
        // source -> imageLink -> external image note (not a child) => retained as a link
        const mapRoot = buildNote({
            id: "imgLinkRoot",
            title: "Image link root",
            children: [
                { id: "imgSource", title: "Src", "~imageLink": "imgExternal" },
                { id: "imgExternal", title: "External image", type: "image" }
            ]
        });
        const res = note_map.getLinkMap(req(mapRoot.noteId)) as LinkMapResponse;
        expect(res.links.some((l) => l.name === "imageLink" && l.sourceNoteId === "imgSource")).toBe(true);
    });

    it("getLinkMap: imageLink dropped when target is a real child of the source", () => {
        const mapRoot = buildNote({
            id: "imgChildRoot",
            title: "Image child root",
            children: [
                {
                    id: "imgChildSource",
                    title: "Src",
                    "~imageLink": "imgChildTarget",
                    children: [ { id: "imgChildTarget", title: "Embedded", type: "image" } ]
                }
            ]
        });
        const res = note_map.getLinkMap(req(mapRoot.noteId)) as LinkMapResponse;
        expect(res.links.some((l) => l.name === "imageLink")).toBe(false);
    });

    it("getLinkMap: root with excludeFromNoteMap keeps excluded descendants", () => {
        const mapRoot = buildNote({
            id: "lmExclRoot",
            title: "LM excl root",
            "#excludeFromNoteMap": "true",
            children: [
                { id: "lmExclChild", title: "Excl child", "#excludeFromNoteMap": "true" }
            ]
        });
        const res = note_map.getLinkMap(req(mapRoot.noteId)) as LinkMapResponse;
        expect(res.notes.map((n) => n[0])).toContain("lmExclChild");
    });

    it("getLinkMap: search note uses direct search results and removes itself", () => {
        const resultNote = buildNote({ id: "searchResult", title: "Result" });
        const searchNote = buildNote({ id: "searchNote1", title: "Search", type: "search" });
        const spy = vi.spyOn(searchNote, "getSearchResultNotes").mockReturnValue([ resultNote ]);

        const res = note_map.getLinkMap(req(searchNote.noteId)) as LinkMapResponse;
        const ids = res.notes.map((n) => n[0]);
        expect(ids).toContain("searchResult");
        expect(ids).not.toContain("searchNote1");
        spy.mockRestore();
    });

    it("getNeighbors: ignores configured relations and excludeFromNoteMap targets/sources", () => {
        const excludedTarget = buildNote({ id: "nbExcluded", title: "Excluded", "#excludeFromNoteMap": "true" });
        const mapRoot = buildNote({
            id: "nbRoot",
            title: "NB root",
            "~template": "nbExcluded", // ignored relation
            "~link": "nbExcluded" // valid relation but target excluded
        });
        // a source pointing INTO the root, but the source is excluded
        buildNote({ id: "nbSourceExcluded", title: "Src excl", "#excludeFromNoteMap": "true", "~back": "nbRoot" });

        const res = note_map.getLinkMap(req(mapRoot.noteId)) as LinkMapResponse;
        const ids = res.notes.map((n) => n[0]);
        expect(ids).not.toContain("nbExcluded");
        expect(ids).not.toContain("nbSourceExcluded");
        expect(excludedTarget).toBeDefined();
    });

    it("getNeighbors: walks forward and backward links across depth", () => {
        // root -> a -> b (forward chain), and c -> root (backward)
        buildNote({ id: "depthB", title: "B" });
        buildNote({ id: "depthA", title: "A", "~rel": "depthB" });
        const mapRoot = buildNote({ id: "depthRoot", title: "Root", "~rel": "depthA" });
        buildNote({ id: "depthC", title: "C", "~rel": "depthRoot" });

        const res = note_map.getLinkMap(req(mapRoot.noteId)) as LinkMapResponse;
        const ids = res.notes.map((n) => n[0]);
        expect(ids).toEqual(expect.arrayContaining([ "depthA", "depthB", "depthC" ]));
    });

    it("getNeighbors: ignores incoming ignored relations (e.g. template) on the backward pass", () => {
        const mapRoot = buildNote({ id: "bwIgnoreRoot", title: "BW ignore root" });
        // a note that targets the root via an ignored relation -> backward loop continues
        buildNote({ id: "bwTemplateSrc", title: "Template src", "~template": "bwIgnoreRoot" });

        const res = note_map.getLinkMap(req(mapRoot.noteId)) as LinkMapResponse;
        expect(res.notes.map((n) => n[0])).not.toContain("bwTemplateSrc");
    });

    it("getNeighbors: walks backward links recursively beyond depth 1", () => {
        // chain of backward links into the root: D -> C -> root
        const mapRoot = buildNote({ id: "bwRoot", title: "BW root" });
        buildNote({ id: "bwC", title: "C", "~rel": "bwRoot" });
        buildNote({ id: "bwD", title: "D", "~rel": "bwC" });

        const res = note_map.getLinkMap(req(mapRoot.noteId)) as LinkMapResponse;
        const ids = res.notes.map((n) => n[0]);
        expect(ids).toEqual(expect.arrayContaining([ "bwC", "bwD" ]));
    });

    it("updateDescendantCountMapForSearch: search parent aggregates child counts", () => {
        const target = buildNote({ id: "udcTarget", title: "Target", children: [ { id: "udcChild", title: "Child" } ] });
        const searchNote = buildNote({ id: "udcSearch", title: "Search", type: "search" });
        const spy = vi.spyOn(searchNote, "getSearchResultNotes").mockReturnValue([ getBecca().notes["udcTarget"]! ]);

        const res = note_map.getTreeMap(req(searchNote.noteId)) as TreeMapResponse;
        // the search note's descendant count is derived from its resolved results
        expect(res.noteIdToDescendantCountMap["udcSearch"]).toBeGreaterThanOrEqual(1);
        expect(target).toBeDefined();
        spy.mockRestore();
    });

    function backlinkExcerpts(sourceId: string, content: string) {
        const target = buildNote({ id: `${sourceId}_t`, title: "ExcerptTarget" });
        buildNote({ id: sourceId, title: "Src", type: "text", "~internalLink": target.noteId, content });
        const res = note_map.getBacklinks(req(target.noteId));
        return (res.find((b: any) => b.noteId === sourceId) as any).excerpts as string[];
    }

    const big = "x".repeat(260);
    const small = "yy";

    it("findExcerpts: expands to sibling blocks and truncates an overflowing previous sibling", () => {
        const target = "exPrefix_t";
        const excerpts = backlinkExcerpts(
            "exPrefix",
            `<p>${big}</p><p>${small}</p><p><a href="#root/${target}">link</a></p><p>${small}</p><p>${big}</p>`
        );
        // the leading truncated previous sibling is prefixed with the ellipsis
        expect(excerpts[0]).toContain("…");
    });

    it("findExcerpts: truncates an overflowing next sibling with a trailing ellipsis", () => {
        const target = "exSuffix_t";
        const excerpts = backlinkExcerpts(
            "exSuffix",
            `<p><a href="#root/${target}">link</a></p><p>${big}</p>`
        );
        expect(excerpts[0]).toContain("…");
    });
});

let api: CoreApiTester;

describe("Note map API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("returns a tree map for root", async () => {
        const res = await api.post<TreeMapResponse>("/api/note-map/root/tree", { body: {} });
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.notes)).toBe(true);
        expect(res.body.noteIdToDescendantCountMap).toBeTruthy();
    });

    it("returns a link map for root", async () => {
        const res = await api.post<LinkMapResponse>("/api/note-map/root/link", { body: {} });
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.notes)).toBe(true);
        expect(Array.isArray(res.body.links)).toBe(true);
    });

    it("returns backlinks and backlink-count for a linked note", async () => {
        const target = await createTextNote(api, { title: "Backlink target" });
        const source = await createTextNote(api, {
            title: "Backlink source",
            content: `<p>before <a class="reference-link" href="#root/${target.noteId}">link</a> after</p>`
        });
        await api.put(`/api/notes/${source.noteId}/relations/internalLink/to/${target.noteId}`);

        const backlinks = await api.get<{ noteId: string; excerpts?: string[] }[]>(`/api/note-map/${target.noteId}/backlinks`);
        expect(backlinks.status).toBe(200);
        expect(backlinks.body.some((b) => b.noteId === source.noteId)).toBe(true);

        const count = await api.get<{ count: number }>(`/api/note-map/${target.noteId}/backlink-count`);
        expect(count.status).toBe(200);
        expect(count.body.count).toBeGreaterThanOrEqual(1);
    });

    it("404s for a non-existent map root", async () => {
        const res = await api.post("/api/note-map/missingNote999/tree", { body: {} });
        expect(res.status).toBe(404);
    });
});
