import { describe, expect, it } from "vitest";
import { mapByNoteType } from "./single.js";
import { buildNote } from "../../test/becca_easy_mocking.js";

describe("Note type mappings", () => {
    it("supports mermaid note", () => {
        const note = buildNote({
            type: "mermaid",
            title: "New note"
        });

        expect(mapByNoteType(note, "", "html")).toMatchObject({
            extension: "mermaid",
            mime: "text/vnd.mermaid"
        });
    });
});
