import type { Vim } from "@replit/codemirror-vim-core";
import {
    Autoformat, type ClassicEditor, Command, type Editor, Enter, ImageBlock, MentionEditing,
    type ModelElement, MutationObserver as ViewMutationObserver, Paragraph, Plugin, ShiftEnter,
    Typing, ViewDocumentDomEventData
} from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { seedFootnotes } from "../../../test/footnotes-kit.js";
import {
    createVimEditor, getAdapter, getContent, getCursor, getLines, getStatus, item, paragraphs,
    press, setVimData, typeText
} from "../../../test/vim-kit.js";
import ContentEmbed from "../content_embed/content_embed.js";
import ContentEmbedCaret from "../content_embed/content_embed_caret.js";
import FindReveal from "../find_reveal.js";
import Footnotes from "../footnotes/footnotes.js";
import TriliumMentionUI from "../mention/trilium_mention_ui.js";
import TriliumVim from "./vim.js";
import VimAdapter, { VimPosition } from "./vim_adapter.js";
import { replaceText } from "./vim_editing.js";
import { getLoadedVimEngine } from "./vim_engine.js";
import { LineIndex } from "./vim_lines.js";

/** An editor with the fewest plugins: no undo, no lists, no collapsing, no indentation. */
async function createMinimalEditor(data: string) {
    const editor = await createTestEditor([ Paragraph, Enter, ShiftEnter, Typing, TriliumVim ],
        { vim: { enabled: true } });
    const { _setModelData: setModelData } = await import("ckeditor5");
    setModelData(editor.model, data);
    getAdapter(editor).operation(() => undefined);
    return editor;
}

function engine(): Vim {
    return getLoadedVimEngine() as Vim;
}

describe("Vim mode edge cases", () => {
    describe("the session", () => {
        it("starts once when it is turned on and off while the editor loads", async () => {
            class Twice extends Plugin {
                static get requires() {
                    return [ TriliumVim ] as const;
                }

                init() {
                    void this.editor.plugins.get(TriliumVim).setEnabled(true);
                }
            }
            class Off extends Plugin {
                static get requires() {
                    return [ TriliumVim ] as const;
                }

                init() {
                    void this.editor.plugins.get(TriliumVim).setEnabled(false);
                }
            }
            const twice = await createVimEditor(paragraphs("[]a"), {}, [ Twice ]);
            expect(twice.plugins.get(TriliumVim).isActive).toBe(true);
            const off = await createVimEditor(paragraphs("[]a"), {}, [ Off ]);
            expect(off.plugins.get(TriliumVim).isActive).toBe(false);

            const destroyed = await createVimEditor(paragraphs("[]a"), { enabled: false });
            await destroyed.destroy();
            await destroyed.plugins.get(TriliumVim).setEnabled(true);
            expect(destroyed.plugins.get(TriliumVim).isActive).toBe(false);
        });

        it("leaves no paste listener of the engine behind, even after the engine renewed its state",
            async () => {
            const editor = await createVimEditor(paragraphs("[]abc"));
            const adapter = getAdapter(editor);
            // The engine starts a new state when a command throws.
            adapter.state.vim = undefined;
            engine().maybeInitVimState_(adapter as never);
            await editor.plugins.get(TriliumVim).setEnabled(false);
            const errors: string[] = [];
            const onError = (event: ErrorEvent) => {
                errors.push(event.message);
                event.preventDefault();
            };
            window.addEventListener("error", onError);
            try {
                const clipboardData = new DataTransfer();
                clipboardData.setData("text/plain", "X");
                const event = new ClipboardEvent("paste",
                    { bubbles: true, cancelable: true, clipboardData });
                (editor.editing.view.getDomRoot() as HTMLElement).dispatchEvent(event);
                expect(errors).toEqual([]);
                expect(editor.getData()).toBe("<p>Xabc</p>");
            } finally {
                window.removeEventListener("error", onError);
            }
        });

        it("ignores modifier keys alone, passes unknown Ctrl keys and swallows Ctrl+Backspace",
            async () => {
            const editor = await createVimEditor(paragraphs("[]ab cd"));
            expect(press(editor, "<Shift>")).toBe(false);
            expect(press(editor, "<Dead>")).toBe(false);
            expect(press(editor, "<C-g>")).toBe(false);
            expect(press(editor, "<C-BS>")).toBe(true);
            expect(press(editor, "<C-Del>")).toBe(true);
            expect(getLines(editor)).toBe("ab cd");
            press(editor, "i");
            expect(press(editor, "<A-x>")).toBe(false);
            const view = editor.editing.view;
            view.document.fire("insertText",
                new ViewDocumentDomEventData(view, new Event("beforeinput"), { text: "q" }));
            expect(getStatus(editor).mode).toBe("insert");

            const keys = await createVimEditor(paragraphs("[]ab"),
                { isInsertKeysEnabled: () => true });
            engine().getRegisterController().getRegister(".").setText("");
            press(keys, "i<C-a>");
            expect(getLines(keys)).toBe("ab");
        });

        it("reports an error of the engine and takes the key", async () => {
            const editor = await createVimEditor(paragraphs("[]a"));
            const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
            const handleKey = vi.spyOn(engine(),
                "multiSelectHandleKey").mockImplementationOnce(() => {
                throw new Error("engine");
            });
            expect(press(editor, "x")).toBe(true);
            expect(error).toHaveBeenCalled();
            handleKey.mockRestore();
            error.mockRestore();
        });

        it("lets Escape close a balloon first", async () => {
            const editor = await createVimEditor(paragraphs("[]a"));
            const balloon = vi.fn((_data: unknown, cancel: () => void) => cancel());
            editor.keystrokes.set("Esc", balloon);
            press(editor, "i<Esc>");
            expect(balloon).toHaveBeenCalled();
            expect(getStatus(editor).mode).toBe("insert");
        });

        it("lets Escape close the list of a mention first", async () => {
            const element = document.createElement("div");
            document.body.append(element);
            let state: unknown = null;
            const list = {
                show: (shown: unknown) => {
                    state = shown;
                },
                hide: () => {
                    state = null;
                },
                handleKeyDown: () => false,
                destroy: () => undefined,
                get element() {
                    return state ? element : null;
                }
            };
            const editor = await createVimEditor(paragraphs("[]"), {},
                [ MentionEditing, TriliumMentionUI ], {
                mention: { feeds: [],
                    hostedFeeds: [ { marker: "@", minimumCharacters: 0, list: () => list } ] }
            });
            press(editor, "i");
            editor.model.change((writer) => {
                editor.model.insertContent(writer.createText("@no"),
                    editor.model.document.selection.getFirstPosition());
            });
            expect(editor.plugins.get(TriliumMentionUI).isListShown).toBe(true);
            press(editor, "<Esc>");
            expect(editor.plugins.get(TriliumMentionUI).isListShown).toBe(false);
            expect(getStatus(editor).mode).toBe("insert");
            press(editor, "<Esc>");
            expect(getStatus(editor).mode).toBe("normal");
            element.remove();
        });

        it("keeps a message that replaced a long one when the long one closes", async () => {
            const editor = await createVimEditor(paragraphs("[]a"));
            const adapter = getAdapter(editor);
            const closeLong = adapter.openNotification(document.createTextNode("long"),
                { duration: 0 });
            adapter.openNotification(document.createTextNode("short"), { duration: 1000 });
            closeLong();
            expect(getStatus(editor).message?.text).toBe("short");
        });

        it("keeps the command line open when the focus comes back to it", async () => {
            vi.useFakeTimers();
            try {
                const editor = await createVimEditor(paragraphs("[]a"));
                press(editor, ":");
                const input = getStatus(editor).commandLine?.element.querySelector(
                    "input") as HTMLInputElement;
                input.dispatchEvent(new FocusEvent("blur"));
                input.focus();
                vi.advanceTimersByTime(10);
                expect(getStatus(editor).commandLine).not.toBeNull();
                press(editor, "<Esc>");
            } finally {
                vi.useRealTimers();
            }
        });

        it("puts the register when the browser has no clipboard, and copies when writing fails",
            async () => {
            const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, "clipboard");
            const editor = await createVimEditor(paragraphs("[]a"));
            const writeText = vi.spyOn(navigator.clipboard,
                "writeText").mockRejectedValue(new Error("denied"));
            press(editor, "\"+yl");
            expect(writeText).toHaveBeenCalledWith("a");
            writeText.mockRestore();
            Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
            try {
                press(editor, "\"+p");
                await vi.waitFor(() => expect(getLines(editor)).toBe("aa"));
                press(editor, "\"*yl");
            } finally {
                delete (navigator as { clipboard?: unknown }).clipboard;
                if (descriptor) {
                    Object.defineProperty(Navigator.prototype, "clipboard", descriptor);
                }
            }
        });
    });

    describe("embeds", () => {
        async function createEmbedEditors(isOuterVim: boolean) {
            const outer = await createVimEditor(
                "<paragraph>[]before</paragraph><contentEmbed noteId=\"n1\"></contentEmbed>",
                isOuterVim ? {} : { enabled: false }, [ ContentEmbed, ContentEmbedCaret ]);
            const nested = await createVimEditor(paragraphs("[]one", "two"));
            const wrapper = outer.editing.view.getDomRoot()?.querySelector(
                ".include-note-wrapper") as HTMLElement;
            const nestedElement = (
                nested as unknown as { ui: { element: HTMLElement } }).ui.element;
            wrapper.append(nestedElement);
            // The changes the editor in the embed made stay queued for the editor around it.
            const detach = () => {
                outer.editing.view.getObserver(ViewMutationObserver)?.disable();
                document.body.append(nestedElement);
            };
            return { outer, nested, detach };
        }

        it("go back to the editor around them with Escape, j and k", async () => {
            const { outer, nested, detach } = await createEmbedEditors(true);
            nested.editing.view.focus();
            press(nested, "<Esc>");
            expect(outer.model.document.selection.getSelectedElement()?.name).toBe("contentEmbed");
            press(nested, "j");
            expect(getCursor(nested)).toBe("1:0");
            press(nested, "j");
            expect(outer.model.document.selection.getSelectedElement()?.name).toBe("contentEmbed");
            press(nested, "gg");
            press(nested, "k");
            expect(outer.model.document.selection.getSelectedElement()?.name).toBe("contentEmbed");
            expect(outer.plugins.get(TriliumVim).selectEmbedOf(document.body)).toBe(false);
            detach();
        });

        it("go back to an editor without Vim mode with Escape", async () => {
            const { outer, nested, detach } = await createEmbedEditors(false);
            const leaveEmbed = vi.spyOn(outer.plugins.get(ContentEmbedCaret),
                "leaveEmbed").mockReturnValue(true);
            press(nested, "<Esc>");
            expect(leaveEmbed).toHaveBeenCalled();
            detach();
        });

        it("open a line next to an embed that cannot be entered", async () => {
            const editor = await createVimEditor("[<contentEmbed noteId=\"n1\"></contentEmbed>]",
                {}, [ ContentEmbed ]);
            press(editor, "a");
            expect(getStatus(editor).mode).toBe("insert");
            expect(getLines(editor)).toBe("\u{FFFC}|");

            const refused = await createVimEditor("[<contentEmbed noteId=\"n1\"></contentEmbed>]",
                {}, [ ContentEmbed ],
                { contentEmbed: { enter: () => false } });
            press(refused, "i");
            expect(getLines(refused)).toBe("|\u{FFFC}");

            const empty = await createVimEditor("[<contentEmbed noteId=\"n1\"></contentEmbed>]",
                {}, [ ContentEmbed ],
                { contentEmbed: { enter: () => true } });
            press(empty, "i");
            expect(getStatus(empty).mode).toBe("normal");

            const plain = await createTestEditor([ Paragraph ]);
            const withPlain = await createVimEditor(
                "[<contentEmbed noteId=\"n1\"></contentEmbed>]", {}, [ ContentEmbed ], {
                contentEmbed: {
                    enter: (dom: HTMLElement) => {
                        const root = document.createElement("div");
                        root.className = "ck-editor__editable";
                        Object.assign(root, { ckeditorInstance: plain });
                        dom.append(root);
                        return true;
                    }
                }
            });
            press(withPlain, "i");
            expect(getStatus(withPlain).mode).toBe("normal");
        });
    });

    describe("the adapter", () => {
        it("splits a line with r and Enter, and takes positions without a column", async () => {
            const editor = await createVimEditor(paragraphs("[]ab"));
            press(editor, "r<CR>");
            expect(getLines(editor)).toBe("|b");
            const adapter = getAdapter(editor);
            adapter.setCursor(1);
            expect(getCursor(editor)).toBe("1:0");
            VimAdapter.off(adapter, "nothing", () => undefined);
        });

        it("reads a selection made with the mouse, and does nothing for commands of code",
            async () => {
            const editor = await createVimEditor(paragraphs("[]abc", "x"));
            press(editor, "jyl");
            const block = editor.model.document.getRoot()?.getChild(0);
            editor.model.change((writer) => writer.setSelection(writer.createRange(
                writer.createPositionAt(block as never, 0),
                    writer.createPositionAt(block as never, 2))));
            expect(getStatus(editor).mode).toBe("visual");
            press(editor, "p");
            expect(getLines(editor)).toBe("xc|x");
            press(editor, "$p");
            expect(getLines(editor)).toBe("xcab|x");
            press(editor, "==");
            expect(getLines(editor)).toBe("xcab|x");
            engine().getRegisterController().getRegister("z").setText("Q");
            editor.model.change((writer) => writer.setSelection(writer.createRange(
                writer.createPositionAt(block as never, 0),
                    writer.createPositionAt(block as never, 1))));
            press(editor, "\"zp");
            expect(getLines(editor)).toBe("Qcab|x");
            engine().getRegisterController().getRegister("z").setText("");
            editor.enableReadOnlyMode("spec");
            press(editor, "r<CR>");
            expect(getLines(editor)).toBe("Qcab|x");
        });

        it("reads a Visual selection of a widget from its start to its end", async () => {
            const editor = await createVimEditor("[<horizontalLine></horizontalLine>]"
                + paragraphs("a"));
            press(editor, "v");
            const adapter = getAdapter(editor);
            expect(adapter.getCursor("anchor")).toEqual(new VimPosition(0, 0));
            expect(adapter.getCursor("head")).toEqual(new VimPosition(0, 1));
            press(editor, "y");
            expect(getStatus(editor).mode).toBe("normal");
        });

        it("works without the plugins that hide, list, indent and undo", async () => {
            const editor = await createMinimalEditor(
                "<paragraph>[]ab</paragraph><paragraph>c</paragraph>");
            press(editor, "jdd");
            expect(getLines(editor)).toBe("ab");
            press(editor, "u>>/b<CR>");
            expect(getCursor(editor)).toBe("0:1");
            press(editor, "Yp");
            expect(getLines(editor)).toBe("ab|ab");
            press(editor, "kJ");
        });

        it("keeps its lines while text changes, and reads them again after a line break",
            async () => {
            const editor = await createVimEditor(paragraphs("[]ab", "cd"));
            press(editor, "/d<CR>");
            press(editor, "ggi");
            editor.execute("shiftEnter");
            typeText(editor, "x");
            press(editor, "<Esc>");
            expect(getLines(editor)).toBe("|xab|cd");
            const block = editor.model.document.getRoot()?.getChild(1);
            editor.plugins.get(FindReveal).show(editor.model.createPositionAt(block as never, 0));
            editor.model.change(
                (writer) => writer.insertText("y",
                editor.model.createPositionAt(block as never, 0)));
            editor.plugins.get(FindReveal).show(null);
            expect(getLines(editor)).toBe("|xab|ycd");
            editor.model.change((writer) => writer.insertElement("imageInline", { src: "a.png" },
                editor.model.createPositionAt(block as never, 0)));
            expect(getLines(editor)).toBe("|xab|\u{FFFC}ycd");
        });

        it("skips the lines that :g lost or joined", async () => {
            const editor = await createVimEditor(paragraphs("[]x1", "x2", "y"));
            press(editor, ":g/x/normal J<CR>");
            expect(getLines(editor)).toBe("x1 x2|y");
            const deleting = await createVimEditor(paragraphs("[]x1", "x2", "x3", "y"));
            press(deleting, ":g/x/normal jdd<CR>");
            expect(getLines(deleting)).toBe("x1|x3");
        });

        it("goes to the last change, or stays without one", async () => {
            const empty = await createVimEditor();
            press(empty, "`.");
            expect(getCursor(empty)).toBe("0:0");

            const editor = await createVimEditor(paragraphs("[]ab", "cd"));
            press(editor, "jx");
            press(editor, "gg`.");
            expect(getCursor(editor)).toBe("1:0");
            const block = editor.model.document.getRoot()?.getChild(1);
            editor.model.enqueueChange({ isUndoable: false },
                (writer) => writer.remove(block as never));
            press(editor, "gg`.");
            expect(getCursor(editor)).toBe("0:0");
        });

        it("finds the caret with caretRangeFromPoint, and nothing outside the window", async () => {
            const long = Array.from({ length: 40 }, (_value, index) => `word${index}`).join(" ");
            const editor = await createVimEditor(paragraphs(`[]${long}`));
            const box = (editor as unknown as { ui: { element: HTMLElement } }).ui.element;
            box.style.width = "300px";
            const adapter = getAdapter(editor);
            expect(
                adapter.findPositionOnScreenLine(new VimPosition(0, 0), true, -100000)).toBeNull();
            const original = document.caretPositionFromPoint;
            Object.defineProperty(document, "caretPositionFromPoint",
                { value: undefined, configurable: true });
            try {
                press(editor, "gj");
                expect(Number(getCursor(editor).split(":")[1])).toBeGreaterThan(0);
                expect(
                    adapter.findPositionOnScreenLine(new VimPosition(0, 0), true,
                    -100000)).toBeNull();
            } finally {
                Object.defineProperty(document, "caretPositionFromPoint",
                    { value: original, configurable: true });
            }
        });
    });

    describe("commands", () => {
        it("put nothing from an empty register, and lines with :put", async () => {
            const editor = await createVimEditor(paragraphs("[]ab"));
            press(editor, "\"zp");
            expect(getLines(editor)).toBe("ab");
            press(editor, "yl:put<CR>");
            expect(getLines(editor)).toBe("ab|a");
        });

        it("put lines next to a widget, before code lines and into the panel under a tab title",
            async () => {
            const editor = await createVimEditor(paragraphs("[]x", "")
                + "<horizontalLine></horizontalLine><codeBlock language=\"plaintext\">c</codeBlock>"
                + "<tabs><tab><tabTitle>T</tabTitle><tabPanel>"
                + "<paragraph>p</paragraph></tabPanel></tab></tabs>");
            press(editor, "yj3Gp");
            expect(getLines(editor)).toBe("x||\u{FFFC}|x||c|T|p");
            press(editor, "3GP");
            expect(getLines(editor)).toBe("x||x||\u{FFFC}|x||c|T|p");
            press(editor, "8GP");
            expect(getLines(editor)).toBe("x||x||\u{FFFC}|x||x||c|T|p");
            press(editor, "11Gp");
            expect(getLines(editor)).toBe("x||x||\u{FFFC}|x||x||c|T|x||p");
            expect(getCursor(editor)).toBe("11:0");
        });

        it("leave the cursor of :d on the next line, and the '. mark on the line put", async () => {
            const editor = await createVimEditor(paragraphs("[]a1", "b2", "c3", "d4", "e5"));
            press(editor, "jj:d<CR>");
            expect(getLines(editor)).toBe("a1|b2|d4|e5");
            expect(getCursor(editor)).toBe("2:0");
            press(editor, "G:d<CR>");
            expect(getCursor(editor)).toBe("2:0");
            press(editor, "gg:2d<CR>");
            expect(getCursor(editor)).toBe("0:0");
            setVimData(editor, paragraphs("[]a1", "b2", "c3", "d4"));
            press(editor, "G:1d<CR>");
            expect(getCursor(editor)).toBe("2:0");

            setVimData(editor, paragraphs("[]a1", "b2", "c3"));
            press(editor, "ddpgg'.");
            expect(getCursor(editor)).toBe("1:0");
            press(editor, "gg`.");
            expect(getCursor(editor)).toBe("1:0");
        });

        it("leave the cursor of :d on a widget on the line that takes its place", async () => {
            const editor = await createVimEditor();
            for (const before of [
                "<table><tableRow><tableCell><paragraph>a</paragraph></tableCell></tableRow>"
                    + "</table>",
                "<tabs><tab><tabTitle>T</tabTitle><tabPanel><paragraph>p</paragraph></tabPanel>"
                    + "</tab></tabs>",
                "<multicolumnLayout columnRatios=\"1-1\"><multicolumnColumn><paragraph>c1"
                    + "</paragraph></multicolumnColumn><multicolumnColumn><paragraph>c2"
                    + "</paragraph></multicolumnColumn></multicolumnLayout>",
                paragraphs("w"),
                "<horizontalLine></horizontalLine>"
            ]) {
                setVimData(editor, `${paragraphs("top")}${before}[<testBox></testBox>]`
                    + paragraphs("after"));
                press(editor, ":d<CR>");
                const lines = getLines(editor).split("|");
                expect(lines.at(-1)).toBe("after");
                expect(editor.model.document.selection.isCollapsed, before).toBe(true);
                expect(getCursor(editor), before).toBe(`${lines.length - 1}:0`);
                press(editor, "x");
                expect(getContent(editor)).toBe(paragraphs("top") + before + paragraphs("fter"));
            }
        });

        it("keep the alignment of a heading put into a list", async () => {
            const editor = await createVimEditor("<heading2 alignment=\"center\">[]H</heading2>"
                + item("i", "a"));
            press(editor, "yyjp");
            expect(getContent(editor)).toContain(
                "<paragraph alignment=\"center\" listIndent=\"0\"");
        });

        it("repeat :s without arguments and run :ck on one line and on a backward selection",
            async () => {
            const editor = await createVimEditor(paragraphs("[]a a", "a"));
            press(editor, ":s/a/b/<CR>j:s<CR>");
            expect(getLines(editor)).toBe("b a|b");
            press(editor, ":2ck bold<CR>");
            expect(getContent(editor)).toContain("<$text bold=\"true\">b</$text>");
            press(editor, "gg$vh:ck italic<CR>");
            expect(getContent(editor)).toContain("<$text italic=\"true\"> a</$text>");
        });

        it("give each editor command of :ck its value in the shape it takes", async () => {
            const editor = await createVimEditor(paragraphs("[]alpha beta"));
            const message = () => getStatus(editor).message?.text;
            press(editor, "viw:ck link https://example.com<CR>");
            expect(getContent(editor)).toBe("<paragraph><$text linkHref=\"https://example.com\">"
                + "alpha</$text> beta</paragraph>");
            for (const [ command, expected ] of [
                [ "codeBlock python", "<codeBlock language=\"python\">x</codeBlock>" ],
                [ "admonition warning",
                    "<aside admonitionType=\"warning\"><paragraph>x</paragraph></aside>" ],
                [ "insertText hi", "<paragraph>hix</paragraph>" ]
            ]) {
                setVimData(editor, paragraphs("[]x"));
                press(editor, `:ck ${command}<CR>`);
                expect(getContent(editor), command).toBe(expected);
            }
            setVimData(editor, paragraphs("[]x"));
            press(editor, ":ck insertTable 2 3<CR>");
            const table = editor.model.document.getRoot()?.getChild(0) as ModelElement;
            expect(table.is("element", "table")).toBe(true);
            expect(table.childCount).toBe(2);
            expect((table.getChild(0) as ModelElement).childCount).toBe(3);
            press(editor, ":ck insertTable 2<CR>");
            const square = editor.model.document.selection.getFirstPosition()
                ?.findAncestor("table") as ModelElement;
            expect([ square.childCount, (square.getChild(0) as ModelElement).childCount ])
                .toEqual([ 2, 2 ]);

            const addCommand = (name: string, execute: () => unknown) => {
                const command = Object.assign(new Command(editor), { execute });
                command.refresh();
                editor.commands.add(name, command);
            };
            for (const [ name, value, args ] of [
                [ "listStyle", "square", { type: "square" } ],
                [ "referenceLink", "#root/abc", { href: "#root/abc" } ],
                [ "insertImage", "a.png", { source: "a.png" } ],
                [ "imageInsert", "a.png", { source: "a.png" } ],
                [ "insertLinkEmbed", "https://a.org", { url: "https://a.org" } ],
                [ "textPartLanguage", "ar:rtl", { languageCode: "ar", textDirection: "rtl" } ]
            ] as const) {
                const execute = vi.fn();
                addCommand(name, execute);
                press(editor, `:ck ${name} ${value}<CR>`);
                expect(execute, name).toHaveBeenCalledWith(args);
            }

            const error = vi.spyOn(console, "error");
            setVimData(editor, paragraphs("[]x"));
            press(editor, ":ck heading<CR>");
            expect(message()).toBe("The editor command heading failed");
            addCommand("failing", vi.fn().mockRejectedValue(new Error("no")));
            press(editor, ":ck failing<CR>");
            await vi.waitFor(() => expect(message()).toBe("The editor command failing failed"));
            expect(error).not.toHaveBeenCalled();
            error.mockRestore();
        });

        it("drop the attributes of a code block that a heading or a paragraph cannot have",
            async () => {
            const editor = await createVimEditor(
                "<codeBlock language=\"plaintext\">[]a<softBreak></softBreak>b</codeBlock>");
            press(editor, ":ck heading heading3<CR>");
            expect(getContent(editor)).toBe("<heading3>a<softBreak></softBreak>b</heading3>");
            setVimData(editor, "<codeBlock language=\"plaintext\">[]a</codeBlock>");
            await editor.plugins.get(TriliumVim).setEnabled(false);
            editor.execute("paragraph");
            expect(getContent(editor)).toBe("<paragraph>a</paragraph>");
        });

        it("run the Ex command of a mapping, all of it, on a count of lines or a selection",
            async () => {
            const editor = await createVimEditor(paragraphs("[]a", "b", "c", "d", "e"));
            press(editor, ":map ,d :d<CR>");
            press(editor, ",d");
            expect(getLines(editor)).toBe("b|c|d|e");
            press(editor, ":mapclear<CR>:nmap ,d :d<CR>");
            press(editor, "2,d");
            expect(getLines(editor)).toBe("d|e");
            press(editor, ":nmap ,s :s/d/D/<lt>CR><CR>,s");
            expect(getLines(editor)).toBe("D|e");
            press(editor, ":vmap gb :ck bold<CR>viwgb");
            expect(getContent(editor)).toBe(
                `<paragraph><$text bold="true">D</$text></paragraph>${paragraphs("e")}`);
            expect(getStatus(editor).mode).toBe("normal");
            press(editor, ":nmap ,j j:s/e/E E/<lt>CR>k<CR>,j");
            expect(getLines(editor)).toBe("D|E E");
            expect(getCursor(editor)).toBe("0:0");
            press(editor, ":nmapclear<CR>:vmapclear<CR>,d<Esc>");
            expect(getLines(editor)).toBe("D|E E");
        });

        it("wait a second for the rest of a mapping after keys that are a command of their own",
            async () => {
            const editor = await createVimEditor(paragraphs("[]xax ax", "y"));
            vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
            try {
                press(editor, ":nmap ,d :d<CR>fa;,");
                expect(getCursor(editor)).toBe("0:4");
                expect(getStatus(editor).pendingKeys).toBe(",");
                vi.advanceTimersByTime(1000);
                expect(getCursor(editor)).toBe("0:1");
                expect(getStatus(editor).pendingKeys).toBe("");
                press(editor, ";,l");
                expect(getCursor(editor)).toBe("0:2");
                press(editor, "2,<Esc>");
                vi.advanceTimersByTime(1000);
                expect(getLines(editor)).toBe("xax ax|y");
                expect(getCursor(editor)).toBe("0:2");
                press(editor, ",d");
                expect(getLines(editor)).toBe("y");
            } finally {
                press(editor, ":nmapclear<CR>");
                vi.useRealTimers();
            }
        });

        it("change nothing on widgets selected backward", async () => {
            const editor = await createVimEditor(
                "<horizontalLine></horizontalLine>[<horizontalLine></horizontalLine>]");
            press(editor, "vkc");
            expect(getLines(editor)).toBe("\u{FFFC}|\u{FFFC}");
            expect(getStatus(editor).mode).toBe("normal");
        });

        it("copy plain text when the read content is gone", async () => {
            const writeClipboard = vi.fn();
            const editor = await createVimEditor(paragraphs("[]a"), { host: { writeClipboard } });
            const take = vi.spyOn(getAdapter(editor), "takeReadContent").mockReturnValue(null);
            press(editor, "\"+yl");
            expect(writeClipboard).toHaveBeenCalledWith("a", null);
            take.mockRestore();
        });
    });

    describe("editing", () => {
        it("takes the formatting before a line break for text that replaces it", async () => {
            const editor = await createVimEditor(
                "<paragraph><$text bold=\"true\">ab</$text></paragraph><paragraph>c</paragraph>");
            const model = editor.model;
            const root = model.document.getRoot();
            const range = model.createRange(model.createPositionFromPath(root as never, [ 0, 2 ]),
                model.createPositionFromPath(root as never, [ 1, 0 ]));
            replaceText(editor, range, " ", "\n");
            expect(getContent(editor)).toBe(
                "<paragraph><$text bold=\"true\">ab </$text>c</paragraph>");
        });

        it("indents nothing in a read-only editor", async () => {
            const editor = await createVimEditor(item("a", "a") + item("[]b", "b"));
            editor.enableReadOnlyMode("spec");
            press(editor, ">>");
            expect(getContent(editor)).toBe(item("a", "a") + item("b", "b"));
        });

        it("reads two tables with one check of what a table holds", async () => {
            const editor = await createVimEditor(
                "<table><tableRow><tableCell><paragraph>a</paragraph>"
                    + "</tableCell></tableRow></table>"
                + "<table><tableRow><tableCell><paragraph>b</paragraph>"
                + "</tableCell></tableRow></table>");
            expect(new LineIndex(editor.model).lines).toHaveLength(2);
        });
    });

    describe("search", () => {
        it("has no match before the first find", async () => {
            const editor = await createVimEditor(paragraphs("[]ab"));
            const cursor = getAdapter(editor).getSearchCursor(/b/, new VimPosition(0, 0));
            expect(cursor.match).toBeUndefined();
            expect(cursor.from()).toBeUndefined();
            expect(cursor.to()).toBeUndefined();
            cursor.replace("x");
            expect(getLines(editor)).toBe("ab");
        });

        it("drops a pending update of the highlights when they are hidden", async () => {
            vi.useFakeTimers();
            try {
                const editor = await createVimEditor(paragraphs("[]ab"));
                press(editor, "/a<CR>");
                vi.advanceTimersByTime(100);
                press(editor, "x:noh<CR>");
                vi.advanceTimersByTime(200);
                expect([ ...editor.model.markers.getMarkersGroup("vimSearch") ]).toHaveLength(0);
                press(editor, "/^<CR>");
                vi.advanceTimersByTime(100);
                expect([ ...editor.model.markers.getMarkersGroup("vimSearch") ]).toHaveLength(0);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe(":sort", () => {
        it("sorts nothing on one line, nor parts of a soft-broken paragraph, and drops duplicates",
            async () => {
            const editor = await createVimEditor(paragraphs("[]b", "a", "b")
                + "<paragraph>z<softBreak></softBreak>y</paragraph>");
            press(editor, ":2sort<CR>");
            expect(getLines(editor)).toBe("b|a|b|z|y");
            press(editor, ":3,4sort<CR>");
            expect(getStatus(editor).message?.text).toBe(
                "Only whole paragraphs of one kind or whole list items can be sorted");
            press(editor, ":1,3sort u<CR>");
            expect(getLines(editor)).toBe("a|b|z|y");
            const pattern = await createVimEditor(paragraphs("[]xa", "xb"));
            press(pattern, ":%sort! i /X/<CR>");
            expect(getLines(pattern)).toBe("xb|xa");
        });
    });

    describe("structure", () => {
        it("keep an empty line in the text of a footnote that its lines leave", async () => {
            const editor = await createVimEditor(undefined, {}, [ Footnotes ]);
            const text = "text\u{FFFC}\u{FFFC}";
            for (const [ keys, lines ] of [
                [ "jdd", `${text}||note 2` ],
                [ "jVd", `${text}||note 2` ],
                [ "j:d<CR>", `${text}||note 2` ],
                [ "jdj", `${text}||` ],
                [ "jVjd", `${text}||` ],
                [ "jddjx", `${text}||ote 2` ]
            ]) {
                seedFootnotes(editor as unknown as ClassicEditor, 2);
                editor.model.change((writer) => writer.setSelection(
                    editor.model.document.getRoot()?.getChild(0) as ModelElement, 0));
                press(editor, keys);
                expect(getLines(editor), keys).toBe(lines);
            }
            expect(getContent(editor))
                .toContain("<footnoteContent><paragraph></paragraph></footnoteContent>");
        });

        it("skips a collapsed section, and finds section edges without headings", async () => {
            const editor = await createVimEditor(
                "<heading2 headingCollapsed=\"true\">[]H</heading2>" + paragraphs("a", "b")
                + "<heading2>I</heading2><heading2>J</heading2>");
            press(editor, "}");
            expect(getCursor(editor)).toBe("1:0");
            press(editor, "]z");
            expect(getCursor(editor)).toBe("1:0");
            press(editor, "d2ap");
            expect(getStatus(editor).message?.text).toBe("The count stopped at a heading");
            const plain = await createVimEditor(paragraphs("[]a", "b"));
            press(plain, "]z");
            expect(getCursor(plain)).toBe("1:0");
        });

        it("folds the section around a quote that follows a paragraph", async () => {
            const editor = await createVimEditor("<heading2>H</heading2>" + paragraphs("p")
                + `<blockQuote>${paragraphs("[]q")}</blockQuote><heading2>I</heading2>`);
            press(editor, "zc");
            expect(getLines(editor)).toBe("H|I");
            expect(getCursor(editor)).toBe("0:0");
        });

        it("takes a closed collapsible block whole from its title", async () => {
            const editor = await createVimEditor(
                `<details><summary>[]T</summary>${paragraphs("body")}</details>${paragraphs("x")}`);
            press(editor, "dap");
            expect(getLines(editor)).toBe("x");
        });

        it("folds parents of items, collapsible blocks and items with nested owners", async () => {
            const editor = await createVimEditor(item("[]P", "a") + item("N1", "b", 1)
                + item("N2", "c", 1)
                + item("Q", "d") + item("Q1", "e", 1) + item("Q2", "f", 2)
                + `<details open="true">`
                + `<summary>T</summary>${paragraphs("x")}</details><heading2>H</heading2>`);
            press(editor, "3Gzc");
            expect(getLines(editor)).toBe("P|Q|Q1|Q2|T|x|H");
            expect(getCursor(editor)).toBe("0:0");
            press(editor, "zo4GzA");
            expect(getLines(editor)).toBe("P|N1|N2|Q|T|x|H");
            expect(getContent(editor)).toContain(
                item("Q1", "e", 1).replace("<paragraph ", "<paragraph listCollapsed=\"true\" "));
            press(editor, "zO");
            expect(getLines(editor)).toBe("P|N1|N2|Q|Q1|Q2|T|x|H");
            press(editor, "7GzA");
            expect(getLines(editor)).toBe("P|N1|N2|Q|Q1|Q2|T|H");
            press(editor, "Gza");
            expect(getStatus(editor).message?.text).toBe("Nothing to fold here");
        });
    });

    describe("undo", () => {
        it("undoes the changes made before Vim mode, one at a time", async () => {
            const editor = await createVimEditor(paragraphs("[]ab"), { enabled: false });
            editor.model.change(
                (writer) => writer.insertText("x",
                editor.model.document.selection.getFirstPosition() as never));
            await editor.plugins.get(TriliumVim).setEnabled(true);
            press(editor, "u");
            expect(getLines(editor)).toBe("ab");
        });

        it("puts the lines that J and c joined back in their place after a later deletion",
            async () => {
            const editor = await createVimEditor();
            for (const keys of [ "J", ":1,3j<CR>", "cjx<Esc>", "c2jx<Esc>", "Vjcx<Esc>" ]) {
                setVimData(editor, paragraphs("[]A", "B", "C", "D"));
                press(editor, keys);
                press(editor, "jdduu");
                expect(getLines(editor), keys).toBe("A|B|C|D");
            }
        });

        it("collapses a nested list item again", async () => {
            const collapsed = (text: string, id: string, indent: number) =>
                item(text, id, indent).replace("<paragraph ", "<paragraph listCollapsed=\"true\" ");
            const editor = await createVimEditor("<heading2>H</heading2>" + collapsed("D1", "a", 0)
                + item("D2", "b", 1) + collapsed("D3", "c", 1) + item("D4", "d", 2)
                + paragraphs("D5", "[]D6"));
            const before = getContent(editor);
            press(editor, "d[[");
            expect(getLines(editor)).toBe("D2|D3|D4|D6");
            press(editor, "u");
            expect(getContent(editor)).toBe(before);
        });
    });

    describe("macros", () => {
        it("stop at a motion that fails", async () => {
            const editor = await createVimEditor(paragraphs("[]p1", "p2", "p3", "p4"));
            press(editor, "qbA");
            typeText(editor, "x");
            press(editor, "<Esc>jq3G5@b");
            expect(getLines(editor)).toBe("p1x|p2|p3x|p4x");
            press(editor, "u");
            expect(getLines(editor)).toBe("p1x|p2|p3|p4");
            press(editor, "ggj");
            expect(getCursor(editor)).toBe("1:0");

            setVimData(editor, paragraphs("ab[]c"));
            press(editor, "qchi");
            typeText(editor, "-");
            press(editor, "<Esc>q3@c");
            expect(getLines(editor)).toBe("-a-bc");
            press(editor, "$qdlq");
            expect(getCursor(editor)).toBe("0:4");
        });
    });

    describe("characters of two units", () => {
        it("take an emoji and a letter with an accent as one character", async () => {
            const error = vi.spyOn(console, "error");
            const editor = await createVimEditor(paragraphs("[]a \u{1F604} b"));
            press(editor, "ll~");
            expect(getLines(editor)).toBe("a \u{1F604} b");
            expect(getCursor(editor)).toBe("0:4");
            press(editor, "h");
            expect(getCursor(editor)).toBe("0:2");
            press(editor, "hvly$p");
            expect(getLines(editor)).toBe("a \u{1F604} b \u{1F604}");
            expect(getCursor(editor)).toBe("0:7");
            press(editor, "0f");
            insertText(editor, "\u{1F604}");
            expect(getCursor(editor)).toBe("0:2");
            press(editor, ";");
            expect(getCursor(editor)).toBe("0:7");
            press(editor, "0t");
            insertText(editor, "\u{1F604}");
            expect(getCursor(editor)).toBe("0:1");
            press(editor, "$T");
            insertText(editor, "\u{1F604}");
            expect(getCursor(editor)).toBe("0:4");
            press(editor, "0f");
            insertText(editor, "\u{1F389}");
            press(editor, "dt");
            insertText(editor, "\u{1F389}");
            expect(getCursor(editor)).toBe("0:0");
            expect(getLines(editor)).toBe("a \u{1F604} b \u{1F604}");

            setVimData(editor, paragraphs("[]a\u{1F604} b"));
            press(editor, "lvly$p");
            expect(getLines(editor)).toBe("a\u{1F604} b\u{1F604} ");

            setVimData(editor, paragraphs("caf[]"));
            press(editor, "A");
            typeText(editor, "é");
            press(editor, "<Esc>");
            expect(getCursor(editor)).toBe("0:3");
            press(editor, "hl");
            expect(getCursor(editor)).toBe("0:3");
            press(editor, "x");
            expect(getLines(editor)).toBe("caf");
            expect(error).not.toHaveBeenCalled();
            error.mockRestore();
        });

        it("change the case of a letter with a combining accent as one character", async () => {
            const error = vi.spyOn(console, "error");
            const editor = await createVimEditor(paragraphs("caf[]é x"));
            const selection = editor.model.document.selection;
            press(editor, "~");
            expect(getLines(editor)).toBe("cafÉ x");
            expect(getCursor(editor)).toBe("0:5");
            expect(selection.isCollapsed).toBe(true);
            for (const keys of [ "0g~iw", "0gUiw", "03lvU", ":s/e/E/<CR>" ]) {
                press(editor, "u");
                expect(getLines(editor), keys).toBe("café x");
                press(editor, keys);
                expect(getLines(editor).toUpperCase(), keys).toBe("CAFÉ X");
                expect(getStatus(editor).mode, keys).toBe("normal");
                expect(getStatus(editor).pendingKeys, keys).toBe("");
                expect(selection.isCollapsed, keys).toBe(true);
            }
            expect(error).not.toHaveBeenCalled();
            error.mockRestore();
        });
    });

    describe("the edges of the note", () => {
        it("take the lines up to the edge with a count that passes it, and none without room",
            async () => {
            const error = vi.spyOn(console, "error");
            const lines = [ "first", "second", "third", "fourth", "fifth" ];
            const at = (line: number) => paragraphs(...lines.map((text, index) =>
                index === line ? `[]${text}` : text));
            const editor = await createVimEditor(at(1));
            const selection = editor.model.document.selection;
            press(editor, "d9j");
            expect(getLines(editor)).toBe("first");
            expect(selection.isCollapsed).toBe(true);
            expect(getStatus(editor).pendingKeys).toBe("");
            press(editor, "x");
            expect(getLines(editor)).toBe("irst");

            setVimData(editor, at(1));
            press(editor, "y2kGp");
            expect(getLines(editor)).toBe("first|second|third|fourth|fifth|first|second");
            setVimData(editor, at(3));
            press(editor, "gU2j");
            expect(getLines(editor)).toBe("first|second|third|FOURTH|FIFTH");
            setVimData(editor, at(2));
            press(editor, "4>k");
            expect(getContent(editor))
                .toContain("<paragraph blockIndent=\"40px\">third</paragraph>");

            setVimData(editor, at(0));
            press(editor, "jyykdkd2kckgUkykp");
            expect(getLines(editor)).toBe("first|second|second|third|fourth|fifth");
            expect(getStatus(editor).mode).toBe("normal");
            setVimData(editor, at(4));
            press(editor, "kyyjdjcjgUjyjp");
            expect(getLines(editor)).toBe("first|second|third|fourth|fifth|fourth");
            expect(getStatus(editor).mode).toBe("normal");
            expect(error).not.toHaveBeenCalled();
            error.mockRestore();
        });

        it("delete to the end of the note with ) on the last sentence", async () => {
            const editor = await createVimEditor(paragraphs("One. []Two end."));
            press(editor, "d)");
            expect(getLines(editor)).toBe("One. ");
            for (const [ text, keys, expected ] of [
                [ "[]One. Two end.", ")", "One. Two end." ],
                [ "[]One. Two end.", "d)", "Two end." ],
                [ "One. Two end[].", "d)", "One. Two end" ],
                [ "One. []X", "d)", "One. " ]
            ]) {
                setVimData(editor, paragraphs(text));
                press(editor, keys);
                expect(getLines(editor), `${text} ${keys}`).toBe(expected);
            }
            setVimData(editor, paragraphs("[]One. Two", "x"));
            press(editor, "d)");
            expect(getLines(editor)).toBe("Two|x");
            setVimData(editor, paragraphs("a[]b", "cd"));
            press(editor, "d/cd<CR>");
            expect(getLines(editor)).toBe("a|cd");
        });
    });

    describe("bad input", () => {
        it("lets typing take the formatting of the text after `A` left a link", async () => {
            const editor = await createVimEditor("<paragraph>[]Read the "
                + "<$text linkHref=\"https://example.com\">handbook</$text></paragraph>"
                + "<paragraph>Some text with a <$text bold=\"true\">bold word</$text></paragraph>");
            press(editor, "A");
            typeText(editor, "x");
            press(editor, "<Esc>");
            expect(editor.model.document.selection.isGravityOverridden).toBe(false);
            press(editor, "j$ciw");
            typeText(editor, "xyz");
            press(editor, "<Esc>");
            expect(getContent(editor)).toBe("<paragraph>Read the "
                + "<$text linkHref=\"https://example.com\">handbook</$text>x</paragraph>"
                + "<paragraph>Some text with a <$text bold=\"true\">bold xyz</$text></paragraph>");

            setVimData(editor, "<paragraph>[]a <$text linkHref=\"x\">b</$text></paragraph>");
            press(editor, "A");
            expect(editor.model.document.selection.isGravityOverridden).toBe(true);
            await editor.plugins.get(TriliumVim).setEnabled(false);
            expect(editor.model.document.selection.isGravityOverridden).toBe(false);
        });

        it("count numbers that start with 0 in tens and keep their width", async () => {
            const editor = await createVimEditor();
            for (const [ text, keys, expected, cursor ] of [
                [ "date 2026-[]08-09", "<C-a>", "date 2026-07-09", "0:11" ],
                [ "date 2026-08-[]09", "<C-x>", "date 2026-08-10", "0:14" ],
                [ "[]C08 level", "<C-a>", "C09 level", "0:2" ],
                [ "[]007", "<C-a>", "008", "0:2" ],
                [ "[]099", "<C-a>", "100", "0:2" ],
                [ "[]-1", "<C-a>", "0", "0:0" ],
                [ "[]9", "3<C-x>", "6", "0:0" ],
                [ "[]0x0f", "<C-a>", "0x10", "0:3" ],
                [ "[]0x1E", "<C-a>", "0x1F", "0:3" ],
                [ "[]-0x10", "<C-a>", "-0x11", "0:4" ],
                [ "[]0b101", "<C-a>", "0b110", "0:4" ],
                [ "no number[]", "<C-a>", "no number", "0:8" ]
            ]) {
                setVimData(editor, paragraphs(text));
                press(editor, keys);
                expect(getLines(editor), text).toBe(expected);
                expect(getCursor(editor), text).toBe(cursor);
            }
        });

        it("do nothing for `@@` before any macro, and stop a macro that calls itself",
            async () => {
            const error = vi.spyOn(console, "error");
            const editor = await createVimEditor(paragraphs("[]abc"));
            engine().getVimGlobalState_().macroModeState.latestRegister = undefined;
            press(editor, "x@@");
            expect(getLines(editor)).toBe("bc");
            press(editor, "qaqqa@aq@a");
            expect(getLines(editor)).toBe("bc");
            expect(getStatus(editor).message?.text).toBe("The macro called itself too many times");
            press(editor, "\"byl@b");
            expect(getStatus(editor).mode).toBe("normal");
            setVimData(editor, paragraphs("[]ix"));
            press(editor, "yiw0@0");
            expect(getLines(editor)).toBe("x");
            expect(getStatus(editor).mode).toBe("normal");
            setVimData(editor, paragraphs("[]ab", "ab"));
            press(editor, ":s/a/A/<CR>j@:");
            expect(getLines(editor)).toBe("Ab|Ab");
            press(editor, "qcqqc@cjq@c");
            expect(getLines(editor)).toBe("Ab|Ab");
            expect(getStatus(editor).message?.text).toBe("The macro called itself too many times");
            expect(error).not.toHaveBeenCalled();
            error.mockRestore();
        });

        it("answer patterns and commands that are empty or wrong with a message", async () => {
            const error = vi.spyOn(console, "error");
            const editor = await createVimEditor(paragraphs("zzz", "[]a(b"));
            const message = () => getStatus(editor).message?.text;
            (engine().getVimGlobalState_() as { query?: RegExp }).query = undefined;
            press(editor, ":s/(/x/<CR>");
            expect(message()).toBe("Invalid regex: (");
            press(editor, ":s//x/<CR>");
            expect(message()).toBe("No previous regular expression");
            press(editor, ":g/<CR>");
            expect(message()).toBe("No previous regular expression");
            press(editor, ":normal<CR>");
            expect(message()).toBe("Argument required");
            expect(getLines(editor)).toBe("zzz|a(b");
            press(editor, ":?zzz?d<CR>");
            expect(getLines(editor)).toBe("a(b");
            expect(error).not.toHaveBeenCalled();
            error.mockRestore();
        });

        it("swap a backward range, take line 0 for the first line and refuse lines past the note",
            async () => {
            const editor = await createVimEditor(
                paragraphs("one", "two", "[]three", "four", "five", "six"));
            const message = () => getStatus(editor).message?.text;
            for (const [ command, expected ] of [
                [ ":5,3d", "one|two|six" ],
                [ ":0d", "two|three|four|five|six" ],
                [ ":0,2d", "three|four|five|six" ],
                [ ":3,1j", "one two three|four|five|six" ],
                [ ":3<CR>:j", "one|two|three four|five|six" ],
                [ ":2,2j", "one|two|three|four|five|six" ],
                [ ":3,2y<CR>Gp", "one|two|three|four|five|six|two|three" ]
            ]) {
                press(editor, `${command}<CR>`);
                expect(getLines(editor), command).toBe(expected);
                press(editor, "u");
                expect(getLines(editor), command).toBe("one|two|three|four|five|six");
            }
            for (const command of [ ":.,$-9d", ":2,99d", ":.,.+99999d" ]) {
                press(editor, `${command}<CR>`);
                expect(message(), command).toBe("Invalid range");
            }
            press(editor, ":%s/e/E/ x<CR>");
            expect(message()).toBe("Trailing characters: x");
            expect(getLines(editor)).toBe("one|two|three|four|five|six");
            press(editor, ":99<CR>");
            expect(getCursor(editor)).toBe("5:0");
            press(editor, ":0<CR>");
            expect(getCursor(editor)).toBe("0:0");
        });

        it("repeat a counted insert after typing that autoformat changed", async () => {
            const error = vi.spyOn(console, "error");
            const editor = await createVimEditor(paragraphs("[]a"), {}, [ Autoformat ]);
            const bold = "<paragraph><$text bold=\"true\">bold</$text></paragraph>";
            for (const keys of [ "3O", "2o" ]) {
                setVimData(editor, paragraphs("[]a"));
                press(editor, keys);
                typeText(editor, "**bold**");
                press(editor, "<Esc>");
                expect(getStatus(editor).mode, keys).toBe("normal");
                const count = Number(keys[0]);
                expect(getContent(editor), keys).toBe(keys.endsWith("O")
                    ? bold.repeat(count) + paragraphs("a")
                    : paragraphs("a") + bold.repeat(count));
            }
            expect(error).not.toHaveBeenCalled();
            error.mockRestore();
        });

        it("change nothing in a read-only editor", async () => {
            const editor = await createVimEditor(paragraphs("[]ab", "cd"));
            editor.enableReadOnlyMode("spec");
            for (const keys of [ "yyp", "yyP", "ylp", "xp", ":s/a/x/<CR>", ":%s/c/y/g<CR>" ]) {
                press(editor, keys);
                expect(getLines(editor), keys).toBe("ab|cd");
            }
            editor.disableReadOnlyMode("spec");
        });
    });
});

/** Types `text` as an input method does, which Vim takes as keys outside Insert mode. */
function insertText(editor: Editor, text: string) {
    const view = editor.editing.view;
    view.document.fire("insertText",
        new ViewDocumentDomEventData(view, new Event("beforeinput"), { text }));
}

declare module "ckeditor5" {
    interface EditorConfig {
        mention?: Record<string, unknown>;
    }
}

export type { Editor };
