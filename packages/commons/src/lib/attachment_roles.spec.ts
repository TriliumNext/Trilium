import { describe, expect, it } from "vitest";

import { ATTACHMENT_ROLES, attachmentIcon, attachmentRoleTraits, IMAGE_ATTACHMENT_ROLES, isDeduplicatedAttachmentRole, isEmbeddedAttachmentRole, isImageAttachmentRole } from "./attachment_roles.js";
import { getNoteIcon } from "./notes.js";

describe("isImageAttachmentRole", () => {
    it("recognises every picture role and nothing else", () => {
        for (const role of IMAGE_ATTACHMENT_ROLES) {
            expect(isImageAttachmentRole(role), role).toBe(true);
        }

        // The roles that are not pictures. "viewConfig" and "importSource" matter most: they are
        // managed by whatever created them, so treating one as a picture would put it in front of
        // the cleanup that erases unreferenced attachments.
        for (const role of [ "file", "viewConfig", "importSource", "Image", "", "favicons" ]) {
            expect(isImageAttachmentRole(role), role).toBe(false);
        }

        expect(isImageAttachmentRole(undefined)).toBe(false);
        expect(isImageAttachmentRole(null)).toBe(false);
    });

    it("covers both the user's own pictures and the ones the app fetched for them", () => {
        expect(isImageAttachmentRole("image")).toBe(true);
        expect(isImageAttachmentRole("favicon")).toBe(true);
    });
});

describe("isEmbeddedAttachmentRole", () => {
    it("covers what lives in the note's content, and nothing that manages itself", () => {
        // What the cleanup that erases unreferenced attachments is allowed to look at. A link
        // preview's pictures belong here: nothing manages them, so deleting the preview has to be
        // what eventually takes them with it.
        for (const role of [ "image", "file", "favicon", "coverImage" ]) {
            expect(isEmbeddedAttachmentRole(role), role).toBe(true);
        }

        // Nothing in the content ever refers to these, so letting the cleanup see them would erase
        // every one of them on the next save.
        for (const role of [ "viewConfig", "canvasLibraryItem", "importSource" ]) {
            expect(isEmbeddedAttachmentRole(role), role).toBe(false);
        }

        // A role from a script, or from a newer version reached over sync, is not one to hand the
        // cleanup either — it answers for nothing it has never heard of.
        expect(isEmbeddedAttachmentRole("somethingAScriptInvented")).toBe(false);
        expect(isEmbeddedAttachmentRole(undefined)).toBe(false);
        expect(isEmbeddedAttachmentRole(null)).toBe(false);
    });
});

describe("attachmentRoleTraits", () => {
    it("answers nothing for a role it does not recognise", () => {
        // A script's own role, or one from a newer version reached over sync.
        expect(attachmentRoleTraits("somethingAScriptInvented")).toBeUndefined();
        expect(attachmentRoleTraits(undefined)).toBeUndefined();
        expect(attachmentRoleTraits("")).toBeUndefined();

        // The role is whatever was stored, so these reach the lookup too. Read off the table rather
        // than checked against it, they would answer with something from its prototype — and
        // `"constructor"` is truthy, which would make every question below answer yes.
        expect(attachmentRoleTraits("constructor")).toBeUndefined();
        expect(attachmentRoleTraits("toString")).toBeUndefined();
        expect(isImageAttachmentRole("constructor")).toBe(false);
    });

    it("gives every role an answer to every question", () => {
        // The types already refuse a role that arrives without one; this says the same at runtime,
        // for the shape the table is actually read with.
        for (const [ role, traits ] of Object.entries(ATTACHMENT_ROLES)) {
            expect(Object.keys(traits).sort(), role).toStrictEqual([ "copiedAs", "deduplicated", "embedded", "icon", "picture" ]);
        }
    });

    it("is what the questions are answered from", () => {
        for (const [ role, traits ] of Object.entries(ATTACHMENT_ROLES)) {
            expect(isImageAttachmentRole(role), role).toBe(traits.picture);
            expect(isDeduplicatedAttachmentRole(role), role).toBe(traits.deduplicated);
            expect(isEmbeddedAttachmentRole(role), role).toBe(traits.embedded);
        }
    });
});

describe("copiedAs", () => {
    it("hands a copy to whoever made it: a picture the app fetched becomes one the reader placed", () => {
        // The point of the column. A link preview's pictures are the app's while they belong to the
        // preview; carried into a note by hand they are a picture like any other, and keeping the
        // role would leave them deduplicated by title against that note's own previews, denied OCR
        // and compression, and filed under the half of the list nobody opens.
        expect(ATTACHMENT_ROLES.favicon.copiedAs).toBe("image");
        expect(ATTACHMENT_ROLES.coverImage.copiedAs).toBe("image");
    });

    it("leaves the roles a reader already owns as they are", () => {
        expect(ATTACHMENT_ROLES.image.copiedAs).toBe("image");
        expect(ATTACHMENT_ROLES.file.copiedAs).toBe("file");
    });

    it("hands over what the app kept for itself as a plain file", () => {
        // None of these is reachable by copying today — nothing in a note's content refers to them —
        // but the question has an answer all the same, and it is not "carry on managing yourself in
        // a note that has no idea you exist".
        expect(ATTACHMENT_ROLES.viewConfig.copiedAs).toBe("file");
        expect(ATTACHMENT_ROLES.canvasLibraryItem.copiedAs).toBe("file");
        expect(ATTACHMENT_ROLES.importSource.copiedAs).toBe("file");
    });

    it("only ever hands over something the reader can own", () => {
        // A copy lands on a role that means "someone put this here" — never on another of the app's,
        // which would only move the problem.
        for (const [ role, traits ] of Object.entries(ATTACHMENT_ROLES)) {
            expect([ "image", "file" ], role).toContain(traits.copiedAs);
            expect(ATTACHMENT_ROLES[traits.copiedAs].picture, role).toBe(traits.picture);
        }
    });
});

describe("attachmentIcon", () => {
    it("reads the media type for what a reader put there themselves", () => {
        // Between a spreadsheet, a PDF and a video, the difference worth showing is the content's:
        // "file" is the same word for all three.
        expect(attachmentIcon("file", "application/pdf")).toBe("bx bxs-file-pdf");
        expect(attachmentIcon("file", "video/mp4")).toBe("bx bx-video");
        expect(attachmentIcon("file", "audio/mpeg")).toBe("bx bx-music");
        expect(attachmentIcon("image", "image/gif")).toBe("bx bxs-file-gif");
        expect(attachmentIcon("image", "image/png")).toBe("bx bx-image");
    });

    it("gives an attachment the icon a note of the same content would have", () => {
        // The point of routing both through one table: a PDF is a PDF however it got here.
        for (const [ type, mime ] of [ [ "file", "application/pdf" ], [ "file", "video/mp4" ], [ "image", "image/gif" ] ] as const) {
            expect(attachmentIcon(type, mime), mime).toBe(getNoteIcon({
                noteId: "abc123", type, mime, iconClass: undefined, workspaceIconClass: undefined, isFolder: () => false
            }));
        }
    });

    it("names the app's own doing for the roles the app created", () => {
        // Their content is an implementation detail — a favicon is a PNG, a saved view is JSON — and
        // what a reader wants told is which part of the app put it there.
        expect(attachmentIcon("favicon", "image/png")).toBe("bx bx-globe");
        expect(attachmentIcon("coverImage", "image/jpeg")).toBe("bx bx-image-alt");
        expect(attachmentIcon("viewConfig", "application/json")).toBe("bx bx-cog");
        expect(attachmentIcon("canvasLibraryItem", "application/json")).toBe("bx bx-shape-square");
        expect(attachmentIcon("importSource", "application/zip")).toBe("bx bx-import");
    });

    it("treats a role it has never heard of as the reader's own upload", () => {
        // Whatever a script attached, the reader is still looking at a file.
        expect(attachmentIcon("somethingAScriptInvented", "application/pdf")).toBe("bx bxs-file-pdf");
        // The role and the media type are both whatever was stored, so these reach the lookups; read
        // off a table rather than checked against it, they would answer with one of its prototype's
        // functions, which survives the fallback and is handed on as an icon class.
        expect(attachmentIcon("constructor", "image/gif")).toBe("bx bxs-file-gif");
        expect(attachmentIcon("file", "constructor")).toBe("bx bx-file");
        expect(attachmentIcon("file", "toString")).toBe("bx bx-file");
    });

    it("always answers, whatever is missing", () => {
        // An attachment with no media type recorded still has a row in the list to fill.
        expect(attachmentIcon("file", undefined)).toBe("bx bx-file");
        expect(attachmentIcon(undefined, undefined)).toBe("bx bx-file");
        expect(attachmentIcon(null, "")).toBe("bx bx-file");
    });

    it("gives every role an icon, or says plainly that it has none", () => {
        for (const [ role, traits ] of Object.entries(ATTACHMENT_ROLES)) {
            expect(attachmentIcon(role, "application/pdf"), role).toBe(traits.icon ?? "bx bxs-file-pdf");
        }
    });
});

describe("isDeduplicatedAttachmentRole", () => {
    it("deduplicates only what the app named itself", () => {
        // A site's icon: one per site rather than one per link to it.
        expect(isDeduplicatedAttachmentRole("favicon")).toBe(true);

        // Never a picture the user placed. Two images they gave the same name are two images, and
        // collapsing them by title would lose one.
        for (const role of [ "image", "file", "viewConfig", "importSource", "" ]) {
            expect(isDeduplicatedAttachmentRole(role), role).toBe(false);
        }

        expect(isDeduplicatedAttachmentRole(undefined)).toBe(false);
        expect(isDeduplicatedAttachmentRole(null)).toBe(false);
    });
});
