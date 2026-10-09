import { beforeEach, describe, expect, it } from "vitest";

import { buildShareNote } from "../../../test/shaca_mocking.js";
import shaca from "../shaca.js";
import SAttribute from "./sattribute.js";

describe("SAttribute", () => {
    beforeEach(() => {
        shaca.reset();
    });

    it("registers itself on its note, its target and the share-wide labels", () => {
        const owner = buildShareNote({
            id: "owner",
            children: [ { id: "image" }, { id: "visible" } ]
        });
        const target = buildShareNote({ id: "target" });
        const add = (id: string, type: string, name: string, value: string) =>
            new SAttribute([ id, "owner", type, name, value, false, 0 ]);

        const relation = add("rel", "relation", "related", "target");
        expect(owner.ownedAttributes).toContain(relation);
        expect(shaca.getAttribute("rel")).toBe(relation);
        expect(target.getTargetRelations()).toEqual([ relation ]);

        add("img", "relation", "imageLink", "image");
        add("ext", "relation", "imageLink", "target");
        expect(owner.getVisibleChildNotes().map((note) => note.noteId)).toEqual([ "visible" ]);

        add("blankAlias", "label", "shareAlias", "  ");
        expect(shaca.aliasToNote).toEqual({});
        add("alias", "label", "shareAlias", " my-alias ");
        expect(shaca.aliasToNote).toEqual({ "my-alias": owner });

        expect(shaca.shareRootNote).toBeNull();
        expect(shaca.shareIndexEnabled).toBe(false);
        add("root", "label", "shareRoot", "");
        add("index", "label", "shareIndex", "");
        expect(shaca.shareRootNote).toBe(owner);
        expect(shaca.shareIndexEnabled).toBe(true);
    });

    it("tells relations from labels and resolves their notes", () => {
        const owner = buildShareNote({ id: "owner" });
        const target = buildShareNote({ id: "target" });
        const add = (type: string, name: string, value: string, isInheritable = false) =>
            new SAttribute([ `${type}-${name}`, "owner", type, name, value, isInheritable, 3 ]);

        const label = add("label", "color", "red");
        const inheritable = add("label", "cssClass", "x", true);
        const template = add("relation", "template", "target");
        const internalLink = add("relation", "internalLink", "target");
        const empty = add("relation", "related", "");

        expect([ label, inheritable, template, internalLink ].map((a) => a.isAffectingSubtree))
            .toEqual([ false, true, true, false ]);
        expect([ label, template, internalLink ].map((a) => a.isAutoLink()))
            .toEqual([ false, false, true ]);

        expect(label.targetNoteId).toBeUndefined();
        expect(label.targetNote).toBeUndefined();
        expect(() => label.getTargetNote()).toThrow("Attribute 'label-color' is not relation");
        expect(template.targetNoteId).toBe("target");
        expect(template.targetNote).toBe(target);
        expect(template.getTargetNote()).toBe(target);
        expect(empty.getTargetNote()).toBeNull();

        expect(label.note).toBe(owner);
        expect(label.getNote()).toBe(owner);
        expect(inheritable.getPojo()).toEqual({
            attributeId: "label-cssClass",
            noteId: "owner",
            type: "label",
            name: "cssClass",
            position: 3,
            value: "x",
            isInheritable: true
        });
    });
});
