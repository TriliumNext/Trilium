import { afterEach, describe, expect, it, vi } from "vitest";

import {
    createVimEditor, getContent, getCursor, getLines, getStatus, item, paragraphs, press
} from "../../../test/vim-kit.js";
import { forgetRichContents, getRichContent, rememberRichContent } from "./vim_registers.js";

const BODY = paragraphs("body");
const CODE = "<codeBlock language=\"plaintext\">code</codeBlock>";
const HEADING = "<heading2>Heading</heading2>";
const HR = "<horizontalLine></horizontalLine>";

function quote(...texts: string[]) {
    return `<blockQuote>${paragraphs(...texts)}</blockQuote>`;
}

function code(...lines: string[]) {
    return `<codeBlock language="plaintext">${lines.join("<softBreak></softBreak>")}</codeBlock>`;
}

describe("Vim mode registers", () => {
    afterEach(() => {
        forgetRichContents();
    });

    describe("putting lines", () => {
        const CODE2 = code("code", "code2");
        const DOCUMENT = BODY + item("item", "x") + CODE2 + quote("quote") + HEADING + HR;
        const SOURCES = { body: 1, item: 2, code: 3, heading: 6, widget: 7 };
        const ITEM_A = item("item", "a");

        async function put(source: keyof typeof SOURCES, destination: number) {
            const editor = await createVimEditor(
                `<paragraph>[]${DOCUMENT.slice("<paragraph>".length)}`);
            press(editor, `${SOURCES[source]}Gyy${destination}Gp`);
            return editor;
        }

        it("puts into body text", async () => {
            const after = CODE2 + quote("quote") + HEADING + HR;
            expect(getContent(await put("body", 1))).toBe(BODY + BODY + ITEM_A + after);
            expect(getContent(await put("item", 1))).toBe(BODY + ITEM_A + item("item", "b")
                + after);
            expect(getContent(await put("code", 1))).toBe(BODY + paragraphs("code") + ITEM_A
                + after);
            expect(getContent(await put("heading", 1))).toBe(BODY + HEADING + ITEM_A + after);
            expect(getContent(await put("widget", 1))).toBe(BODY + HR + ITEM_A + after);
        });

        it("puts into a list", async () => {
            const after = CODE2 + quote("quote") + HEADING + HR;
            expect(getContent(await put("body", 2))).toBe(BODY + ITEM_A + item("body", "b")
                + after);
            expect(getContent(await put("item", 2))).toBe(BODY + ITEM_A + item("item", "b")
                + after);
            expect(getContent(await put("code", 2))).toBe(BODY + ITEM_A + item("code", "b")
                + after);
            expect(getContent(await put("heading", 2))).toBe(BODY + ITEM_A + item("Heading", "b")
                + after);
            expect(getContent(await put("widget", 2))).toBe(BODY + ITEM_A
                + "<horizontalLine listIndent=\"0\" listItemId=\"a\" listType=\"bulleted\">"
                + "</horizontalLine>" + after);
        });

        it("puts into a code block", async () => {
            const before = BODY + ITEM_A;
            const after = quote("quote") + HEADING + HR;
            expect(getContent(await put("body", 3))).toBe(before + code("code", "body", "code2")
                + after);
            expect(getContent(await put("item", 3))).toBe(before + code("code", "item", "code2")
                + after);
            expect(getContent(await put("heading", 3))).toBe(before
                + code("code", "Heading", "code2") + after);
            const editor = await put("widget", 3);
            expect(getContent(editor)).toBe(before + CODE2 + after);
            expect(getStatus(editor).message?.text).toBe(
                "A widget cannot be put into a code block");
        });

        it("puts into a quote", async () => {
            const before = BODY + ITEM_A + CODE2;
            const after = HEADING + HR;
            expect(getContent(await put("body", 5))).toBe(before + quote("quote", "body") + after);
            expect(getContent(await put("item", 5))).toBe(before + quote("quote", "item") + after);
            expect(getContent(await put("code", 5))).toBe(before + quote("quote", "code") + after);
            expect(getContent(await put("heading", 5))).toBe(before + quote("quote", "Heading")
                + after);
            expect(getContent(await put("widget", 5))).toBe(before
                + `<blockQuote>${paragraphs("quote")}${HR}</blockQuote>` + after);
        });

        it("puts a whole code block as a code block, and as a paragraph where it cannot go",
            async () => {
            const editor = await createVimEditor(
                `${CODE.replace("code<", "[]code<")}${item("item", "x")}${BODY}`);
            press(editor, "yyGp");
            expect(getContent(editor)).toBe(CODE + item("item", "a") + BODY + CODE);
            press(editor, "u2Gp");
            expect(getContent(editor)).toBe(CODE + item("item", "a") + item("code", "b") + BODY);
        });

        it("puts above, a count of times, and lands on the first non-blank character", async () => {
            const editor = await createVimEditor(paragraphs("[]·a", "b"));
            press(editor, "yyj2P");
            expect(getLines(editor)).toBe(" a| a| a|b");
            expect(getCursor(editor)).toBe("1:1");
            press(editor, "u");
            expect(getLines(editor)).toBe(" a|b");
        });

        it("keeps the items of a list together and their levels", async () => {
            const editor = await createVimEditor(item("[]A", "a") + item("A2", "a")
                + item("N", "b", 1)
                + item("B", "c") + paragraphs("body") + item("X", "x", 0, "numbered")
                    + item("Y", "y", 1, "numbered"));
            press(editor, "3yy5Gp");
            expect(getContent(editor)).toBe(item("A", "a") + item("A2", "a") + item("N", "b", 1)
                + item("B", "c")
                + paragraphs("body") + item("A", "d") + item("A2", "d") + item("N", "e", 1)
                + item("X", "f", 0, "numbered") + item("Y", "g", 1, "numbered"));
            press(editor, "ugg3yyGp");
            expect(getContent(editor)).toContain(item("Y", "e", 1, "numbered")
                + item("A", "f", 1, "numbered")
                + item("A2", "f", 1, "numbered") + item("N", "g", 2, "numbered"));
        });

        it("reads parts of soft-broken blocks as blocks of their own", async () => {
            const editor = await createVimEditor(
                "<paragraph>[]a<softBreak></softBreak><$text bold=\"true\">b</$text></paragraph>"
                + code("c1", "c2") + BODY);
            press(editor, "jyyGp");
            expect(getContent(editor)).toContain(
                `${BODY}<paragraph><$text bold="true">b</$text></paragraph>`);
            press(editor, "u3GyyGp");
            expect(getContent(editor)).toContain(`${BODY}${paragraphs("c1")}`);
        });

        it("yanks the empty line before a widget with the lines above it", async () => {
            const editor = await createVimEditor(paragraphs("[]x", "")
                + "<horizontalLine></horizontalLine>");
            press(editor, "yjGp");
            expect(getLines(editor)).toBe("x||\u{FFFC}|x|");
        });

        it("puts plain text as paragraphs", async () => {
            const editor = await createVimEditor(paragraphs("[]a", "b\u{FFFC}"));
            press(editor, "yj");
            forgetRichContents();
            press(editor, "Gp");
            expect(getContent(editor)).toBe(paragraphs("a", "b\u{FFFC}", "a", "b"));
        });
    });

    describe("putting text", () => {
        it("keeps the formatting of the text", async () => {
            const editor = await createVimEditor(
                "<paragraph><$text bold=\"true\">[]bold</$text> plain "
                + "<$text linkHref=\"x\">link</$text></paragraph>");
            press(editor, "yiw$p");
            expect(getContent(editor)).toBe("<paragraph><$text bold=\"true\">bold</$text> plain "
                + "<$text linkHref=\"x\">link</$text>"
                + "<$text bold=\"true\">bold</$text></paragraph>");
            expect(getCursor(editor)).toBe("0:18");
            press(editor, "0w2P");
            expect(getLines(editor)).toBe("bold boldboldplain linkbold");
            expect(getCursor(editor)).toBe("0:12");
        });

        it("puts a word yanked from a line of a heading as text", async () => {
            const editor = await createVimEditor(`<heading2>[]Title</heading2>${BODY}`);
            press(editor, "yejp");
            expect(getContent(editor)).toBe(
                `${HEADING.replace("Heading", "Title")}${paragraphs("bTitleody")}`);
        });

        it("puts plain text", async () => {
            const editor = await createVimEditor(paragraphs("[]ab"));
            press(editor, "yl");
            forgetRichContents();
            press(editor, "p");
            expect(getLines(editor)).toBe("aab");
        });

        it("replaces a Visual selection and keeps what it replaced", async () => {
            const editor = await createVimEditor(paragraphs("[]one two"));
            press(editor, "yiwwviwp");
            expect(getLines(editor)).toBe("one one");
            press(editor, "0viwp");
            expect(getLines(editor)).toBe("two one");
        });

        it("has no Visual block mode", async () => {
            const editor = await createVimEditor(paragraphs("[]ab", "cd"));
            press(editor, ":nmap Q <lt>C-v><CR>Q");
            expect(getStatus(editor).mode).toBe("normal");
            expect(getStatus(editor).message?.text).toBe(
                "Visual block mode is not available in text notes");
            press(editor, ":nunmap Q<CR>");
        });

        it("keeps the registers for the black hole register", async () => {
            const editor = await createVimEditor(paragraphs("[]a", "b"));
            press(editor, "yy\"_ddp");
            expect(getLines(editor)).toBe("b|a");
        });

        it("keeps named registers", async () => {
            const editor = await createVimEditor(paragraphs("[]a", "b"));
            press(editor, "\"ayyj\"byy\"ap\"bp");
            expect(getLines(editor)).toBe("a|b|a|b");
        });

        it("counts the lines yanked next to tables and widgets", async () => {
            const cells = "<tableCell><paragraph>one</paragraph></tableCell>"
                + "<tableCell><paragraph>two</paragraph></tableCell>";
            const editor = await createVimEditor(quote("[]q")
                + `<table><tableRow>${cells}</tableRow><tableRow>${cells}</tableRow></table>`
                + HR + paragraphs("x"));
            for (let line = 1; line <= 7; line++) {
                press(editor, `${line}Gyy`);
                expect(getStatus(editor).message?.text, `line ${line}`).toBe("1 lines yanked");
            }
            press(editor, "ggyj");
            expect(getStatus(editor).message?.text).toBe("2 lines yanked");
        });
    });

    describe("the clipboard registers", () => {
        it("copy to the clipboard of the host, with the formatting", async () => {
            const writeClipboard = vi.fn();
            const editor = await createVimEditor(
                "<paragraph><$text bold=\"true\">[]a</$text></paragraph>",
                { host: { writeClipboard } });
            press(editor, "\"+yy");
            expect(writeClipboard).toHaveBeenLastCalledWith("a\n", "<p><strong>a</strong></p>");
            press(editor, "\"*yl");
            expect(writeClipboard).toHaveBeenLastCalledWith("a", "<strong>a</strong>");
            press(editor, "p");
            expect(getLines(editor)).toBe("aa");
        });

        it("put the text of the clipboard of the host", async () => {
            const readClipboard = vi.fn().mockResolvedValue("line\n");
            const editor = await createVimEditor(paragraphs("[]a"), { host: { readClipboard } });
            press(editor, "\"+p");
            await vi.waitFor(() => expect(getLines(editor)).toBe("a|line"));
            readClipboard.mockResolvedValue("x");
            press(editor, "\"*P");
            await vi.waitFor(() => expect(getLines(editor)).toBe("a|xline"));
        });

        it("put the register when the clipboard cannot be read", async () => {
            const readClipboard = vi.fn().mockRejectedValue(new Error("denied"));
            const editor = await createVimEditor(paragraphs("[]a"),
                { host: { readClipboard, writeClipboard: vi.fn() } });
            press(editor, "\"+yy\"+p");
            await vi.waitFor(() => expect(getLines(editor)).toBe("a|a"));
        });

        it("use the clipboard of the browser without a host", async () => {
            const writeText = vi.spyOn(navigator.clipboard,
                "writeText").mockResolvedValue(undefined);
            const readText = vi.spyOn(navigator.clipboard, "readText").mockResolvedValue("z");
            const editor = await createVimEditor(paragraphs("[]a"));
            press(editor, "\"+yl");
            expect(writeText).toHaveBeenCalledWith("a");
            press(editor, "\"+p");
            await vi.waitFor(() => expect(getLines(editor)).toBe("az"));
            readText.mockRestore();
            writeText.mockRestore();
        });
    });

    describe("rich contents", () => {
        it("forgets the oldest of too many", async () => {
            const editor = await createVimEditor(paragraphs("a"));
            const content = editor.model.change(
                (writer) => ({ fragment: writer.createDocumentFragment(), isBlocks: false }));
            for (let index = 0; index <= 50; index++) {
                rememberRichContent(`text ${index}`, content);
            }
            expect(getRichContent("text 0")).toBeUndefined();
            expect(getRichContent("text 1")).toBe(content);
            rememberRichContent("text 1", content);
            rememberRichContent("text 51", content);
            expect(getRichContent("text 1")).toBe(content);
            expect(getRichContent("text 2")).toBeUndefined();
        });
    });
});
