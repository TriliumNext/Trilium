import { describe, expect, it, vi } from "vitest";

import type Component from "../components/component";
import clipboard from "../services/clipboard";
import froca from "../services/froca";
import noteTypesService from "../services/note_types";
import { buildNote } from "../test/easy-froca";
import type { MenuItem } from "./context_menu";
import { buildTreeContextMenuItems, getDuplicateItems, type TreeCommandNames } from "./tree_context_menu";

vi.mock("../services/clipboard", () => ({ default: { isClipboardEmpty: vi.fn(() => true) } }));
vi.mock("../components/app_context", () => ({ default: { tabManager: { getActiveContext: () => undefined } } }));

describe("buildTreeContextMenuItems", () => {
    /** The menu for a child note, with the note type data the insert submenus read stubbed. */
    function setUp() {
        vi.spyOn(noteTypesService, "loadNoteTypeData")
            .mockResolvedValue({ builtInTemplateNotes: [], userTemplateNotes: [], newTemplates: new Set() });
        const parent = buildNote({ title: "Parent", children: [ { title: "Child" } ] });
        const child = froca.notes[parent.children[0] ?? ""];
        const [ branch ] = child?.getParentBranches() ?? [];
        if (!child || !branch) throw new Error("expected the child and its branch");

        const build = () => buildTreeContextMenuItems({
            note: child, branch, notePath: `${parent.noteId}/${child.noteId}`, component: {} as Component
        });
        return { child, build };
    }

    it("offers the paste actions only while something is cut or copied", async () => {
        const { build } = setUp();

        async function actions() {
            const items = await build();
            const row = items.find((item): item is Extract<MenuItem<TreeCommandNames>, { kind: "actions" }> =>
                "kind" in item && item.kind === "actions");
            return row?.items.map((item) => item.command);
        }

        expect(await actions()).toStrictEqual([ "cutNotesToClipboard", "copyNotesToClipboard", "deleteNotes" ]);

        vi.mocked(clipboard.isClipboardEmpty).mockReturnValue(false);
        expect(await actions()).toStrictEqual([
            "cutNotesToClipboard", "copyNotesToClipboard", "pasteNotesFromClipboard", "pasteNotesAfterFromClipboard",
            "deleteNotes"
        ]);
    });

    it("folds the places to open the note in into one split row, quick edit standing on its own", async () => {
        const { build } = setUp();
        const items = await build();
        const separator = items.findIndex((item) => "kind" in item && item.kind === "separator");
        const [ open, quickEdit ] = items.slice(separator + 1);
        if (!open || "kind" in open || !quickEdit || "kind" in quickEdit) throw new Error("expected two rows after the actions");

        expect(open.command).toBe("openInTab");
        expect(open.items?.map((item) => "command" in item && item.command))
            .toStrictEqual([ "openInTab", "openNoteInSplit", "openNoteInWindow" ]);
        expect(quickEdit.command).toBe("openNoteInPopup");
    });

    it("ends with Advanced, right after Search in subtree", async () => {
        const { build } = setUp();
        const [ search, advanced ] = (await build()).slice(-2);

        expect(search && "command" in search && search.command).toBe("searchInSubtree");
        expect(advanced && "uiIcon" in advanced && advanced.uiIcon).toBe("bx bxs-wrench");
    });

    it("protects or unprotects the subtree after Archive, as the note stands, with both in its submenu", async () => {
        const { child, build } = setUp();

        async function protection() {
            const items = await build();
            const archive = items.findIndex((item) => "uiIcon" in item && item.uiIcon === "bx bx-archive");
            const row = items[archive + 1];
            if (!row || "kind" in row) throw new Error("expected a row after Archive");
            return [ row.command, row.items?.map((item) => "command" in item && item.command) ];
        }

        const both = [ "protectSubtree", "unprotectSubtree" ];
        expect(await protection()).toStrictEqual([ "protectSubtree", both ]);
        child.isProtected = true;
        expect(await protection()).toStrictEqual([ "unprotectSubtree", both ]);
    });
});

describe("getDuplicateItems", () => {
    it("offers the note-only copy as soon as one of the notes has children", () => {
        const leaf = buildNote({ title: "Leaf" });
        const parent = buildNote({ title: "Parent", children: [ { title: "Child" } ] });

        expect(getDuplicateItems([ leaf ])).toBeNull();

        const items = getDuplicateItems([ leaf, parent ]);
        expect(items?.map((item) => "command" in item && item.command))
            .toStrictEqual([ "duplicateSubtree", "duplicateNote" ]);
    });
});
