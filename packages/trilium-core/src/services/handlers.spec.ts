import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getBecca } from "../becca/becca.js";
import BAttribute from "../becca/entities/battribute.js";
import BBranch from "../becca/entities/bbranch.js";
import { buildNote } from "../test/becca_easy_mocking.js";
import config from "./config.js";
import eventService from "./events.js";
import handlers from "./handlers.js";
import hiddenSubtreeService from "./hidden_subtree.js";
import noteService from "./notes.js";
import oneTimeTimer from "./one_time_timer.js";
import scriptService from "./script.js";
import treeService from "./tree.js";
import { randomString } from "./utils/index.js";

// handlers.ts only subscribes to events at import time, so it is otherwise
// covered incidentally (whenever some unrelated test happens to fire one of
// these events), which makes its coverage flaky. These tests drive the handlers
// deterministically by emitting the events and spying on the downstream
// singletons (which handlers.ts holds direct references to).

function addAttribute(noteId: string, type: "label" | "relation", name: string, value: string) {
    return new BAttribute({ noteId, attributeId: randomString(12), type, name, value, position: 0, isInheritable: false });
}

describe("handlers", () => {
    const originalScriptingEnabled = config.Security.backendScriptingEnabled;

    let sortNotesIfNeeded: ReturnType<typeof vi.spyOn>;
    let executeNoteNoException: ReturnType<typeof vi.spyOn>;
    let duplicateSubtree: ReturnType<typeof vi.spyOn>;
    let scheduleExecution: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        getBecca().reset();
        buildNote({ id: "root", title: "root" });
        config.Security.backendScriptingEnabled = true;

        sortNotesIfNeeded = vi.spyOn(treeService, "sortNotesIfNeeded").mockImplementation(() => {});
        executeNoteNoException = vi.spyOn(scriptService, "executeNoteNoException").mockImplementation(() => {});
        duplicateSubtree = vi.spyOn(noteService, "duplicateSubtreeWithoutRoot").mockImplementation(() => {});
        scheduleExecution = vi.spyOn(oneTimeTimer, "scheduleExecution").mockImplementation(() => {});
        vi.spyOn(hiddenSubtreeService, "checkHiddenSubtree").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        config.Security.backendScriptingEnabled = originalScriptingEnabled;
    });

    describe("runAttachedRelations", () => {
        it("does nothing when backend scripting is disabled", () => {
            config.Security.backendScriptingEnabled = false;
            buildNote({ id: "target", type: "code", mime: "application/javascript;env=backend", content: "" });
            const note = buildNote({ id: "src" });
            addAttribute("src", "relation", "runOnNoteChange", "target");

            handlers.runAttachedRelations(note, "runOnNoteChange", note);
            expect(executeNoteNoException).not.toHaveBeenCalled();
        });

        it("executes each unique target note exactly once", () => {
            const target = buildNote({ id: "target", type: "code", mime: "application/javascript;env=backend", content: "" });
            const note = buildNote({ id: "src" });
            // Two relations pointing at the same target — must only execute once.
            addAttribute("src", "relation", "runOnNoteChange", "target");
            addAttribute("src", "relation", "runOnNoteChange", "target");

            handlers.runAttachedRelations(note, "runOnNoteChange", note);
            expect(executeNoteNoException).toHaveBeenCalledTimes(1);
            expect(executeNoteNoException).toHaveBeenCalledWith(target, expect.objectContaining({ originEntity: note }));
        });

        it("ignores relations whose target note is missing", () => {
            const note = buildNote({ id: "src" });
            addAttribute("src", "relation", "runOnNoteChange", "does-not-exist");

            handlers.runAttachedRelations(note, "runOnNoteChange", note);
            expect(executeNoteNoException).not.toHaveBeenCalled();
        });
    });

    describe("NOTE_TITLE_CHANGED", () => {
        it("runs runOnNoteTitleChange scripts", () => {
            const target = buildNote({ id: "t2", type: "code", mime: "application/javascript;env=backend", content: "" });
            const note = buildNote({ id: "s2" });
            addAttribute("s2", "relation", "runOnNoteTitleChange", "t2");

            eventService.emit(eventService.NOTE_TITLE_CHANGED, note);
            expect(executeNoteNoException).toHaveBeenCalledWith(target, expect.anything());
        });

        it("re-sorts a sorted parent", () => {
            buildNote({ id: "par2", children: [{ id: "chld2" }] });
            addAttribute("par2", "label", "sorted", "");
            const child = getBecca().notes["chld2"];
            expect(child).toBeDefined();

            eventService.emit(eventService.NOTE_TITLE_CHANGED, child);
            expect(sortNotesIfNeeded).toHaveBeenCalledWith("par2");
        });
    });

    describe("ENTITY_CHANGED (attributes)", () => {
        it("re-sorts the owning note when a 'sorted' label changes", () => {
            buildNote({ id: "p" });
            const attr = addAttribute("p", "label", "sorted", "");

            eventService.emit(eventService.ENTITY_CHANGED, { entityName: "attributes", entity: attr });
            expect(sortNotesIfNeeded).toHaveBeenCalledWith("p");
        });

        it("re-sorts the parent when a sort-affecting label (e.g. 'top') changes", () => {
            buildNote({ id: "par", children: [{ id: "chld" }] });
            addAttribute("par", "label", "sorted", "title");
            const topAttr = addAttribute("chld", "label", "top", "");

            eventService.emit(eventService.ENTITY_CHANGED, { entityName: "attributes", entity: topAttr });
            expect(sortNotesIfNeeded).toHaveBeenCalledWith("par");
        });
    });

    describe("ENTITY_CREATED (template relation)", () => {
        it("copies template content and subtree into an empty note", () => {
            buildNote({ id: "tmpl", type: "text", mime: "text/html", content: "TEMPLATE BODY" });
            const note = buildNote({ id: "n", type: "text", mime: "text/html", content: "" });
            const setContent = vi.spyOn(note, "setContent").mockImplementation(() => {});
            vi.spyOn(note, "save").mockReturnValue(note);
            const rel = addAttribute("n", "relation", "template", "tmpl");

            eventService.emit(eventService.ENTITY_CREATED, { entityName: "attributes", entity: rel });

            expect(setContent).toHaveBeenCalledWith("TEMPLATE BODY");
            expect(duplicateSubtree).toHaveBeenCalledWith("tmpl", "n");
        });
    });

    describe("ENTITY_DELETED", () => {
        it("reschedules a hidden-subtree check when a system ('_') note is deleted", () => {
            const sysNote = buildNote({ id: "_systemDeleted", title: "sys" });

            eventService.emit(eventService.ENTITY_DELETED, { entityName: "notes", entity: sysNote });
            expect(scheduleExecution).toHaveBeenCalledWith("hidden-subtree-check", expect.any(Number), expect.any(Function));
        });
    });

    describe("runOn* relation events", () => {
        function buildTargetAndSource(relationName: string, sourceId: string) {
            const target = buildNote({ id: `${sourceId}-tgt`, type: "code", mime: "application/javascript;env=backend", content: "" });
            const source = buildNote({ id: sourceId });
            addAttribute(sourceId, "relation", relationName, target.noteId);
            return { target, source };
        }

        it("runs runOnNoteContentChange when note content changes", () => {
            const { target, source } = buildTargetAndSource("runOnNoteContentChange", "ncc");
            eventService.emit(eventService.NOTE_CONTENT_CHANGE, { entity: source });
            expect(executeNoteNoException).toHaveBeenCalledWith(target, expect.anything());
        });

        it("runs runOnChildNoteCreation on the parent when a child is created", () => {
            const { target, source } = buildTargetAndSource("runOnChildNoteCreation", "cnc");
            const child = buildNote({ id: "cnc-child" });
            eventService.emit(eventService.CHILD_NOTE_CREATED, { parentNote: source, childNote: child });
            expect(executeNoteNoException).toHaveBeenCalledWith(target, expect.anything());
        });

        it("runs runOnNoteCreation when a note is created", () => {
            const { target, source } = buildTargetAndSource("runOnNoteCreation", "ncr");
            eventService.emit(eventService.ENTITY_CREATED, { entityName: "notes", entity: source });
            expect(executeNoteNoException).toHaveBeenCalledWith(target, expect.anything());
        });

        it("runs runOnAttributeCreation when an attribute is created", () => {
            const { target } = buildTargetAndSource("runOnAttributeCreation", "acr");
            const trigger = addAttribute("acr", "label", "someLabel", "");
            eventService.emit(eventService.ENTITY_CREATED, { entityName: "attributes", entity: trigger });
            expect(executeNoteNoException).toHaveBeenCalledWith(target, expect.anything());
        });

        it("runs runOnBranchCreation and re-sorts a sorted parent when a branch is created", () => {
            const target = buildNote({ id: "bcr-tgt", type: "code", mime: "application/javascript;env=backend", content: "" });
            const parent = buildNote({ id: "bcr-parent" });
            addAttribute("bcr-parent", "label", "sorted", "");
            buildNote({ id: "bcr-child" });
            addAttribute("bcr-child", "relation", "runOnBranchCreation", target.noteId);
            const branch = new BBranch({ noteId: "bcr-child", parentNoteId: parent.noteId, branchId: "bcr-parent_bcr-child" });

            eventService.emit(eventService.ENTITY_CREATED, { entityName: "branches", entity: branch });
            expect(executeNoteNoException).toHaveBeenCalledWith(target, expect.anything());
            expect(sortNotesIfNeeded).toHaveBeenCalledWith("bcr-parent");
        });

        it("runs runOnBranchChange and re-sorts a sorted parent when a branch changes", () => {
            const target = buildNote({ id: "bch-tgt", type: "code", mime: "application/javascript;env=backend", content: "" });
            const parent = buildNote({ id: "bch-parent" });
            addAttribute("bch-parent", "label", "sorted", "");
            buildNote({ id: "bch-child" });
            addAttribute("bch-child", "relation", "runOnBranchChange", target.noteId);
            const branch = new BBranch({ noteId: "bch-child", parentNoteId: parent.noteId, branchId: "bch-parent_bch-child" });

            eventService.emit(eventService.ENTITY_CHANGED, { entityName: "branches", entity: branch });
            expect(executeNoteNoException).toHaveBeenCalledWith(target, expect.anything());
            expect(sortNotesIfNeeded).toHaveBeenCalledWith("bch-parent");
        });

        it("runs runOnBranchDeletion when a branch is deleted", () => {
            const target = buildNote({ id: "bdl-tgt", type: "code", mime: "application/javascript;env=backend", content: "" });
            buildNote({ id: "bdl-child" });
            addAttribute("bdl-child", "relation", "runOnBranchDeletion", target.noteId);
            const branch = new BBranch({ noteId: "bdl-child", parentNoteId: "root", branchId: "root_bdl-child" });

            eventService.emit(eventService.ENTITY_DELETED, { entityName: "branches", entity: branch });
            expect(executeNoteNoException).toHaveBeenCalledWith(target, expect.anything());
        });
    });
});
