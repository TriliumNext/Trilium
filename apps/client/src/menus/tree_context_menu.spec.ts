import { describe, expect, it, vi } from "vitest";

import type Component from "../components/component";
import clipboard from "../services/clipboard";
import froca from "../services/froca";
import noteCreateService from "../services/note_create";
import noteTypesService from "../services/note_types";
import { buildNote } from "../test/easy-froca";
import type { MenuItem } from "./context_menu";
import { buildTreeContextMenuItems, getDuplicateItems, handleTreeContextMenuSelect, type TreeCommandNames } from "./tree_context_menu";

vi.mock("../services/clipboard", () => ({ default: { getContents: vi.fn(() => null) } }));
vi.mock("../components/app_context", () => ({ default: { tabManager: { getActiveContext: () => undefined } } }));
vi.mock("../services/i18n", () => ({
    t: (key: string, options?: { count?: number }) =>
        (options?.count === undefined ? key : `${key} ${options.count}`),
    translationsInitializedPromise: Promise.resolve()
}));

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

    async function actionRow(build: () => Promise<MenuItem<TreeCommandNames>[]>) {
        const items = await build();
        type ActionRow = Extract<MenuItem<TreeCommandNames>, { kind: "actions" }>;
        const row = items.find((item): item is ActionRow => "kind" in item && item.kind === "actions");
        return row?.items ?? [];
    }

    it("offers the paste actions only while something is cut or copied", async () => {
        const { build } = setUp();
        const actions = async () => (await actionRow(build)).map((item) => item.command);

        vi.mocked(clipboard.getContents).mockReturnValue(null);
        expect(await actions()).toStrictEqual([ "cutNotesToClipboard", "copyNotesToClipboard", "deleteNotes" ]);

        vi.mocked(clipboard.getContents).mockReturnValue({ noteIds: [ "a" ], mode: "cut" });
        expect(await actions()).toStrictEqual([
            "cutNotesToClipboard", "copyNotesToClipboard", "pasteNotesFromClipboard", "pasteNotesAfterFromClipboard",
            "deleteNotes"
        ]);
    });

    it("tells that the paste actions paste clones after Copy, and nothing after Cut", async () => {
        const { build } = setUp();
        const pasteTooltips = async () => (await actionRow(build))
            .filter((item) => item.command?.startsWith("paste"))
            .map((item) => item.tooltip);

        vi.mocked(clipboard.getContents).mockReturnValue({ noteIds: [ "a" ], mode: "cut" });
        expect(await pasteTooltips()).toStrictEqual([ undefined, undefined ]);

        vi.mocked(clipboard.getContents).mockReturnValue({ noteIds: [ "a", "b" ], mode: "copy" });
        expect(await pasteTooltips()).toStrictEqual([
            "tree-context-menu.paste-into-tooltip 2", "tree-context-menu.paste-after-tooltip 2"
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

describe("buildTreeContextMenuItems on system notes", () => {
    async function enabledState(parentId: string, childId: string) {
        vi.spyOn(noteTypesService, "loadNoteTypeData")
            .mockResolvedValue({ builtInTemplateNotes: [], userTemplateNotes: [], newTemplates: new Set() });
        buildNote({ id: parentId, title: "Parent", children: [ { id: childId, title: "Child" } ] });
        const child = froca.notes[childId];
        const [ branch ] = child?.getParentBranches() ?? [];
        if (!child || !branch) throw new Error("expected the child and its branch");

        const items = await buildTreeContextMenuItems({
            note: child, branch, notePath: `${parentId}/${childId}`, component: {} as Component
        });
        // The clipboard rows sit in an `actions` group of their own.
        const rows = items.flatMap((item) => ("kind" in item && item.kind === "actions" ? item.items : [ item ]));
        const enabled = (command: TreeCommandNames) => {
            const item = rows.find((row) => "command" in row && row.command === command);
            if (!item || "kind" in item) throw new Error(`expected a ${command} row`);
            return item.enabled;
        };
        return {
            exportNote: enabled("exportNote"),
            importIntoNote: enabled("importIntoNote"),
            branchCommands: (
                [ "cutNotesToClipboard", "copyNotesToClipboard", "moveNotesTo", "cloneNotesTo" ] as const
            ).map(enabled)
        };
    }

    it("exports a help page, which cannot be imported into, and neither for an options page", async () => {
        expect(await enabledState("_helpParent", "_helpPage")).toMatchObject({ exportNote: true, importIntoNote: false });
        expect(await enabledState("_optionsParent", "_optionsPage")).toMatchObject({ exportNote: false, importIntoNote: false });
    });

    it("does not cut, clone or move a help page, which is virtual, but does an options page", async () => {
        expect((await enabledState("_helpParent", "_helpPage")).branchCommands).toStrictEqual([ false, false, false, false ]);
        expect((await enabledState("_optionsParent", "_optionsPage")).branchCommands).toStrictEqual([ true, true, true, true ]);
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

describe("handleTreeContextMenuSelect", () => {
    it("reveals the note only for the commands that open one", async () => {
        const parent = buildNote({ title: "Parent", children: [ { title: "Child" } ] });
        const child = froca.notes[parent.children[0] ?? ""];
        const [ branch ] = child?.getParentBranches() ?? [];
        if (!child || !branch) throw new Error("expected the child and its branch");
        vi.spyOn(noteCreateService, "createNote").mockResolvedValue({ note: null, branch: undefined });

        async function reveals(command: TreeCommandNames) {
            const onRevealNote = vi.fn();
            const triggerCommand = vi.fn();
            await handleTreeContextMenuSelect({ title: command, command }, {
                note: child, branch, notePath: `${parent.noteId}/${child.noteId}`,
                component: { triggerCommand } as unknown as Component,
                onRevealNote
            });
            return onRevealNote.mock.calls.length > 0;
        }

        for (const command of [ "insertChildNote", "duplicateSubtree", "openNoteInSplit", "searchInSubtree" ] as const) {
            expect(await reveals(command), command).toBe(true);
        }
        for (const command of [ "copyNotesToClipboard", "cutNotesToClipboard", "deleteNotes", "toggleNoteHoisting", "moveNotesTo" ] as const) {
            expect(await reveals(command), command).toBe(false);
        }
    });
});
