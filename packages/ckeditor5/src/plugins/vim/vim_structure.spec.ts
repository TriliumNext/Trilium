import type { Editor } from "ckeditor5";
import { describe, expect, it } from "vitest";

import {
    createVimEditor, getAdapter, getContent, getCursor, getLines, getStatus, item, paragraphs, press
} from "../../../test/vim-kit.js";

const BODY = paragraphs("a") + "<heading2>H</heading2>" + paragraphs("s1") + item("i1", "x")
    + item("i2", "y")
    + "<table><tableRow><tableCell>" + paragraphs("a1") + "</tableCell><tableCell>"
        + paragraphs("b1")
    + "</tableCell></tableRow></table>"
    + `<blockQuote>${paragraphs("q1", "q2")}</blockQuote>`
    + `<details open="true"><summary>T</summary>${paragraphs("d")}</details>`
    + "<multicolumnLayout columnRatios=\"1-1\"><multicolumnColumn>" + paragraphs("c1")
    + "</multicolumnColumn><multicolumnColumn>" + paragraphs("c2")
        + "</multicolumnColumn></multicolumnLayout>"
    + `<tabs><tab><tabTitle>T2</tabTitle><tabPanel>${paragraphs("p")}</tabPanel></tab></tabs>`
    + "<horizontalLine></horizontalLine>" + paragraphs("z");

const NESTED = item("P1", "a") + item("P2", "a") + item("N1", "b", 1) + item("N2", "b", 1)
    + item("X", "c")
    + paragraphs("after");

/** The lines that the Visual selection covers, as `first-last`. */
function getVisualLines(editor: Editor): string {
    const sel = getAdapter(editor).state.vim?.sel;
    if (!sel) {
        return "";
    }
    const lines = [ sel.anchor.line, sel.head.line ];
    return `${Math.min(...lines)}-${Math.max(...lines)}`;
}

function moves(editor: Editor, keys: string, count: number): string[] {
    const cursors: string[] = [];
    for (let time = 0; time < count; time++) {
        press(editor, keys);
        cursors.push(getCursor(editor));
    }
    return cursors;
}

async function selectObject(data: string, line: number, keys: string) {
    const editor = await createVimEditor(data);
    press(editor, `${line + 1}G${keys}`);
    const lines = getVisualLines(editor);
    press(editor, "<Esc>");
    return lines;
}

describe("Vim mode structure", () => {
    describe("{count}%", () => {
        it("goes that far into the note, and % without a count matches brackets", async () => {
            const editor = await createVimEditor(
                paragraphs("[]p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "··p9"));
            press(editor, "50%");
            expect(getCursor(editor)).toBe("4:0");
            press(editor, "100%");
            expect(getCursor(editor)).toBe("9:2");
            press(editor, "1%");
            expect(getCursor(editor)).toBe("0:0");
            press(editor, "101%");
            expect(getCursor(editor)).toBe("0:0");
            press(editor, "d30%");
            expect(getLines(editor)).toBe("p3|p4|p5|p6|p7|p8|  p9");

            const brackets = await createVimEditor(paragraphs("[](a)"));
            press(brackets, "%");
            expect(getCursor(brackets)).toBe("0:2");
        });
    });

    describe("{ and }", () => {
        it("move block by block in body text, a container being one stop", async () => {
            const editor = await createVimEditor(
                `<paragraph>[]${BODY.slice("<paragraph>".length)}`);
            expect(moves(editor, "}", 17)).toEqual([
                "1:0", "2:0", "3:0", "4:0", "5:0", "6:0", "7:0", "8:0", "9:0", "10:0", "11:0",
                    "12:0",
                "13:0", "14:0", "15:0", "16:0", "16:0"
            ]);
            expect(moves(editor, "{", 11)).toEqual([
                "15:0", "13:0", "11:0", "9:0", "7:0", "5:0", "3:0", "2:0", "1:0", "0:0", "0:0"
            ]);
            press(editor, "3}");
            expect(getCursor(editor)).toBe("3:0");
        });

        it("move inside a container, then to what follows it", async () => {
            const editor = await createVimEditor(
                `<paragraph>[]${BODY.slice("<paragraph>".length)}`);
            const from = (line: number, keys: string) => {
                press(editor, `${line + 1}G${keys}`);
                return getCursor(editor);
            };
            expect([ from(5, "}"), from(6, "}"), from(6, "{"), from(5, "{") ]).toEqual(
                [ "6:0", "7:0", "5:0", "3:0" ]);
            expect([ from(7, "}"), from(8, "}"), from(8, "{") ]).toEqual([ "8:0", "9:0", "7:0" ]);
            expect([ from(9, "}"), from(10, "}") ]).toEqual([ "10:0", "11:0" ]);
            expect([ from(11, "}"), from(12, "}") ]).toEqual([ "12:0", "13:0" ]);
            expect([ from(13, "}"), from(14, "}"), from(14, "{") ]).toEqual(
                [ "14:0", "15:0", "13:0" ]);
        });

        it("move between the items of a list at the level of the cursor", async () => {
            const editor = await createVimEditor(NESTED.replace(">P1<", ">[]P1<"));
            const from = (line: number, keys: string) => {
                press(editor, `${line + 1}G${keys}`);
                return getCursor(editor);
            };
            expect([ from(0, "}"), from(1, "}"), from(2, "}"), from(3, "}"), from(4, "}") ])
                .toEqual([ "4:0", "4:0", "4:0", "4:0", "5:0" ]);
            expect([ from(5, "{"), from(4, "{"), from(3, "{"), from(1, "{") ]).toEqual(
                [ "0:0", "0:0", "2:0", "0:0" ]);
        });

        it("move between the cells of a table with a caption, and past hidden blocks going back",
            async () => {
            const editor = await createVimEditor("<table><tableRow><tableCell>" + paragraphs("[]a")
                + "</tableCell><tableCell>" + paragraphs("b")
                    + "</tableCell></tableRow><caption>cap</caption></table>"
                + "<heading2 headingCollapsed=\"true\">H</heading2>" + paragraphs("hidden")
                    + "<heading2>I</heading2>"
                + paragraphs("z"));
            expect(getLines(editor)).toBe("a|b|cap|H|I|z");
            expect(moves(editor, "}", 3)).toEqual([ "1:0", "3:0", "4:0" ]);
            press(editor, "G");
            expect(moves(editor, "{", 2)).toEqual([ "4:0", "3:0" ]);
        });

        it("go back to the start of the block first", async () => {
            const editor = await createVimEditor(paragraphs("a", "b[]c"));
            press(editor, "{");
            expect(getCursor(editor)).toBe("1:0");
            press(editor, "d}");
            expect(getLines(editor)).toBe("a|");
        });
    });

    describe("ap and ip", () => {
        it("take list items as the design shows", async () => {
            const nested = NESTED + "";
            expect(await selectObject(nested, 0, "vip")).toBe("0-1");
            expect(await selectObject(nested, 0, "vap")).toBe("0-3");
            expect(await selectObject(nested, 1, "vip")).toBe("0-1");
            expect(await selectObject(nested, 1, "vap")).toBe("0-3");
            expect(await selectObject(nested, 2, "vip")).toBe("2-3");
            expect(await selectObject(nested, 3, "vap")).toBe("2-3");
            expect(await selectObject(nested, 4, "vip")).toBe("4-4");
            expect(await selectObject(nested, 4, "vap")).toBe("4-4");

            const deeper = item("P1", "a") + item("P2", "a") + item("N1", "b", 1)
                + item("N3", "c", 2) + item("X", "d");
            expect(await selectObject(deeper, 0, "vip")).toBe("0-1");
            expect(await selectObject(deeper, 0, "vap")).toBe("0-3");
        });

        it("switch Visual mode to lines", async () => {
            const editor = await createVimEditor(paragraphs("[]a", "b"));
            press(editor, "vap");
            expect(getStatus(editor).mode).toBe("visual-line");
        });

        it("take a paragraph and the empty line after it", async () => {
            const editor = await createVimEditor(paragraphs("[]a", "", "b", "c", "d"));
            press(editor, "dap");
            expect(getLines(editor)).toBe("b|c|d");
            press(editor, "dap");
            expect(getLines(editor)).toBe("c|d");
            press(editor, "dip");
            expect(getLines(editor)).toBe("d");
        });

        it("take a heading with its section, or the heading line", async () => {
            const data = paragraphs("x") + "<heading2>H</heading2>" + paragraphs("a")
                + "<heading3>S</heading3>" + paragraphs("b") + "<heading2>I</heading2>";
            const editor = await createVimEditor(data);
            press(editor, "2Gdap");
            expect(getLines(editor)).toBe("x|I");
            press(editor, "u2Gdip");
            expect(getLines(editor)).toBe("x|a|S|b|I");
        });

        it("take quotes, code blocks and widgets", async () => {
            const quote = `<blockQuote>${paragraphs("[]q1", "q2")}</blockQuote>`
                + paragraphs("", "x");
            const editor = await createVimEditor(quote);
            press(editor, "dap");
            expect(getLines(editor)).toBe("x");
            press(editor, "u");
            press(editor, "gg0dip");
            expect(getContent(editor)).toBe(paragraphs("", "x"));

            const code = await createVimEditor(
                "<codeBlock language=\"plaintext\">[]c1<softBreak></softBreak>c2</codeBlock>"
                + paragraphs("", "x"));
            press(code, "jdap");
            expect(getLines(code)).toBe("x");

            const widget = await createVimEditor(
                `[<horizontalLine></horizontalLine>]${paragraphs("", "x")}`);
            press(widget, "dap");
            expect(getLines(widget)).toBe("|x");
        });

        it("take the lines of a box, never the whole box", async () => {
            const editor = await createVimEditor("<table><tableRow><tableCell>"
                + paragraphs("[]a", "b")
                + "</tableCell><tableCell>" + paragraphs("c") + "</tableCell></tableRow></table>"
                + "<multicolumnLayout columnRatios=\"1-1\"><multicolumnColumn>"
                    + paragraphs("d", "e")
                + "</multicolumnColumn><multicolumnColumn>" + paragraphs("f")
                    + "</multicolumnColumn></multicolumnLayout>");
            press(editor, "dap");
            expect(getLines(editor)).toBe("|c|d|e|f");
            press(editor, "jjdip");
            expect(getLines(editor)).toBe("|c||f");
            expect(getContent(editor)).toContain("<table>");
        });

        it("take the title or the body of a collapsible block, or the whole block", async () => {
            const data = `<details open="true">`
                + `<summary>[]T</summary>${paragraphs("b1", "b2")}</details>${paragraphs("", "x")}`;
            const editor = await createVimEditor(data);
            press(editor, "dip");
            expect(getLines(editor)).toBe("|b1|b2||x");
            press(editor, "jdip");
            expect(getLines(editor)).toBe("||||x".slice(1));
            press(editor, "dap");
            expect(getLines(editor)).toBe("x");
            press(editor, "u");
            expect(getLines(editor)).toBe("|||x");
        });

        it("count blocks at the level of the cursor", async () => {
            const editor = await createVimEditor(paragraphs("[]a") + item("i1", "x")
                + item("i2", "y") + paragraphs("b"));
            press(editor, "d2ap");
            expect(getLines(editor)).toBe("b");

            const quote = await createVimEditor(
                `<blockQuote>${paragraphs("[]q1", "q2", "q3")}</blockQuote>${paragraphs("x")}`);
            press(quote, "d2ap");
            expect(getLines(quote)).toBe("q3|x");
            press(quote, "d3ap");
            expect(getLines(quote)).toBe("x");
        });

        it("stop a count at a heading", async () => {
            const editor = await createVimEditor(paragraphs("[]a") + "<heading2>H</heading2>"
                + paragraphs("s"));
            press(editor, "d2ap");
            expect(getLines(editor)).toBe("H|s");
            expect(getStatus(editor).message?.text).toBe("The count stopped at a heading");
            press(editor, "d2ap");
            expect(getLines(editor)).toBe("");
        });

        it("take a collapsed section whole and undo it collapsed again", async () => {
            const data = "<heading2 headingCollapsed=\"true\">[]H</heading2>"
                + paragraphs("a", "b") + "<heading2>I</heading2>";
            const editor = await createVimEditor(data);
            expect(getLines(editor)).toBe("H|I");
            press(editor, "dap");
            expect(getLines(editor)).toBe("I");
            press(editor, "u");
            expect(getContent(editor)).toContain(
                "<heading2 headingCollapsed=\"true\">H</heading2>");
            press(editor, "gg0dip");
            expect(getLines(editor)).toBe("a|b|I");
            press(editor, "u");
            expect(getLines(editor)).toBe("H|I");
            press(editor, "yap");
            expect(getLines(editor)).toBe("H|a|b|I");
        });

        it("do nothing past the last line", async () => {
            const editor = await createVimEditor(paragraphs("[]a"));
            press(editor, "dap");
            expect(getLines(editor)).toBe("");
            press(editor, "dap");
            expect(getLines(editor)).toBe("");
        });
    });

    describe("heading motions", () => {
        const DATA = paragraphs("[]intro") + "<heading2>A</heading2>" + paragraphs("a1")
            + "<heading3>B</heading3>"
            + paragraphs("b1") + "<heading2>C</heading2>" + paragraphs("c1");

        it("go to the next and the previous heading", async () => {
            const editor = await createVimEditor(DATA);
            expect(moves(editor, "]]", 4)).toEqual([ "1:0", "3:0", "5:0", "5:0" ]);
            expect(moves(editor, "[[", 4)).toEqual([ "3:0", "1:0", "1:0", "1:0" ]);
            press(editor, "gg2]]");
            expect(getCursor(editor)).toBe("3:0");
            press(editor, "Gzk");
            expect(getCursor(editor)).toBe("5:0");
            press(editor, "ggzj");
            expect(getCursor(editor)).toBe("1:0");
        });

        it("go to the ends and the edges of sections", async () => {
            const editor = await createVimEditor(DATA);
            expect(moves(editor, "][", 4)).toEqual([ "2:0", "4:0", "6:0", "6:0" ]);
            expect(moves(editor, "[]", 4)).toEqual([ "4:0", "2:0", "0:0", "0:0" ]);
            press(editor, "3G]z");
            expect(getCursor(editor)).toBe("4:0");
            press(editor, "[z");
            expect(getCursor(editor)).toBe("3:0");
            press(editor, "gg]z");
            expect(getCursor(editor)).toBe("0:0");
            press(editor, "[z");
            expect(getCursor(editor)).toBe("0:0");
            press(editor, "G]z");
            expect(getCursor(editor)).toBe("6:0");
        });
    });

    describe("folds", () => {
        it("keep the cursor on its line when a section above folds with the mouse", async () => {
            const editor = await createVimEditor("<heading2>A</heading2>" + paragraphs("a1", "a2")
                + "<heading2>C</heading2>" + paragraphs("[]c1"));
            press(editor, "l");
            const heading = editor.model.document.getRoot()?.getChild(0);
            editor.model.change((writer) =>
                writer.setAttribute("headingCollapsed", true, heading as never));
            expect(getLines(editor)).toBe("A|C|c1");
            expect(getCursor(editor)).toBe("2:1");
        });

        it("collapse and expand sections", async () => {
            const editor = await createVimEditor(paragraphs("intro") + "<heading2>[]A</heading2>"
                + paragraphs("a1")
                + "<heading3>B</heading3>" + paragraphs("b1") + "<heading2>C</heading2>");
            press(editor, "2Gza");
            expect(getLines(editor)).toBe("intro|A|C");
            press(editor, "za");
            expect(getLines(editor)).toBe("intro|A|a1|B|b1|C");
            press(editor, "3Gzc");
            expect(getLines(editor)).toBe("intro|A|C");
            expect(getCursor(editor)).toBe("1:0");
            press(editor, "zo");
            expect(getLines(editor)).toBe("intro|A|a1|B|b1|C");
            press(editor, "zA");
            expect(getContent(editor)).toContain(
                "<heading3 headingCollapsed=\"true\">B</heading3>");
            press(editor, "zO");
            expect(getLines(editor)).toBe("intro|A|a1|B|b1|C");
            expect(getContent(editor)).not.toContain("headingCollapsed");
            press(editor, "zC");
            press(editor, "u");
            expect(getLines(editor)).toBe("intro|A|C");
            press(editor, "zO5Gzc");
            expect(getLines(editor)).toBe("intro|A|a1|B|C");
        });

        it("collapse list items and collapsible blocks", async () => {
            const editor = await createVimEditor(item("[]P", "a") + item("N", "b", 1)
                + `<details open="true"><summary>T</summary>${paragraphs("d")}</details>`);
            press(editor, "za");
            expect(getLines(editor)).toBe("P|T|d");
            press(editor, "za2Gzc");
            expect(getLines(editor)).toBe("P|T|d");
            press(editor, "zo4Gzc");
            expect(getLines(editor)).toBe("P|N|T");
            expect(getCursor(editor)).toBe("2:0");
            press(editor, "za");
            expect(getLines(editor)).toBe("P|N|T|d");
        });

        it("say when there is nothing to fold", async () => {
            const editor = await createVimEditor(paragraphs("[]a"));
            press(editor, "za");
            expect(getStatus(editor).message?.text).toBe("Nothing to fold here");
        });
    });
});
