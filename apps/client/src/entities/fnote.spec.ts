import { afterEach, describe, expect, it, vi } from "vitest";

import froca from "../services/froca.js";
import noteAttributeCache from "../services/note_attribute_cache.js";
import protectedSessionHolder from "../services/protected_session_holder.js";
import search from "../services/search.js";
import server from "../services/server.js";
import { buildNote } from "../test/easy-froca.js";
import FAttachment from "./fattachment.js";
import FAttribute from "./fattribute.js";
import FBlob from "./fblob.js";
import FBranch from "./fbranch.js";
import FNote, { type FNoteRow, type NoteType } from "./fnote.js";

vi.mock("../services/search.js", () => ({
    default: {
        searchForNoteIds: vi.fn(async () => [])
    }
}));

vi.mock("../services/bundle.js", () => ({
    default: {
        getAndExecuteBundle: vi.fn(async () => "bundle-result")
    }
}));

vi.mock("../services/protected_session_holder.js", () => ({
    default: {
        isProtectedSessionAvailable: vi.fn(() => false)
    }
}));

afterEach(() => {
    vi.restoreAllMocks();
});

describe("FNote tree wiring", () => {
    it("addParent ignores 'none', skips duplicates, and records the branch", () => {
        const note = buildNote({ title: "child" });

        note.addParent("none", "br-none");
        expect(note.getParentNoteIds()).not.toContain("none");

        note.addParent("p1", "br-p1");
        note.addParent("p1", "br-p1b");
        expect(note.getParentNoteIds().filter((id) => id === "p1")).toHaveLength(1);
        expect(note.parentToBranch["p1"]).toBe("br-p1b");
    });

    it("addChild skips duplicates and records the branch", () => {
        const note = buildNote({ title: "parent" });
        registerBranch("br-c1", "c1", note.noteId, 0);
        registerBranch("br-c1b", "c1", note.noteId, 10);

        note.addChild("c1", "br-c1");
        note.addChild("c1", "br-c1b");
        expect(note.getChildNoteIds().filter((id) => id === "c1")).toHaveLength(1);
        expect(note.childToBranch["c1"]).toBe("br-c1b");
    });

    it("sortChildren orders children by branch notePosition (skipping branches without a position)", () => {
        const parent = buildNote({
            title: "p",
            children: [{ title: "a" }, { title: "b" }, { title: "c" }]
        });
        // a child whose branch exists but has an undefined notePosition -> skipped in branchIdPos
        registerBranch("br-nopos", "ghost", parent.noteId, undefined);
        parent.addChild("ghost", "br-nopos", false);

        parent.sortChildren();
        // children with real branches keep their relative ascending position order
        const realIds = parent.children.filter((id) => id !== "ghost");
        const positions = realIds.map((id) => froca.getBranch(parent.childToBranch[id])?.notePosition ?? -1);
        const sorted = [...positions].sort((x, y) => x - y);
        expect(positions).toEqual(sorted);
    });

    it("sortParents puts virt- branches, archived and hiddenCompletely parents last", () => {
        const child = buildNote({ title: "child" });

        const visible = buildNote({ id: "visibleP", title: "visible" });
        const archived = buildNote({ id: "archivedP", title: "archived", "#archived": "" });

        // wire as parents of child manually
        child.addParent("visibleP", "br-visible", false);
        child.addParent("archivedP", "br-archived", false);
        child.addParent("virtP", "virt-branch", false);

        // a second plain visible parent so the comparator's final lexicographic branch is hit
        buildNote({ id: "aaVisibleP", title: "visible2" });
        child.addParent("aaVisibleP", "br-visible2", false);

        child.sortParents();

        // the virtual branch parent should not be first
        expect(child.parents[0]).not.toBe("virtP");
        expect(child.parents).toContain("archivedP");
        expect(child.parents).toContain("virtP");
        expect(archived.isArchived).toBe(true);
        expect(visible.isArchived).toBe(false);
    });

    it("sortParents lexicographically orders plain, non-hidden parents", () => {
        const root = froca.notes["root"] ?? buildNote({ id: "root", title: "root" });
        // three parents that are properly under root, so isHiddenCompletely() is false for all
        const pA = buildNote({ id: "spAlpha", title: "alpha" });
        const pB = buildNote({ id: "spBeta", title: "beta" });
        const pG = buildNote({ id: "spGamma", title: "gamma" });
        for (const p of [pA, pB, pG]) {
            const br = `br-root-${p.noteId}`;
            registerBranch(br, p.noteId, "root", 0);
            root.addChild(p.noteId, br, false);
            p.addParent("root", br, false);
        }
        expect(pA.isHiddenCompletely()).toBe(false);

        const child = buildNote({ id: "spChild", title: "child" });
        // insert out of lexicographic order so the comparator returns both -1 and 1
        child.addParent("spGamma", "br-spGamma-child", false);
        child.addParent("spAlpha", "br-spAlpha-child", false);
        child.addParent("spBeta", "br-spBeta-child", false);
        child.sortParents();

        // sorted ascending: spAlpha < spBeta < spGamma
        expect(child.parents.indexOf("spAlpha")).toBeLessThan(child.parents.indexOf("spBeta"));
        expect(child.parents.indexOf("spBeta")).toBeLessThan(child.parents.indexOf("spGamma"));
    });
});

describe("FNote content & blob", () => {
    it("getContent returns the blob content and getBlob delegates to froca", async () => {
        const blob = makeBlob(`{"a":1}`);
        const getBlob = vi.fn(async () => blob);
        const note = makeNote({ getBlob });

        expect(await note.getContent()).toBe(`{"a":1}`);
        expect(getBlob).toHaveBeenCalledWith("notes", note.noteId);

        // getNoteComplement is a deprecated alias for getBlob
        expect(await note.getNoteComplement()).toBe(blob);
    });

    it("getContent returns undefined when blob is null", async () => {
        const note = makeNote({ getBlob: vi.fn(async () => null) });
        expect(await note.getContent()).toBeUndefined();
    });

    it("getJsonContent parses valid JSON", async () => {
        const note = makeNote({ getBlob: vi.fn(async () => makeBlob(`{"x":2}`)) });
        expect(await note.getJsonContent()).toEqual({ x: 2 });
    });

    it("getJsonContent returns null and logs when content is not a string", async () => {
        const note = makeNote({ getBlob: vi.fn(async () => makeBlob(undefined)) });
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        expect(await note.getJsonContent()).toBeNull();
        expect(logSpy).toHaveBeenCalled();
    });

    it("getJsonContent returns null and logs on invalid JSON", async () => {
        const note = makeNote({ getBlob: vi.fn(async () => makeBlob("not-json")) });
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        expect(await note.getJsonContent()).toBeNull();
        expect(logSpy).toHaveBeenCalled();
    });

    it("isJson reflects the application/json mime", () => {
        expect(makeNote({ mime: "application/json" }).isJson()).toBe(true);
        expect(makeNote({ mime: "text/html" }).isJson()).toBe(false);
    });
});

describe("FNote branches & children", () => {
    it("exposes parent/child branch ids and branch objects", () => {
        const parent = buildNote({
            title: "p",
            children: [{ id: "kid1", title: "k1" }, { id: "kid2", title: "k2" }]
        });
        const child = froca.notes["kid1"];
        expect(child).toBeDefined();
        if (!child) return;

        expect(parent.hasChildren()).toBe(true);
        expect(parent.getChildNoteIds()).toEqual(["kid1", "kid2"]);
        expect(parent.getChildBranches().map((b) => b.noteId)).toEqual(["kid1", "kid2"]);

        // deprecated aliases delegate to parent equivalents
        expect(child.getBranchIds()).toEqual(child.getParentBranchIds());
        expect(child.getBranches().map((b) => b.branchId)).toEqual(child.getParentBranches().map((b) => b.branchId));

        expect(child.getParentNoteIds()).toContain(parent.noteId);
        expect(child.getParentNotes().map((n) => n.noteId)).toContain(parent.noteId);
    });

    it("getChildNotes / getSubtreeNoteIds / getSubtreeNotes traverse the tree and skip archived", async () => {
        const root = buildNote({
            title: "root",
            children: [
                {
                    id: "branchA",
                    title: "A",
                    children: [{ id: "leafA", title: "leafA" }]
                },
                { id: "archivedChild", title: "arch", "#archived": "" }
            ]
        });

        const childNotes = await root.getChildNotes();
        expect(childNotes.map((n) => n.noteId)).toEqual(["branchA", "archivedChild"]);

        const subtreeIds = await root.getSubtreeNoteIds();
        expect(subtreeIds).toContain("branchA");
        expect(subtreeIds).toContain("leafA");
        expect(subtreeIds).not.toContain("archivedChild");

        const subtreeNotes = await root.getSubtreeNotes();
        expect(subtreeNotes.map((n) => n.noteId).sort()).toEqual(["branchA", "leafA"]);
    });

    it("getChildNoteIdsWithArchiveFiltering returns children directly for hidden/search/includeArchived", async () => {
        const hidden = buildNote({ id: "_hiddenParent", title: "hidden", children: [{ id: "hc", title: "hc" }] });
        expect(await hidden.getChildNoteIdsWithArchiveFiltering()).toEqual(["hc"]);

        const searchNote = buildNote({ title: "search", type: "search", children: [{ id: "sc", title: "sc" }] });
        expect(await searchNote.getChildNoteIdsWithArchiveFiltering()).toEqual(["sc"]);

        const normal = buildNote({ title: "normal", children: [{ id: "nc", title: "nc" }] });
        expect(await normal.getChildNoteIdsWithArchiveFiltering(true)).toEqual(["nc"]);
    });

    it("getChildNoteIdsWithArchiveFiltering filters via search for normal notes", async () => {
        const parent = buildNote({
            title: "filterMe",
            children: [{ id: "keepA", title: "keepA" }, { id: "dropB", title: "dropB" }]
        });
        vi.mocked(search.searchForNoteIds).mockResolvedValueOnce(["keepA"]);

        const result = await parent.getChildNoteIdsWithArchiveFiltering();
        expect(result).toEqual(["keepA"]);
        expect(search.searchForNoteIds).toHaveBeenCalled();
    });
});

describe("FNote attachments", () => {
    it("getAttachments caches, and getAttachmentsByRole / getAttachmentById filter the result", async () => {
        const attachments = [
            makeAttachment({ attachmentId: "att1", role: "image" }),
            makeAttachment({ attachmentId: "att2", role: "file" })
        ];
        const getAttachmentsForNote = vi.fn(async () => attachments);
        const note = makeNote({ getAttachmentsForNote });

        expect(await note.getAttachments()).toBe(attachments);
        // cached -> not called again
        await note.getAttachments();
        expect(getAttachmentsForNote).toHaveBeenCalledTimes(1);

        expect((await note.getAttachmentsByRole("image")).map((a) => a.attachmentId)).toEqual(["att1"]);
        expect((await note.getAttachmentById("att2"))?.attachmentId).toBe("att2");
        expect(await note.getAttachmentById("missing")).toBeUndefined();
    });
});

describe("FNote isEligibleForConversionToAttachment", () => {
    it("returns false for the various disqualifying cases and true for an eligible image", () => {
        // not an image
        expect(buildNote({ title: "txt", type: "text" }).isEligibleForConversionToAttachment()).toBe(false);

        // image but protected and no session -> isContentAvailable false
        const protectedImg = makeNote({ type: "image", isProtected: true });
        expect(protectedImg.isEligibleForConversionToAttachment()).toBe(false);

        // image with children
        const imgWithChildren = buildNote({ title: "img", type: "image", children: [{ title: "c" }] });
        expect(imgWithChildren.isEligibleForConversionToAttachment()).toBe(false);

        // image with no parent branch (0 parents)
        const orphanImg = buildNote({ title: "orphan", type: "image" });
        expect(orphanImg.isEligibleForConversionToAttachment()).toBe(false);

        // eligible: single text parent, no imageLink relations
        const eligibleParent = buildNote({
            title: "textParent",
            type: "text",
            children: [{ id: "eligibleImg", title: "img", type: "image" }]
        });
        const eligible = froca.notes["eligibleImg"];
        expect(eligible).toBeDefined();
        if (eligible) {
            expect(eligible.isEligibleForConversionToAttachment()).toBe(true);
        }
        expect(eligibleParent.type).toBe("text");
    });

    it("returns false when there are multiple imageLink target relations", () => {
        const parent = buildNote({
            title: "p",
            type: "text",
            children: [{ id: "multiLinkImg", title: "img", type: "image" }]
        });
        const img = froca.notes["multiLinkImg"];
        expect(img).toBeDefined();
        if (!img) return;

        const rel1 = makeRelationAttr({ attributeId: "tr1", noteId: parent.noteId, name: "imageLink", value: img.noteId });
        const rel2 = makeRelationAttr({ attributeId: "tr2", noteId: parent.noteId, name: "imageLink", value: img.noteId });
        froca.attributes["tr1"] = rel1;
        froca.attributes["tr2"] = rel2;
        img.targetRelations = ["tr1", "tr2"];

        expect(img.isEligibleForConversionToAttachment()).toBe(false);
    });

    it("returns false when the referencing note is not the parent", () => {
        const parent = buildNote({
            title: "p",
            type: "text",
            children: [{ id: "refImg", title: "img", type: "image" }]
        });
        const otherNote = buildNote({ id: "otherRef", title: "other", type: "text" });
        const img = froca.notes["refImg"];
        expect(img).toBeDefined();
        if (!img) return;

        const rel = makeRelationAttr({ attributeId: "trref", noteId: otherNote.noteId, name: "imageLink", value: img.noteId });
        froca.attributes["trref"] = rel;
        img.targetRelations = ["trref"];

        expect(img.isEligibleForConversionToAttachment()).toBe(false);
        expect(parent.noteId).not.toBe(otherNote.noteId);
    });

    it("returns false when the parent is not a text note", () => {
        buildNote({
            title: "codeParent",
            type: "code",
            children: [{ id: "codeChildImg", title: "img", type: "image" }]
        });
        const img = froca.notes["codeChildImg"];
        expect(img).toBeDefined();
        if (img) {
            expect(img.isEligibleForConversionToAttachment()).toBe(false);
        }
    });
});

describe("FNote attributes & inheritance", () => {
    it("getOwnedAttributes / getAttributes apply type and name filters", () => {
        const note = buildNote({
            title: "attrNote",
            "#color": "red",
            "#mood": "happy",
            "~template": "tpl"
        });

        expect(note.getOwnedAttributes("label").map((a) => a.name).sort()).toEqual(["color", "mood"]);
        expect(note.getOwnedAttributes("label", "color").map((a) => a.value)).toEqual(["red"]);
        expect(note.getOwnedAttributes("relation").map((a) => a.name)).toEqual(["template"]);
        expect(note.getOwnedAttributes()).toHaveLength(3);

        expect(note.getAttributes("label", "mood").map((a) => a.value)).toEqual(["happy"]);

        // name-only filters (no type) on both owned and inherited accessors
        expect(note.getOwnedAttributes(undefined, "color").map((a) => a.value)).toEqual(["red"]);
        expect(note.getAttributes(undefined, "mood").map((a) => a.value)).toEqual(["happy"]);
    });

    it("__getCachedAttributes inherits from parents and templates, and breaks cycles", () => {
        // fresh notes that are NOT pre-cached by easy-froca for the parent/template relationship
        const template = buildNote({ id: "tmplNote", title: "template", "#fromTemplate(inheritable)": "yes", "#template": "marker" });
        const parent = buildNote({ id: "parentInh", title: "parent", "#fromParent(inheritable)": "p" });
        const instance = buildNote({ id: "instanceNote", title: "instance", "~template": "tmplNote" });
        // wire parent
        const branchId = "br-parentInh-instance";
        froca.branches[branchId] = new FBranch(froca, {
            branchId,
            noteId: instance.noteId,
            parentNoteId: parent.noteId,
            notePosition: 0,
            fromSearchNote: false
        });
        parent.addChild(instance.noteId, branchId, false);
        instance.addParent(parent.noteId, branchId, false);

        // clear cache for these notes so __getCachedAttributes recomputes inheritance
        delete noteAttributeCache.attributes[instance.noteId];
        delete noteAttributeCache.attributes[parent.noteId];
        delete noteAttributeCache.attributes[template.noteId];

        const names = instance.getAttributes().map((a) => a.name);
        expect(names).toContain("fromParent");
        expect(names).toContain("fromTemplate");
        // the "template" marker label must not be inherited
        expect(instance.getAttributes("label").some((a) => a.name === "template")).toBe(false);
    });

    it("__getCachedAttributes ignores a template relation pointing at the note itself", () => {
        const selfTpl = buildNote({ id: "selfTpl", title: "self", "~template": "selfTpl", "#own": "v" });
        delete noteAttributeCache.attributes["selfTpl"];
        // should not recurse into itself; own label still present
        expect(selfTpl.getAttributes().some((a) => a.name === "own")).toBe(true);
    });

    it("__getCachedAttributes deduplicates an attribute inherited via two paths", () => {
        // diamond: child has two parents that both inherit the same grandparent attribute
        const grand = buildNote({ id: "diamondGrand", title: "grand", "#shared(inheritable)": "g" });
        const left = buildNote({ id: "diamondLeft", title: "left" });
        const right = buildNote({ id: "diamondRight", title: "right" });
        const child = buildNote({ id: "diamondChild", title: "child" });

        for (const [parent, branchId] of [[left, "br-grand-left"], [right, "br-grand-right"]] as const) {
            registerBranch(branchId, parent.noteId, "diamondGrand", 0);
            grand.addChild(parent.noteId, branchId, false);
            parent.addParent("diamondGrand", branchId, false);
        }
        for (const [parent, branchId] of [[left, "br-left-child"], [right, "br-right-child"]] as const) {
            registerBranch(branchId, "diamondChild", parent.noteId, 0);
            parent.addChild("diamondChild", branchId, false);
            child.addParent(parent.noteId, branchId, false);
        }

        for (const id of ["diamondGrand", "diamondLeft", "diamondRight", "diamondChild"]) {
            delete noteAttributeCache.attributes[id];
        }

        // the inheritable "shared" attribute reaches the child via both parents but appears once
        const shared = child.getAttributes("label", "shared");
        expect(shared).toHaveLength(1);
    });

    it("__getCachedAttributes logs and returns [] on a template inheritance cycle", () => {
        const a = buildNote({ id: "cycleA", title: "A", "~template": "cycleB" });
        const b = buildNote({ id: "cycleB", title: "B", "~template": "cycleA" });
        delete noteAttributeCache.attributes["cycleA"];
        delete noteAttributeCache.attributes["cycleB"];

        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        // computing A pulls B's template (A), which detects the cycle path
        a.getAttributes();
        expect(logSpy).toHaveBeenCalledWith("Forming a path");
        expect(b.noteId).toBe("cycleB");
    });

    it("__validateTypeName throws for an unknown type or prefixed name", () => {
        const note = buildNote({ title: "v" });
        expect(() => note.getAttributes("weird" as never)).toThrow();
        expect(() => note.getAttributes("label", "#bad")).toThrow();
        expect(() => note.getAttributes("label", "~bad")).toThrow();
    });

    it("label / relation accessor helpers behave consistently", () => {
        const note = buildNote({
            title: "accessors",
            "#color": "blue",
            "~author": "authorNote"
        });

        expect(note.getOwnedLabels().map((a) => a.name)).toContain("color");
        expect(note.getLabels("color").map((a) => a.value)).toEqual(["blue"]);
        expect(note.getOwnedRelations("author").map((a) => a.name)).toEqual(["author"]);
        expect(note.getRelations().map((a) => a.name)).toContain("author");

        expect(note.hasAttribute("label", "color")).toBe(true);
        expect(note.hasOwnedAttribute("label", "color")).toBe(true);
        expect(note.getOwnedAttribute("label", "color")?.value).toBe("blue");
        expect(note.getAttribute("relation", "author")?.value).toBe("authorNote");
        expect(note.getOwnedAttributeValue("label", "color")).toBe("blue");
        expect(note.getOwnedAttributeValue("label", "missing")).toBeNull();
        expect(note.getAttributeValue("relation", "author")).toBe("authorNote");
        expect(note.getAttributeValue("relation", "missing")).toBeNull();

        expect(note.hasOwnedLabel("color")).toBe(true);
        expect(note.hasLabel("color")).toBe(true);
        expect(note.hasLabelOrDisabled("color")).toBe(true);
        expect(note.hasOwnedRelation("author")).toBe(true);
        expect(note.hasRelation("author")).toBe(true);

        expect(note.getOwnedLabel("color")?.value).toBe("blue");
        expect(note.getLabel("color")?.value).toBe("blue");
        expect(note.getOwnedRelation("author")?.value).toBe("authorNote");
        expect(note.getRelation("author")?.value).toBe("authorNote");
        expect(note.getOwnedLabelValue("color")).toBe("blue");
        expect(note.getLabelValue("color")).toBe("blue");
        expect(note.getOwnedRelationValue("author")).toBe("authorNote");
        expect(note.getRelationValue("author")).toBe("authorNote");
    });

    it("hasLabelOrDisabled finds the disabled-prefixed variant", () => {
        const note = buildNote({ title: "disabled", "#disabled:feature": "x" });
        expect(note.hasLabelOrDisabled("feature")).toBe(true);
        expect(note.hasLabel("feature")).toBe(false);
    });

    it("isLabelTruthy handles missing, 'false', and truthy labels", () => {
        const none = buildNote({ title: "n" });
        expect(none.isLabelTruthy("flag")).toBe(false);

        const falseLabel = buildNote({ title: "f", "#flag": "false" });
        expect(falseLabel.isLabelTruthy("flag")).toBe(false);

        const truthy = buildNote({ title: "t", "#flag": "yes" });
        expect(truthy.isLabelTruthy("flag")).toBe(true);
    });

    it("getLabelOrRelation resolves #, ~ and bare names", () => {
        const note = buildNote({ title: "lr", "#size": "big", "~owner": "ownerNote" });
        expect(note.getLabelOrRelation("#size")).toBe("big");
        expect(note.getLabelOrRelation("~owner")).toBe("ownerNote");
        expect(note.getLabelOrRelation("size")).toBe("big");
    });

    it("getRelationTarget(s) resolve relation values via froca.getNote", async () => {
        const target = buildNote({ id: "relTarget", title: "target" });
        const note = buildNote({ title: "src", "~link": "relTarget" });

        const targets = await note.getRelationTargets("link");
        expect(targets.map((t) => t?.noteId)).toEqual(["relTarget"]);
        expect((await note.getRelationTarget("link"))?.noteId).toBe("relTarget");
        expect(target.noteId).toBe("relTarget");

        const noTargetNote = buildNote({ title: "noTarget" });
        expect(await noTargetNote.getRelationTarget("nope")).toBeNull();
    });

    it("getNotesToInheritAttributesFrom collects template and inherit relation targets", () => {
        buildNote({ id: "tplTarget", title: "tplTarget" });
        buildNote({ id: "inhTarget", title: "inhTarget" });
        const note = buildNote({ title: "inheritFrom", "~template": "tplTarget", "~inherit": "inhTarget" });

        const sources = note.getNotesToInheritAttributesFrom().map((n) => n?.noteId);
        expect(sources).toContain("tplTarget");
        expect(sources).toContain("inhTarget");
    });

    it("getPromotedDefinitionAttributes returns [] when hidden, otherwise sorted definitions", () => {
        const hidden = buildNote({ title: "hidePromoted", "#hidePromotedAttributes": "" });
        expect(hidden.getPromotedDefinitionAttributes()).toEqual([]);

        const note = buildNote({
            title: "promoted",
            "#label:alpha": "promoted,text",
            "#label:beta": "promoted,text"
        });
        const promoted = note.getPromotedDefinitionAttributes();
        expect(promoted.length).toBeGreaterThanOrEqual(2);
        expect(note.getAttributeDefinitions().length).toBeGreaterThanOrEqual(2);
    });

    it("getPromotedDefinitionAttributes sorts by position within the same note", () => {
        const note = buildNote({
            id: "promotedSortNote",
            title: "promotedSort",
            "#label:gamma": "promoted,text",
            "#label:delta": "promoted,text",
            "#label:epsilon": "promoted,text"
        });
        // scramble the stored positions so the position comparator returns both -1 and 1
        const cached = noteAttributeCache.attributes["promotedSortNote"] ?? [];
        const defs = cached.filter((a) => a.name.startsWith("label:"));
        if (defs[0]) defs[0].position = 20;
        if (defs[1]) defs[1].position = 5;
        if (defs[2]) defs[2].position = 10;

        const promoted = note.getPromotedDefinitionAttributes();
        expect(promoted.every((a) => a.noteId === note.noteId)).toBe(true);
        // positions are strictly increasing after the sort
        const positions = promoted.map((a) => a.position);
        expect(positions).toEqual([...positions].sort((x, y) => x - y));
    });

    it("getPromotedDefinitionAttributes groups inherited definitions by source note id", () => {
        // child id is alphabetically AFTER one ancestor and BEFORE another, so the
        // cross-note comparator returns both -1 and 1 during the sort
        const grandparent = buildNote({
            id: "aaPromGrand",
            title: "grand",
            "#label:grandDef(inheritable)": "promoted,text"
        });
        const parent = buildNote({
            id: "zzPromParent",
            title: "promParent",
            "#label:inheritedDef(inheritable)": "promoted,text"
        });
        const child = buildNote({
            id: "mmPromChild",
            title: "promChild",
            "#label:ownDef": "promoted,text"
        });
        registerBranch("br-grand-parent", "zzPromParent", "aaPromGrand", 0);
        grandparent.addChild("zzPromParent", "br-grand-parent", false);
        parent.addParent("aaPromGrand", "br-grand-parent", false);

        registerBranch("br-parent-child", "mmPromChild", "zzPromParent", 0);
        parent.addChild("mmPromChild", "br-parent-child", false);
        child.addParent("zzPromParent", "br-parent-child", false);

        delete noteAttributeCache.attributes["mmPromChild"];
        delete noteAttributeCache.attributes["zzPromParent"];
        delete noteAttributeCache.attributes["aaPromGrand"];

        const promoted = child.getPromotedDefinitionAttributes();
        const noteIds = new Set(promoted.map((a) => a.noteId));
        // definitions originate from three different notes -> the cross-note sort branch runs both ways
        expect(noteIds.size).toBeGreaterThanOrEqual(3);
    });
});

describe("FNote paths & hierarchy", () => {
    it("isRoot and getAllNotePaths handle root, single and multi-parent", () => {
        const rootNote = buildNote({ id: "root", title: "root" });
        expect(rootNote.isRoot()).toBe(true);
        expect(rootNote.getAllNotePaths()).toEqual([["root"]]);

        // single parent optimization
        const parent = buildNote({ id: "rootChild", title: "child", children: [{ id: "grand", title: "grand" }] });
        froca.notes["root"]?.addChild("rootChild", "br-root-rootChild", false);
        parent.addParent("root", "br-root-rootChild", false);

        const grand = froca.notes["grand"];
        expect(grand).toBeDefined();
        if (grand) {
            const paths = grand.getAllNotePaths();
            expect(paths.some((p) => p[0] === "root" && p[p.length - 1] === "grand")).toBe(true);
        }

        // multi-parent flatMap branch
        const secondParent = buildNote({ id: "secondParent", title: "second" });
        froca.notes["root"]?.addChild("secondParent", "br-root-secondParent", false);
        secondParent.addParent("root", "br-root-secondParent", false);
        const multi = froca.notes["grand"];
        if (multi) {
            multi.addParent("secondParent", "br-second-grand", false);
            secondParent.addChild("grand", "br-second-grand", false);
            froca.branches["br-second-grand"] = new FBranch(froca, {
                branchId: "br-second-grand",
                noteId: "grand",
                parentNoteId: "secondParent",
                notePosition: 0,
                fromSearchNote: false
            });
            const multiPaths = multi.getAllNotePaths();
            expect(multiPaths.length).toBeGreaterThanOrEqual(2);
        }
    });

    it("getSortedNotePathRecords / getBestNotePath(String) prioritize the active path prefix", () => {
        const root = froca.notes["root"] ?? buildNote({ id: "root", title: "root" });
        const branchX = buildNote({ id: "branchX", title: "X" });
        const branchY = buildNote({ id: "branchY", title: "Y" });
        const leaf = buildNote({ id: "sharedLeaf", title: "leaf" });

        for (const [parent, branchId] of [[branchX, "br-x-leaf"], [branchY, "br-y-leaf"]] as const) {
            froca.branches[branchId] = new FBranch(froca, {
                branchId,
                noteId: "sharedLeaf",
                parentNoteId: parent.noteId,
                notePosition: 0,
                fromSearchNote: false
            });
            parent.addChild("sharedLeaf", branchId, false);
            leaf.addParent(parent.noteId, branchId, false);

            const rootBranchId = `br-root-${parent.noteId}`;
            froca.branches[rootBranchId] = new FBranch(froca, {
                branchId: rootBranchId,
                noteId: parent.noteId,
                parentNoteId: "root",
                notePosition: 0,
                fromSearchNote: false
            });
            root.addChild(parent.noteId, rootBranchId, false);
            parent.addParent("root", rootBranchId, false);
        }

        const records = leaf.getSortedNotePathRecords("root", "root/branchY/sharedLeaf");
        expect(records[0].notePath).toEqual(["root", "branchY", "sharedLeaf"]);

        expect(leaf.getBestNotePath("root", "root/branchX/sharedLeaf")).toEqual(["root", "branchX", "sharedLeaf"]);
        expect(leaf.getBestNotePathString()).toContain("sharedLeaf");
    });

    it("getSortedNotePathRecords orders by archived / hidden / search / length without an active path", () => {
        const leaf = froca.notes["sharedLeaf"];
        expect(leaf).toBeDefined();
        if (!leaf) return;

        const records = leaf.getSortedNotePathRecords("root");
        // the first record should not be archived/hidden when alternatives exist
        expect(records.length).toBeGreaterThan(0);
        expect(records[0].notePath[0]).toBe("root");

        // hoistedNoteId other than root marks isInHoistedSubTree based on path inclusion
        const hoisted = leaf.getSortedNotePathRecords("branchX");
        expect(hoisted.some((r) => r.isInHoistedSubTree)).toBe(true);
    });

    it("getSortedNotePathRecords ranks archived, hidden and search paths last", () => {
        const root = froca.notes["root"] ?? buildNote({ id: "root", title: "root" });

        // four parents directly under root: normal, archived, hidden (_hidden), and search
        const normalP = buildNote({ id: "normalP", title: "normal" });
        const archivedP = buildNote({ id: "archivedP2", title: "arch", "#archived": "" });
        const hiddenP = froca.notes["_hidden"] ?? buildNote({ id: "_hidden", title: "hidden" });
        const searchP = buildNote({ id: "searchP2", title: "search", type: "search" });

        for (const parent of [normalP, archivedP, hiddenP, searchP]) {
            const rootBr = `br-root-${parent.noteId}`;
            registerBranch(rootBr, parent.noteId, "root", 0);
            root.addChild(parent.noteId, rootBr, false);
            parent.addParent("root", rootBr, false);
        }

        const target = buildNote({ id: "multiStatusLeaf", title: "leaf" });
        for (const parent of [normalP, archivedP, hiddenP, searchP]) {
            const br = `br-${parent.noteId}-leaf`;
            registerBranch(br, "multiStatusLeaf", parent.noteId, 0);
            parent.addChild("multiStatusLeaf", br, false);
            target.addParent(parent.noteId, br, false);
        }

        const records = target.getSortedNotePathRecords("root");
        // normal path first; archived/hidden/search pushed toward the end
        expect(records[0].notePath).toEqual(["root", "normalP", "multiStatusLeaf"]);
        const lastPath = records[records.length - 1].notePath;
        expect(lastPath.some((id) => id === "archivedP2" || id === "_hidden" || id === "searchP2")).toBe(true);
    });

    it("getSortedNotePathRecords orders by hoisted-subtree membership, hidden status and equal active overlap", () => {
        const root = froca.notes["root"] ?? buildNote({ id: "root", title: "root" });
        const hidden = froca.notes["_hidden"] ?? buildNote({ id: "_hidden", title: "hidden" });

        // hoist target reachable only through one of the parents
        const hoistP = buildNote({ id: "hoistP", title: "hoist" });
        const plainP = buildNote({ id: "plainP", title: "plain" });
        for (const p of [hoistP, plainP]) {
            const br = `br-root-${p.noteId}`;
            registerBranch(br, p.noteId, "root", 0);
            root.addChild(p.noteId, br, false);
            p.addParent("root", br, false);
        }

        const leaf = buildNote({ id: "hoistLeaf", title: "leaf" });
        for (const p of [hoistP, plainP, hidden]) {
            const br = `br-${p.noteId}-hoistLeaf`;
            registerBranch(br, "hoistLeaf", p.noteId, 0);
            p.addChild("hoistLeaf", br, false);
            leaf.addParent(p.noteId, br, false);
        }

        // hoisting to hoistP -> only the path through hoistP is in the hoisted subtree
        const hoisted = leaf.getSortedNotePathRecords("hoistP");
        expect(hoisted[0].isInHoistedSubTree).toBe(true);
        expect(hoisted.some((r) => !r.isInHoistedSubTree)).toBe(true);

        // non-hidden path ranks before the _hidden path
        const records = leaf.getSortedNotePathRecords("root");
        const firstHiddenIdx = records.findIndex((r) => r.isHidden);
        const firstVisibleIdx = records.findIndex((r) => !r.isHidden);
        expect(firstVisibleIdx).toBeLessThan(firstHiddenIdx);

        // active path equal to one of the candidate paths -> equal-overlap branch exercised
        const withActive = leaf.getSortedNotePathRecords("root", "root/plainP/hoistLeaf");
        expect(withActive[0].notePath).toEqual(["root", "plainP", "hoistLeaf"]);
    });

    it("getSortedNotePathRecords comparator exercises both ternary directions (reversed parent order)", () => {
        const root = froca.notes["root"] ?? buildNote({ id: "root", title: "root" });
        const hidden = froca.notes["_hidden"] ?? buildNote({ id: "_hidden", title: "hidden" });

        const visP = buildNote({ id: "revVisible", title: "visible" });
        const br = "br-root-revVisible";
        registerBranch(br, "revVisible", "root", 0);
        root.addChild("revVisible", br, false);
        visP.addParent("root", br, false);

        // leaf whose hidden path is added FIRST so the comparator sees (visible=a, hidden=b)
        const leaf = buildNote({ id: "revLeaf", title: "leaf" });
        const hbr = "br-_hidden-revLeaf";
        registerBranch(hbr, "revLeaf", "_hidden", 0);
        hidden.addChild("revLeaf", hbr, false);
        leaf.addParent("_hidden", hbr, false);
        const vbr = "br-revVisible-revLeaf";
        registerBranch(vbr, "revLeaf", "revVisible", 0);
        visP.addChild("revLeaf", vbr, false);
        leaf.addParent("revVisible", vbr, false);

        const records = leaf.getSortedNotePathRecords("root");
        // visible path still wins regardless of initial order
        expect(records[0].isHidden).toBe(false);

        // hoist to the hidden ancestor so the hidden path is in the hoisted subtree but the
        // visible path is NOT, with the hidden path appearing first in the array
        const hoisted = leaf.getSortedNotePathRecords("_hidden");
        expect(hoisted.some((r) => r.isInHoistedSubTree)).toBe(true);
        expect(hoisted.some((r) => !r.isInHoistedSubTree)).toBe(true);
    });

    it("getSortedNotePathRecords prefers the hoisted-subtree path when it appears second", () => {
        const root = froca.notes["root"] ?? buildNote({ id: "root", title: "root" });
        // two simple, independent parents directly under root
        const outsideP = buildNote({ id: "hoist2Outside", title: "outside" });
        const insideP = buildNote({ id: "hoist2Inside", title: "inside" });
        for (const p of [outsideP, insideP]) {
            const pbr = `br-root-${p.noteId}`;
            registerBranch(pbr, p.noteId, "root", 0);
            root.addChild(p.noteId, pbr, false);
            p.addParent("root", pbr, false);
        }

        const leaf = buildNote({ id: "hoist2Leaf", title: "leaf" });
        // add outside FIRST, inside SECOND so the hoisted path is arr[1] (the comparator's `a`)
        for (const p of [outsideP, insideP]) {
            const lbr = `br-${p.noteId}-hoist2Leaf`;
            registerBranch(lbr, "hoist2Leaf", p.noteId, 0);
            p.addChild("hoist2Leaf", lbr, false);
            leaf.addParent(p.noteId, lbr, false);
        }

        // hoist to the inside parent -> only the path through it is in the hoisted subtree
        const records = leaf.getSortedNotePathRecords("hoist2Inside");
        expect(records[0].notePath).toContain("hoist2Inside");
        expect(records[0].isInHoistedSubTree).toBe(true);
        expect(records[records.length - 1].isInHoistedSubTree).toBe(false);
    });

    it("isHiddenCompletely handles _hidden, root, and parent walks", () => {
        const hidden = buildNote({ id: "_hidden", title: "hidden" });
        expect(hidden.isHiddenCompletely()).toBe(true);

        const root = froca.notes["root"] ?? buildNote({ id: "root", title: "root" });
        expect(root.isHiddenCompletely()).toBe(false);

        // note whose only parent is root -> visible
        const visible = buildNote({ id: "visibleNote", title: "visible" });
        visible.addParent("root", "br-root-visibleNote", false);
        expect(visible.isHiddenCompletely()).toBe(false);

        // note under _hidden + a search parent (continue branch) -> hidden completely
        const hiddenChild = buildNote({ id: "hiddenChild", title: "hc" });
        const searchParent = buildNote({ id: "searchParent", title: "sp", type: "search" });
        hiddenChild.addParent("_hidden", "br-hidden-hc", false);
        hiddenChild.addParent("searchParent", "br-search-hc", false);
        expect(hiddenChild.isHiddenCompletely()).toBe(true);
        expect(searchParent.type).toBe("search");

        // note whose parent is itself hidden-completely
        const deepHidden = buildNote({ id: "deepHidden", title: "deep" });
        deepHidden.addParent("hiddenChild", "br-hc-deep", false);
        expect(deepHidden.isHiddenCompletely()).toBe(true);

        // note whose (non-root/non-hidden/non-search) parent is NOT hidden completely -> visible
        const visibleParent = buildNote({ id: "visibleParent", title: "vp" });
        visibleParent.addParent("root", "br-root-vp", false);
        const visibleGrandchild = buildNote({ id: "visibleGrandchild", title: "vgc" });
        visibleGrandchild.addParent("visibleParent", "br-vp-vgc", false);
        expect(visibleGrandchild.isHiddenCompletely()).toBe(false);
    });

    it("hasAncestor walks parents and templates and avoids cycles", () => {
        const ancestor = buildNote({ id: "anc", title: "ancestor" });
        const child = buildNote({ id: "ancChild", title: "child" });
        child.addParent("anc", "br-anc-child", false);
        ancestor.addChild("ancChild", "br-anc-child", false);

        expect(child.hasAncestor("anc")).toBe(true);
        expect(child.hasAncestor("anc")).toBe(true);
        expect(child.hasAncestor("nonexistent")).toBe(false);
        expect(ancestor.hasAncestor("anc")).toBe(true);

        // follow templates
        const tmpl = buildNote({ id: "ancTmpl", title: "tmpl" });
        const inst = buildNote({ id: "ancInst", title: "inst", "~template": "ancTmpl" });
        tmpl.addParent("anc", "br-anc-tmpl", false);
        ancestor.addChild("ancTmpl", "br-anc-tmpl", false);
        expect(inst.hasAncestor("anc", true)).toBe(true);

        // visited cycle: instance is parent of its own template
        const cycT = buildNote({ id: "cycT", title: "cycT" });
        const cycI = buildNote({ id: "cycI", title: "cycI", "~template": "cycT" });
        cycI.addParent("cycT", "br-cycT-cycI", false);
        cycT.addChild("cycI", "br-cycT-cycI", false);
        cycT.addParent("cycI", "br-cycI-cycT", false);
        cycI.addChild("cycT", "br-cycI-cycT", false);
        expect(cycI.hasAncestor("missingAncestor", true)).toBe(false);
    });

    it("isInHiddenSubtree reflects _hidden and ancestors", () => {
        const hidden = froca.notes["_hidden"] ?? buildNote({ id: "_hidden", title: "hidden" });
        expect(hidden.isInHiddenSubtree()).toBe(true);

        const underHidden = buildNote({ id: "underHidden", title: "uh" });
        underHidden.addParent("_hidden", "br-hidden-uh", false);
        hidden.addChild("underHidden", "br-hidden-uh", false);
        expect(underHidden.isInHiddenSubtree()).toBe(true);
    });
});

describe("FNote icon, color, folder & css", () => {
    it("getIcon / getColorClass / getCssClass derive from labels", () => {
        const note = buildNote({
            title: "iconNote",
            "#iconClass": "bx bx-star",
            "#color": "#ff0000",
            "#cssClass": "klass1",
            "#workspaceIconClass": "bx bx-home",
            "#workspaceTabBackgroundColor": "blue"
        });

        expect(note.getIcon()).toContain("tn-icon");
        expect(typeof note.getColorClass()).toBe("string");
        expect(note.getCssClass()).toBe("klass1");
        expect(note.getWorkspaceIconClass()).toBe("bx bx-home");
        expect(note.getWorkspaceTabBackgroundColor()).toBe("blue");

        const noWorkspace = buildNote({ title: "plain" });
        expect(noWorkspace.getWorkspaceIconClass()).toBe("");
        expect(noWorkspace.getWorkspaceTabBackgroundColor()).toBe("");

        // a note without an iconClass label still produces a default icon
        const noIcon = buildNote({ title: "noIcon" });
        expect(noIcon.getIcon()).toContain("tn-icon");
    });

    it("isFolder reflects subtreeHidden, search type and filtered children", () => {
        const hiddenSubtree = buildNote({ title: "hs", "#subtreeHidden": "" });
        expect(hiddenSubtree.isFolder()).toBe(false);

        const searchNote = buildNote({ title: "search", type: "search" });
        expect(searchNote.isFolder()).toBe(true);

        const withChildren = buildNote({ title: "wc", children: [{ title: "child" }] });
        expect(withChildren.isFolder()).toBe(true);

        const leaf = buildNote({ title: "leaf" });
        expect(leaf.isFolder()).toBe(false);
        expect(leaf.getFilteredChildBranches()).toEqual([]);
    });

    it("getFilteredChildBranches logs and returns [] when getChildBranches yields nothing", () => {
        // construct directly with a froca whose getBranches returns undefined (defensive path)
        const brokenFroca = {
            getBranches: () => undefined
        } as unknown as import("../services/froca-interface.js").Froca;
        const note = new FNote(brokenFroca, {
            noteId: "brokenChildren",
            title: "broken",
            type: "text",
            mime: "text/html",
            isProtected: false,
            blobId: ""
        });
        note.children = ["x"];
        note.childToBranch = { x: "br-x" };
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        expect(note.getFilteredChildBranches()).toEqual([]);
        expect(errSpy).toHaveBeenCalled();
    });
});

describe("FNote target relations, blob alias, toString, dto", () => {
    it("getTargetRelations / getTargetRelationSourceNotes resolve source notes", async () => {
        const source = buildNote({ id: "trSource", title: "source" });
        const target = buildNote({ id: "trTarget", title: "target" });
        const rel = makeRelationAttr({ attributeId: "tr-rel", noteId: "trSource", name: "link", value: "trTarget" });
        froca.attributes["tr-rel"] = rel;
        target.targetRelations = ["tr-rel"];

        expect(target.getTargetRelations().map((a) => a.attributeId)).toEqual(["tr-rel"]);
        const sources = await target.getTargetRelationSourceNotes();
        expect(sources.map((n) => n.noteId)).toContain("trSource");
        expect(source.noteId).toBe("trSource");
    });

    it("toString and dto omit froca", () => {
        const note = buildNote({ id: "dtoNote", title: "DTO" });
        expect(note.toString()).toContain("dtoNote");
        const dto = note.dto as Record<string, unknown>;
        expect("froca" in dto).toBe(false);
        expect(dto.noteId).toBe("dtoNote");
    });

    it("invalidateAttributeCache is a no-op", () => {
        const note = buildNote({ title: "noop" });
        expect(note.invalidateAttributeCache()).toBeUndefined();
    });
});

describe("FNote system-note predicates", () => {
    it("isArchived / isMetadataReadOnly / isOptions / isLaunchBarConfig", () => {
        expect(buildNote({ title: "arch", "#archived": "" }).isArchived).toBe(true);

        expect(makeNote({ noteId: "_lbRoot" }).isMetadataReadOnly).toBe(true);
        expect(makeNote({ noteId: "_help_xyz" }).isMetadataReadOnly).toBe(true);
        expect(makeNote({ noteId: "_optionsAppearance" }).isMetadataReadOnly).toBe(true);
        expect(makeNote({ noteId: "regularNote" }).isMetadataReadOnly).toBe(false);

        expect(makeNote({ noteId: "_optionsX" }).isOptions()).toBe(true);
        expect(makeNote({ noteId: "plain" }).isOptions()).toBe(false);

        expect(makeNote({ type: "launcher" }).isLaunchBarConfig()).toBe(true);
        expect(makeNote({ noteId: "_lbRoot" }).isLaunchBarConfig()).toBe(true);
        expect(makeNote({ noteId: "plain", type: "text" }).isLaunchBarConfig()).toBe(false);
    });

    it("mime/type predicates: js, jsx, html, markdown, sqlite, trilium script", () => {
        expect(makeNote({ type: "code", mime: "application/javascript" }).isJavaScript()).toBe(true);
        expect(makeNote({ type: "file", mime: "application/x-javascript" }).isJavaScript()).toBe(true);
        expect(makeNote({ type: "launcher", mime: "text/javascript" }).isJavaScript()).toBe(true);
        expect(makeNote({ type: "text", mime: "text/javascript" }).isJavaScript()).toBe(false);

        expect(makeNote({ type: "code", mime: "text/jsx" }).isJsx()).toBe(true);
        expect(makeNote({ type: "code", mime: "text/html" }).isHtml()).toBe(true);
        expect(makeNote({ type: "render", mime: "text/html" }).isHtml()).toBe(true);
        expect(makeNote({ type: "text", mime: "text/html" }).isHtml()).toBe(false);

        expect(makeNote({ type: "code", mime: "text/markdown" }).isMarkdown()).toBe(true);
        expect(makeNote({ type: "code", mime: "text/x-gfm" }).isMarkdown()).toBe(true);
        expect(makeNote({ type: "text", mime: "text/markdown" }).isMarkdown()).toBe(false);

        expect(makeNote({ mime: "text/x-sqlite;schema=trilium" }).isTriliumSqlite()).toBe(true);
        expect(makeNote({ mime: "text/plain" }).isTriliumSqlite()).toBe(false);

        expect(makeNote({ mime: "application/javascript;env=backend" }).isTriliumScript()).toBe(true);
        expect(makeNote({ mime: "text/plain" }).isTriliumScript()).toBe(false);
    });

    it("getScriptEnv returns frontend / backend / null", () => {
        expect(makeNote({ type: "code", mime: "text/html" }).getScriptEnv()).toBe("frontend");
        expect(makeNote({ type: "code", mime: "application/javascript;env=frontend" }).getScriptEnv()).toBe("frontend");
        expect(makeNote({ type: "code", mime: "text/jsx" }).getScriptEnv()).toBe("frontend");
        expect(makeNote({ type: "render", mime: "text/plain" }).getScriptEnv()).toBe("frontend");
        expect(makeNote({ type: "code", mime: "application/javascript;env=backend" }).getScriptEnv()).toBe("backend");
        expect(makeNote({ type: "text", mime: "text/plain" }).getScriptEnv()).toBeNull();
    });
});

describe("FNote executeScript", () => {
    it("executes a frontend bundle", async () => {
        const bundleService = (await import("../services/bundle.js")).default;
        const note = makeNote({ type: "code", mime: "application/javascript;env=frontend" });

        const result = await note.executeScript();
        expect(result).toBe("bundle-result");
        expect(bundleService.getAndExecuteBundle).toHaveBeenCalledWith(note.noteId);
    });

    it("posts to the server for a backend script", async () => {
        const postSpy = vi.spyOn(server, "post").mockResolvedValue(undefined);
        const note = makeNote({ type: "code", mime: "application/javascript;env=backend" });

        await note.executeScript();
        expect(postSpy).toHaveBeenCalledWith(`script/run/${note.noteId}`);
    });

    it("throws for a non-JS note type", async () => {
        const note = makeNote({ type: "text", mime: "text/html" });
        await expect(note.executeScript()).rejects.toThrow();
    });

    it("throws 'Unrecognized env' for a JS note whose env is neither frontend nor backend", async () => {
        // application/javascript without an env= suffix is JS but getScriptEnv() returns null
        const note = makeNote({ type: "code", mime: "application/javascript" });
        expect(note.isJavaScript()).toBe(true);
        expect(note.getScriptEnv()).toBeNull();
        await expect(note.executeScript()).rejects.toThrow();
    });
});

describe("FNote isShared", () => {
    it("recurses up the parent chain to detect _share membership and skips root/none/search", () => {
        const shareRoot = buildNote({ id: "_share", title: "share" });
        const shared = buildNote({ id: "sharedNote", title: "shared" });
        shared.addParent("_share", "br-share-shared", false);
        expect(shared.isShared()).toBe(true);
        expect(shareRoot.noteId).toBe("_share");

        // grandchild of _share -> recursion through parentNote.isShared()
        const grandchild = buildNote({ id: "sharedGrandchild", title: "gc" });
        grandchild.addParent("sharedNote", "br-shared-gc", false);
        expect(grandchild.isShared()).toBe(true);

        // note with only root/none/search/unknown/plain-non-shared parents -> not shared
        const plainParent = buildNote({ id: "plainNonShared", title: "pns" });
        const notShared = buildNote({ id: "notShared", title: "ns" });
        notShared.addParent("root", "br-root-ns", false);
        notShared.addParent("none", "br-none-ns", false);
        notShared.parents.push("ghostParent"); // unknown -> froca.notes lookup is falsy
        const searchParent = buildNote({ id: "shareSearchParent", title: "ssp", type: "search" });
        notShared.addParent("shareSearchParent", "br-search-ns", false);
        // a plain parent that is neither _share nor shared -> line 1050 evaluates both operands as false
        notShared.addParent("plainNonShared", "br-plain-ns", false);
        expect(notShared.isShared()).toBe(false);
        expect(searchParent.type).toBe("search");
        expect(plainParent.isShared()).toBe(false);
    });
});

describe("FNote isContentAvailable & getMetadata", () => {
    it("isContentAvailable depends on protection and session availability", () => {
        const unprotected = makeNote({ isProtected: false });
        expect(unprotected.isContentAvailable()).toBe(true);

        vi.mocked(protectedSessionHolder.isProtectedSessionAvailable).mockReturnValue(false);
        const protectedNote = makeNote({ isProtected: true });
        expect(protectedNote.isContentAvailable()).toBe(false);

        vi.mocked(protectedSessionHolder.isProtectedSessionAvailable).mockReturnValue(true);
        expect(protectedNote.isContentAvailable()).toBe(true);
    });

    it("getMetadata calls the server metadata endpoint", async () => {
        const metadata = {
            dateCreated: "2020", utcDateCreated: "2020", dateModified: "2021", utcDateModified: "2021"
        };
        const getSpy = vi.spyOn(server, "get").mockResolvedValue(metadata);
        const note = makeNote({ noteId: "metaNote" });

        expect(await note.getMetadata()).toBe(metadata);
        expect(getSpy).toHaveBeenCalledWith("notes/metaNote/metadata");
    });
});

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

interface MockFrocaOverrides {
    getBlob?: () => Promise<FBlob | null>;
    getAttachmentsForNote?: () => Promise<FAttachment[]>;
    getNote?: (noteId: string) => Promise<FNote | null>;
}

function makeNote(rowOverrides: Partial<FNoteRow> & MockFrocaOverrides = {}): FNote {
    const { getBlob, getAttachmentsForNote, getNote, ...rowRest } = rowOverrides;
    const row: FNoteRow = {
        noteId: rowRest.noteId ?? `mock-${Math.random().toString(36).slice(2, 10)}`,
        title: rowRest.title ?? "mock",
        type: (rowRest.type ?? "text") as NoteType,
        mime: rowRest.mime ?? "text/html",
        isProtected: rowRest.isProtected ?? false,
        blobId: rowRest.blobId ?? "blob1"
    };

    const mockFroca = {
        notes: {},
        attributes: {},
        getBlob: getBlob ?? (async () => null),
        getAttachmentsForNote: getAttachmentsForNote ?? (async () => []),
        getNote: getNote ?? (async () => null)
    } as unknown as import("../services/froca-interface.js").Froca;

    return new FNote(mockFroca, row);
}

function makeBlob(content: string | undefined): FBlob {
    return new FBlob({
        blobId: "blob1",
        content: content as unknown as string,
        contentLength: content ? content.length : 0,
        dateModified: "2020",
        utcDateModified: "2020"
    });
}

function registerBranch(branchId: string, noteId: string, parentNoteId: string, notePosition: number | undefined) {
    froca.branches[branchId] = new FBranch(froca, {
        branchId,
        noteId,
        parentNoteId,
        notePosition: notePosition as number,
        fromSearchNote: false
    });
}

function makeAttachment(overrides: { attachmentId: string; role: string }): FAttachment {
    const attachmentFroca = { attachments: {} } as unknown as import("../services/froca-interface.js").Froca;
    return new FAttachment(attachmentFroca, {
        attachmentId: overrides.attachmentId,
        ownerId: "owner",
        role: overrides.role,
        mime: "image/png",
        title: "att",
        dateModified: "2020",
        utcDateModified: "2020",
        utcDateScheduledForErasureSince: "2020",
        contentLength: 0
    });
}

function makeRelationAttr(overrides: { attributeId: string; noteId: string; name: string; value: string }): FAttribute {
    return new FAttribute(froca, {
        attributeId: overrides.attributeId,
        noteId: overrides.noteId,
        type: "relation",
        name: overrides.name,
        value: overrides.value,
        position: 0,
        isInheritable: false
    });
}
