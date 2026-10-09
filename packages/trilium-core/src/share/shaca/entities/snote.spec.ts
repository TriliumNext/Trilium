import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { encodeUtf8 } from "../../../services/utils/binary.js";
import { buildShareNote, stubShareSql } from "../../../test/shaca_mocking.js";
import shaca from "../shaca.js";
import SAttribute from "./sattribute.js";
import SBranch from "./sbranch.js";
import SNote from "./snote.js";

const PNG_BYTES = new Uint8Array([ 0x89, 0x50, 0x4e, 0x47 ]);
const BLOBS: Record<string, { content: string | Uint8Array | null }> = {
    json: { content: encodeUtf8("{ \"a\": 1 }") },
    invalidJson: { content: "{ nope" },
    blank: { content: "   " },
    empty: { content: null },
    image: { content: PNG_BYTES }
};

describe("SNote", () => {
    let restore: () => void;

    beforeEach(() => {
        shaca.reset();
        restore = stubShareSql({ getRow: (_query, [ blobId ]) => BLOBS[blobId] });
    });

    afterEach(() => {
        restore();
    });

    it("reads its content as text, bytes or JSON", () => {
        const note = (id: string, type: string, mime: string, blobId = id) =>
            new SNote([ id, id, type, mime, blobId, "2025-01-01", false ]);

        const json = note("json", "code", "application/json");
        expect(json.hasStringContent()).toBe(true);
        expect(json.getContent()).toBe("{ \"a\": 1 }");
        expect(json.getJsonContent()).toEqual({ a: 1 });
        expect(json.getJsonContentSafely()).toEqual({ a: 1 });

        const invalid = note("invalidJson", "code", "application/json");
        expect(() => invalid.getJsonContent()).toThrow(SyntaxError);
        expect(invalid.getJsonContentSafely()).toBeNull();

        const empty = note("empty", "code", "application/json");
        expect(empty.getContent()).toBe("");
        expect(empty.getJsonContent()).toBeNull();
        expect(note("blank", "code", "application/json").getJsonContent()).toBeNull();

        const image = note("image", "image", "image/png");
        expect(image.hasStringContent()).toBe(false);
        expect(image.getContent()).toBe(PNG_BYTES);
        expect(image.getJsonContent()).toBeNull();

        const missing = note("missing", "text", "text/html", "noSuchBlob");
        expect(missing.getContent(true)).toBeUndefined();
        expect(() => missing.getContent()).toThrow(
            "Cannot find note content for note 'missing', blob 'noSuchBlob'"
        );
    });

    it("lists its children, hiding those marked hidden from the tree", () => {
        const parent = buildShareNote({
            id: "parent",
            children: [ { id: "shown" }, { id: "hidden", "#shareHiddenFromTree": "" } ]
        });
        const lonely = buildShareNote({
            id: "lonely",
            children: [ { id: "secret", "#shareHiddenFromTree": "" } ]
        });
        const leaf = buildShareNote({ id: "leaf" });

        expect(parent.getChildNotes().map((note) => note.noteId)).toEqual([ "shown", "hidden" ]);
        expect(parent.getVisibleChildNotes().map((note) => note.noteId)).toEqual([ "shown" ]);
        expect([ parent, lonely, leaf ].map((note) => note.hasChildren()))
            .toEqual([ true, true, false ]);
        expect([ parent, lonely, leaf ].map((note) => note.hasVisibleChildren()))
            .toEqual([ true, false, false ]);
        expect([ parent, leaf ].map((note) => note.isFolder())).toEqual([ true, false ]);
    });

    it("inherits attributes from parents and templates, once each and without looping", () => {
        const parent = buildShareNote({ id: "parent", children: [ { id: "child" } ] });
        const template = buildShareNote({ id: "template" });
        const child = shaca.getNote("child");

        addAttribute("fromTemplate", "template", "label", "fromTemplate", "yes");
        addAttribute("inherited", "parent", "label", "inherited", "1", true);
        addAttribute("notInherited", "parent", "label", "notInherited", "1");
        addAttribute("toTemplate", "child", "relation", "template", "template");
        addAttribute("toParent", "child", "relation", "inherit", "parent");
        addAttribute("toMissing", "child", "relation", "template", "missing");
        addAttribute("toSelf", "template", "relation", "template", "template");
        // A parent-child cycle: the child is also the parent's parent.
        new SBranch([ "cycle", "parent", "child", "", "", false ]);

        expect(child.getAttributes().map((attr) => attr.attributeId)).toEqual([
            "toTemplate", "toParent", "toMissing", "inherited",
            "fromTemplate", "toSelf", "notInherited"
        ]);
        expect(child.getLabelValue("inherited")).toBe("1");
        expect(child.getLabelValue("fromTemplate")).toBe("yes");
        expect(child.isInherited()).toBe(false);
        expect(template.isInherited()).toBe(true);
        expect(parent.isInherited()).toBe(true);
        expect(template.getTargetRelations().map((rel) => rel.attributeId))
            .toEqual([ "toTemplate", "toSelf" ]);
    });

    it("does not let the root note inherit from a parent", () => {
        const root = buildShareNote({ id: "root" });
        const above = buildShareNote({ id: "above" });
        new SAttribute([ "fromAbove", "above", "label", "fromAbove", "", true, 0 ]);
        new SBranch([ "rootUnderAbove", "root", "above", "", "", false ]);

        expect(root.getParentNotes()).toEqual([ above ]);
        expect(root.hasLabel("fromAbove")).toBe(false);
    });

    it("finds attributes by type and name, owned or inherited, and keeps credentials apart", () => {
        const parent = buildShareNote({ id: "parent", children: [ { id: "note" } ] });
        const target = buildShareNote({ id: "target" });
        const note = shaca.getNote("note");

        const color = addAttribute("color", "note", "label", "color", "red");
        const color2 = addAttribute("color2", "note", "label", "color", "blue");
        const archived = addAttribute("archived", "parent", "label", "archived", "", true);
        const enabled = addAttribute("enabled", "note", "label", "enabled", "false");
        const related = addAttribute("related", "note", "relation", "related", "target");
        const credentials =
            addAttribute("credentials", "note", "label", "shareCredentials", "user:pass");

        expect(note.getAttributes()).toEqual([ color, color2, enabled, related, archived ]);
        expect(note.getAttributes("label")).toEqual([ color, color2, enabled, archived ]);
        expect(note.getAttributes(undefined, "color")).toEqual([ color, color2 ]);
        expect(note.getAttributes("label", "shareCredentials")).toEqual([]);
        expect(note.getCredentials()).toEqual([ credentials ]);

        expect(note.hasLabel("archived")).toBe(true);
        expect(note.hasOwnedLabel("archived")).toBe(false);
        expect(note.isArchived).toBe(true);
        expect(parent.isArchived).toBe(true);
        expect(target.isArchived).toBe(false);
        expect([ "color", "enabled", "missing" ].map((name) => note.isLabelTruthy(name)))
            .toEqual([ true, false, false ]);

        expect(note.getLabel("color")).toBe(color);
        expect(note.getOwnedLabel("color")).toBe(color);
        expect(note.getOwnedLabel("missing")).toBeNull();
        expect(note.getLabelValue("missing")).toBeNull();
        expect(note.getOwnedLabelValue("color")).toBe("red");
        expect(note.getOwnedLabelValue("missing")).toBeNull();
        expect(note.getLabels("color")).toEqual([ color, color2 ]);
        expect(note.getLabelValues("color")).toEqual([ "red", "blue" ]);
        expect(note.getOwnedLabels("archived")).toEqual([]);
        expect(note.getOwnedLabelValues("color")).toEqual([ "red", "blue" ]);

        expect(note.hasRelation("related")).toBe(true);
        expect(note.hasOwnedRelation("related")).toBe(true);
        expect(note.hasOwnedRelation("color")).toBe(false);
        expect(note.getRelation("related")).toBe(related);
        expect(note.getOwnedRelation("related")).toBe(related);
        expect(note.getRelations("related")).toEqual([ related ]);
        expect(note.getOwnedRelations("related")).toEqual([ related ]);
        expect(note.getRelationValue("related")).toBe("target");
        expect(note.getOwnedRelationValue("related")).toBe("target");
        expect(note.getRelationTarget("related")).toBe(target);
        expect(note.getRelationTarget("missing")).toBeNull();

        expect(note.getOwnedAttributes("label", "#color")).toEqual([ color, color2 ]);
        expect(note.getOwnedAttributes("relation", "~related")).toEqual([ related ]);
        expect(note.getOwnedAttributes("relation", "")).toEqual([ related ]);
        expect(note.getOwnedAttributes("", "color")).toEqual([ color, color2 ]);
        expect(note.getOwnedAttributes("", "")).toEqual(note.ownedAttributes);
        expect(note.getOwnedAttributes("", "")).not.toBe(note.ownedAttributes);
        expect(note.getOwnedAttribute("label", "missing")).toBeNull();
        expect(note.hasOwnedAttribute("label", "enabled")).toBe(true);
        expect(note.getAttributeValue("relation", "missing")).toBeNull();
        expect(note.getOwnedAttributeValue("label", "missing")).toBeNull();
    });

    it("describes itself for the share page and its API", () => {
        const parent = buildShareNote({
            id: "parent",
            title: "Tom & Jerry",
            "#iconClass": "bx bx-star",
            "~related": "parent",
            attachments: [ { id: "att", title: "Diagram", mime: "image/png", role: "image" } ],
            children: [ { id: "child" }, { id: "hidden", "#shareHiddenFromTree": "" } ]
        });
        new SAttribute([ "otherIcon", "parent", "label", "iconClass", "tn-icon-x", false, 9 ]);
        const aliased = buildShareNote({ id: "aliased", "#shareAlias": "my-alias" });
        const root = buildShareNote({ id: "rootNote", "#shareRoot": "" });

        expect([ parent, aliased, root ].map((note) => note.shareId))
            .toEqual([ "parent", "my-alias", "" ]);
        expect(parent.escapedTitle).toBe("Tom &amp; Jerry");
        expect(parent.encodedTitle).toBe("Tom%20%26%20Jerry");
        expect(parent.getAttachmentByTitle("Diagram")?.getPojo().attachmentId).toBe("att");
        expect(parent.getAttachmentByTitle("Missing")).toBeUndefined();
        expect(parent.getIcon()).toBe("tn-icon bx bx-star");
        expect(parent.getIcon([ "tn-icon" ])).toBe("tn-icon tn-icon-x");

        const pojo = parent.getPojo();
        expect(pojo).toMatchObject({
            noteId: "parent",
            title: "Tom & Jerry",
            type: "text",
            mime: "text/html",
            parentNoteIds: [],
            childNoteIds: [ "child" ]
        });
        expect(pojo.attributes.map((attr) => attr.name)).toEqual([ "iconClass", "iconClass" ]);
        expect(pojo.attachments.map((attachment) => attachment.attachmentId)).toEqual([ "att" ]);
        expect(shaca.getNote("child").getPojo().parentNoteIds).toEqual([ "parent" ]);
    });

    it("hides a protected note's title", () => {
        const note = buildShareNote({ id: "locked", title: "Secret plans", isProtected: true });

        expect(note.title).toBe("[protected]");
        expect(note.isProtected).toBe(true);
    });
});

function addAttribute(id: string, noteId: string, type: string, name: string, value: string,
    isInheritable = false) {
    return new SAttribute([ id, noteId, type, name, value, isInheritable, 0 ]);
}
