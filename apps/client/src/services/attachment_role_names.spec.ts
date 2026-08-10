import { ATTACHMENT_ROLES } from "@triliumnext/commons";
import { describe, expect, it, vi } from "vitest";

// Nothing initializes i18next for the tests, so the wording is stood in for by the key — which is
// what the mapping here is actually about.
vi.mock("./i18n.js", () => ({ t: (key: string) => key }));

const { attachmentRoleLabel } = await import("./attachment_role_names.js");

describe("attachmentRoleLabel", () => {
    it("names the app's own doing, which nothing else in the card does", () => {
        // "Site icon" is the whole reason that row is not a picture the reader forgot placing.
        for (const role of [ "favicon", "coverImage", "viewConfig", "canvasLibraryItem", "importSource" ]) {
            expect(attachmentRoleLabel(role), role).toBe(`attachment_roles.${role}`);
        }
    });

    it("says nothing over what a reader placed themselves", () => {
        // "Image" over a picture, "File" over a PDF's own mark: the icon beside the title has said it.
        expect(attachmentRoleLabel("image")).toBeNull();
        expect(attachmentRoleLabel("file")).toBeNull();
    });

    it("follows the icon column rather than answering the question twice", () => {
        // The types already refuse a role given a mark of its own and no name; this says the same at
        // runtime, and the other way round too — so the two tables cannot drift apart.
        for (const [ role, traits ] of Object.entries(ATTACHMENT_ROLES)) {
            expect(attachmentRoleLabel(role) === null, role).toBe(traits.icon === null);
        }
    });

    it("keeps the name of a role it has never heard of", () => {
        // A script's own, or one from a newer version reached over sync. Not a name anyone chose, but
        // the only identification the attachment has.
        expect(attachmentRoleLabel("somethingAScriptInvented")).toBe("somethingAScriptInvented");
        // The role is whatever was stored, so these reach the lookups too; read off a table rather
        // than checked against it, they would answer with one of its prototype's functions.
        expect(attachmentRoleLabel("constructor")).toBe("constructor");
        expect(attachmentRoleLabel("toString")).toBe("toString");
    });

    it("says nothing for an attachment without a role", () => {
        expect(attachmentRoleLabel(undefined)).toBeNull();
        expect(attachmentRoleLabel(null)).toBeNull();
        expect(attachmentRoleLabel("")).toBeNull();
    });
});
