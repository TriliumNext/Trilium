import type { ClassicEditor } from "ckeditor5";
import { describe, expect, it } from "vitest";

import {
    createVimEditor, getAdapter, getCursor, getLines, getStatus, paragraphs, press, typeText
} from "../../../test/vim-kit.js";
import { VimPosition } from "./vim_adapter.js";

const MANY = paragraphs(...Array.from({ length: 60 }, (_value, index) => `line ${index}`));

/** An editor whose content scrolls inside a box of `height` pixels. */
async function createScrollingEditor(data: string, height = 300) {
    const editor = await createVimEditor(data) as ClassicEditor;
    const box = editor.ui.element as HTMLElement;
    box.style.height = `${height}px`;
    box.style.overflowY = "auto";
    box.style.width = "400px";
    editor.editing.view.focus();
    return { editor, box };
}

function cell(text: string, rowspan?: number) {
    return `<tableCell${rowspan ? ` rowspan="${rowspan}"` : ""}>${paragraphs(text)}</tableCell>`;
}

describe("VimAdapter", () => {
    describe("the screen", () => {
        it("moves to the top, the middle and the bottom of the window", async () => {
            const { editor,
                box } = await createScrollingEditor(
                `<paragraph>[]${MANY.slice("<paragraph>".length)}`);
            press(editor, "L");
            const bottom = Number(getCursor(editor).split(":")[0]);
            expect(bottom).toBeGreaterThan(3);
            press(editor, "H");
            expect(getCursor(editor)).toBe("0:0");
            press(editor, "M");
            const middle = Number(getCursor(editor).split(":")[0]);
            expect(middle).toBeGreaterThan(0);
            expect(middle).toBeLessThan(bottom);
            expect(box.scrollTop).toBeLessThan(50);
        });

        it("scrolls by pages, half pages and lines", async () => {
            const { editor,
                box } = await createScrollingEditor(
                `<paragraph>[]${MANY.slice("<paragraph>".length)}`);
            press(editor, "<C-f>");
            expect(box.scrollTop).toBeGreaterThan(200);
            expect(Number(getCursor(editor).split(":")[0])).toBeGreaterThan(5);
            press(editor, "<C-b>");
            expect(box.scrollTop).toBeLessThan(50);
            press(editor, "<C-d>");
            expect(Number(getCursor(editor).split(":")[0])).toBeGreaterThan(2);
            press(editor, "<C-u>");
            press(editor, "gg<C-e>");
            const scrolled = box.scrollTop;
            expect(scrolled).toBeGreaterThan(0);
            press(editor, "<C-y>");
            expect(box.scrollTop).toBeLessThan(scrolled);
            press(editor, "30Gzt");
            const top = box.scrollTop;
            expect(top).toBeGreaterThan(300);
            press(editor, "zb");
            expect(box.scrollTop).toBeLessThan(top);
            press(editor, "zz");
            expect(box.scrollTop).toBeGreaterThan(0);
            press(editor, "G");
            expect(box.scrollTop + box.clientHeight).toBeGreaterThanOrEqual(box.scrollHeight - 2);
            press(editor, "gg");
            expect(box.scrollTop).toBeLessThan(50);
        });

        it("moves by lines on the screen in a wrapped paragraph", async () => {
            const long = Array.from({ length: 40 }, (_value, index) => `word${index}`).join(" ");
            const { editor } = await createScrollingEditor(paragraphs(`[]${long}`, "next"));
            press(editor, "gj");
            const [ line, ch ] = getCursor(editor).split(":").map(Number);
            expect(line).toBe(0);
            expect(ch).toBeGreaterThan(10);
            press(editor, "g$");
            const [ , end ] = getCursor(editor).split(":").map(Number);
            expect(end).toBeGreaterThan(ch);
            press(editor, "g0");
            expect(Number(getCursor(editor).split(":")[1])).toBeLessThanOrEqual(ch);
            press(editor, "gk");
            expect(getCursor(editor)).toBe("0:0");
            press(editor, "gk");
            expect(getCursor(editor)).toBe("0:0");
            press(editor, "G0gk");
            expect(getCursor(editor).startsWith("0:")).toBe(true);
            press(editor, "Ggj");
            expect(getCursor(editor)).toBe("1:0");
        });

        it("measures nothing for a line that has no box", async () => {
            const editor = await createVimEditor(paragraphs("[]a"));
            const adapter = getAdapter(editor);
            expect(adapter.charCoords(new VimPosition(0, 0)).top).toBeGreaterThanOrEqual(0);
            expect(adapter.defaultTextHeight()).toBeGreaterThan(0);
            expect(adapter.getScrollInfo().clientHeight).toBeGreaterThan(0);
            adapter.scrollTo(null, null);
            adapter.scrollIntoView(new VimPosition(0, 0), 10);
            expect(adapter.coordsChar({ left: 0, top: 100000 }).line).toBe(0);
        });
    });

    describe("tables", () => {
        it("move to the same column of the next and the previous row", async () => {
            const editor = await createVimEditor(paragraphs("before")
                + "<table><tableRow>" + cell("a1") + cell("b1", 2) + cell("c1") + "</tableRow>"
                + "<tableRow>" + cell("a2") + "<tableCell>" + paragraphs("c2", "c2b")
                    + "</tableCell></tableRow>"
                + "<tableRow>" + cell("a3") + cell("b3") + cell("c3") + "</tableRow></table>"
                    + paragraphs("after"));
            expect(getLines(editor)).toBe("before|a1|b1|c1|a2|c2|c2b|a3|b3|c3|after");
            const moves = (start: number, keys: string) => {
                press(editor, `${start + 1}G${keys}`);
                return getCursor(editor);
            };
            expect(moves(0, "j")).toBe("1:0");
            expect(moves(1, "j")).toBe("4:0");
            expect(moves(4, "j")).toBe("7:0");
            expect(moves(7, "j")).toBe("10:0");
            expect(moves(2, "j")).toBe("8:0");
            expect(moves(3, "j")).toBe("5:0");
            expect(moves(5, "j")).toBe("6:0");
            expect(moves(6, "j")).toBe("9:0");
            expect(moves(9, "k")).toBe("6:0");
            expect(moves(5, "k")).toBe("3:0");
            expect(moves(8, "k")).toBe("2:0");
            expect(moves(2, "k")).toBe("0:0");
            expect(moves(10, "k")).toBe("9:0");
            expect(moves(1, "2j")).toBe("7:0");
        });
    });

    describe("positions", () => {
        it("deletes text to the end of a later line as whole lines, and to the start of one",
            async () => {
            const editor = await createVimEditor(paragraphs("[]ab", "x", "cd", "ef"));
            const adapter = getAdapter(editor);
            adapter.operation(() => adapter.replaceRange("", new VimPosition(0, 1),
                new VimPosition(2, 0)));
            expect(getLines(editor)).toBe("acd|ef");
            adapter.operation(() => adapter.replaceRange("", new VimPosition(0, 1),
                new VimPosition(1, 2)));
            expect(getLines(editor)).toBe("a");
        });

        it("matches brackets across lines", async () => {
            const editor = await createVimEditor(paragraphs("[]f(a, (b", "c)) (", ")"));
            press(editor, "f(%");
            expect(getCursor(editor)).toBe("1:2");
            press(editor, "%");
            expect(getCursor(editor)).toBe("0:1");
            press(editor, "j$%");
            expect(getCursor(editor)).toBe("2:0");
            press(editor, "%");
            expect(getCursor(editor)).toBe("1:4");
            press(editor, "gg05l%");
            expect(getCursor(editor)).toBe("1:1");
            const adapter = getAdapter(editor);
            expect(adapter.findMatchingBracket(new VimPosition(0, 0)).to).toBeUndefined();
            expect(
                adapter.scanForBracket(new VimPosition(1, 5), 1, undefined,
                { bracketRegex: /[()]/ }))
                .toEqual({ pos: new VimPosition(2, 0), ch: ")" });
            expect(adapter.scanForBracket(new VimPosition(0, 0), -1)).toBeNull();
            expect(adapter.getTokenTypeAt()).toBe("");
        });

        it("keeps marks where their text goes, and loses them with it", async () => {
            const editor = await createVimEditor(paragraphs("[]a", "b", "c"));
            press(editor, "jlmaggO");
            typeText(editor, "new");
            press(editor, "<Esc>'a");
            expect(getCursor(editor)).toBe("2:0");
            press(editor, "`a");
            expect(getCursor(editor)).toBe("2:0");
            press(editor, "dd'a");
            expect(getCursor(editor)).toBe("2:0");
            expect(getLines(editor)).toBe("new|a|c");

            const bookmark = getAdapter(editor).setBookmark(new VimPosition(1, 0));
            expect(bookmark.find()).toEqual({ line: 1, ch: 0 });
            bookmark.clear();
            expect(bookmark.find()).toBeNull();
        });

        it("goes back to the last change with gi", async () => {
            const editor = await createVimEditor(paragraphs("[]a", "b"));
            press(editor, "gi");
            expect(getStatus(editor).mode).toBe("insert");
            press(editor, "<Esc>");
            press(editor, "jA");
            typeText(editor, "x");
            press(editor, "<Esc>gggi");
            typeText(editor, "y");
            press(editor, "<Esc>");
            expect(getLines(editor)).toBe("a|bxy");
            press(editor, "ddgi");
            expect(getStatus(editor).mode).toBe("insert");
        });

        it("converts between positions and indexes, and clips positions", async () => {
            const editor = await createVimEditor(paragraphs("[]ab", "cd"));
            const adapter = getAdapter(editor);
            expect(adapter.indexFromPos(new VimPosition(1, 1))).toBe(4);
            expect(adapter.posFromIndex(4)).toEqual(new VimPosition(1, 1));
            expect(adapter.clipPos(new VimPosition(1, Number.NaN))).toEqual(new VimPosition(1, 2));
            expect(adapter.clipPos(new VimPosition(-2, 1))).toEqual(new VimPosition(0, 0));
            expect(adapter.clipPos(new VimPosition(9, 1))).toEqual(new VimPosition(1, 2));
            expect(adapter.lineCount()).toBe(2);
            expect(adapter.getOption("firstLineNumber")).toBe(1);
            adapter.setOption("textwidth", 40);
            expect(adapter.getOption("textwidth")).toBe(40);
            expect(adapter.getOption("readOnly")).toBe(false);
            expect(adapter.getSelections()).toEqual([ "" ]);
            expect(adapter.listSelections()).toHaveLength(1);
            adapter.setSelections([]);
            adapter.setSelections(
                [ { anchor: new VimPosition(0, 0), head: new VimPosition(0, 2) } ], 3);
            expect(adapter.getSelection()).toBe("ab");
            adapter.replaceSelections([ "xy" ]);
            adapter.replaceSelections([]);
            expect(getLines(editor)).toBe("xy|cd");
        });

        it("replaces a selection that the engine reads backward", async () => {
            const editor = await createVimEditor(paragraphs("[]abc"));
            const adapter = getAdapter(editor);
            adapter.setSelection(new VimPosition(0, 3), new VimPosition(0, 1));
            expect(adapter.getCursor("anchor")).toEqual(new VimPosition(0, 3));
            expect(adapter.getCursor("head")).toEqual(new VimPosition(0, 1));
            expect(adapter.getCursor("start")).toEqual(new VimPosition(0, 1));
            expect(adapter.getCursor("end")).toEqual(new VimPosition(0, 3));
            expect(adapter.getRange(new VimPosition(0, 3), new VimPosition(0, 1))).toBe("bc");
        });

        it("replays Backspace and Delete of Insert mode with dot", async () => {
            const editor = await createVimEditor(paragraphs("[]abcd", "abcd"));
            press(editor, "A");
            press(editor, "<BS>");
            editor.execute("delete");
            press(editor, "<Esc>j.");
            expect(getLines(editor)).toBe("abc|abc");
            press(editor, "0i<Del>");
            editor.execute("deleteForward");
            press(editor, "<Esc>k0.");
            expect(getLines(editor)).toBe("bc|bc");
        });
    });

    it("tells the engine of the changes and the moves of the user in Insert mode", async () => {
        const editor = await createVimEditor(paragraphs("[]ab"));
        press(editor, "i");
        typeText(editor, "x");
        const block = editor.model.document.getRoot()?.getChild(0);
        editor.model.change((writer) => writer.setSelection(block as never, "end"));
        typeText(editor, "y");
        press(editor, "<Esc>");
        expect(getLines(editor)).toBe("xaby");
        press(editor, "0.");
        expect(getLines(editor)).toBe("yxaby");
    });
});
