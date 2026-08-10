import { describe, expect, it, vi } from "vitest";

import becca from "../becca/becca.js";
import BNote from "../becca/entities/bnote.js";
import { getContext } from "../services/context.js";
import { getLog } from "../services/log.js";
import noteService from "../services/notes.js";
import optionService from "../services/options.js";
import { getSql } from "../services/sql/index.js";
import migration from "./0220__migrate_images_to_attachments.js";

/**
 * Creates a text note holding an image child that is referenced from it through an
 * `imageLink` relation — the exact shape the migration converts into an attachment.
 */
function createLinkedImageNote(suffix: string) {
    return getContext().init(() => {
        const { note: parent } = noteService.createNewNote({
            parentNoteId: "root",
            title: `0220-parent-${suffix}`,
            content: `<p>before</p>`,
            type: "text"
        });
        const { note: image } = noteService.createNewNote({
            parentNoteId: parent.noteId,
            title: `0220-image-${suffix}.png`,
            content: Buffer.from("fake-png-bytes"),
            type: "image",
            mime: "image/png"
        });
        parent.addRelation("imageLink", image.noteId);

        return { parentNoteId: parent.noteId, imageNoteId: image.noteId, imageTitle: image.title };
    });
}

describe("Migration 0220: migrate images to attachments", () => {
    it("disables image compression and converts a linked image note into a parent attachment", () => {
        const { parentNoteId, imageNoteId, imageTitle } = createLinkedImageNote("ok");

        migration();

        expect(optionService.getOption("compressImages")).toBe("false");

        // The image note itself is (soft) deleted and its content now lives as an
        // attachment of the referencing parent.
        expect(
            getSql().getValue<number>("SELECT isDeleted FROM notes WHERE noteId = ?", [imageNoteId])
        ).toBe(1);
        const attachments = becca.getNoteOrThrow(parentNoteId).getAttachmentsByRole("image");
        expect(attachments.map((attachment) => attachment.title)).toContain(imageTitle);
    });

    it("logs the failure and keeps going when a note cannot be converted", () => {
        const { imageNoteId } = createLinkedImageNote("boom");

        const errorSpy = vi.spyOn(getLog(), "error").mockImplementation(() => {});
        const convertSpy = vi
            .spyOn(BNote.prototype, "convertToParentAttachment")
            .mockImplementation(function (this: BNote) {
                if (this.noteId === imageNoteId) {
                    throw new Error("conversion exploded");
                }
                return null;
            });

        try {
            // A single unconvertible note must not abort the whole migration.
            expect(() => migration()).not.toThrow();
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("conversion exploded"));
        } finally {
            convertSpy.mockRestore();
            errorSpy.mockRestore();
        }
    });
});
