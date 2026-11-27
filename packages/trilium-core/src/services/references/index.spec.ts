import { afterEach, describe, expect, it } from "vitest";

import { ValidationError } from "../../errors.js";
import { getContext } from "../context.js";
import noteService from "../notes.js";
import protectedSessionService from "../protected_session.js";
import TaskContext from "../task_context.js";
import { encodeUtf8 } from "../utils/binary.js";
import { readContent } from "./index.js";

afterEach(() => protectedSessionService.resetDataKey());

describe("readContent", () => {
    it("reads a note or an attachment, and refuses either while protected outside the session", () => {
        const { note } = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root", title: "references-spec", type: "text", content: "<p>Body</p>"
        }));
        const attachment = getContext().init(() => note.saveAttachment({
            role: "file", mime: "text/plain", title: "attached.txt", content: "Attached"
        }));
        expect(readContent(note)).toBe("<p>Body</p>");

        protectedSessionService.setDataKey(encodeUtf8("0123456789abcdef"));
        getContext().init(() => noteService.protectNoteRecursively(note, true, false,
            new TaskContext("references-spec", "protectNotes", { protect: true })));
        const protectedAttachment = note.getAttachments()[0];
        protectedSessionService.resetDataKey();

        expect(() => readContent(note)).toThrow(new ValidationError(`Note '${note.noteId}' has no content available.`));
        expect(() => readContent(protectedAttachment)).toThrow(
            new ValidationError(`Attachment '${attachment.attachmentId}' has no content available.`));
    });
});
