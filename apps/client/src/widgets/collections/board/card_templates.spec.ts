import { describe, expect, it } from "vitest";

import { type NoteTypeOption } from "../../../services/note_types";
import { currentCardTemplate, DEFAULT_CARD_TEMPLATES } from "./card_templates";

/** An option as `getNoteTypeOptions` builds one, cut down to what the board reads. */
function option(id: string, title: string): NoteTypeOption {
    return { id, title, icon: "bx bx-note", group: "type", options: { type: "text" } };
}

describe("what a board makes its cards from", () => {
    it("offers text, Markdown, canvas and a spreadsheet until the reader says otherwise", () => {
        expect(DEFAULT_CARD_TEMPLATES).toEqual([
            "type:text:text/html",
            "type:code:text/x-markdown",
            "type:canvas:application/json",
            "type:spreadsheet:application/json"
        ]);
    });

    /**
     * What the board stored can be gone: switched off in the dialog, or a template note deleted.
     * A card is made from the first thing offered rather than from nothing.
     */
    it("falls back to the first offered template", () => {
        const offered = [ option("type:text:text/html", "Text"), option("note:mine", "Mine") ];

        expect(currentCardTemplate(offered, "note:mine")?.title).toBe("Mine");
        expect(currentCardTemplate(offered, "type:canvas:application/json")?.title).toBe("Text");
        expect(currentCardTemplate(offered, undefined)?.title).toBe("Text");
        expect(currentCardTemplate([], "type:text:text/html")).toBeUndefined();
    });
});
