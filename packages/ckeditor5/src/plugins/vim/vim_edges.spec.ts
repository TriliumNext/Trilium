import type { Vim } from "@replit/codemirror-vim-core";
import {
    type Editor, Enter, ImageBlock, MentionEditing, MutationObserver as ViewMutationObserver,
    Paragraph, Plugin, ShiftEnter, Typing, ViewDocumentDomEventData
} from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import {
    createVimEditor, getAdapter, getContent, getCursor, getLines, getStatus, item, paragraphs,
    press, typeText
} from "../../../test/vim-kit.js";
import ContentEmbed from "../content_embed/content_embed.js";
import ContentEmbedCaret from "../content_embed/content_embed_caret.js";
import FindReveal from "../find_reveal.js";
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

        it("ignores modifier keys alone, passes unknown Ctrl keys and swallows Ctrl+Backspace",
            async () => {
            const editor = await createVimEditor(paragraphs("[]ab cd"));
            expect(press(editor, "<Shift>")).toBe(false);
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
            editor.enableReadOnlyMode("spec");
            press(editor, "r<CR>");
            expect(getLines(editor)).toBe("xcab|x");
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

        it("put lines next to a widget, before code lines and nowhere in a tab title", async () => {
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
            expect(getLines(editor)).toBe("x||x||\u{FFFC}|x||x||c|T|p");
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
    });
});

declare module "ckeditor5" {
    interface EditorConfig {
        mention?: Record<string, unknown>;
    }
}

export type { Editor };
