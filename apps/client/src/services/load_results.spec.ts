import { describe, expect, it } from "vitest";

import type { EntityChange } from "../server_types.js";
import LoadResults from "./load_results.js";

function ec(entityName: EntityChange["entityName"], entityId: string, entity?: object): EntityChange {
    return { entityName, entityId, entity, hash: "h", isSynced: 1, isErased: 0 } as EntityChange;
}

describe("LoadResults", () => {
    it("indexes only entity changes that carry an entity payload", () => {
        const lr = new LoadResults([
            ec("notes", "n1", { title: "A" }),
            ec("notes", "n2") // no entity -> skipped
        ]);

        expect(lr.getEntityRow("notes", "n1")).toEqual({ title: "A" });
        expect(lr.getEntityRow("notes", "n2")).toBeUndefined();
        // unknown entity name resolves through the optional chain to undefined
        expect(lr.getEntityRow("attributes", "missing")).toBeUndefined();
    });

    it("tracks note <-> component associations across multiple component ids", () => {
        const lr = new LoadResults([]);

        lr.addNote("n1"); // no component id
        lr.addNote("n1", "comp1");
        lr.addNote("n1", "comp1"); // adding the same component id again is a no-op (see dedup test below)
        lr.addNote("n1", "comp2");

        expect(lr.getNoteIds()).toEqual(["n1"]);
        expect(lr.isNoteReloaded("n1")).toBe(true);
        // reloaded only counts components other than the one passed in; comp2 is still present
        expect(lr.isNoteReloaded("n1", "comp1")).toBe(true);
        expect(lr.isNoteReloaded("n2")).toBeFalsy(); // unknown note -> undefined (short-circuit)
        expect(lr.isNoteReloaded(undefined)).toBe(false);
    });

    it("returns reloaded=false when the note has only the excluded component", () => {
        const lr = new LoadResults([]);
        lr.addNote("solo", "comp1");
        expect(lr.isNoteReloaded("solo", "comp1")).toBe(false);
    });

    it("ignores a duplicate component id for the same note", () => {
        // The source guards against pushing the same component id twice
        // (noteIdToComponentId[noteId] only ever contains comp once).
        // LoadResults exposes no getter for the per-note component-id array, so the
        // dedup cannot be observed directly: with the only component excluded,
        // isNoteReloaded returns false whether the array is ["comp"] or ["comp","comp"].
        // We still pin the observable contract that the duplicate add changes nothing.
        const dedup = new LoadResults([]);
        dedup.addNote("dup", "compX");
        dedup.addNote("dup", "compX"); // duplicate add

        // excluding the only (deduped) component => not reloaded for that component
        expect(dedup.isNoteReloaded("dup", "compX")).toBe(false);
        // but reloaded when no component is excluded, and the note id is tracked exactly once
        expect(dedup.isNoteReloaded("dup")).toBe(true);
        expect(dedup.getNoteIds()).toEqual(["dup"]);

        // a result that has only the (single) duplicated component association is non-empty,
        // matching the same observable behaviour as a single add (no phantom extra entries)
        expect(dedup.isEmpty()).toBe(false);

        // adding a *different* component for the same note is reflected (excluding compX
        // still leaves compY visible), confirming the dedup is per-component, not global
        const reload = new LoadResults([]);
        reload.addNote("dup2", "compX");
        reload.addNote("dup2", "compX");
        reload.addNote("dup2", "compY");
        expect(reload.isNoteReloaded("dup2", "compX")).toBe(true);
        expect(reload.isNoteReloaded("dup2", "compY")).toBe(true);
    });

    it("merges branch rows with their tracked component id and drops unknown branches", () => {
        const lr = new LoadResults([ec("branches", "b1", { branchId: "b1", parentNoteId: "p" })]);
        lr.addBranch("b1", "comp1");
        lr.addBranch("b2", "comp2"); // no matching entity -> filtered out

        expect(lr.getBranchRows()).toEqual([{ branchId: "b1", parentNoteId: "p", componentId: "comp1" }]);
    });

    it("filters attribute rows by component id and merges entity data", () => {
        const lr = new LoadResults([
            ec("attributes", "a1", { attributeId: "a1", name: "color" }),
            ec("attributes", "a2", { attributeId: "a2", name: "size" })
        ]);
        lr.addAttribute("a1", "comp1");
        lr.addAttribute("a2", "skip-me");
        lr.addAttribute("a3", "comp1"); // no entity -> filtered out

        expect(lr.getAttributeRows("skip-me")).toEqual([{ attributeId: "a1", name: "color", componentId: "comp1" }]);
        // default component id ("none") keeps everything with a backing entity
        expect(lr.getAttributeRows().map((a) => a.attributeId)).toEqual(["a1", "a2"]);
    });

    it("tracks note reorderings, revisions, content, options and attachments", () => {
        const lr = new LoadResults([]);

        lr.addNoteReordering("parent1", "comp1");
        expect(lr.getNoteReorderings()).toEqual(["parent1"]);

        lr.addRevision("rev1", "noteA", "comp1");
        expect(lr.hasRevisionForNote("noteA")).toBe(true);
        expect(lr.hasRevisionForNote("noteB")).toBe(false);

        lr.addNoteContent("noteA", "comp1");
        expect(lr.isNoteContentReloaded("noteA", "comp2")).toBeTruthy();
        expect(lr.isNoteContentReloaded("noteA", "comp1")).toBeFalsy();
        expect(lr.isNoteContentReloaded("")).toBe(false);

        lr.addOption("eraseEntitiesAfterTimeInSeconds");
        expect(lr.isOptionReloaded("eraseEntitiesAfterTimeInSeconds")).toBe(true);
        expect(lr.isOptionReloaded("unrelated" as never)).toBe(false);
        expect(lr.getOptionNames()).toEqual(["eraseEntitiesAfterTimeInSeconds"]);

        const attachment = { attachmentId: "att1" } as never;
        lr.addAttachmentRow(attachment);
        expect(lr.getAttachmentRows()).toEqual([attachment]);
    });

    it("reports attribute-related changes from branches or attributes", () => {
        const fromBranch = new LoadResults([]);
        fromBranch.addBranch("b1", "comp1");
        expect(fromBranch.hasAttributeRelatedChanges()).toBe(true);

        const fromAttr = new LoadResults([]);
        fromAttr.addAttribute("a1", "comp1");
        expect(fromAttr.hasAttributeRelatedChanges()).toBe(true);

        expect(new LoadResults([]).hasAttributeRelatedChanges()).toBe(false);
    });

    it("considers a fresh result empty, and any single mutation makes it non-empty", () => {
        expect(new LoadResults([]).isEmpty()).toBe(true);
        expect(new LoadResults([]).isEmptyForTree()).toBe(true);

        const mutators: ((lr: LoadResults) => void)[] = [
            (lr) => lr.addNote("n1", "c"),
            (lr) => lr.addBranch("b1", "c"),
            (lr) => lr.addAttribute("a1", "c"),
            (lr) => lr.addNoteReordering("p1", "c"),
            (lr) => lr.addRevision("r1", "n1", "c"),
            (lr) => lr.addNoteContent("n1", "c"),
            (lr) => lr.addOption("eraseEntitiesAfterTimeInSeconds"),
            (lr) => lr.addAttachmentRow({ attachmentId: "att1" } as never),
            (lr) => { lr.hasEtapiTokenChanges = true; }
        ];

        for (const mutate of mutators) {
            const lr = new LoadResults([]);
            mutate(lr);
            expect(lr.isEmpty()).toBe(false);
        }

        // isEmptyForTree ignores revisions/content/options/attachments/etapi
        const treeIgnored = new LoadResults([]);
        treeIgnored.addRevision("r1", "n1", "c");
        treeIgnored.addNoteContent("n1", "c");
        treeIgnored.addOption("eraseEntitiesAfterTimeInSeconds");
        treeIgnored.hasEtapiTokenChanges = true;
        expect(treeIgnored.isEmptyForTree()).toBe(true);

        const treeAffecting = new LoadResults([]);
        treeAffecting.addNoteReordering("p1", "c");
        expect(treeAffecting.isEmptyForTree()).toBe(false);
    });
});
