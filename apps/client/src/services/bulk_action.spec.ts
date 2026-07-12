import { beforeEach, describe, expect, it, vi } from "vitest";

import FAttribute from "../entities/fattribute.js";
import froca from "./froca.js";
import noteAttributeCache from "./note_attribute_cache.js";
import { buildNote } from "../test/easy-froca";
import bulkActionService, { executeBulkActions } from "./bulk_action";
import AddLabelBulkAction from "../widgets/bulk_actions/label/add_label";
import UpdateLabelValueBulkAction from "../widgets/bulk_actions/label/update_label_value";
import RenameLabelBulkAction from "../widgets/bulk_actions/label/rename_label";
import DeleteLabelBulkAction from "../widgets/bulk_actions/label/delete_label";
import AddRelationBulkAction from "../widgets/bulk_actions/relation/add_relation";
import UpdateRelationTargetBulkAction from "../widgets/bulk_actions/relation/update_relation_target";
import RenameRelationBulkAction from "../widgets/bulk_actions/relation/rename_relation";
import DeleteRelationBulkAction from "../widgets/bulk_actions/relation/delete_relation";
import RenameNoteBulkAction from "../widgets/bulk_actions/note/rename_note";
import MoveNoteBulkAction from "../widgets/bulk_actions/note/move_note";
import ConvertNoteBulkAction from "../widgets/bulk_actions/note/convert_note";
import DeleteNoteBulkAction from "../widgets/bulk_actions/note/delete_note";
import SaveRevisionBulkAction from "../widgets/bulk_actions/note/save_revision";
import DeleteRevisionsBulkAction from "../widgets/bulk_actions/note/delete_revisions";
import ExecuteScriptBulkAction from "../widgets/bulk_actions/execute_script";
import server from "./server.js";
import ws from "./ws.js";
import toast from "./toast.js";

// The target awaits ws.waitForMaxKnownEntityChangeId(), which the global ws stub does not provide.
ws.waitForMaxKnownEntityChangeId = vi.fn(async () => {}) as typeof ws.waitForMaxKnownEntityChangeId;

/** Registers an extra "action" label on an already-built note, bypassing buildNote's unique-key limitation. */
function addActionLabel(noteId: string, value: string) {
    const attribute = new FAttribute(froca, {
        noteId,
        attributeId: `attr_${Math.random().toString(36).slice(2)}`,
        type: "label",
        name: "action",
        value,
        position: 0,
        isInheritable: false
    });
    froca.attributes[attribute.attributeId] = attribute;
    froca.notes[noteId].attributes.push(attribute.attributeId);
    if (!noteAttributeCache.attributes[noteId]) {
        noteAttributeCache.attributes[noteId] = [];
    }
    noteAttributeCache.attributes[noteId].push(attribute);
    return attribute;
}

describe("bulk_action service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ws.waitForMaxKnownEntityChangeId = vi.fn(async () => {}) as typeof ws.waitForMaxKnownEntityChangeId;
    });

    it("exposes the action metadata via the default export", () => {
        expect(bulkActionService.ACTION_CLASSES).toContain(AddLabelBulkAction);
        // Four groups: labels, relations, notes, other.
        expect(bulkActionService.ACTION_GROUPS).toHaveLength(4);
        // Each group contains exactly its concrete action classes, in order.
        expect(bulkActionService.ACTION_GROUPS[0].actions).toEqual([
            AddLabelBulkAction,
            UpdateLabelValueBulkAction,
            RenameLabelBulkAction,
            DeleteLabelBulkAction
        ]);
        expect(bulkActionService.ACTION_GROUPS[1].actions).toEqual([
            AddRelationBulkAction,
            UpdateRelationTargetBulkAction,
            RenameRelationBulkAction,
            DeleteRelationBulkAction
        ]);
        expect(bulkActionService.ACTION_GROUPS[2].actions).toEqual([
            RenameNoteBulkAction,
            MoveNoteBulkAction,
            ConvertNoteBulkAction,
            DeleteNoteBulkAction,
            SaveRevisionBulkAction,
            DeleteRevisionsBulkAction
        ]);
        // The "other" group contains exactly ExecuteScriptBulkAction.
        expect(bulkActionService.ACTION_GROUPS[3].actions).toEqual([ExecuteScriptBulkAction]);
    });

    it("addAction posts an action attribute and waits for sync", async () => {
        server.post = vi.fn(async () => ({})) as typeof server.post;
        const note = buildNote({ title: "Target" });

        await bulkActionService.addAction(note.noteId, "addLabel");

        expect(server.post).toHaveBeenCalledWith(`notes/${note.noteId}/attributes`, {
            type: "label",
            name: "action",
            value: JSON.stringify({ name: "addLabel" })
        });
        expect(ws.waitForMaxKnownEntityChangeId).toHaveBeenCalledTimes(1);
    });

    it("parseActions instantiates known actions and skips invalid/unknown ones", () => {
        const logError = vi.fn();
        (globalThis as any).logError = logError;

        const note = buildNote({ title: "Note with actions" });
        // Valid known action.
        const validAttr = addActionLabel(note.noteId, JSON.stringify({ name: "addLabel", labelName: "foo" }));
        // Invalid JSON -> JSON.parse throws -> catch branch -> null.
        addActionLabel(note.noteId, "{not-valid-json");
        // Valid JSON but unknown action name -> no ActionClass -> null.
        addActionLabel(note.noteId, JSON.stringify({ name: "doesNotExist" }));

        const actions = bulkActionService.parseActions(note);

        // Only the valid known action survives the filter.
        expect(actions).toHaveLength(1);
        expect(actions[0]).toBeInstanceOf(AddLabelBulkAction);
        expect(actions[0].actionDef).toEqual({ name: "addLabel", labelName: "foo" });
        // The constructor threads the producing "action" label into this.attribute,
        // which saveAction/deleteAction later use to PUT/DELETE against the server.
        expect(actions[0].attribute).toBe(validAttr);
        expect(actions[0].attribute.attributeId).toBe(validAttr.attributeId);
        expect(actions[0].attribute.value).toBe(JSON.stringify({ name: "addLabel", labelName: "foo" }));
        // Both failures were logged.
        expect(logError).toHaveBeenCalledTimes(2);
        expect(logError.mock.calls[0][0]).toContain("failed with error");
        expect(logError.mock.calls[1][0]).toContain("No action class");
    });

    it("executeBulkActions posts the actions, waits for sync, and toasts (default includeDescendants)", async () => {
        server.post = vi.fn(async () => ({})) as typeof server.post;
        const toastSpy = vi.spyOn(toast, "showMessage").mockImplementation(() => {});
        const actions = [{ name: "addLabel" }] as any;

        await executeBulkActions(["a", "b"], actions);

        expect(server.post).toHaveBeenCalledWith("bulk-action/execute", {
            noteIds: ["a", "b"],
            includeDescendants: false,
            actions
        });
        expect(ws.waitForMaxKnownEntityChangeId).toHaveBeenCalledTimes(1);
        expect(toastSpy).toHaveBeenCalledTimes(1);
        expect(toastSpy.mock.calls[0][1]).toBe(3000);
    });

    it("executeBulkActions forwards includeDescendants when provided", async () => {
        server.post = vi.fn(async () => ({})) as typeof server.post;
        vi.spyOn(toast, "showMessage").mockImplementation(() => {});

        await executeBulkActions(["x"], [] as any, true);

        expect(server.post).toHaveBeenCalledWith("bulk-action/execute", {
            noteIds: ["x"],
            includeDescendants: true,
            actions: []
        });
    });
});
