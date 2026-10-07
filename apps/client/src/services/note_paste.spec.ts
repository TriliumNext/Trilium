import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../entities/fnote.js";
import { buildNote } from "../test/easy-froca";
import branchService from "./branches.js";
import clipboard from "./clipboard.js";
import froca from "./froca.js";
import { pasteNotes } from "./note_paste.js";
import toastService from "./toast.js";

vi.mock("./clipboard_ext.js", () => ({ copyHtml: vi.fn(async () => true) }));

branchService.moveToParentNote = vi.fn(async () => {}) as typeof branchService.moveToParentNote;
toastService.showMessage = vi.fn() as typeof toastService.showMessage;

describe("pasteNotes", () => {
    let tree: FNote;
    let map: FNote;

    beforeEach(() => {
        vi.clearAllMocks();
        clipboard.cut([]);
        tree = buildNote({ title: "Tree", children: [ { id: "first", title: "First" }, { id: "second", title: "Second" } ] });
        const parent = buildNote({ title: "Parent", children: [ { id: "map", title: "Map" } ] });
        const mapNote = froca.getNoteFromCache("map");
        if (!mapNote || !parent.childToBranch.map) throw new Error("the map note was not built");
        map = mapNote;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("pastes the notes the system clipboard links to, once each, and leaves them in place", async () => {
        clipboard.cut([ tree.childToBranch.first ]);
        const html = `<a class="reference-link" href="#root/${tree.noteId}/second">Second</a>, `
            + `<a href="#root/first">First</a> <a href="#root/second">Again</a> `
            + `<a href="https://example.com/#root/first">External</a>`;

        expect(await pasteNotes(map, clipboardData({ "text/html": html }))).toEqual([ "second", "first" ]);
        expect(branchService.moveToParentNote).not.toHaveBeenCalled();
        expect(clipboard.isClipboardEmpty()).toBe(false);

        expect(await pasteNotes(map, clipboardData({ "text/plain": "#root/first, #root/second" })))
            .toEqual([ "first", "second" ]);
    });

    it("falls back to Trilium's clipboard, moving cut notes under the parent and leaving copied ones", async () => {
        const noLinks = clipboardData({ "text/html": "<p>Some text</p>", "text/plain": "Some text" });
        expect(await pasteNotes(map, noLinks)).toEqual([]);

        await clipboard.copy([ tree.childToBranch.first ]);
        expect(await pasteNotes(map, noLinks)).toEqual([ "first" ]);
        expect(branchService.moveToParentNote).not.toHaveBeenCalled();

        clipboard.cut([ tree.childToBranch.first, tree.childToBranch.second ]);
        expect(await pasteNotes(map, noLinks)).toEqual([ "first", "second" ]);
        expect(branchService.moveToParentNote)
            .toHaveBeenCalledWith([ tree.childToBranch.first, tree.childToBranch.second ], map.getParentBranchIds()[0]);
        expect(clipboard.isClipboardEmpty()).toBe(true);
    });

    it("reads the system clipboard itself without a paste event, and falls back when it cannot", async () => {
        vi.stubGlobal("navigator", { clipboard: { read: async () => [ clipboardItem({ "text/html": `<a href="#root/second">S</a>` }) ] } });
        expect(await pasteNotes(map)).toEqual([ "second" ]);

        await clipboard.copy([ tree.childToBranch.first ]);
        vi.stubGlobal("navigator", { clipboard: { read: async () => { throw new Error("denied"); } } });
        expect(await pasteNotes(map)).toEqual([ "first" ]);

        vi.stubGlobal("navigator", {});
        expect(await pasteNotes(map)).toEqual([ "first" ]);
    });
});

function clipboardData(flavors: Record<string, string>) {
    return { getData: (type: string) => flavors[type] ?? "" } as DataTransfer;
}

function clipboardItem(flavors: Record<string, string>) {
    return {
        types: Object.keys(flavors),
        getType: async (type: string) => new Blob([ flavors[type] ?? "" ], { type })
    } as unknown as ClipboardItem;
}
