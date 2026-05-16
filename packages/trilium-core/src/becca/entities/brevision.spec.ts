import { describe, expect, it } from "vitest";

import BRevision from "./brevision.js";

describe("Revision", () => {
    it("handles note with empty title properly", () => {
        const revision = new BRevision({
            revisionId: "4omM5OvlLhOw",
            noteId: "WHMg7iFCRG3Z",
            type: "text",
            mime: "text/html",
            isProtected: false,
            title: "",
            blobId: "",
            dateLastEdited: "2025-06-27 14:10:39.688+0300",
            dateCreated: "2025-06-27 14:10:39.688+0300",
            utcDateLastEdited: "2025-06-27 14:10:39.688+0300",
            utcDateCreated: "2025-06-27 14:10:39.688+0300",
            utcDateModified: "2025-06-27 14:10:39.688+0300"
        });
        const pojo = revision.getPojo();
        expect(pojo.title).toBeDefined();
    });
});
