import type { Editor, ModelElement, ModelNode } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { aside, createVimEditor, setVimData } from "../../../test/vim-kit.js";
import {
    DEFAULT_VISIBILITY, EVERYTHING_SHOWN, LineIndex, type LineVisibility, OBJECT_CHARACTER
} from "./vim_lines.js";

const IMAGE = "<imageBlock src=\"a.png\"><caption>Caption</caption></imageBlock>";
const TABLE = "<table><tableRow><tableCell><paragraph>a1</paragraph></tableCell>"
    + "<tableCell><paragraph>b1</paragraph><paragraph>b2</paragraph></tableCell></tableRow>"
    + "<tableRow><tableCell><paragraph>a2</paragraph>"
    + "</tableCell><tableCell><paragraph>b3</paragraph>"
    + "</tableCell></tableRow></table>";

describe("LineIndex", () => {
    let editor: Editor;

    beforeEach(async () => {
        editor = await createVimEditor();
    });

    function index(data: string, visibility?: LineVisibility) {
        setVimData(editor, data);
        return new LineIndex(editor.model, visibility);
    }

    function texts(lines: LineIndex) {
        return lines.lines.map((_line, line) => lines.getText(line));
    }

    function root() {
        return editor.model.document.getRoot() as ModelElement;
    }

    function child(...path: number[]) {
        return root().getNodeByPath(path) as ModelElement;
    }

    it("reads a line per block, per soft-break segment and per widget", async () => {
        const lines = index("<heading2>Title</heading2>"
            + "<paragraph>one<softBreak></softBreak>two<softBreak></softBreak></paragraph>"
            + `${IMAGE}<horizontalLine></horizontalLine>`
            + "<paragraph>x<imageInline src=\"b.png\"></imageInline>y</paragraph>"
            + "<codeBlock language=\"plaintext\">c1<softBreak></softBreak>c2</codeBlock>");
        expect(texts(lines)).toEqual([
            "Title", "one", "two", "", OBJECT_CHARACTER, OBJECT_CHARACTER, `x${OBJECT_CHARACTER}y`,
                "c1", "c2"
        ]);
        expect(lines.lastLine).toBe(8);
        expect(lines.getText(9)).toBe("");
        expect(lines.getElement(4)).toBe(child(2));
        expect(lines.getElement(9)).toBeUndefined();
    });

    it("reads containers in reading order", async () => {
        const lines = index(`<blockQuote><paragraph>q</paragraph></blockQuote>${TABLE}`
            + "<multicolumnLayout columnRatios=\"1-1\"><multicolumnColumn><paragraph>c1</paragraph>"
            + "</multicolumnColumn><multicolumnColumn><paragraph>c2</paragraph></multicolumnColumn>"
            + "</multicolumnLayout>"
            + "<tabs><tab><tabTitle>T</tabTitle><tabPanel>"
            + "<paragraph>p</paragraph></tabPanel></tab></tabs>"
            + "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"bulleted\">item</paragraph>"
            + "<aside admonitionType=\"note\"><paragraph>note</paragraph></aside>"
            + aside("<paragraph>s1</paragraph><heading2>s2</heading2>"));
        expect(texts(lines)).toEqual([
            "q", "a1", "b1", "b2", "a2", "b3", "c1", "c2", "T", "p", "item", "note", "s1", "s2"
        ]);
        expect(lines.getSpan(child(6))).toEqual({ first: 12, last: 13 });
        expect(lines.has(child(6))).toBe(false);
    });

    it("reads the title of a closed collapsible block only, and leaves out hidden blocks",
        async () => {
        const data = "<details><summary>Closed</summary><paragraph>body</paragraph></details>"
            + "<details open=\"true\"><summary>Open</summary><paragraph>shown</paragraph></details>"
            + "<paragraph>hidden</paragraph><paragraph>end</paragraph>";
        expect(texts(index(data))).toEqual([ "Closed", "Open", "shown", "hidden", "end" ]);
        const isHidden = (node: ModelNode) => node.is("element", "paragraph")
            && (node.getChild(0) as { data?: string } | null)?.data === "hidden";
        expect(texts(index(data, { ...DEFAULT_VISIBILITY, isHidden })))
            .toEqual([ "Closed", "Open", "shown", "end" ]);
        expect(texts(index(data, EVERYTHING_SHOWN)))
            .toEqual([ "Closed", "body", "Open", "shown", "hidden", "end" ]);
    });

    it("tells the lines of each element", async () => {
        const lines = index(
            "<paragraph>a<softBreak></softBreak>b</paragraph><horizontalLine></horizontalLine>"
            + TABLE);
        const paragraph = child(0);
        expect(lines.has(paragraph)).toBe(true);
        expect(lines.getFirstLine(paragraph)).toBe(0);
        expect(lines.getLastLine(paragraph)).toBe(1);
        expect(lines.getLinesOf(paragraph)).toEqual([ 0, 1 ]);
        expect(lines.getLastLine(child(1))).toBe(2);

        const table = child(2);
        expect(lines.has(table)).toBe(false);
        expect(lines.getFirstLine(table)).toBeUndefined();
        expect(lines.getLastLine(table)).toBeUndefined();
        expect(lines.getLinesOf(table)).toEqual([]);
        expect(lines.getSpan(table)).toEqual({ first: 3, last: 7 });
        expect(lines.getSpan(paragraph)).toEqual({ first: 0, last: 1 });
    });

    it("has no span for an element without shown lines", async () => {
        const lines = index("<details><summary>T</summary><paragraph>a</paragraph></details>");
        expect(lines.getSpan(child(0, 1))).toBeNull();
    });

    it("maps lines and columns to model positions", async () => {
        const lines = index(
            "<paragraph>ab<softBreak></softBreak>cd</paragraph><horizontalLine></horizontalLine>"
            + "<paragraph>end</paragraph>");
        const paragraph = child(0);
        expect(lines.positionAt(0, 1).path).toEqual([ 0, 1 ]);
        expect(lines.positionAt(0, 9).path).toEqual([ 0, 2 ]);
        expect(lines.positionAt(1, -4).path).toEqual([ 0, 3 ]);
        expect(lines.positionAt(1, 2).parent).toBe(paragraph);
        expect(lines.positionAt(2, 0).path).toEqual([ 1 ]);
        expect(lines.positionAt(2, 1).path).toEqual([ 2 ]);
        expect(lines.positionAt(7, 0).path).toEqual([ 2, 3 ]);
        expect(lines.positionAt(-1, 3).path).toEqual([ 0, 0 ]);
    });

    it("maps an empty index to the start of the root", async () => {
        const lines = index("<paragraph>a</paragraph>",
            { ...DEFAULT_VISIBILITY, isHidden: () => true });
        expect(lines.lines).toHaveLength(0);
        expect(lines.lastLine).toBe(0);
        expect(lines.positionAt(3, 3).path).toEqual([ 0 ]);
    });

    it("locates model positions", async () => {
        const lines = index(
            "<paragraph>ab<softBreak></softBreak>cd<imageInline src=\"b.png\">"
                + "</imageInline>e</paragraph>"
            + `${IMAGE}<horizontalLine></horizontalLine>${TABLE}`);
        const model = editor.model;
        const paragraph = child(0);
        expect(lines.locate(model.createPositionAt(paragraph, 1))).toEqual({ line: 0, ch: 1 });
        expect(lines.locate(model.createPositionAt(paragraph, 2))).toEqual({ line: 0, ch: 2 });
        expect(lines.locate(model.createPositionAt(paragraph, 3))).toEqual({ line: 1, ch: 0 });
        expect(lines.locate(model.createPositionAt(paragraph, "end"))).toEqual({ line: 1, ch: 4 });
        expect(lines.locate(model.createPositionAt(child(0, 5), 0))).toEqual({ line: 1, ch: 2 });
        expect(lines.locate(model.createPositionAt(child(1, 0), 2))).toEqual({ line: 2, ch: 0 });
        expect(lines.locate(model.createPositionBefore(child(2)))).toEqual({ line: 3, ch: 0 });
        expect(lines.locate(model.createPositionAfter(child(0)))).toEqual({ line: 2, ch: 0 });
        expect(lines.locate(model.createPositionBefore(child(3)))).toEqual({ line: 3, ch: 1 });
        expect(lines.locate(model.createPositionAt(root(), "end"))).toEqual({ line: 8, ch: 2 });
        expect(lines.locate(model.createPositionAt(child(3, 0), 1))).toEqual({ line: 5, ch: 0 });
    });

    it("locates the places between blocks", () => {
        const lines = index(
            `<paragraph>ab</paragraph>${TABLE}<horizontalLine>`
                + `</horizontalLine><paragraph>c</paragraph>`);
        const model = editor.model;
        expect(lines.locate(model.createPositionAfter(child(0)))).toEqual({ line: 0, ch: 2 });
        expect(lines.locate(model.createPositionAfter(child(2)))).toEqual({ line: 6, ch: 1 });
        expect(lines.locate(model.createPositionAt(root(), "end"))).toEqual({ line: 7, ch: 1 });
    });

    it("converts between positions and indexes of the text of all lines", async () => {
        const lines = index(
            "<paragraph>ab</paragraph><paragraph></paragraph><paragraph>cde</paragraph>");
        expect(lines.indexOf({ line: 0, ch: 1 })).toBe(1);
        expect(lines.indexOf({ line: 1, ch: 5 })).toBe(3);
        expect(lines.indexOf({ line: 2, ch: 2 })).toBe(6);
        expect(lines.indexOf({ line: -1, ch: 2 })).toBe(0);
        expect(lines.indexOf({ line: 3, ch: 0 })).toBe(7);
        expect(lines.positionOfIndex(0)).toEqual({ line: 0, ch: 0 });
        expect(lines.positionOfIndex(3)).toEqual({ line: 1, ch: 0 });
        expect(lines.positionOfIndex(6)).toEqual({ line: 2, ch: 2 });
        expect(lines.positionOfIndex(99)).toEqual({ line: 2, ch: 3 });
        expect(lines.positionOfIndex(-1)).toEqual({ line: 0, ch: 0 });
    });

    it("reads a block again after its text changed", async () => {
        const lines = index(
            "<paragraph>ab<softBreak></softBreak>cd</paragraph><paragraph>x</paragraph>");
        const paragraph = child(0);
        expect(lines.indexOf({ line: 2, ch: 0 })).toBe(6);
        editor.model.change(
            (writer) => writer.insertText("ZZ", editor.model.createPositionAt(paragraph, 0)));
        expect(lines.refreshBlock(paragraph)).toBe(true);
        expect(texts(lines)).toEqual([ "ZZab", "cd", "x" ]);
        expect(lines.indexOf({ line: 2, ch: 0 })).toBe(8);

        editor.model.change(
            (writer) => writer.insertElement("softBreak",
            editor.model.createPositionAt(paragraph, 1)));
        expect(lines.refreshBlock(paragraph)).toBe(false);
        expect(lines.refreshBlock(root())).toBe(true);
    });

    it("finds the first line from a position", async () => {
        const lines = index("<paragraph>a</paragraph><paragraph>b</paragraph>");
        const model = editor.model;
        expect(lines.firstLineFrom(model.createPositionAt(root(), 0))).toBe(0);
        expect(lines.firstLineFrom(model.createPositionAt(child(0), 1))).toBe(1);
        expect(lines.firstLineFrom(model.createPositionAt(root(), "end"))).toBe(2);
    });

    it("tells whether a collapsible block is open by default", async () => {
        index("<details open=\"true\"><summary>a</summary><paragraph></paragraph></details>"
            + "<details><summary>b</summary><paragraph></paragraph></details>");
        expect(DEFAULT_VISIBILITY.isOpen(child(0))).toBe(true);
        expect(DEFAULT_VISIBILITY.isOpen(child(1))).toBe(false);
        expect(DEFAULT_VISIBILITY.isHidden(child(0))).toBe(false);
        expect(EVERYTHING_SHOWN.isOpen(child(1))).toBe(true);
        expect(EVERYTHING_SHOWN.isHidden(child(1))).toBe(false);
    });
});
