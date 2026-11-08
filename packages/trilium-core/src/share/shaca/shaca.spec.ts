import { beforeEach, describe, expect, it } from "vitest";

import { buildShareNote } from "../../test/shaca_mocking.js";
import shaca from "./shaca.js";

describe("shaca", () => {
    beforeEach(() => {
        shaca.reset();
    });

    it("looks up notes by ID, failing on a missing one unless told to skip it", () => {
        const first = buildShareNote({ id: "first" });
        const second = buildShareNote({ id: "second" });

        expect(shaca.hasNote("first")).toBe(true);
        expect(shaca.hasNote("missing")).toBe(false);
        expect(shaca.getNotes([ "second", "first" ])).toEqual([ second, first ]);
        expect(shaca.getNotes([ "first", "missing", "second" ], true)).toEqual([ first, second ]);
        expect(() => shaca.getNotes([ "first", "missing" ])).toThrow(
            "Note 'missing' was not found in shaca."
        );
    });

    it("looks up branches, attributes and attachments by ID and by entity name", () => {
        const parent = buildShareNote({
            id: "parent",
            "#color": "red",
            attachments: [ { id: "attachment", title: "Attachment" } ],
            children: [ { id: "child" } ]
        });
        const branch = shaca.getBranchFromChildAndParent("child", "parent");
        const [ label ] = parent.getOwnedLabels("color");
        const [ attachment ] = parent.getAttachments();

        expect(branch.getParentNote()).toBe(parent);
        expect(Object.keys(shaca.branches)).toHaveLength(1);
        expect(shaca.getBranch(Object.keys(shaca.branches)[0])).toBe(branch);
        expect(shaca.getAttribute(label.attributeId)).toBe(label);
        expect(shaca.getAttachment("attachment")).toBe(attachment);

        expect(shaca.getEntity("notes", "parent")).toBe(parent);
        expect(shaca.getEntity("attributes", label.attributeId)).toBe(label);
        expect(shaca.getEntity("child_parent_to_branch", "child-parent")).toBe(branch);
        expect(shaca.getEntity("", "parent")).toBeNull();
        expect(shaca.getEntity("notes", "")).toBeNull();
    });
});
