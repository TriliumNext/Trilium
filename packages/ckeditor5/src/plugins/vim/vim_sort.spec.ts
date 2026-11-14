import { describe, expect, it } from "vitest";

import {
    aside, createVimEditor, getContent, getCursor, getLines, getStatus, item, paragraphs, press
} from "../../../test/vim-kit.js";
import { parseSortOptions, sortUnits } from "./vim_sort.js";

const REFUSED = "Only whole paragraphs of one kind or whole list items can be sorted";

function sortTexts(texts: string[], args: string) {
    const options = parseSortOptions(args);
    if (!options) {
        return null;
    }
    return sortUnits(texts.map((text) => ({ blocks: [], text })), options).map((unit) => unit.text);
}

describe("Vim mode :sort", () => {
    it("sorts the paragraphs around the cursor, keeping their formatting", async () => {
        const editor = await createVimEditor(paragraphs("z", "", "c", "[]a")
            + "<paragraph><$text bold=\"true\">b</$text></paragraph>"
            + "<heading2>H</heading2>" + paragraphs("y"));
        press(editor, ":sort<CR>");
        expect(getContent(editor)).toBe(paragraphs("z", "", "a")
            + "<paragraph><$text bold=\"true\">b</$text></paragraph>"
            + paragraphs("c") + "<heading2>H</heading2>" + paragraphs("y"));
        expect(getCursor(editor)).toBe("2:0");
        press(editor, "u");
        expect(getLines(editor)).toBe("z||c|a|b|H|y");
    });

    it("sorts the items of a list at the level of the cursor with their nested items", async () => {
        const editor = await createVimEditor(item("c", "c") + item("c2", "c") + item("n2", "n", 1)
            + item("n1", "m", 1)
            + item("[]a", "a") + item("b", "b") + paragraphs("x"));
        press(editor, ":sort<CR>");
        expect(getContent(editor)).toBe(item("a", "a") + item("b", "b") + item("c", "c")
            + item("c2", "c")
            + item("n2", "d", 1) + item("n1", "e", 1) + paragraphs("x"));
        press(editor, "5G:sort<CR>");
        expect(getLines(editor)).toBe("a|b|c|c2|n1|n2|x");
    });

    it("sorts a range that holds an empty paragraph", async () => {
        const editor = await createVimEditor(paragraphs("[]b", "", "a"));
        press(editor, ":1,3sort<CR>");
        expect(getLines(editor)).toBe("|a|b");
    });

    it("refuses ranges of mixed kinds and parts of items", async () => {
        const mixed = await createVimEditor(`${paragraphs("[]b")}<heading2>a</heading2>`);
        press(mixed, ":%sort<CR>");
        expect(getStatus(mixed).message?.text).toBe(REFUSED);
        expect(getLines(mixed)).toBe("b|a");

        const items = await createVimEditor(item("[]b", "b") + item("b2", "b") + item("a", "a")
            + item("n", "n", 1));
        for (const range of [ "1,2", "2,3", "1,3", "3,4" ]) {
            press(items, `:${range}sort<CR>`);
            expect(getLines(items)).toBe("b|b2|a|n");
        }
        press(items, ":4,4sort<CR>:%sort<CR>");
        expect(getLines(items)).toBe("a|n|b|b2");

        const widget = await createVimEditor(
            `${paragraphs("[]b")}<horizontalLine></horizontalLine>${paragraphs("a")}`);
        press(widget, ":%sort<CR>");
        expect(getStatus(widget).message?.text).toBe(REFUSED);

        const table = await createVimEditor("<table><tableRow><tableCell>" + paragraphs("[]b", "a")
            + "</tableCell></tableRow></table>");
        press(table, ":sort<CR>");
        expect(getLines(table)).toBe("b|a");

        const apart = await createVimEditor(
            `<blockQuote>${paragraphs("[]b")}</blockQuote>${paragraphs("a")}`);
        press(apart, ":%sort<CR>");
        expect(getLines(apart)).toBe("b|a");
    });

    it("sorts the paragraphs of an aside, and refuses a range across its edge", async () => {
        const editor = await createVimEditor(paragraphs("z") + aside(paragraphs("[]c", "a", "b"))
            + paragraphs("y"));
        press(editor, ":sort<CR>");
        expect(getContent(editor)).toBe(paragraphs("z") + aside(paragraphs("a", "b", "c"))
            + paragraphs("y"));
        for (const command of [ "%sort", "1,2sort", "4,5sort!" ]) {
            press(editor, `:${command}<CR>`);
            expect(getLines(editor), command).toBe("z|a|b|c|y");
        }
        expect(getStatus(editor).message?.text).toBe(REFUSED);
    });

    it("sorts the lines of a code block as text", async () => {
        const editor = await createVimEditor(
            "<codeBlock language=\"plaintext\">[]b<softBreak></softBreak>"
            + "<softBreak></softBreak>a</codeBlock>" + paragraphs("x"));
        press(editor, ":sort<CR>");
        expect(getContent(editor)).toBe(
            "<codeBlock language=\"plaintext\"><softBreak></softBreak>a<softBreak></softBreak>b"
            + "</codeBlock>" + paragraphs("x"));
        press(editor, ":%sort<CR>");
        expect(getStatus(editor).message?.text).toBe(REFUSED);
    });

    it("says when the arguments are wrong", async () => {
        const editor = await createVimEditor(paragraphs("[]b", "a"));
        for (const args of [ "nx", "q", "/(/" ]) {
            press(editor, `:sort ${args}<CR>`);
            expect(getStatus(editor).message?.text).toBe("Invalid arguments of :sort");
        }
        expect(getLines(editor)).toBe("b|a");
    });

    it("compares as Vim does", () => {
        expect(sortTexts([ "b", "B", "a" ], "")).toEqual([ "B", "a", "b" ]);
        expect(sortTexts([ "b", "B", "a" ], "i")).toEqual([ "a", "b", "B" ]);
        expect(sortTexts([ "b", "B", "a" ], "!")).toEqual([ "b", "a", "B" ]);
        expect(sortTexts([ "x10", "none", "x9", "x-2" ], "n")).toEqual(
            [ "none", "x-2", "x9", "x10" ]);
        expect(sortTexts([ "x10", "none", "x9" ], "! n")).toEqual([ "x10", "x9", "none" ]);
        expect(sortTexts([ "0x1F", "a", "0xA", "-" ], "x")).toEqual([ "-", "a", "0xA", "0x1F" ]);
        expect(sortTexts([ "17", "8", "x", "7" ], "o")).toEqual([ "8", "x", "7", "17" ]);
        expect(sortTexts([ "a", "A", "b", "a" ], "iu")).toEqual([ "a", "b" ]);
        expect(sortTexts([ "k=2", "k=1", "none" ], "/k=/")).toEqual([ "none", "k=1", "k=2" ]);
        expect(sortTexts([ "b1", "a2", "3" ], "r /[a-z]/")).toEqual([ "3", "a2", "b1" ]);
        expect(sortTexts([ "id 3: z", "id 1: y" ], "n /id/")).toEqual([ "id 1: y", "id 3: z" ]);
        expect(sortTexts([ "id: 3", "x" ], "n /zz/")).toEqual([ "id: 3", "x" ]);
        expect(sortTexts([ "a", "a", "x1" ], "u /x/")).toEqual([ "a", "x1" ]);
        expect(sortTexts([ "a" ], "d")).toEqual([ "a" ]);
        expect(parseSortOptions("x o")).toBeNull();
    });
});
