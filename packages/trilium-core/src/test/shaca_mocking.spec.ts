import { beforeEach, describe, expect, it } from "vitest";

import shaca from "../share/shaca/shaca.js";
import { buildShareNote } from "./shaca_mocking.js";

describe("buildShareNote", () => {
    beforeEach(() => {
        shaca.reset();
    });

    it("withholds a protected note's content and gives an attachment without an id a random one", () => {
        const note = buildShareNote({ title: "Secret", isProtected: true, content: "hidden", attachments: [ { title: "a.txt" } ] });

        expect(note.getContent()).toBeUndefined();
        expect(shaca.notes[note.noteId]).toBe(note);
        expect(Object.values(shaca.attachments).map((attachment) => [ attachment.ownerId, attachment.attachmentId.length ]))
            .toEqual([ [ note.noteId, 12 ] ]);
    });
});
