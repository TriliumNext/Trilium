import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import becca from "../../becca/becca";
import { load } from "../../becca/becca_loader";
import { getContext } from "../../services/context";
import optionService from "../../services/options";
import { registerVirtualNoteProvider, unregisterVirtualNoteProvider } from "../../services/virtual_notes";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core tree routes through the in-process {@link CoreApiTester}
 * (no Express / HTTP server), so this same spec runs under both the node
 * (better-sqlite3) and standalone (sql.js WASM) suites against the seeded demo DB.
 */
let api: CoreApiTester;

interface TreeResponse {
    notes: { noteId: string }[];
    branches: { branchId: string; noteId: string; parentNoteId: string }[];
    attributes: unknown[];
}

describe("Tree API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("returns notes, branches and attributes rooted at root", async () => {
        const res = await api.get<TreeResponse>("/api/tree");

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.notes)).toBe(true);
        expect(res.body.notes.some((n) => n.noteId === "root")).toBe(true);
        // root always gets the synthetic `none_root` branch (parentNoteId "none").
        expect(res.body.branches.some((b) => b.branchId === "none_root")).toBe(true);
    });

    it("includes the launch bars and the bookmarks, which the client shows at startup", async () => {
        await createTextNote(api, { parentNoteId: "_lbBookmarks", title: "Bookmarked" });
        const res = await api.get<TreeResponse>("/api/tree");
        const noteIds = new Set(res.body.notes.map((n) => n.noteId));
        const branchKeys = new Set(res.body.branches.map((b) => `${b.parentNoteId}/${b.noteId}`));

        for (const parentNoteId of [ "_lbVisibleLaunchers", "_lbMobileVisibleLaunchers", "_lbBookmarks" ]) {
            const parent = becca.getNoteOrThrow(parentNoteId);
            expect(parent.children.length).toBeGreaterThan(0);
            expect(noteIds.has(parentNoteId)).toBe(true);
            for (const child of parent.children) {
                expect(noteIds.has(child.noteId)).toBe(true);
                expect(branchKeys.has(`${parentNoteId}/${child.noteId}`)).toBe(true);
            }
        }
    });

    it("includes the history launchers and the task states, which the client asks for at startup", async () => {
        // Collapsed, as in a database where nobody opened the hidden subtree; this one has it expanded.
        const hiddenBranch = becca.getBranchFromChildAndParent("_hidden", "root");
        const wasExpanded = !!hiddenBranch?.isExpanded;
        if (hiddenBranch) hiddenBranch.isExpanded = false;
        try {
            const res = await api.get<TreeResponse>("/api/tree");
            const noteIds = new Set(res.body.notes.map((n) => n.noteId));
            const attributeIds = new Set((res.body.attributes as { attributeId: string }[]).map((a) => a.attributeId));

            const taskStates = becca.getNoteOrThrow("_taskStates");
            expect(taskStates.children.length).toBeGreaterThan(0);
            const historyLaunchers = [ "_lbBackInHistory", "_lbForwardInHistory" ].map((noteId) => becca.getNoteOrThrow(noteId));
            for (const note of [ ...historyLaunchers, taskStates, ...taskStates.children ]) {
                expect(noteIds.has(note.noteId)).toBe(true);
                // The labels the client reads off them, such as a state's `stateId`, come along.
                for (const attribute of note.ownedAttributes) {
                    expect(attributeIds.has(attribute.attributeId)).toBe(true);
                }
            }
        } finally {
            if (hiddenBranch) hiddenBranch.isExpanded = wasExpanded;
        }
    });

    it("includes the notes of the saved tabs with their ancestors, which the client restores at startup", async () => {
        // Below a collapsed note, which the tree would otherwise stop at.
        const parent = await createTextNote(api, { title: "Collapsed parent" });
        const tabNote = await createTextNote(api, { parentNoteId: parent.noteId, title: "Open in a tab" });
        const hoistedParent = await createTextNote(api, { parentNoteId: parent.noteId, title: "Hoisted parent" });
        const hoisted = await createTextNote(api, { parentNoteId: hoistedParent.noteId, title: "Hoisted" });
        const savedTabs = optionService.getOption("openNoteContexts");
        const tabs = [
            { ntxId: "a", notePath: `root/${parent.noteId}/${tabNote.noteId}`, hoistedNoteId: hoisted.noteId, active: true },
            { ntxId: "b", notePath: "root/noLongerThere", hoistedNoteId: "root", active: false },
            // Entries the client did not write, which are skipped without dropping the rest.
            null,
            { ntxId: "c", notePath: "", hoistedNoteId: 42 },
            { ntxId: "d", notePath: [ "root" ] }
        ];
        await api.put("/api/options", { body: { openNoteContexts: JSON.stringify(tabs) } });
        try {
            const res = await api.get<TreeResponse>("/api/tree");
            const noteIds = new Set(res.body.notes.map((n) => n.noteId));

            for (const noteId of [ tabNote.noteId, parent.noteId, hoisted.noteId, hoistedParent.noteId ]) {
                expect(noteIds.has(noteId)).toBe(true);
            }
            expect(noteIds.has("noLongerThere")).toBe(false);

            // A value the client did not write leaves the tree as it is.
            for (const openNoteContexts of [ "not json", "{}" ]) {
                await api.put("/api/options", { body: { openNoteContexts } });
                expect((await api.get<TreeResponse>("/api/tree")).status).toBe(200);
            }
        } finally {
            await api.put("/api/options", { body: { openNoteContexts: savedTabs } });
        }
    });

    it("returns the same tree without saved tabs as with an empty list of them", async () => {
        const savedTabs = optionService.getOption("openNoteContexts");
        await api.put("/api/options", { body: { openNoteContexts: "[]" } });
        try {
            const withEmptyList = (await api.get<TreeResponse>("/api/tree")).body;

            const original = optionService.getOptionOrNull.bind(optionService);
            const spy = vi.spyOn(optionService, "getOptionOrNull")
                .mockImplementation((name) => (name === "openNoteContexts" ? null : original(name)));
            try {
                const res = await api.get<TreeResponse>("/api/tree");
                expect(res.status).toBe(200);
                expect(spy).toHaveBeenCalledWith("openNoteContexts");
                expect(res.body).toEqual(withEmptyList);
            } finally {
                spy.mockRestore();
            }
        } finally {
            await api.put("/api/options", { body: { openNoteContexts: savedTabs } });
        }
    });

    it("leaves out the startup notes a database does not have", async () => {
        // Collapsed, so the tree reaches the hidden subtree only through the startup notes.
        const hiddenBranch = becca.getBranchFromChildAndParent("_hidden", "root");
        const wasExpanded = !!hiddenBranch?.isExpanded;
        if (hiddenBranch) hiddenBranch.isExpanded = false;
        const missingNoteIds = [ "_lbMobileVisibleLaunchers", "_lbBackInHistory" ];
        const missingNotes = missingNoteIds.map((noteId) => becca.getNoteOrThrow(noteId));
        const mobileLauncherIds = missingNotes[0].children.map((child) => child.noteId);
        expect(mobileLauncherIds.length).toBeGreaterThan(0);
        for (const noteId of missingNoteIds) delete becca.notes[noteId];
        try {
            const res = await api.get<TreeResponse>("/api/tree");
            expect(res.status).toBe(200);
            const noteIds = new Set(res.body.notes.map((n) => n.noteId));

            for (const noteId of [ ...missingNoteIds, ...mobileLauncherIds ]) {
                expect(noteIds.has(noteId)).toBe(false);
            }
            // The startup notes the database has still come along.
            for (const noteId of [ "_lbVisibleLaunchers", "_lbForwardInHistory" ]) {
                expect(noteIds.has(noteId)).toBe(true);
            }
        } finally {
            for (const note of missingNotes) becca.notes[note.noteId] = note;
            if (hiddenBranch) hiddenBranch.isExpanded = wasExpanded;
        }
    });

    it("scopes the tree to a subtree via subTreeNoteId", async () => {
        const res = await api.get<TreeResponse>("/api/tree", {
            query: { subTreeNoteId: "_hidden" }
        });
        expect(res.status).toBe(200);
        expect(res.body.notes.some((n) => n.noteId === "_hidden")).toBe(true);
    });

    it("404s for an unknown subtree note", async () => {
        const res = await api.get("/api/tree", { query: { subTreeNoteId: "doesNotExist123" } });
        expect(res.status).toBe(404);
    });

    it("loads an explicit set of note ids", async () => {
        const res = await api.post<TreeResponse>("/api/tree/load", {
            body: { noteIds: [ "root" ] }
        });
        expect(res.status).toBe(200);
        expect(res.body.notes.some((n) => n.noteId === "root")).toBe(true);
    });

    it("marks a note whose content cannot be saved, and only that note", async () => {
        registerVirtualNoteProvider({
            namespace: "_vtree",
            parentNoteId: "_hidden",
            getSubtree: () => [{ id: "_vtreePage", title: "Page", type: "text" }],
            getContent: () => "<p>shipped</p>"
        });
        getContext().init(() => load());

        try {
            const res = await api.post<{ notes: { noteId: string; isContentWritable?: boolean }[] }>("/api/tree/load", {
                body: { noteIds: [ "root", "_vtreePage" ] }
            });
            const byId = new Map(res.body.notes.map((note) => [ note.noteId, note ]));
            expect(byId.get("_vtreePage")?.isContentWritable).toBe(false);
            const root = byId.get("root");
            expect(root).toBeTruthy();
            expect(Object.hasOwn(root ?? {}, "isContentWritable")).toBe(false);
        } finally {
            unregisterVirtualNoteProvider("_vtree");
            getContext().init(() => load());
        }
    });

    describe("edge cases", () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("skips requested note ids that are not in the cache", async () => {
            // Hits the `if (!note) continue` guard while still returning the valid ones.
            const res = await api.post<TreeResponse>("/api/tree/load", {
                body: { noteIds: [ "root", "doesNotExist123" ] }
            });
            expect(res.status).toBe(200);
            expect(res.body.notes.some((n) => n.noteId === "root")).toBe(true);
            expect(res.body.notes.some((n) => n.noteId === "doesNotExist123")).toBe(false);
        });

        it("skips a collected branch id that is missing from the cache", async () => {
            // Force a dangling branchId into the collection (via the child-branch
            // lookup in collectEntityIds) so the `becca.branches[branchId]` lookup
            // misses and the guard runs. Use `load` so getTree's own collect()
            // recursion (which needs a real childNote) isn't affected.
            const original = becca.getBranchFromChildAndParent.bind(becca);
            vi.spyOn(becca, "getBranchFromChildAndParent").mockImplementation((childNoteId, parentNoteId) => {
                const branch = original(childNoteId, parentNoteId);
                if (branch) {
                    Object.defineProperty(branch, "branchId", { value: "ghostBranch123", configurable: true });
                }
                return branch;
            });

            const res = await api.post<TreeResponse>("/api/tree/load", { body: { noteIds: [ "root" ] } });
            expect(res.status).toBe(200);
            expect(res.body.branches.some((b) => b.branchId === "ghostBranch123")).toBe(false);
        });

        it("skips a collected attribute id that is missing from the cache", async () => {
            const { noteId } = await createTextNote(api, { title: "Note with ghost attribute" });
            const note = becca.notes[noteId];
            // Replace the note's owned attributes with one whose id is absent from becca.attributes.
            vi.spyOn(note, "ownedAttributes", "get").mockReturnValue([
                { attributeId: "ghostAttr123", type: "label", name: "x", targetNote: undefined } as never
            ]);

            const res = await api.post<TreeResponse>("/api/tree/load", { body: { noteIds: [ noteId ] } });
            expect(res.status).toBe(200);
            const attrs = res.body.attributes as { attributeId?: string }[];
            expect(attrs.some((a) => a.attributeId === "ghostAttr123")).toBe(false);
        });
    });
});
