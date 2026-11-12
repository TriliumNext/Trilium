import type { Editor, ModelApplyOperationEvent, ModelElement } from "ckeditor5";
import { describe, expect, it } from "vitest";

import {
    createVimEditor, getContent, getCursor, getLines, getStatus, item, paragraphs, press,
    setVimData, typeText
} from "../../../test/vim-kit.js";
import {
    getWholeLines, isAtTwoStepBoundary, joinLine, openLine, replaceText
} from "./vim_editing.js";
import { LineIndex } from "./vim_lines.js";

const SB = "<softBreak></softBreak>";

function cell(...texts: string[]) {
    return `<tableCell>${paragraphs(...texts)}</tableCell>`;
}

function table(...rows: string[][][]) {
    const tableRows = rows.map((row) => row.map((texts) => cell(...texts)).join(""));
    return `<table>${tableRows.map((row) => `<tableRow>${row}</tableRow>`).join("")}</table>`;
}

function details(title: string, body: string, isOpen = true) {
    return `<details${isOpen ? " open=\"true\"" : ""}><summary>${title}</summary>${body}</details>`;
}

describe("Vim mode line editing", () => {
    describe("dd", () => {
        it("removes a soft-break segment with one of its soft breaks", async () => {
            const editor = await createVimEditor(`<paragraph>a${SB}[]b${SB}c</paragraph>`);
            press(editor, "dd");
            expect(getContent(editor)).toBe(`<paragraph>a${SB}c</paragraph>`);
            press(editor, "dd");
            expect(getContent(editor)).toBe("<paragraph>a</paragraph>");

            const other = await createVimEditor(
                `<paragraph>[]a${SB}b</paragraph><paragraph>c</paragraph>`);
            press(other, "dd");
            expect(getContent(other)).toBe(paragraphs("b", "c"));
            press(other, "u");
            press(other, "j2dd");
            expect(getContent(other)).toBe(paragraphs("a"));
        });

        it("removes a wrapping container with its last line", async () => {
            const editor = await createVimEditor(`<blockQuote>${paragraphs("[]q")}</blockQuote>`
                + `<aside admonitionType="note">${paragraphs("n")}</aside>${paragraphs("x")}`);
            press(editor, "dd");
            expect(getContent(editor)).toBe(
                `<aside admonitionType="note">${paragraphs("n")}</aside>${paragraphs("x")}`);
            press(editor, "dd");
            expect(getContent(editor)).toBe(paragraphs("x"));
        });

        it("keeps one empty line in a box with an editable area of its own", async () => {
            const editor = await createVimEditor(`${table([ [ "[]a" ] ], [ [ "b" ] ])}`
                + "<multicolumnLayout columnRatios=\"1-1\"><multicolumnColumn>" + paragraphs("c1")
                + "</multicolumnColumn><multicolumnColumn>" + paragraphs("c2")
                    + "</multicolumnColumn></multicolumnLayout>"
                + "<tabs><tab><tabTitle>T</tabTitle><tabPanel>" + paragraphs("p")
                    + "</tabPanel></tab></tabs>");
            press(editor, "dd");
            expect(getLines(editor)).toBe("|b|c1|c2|T|p");
            press(editor, "jjdd");
            expect(getLines(editor)).toBe("|b||c2|T|p");
            press(editor, "jjjdd");
            expect(getLines(editor)).toBe("|b||c2|T|");
            expect(getContent(editor)).toContain("<tabPanel><paragraph></paragraph></tabPanel>");
        });

        it("keeps a table whose lines all go, and takes it with a line outside it", async () => {
            const editor = await createVimEditor(table([ [ "[]a" ] ]) + paragraphs("z"));
            press(editor, "dd");
            expect(getContent(editor)).toBe(table([ [ "" ] ]) + paragraphs("z"));
            press(editor, "u2dd");
            expect(getContent(editor)).toBe(paragraphs(""));

            setVimData(editor, table([ [ "[]a" ] ]));
            press(editor, "dd");
            expect(getContent(editor)).toBe(table([ [ "" ] ]));

            setVimData(editor, paragraphs("[]z", "y") + table([ [ "a" ] ]));
            press(editor, "jdj");
            expect(getContent(editor)).toBe(paragraphs("z"));
        });

        it("puts a collapsed heading back collapsed on undo", async () => {
            const editor = await createVimEditor(
                "<heading2 headingCollapsed=\"true\">[]Head</heading2>" + paragraphs("a", "b")
                + "<heading2>Next</heading2>");
            for (const keys of [ "dd", "Vd" ]) {
                press(editor, keys);
                expect(getLines(editor), keys).toBe("a|b|Next");
                press(editor, "u");
                expect(getLines(editor), keys).toBe("Head|Next");
            }
        });

        it("clears the title of a collapsible block and keeps an empty body line", async () => {
            const editor = await createVimEditor(details("[]Title", paragraphs("body")));
            press(editor, "dd");
            expect(getContent(editor)).toBe(details("", paragraphs("body")));
            press(editor, "jdd");
            expect(getContent(editor)).toBe(details("", paragraphs("")));
        });

        it("removes a heading line and leaves its section", async () => {
            const editor = await createVimEditor(`<heading2>[]H</heading2>${paragraphs("a", "b")}`);
            press(editor, "dd");
            expect(getContent(editor)).toBe(paragraphs("a", "b"));
        });

        it("leaves an empty paragraph after removing the whole note", async () => {
            const editor = await createVimEditor(paragraphs("[]a"));
            press(editor, "dd");
            expect(getContent(editor)).toBe(paragraphs(""));

            const widget = await createVimEditor("[<horizontalLine></horizontalLine>]");
            press(widget, "dd");
            expect(getContent(widget)).toBe(paragraphs(""));

            const code = await createVimEditor("<codeBlock language=\"plaintext\">[]a</codeBlock>");
            press(code, "dd");
            expect(getContent(code)).toBe(paragraphs(""));
        });

        it("removes the last line and moves to the line before", async () => {
            const editor = await createVimEditor(paragraphs("a", "··b", "[]c"));
            press(editor, "dd");
            expect(getContent(editor)).toBe(paragraphs("a", "  b"));
            expect(getCursor(editor)).toBe("1:2");
        });

        it("removes list paragraphs and keeps the nested items", async () => {
            const editor = await createVimEditor(item("[]P1", "a") + item("P2", "a")
                + item("N1", "b", 1) + item("X", "c"));
            press(editor, "dd");
            expect(getContent(editor)).toBe(item("P2", "a") + item("N1", "b", 1) + item("X", "c"));
            press(editor, "dd");
            expect(getContent(editor)).toBe(item("N1", "a") + item("X", "b"));
        });

        it("moves the nested items of a removed item up one level", async () => {
            const editor = await createVimEditor(item("Ship", "a") + item("[]Keep", "b")
                + item("x", "c", 1) + item("x2", "d", 2) + item("y", "e", 1) + item("Write", "f"));
            const lifted = item("Ship", "a") + item("x", "b") + item("x2", "c", 1)
                + item("y", "d") + item("Write", "e");
            press(editor, "dd");
            expect(getContent(editor)).toBe(lifted);
            press(editor, "udip");
            expect(getContent(editor)).toBe(lifted);
            press(editor, "u2dd");
            expect(getContent(editor)).toBe(
                item("Ship", "a") + item("x2", "b") + item("y", "c") + item("Write", "d"));

            setVimData(editor, item("[]P1", "a") + item("P2", "a") + item("N1", "b", 1)
                + item("N2", "c", 2));
            press(editor, "2dd");
            expect(getContent(editor)).toBe(item("N1", "a") + item("N2", "b", 1));
            press(editor, "ujdd");
            expect(getContent(editor)).toBe(
                item("P1", "a") + item("N1", "b", 1) + item("N2", "c", 2));
        });

        it("removes code lines", async () => {
            const editor = await createVimEditor(
                `<codeBlock language="plaintext">a${SB}b${SB}[]c</codeBlock>`);
            press(editor, "dd");
            expect(getContent(editor)).toBe(`<codeBlock language="plaintext">a${SB}b</codeBlock>`);
            expect(getCursor(editor)).toBe("1:0");
        });

        it("removes lines across containers", async () => {
            const editor = await createVimEditor(paragraphs("[]a")
                + `<blockQuote>${paragraphs("b", "c")}</blockQuote>`);
            press(editor, "2dd");
            expect(getContent(editor)).toBe(`<blockQuote>${paragraphs("c")}</blockQuote>`);
            press(editor, "u");
            press(editor, "dG");
            expect(getContent(editor)).toBe(paragraphs(""));
        });
    });

    describe("cc and S", () => {
        it("clears the text and keeps the kind of the line", async () => {
            const editor = await createVimEditor(`<heading2>[]Title</heading2>${item("one", "a")}`);
            press(editor, "cc");
            typeText(editor, "New");
            press(editor, "<Esc>jS");
            typeText(editor, "two");
            press(editor, "<Esc>");
            expect(getContent(editor)).toBe(`<heading2>New</heading2>${item("two", "a")}`);
        });

        it("does nothing on a widget", async () => {
            const editor = await createVimEditor("[<horizontalLine></horizontalLine>]"
                + paragraphs("a"));
            for (const keys of [ "cc", "S", "s", "C", "rx", "~" ]) {
                press(editor, `${keys}<Esc>`);
                expect(getLines(editor)).toBe("\u{FFFC}|a");
                expect(getCursor(editor)).toBe("0:0");
                expect(getStatus(editor).mode).toBe("normal");
            }
            press(editor, "x");
            expect(getContent(editor)).toBe(paragraphs("a"));
        });

        it("types with the formatting of the text that it changes", async () => {
            const editor = await createVimEditor(
                "<paragraph>x <$text bold=\"true\">[]bold</$text> y</paragraph>");
            press(editor, "ciw");
            typeText(editor, "new");
            press(editor, "<Esc>");
            expect(getContent(editor)).toBe(
                "<paragraph>x <$text bold=\"true\">new</$text> y</paragraph>");

            setVimData(editor, "<paragraph>by <$text bold=\"true\">[]March 3</$text></paragraph>");
            press(editor, "cw");
            typeText(editor, "May");
            press(editor, "<Esc>");
            expect(getContent(editor)).toBe(
                "<paragraph>by <$text bold=\"true\">May 3</$text></paragraph>");

            setVimData(editor, "<paragraph><$text bold=\"true\">bo</$text>[]x</paragraph>");
            press(editor, "s");
            typeText(editor, "y");
            press(editor, "<Esc>");
            expect(getContent(editor)).toBe(
                "<paragraph><$text bold=\"true\">bo</$text>y</paragraph>");

            setVimData(editor, "<paragraph><$text bold=\"true\">one []two</$text></paragraph>");
            press(editor, "ciw");
            typeText(editor, "six");
            press(editor, "<Esc>");
            expect(getContent(editor)).toBe(
                "<paragraph><$text bold=\"true\">one six</$text></paragraph>");

            setVimData(editor, "<paragraph><$text bold=\"true\">b</$text></paragraph>"
                + paragraphs("[]"));
            press(editor, "cc");
            typeText(editor, "c");
            press(editor, "<Esc>");
            expect(getContent(editor)).toBe(
                "<paragraph><$text bold=\"true\">b</$text></paragraph>" + paragraphs("c"));
        });

        it("keeps one line when Visual line mode changes several", async () => {
            const editor = await createVimEditor(paragraphs("[]a", "b", "c"));
            press(editor, "Vjc");
            typeText(editor, "x");
            press(editor, "<Esc>");
            expect(getContent(editor)).toBe(paragraphs("x", "c"));
        });
    });

    describe("r and Replace mode", () => {
        it("keeps the formatting of the replaced character", async () => {
            const editor = await createVimEditor(
                "<paragraph>a<$text bold=\"true\">[]b</$text>c</paragraph>");
            press(editor, "rX");
            expect(getContent(editor)).toBe(
                "<paragraph>a<$text bold=\"true\">X</$text>c</paragraph>");
            press(editor, "l3rY");
            expect(getContent(editor)).toBe(
                "<paragraph>a<$text bold=\"true\">X</$text>Y</paragraph>");
        });

        it("writes over characters in Replace mode", async () => {
            const editor = await createVimEditor(paragraphs("[]abc"));
            press(editor, "R");
            press(editor, "xyzw");
            press(editor, "<BS><Esc>");
            expect(getLines(editor)).toBe("xyz");
            press(editor, "u");
            expect(getLines(editor)).toBe("abc");
        });
    });

    describe("case operators", () => {
        it("change the case of a whole line and leave the rest of the note", async () => {
            const tabs = (title: string, panel: string) => `<tabs><tab><tabTitle>${title}`
                + `</tabTitle><tabPanel>${paragraphs(panel)}</tabPanel></tab></tabs>`;
            const places = [
                paragraphs("[]Ab", "cd"),
                paragraphs("cd", "[]Ab"),
                `<heading2>[]Ab</heading2>${paragraphs("cd")}`,
                item("[]Ab", "a") + item("cd", "b", 1) + paragraphs("ef"),
                `<codeBlock language="plaintext">[]Ab${SB}cd</codeBlock>`,
                paragraphs("x") + table([ [ "one" ], [ "two" ] ], [ [ "[]Ab" ], [ "four" ] ])
                    + paragraphs("y"),
                paragraphs("[]Ab") + table([ [ "one" ] ]) + paragraphs("y"),
                `<blockQuote>${paragraphs("[]Ab")}</blockQuote>${table([ [ "one" ] ])}`,
                paragraphs("x") + tabs("[]Ab", "p") + paragraphs("y"),
                paragraphs("x") + tabs("T", "[]Ab") + paragraphs("y"),
                details("[]Ab", paragraphs("body")) + paragraphs("y"),
                "<multicolumnLayout columnRatios=\"1-1\"><multicolumnColumn>" + paragraphs("[]Ab")
                    + "</multicolumnColumn><multicolumnColumn>" + paragraphs("c2")
                    + "</multicolumnColumn></multicolumnLayout>" + paragraphs("y")
            ];
            const editor = await createVimEditor();
            for (const place of places) {
                for (const [ keys, text ] of [ [ "gUU", "AB" ], [ "guu", "ab" ], [ "g~~", "aB" ],
                    [ "g??", "No" ], [ "VU", "AB" ], [ "Vu", "ab" ], [ "V~", "aB" ] ]) {
                    setVimData(editor, place);
                    const before = getContent(editor);
                    press(editor, keys);
                    expect(getContent(editor), `${keys} on ${place}`)
                        .toBe(before.replace("Ab", text));
                    press(editor, "u");
                    expect(getContent(editor)).toBe(before);
                }
            }
        });

        it("change several lines, and keep the formatting of each character", async () => {
            const editor = await createVimEditor(paragraphs("[]ab", "cd", "ef"));
            press(editor, "gUj");
            expect(getContent(editor)).toBe(paragraphs("AB", "CD", "ef"));

            setVimData(editor, `<paragraph>[]ab${SB}cd</paragraph>`);
            press(editor, "Vjg?");
            expect(getContent(editor)).toBe(`<paragraph>no${SB}pq</paragraph>`);

            setVimData(editor, "<paragraph>[]x <$text bold=\"true\">bo</$text>ld y</paragraph>");
            press(editor, "gUU");
            expect(getContent(editor)).toBe(
                "<paragraph>X <$text bold=\"true\">BO</$text>LD Y</paragraph>");
            press(editor, "wg~iw");
            expect(getContent(editor)).toBe(
                "<paragraph>X <$text bold=\"true\">bo</$text>ld Y</paragraph>");
            press(editor, "0vlll~");
            expect(getContent(editor)).toBe(
                "<paragraph>x <$text bold=\"true\">BO</$text>ld Y</paragraph>");
        });

        it("change a word that ends with a longer upper case", async () => {
            const editor = await createVimEditor(
                "<paragraph>[]A<$text bold=\"true\">ß</$text></paragraph>");
            press(editor, "gUU");
            expect(getContent(editor)).toBe(
                "<paragraph>A<$text bold=\"true\">SS</$text></paragraph>");
        });

        it("rewrite each part of a line between objects in one removal and one insertion",
            async () => {
            const image = "<imageInline src=\"a.png\"></imageInline>";
            const editor = await createVimEditor(
                "<paragraph>[]one <$text bold=\"true\">two</$text> three</paragraph>"
                + `<paragraph>a b${image}c d</paragraph>`);
            let operations = 0;
            editor.model.on<ModelApplyOperationEvent>("applyOperation", (_evt, [ operation ]) => {
                operations += operation.isDocumentOperation ? 1 : 0;
            });
            press(editor, "gUG");
            expect(getContent(editor)).toBe(
                "<paragraph>ONE <$text bold=\"true\">TWO</$text> THREE</paragraph>"
                + `<paragraph>A B${image}C D</paragraph>`);
            expect(operations).toBe(6);
        });
    });

    describe("o and O", () => {
        it("open a line as Enter does", async () => {
            const editor = await createVimEditor(item("[]one", "a")
                + `<blockQuote>${paragraphs("q")}</blockQuote>`
                + `<codeBlock language="plaintext">c</codeBlock>`);
            press(editor, "o");
            typeText(editor, "two");
            press(editor, "<Esc>jo");
            typeText(editor, "q2");
            press(editor, "<Esc>jo");
            typeText(editor, "c2");
            press(editor, "<Esc>O");
            typeText(editor, "c1");
            press(editor, "<Esc>");
            expect(getContent(editor)).toBe(item("one", "a") + item("two", "b")
                + `<blockQuote>${paragraphs("q", "q2")}</blockQuote>`
                + `<codeBlock language="plaintext">c${SB}c1${SB}c2</codeBlock>`);
        });

        it("open a paragraph of the item in a multi-paragraph list item", async () => {
            const editor = await createVimEditor(item("[]P1", "a") + item("P2", "a"));
            press(editor, "o");
            typeText(editor, "x");
            press(editor, "<Esc>");
            expect(getContent(editor)).toBe(item("P1", "a") + item("x", "a") + item("P2", "a"));
        });

        it("open a paragraph after a widget, or before it", async () => {
            const editor = await createVimEditor("[<horizontalLine></horizontalLine>]");
            press(editor, "o");
            typeText(editor, "after");
            press(editor, "<Esc>kO");
            typeText(editor, "before");
            press(editor, "<Esc>");
            expect(getContent(editor)).toBe(
                `${paragraphs("before")}<horizontalLine></horizontalLine>${paragraphs("after")}`);
            expect(getCursor(editor)).toBe("0:5");
        });

        it("open a paragraph before and after a heading", async () => {
            const editor = await createVimEditor(`<heading2>[]Title</heading2>${paragraphs("a")}`);
            press(editor, "O");
            typeText(editor, "x");
            press(editor, "<Esc>jo");
            typeText(editor, "y");
            press(editor, "<Esc>");
            expect(getContent(editor)).toBe(
                `${paragraphs("x")}<heading2>Title</heading2>${paragraphs("y", "a")}`);
        });

        it("open a line above the first line", async () => {
            const editor = await createVimEditor(paragraphs("[]a"));
            press(editor, "O");
            typeText(editor, "x");
            press(editor, "<Esc>");
            expect(getContent(editor)).toBe(paragraphs("x", "a"));
            expect(getCursor(editor)).toBe("0:0");
        });

        it("do nothing past the last line", async () => {
            const editor = await createVimEditor(paragraphs("[]a"));
            openLine(editor, () => new LineIndex(editor.model), 5, true);
            expect(getContent(editor)).toBe(paragraphs("a"));
        });
    });

    describe("J and gJ", () => {
        it("join texts with one space", async () => {
            const editor = await createVimEditor(paragraphs("[]a", "··b", "c", "", "d", "···"));
            press(editor, "3J");
            expect(getLines(editor)).toBe("a b c||d|   ");
            press(editor, "jJ");
            expect(getLines(editor)).toBe("a b c|d|   ");
            press(editor, "J");
            expect(getLines(editor)).toBe("a b c|d");
            press(editor, "kgJ");
            expect(getLines(editor)).toBe("a b cd");
        });

        it("join segments of a soft-broken paragraph", async () => {
            const editor = await createVimEditor(`<paragraph>[]a${SB}b</paragraph>`);
            press(editor, "J");
            expect(getContent(editor)).toBe(paragraphs("a b"));
        });

        it("follow Backspace between kinds", async () => {
            const editor = await createVimEditor(`${paragraphs("[]p")}<heading2>H</heading2>`);
            press(editor, "J");
            expect(getContent(editor)).toBe(paragraphs("p H"));

            const empty = await createVimEditor(`${paragraphs("[]")}<heading2>H</heading2>`);
            press(empty, "J");
            expect(getContent(empty)).toBe("<heading2>H</heading2>");
            expect(getCursor(empty)).toBe("0:0");
        });

        it("make the next list item a paragraph of the current one first", async () => {
            const editor = await createVimEditor(item("[]one", "a") + item("two", "b"));
            press(editor, "J");
            expect(getContent(editor)).toBe(item("one", "a") + item("two", "a"));
            press(editor, "J");
            expect(getContent(editor)).toBe(item("one two", "a"));
        });

        it("do nothing next to a widget, a cell or a collapsible block", async () => {
            const editor = await createVimEditor(
                `${paragraphs("[]a")}<horizontalLine></horizontalLine>`
                + table([ [ "b" ], [ "c" ] ]) + paragraphs("d") + details("T", paragraphs("e"))
                    + paragraphs("f"));
            const before = getContent(editor);
            for (const line of [ 0, 2, 3, 4, 7 ]) {
                press(editor, `${line + 1}GJ`);
                expect(getContent(editor)).toBe(before);
            }
        });

        it("join the first body line of a collapsible block to its title", async () => {
            const editor = await createVimEditor(details("[]T", paragraphs("body")));
            press(editor, "J");
            expect(getContent(editor)).toBe(details("T body", paragraphs("")));
        });

        it("do nothing on a collapsed heading", async () => {
            const editor = await createVimEditor(
                `<heading2>[]H</heading2>${paragraphs("a")}<heading2>I</heading2>`);
            editor.execute("toggleHeadingCollapse" as never);
            const before = getContent(editor);
            press(editor, "J");
            expect(getContent(editor)).toBe(before);
        });

        it("do nothing on a collapsed list item", async () => {
            const editor = await createVimEditor(item("[]one", "a") + item("nested a", "b", 1)
                + item("nested b", "c", 1) + item("two", "d"));
            editor.execute("toggleListCollapse" as never);
            const before = getContent(editor);
            expect(getLines(editor)).toBe("one|two");
            press(editor, "J");
            expect(getContent(editor)).toBe(before);
        });

        it("join the lines of a Visual selection", async () => {
            const editor = await createVimEditor(paragraphs("[]a", "b", "c", "d"));
            press(editor, "VjjJ");
            expect(getLines(editor)).toBe("a b c|d");
            expect(getCursor(editor)).toBe("0:3");
        });

        it("return null when there is nothing to join", async () => {
            const editor = await createVimEditor(paragraphs("[]a"));
            expect(joinLine(editor, new LineIndex(editor.model), 0, true)).toBeNull();
        });
    });

    describe(">> and <<", () => {
        it("change list levels and block indentation", async () => {
            const editor = await createVimEditor(item("a", "a") + item("[]b", "b")
                + paragraphs("c"));
            press(editor, ">>");
            expect(getContent(editor)).toBe(item("a", "a") + item("b", "b", 1) + paragraphs("c"));
            press(editor, "<<<<");
            expect(getContent(editor)).toBe(item("a", "a") + paragraphs("b", "c"));
            press(editor, "j>>");
            expect(getContent(editor)).toContain("<paragraph blockIndent=\"40px\">c</paragraph>");
            press(editor, "<<");
            expect(getContent(editor)).toContain(paragraphs("c"));
        });

        it("indent the lines of a Visual selection and of a count", async () => {
            const editor = await createVimEditor(item("a", "a") + item("[]b", "b")
                + item("c", "c"));
            press(editor, "Vj>");
            expect(getContent(editor)).toBe(item("a", "a") + item("b", "b", 1) + item("c", "c", 1));
            press(editor, "gg2<<");
            expect(getContent(editor)).toBe(paragraphs("a") + item("b", "a") + item("c", "b"));
        });

        it("indent code", async () => {
            const editor = await createVimEditor(
                "<codeBlock language=\"plaintext\">[]a</codeBlock>");
            press(editor, ">>");
            expect(getLines(editor)).toBe("\ta");
            press(editor, "<<");
            expect(getLines(editor)).toBe("a");
        });

        it("do nothing on a widget", async () => {
            const editor = await createVimEditor("[<horizontalLine></horizontalLine>]");
            press(editor, ">>");
            expect(getContent(editor)).toBe("<horizontalLine></horizontalLine>");
        });
    });

    describe("Insert mode at a link", () => {
        it("types after a link that ends at the cursor, not into it", async () => {
            const editor = await createVimEditor(
                "<paragraph><$text linkHref=\"x\">lin[]k</$text> end</paragraph>");
            press(editor, "a");
            typeText(editor, "X");
            press(editor, "<Esc>A");
            typeText(editor, "Y");
            press(editor, "<Esc>");
            expect(getContent(editor)).toBe(
                "<paragraph><$text linkHref=\"x\">link</$text>X endY</paragraph>");
        });

        it("tells the boundaries of links and inline code", async () => {
            const editor = await createVimEditor(
                "<paragraph><$text code=\"true\">ab</$text>c</paragraph>");
            const block = editor.model.document.getRoot()?.getChild(0) as ModelElement;
            const at = (offset: number) => isAtTwoStepBoundary(
                editor.model.createPositionAt(block, offset));
            expect([ at(0), at(1), at(2), at(3) ]).toEqual([ false, false, true, false ]);
        });
    });

    describe("replaceText", () => {
        function root(editor: Editor) {
            return editor.model.document.getRoot() as ModelElement;
        }

        it("splits blocks, and adds soft breaks in code blocks and titles", async () => {
            const editor = await createVimEditor(
                `${paragraphs("ab")}<codeBlock language="plaintext">cd</codeBlock>`
                + details("ef", paragraphs("")));
            const model = editor.model;
            const at = (path: number[]) => model.createPositionFromPath(root(editor), path);
            replaceText(editor, model.createRange(at([ 2, 0, 1 ])), "1\n2", "");
            replaceText(editor, model.createRange(at([ 1, 1 ])), "3\n4", "");
            replaceText(editor, model.createRange(at([ 0, 1 ])), "5\n6", "");
            expect(getContent(editor)).toBe(paragraphs("a5", "6b")
                + `<codeBlock language="plaintext">c3${SB}4d</codeBlock>`
                    + details(`e1${SB}2f`, paragraphs("")));
        });

        it("never writes text over an object, nor where text cannot go", async () => {
            const editor = await createVimEditor(
                `<horizontalLine></horizontalLine>${paragraphs("a")}`);
            const model = editor.model;
            const range = model.createRangeOn(root(editor).getChild(0) as ModelElement);
            expect(replaceText(editor, range, "x", "\u{FFFC}")).toBeNull();
            const before = model.createPositionAt(root(editor), 0);
            expect(
                replaceText(editor, model.createRange(before), "x\ny", "")?.isEqual(before)).toBe(
                true);
            expect(getContent(editor)).toBe(`<horizontalLine></horizontalLine>${paragraphs("a")}`);
        });

        it("leaves the same text alone", async () => {
            const editor = await createVimEditor(paragraphs("abc"));
            const model = editor.model;
            const block = root(editor).getChild(0) as ModelElement;
            const range = model.createRange(model.createPositionAt(block, 0),
                model.createPositionAt(block, 2));
            const version = model.document.version;
            expect(replaceText(editor, range, "ab", "ab")?.isEqual(range.end)).toBe(true);
            expect(model.document.version).toBe(version);
        });

        it("joins the line that a deletion ends at the start of", async () => {
            const editor = await createVimEditor(paragraphs("[]a1", "b2", "", "d4", "e5"));
            press(editor, "3D");
            expect(getLines(editor)).toBe("|d4|e5");
            press(editor, "uvjjd");
            expect(getLines(editor)).toBe("|d4|e5");

            setVimData(editor, paragraphs("[]a1", "", "c3"));
            press(editor, "2C");
            typeText(editor, "X");
            press(editor, "<Esc>");
            expect(getLines(editor)).toBe("X|c3");

            // A range of nothing but the end of a block joins in the first deletion.
            const model = editor.model;
            const [ first, second ] = [ 0, 1 ].map((index) =>
                root(editor).getChild(index) as ModelElement);
            replaceText(editor, model.createRange(model.createPositionAt(first, "end"),
                model.createPositionAt(second, 0)), "", "\n");
            expect(getLines(editor)).toBe("Xc3");
        });

        it("splits a line at a carriage return", async () => {
            const editor = await createVimEditor(paragraphs("one two"));
            const model = editor.model;
            const block = root(editor).getChild(0) as ModelElement;
            const range = model.createRange(model.createPositionAt(block, 3),
                model.createPositionAt(block, 4));
            replaceText(editor, range, "\r", " ");
            expect(getContent(editor)).toBe(paragraphs("one", "two"));
        });
    });

    describe("getWholeLines", () => {
        it("tells the whole lines of a range", async () => {
            const editor = await createVimEditor(paragraphs("ab", "cd", "ef"));
            const index = new LineIndex(editor.model);
            expect(getWholeLines(index, { line: 0, ch: 0 }, { line: 2, ch: 0 })).toEqual(
                { first: 0, last: 1 });
            expect(getWholeLines(index, { line: 1, ch: 0 }, { line: 9, ch: 0 })).toEqual(
                { first: 1, last: 2 });
            expect(getWholeLines(index, { line: 1, ch: 2 }, { line: 3, ch: 0 })).toEqual(
                { first: 2, last: 2 });
            expect(getWholeLines(index, { line: 2, ch: 2 }, { line: 3, ch: 0 })).toBeNull();
            expect(getWholeLines(index, { line: 0, ch: 1 }, { line: 2, ch: 0 })).toBeNull();
        });
    });
});
