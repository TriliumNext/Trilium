import { describe, expect, it } from "vitest";

import { ATTACHMENT_ROLES } from "@triliumnext/commons";

import { ATTACHMENT_ROLE_GROUPS, attachmentGroupForRole, partitionAttachmentsByGroup } from "./attachment_groups.js";

describe("attachmentGroupForRole", () => {
    it("puts what the user placed on one side and what the app made on the other", () => {
        expect(attachmentGroupForRole("image")).toBe("user");
        expect(attachmentGroupForRole("file")).toBe("user");

        for (const [ role, group ] of Object.entries(ATTACHMENT_ROLE_GROUPS)) {
            expect(attachmentGroupForRole(role), role).toBe(group);
        }
    });

    it("places every role the app creates", () => {
        // The types already refuse a `Record` with a role missing from it; this says the same of a
        // role added to neither, which would otherwise reach the list as one more of the user's own.
        expect(Object.keys(ATTACHMENT_ROLE_GROUPS).sort()).toStrictEqual(Object.keys(ATTACHMENT_ROLES).sort());
    });

    it("counts a role it has never heard of as the user's", () => {
        // The default view is the user's, so an unrecognised role — a script's own, or one added to
        // the app since — shows up rather than being buried under a group nobody thought to open.
        expect(attachmentGroupForRole("somethingAScriptInvented")).toBe("user");
        expect(attachmentGroupForRole("unknownRole")).toBe("user");
        expect(attachmentGroupForRole(undefined)).toBe("user");
        expect(attachmentGroupForRole("")).toBe("user");
        // The role is whatever was stored, so these reach the lookup too; read off the object rather
        // than checked against it, they would answer with something from its prototype.
        expect(attachmentGroupForRole("constructor")).toBe("user");
        expect(attachmentGroupForRole("toString")).toBe("user");
    });

    it("matches a role exactly, rather than by resemblance", () => {
        expect(attachmentGroupForRole("Favicon")).toBe("user");
        expect(attachmentGroupForRole("favicons")).toBe("user");
    });
});

describe("partitionAttachmentsByGroup", () => {
    it("splits in two, keeping each side in the order it arrived", () => {
        const attachments = [
            { role: "favicon", id: 1 },
            { role: "image", id: 2 },
            { role: "coverImage", id: 3 },
            { role: "file", id: 4 },
            { role: "image", id: 5 }
        ];

        expect(partitionAttachmentsByGroup(attachments)).toStrictEqual({
            user: [ { role: "image", id: 2 }, { role: "file", id: 4 }, { role: "image", id: 5 } ],
            system: [ { role: "favicon", id: 1 }, { role: "coverImage", id: 3 } ]
        });
    });

    it("always returns both halves, so an empty one can still be counted", () => {
        // What the switcher reads to say a second group exists at all — an absent key would leave it
        // unable to tell "no system attachments" from "not looked yet".
        expect(partitionAttachmentsByGroup([])).toStrictEqual({ user: [], system: [] });
        expect(partitionAttachmentsByGroup([ { role: "image" } ])).toStrictEqual({
            user: [ { role: "image" } ],
            system: []
        });
    });
});
