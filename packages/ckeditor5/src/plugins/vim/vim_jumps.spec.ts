import { describe, expect, it } from "vitest";

import {
    createVimEditor, getCursor, getLines, paragraphs, press
} from "../../../test/vim-kit.js";

describe("the jump list", () => {
    it("goes back and forward through the jumps of its own editor only", async () => {
        const first = await createVimEditor(paragraphs("[]a", "b", "c", "d"));
        const second = await createVimEditor(paragraphs("[]e", "f", "g"));
        press(first, "G");
        press(second, "G");
        press(second, "<C-o>");
        expect(getCursor(second)).toBe("0:0");
        press(second, "<C-o>");
        expect(getCursor(second)).toBe("0:0");
        press(first, "<C-o>");
        expect(getCursor(first)).toBe("0:0");
        press(first, "<C-i>");
        expect(getCursor(first)).toBe("3:0");
        press(first, "gg''");
        expect(getCursor(first)).toBe("3:0");
    });

    it("skips the places whose text is deleted, and still records the jumps from them",
        async () => {
        const editor = await createVimEditor(paragraphs("[]a", "b", "c", "d", "e"));
        press(editor, "3GG");
        press(editor, "kkdd");
        expect([ getLines(editor), getCursor(editor) ]).toEqual([ "a|b|d|e", "2:0" ]);
        press(editor, "<C-o>");
        expect(getCursor(editor)).toBe("0:0");
        press(editor, "<C-i>");
        expect(getCursor(editor)).toBe("3:0");

        press(editor, "2Gdd");
        expect(getLines(editor)).toBe("a|d|e");
        press(editor, "G<C-o>");
        expect(getCursor(editor)).toBe("1:0");
        press(editor, "dd<C-o>");
        expect([ getLines(editor), getCursor(editor) ]).toEqual([ "a|e", "0:0" ]);
        press(editor, "dd<C-o>");
        expect([ getLines(editor), getCursor(editor) ]).toEqual([ "e", "0:0" ]);
    });

    it("keeps the last hundred places", async () => {
        const editor = await createVimEditor(paragraphs("[]a", "b", "c"));
        for (let i = 0; i < 60; i++) {
            press(editor, "Ggg");
        }
        press(editor, "2G");
        for (let i = 0; i < 120; i++) {
            press(editor, "<C-o>");
        }
        expect(getCursor(editor)).toBe("0:0");
        press(editor, "<C-i>");
        expect(getCursor(editor)).toBe("2:0");
    });
});
