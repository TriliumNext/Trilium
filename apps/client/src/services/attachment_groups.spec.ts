import { describe, expect, it } from "vitest";

import {
    ATTACHMENT_ROLES, CANVAS_ATTACHMENT_MIME, CANVAS_ATTACHMENT_TITLE, getDrawingPictureTitle,
    NOTE_TYPE_IMAGE_ATTACHMENTS, type NoteType
} from "@triliumnext/commons";

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
        const attachments = [ "favicon", "image", "coverImage", "file", "image" ]
            .map((role, index) => attachment(`att${index}`, role));

        expect(groupIds(attachments, "text")).toStrictEqual({
            user: [ "att1", "att3", "att4" ],
            system: [ "att0", "att2" ]
        });
    });

    it("always returns both halves, so an empty one can still be counted", () => {
        // What the switcher reads to say a second group exists at all — an absent key would leave it
        // unable to tell "no system attachments" from "not looked yet".
        const image = attachment("att1", "image");
        expect(partitionAttachmentsByGroup([], "text")).toStrictEqual({ user: [], system: [] });
        expect(partitionAttachmentsByGroup([ image ], "text")).toStrictEqual({
            user: [ image ],
            system: []
        });
    });

    it("puts the pictures of a canvas note and of its drawings with the app's own", () => {
        const attachments = [
            attachment("notePicture", "image", NOTE_TYPE_IMAGE_ATTACHMENTS.canvas, SVG_MIME),
            attachment("canvasImage", "image", "5d8f3a0c9b", "image/png"),
            attachment("drawing", "file", CANVAS_ATTACHMENT_TITLE, CANVAS_ATTACHMENT_MIME),
            attachment("drawingPicture", "image", getDrawingPictureTitle("drawing"), SVG_MIME)
        ];

        expect(groupIds(attachments, "canvas")).toStrictEqual({
            user: [ "canvasImage", "drawing" ],
            system: [ "notePicture", "drawingPicture" ]
        });
    });

    it("keeps an attachment titled like a canvas picture with the user's own", () => {
        const attachments = [
            // A canvas note's picture title on a note of another type.
            attachment("exportTitle", "image", NOTE_TYPE_IMAGE_ATTACHMENTS.canvas, SVG_MIME),
            // A drawing picture title naming no drawing of the note.
            attachment("noDrawing", "image", getDrawingPictureTitle("missing"), SVG_MIME),
            attachment("drawing", "file", CANVAS_ATTACHMENT_TITLE, CANVAS_ATTACHMENT_MIME),
            // A drawing picture title on a file rather than an image.
            attachment("file", "file", getDrawingPictureTitle("drawing"), SVG_MIME)
        ];

        expect(groupIds(attachments, "text")).toStrictEqual({
            user: [ "exportTitle", "noDrawing", "drawing", "file" ],
            system: []
        });
    });
});

const SVG_MIME = "image/svg+xml";

function attachment(
    attachmentId: string,
    role: string,
    title = `${attachmentId}.dat`,
    mime = "application/octet-stream"
) {
    return { attachmentId, role, title, mime };
}

/** The IDs of `attachments` in each group, for a note of type `noteType`. */
function groupIds(attachments: ReturnType<typeof attachment>[], noteType: NoteType) {
    const { user, system } = partitionAttachmentsByGroup(attachments, noteType);
    return {
        user: user.map(({ attachmentId }) => attachmentId),
        system: system.map(({ attachmentId }) => attachmentId)
    };
}
