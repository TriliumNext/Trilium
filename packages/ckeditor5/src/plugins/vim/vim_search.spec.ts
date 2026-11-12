import type { Editor } from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

import {
    createVimEditor, getAdapter, getContent, getCursor, getLines, getStatus, paragraphs, press,
    typeText
} from "../../../test/vim-kit.js";
import { SEARCH_MARKER } from "./vim_search.js";

function getHighlights(editor: Editor): string[] {
    const adapter = getAdapter(editor);
    return [ ...editor.model.markers.getMarkersGroup(SEARCH_MARKER) ].map((marker) => {
        const start = adapter.locatePosition(marker.getStart());
        const end = adapter.locatePosition(marker.getEnd());
        return `${start.line}:${start.ch}-${end.ch}`;
    });
}

describe("Vim mode search", () => {
    it("searches forward and backward, and wraps around", async () => {
        const editor = await createVimEditor(paragraphs("[]alpha beta", "beta gamma", "gamma"));
        press(editor, "/beta<CR>");
        expect(getCursor(editor)).toBe("0:6");
        press(editor, "n");
        expect(getCursor(editor)).toBe("1:0");
        press(editor, "n");
        expect(getCursor(editor)).toBe("0:6");
        press(editor, "N");
        expect(getCursor(editor)).toBe("1:0");
        press(editor, "?gamma<CR>");
        expect(getCursor(editor)).toBe("2:0");
        press(editor, "n");
        expect(getCursor(editor)).toBe("1:5");
        press(editor, "G$*");
        expect(getCursor(editor)).toBe("1:5");
        press(editor, "#");
        expect(getCursor(editor)).toBe("2:0");
    });

    it("highlights the matches until the highlights are cleared", async () => {
        const editor = await createVimEditor(paragraphs("[]ab ab", "xab"));
        press(editor, "/ab<CR>");
        await vi.waitFor(
            () => expect(getHighlights(editor)).toEqual([ "0:0-2", "0:3-5", "1:1-3" ]));
        press(editor, ":noh<CR>");
        expect(getHighlights(editor)).toEqual([]);
        press(editor, "n");
        await vi.waitFor(() => expect(getHighlights(editor)).toHaveLength(3));
        press(editor, "<Esc>");
        expect(getHighlights(editor)).toEqual([]);
    });

    it("follows the changes of the note with the highlights", async () => {
        vi.useFakeTimers();
        try {
            const editor = await createVimEditor(paragraphs("[]ab", "c"));
            press(editor, "/ab<CR>");
            vi.advanceTimersByTime(100);
            press(editor, "jA");
            typeText(editor, "ab");
            press(editor, "<Esc>");
            vi.advanceTimersByTime(150);
            expect(getHighlights(editor)).toEqual([ "0:0-2", "1:1-3" ]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("highlights at most a thousand matches", async () => {
        const editor = await createVimEditor(paragraphs(`[]${"a".repeat(600)}`, "a".repeat(600)));
        press(editor, "/a<CR>");
        await vi.waitFor(() => expect(getHighlights(editor)).toHaveLength(1000));
    });

    it("finds empty matches one after another", async () => {
        const editor = await createVimEditor(paragraphs("[]ab", "", "c"));
        press(editor, "/^<CR>");
        expect(getCursor(editor)).toBe("1:0");
        press(editor, "n");
        expect(getCursor(editor)).toBe("2:0");
        press(editor, "N");
        expect(getCursor(editor)).toBe("1:0");
        press(editor, "N");
        expect(getCursor(editor)).toBe("0:0");
        expect(getHighlights(editor)).toEqual([]);
    });

    it("finds matches in collapsed content and shows them", async () => {
        const editor = await createVimEditor("<heading2 headingCollapsed=\"true\">[]H</heading2>"
            + paragraphs("hidden text") + "<heading2>I</heading2>"
            + "<details><summary>T</summary><paragraph>inside</paragraph></details>");
        expect(getLines(editor)).toBe("H|I|T");
        press(editor, "/tex");
        expect(getLines(editor)).toBe("H|hidden text|I|T");
        expect(getCursor(editor)).toBe("0:0");
        press(editor, "<Esc>");
        expect(getLines(editor)).toBe("H|I|T");
        press(editor, "/text<CR>");
        expect(getCursor(editor)).toBe("1:7");
        expect(getContent(editor)).toContain("<heading2>H</heading2>");
        press(editor, "gg");
        expect(getLines(editor)).toBe("H|hidden text|I|T");
        press(editor, "/inside<CR>");
        expect(getCursor(editor)).toBe("4:0");
        expect(getContent(editor)).toContain("<details open=\"true\">");
    });

    it("says when a pattern is not found", async () => {
        const editor = await createVimEditor(paragraphs("[]abc"));
        press(editor, "/zzz<CR>");
        expect(getStatus(editor).message?.text).toContain("No match");
        expect(getCursor(editor)).toBe("0:0");
    });

    it("highlights as the pattern is typed, and closes on Escape", async () => {
        const editor = await createVimEditor(paragraphs("[]abc", "xbz"));
        press(editor, "/xb");
        expect(getStatus(editor).commandLine).not.toBeNull();
        await vi.waitFor(() => expect(getHighlights(editor)).toEqual([ "1:0-2" ]));
        press(editor, "<BS>");
        await vi.waitFor(() => expect(getHighlights(editor)).toEqual([ "1:0-1" ]));
        press(editor, "<Esc>");
        expect(getStatus(editor).commandLine).toBeNull();
        expect(getCursor(editor)).toBe("0:0");
    });

    describe(":s", () => {
        it("replaces on the line, on a range and in the whole note", async () => {
            const editor = await createVimEditor(paragraphs("[]a a", "a a", "a"));
            press(editor, ":s/a/b/<CR>");
            expect(getLines(editor)).toBe("b a|a a|a");
            press(editor, ":2,3s/a/c/g<CR>");
            expect(getLines(editor)).toBe("b a|c c|c");
            press(editor, ":%s/[bc]/d/g<CR>");
            expect(getLines(editor)).toBe("d a|d d|d");
            press(editor, "u");
            expect(getLines(editor)).toBe("b a|c c|c");
        });

        it("takes JavaScript replacements and line breaks", async () => {
            const editor = await createVimEditor(
                `${paragraphs("[]key=value")}<heading2>x-y</heading2>`);
            press(editor, ":s/(\\w+)=(\\w+)/$2=$1 [$&] $$/<CR>");
            expect(getLines(editor)).toBe("value=key [key=value] $|x-y");
            press(editor, ":2s/-/\\n/<CR>");
            expect(getContent(editor)).toBe(
                `${paragraphs("value=key [key=value] $")}<heading2>x</heading2>`
                    + `<heading2>y</heading2>`);
        });

        it("keeps the formatting of the replaced text", async () => {
            const editor = await createVimEditor(
                "<paragraph><$text bold=\"true\">[]abc</$text></paragraph>");
            press(editor, ":s/b/XY/<CR>");
            expect(getContent(editor)).toBe(
                "<paragraph><$text bold=\"true\">aXYc</$text></paragraph>");
        });

        it("never replaces inline objects with text", async () => {
            const editor = await createVimEditor(
                "<paragraph>[]a<imageInline src=\"x.png\"></imageInline>b</paragraph>");
            press(editor, ":s/\\uFFFC/x/<CR>");
            expect(getContent(editor)).toBe(
                "<paragraph>a<imageInline src=\"x.png\"></imageInline>b</paragraph>");
        });

        it("asks for each replacement with the c flag", async () => {
            const editor = await createVimEditor(paragraphs("[]a a a a a"));
            press(editor, ":s/a/b/gc<CR>");
            expect(getStatus(editor).commandLine?.element.textContent).toContain(
                "replace with b (y/n/a/q/l)");
            expect(getStatus(editor).mode).toBe("normal");
            press(editor, "yn");
            expect(getLines(editor)).toBe("b a a a a");
            press(editor, "l");
            expect(getLines(editor)).toBe("b a b a a");
            expect(getStatus(editor).commandLine).toBeNull();

            press(editor, ":s/a/c/gc<CR>a");
            expect(getLines(editor)).toBe("b c b c c");
            press(editor, ":s/b/d/gc<CR>q");
            expect(getLines(editor)).toBe("b c b c c");
            expect(getStatus(editor).mode).toBe("normal");
        });

        it("deletes the lines that match with :g", async () => {
            const editor = await createVimEditor(paragraphs("[]keep", "drop 1", "keep", "drop 2"));
            press(editor, ":g/drop/d<CR>");
            expect(getLines(editor)).toBe("keep|keep");
            press(editor, "u");
            expect(getLines(editor)).toBe("keep|drop 1|keep|drop 2");
        });
    });
});
