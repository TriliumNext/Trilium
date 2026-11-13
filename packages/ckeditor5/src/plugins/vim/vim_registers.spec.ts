import type { ModelElement } from "ckeditor5";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    createVimEditor, getContent, getCursor, getLines, getStatus, item, paragraphs, press,
    setVimData
} from "../../../test/vim-kit.js";
import TriliumVim from "./vim.js";
import { forgetRichContents } from "./vim_registers.js";

const BODY = paragraphs("body");
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

        it("puts the lines of a whole code block as paragraphs outside a code block", async () => {
            const single = await createVimEditor(code("[]c1") + BODY);
            press(single, "yyjp");
            expect(getContent(single)).toBe(code("c1") + BODY + paragraphs("c1"));

            const editor = await createVimEditor(
                `${code("[]one", "two")}${item("item", "x")}${BODY}`);
            press(editor, "2yyGp");
            expect(getContent(editor)).toBe(
                code("one", "two") + item("item", "a") + BODY + paragraphs("one", "two"));
            press(editor, "u3Gp");
            expect(getContent(editor)).toBe(code("one", "two") + item("item", "a")
                + item("one", "b") + item("two", "c") + BODY);
        });

        it("leaves out a block that its place refuses, and the attributes a paragraph cannot have",
            async () => {
            const editor = await createVimEditor(`[${HR}]${quote("q")}`);
            editor.model.schema.addChildCheck((context, definition) =>
                definition.name === "horizontalLine" && context.endsWith("blockQuote")
                    ? false
                    : undefined);
            press(editor, "yyjp");
            expect(getContent(editor)).toBe(HR + quote("q"));
            expect(getStatus(editor).message?.text).not.toContain("code block");

            editor.model.schema.extend("heading2", { allowAttributes: "headingOnly" });
            setVimData(editor, "<heading2 headingOnly=\"x\">[]H</heading2>" + item("i", "a"));
            press(editor, "yyjp");
            expect(getContent(editor)).toBe("<heading2 headingOnly=\"x\">H</heading2>"
                + item("i", "a") + item("H", "b"));
        });

        it("puts lines around a closed collapsible block, whose body does not show", async () => {
            const closed = "<details><summary>Closed</summary>"
                + `${paragraphs("hidden one", "hidden two")}</details>`;
            const editor = await createVimEditor(paragraphs("[]five") + closed);
            press(editor, "ddp");
            expect(getContent(editor)).toBe(closed + paragraphs("five"));
            expect(getCursor(editor)).toBe("1:0");
            press(editor, "kyyP");
            expect(getContent(editor)).toBe(paragraphs("Closed") + closed + paragraphs("five"));
            expect(getCursor(editor)).toBe("0:0");
            press(editor, "jyyp");
            expect(getContent(editor)).toBe(paragraphs("Closed") + closed
                + paragraphs("Closed", "five"));
        });

        it("puts a title as a paragraph, and on a title into the content under it", async () => {
            const tabs = (...panel: string[]) => "<tabs><tab><tabTitle>[]Plan</tabTitle>"
                + `<tabPanel>${paragraphs(...panel)}</tabPanel></tab></tabs>`;
            const editor = await createVimEditor(tabs("body") + paragraphs("z"));
            press(editor, "yyP");
            expect(getContent(editor)).toBe(tabs("Plan", "body").replace("[]", "")
                + paragraphs("z"));
            expect(getCursor(editor)).toBe("1:0");
            press(editor, "Gp");
            expect(getContent(editor)).toContain(paragraphs("z", "Plan"));

            const details = (...body: string[]) =>
                `<details open="true"><summary>Title</summary>${paragraphs(...body)}</details>`;
            setVimData(editor, details("body").replace("Title", "[]Title"));
            press(editor, "yyjp");
            expect(getContent(editor)).toBe(details("body", "Title"));
            press(editor, "ggP");
            expect(getContent(editor)).toBe(details("Title", "body", "Title"));

            setVimData(editor, paragraphs("[]x") + "<table><tableRow><tableCell>"
                + paragraphs("c") + "</tableCell></tableRow><caption>Cap</caption></table>");
            press(editor, "yyGp");
            expect(getLines(editor)).toBe("x|c|Cap|x");
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

        it("put nothing when Vim mode is off by the time the clipboard is read", async () => {
            let resolve: (text: string) => void = () => undefined;
            const readClipboard = vi.fn(() => new Promise<string>((done) => {
                resolve = done;
            }));
            const editor = await createVimEditor(paragraphs("[]a"), { host: { readClipboard } });
            press(editor, "\"+p");
            await editor.plugins.get(TriliumVim).setEnabled(false);
            resolve("late");
            await new Promise((done) => setTimeout(done));
            expect(editor.getData()).toBe("<p>a</p>");
        });

        it("put nothing when the cursor, the mode or the note changed while the clipboard was read",
            async () => {
            let resolve: (text: string) => void = () => undefined;
            const readClipboard = vi.fn(() => new Promise<string>((done) => {
                resolve = done;
            }));
            const editor = await createVimEditor(paragraphs("[]a", "b", ""),
                { host: { readClipboard } });
            const secondLine = editor.model.document.getRoot()?.getChild(1) as ModelElement;
            const answer = async () => {
                resolve("x");
                await new Promise((done) => setTimeout(done));
            };
            press(editor, "\"+p");
            editor.model.change((writer) => writer.setSelection(secondLine, 0));
            await answer();
            press(editor, "gg\"+p");
            editor.model.change((writer) => writer.insertText("c", secondLine, "end"));
            await answer();
            press(editor, "\"+pi");
            await answer();
            press(editor, "<Esc>v\"+pj");
            await answer();
            press(editor, "<Esc>G\"+pv");
            await answer();
            expect(getLines(editor)).toBe("a|bc|");
            press(editor, "<Esc>gg\"+p");
            await answer();
            expect(getLines(editor)).toBe("ax|bc|");
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
        const IMAGE_A = "<imageBlock src=\"a.png\"></imageBlock>";
        const IMAGE_B = "<imageBlock src=\"b.png\"></imageBlock>";
        const BOLD_WORD = "<$text bold=\"true\">word</$text>";

        it("belong to the register they were read into, whatever the others hold", async () => {
            const editor = await createVimEditor(paragraphs("[]x") + IMAGE_A + IMAGE_B
                + `<paragraph>${BOLD_WORD} word</paragraph>`);
            press(editor, "j\"ayyj\"byyj\"cyiww\"dyiwgg\"ap");
            expect(getContent(editor)).toBe(paragraphs("x") + IMAGE_A + IMAGE_A + IMAGE_B
                + `<paragraph>${BOLD_WORD} word</paragraph>`);
            press(editor, "G$\"cp");
            expect(getContent(editor)).toContain(`<paragraph>${BOLD_WORD} word${BOLD_WORD}`);
        });

        it("are left behind when the text of the register changes", async () => {
            const editor = await createVimEditor(`<paragraph>${BOLD_WORD} []word</paragraph>`);
            press(editor, "0yiwwviwp$p");
            expect(getContent(editor)).toBe(`<paragraph>${BOLD_WORD} ${BOLD_WORD}word</paragraph>`);
            press(editor, "0\"ayiw\"Ayl$p$\"ap");
            expect(getContent(editor)).toBe(
                `<paragraph>${BOLD_WORD} ${BOLD_WORD}wordwordwwordw</paragraph>`);
        });

        it("go over a Visual selection with their formatting", async () => {
            const editor = await createVimEditor(
                `<paragraph>aa ${BOLD_WORD.replace("word", "[]word")} bb</paragraph>`
                + "<paragraph>one <$text italic=\"true\">two</$text> three</paragraph>");
            press(editor, "yiwjwviwp");
            expect(getContent(editor)).toContain(`<paragraph>one ${BOLD_WORD} three</paragraph>`);
            expect(getCursor(editor)).toBe("1:7");
            expect(getStatus(editor).mode).toBe("normal");
            press(editor, "$p");
            expect(getContent(editor)).toContain(
                `<paragraph>one ${BOLD_WORD} three<$text italic="true">two</$text></paragraph>`);

            setVimData(editor, `<paragraph>[]${BOLD_WORD} x</paragraph>${paragraphs("y", "z")}`);
            press(editor, "yyjVjp");
            expect(getContent(editor)).toBe(`<paragraph>${BOLD_WORD} x</paragraph>`.repeat(2));
            expect(getCursor(editor)).toBe("1:0");
            press(editor, "p");
            expect(getLines(editor)).toBe("word x|word x|y|z");

            setVimData(editor, `[${HR}]${code("c")}`);
            press(editor, "yyjVp");
            expect(getLines(editor)).toBe("\u{FFFC}|c");
            expect(getStatus(editor).message?.text)
                .toBe("A widget cannot be put into a code block");
            expect(getStatus(editor).mode).toBe("normal");
        });

        it("come back from the clipboard while it holds their text", async () => {
            const readClipboard = vi.fn().mockResolvedValue("word");
            const editor = await createVimEditor(
                `<paragraph>${BOLD_WORD.replace("word", "[]word")} x</paragraph>`,
                { host: { readClipboard, writeClipboard: vi.fn() } });
            press(editor, "\"+yiw$\"+p");
            await vi.waitFor(() => expect(getContent(editor)).toBe(
                `<paragraph>${BOLD_WORD} x${BOLD_WORD}</paragraph>`));
        });
    });
});
