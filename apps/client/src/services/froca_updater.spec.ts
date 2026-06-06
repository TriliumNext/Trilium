import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../components/app_context.js";
import FAttachment from "../entities/fattachment.js";
import FAttribute from "../entities/fattribute.js";
import FBranch from "../entities/fbranch.js";
import type { EntityChange } from "../server_types.js";
import froca from "./froca.js";
import frocaUpdater from "./froca_updater.js";
import type LoadResults from "./load_results.js";
import noteAttributeCache from "./note_attribute_cache.js";
import options from "./options.js";
import utils from "./utils.js";
import { buildNote } from "../test/easy-froca.js";

function ec(overrides: Partial<EntityChange>): EntityChange {
    return {
        entityName: "notes",
        entityId: "x",
        hash: "h",
        isSynced: false,
        isErased: false,
        ...overrides
    } as EntityChange;
}

let triggerSpy: ReturnType<typeof vi.fn>;
let reloadSpy: ReturnType<typeof vi.fn>;
let reloadNotesSpy: ReturnType<typeof vi.fn>;
let invalidateSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
    triggerSpy = vi.fn(async () => []);
    appContext.triggerEvent = triggerSpy as typeof appContext.triggerEvent;

    reloadSpy = vi.fn();
    utils.reloadFrontendApp = reloadSpy as typeof utils.reloadFrontendApp;

    reloadNotesSpy = vi.fn(async () => {});
    froca.reloadNotes = reloadNotesSpy as typeof froca.reloadNotes;

    invalidateSpy = vi.spyOn(noteAttributeCache, "invalidate") as unknown as ReturnType<typeof vi.fn>;
});

afterEach(() => {
    vi.restoreAllMocks();
});

const process = (changes: EntityChange[]) => frocaUpdater.processEntityChanges(changes);

describe("froca_updater - empty / no-op handling", () => {
    it("does nothing (no event) when there are no meaningful changes", async () => {
        // blobs is a NOOP and produces an empty LoadResults
        await process([ec({ entityName: "blobs", entityId: "blob1", entity: { isDeleted: false } as any })]);
        expect(triggerSpy).not.toHaveBeenCalled();
        expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it("throws a wrapped error for an unknown entityName", async () => {
        await expect(process([ec({ entityName: "weird" as any, entityId: "z" })]))
            .rejects.toThrow(/Unknown entityName 'weird'/);
    });
});

describe("froca_updater - note changes", () => {
    it("ignores a note change for a note not in froca", async () => {
        await process([ec({ entityName: "notes", entityId: "not-loaded-note", entity: {} as any })]);
        expect(triggerSpy).not.toHaveBeenCalled();
    });

    it("triggers a full reload when an in-froca note is erased", async () => {
        const note = buildNote({ title: "Erasable" });
        await process([ec({ entityName: "notes", entityId: note.noteId, isErased: true })]);
        expect(reloadSpy).toHaveBeenCalledTimes(1);
        // event still fires because addNote populated the load results
        expect(triggerSpy).toHaveBeenCalledTimes(1);
        expect(note.noteId in froca.notes).toBe(true); // not deleted, early return
    });

    it("deletes the note from froca when marked deleted", async () => {
        const note = buildNote({ title: "Doomed" });
        await process([ec({ entityName: "notes", entityId: note.noteId, entity: { isDeleted: true } as any })]);
        expect(note.noteId in froca.notes).toBe(false);
        expect(triggerSpy).toHaveBeenCalledTimes(1);
    });

    it("updates a note and registers content change when blobId changes and protection is unchanged", async () => {
        const note = buildNote({ title: "Old" });
        note.blobId = "oldBlob";
        froca.blobPromises[`${note.noteId}-content`] = Promise.resolve(null as any);
        froca.blobPromises["unrelated-key"] = Promise.resolve(null as any);

        const row = {
            noteId: note.noteId,
            title: "New",
            isProtected: false,
            type: "text",
            mime: "text/html",
            blobId: "newBlob"
        };
        await process([ec({ entityName: "notes", entityId: note.noteId, componentId: "comp-x", entity: row as any })]);

        expect(note.title).toBe("New");
        expect(note.blobId).toBe("newBlob");
        // blob promise key including the noteId is cleared, unrelated one remains
        expect(`${note.noteId}-content` in froca.blobPromises).toBe(false);
        expect("unrelated-key" in froca.blobPromises).toBe(true);
        expect(triggerSpy).toHaveBeenCalledTimes(1);

        // The named behaviour: a content change is actually REGISTERED in the load results
        // (addNoteContent branch). Inspect the payload delivered to triggerEvent.
        expect(triggerSpy).toHaveBeenCalledWith("entitiesReloaded", expect.anything());
        const loadResults = triggerSpy.mock.calls[0][1].loadResults as LoadResults;
        expect(loadResults.isNoteContentReloaded(note.noteId)).toBeTruthy();
    });

    it("does not register content change when protection status changed", async () => {
        const note = buildNote({ title: "Prot" });
        note.blobId = "oldBlob";
        note.isProtected = false;
        const row = {
            noteId: note.noteId,
            title: "Prot",
            isProtected: true,
            type: "text",
            mime: "text/html",
            blobId: "newBlob2"
        };
        await process([ec({ entityName: "notes", entityId: note.noteId, componentId: "comp-y", entity: row as any })]);
        expect(note.isProtected).toBe(true);
        expect(note.blobId).toBe("newBlob2");

        // The defining behaviour: despite the blobId change, NO content change is registered
        // because the protection status flipped. Inspect the load results payload to confirm
        // addNoteContent was skipped (the note is still tracked, but not as a content reload).
        expect(triggerSpy).toHaveBeenCalledWith("entitiesReloaded", expect.anything());
        const loadResults = triggerSpy.mock.calls[0][1].loadResults as LoadResults;
        expect(loadResults.isNoteContentReloaded(note.noteId)).toBeFalsy();
        // ...but the note itself is still recorded as reloaded (addNote ran regardless).
        expect(loadResults.isNoteReloaded(note.noteId)).toBe(true);
    });

    it("updates a note without componentId (no content registration branch)", async () => {
        const note = buildNote({ title: "NoComp" });
        note.blobId = "b1";
        const row = {
            noteId: note.noteId,
            title: "NoComp",
            isProtected: false,
            type: "text",
            mime: "text/html",
            blobId: "b2"
        };
        await process([ec({ entityName: "notes", entityId: note.noteId, entity: row as any })]);
        expect(note.blobId).toBe("b2");
    });
});

describe("froca_updater - branch changes", () => {
    it("triggers a full reload when an in-froca branch is erased", async () => {
        const parent = buildNote({ title: "P", children: [{ title: "C" }] });
        const branchId = `${parent.noteId}_${parent.children[0]}`;
        await process([ec({ entityName: "branches", entityId: branchId, isErased: true })]);
        expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it("removes a deleted branch and unlinks parent/child", async () => {
        const parent = buildNote({ title: "Par", children: [{ title: "Chi" }] });
        const childId = parent.children[0];
        const branchId = `${parent.noteId}_${childId}`;
        const child = froca.notes[childId];

        await process([ec({
            entityName: "branches",
            entityId: branchId,
            componentId: "comp-b",
            entity: { isDeleted: true } as any
        })]);

        expect(branchId in froca.branches).toBe(false);
        expect(parent.children.includes(childId)).toBe(false);
        expect(childId in parent.childToBranch).toBe(false);
        expect(child.parents.includes(parent.noteId)).toBe(false);
        expect(parent.noteId in child.parentToBranch).toBe(false);
        // branch change => attribute-related => invalidate cache + event
        expect(invalidateSpy).toHaveBeenCalled();
        expect(triggerSpy).toHaveBeenCalledTimes(1);
    });

    it("returns early for a deleted branch that is not loaded", async () => {
        await process([ec({
            entityName: "branches",
            entityId: "unknown-branch",
            entity: { isDeleted: true } as any
        })]);
        expect(triggerSpy).not.toHaveBeenCalled();
    });

    it("updates an existing branch", async () => {
        const parent = buildNote({ title: "UP", children: [{ title: "UC" }] });
        const childId = parent.children[0];
        const branchId = `${parent.noteId}_${childId}`;
        const row = {
            branchId,
            noteId: childId,
            parentNoteId: parent.noteId,
            notePosition: 999,
            fromSearchNote: false,
            prefix: "pref"
        };
        await process([ec({ entityName: "branches", entityId: branchId, entity: row as any })]);
        expect(froca.branches[branchId].notePosition).toBe(999);
        expect(froca.branches[branchId].prefix).toBe("pref");
    });

    it("creates a new branch when both child and parent notes are present", async () => {
        const parent = buildNote({ title: "NewParent" });
        const child = buildNote({ title: "NewChild" });
        const branchId = `new_${child.noteId}`;
        const row = {
            branchId,
            noteId: child.noteId,
            parentNoteId: parent.noteId,
            notePosition: 10,
            fromSearchNote: false
        };
        await process([ec({ entityName: "branches", entityId: branchId, componentId: "c1", entity: row as any })]);

        expect(branchId in froca.branches).toBe(true);
        expect(child.parents.includes(parent.noteId)).toBe(true);
        expect(parent.children.includes(child.noteId)).toBe(true);
    });

    it("fetches the parent note via froca.getNote when child exists but parent is missing", async () => {
        const child = buildNote({ title: "OrphanChild" });
        const fetchedParent = buildNote({ title: "FetchedParent" });
        const getNoteSpy = vi.spyOn(froca, "getNote").mockResolvedValue(fetchedParent);

        const branchId = `fetch_${child.noteId}`;
        const row = {
            branchId,
            noteId: child.noteId,
            parentNoteId: "missing-parent-id",
            notePosition: 0,
            fromSearchNote: false
        };
        await process([ec({ entityName: "branches", entityId: branchId, entity: row as any })]);

        expect(getNoteSpy).toHaveBeenCalledWith("missing-parent-id");
        expect(branchId in froca.branches).toBe(true);
        expect(fetchedParent.children.includes(child.noteId)).toBe(true);
    });

    it("does not create a branch when neither child nor parent note is present", async () => {
        const branchId = "ghost-branch";
        const row = {
            branchId,
            noteId: "ghost-child",
            parentNoteId: "ghost-parent",
            notePosition: 0,
            fromSearchNote: false
        };
        // root child guard: only fetches parent when childNote exists; here it doesn't
        await process([ec({ entityName: "branches", entityId: branchId, entity: row as any })]);
        expect(branchId in froca.branches).toBe(false);
    });

    it("reloads the parent note when a new branch references an unloaded parent", async () => {
        const child = buildNote({ title: "ReloadChild" });
        // parent not in froca => missingNoteIds path
        const branchId = `reload_${child.noteId}`;
        const row = {
            branchId,
            noteId: child.noteId,
            parentNoteId: "absent-parent",
            notePosition: 0,
            fromSearchNote: false
        };
        // avoid the getNote fetch path by stubbing it to return null so branch isn't created via parent
        vi.spyOn(froca, "getNote").mockResolvedValue(null);
        await process([ec({ entityName: "branches", entityId: branchId, entity: row as any })]);
        expect(reloadNotesSpy).toHaveBeenCalledWith(["absent-parent"]);
    });
});

describe("froca_updater - note reordering", () => {
    it("updates branch positions and sorts affected parents", async () => {
        const parent = buildNote({ title: "RP", children: [{ title: "RC1" }, { title: "RC2" }] });
        const b1 = `${parent.noteId}_${parent.children[0]}`;
        const b2 = `${parent.noteId}_${parent.children[1]}`;
        const sortSpy = vi.spyOn(parent, "sortChildren");

        await process([ec({
            entityName: "note_reordering",
            entityId: parent.noteId,
            componentId: "comp-r",
            positions: { [b1]: 50, [b2]: 5, "ghost-branch-id": 1 }
        })]);

        expect(froca.branches[b1].notePosition).toBe(50);
        expect(froca.branches[b2].notePosition).toBe(5);
        expect(sortSpy).toHaveBeenCalled();
        expect(triggerSpy).toHaveBeenCalledTimes(1);
    });

    it("handles a reordering with no componentId and parent note absent", async () => {
        const orphanBranchParent = buildNote({ title: "OBP", children: [{ title: "OBC" }] });
        const b = `${orphanBranchParent.noteId}_${orphanBranchParent.children[0]}`;
        // remove the parent note from froca so the sort branch is skipped
        delete froca.notes[orphanBranchParent.noteId];
        await process([ec({
            entityName: "note_reordering",
            entityId: orphanBranchParent.noteId,
            positions: { [b]: 7 }
        })]);
        expect(froca.branches[b].notePosition).toBe(7);
    });
});

describe("froca_updater - revisions / options / etapi_tokens", () => {
    it("adds a revision and fires the event", async () => {
        await process([ec({ entityName: "revisions", entityId: "rev1", noteId: "n1", componentId: "c" })]);
        expect(triggerSpy).toHaveBeenCalledTimes(1);
        // The product of processEntityChanges is the LoadResults payload: assert the revision
        // was actually recorded for the right note, not merely that the event fired.
        expect(triggerSpy).toHaveBeenCalledWith("entitiesReloaded", expect.anything());
        const loadResults = triggerSpy.mock.calls[0][1].loadResults as LoadResults;
        expect(loadResults.hasRevisionForNote("n1")).toBe(true);
        expect(loadResults.hasRevisionForNote("other-note")).toBe(false);
    });

    it("sets an option and records it, but skips openNoteContexts noise", async () => {
        const setSpy = vi.spyOn(options, "set").mockImplementation(() => {});
        await process([
            ec({ entityName: "options", entityId: "o1", entity: { name: "openNoteContexts", value: "[]" } as any }),
            ec({ entityName: "options", entityId: "o2", entity: { name: "eraseEntitiesAfterTimeInSeconds", value: "10" } as any })
        ]);
        expect(setSpy).toHaveBeenCalledTimes(1);
        expect(setSpy).toHaveBeenCalledWith("eraseEntitiesAfterTimeInSeconds", "10");
        expect(triggerSpy).toHaveBeenCalledTimes(1);
    });

    it("marks etapi token changes", async () => {
        await process([ec({ entityName: "etapi_tokens", entityId: "tok1", entity: { isDeleted: false } as any })]);
        expect(triggerSpy).toHaveBeenCalledTimes(1);
        // Assert the recorded state, not just that the event fired.
        expect(triggerSpy).toHaveBeenCalledWith("entitiesReloaded", expect.anything());
        const loadResults = triggerSpy.mock.calls[0][1].loadResults as LoadResults;
        expect(loadResults.hasEtapiTokenChanges).toBe(true);
    });
});

describe("froca_updater - attribute changes", () => {
    it("triggers a full reload when an in-froca attribute is erased", async () => {
        const note = buildNote({ title: "AttrNote", "#color": "red" });
        const attrId = note.attributes[0];
        await process([ec({ entityName: "attributes", entityId: attrId, isErased: true })]);
        expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it("removes a deleted relation attribute and unlinks source + target", async () => {
        const target = buildNote({ title: "Target" });
        const source = buildNote({ title: "Source", [`~mylink`]: target.noteId } as any);
        const attrId = source.attributes[0];
        const attr = froca.attributes[attrId];
        // Wire the target relation manually (easy-froca does not).
        target.targetRelations.push(attrId);

        await process([ec({
            entityName: "attributes",
            entityId: attrId,
            componentId: "comp-a",
            entity: { isDeleted: true } as any
        })]);

        expect(attrId in froca.attributes).toBe(false);
        expect(source.attributes.includes(attrId)).toBe(false);
        expect(target.targetRelations.includes(attrId)).toBe(false);
        expect(invalidateSpy).toHaveBeenCalled();
        expect(triggerSpy).toHaveBeenCalledTimes(1);

        // The deleted attr was captured before deletion; type was relation.
        expect(attr.type).toBe("relation");
    });

    it("returns early for a deleted attribute that is not loaded", async () => {
        await process([ec({
            entityName: "attributes",
            entityId: "unknown-attr",
            entity: { isDeleted: true } as any
        })]);
        expect(triggerSpy).not.toHaveBeenCalled();
    });

    it("updates an existing attribute", async () => {
        const note = buildNote({ title: "UpdAttr", "#size": "small" });
        const attrId = note.attributes[0];
        const row = {
            attributeId: attrId,
            noteId: note.noteId,
            type: "label",
            name: "size",
            value: "large",
            isInheritable: false,
            position: 0
        };
        await process([ec({ entityName: "attributes", entityId: attrId, entity: row as any })]);
        expect(froca.attributes[attrId].value).toBe("large");
    });

    it("creates a new label attribute linked to its source note", async () => {
        const note = buildNote({ title: "NewLabelHost" });
        const attrId = "brand-new-attr";
        const row = {
            attributeId: attrId,
            noteId: note.noteId,
            type: "label",
            name: "fresh",
            value: "v",
            isInheritable: false,
            position: 0
        };
        await process([ec({ entityName: "attributes", entityId: attrId, componentId: "c", entity: row as any })]);
        expect(attrId in froca.attributes).toBe(true);
        expect(note.attributes.includes(attrId)).toBe(true);

        // Re-processing the same create must not duplicate the id in source.attributes.
        await process([ec({ entityName: "attributes", entityId: attrId, componentId: "c", entity: row as any })]);
        expect(note.attributes.filter((a) => a === attrId).length).toBe(1);
    });

    it("creates a new relation attribute linked to source and target", async () => {
        const source = buildNote({ title: "RelSource" });
        const target = buildNote({ title: "RelTarget" });
        const attrId = "brand-new-relation";
        const row = {
            attributeId: attrId,
            noteId: source.noteId,
            type: "relation",
            name: "rel",
            value: target.noteId,
            isInheritable: false,
            position: 0
        };
        await process([ec({ entityName: "attributes", entityId: attrId, entity: row as any })]);
        expect(source.attributes.includes(attrId)).toBe(true);
        expect(target.targetRelations.includes(attrId)).toBe(true);

        // Re-processing must not duplicate in targetRelations either (attribute now exists => update path).
        const attr = froca.attributes[attrId];
        // force the "new" branch again by deleting then re-adding while keeping links
        delete froca.attributes[attrId];
        await process([ec({ entityName: "attributes", entityId: attrId, entity: row as any })]);
        expect(target.targetRelations.filter((a) => a === attrId).length).toBe(1);
        expect(attr.name).toBe("rel");
    });

    it("does nothing when neither source nor target note is loaded", async () => {
        const attrId = "orphan-attr";
        const row = {
            attributeId: attrId,
            noteId: "absent-source",
            type: "label",
            name: "x",
            value: "y",
            isInheritable: false,
            position: 0
        };
        await process([ec({ entityName: "attributes", entityId: attrId, entity: row as any })]);
        expect(attrId in froca.attributes).toBe(false);
    });

    it("reloads target note for a new inherit/template relation pointing to an unloaded note", async () => {
        const source = buildNote({ title: "TplSource" });
        const attrId = "tpl-attr";
        const row = {
            attributeId: attrId,
            noteId: source.noteId,
            type: "relation",
            name: "template",
            value: "unloaded-template-target",
            isInheritable: false,
            position: 0
        };
        await process([ec({ entityName: "attributes", entityId: attrId, entity: row as any })]);
        expect(reloadNotesSpy).toHaveBeenCalledWith(["unloaded-template-target"]);
    });

    it("skips erased entities in the missing-note ancestor scan", async () => {
        // attribute relation 'inherit' but with no entity (erased) must not push to missingNoteIds
        const note = buildNote({ title: "ErasedAttrHost", "~inherit": "target-loaded" });
        const attrId = note.attributes[0];
        await process([ec({ entityName: "attributes", entityId: attrId, isErased: true, entity: undefined })]);
        // The attribute IS in froca via buildNote and is erased => the early reloadFrontendApp()
        // path is taken (this is the code path actually hit by this fixture).
        expect(reloadSpy).toHaveBeenCalledTimes(1);
        // And because the ancestor scan sees entity === undefined it must NOT reload the target note.
        expect(reloadNotesSpy).not.toHaveBeenCalled();
    });

    it("ancestor scan 'continue' branch: an erased attribute absent from froca reloads nothing", async () => {
        // An erased attribute that is NOT in froca.attributes: the early reload short-circuit is
        // skipped (attribute not loaded), so the ancestor scan runs and hits `if (!entity) continue`.
        await process([ec({ entityName: "attributes", entityId: "never-loaded-attr", isErased: true, entity: undefined })]);
        // No early full reload (attribute was not in froca) ...
        expect(reloadSpy).not.toHaveBeenCalled();
        // ... no per-note reload (the scan's continue branch skipped the missing-note push) ...
        expect(reloadNotesSpy).not.toHaveBeenCalled();
        // ... and the load results stay empty, so no event fires.
        expect(triggerSpy).not.toHaveBeenCalled();
    });
});

describe("froca_updater - attachment changes", () => {
    it("triggers a full reload when an in-froca attachment is erased", async () => {
        const note = buildNote({ title: "AttHost" });
        const att = new FAttachment(froca, {
            attachmentId: "att-erase",
            ownerId: note.noteId,
            role: "file",
            mime: "text/plain",
            title: "a",
            dateModified: "",
            utcDateModified: "",
            utcDateScheduledForErasureSince: "",
            contentLength: 0
        });
        froca.attachments[att.attachmentId] = att;

        await process([ec({ entityName: "attachments", entityId: att.attachmentId, isErased: true })]);
        expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it("removes a deleted attachment from its owner note", async () => {
        const note = buildNote({ title: "AttOwner" });
        const att = new FAttachment(froca, {
            attachmentId: "att-del",
            ownerId: note.noteId,
            role: "file",
            mime: "text/plain",
            title: "a",
            dateModified: "",
            utcDateModified: "",
            utcDateScheduledForErasureSince: "",
            contentLength: 0
        });
        froca.attachments[att.attachmentId] = att;
        note.attachments = [att];

        await process([ec({
            entityName: "attachments",
            entityId: att.attachmentId,
            entity: { attachmentId: att.attachmentId, isDeleted: true } as any
        })]);

        expect("att-del" in froca.attachments).toBe(false);
        expect(note.attachments?.some((a) => a.attachmentId === "att-del")).toBe(false);
        expect(triggerSpy).toHaveBeenCalledTimes(1);
    });

    it("returns early for a deleted attachment that is not loaded", async () => {
        await process([ec({
            entityName: "attachments",
            entityId: "unknown-att",
            entity: { attachmentId: "unknown-att", isDeleted: true } as any
        })]);
        expect(triggerSpy).not.toHaveBeenCalled();
    });

    it("updates an existing attachment", async () => {
        const note = buildNote({ title: "AttUpd" });
        const att = new FAttachment(froca, {
            attachmentId: "att-upd",
            ownerId: note.noteId,
            role: "file",
            mime: "text/plain",
            title: "old",
            dateModified: "",
            utcDateModified: "",
            utcDateScheduledForErasureSince: "",
            contentLength: 0
        });
        froca.attachments[att.attachmentId] = att;

        await process([ec({
            entityName: "attachments",
            entityId: "att-upd",
            entity: {
                attachmentId: "att-upd",
                ownerId: note.noteId,
                role: "file",
                mime: "text/plain",
                title: "new",
                dateModified: "",
                utcDateModified: "",
                utcDateScheduledForErasureSince: "",
                contentLength: 5
            } as any
        })]);
        expect(froca.attachments["att-upd"].title).toBe("new");
    });

    it("creates a new attachment on its owner note when not previously loaded", async () => {
        const note = buildNote({ title: "AttCreate" });
        note.attachments = [];
        await process([ec({
            entityName: "attachments",
            entityId: "att-create",
            entity: {
                attachmentId: "att-create",
                ownerId: note.noteId,
                role: "file",
                mime: "text/plain",
                title: "created",
                dateModified: "",
                utcDateModified: "",
                utcDateScheduledForErasureSince: "",
                contentLength: 1
            } as any
        })]);
        expect(note.attachments?.some((a) => a.attachmentId === "att-create")).toBe(true);
    });

    it("handles a new attachment whose owner note is absent (no crash, still records row)", async () => {
        await process([ec({
            entityName: "attachments",
            entityId: "att-noowner",
            entity: {
                attachmentId: "att-noowner",
                ownerId: "absent-owner",
                role: "file",
                mime: "text/plain",
                title: "x",
                dateModified: "",
                utcDateModified: "",
                utcDateScheduledForErasureSince: "",
                contentLength: 0
            } as any
        })]);
        expect(triggerSpy).toHaveBeenCalledTimes(1);
        // The attachment row is still recorded even though the owner note is absent.
        expect(triggerSpy).toHaveBeenCalledWith("entitiesReloaded", expect.anything());
        const loadResults = triggerSpy.mock.calls[0][1].loadResults as LoadResults;
        expect(loadResults.getAttachmentRows().some((a) => a.attachmentId === "att-noowner")).toBe(true);
    });
});

describe("froca_updater - branch coverage edge cases", () => {
    it("updates a note without registering content when blobId is unchanged", async () => {
        const note = buildNote({ title: "SameBlob" });
        note.blobId = "stable-blob";
        const row = {
            noteId: note.noteId,
            title: "SameBlobRenamed",
            isProtected: false,
            type: "text",
            mime: "text/html",
            blobId: "stable-blob"
        };
        await process([ec({ entityName: "notes", entityId: note.noteId, componentId: "comp-same", entity: row as any })]);
        expect(note.title).toBe("SameBlobRenamed");
        expect(note.blobId).toBe("stable-blob");
    });

    it("deletes a branch with no loaded child/parent notes and no componentId", async () => {
        const branchId = "lonely-branch";
        froca.branches[branchId] = new FBranch(froca, {
            branchId,
            noteId: "no-such-child",
            parentNoteId: "no-such-parent",
            notePosition: 0,
            fromSearchNote: false
        });
        await process([ec({
            entityName: "branches",
            entityId: branchId,
            entity: { isDeleted: true } as any
        })]);
        expect(branchId in froca.branches).toBe(false);
    });

    it("deletes a relation attribute whose source/target notes are unloaded and has no componentId", async () => {
        const attrId = "lonely-attr";
        froca.attributes[attrId] = new FAttribute(froca, {
            attributeId: attrId,
            noteId: "no-such-source",
            type: "relation",
            name: "rel",
            value: "no-such-target",
            isInheritable: false,
            position: 0
        });
        await process([ec({
            entityName: "attributes",
            entityId: attrId,
            entity: { isDeleted: true } as any
        })]);
        expect(attrId in froca.attributes).toBe(false);
    });

    it("deletes a label attribute (no target relation) keeping source unlink optional", async () => {
        const attrId = "lonely-label";
        froca.attributes[attrId] = new FAttribute(froca, {
            attributeId: attrId,
            noteId: "no-such-source-2",
            type: "label",
            name: "lbl",
            value: "v",
            isInheritable: false,
            position: 0
        });
        await process([ec({
            entityName: "attributes",
            entityId: attrId,
            componentId: "c",
            entity: { isDeleted: true } as any
        })]);
        expect(attrId in froca.attributes).toBe(false);
    });

    it("deletes an attachment whose owner note has no attachments array", async () => {
        const note = buildNote({ title: "NoAttArray" });
        note.attachments = null;
        const att = new FAttachment(froca, {
            attachmentId: "att-noarray",
            ownerId: note.noteId,
            role: "file",
            mime: "text/plain",
            title: "a",
            dateModified: "",
            utcDateModified: "",
            utcDateScheduledForErasureSince: "",
            contentLength: 0
        });
        froca.attachments[att.attachmentId] = att;
        await process([ec({
            entityName: "attachments",
            entityId: "att-noarray",
            entity: { attachmentId: "att-noarray", isDeleted: true } as any
        })]);
        expect("att-noarray" in froca.attachments).toBe(false);
    });

    it("records an attachment row even when there is no entity payload", async () => {
        // not erased, not deleted, attachment not loaded, and ec.entity is undefined
        await process([ec({ entityName: "attachments", entityId: "att-noentity" })]);
        expect(triggerSpy).toHaveBeenCalledTimes(1);
        // Even with no entity payload, the source still pushes a row (the undefined attachmentEntity)
        // into the load results, which is what makes the event non-empty and fire.
        expect(triggerSpy).toHaveBeenCalledWith("entitiesReloaded", expect.anything());
        const loadResults = triggerSpy.mock.calls[0][1].loadResults as LoadResults;
        expect(loadResults.getAttachmentRows().length).toBe(1);
    });
});

describe("froca_updater - missing-note ancestor reload", () => {
    it("reloads the parent note when a branch references an unloaded parent", async () => {
        const child = buildNote({ title: "MissChild" });
        const branchId = `miss_${child.noteId}`;
        vi.spyOn(froca, "getNote").mockResolvedValue(null);
        await process([ec({
            entityName: "branches",
            entityId: branchId,
            entity: {
                branchId,
                noteId: child.noteId,
                parentNoteId: "totally-absent-parent",
                notePosition: 0,
                fromSearchNote: false
            } as any
        })]);
        expect(reloadNotesSpy).toHaveBeenCalledWith(["totally-absent-parent"]);
    });
});
