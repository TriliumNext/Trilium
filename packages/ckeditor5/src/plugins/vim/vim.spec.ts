import type { Vim } from "@replit/codemirror-vim-core";
import {
    _setModelData as setModelData, type Editor, env, ImageBlock, Paragraph, Plugin,
    ViewDocumentDomEventData
} from "ckeditor5";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { createTestEditor } from "../../../test/editor-kit.js";
import { createLinkEmbedHost } from "../../../test/link-embed-kit.js";
import {
    aside, createVimEditor, getAdapter, getContent, getCursor, getLines, getStatus, item,
    paragraphs, press, setVimData, typeText
} from "../../../test/vim-kit.js";
import HostedBalloon from "../../hosted_balloon.js";
import ContentEmbed from "../content_embed/content_embed.js";
import LinkEmbed from "../link_embed/link_embed.js";
import ReferenceLink from "../referencelink.js";
import TriliumVim, { getLinkUnderCursor } from "./vim.js";
import { getLoadedVimEngine } from "./vim_engine.js";

function getRoot(editor: Editor) {
    return editor.editing.view.getDomRoot() as HTMLElement;
}

function getMarkers(editor: Editor) {
    return [ ...editor.model.markers ].map((marker) => marker.name).filter(
        (name) => name.startsWith("vimCursor"));
}

/** Pastes `data`, by type, in the editing root, as `Ctrl+V` does. */
function paste(editor: Editor, data: Record<string, string>) {
    const clipboardData = new DataTransfer();
    for (const [ type, value ] of Object.entries(data)) {
        clipboardData.setData(type, value);
    }
    getRoot(editor).dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
}

/** Presses `Ctrl` with `key` in `target`. Returns whether a listener took the key. */
function pressCtrl(target: Element, key: string): boolean {
    const event = new KeyboardEvent("keydown",
        { key, ctrlKey: true, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
}

function wait(milliseconds: number) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe("Vim mode", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    describe("keys in Normal mode", () => {
        it("never type, and keep the keys of the app", async () => {
            const editor = await createVimEditor(paragraphs("[]ab", "c"));
            expect(press(editor, "Q")).toBe(true);
            expect(press(editor, "<Tab>")).toBe(true);
            expect(getLines(editor)).toBe("ab|c");
            expect(press(editor, "<A-x>")).toBe(false);
            expect(press(editor, "<M-x>")).toBe(false);
            expect(press(editor, "<F2>")).toBe(false);
            expect(press(editor, "<C-v>")).toBe(false);
            expect(press(editor, "<C-q>")).toBe(false);
            press(editor, "<Del>");
            expect(getLines(editor)).toBe("b|c");
            press(editor, "<CR>");
            expect(getCursor(editor)).toBe("1:0");
        });

        it("take typed text from an input method as keys", async () => {
            const editor = await createVimEditor(paragraphs("[]ab"));
            const view = editor.editing.view;
            const data = new ViewDocumentDomEventData(view, new Event("beforeinput"),
                { text: "x" });
            view.document.fire("insertText", data);
            expect(getLines(editor)).toBe("b");
            view.document.fire("insertText",
                new ViewDocumentDomEventData(view, new Event("beforeinput"), { text: "xy" }));
            expect(getLines(editor)).toBe("b");
        });

        it("undo with Ctrl+Z and redo with Ctrl+Shift+Z, and Cmd on macOS", async () => {
            const editor = await createVimEditor(paragraphs("[]abc"));
            press(editor, "x");
            press(editor, "<C-z>");
            expect(getLines(editor)).toBe("abc");
            press(editor, "<C-S-z>");
            expect(getLines(editor)).toBe("bc");
            press(editor, "vl<C-z>");
            expect(getStatus(editor).mode).toBe("normal");
            expect(getLines(editor)).toBe("abc");
            press(editor, "vl<C-S-Z>");
            expect(getLines(editor)).toBe("bc");

            const isMac = env.isMac;
            env.isMac = true;
            try {
                press(editor, "<M-z>");
                expect(getLines(editor)).toBe("abc");
                press(editor, "<M-S-z>");
                expect(getLines(editor)).toBe("bc");
                expect(press(editor, "<M-C-z>")).toBe(false);
            } finally {
                env.isMac = isMac;
            }
        });

        it("escape with Ctrl+[ and Ctrl+C, and copy with Ctrl+C in Visual mode", async () => {
            const editor = await createVimEditor(paragraphs("[]abc"));
            press(editor, "d<C-[>x");
            expect(getLines(editor)).toBe("bc");
            press(editor, "d<C-c>");
            expect(getStatus(editor).pendingKeys).toBe("");
            press(editor, "vl");
            expect(press(editor, "<C-c>")).toBe(false);
            const copy = () => new ClipboardEvent("copy",
                { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
            getRoot(editor).dispatchEvent(copy());
            await vi.waitFor(() => expect(getStatus(editor).mode).toBe("normal"));
            getRoot(editor).dispatchEvent(copy());
        });

        it("paste where the cursor is, and leave it on the last character pasted", async () => {
            const editor = await createVimEditor(paragraphs("[]abc def ghi", "x"));
            press(editor, "w");
            paste(editor, { "text/plain": "PASTED" });
            expect(getLines(editor)).toBe("abc PASTEDdef ghi|x");
            expect(getStatus(editor).mode).toBe("normal");
            expect(getCursor(editor)).toBe("0:9");
            press(editor, "x");
            expect(getLines(editor)).toBe("abc PASTEdef ghi|x");

            press(editor, "j");
            paste(editor, { "text/html": "<table><tr><td>t1</td><td>t2</td></tr></table>" });
            expect(getLines(editor)).toBe("abc PASTEdef ghi|t1|t2|x");
            expect(getStatus(editor).mode).toBe("normal");
            expect(editor.model.document.selection.isCollapsed).toBe(true);
            expect(getCursor(editor)).toBe("2:1");

            press(editor, "ggvl");
            paste(editor, { "text/plain": "Z" });
            expect(getLines(editor)).toBe("Zc PASTEdef ghi|t1|t2|x");
            expect(getStatus(editor).mode).toBe("normal");
            expect(getCursor(editor)).toBe("0:0");

            press(editor, "i");
            paste(editor, { "text/plain": "Y" });
            expect(getStatus(editor).mode).toBe("insert");
            expect(getLines(editor)).toBe("YZc PASTEdef ghi|t1|t2|x");
        });

        it("keep the editor working after a search, an append and a counted motion", async () => {
            const error = vi.spyOn(console, "error");
            const editor = await createVimEditor(paragraphs("[]d e f"));
            editor.editing.view.focus();
            await userEvent.keyboard("/e{Enter}");
            await wait(50);
            await userEvent.keyboard("Axyz");
            // The highlights of the search follow the typing once it pauses.
            await wait(200);
            await userEvent.keyboard("{Escape}0");
            await wait(50);
            await userEvent.keyboard("4lx");
            expect(getLines(editor)).toBe("d e xyz");
            expect(error).not.toHaveBeenCalled();
            error.mockRestore();
        });
    });

    describe("keys in Insert mode", () => {
        it("follow Vim for seven Ctrl keys and leave the others to the editor", async () => {
            const editor = await createVimEditor(item("one", "a") + item("[]two three", "b"));
            press(editor, "A");
            press(editor, "<C-w>");
            expect(getLines(editor)).toBe("one|two ");
            expect(press(editor, "<C-p>")).toBe(true);
            expect(press(editor, "<C-n>")).toBe(true);
            expect(press(editor, "<C-g>")).toBe(false);
            expect(press(editor, "<C-u>")).toBe(false);
            expect(press(editor, "<C-e>")).toBe(false);
            press(editor, "<C-t>");
            expect(getContent(editor)).toContain(item("two ", "b", 1));
            press(editor, "<C-d>");
            expect(getContent(editor)).toContain(item("two ", "b"));
            press(editor, "<C-o>");
            expect(getStatus(editor).isOneCommand).toBe(true);
            press(editor, "0");
            expect(getStatus(editor).mode).toBe("insert");
            expect(getCursor(editor)).toBe("1:0");
            press(editor, "<Esc>yiw$a");
            press(editor, "<C-r>\"");
            expect(getLines(editor)).toBe("one|two two");
            press(editor, "<C-[>");
            expect(getStatus(editor).mode).toBe("normal");
            press(editor, "a<C-c>");
            expect(getStatus(editor).mode).toBe("normal");
        });

        it("close a balloon of the editor with Ctrl+[, and with Ctrl+C when nothing is selected",
            async () => {
            const editor = await createVimEditor(paragraphs("[]abc"));
            const hosted = new HostedBalloon(editor, "vim-spec-balloon");
            const open = <T extends HTMLElement>(tagName: string) => {
                const field = document.createElement(tagName) as T;
                hosted.show((container) => {
                    container.append(field);
                    return () => field.remove();
                });
                field.focus();
                return field;
            };
            const isOpen = () => !!document.querySelector(".vim-spec-balloon");
            editor.editing.view.focus();
            press(editor, "A");

            const input = open<HTMLInputElement>("input");
            expect(pressCtrl(input, "[")).toBe(true);
            expect(isOpen()).toBe(false);
            expect(document.activeElement).toBe(getRoot(editor));
            expect(getStatus(editor).mode).toBe("insert");

            const selected = open<HTMLInputElement>("input");
            selected.value = "https://";
            selected.select();
            expect(pressCtrl(selected, "c")).toBe(false);
            expect(pressCtrl(selected, "x")).toBe(false);
            expect(isOpen()).toBe(true);
            selected.setSelectionRange(8, 8);
            expect(pressCtrl(selected, "c")).toBe(true);
            expect(isOpen()).toBe(false);

            const button = open<HTMLButtonElement>("button");
            expect(pressCtrl(button, "c")).toBe(true);
            expect(isOpen()).toBe(false);
            expect(pressCtrl(button, "[")).toBe(false);
            expect(pressCtrl(document.body, "[")).toBe(false);
            expect(pressCtrl(editor.ui.view.body.bodyCollectionContainer, "[")).toBe(false);
        });

        it("follow Vim for the insert keys when they are on", async () => {
            const editor = await createVimEditor(paragraphs("[]abc", "", "xyz"),
                { isInsertKeysEnabled: () => true });
            press(editor, "jA");
            press(editor, "<C-e><C-y><C-e>");
            typeText(editor, "Q");
            expect(getLines(editor)).toBe("abc|xbzQ|xyz");
            press(editor, "<Esc>A<C-a>");
            expect(getLines(editor)).toBe("abc|xbzQxbzQ|xyz");
            press(editor, "<C-u>");
            expect(getLines(editor)).toBe("abc||xyz");
            press(editor, "<C-v><Tab><C-v>Z<C-v><Esc>");
            expect(getLines(editor)).toBe("abc|\tZ|xyz");
            press(editor, "<C-k>a:<C-k>a*<C-k>:a<C-k>a#<C-k><Esc>");
            expect(getLines(editor)).toBe("abc|\tZ\u{E4}\u{3B1}\u{E4}#|xyz");
            press(editor, "<C-k>");
            expect(press(editor, "<Left>")).toBe(false);
            press(editor, "a!");
            expect(getLines(editor)).toBe("abc|\tZ\u{E4}\u{3B1}\u{E4}#\u{E0}|xyz");
            press(editor, "<Esc>kA<C-y><C-e>");
            expect(getLines(editor)).toBe("abc\u{3B1}|\tZ\u{E4}\u{3B1}\u{E4}#\u{E0}|xyz");
        });

        it("go back to Insert mode with Escape after Ctrl+O", async () => {
            const editor = await createVimEditor(paragraphs("[]hello"));
            press(editor, "A<C-o>");
            expect(getStatus(editor)).toMatchObject({ mode: "normal", isOneCommand: true });
            press(editor, "<Esc>");
            expect(getStatus(editor)).toMatchObject({ mode: "insert", isOneCommand: false });
            typeText(editor, "X");
            expect(getLines(editor)).toBe("helloX");
        });

        it("restore what Replace mode wrote over with Backspace", async () => {
            const editor = await createVimEditor(paragraphs("[]abc"));
            press(editor, "R");
            expect(getStatus(editor).mode).toBe("replace");
            press(editor, "xy<BS><BS><BS>z");
            expect(getLines(editor)).toBe("zbc");
            press(editor, "<Left><BS>");
            expect(getCursor(editor)).toBe("0:0");
            press(editor, "<Esc>");
            expect(getStatus(editor).mode).toBe("normal");
        });
    });

    describe("the status", () => {
        it("tells the mode, the keys typed and the macro being recorded", async () => {
            const editor = await createVimEditor(paragraphs("[]a", "b"));
            expect(getStatus(editor)).toMatchObject(
                { mode: "normal", pendingKeys: "", recording: null });
            press(editor, "\"a2d");
            expect(getStatus(editor).pendingKeys).toBe("\"a2d");
            press(editor, "<Esc>");
            expect(getStatus(editor).pendingKeys).toBe("");
            press(editor, "v");
            expect(getStatus(editor).mode).toBe("visual");
            press(editor, "V");
            expect(getStatus(editor).mode).toBe("visual-line");
            press(editor, "<Esc>qa");
            expect(getStatus(editor).recording).toBe("a");
            press(editor, "xq");
            expect(getStatus(editor).recording).toBeNull();
            press(editor, "j@a");
            expect(getLines(editor)).toBe("|");
            press(editor, "2:");
            expect(getStatus(editor).pendingKeys).toBe("");
            press(editor, "<Esc>/");
            expect(getStatus(editor).pendingKeys).toBe("");
            press(editor, "<CR>");
            expect(getStatus(editor).pendingKeys).toBe("");
        });

        it("shows messages for a while, and long ones until the next key", async () => {
            vi.useFakeTimers();
            const editor = await createVimEditor(paragraphs("[]a"));
            press(editor, ":ZZZ<CR>");
            expect(getStatus(editor).message?.text).toContain("ZZZ");
            expect(getStatus(editor).message?.isLong).toBe(false);
            vi.advanceTimersByTime(20000);
            expect(getStatus(editor).message).toBeNull();
            press(editor, ":registers<CR>");
            expect(getStatus(editor).message?.isLong).toBe(true);
            expect(getStatus(editor).message?.text).toContain("\n");
            press(editor, "l");
            expect(getStatus(editor).message).toBeNull();
        });

        it("marks the character of the cursor outside Insert mode", async () => {
            const editor = await createVimEditor(paragraphs("[]ab", ""));
            expect(getMarkers(editor)).toEqual([ "vimCursor" ]);
            expect(getRoot(editor).classList.contains("ck-vim-command-mode")).toBe(true);
            press(editor, "j");
            expect(getMarkers(editor)).toEqual([ "vimCursorEmpty" ]);
            press(editor, "i");
            expect(getMarkers(editor)).toEqual([]);
            expect(getRoot(editor).classList.contains("ck-vim-command-mode")).toBe(false);
            press(editor, "<Esc>k");
            expect(getMarkers(editor)).toEqual([ "vimCursor" ]);
        });

        it("marks the whole character of the cursor", async () => {
            const editor = await createVimEditor(paragraphs("[]\u{1F604}a"));
            const range = editor.model.markers.get("vimCursor")?.getRange();
            expect([ range?.start.offset, range?.end.offset ]).toEqual([ 0, 2 ]);
        });

        it("puts a cursor that a click left past the end of a line on its last character",
            async () => {
            const editor = await createVimEditor(paragraphs("[]ab"));
            const block = editor.model.document.getRoot()?.getChild(0);
            editor.model.change((writer) => writer.setSelection(block as never, "end"));
            expect(getCursor(editor)).toBe("0:1");
            editor.model.change((writer) => writer.setSelection(writer.createRange(
                writer.createPositionAt(block as never, 0),
                    writer.createPositionAt(block as never, 2))));
            expect(getStatus(editor).mode).toBe("visual");
        });
    });

    describe("the command line", () => {
        it("opens under the editor without a host, and closes on Escape and on blur", async () => {
            const editor = await createVimEditor(paragraphs("[]a"));
            press(editor, ":");
            const commandLine = getStatus(editor).commandLine;
            expect(
                commandLine?.element.querySelector(
                ".ck-vim-command-line__prefix")?.textContent).toBe(":");
            expect(document.querySelector(".ck-vim-command-line-panel")).not.toBeNull();
            press(editor, "<Esc>");
            expect(getStatus(editor).commandLine).toBeNull();
            expect(document.querySelector(".ck-vim-command-line-panel")).toBeNull();

            press(editor, ":");
            const input = getStatus(editor).commandLine?.element.querySelector("input");
            input?.blur();
            await vi.waitFor(() => expect(getStatus(editor).commandLine).toBeNull());
        });

        it("opens in the place that the host gives it", async () => {
            const slot = document.createElement("div");
            document.body.append(slot);
            const mountCommandLine = vi.fn((element: HTMLElement) => {
                slot.append(element);
                return true;
            });
            const editor = await createVimEditor(paragraphs("[]a"), { host: { mountCommandLine } });
            press(editor, "/");
            expect(mountCommandLine).toHaveBeenCalledWith(expect.any(HTMLElement), editor);
            expect(slot.querySelector(".ck-vim-command-line")).not.toBeNull();
            getStatus(editor).commandLine?.focus();
            press(editor, ":");
            expect(slot.querySelectorAll(".ck-vim-command-line")).toHaveLength(1);
            press(editor, "<C-u>");
            expect(getStatus(editor).commandLine?.element.querySelector("input")?.value).toBe("");
            press(editor, "<Esc>");
            expect(slot.querySelector(".ck-vim-command-line")).toBeNull();
            slot.remove();
        });

        it("completes an operator with a search, and closes", async () => {
            const error = vi.spyOn(console, "error");
            const editor = await createVimEditor(paragraphs("[]alpha beta gamma delta"));
            press(editor, "yw");
            press(editor, "d/gamma<CR>");
            expect(getLines(editor)).toBe("gamma delta");
            expect(getStatus(editor).commandLine).toBeNull();
            press(editor, "P");
            expect(getLines(editor)).toBe("alpha beta gamma delta");

            press(editor, "0y/gamma<CR>");
            expect(getStatus(editor)).toMatchObject({ mode: "normal", commandLine: null });
            expect(editor.model.document.selection.isCollapsed).toBe(true);
            press(editor, "$p");
            expect(getLines(editor)).toBe("alpha beta gamma deltaalpha beta ");

            press(editor, "u0c/gamma<CR>");
            expect(getStatus(editor)).toMatchObject({ mode: "insert", commandLine: null });
            typeText(editor, "X ");
            press(editor, "<Esc>$d?gamma<CR>");
            expect(getLines(editor)).toBe("X a");
            expect(error).not.toHaveBeenCalled();
            error.mockRestore();
        });

        it("scrolls to the cursor after a search or a line number, at once", async () => {
            const texts = Array.from({ length: 100 }, (_, index) => `line ${index}`);
            const editor = await createVimEditor(paragraphs(`[]${texts[0]}`, ...texts.slice(1)));
            const scroller = document.createElement("div");
            scroller.style.cssText = "height: 200px; overflow: auto; scroll-behavior: smooth";
            document.body.append(scroller);
            scroller.append(editor.ui.element as HTMLElement);
            try {
                press(editor, "/line 90<CR>");
                expect(getCursor(editor)).toBe("90:0");
                expect(scroller.scrollTop).toBeGreaterThan(1000);
                press(editor, "gg");
                expect(scroller.scrollTop).toBeLessThan(100);
                press(editor, ":50<CR>");
                expect(getCursor(editor)).toBe("49:0");
                expect(scroller.scrollTop).toBeGreaterThan(500);
                expect(scroller.style.scrollBehavior).toBe("smooth");
            } finally {
                scroller.remove();
            }
        });

        it("leaves the cursor on a character after an Ex command", async () => {
            const editor = await createVimEditor(paragraphs("[]one two", "three four", "five six"));
            press(editor, ":1,3normal Ax<CR>");
            expect(getLines(editor)).toBe("one twox|three fourx|five sixx");
            expect(getCursor(editor)).toBe("2:8");
            press(editor, "u:1,3s/ /\\n/g<CR>");
            expect(getLines(editor)).toBe("one|two|three|four|five|six");
            const [ line, ch ] = getCursor(editor).split(":").map(Number);
            expect(ch).toBeLessThan(getAdapter(editor).getLine(line).length);
        });

        it("runs the commands of Trilium through the host", async () => {
            const host = { save: vi.fn(), closeTab: vi.fn(() => true), followLink: vi.fn() };
            const editor = await createVimEditor(paragraphs("[]a"), { host });
            press(editor, ":w<CR>:q<CR>:wq<CR>:x<CR>ZZgf");
            expect(host.save).toHaveBeenCalledTimes(1);
            expect(host.closeTab).toHaveBeenCalledTimes(4);
            expect(host.followLink).toHaveBeenCalledTimes(1);
            press(editor, ":q!<CR>");
            expect(getStatus(editor).message?.text).toBe(
                "Nothing to discard: notes are saved as you type");
            press(editor, "<Esc>ZQ");
            expect(getStatus(editor).message?.text).toBe(
                "Nothing to discard: notes are saved as you type");
            host.closeTab.mockReturnValue(false);
            press(editor, ":q<CR>");
            expect(getStatus(editor).message?.text).toBe("This tab cannot be closed");

            const alone = await createVimEditor(paragraphs("[]a"));
            press(alone, ":w<CR>gf:q<CR>");
            expect(getStatus(alone).message?.text).toBe("This tab cannot be closed");
        });

        it("runs editor commands with :ck", async () => {
            const editor = await createVimEditor(paragraphs("[]abc", "de", "f"));
            press(editor, "lvl:ck bold<CR>");
            expect(getContent(editor)).toBe(
                "<paragraph>a<$text bold=\"true\">bc</$text></paragraph>" + paragraphs("de", "f"));
            expect(getCursor(editor)).toBe("0:1");
            press(editor, "jVj:ck italic<CR>");
            expect(getContent(editor)).toContain(
                "<paragraph><$text italic=\"true\">de</$text></paragraph>"
                + "<paragraph><$text italic=\"true\">f</$text></paragraph>");
            press(editor, "gg:2,3ck bold<CR>");
            expect(getContent(editor)).toContain("<$text bold=\"true\" italic=\"true\">de</$text>");
            press(editor, ":ck heading heading2<CR>");
            expect(getContent(editor)).toContain("<heading2>");
            press(editor, ":ck<CR>");
            expect(getStatus(editor).message?.text).toBe(
                "Type the name of an editor command after :ck");
            press(editor, ":ck nothing<CR>");
            expect(getStatus(editor).message?.text).toBe("Not an editor command: nothing");
            editor.commands.get("bold")?.forceDisabled("spec");
            press(editor, ":ck bold<CR>");
            expect(getStatus(editor).message?.text).toBe(
                "The editor command bold is not available here");
        });

        it("keeps the keys of Trilium after :mapclear", async () => {
            const editor = await createVimEditor(paragraphs("[]a") + "<heading2>H</heading2>");
            for (
                const command of [ "mapclear", "nmapclear", "vmapclear", "imapclear",
                "omapclear" ]) {
                press(editor, `:${command}<CR>gg]]`);
                expect(getCursor(editor)).toBe("1:0");
            }
        });
    });

    describe("startup commands", () => {
        it("run when Vim mode starts, and again after they changed", async () => {
            let commands = "\" a comment\n:imap jj <Esc>\n\nnmap Q dd\nfailing";
            const engine = getLoadedVimEngine() as Vim;
            const handleEx = engine.handleEx.bind(engine);
            vi.spyOn(engine, "handleEx").mockImplementation((cm, input) => {
                if (input === "failing") {
                    throw new Error("failing");
                }
                handleEx(cm, input);
            });
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const editor = await createVimEditor(paragraphs("[]a", "b"),
                { getStartupCommands: () => commands });
            expect(warn).toHaveBeenCalled();
            vi.mocked(engine.handleEx).mockRestore();
            press(editor, "Q");
            expect(getLines(editor)).toBe("b");
            press(editor, "ijj");
            expect(getStatus(editor).mode).toBe("normal");

            commands = "nmap Q x";
            editor.plugins.get(TriliumVim).refreshStartupCommands();
            press(editor, "Q");
            expect(getLines(editor)).toBe("");
            press(editor, "ijj");
            expect(getStatus(editor).mode).toBe("insert");
            commands = "";
            editor.plugins.get(TriliumVim).refreshStartupCommands();
            warn.mockRestore();
        });
    });

    describe("turning Vim mode on and off", () => {
        it("keeps the content, and starts in the mode asked for", async () => {
            const editor = await createVimEditor(paragraphs("[]abc"));
            const plugin = editor.plugins.get(TriliumVim);
            press(editor, "lv");
            await plugin.setEnabled(false);
            expect(getStatus(editor).mode).toBeNull();
            expect(getMarkers(editor)).toEqual([]);
            expect(plugin.isActive).toBe(false);
            await plugin.setEnabled(true, "insert");
            expect(getStatus(editor).mode).toBe("insert");
            await plugin.setEnabled(true);
            expect(getStatus(editor).mode).toBe("insert");
            press(editor, ":");
            await plugin.setEnabled(false);
            expect(getStatus(editor).commandLine).toBeNull();
            await plugin.setEnabled(true);
            press(editor, "v");
            plugin.enterInsertMode();
            expect(getStatus(editor).mode).toBe("insert");
            plugin.enterInsertMode();
            await plugin.setEnabled(false);
            plugin.enterInsertMode();
            plugin.refreshStartupCommands();
            expect(getStatus(editor).mode).toBeNull();

            await plugin.setEnabled(true);
            const modes: unknown[] = [];
            plugin.on("change:status", () => modes.push(plugin.status.mode));
            plugin.destroy();
            expect(modes).toEqual([ null ]);
        });

        it("starts in the mode of the last request", async () => {
            /** Asks for Insert mode while the editor starts, after the configuration asked. */
            class InsertModeRequest extends Plugin {
                init() {
                    void this.editor.plugins.get(TriliumVim).setEnabled(true, "insert");
                }
            }
            const editor = await createVimEditor(paragraphs("[]a"), {}, [ InsertModeRequest ]);
            expect(getStatus(editor).mode).toBe("insert");
        });

        it("starts with the editor when the configuration turns it on", async () => {
            const editor = await createVimEditor(paragraphs("[]a"), { enabled: false });
            expect(editor.plugins.get(TriliumVim).isActive).toBe(false);
            expect(getStatus(editor).mode).toBeNull();
        });

        it("does nothing on a read-only editor", async () => {
            const editor = await createVimEditor(paragraphs("[]abc"));
            editor.enableReadOnlyMode("spec");
            press(editor, "xo");
            expect(getLines(editor)).toBe("abc");
            expect(getStatus(editor).mode).toBe("normal");
        });
    });

    describe("undo", () => {
        it("undoes a change with its typing, an Insert session and a macro run as one step",
            async () => {
            const editor = await createVimEditor(paragraphs("[]one two three"));
            press(editor, "cw");
            typeText(editor, "ONE");
            press(editor, "<Esc>");
            press(editor, "A");
            typeText(editor, " four five");
            press(editor, "<Esc>");
            press(editor, "0qqxxq@q");
            expect(getLines(editor)).toBe("two three four five");
            press(editor, "u");
            expect(getLines(editor)).toBe("E two three four five");
            press(editor, "uu");
            expect(getLines(editor)).toBe("ONE two three four five");
            press(editor, "u");
            expect(getLines(editor)).toBe("ONE two three");
            press(editor, "u");
            expect(getLines(editor)).toBe("one two three");
            press(editor, "<C-r>");
            expect(getLines(editor)).toBe("ONE two three");
            press(editor, "u");
            expect(getLines(editor)).toBe("one two three");
        });

        it("redoes a change in Normal mode, with the cursor on the changed line", async () => {
            for (const keys of [ ">>", "gUU", "V>", "VU", "cc<Esc>", "S<Esc>", "cw<Esc>" ]) {
                const editor = await createVimEditor(
                    paragraphs("alpha one", "[]beta two", "gamma three"));
                press(editor, `${keys}u<C-r>`);
                expect(getStatus(editor).mode, keys).toBe("normal");
                expect(editor.model.document.selection.isCollapsed, keys).toBe(true);
                expect(getCursor(editor).split(":")[0], keys).toBe("1");
            }
        });
    });

    describe("focus", () => {
        it("keeps the selection when the browser answers a key that left a tab panel",
            async () => {
            const editor = await createVimEditor(paragraphs("top")
                + "<tabs><tab><tabTitle>T</tabTitle><tabPanel>" + paragraphs("[]p")
                + "</tabPanel></tab></tabs>" + paragraphs("after"));
            const view = editor.editing.view;
            view.focus();
            const panel = document.activeElement;
            const echo = () => {
                const start = view.createPositionAt(
                    view.document.getRoot()?.getChild(0) as never, 0);
                view.document.fire("selectionChange", {
                    oldSelection: view.document.selection,
                    newSelection: view.createSelection(start),
                    domSelection: null
                });
            };
            press(editor, "Vj");
            expect(document.activeElement).not.toBe(panel);
            const topText = getRoot(editor).querySelector("p")?.firstChild as Node;
            document.getSelection()?.collapse(topText, 0);
            echo();
            expect(getStatus(editor).mode).toBe("visual-line");
            expect(getCursor(editor)).toBe("3:5");
            expect(document.getSelection()?.anchorNode).not.toBe(topText);
            echo();
            expect(getStatus(editor).mode).toBe("normal");
            expect(getCursor(editor)).toBe("0:0");

            press(editor, "3G");
            expect(document.activeElement).toBe(panel);
            press(editor, "j");
            document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            echo();
            expect(getCursor(editor)).toBe("0:0");
        });
    });

    describe("links", () => {
        it("are the note reference or the linked text under the block cursor", async () => {
            vi.useFakeTimers();
            const editor = await createVimEditor("<paragraph>[]a<reference href=\"#r\"></reference>"
                + "b<$text linkHref=\"#l\">cd</$text></paragraph>" + paragraphs(""),
                { areHintsEnabled: () => true }, [ ReferenceLink ]);
            const read = (keys: string) => {
                press(editor, `${keys}g`);
                vi.advanceTimersByTime(400);
                const isHinted = !!getStatus(editor).hints?.hints
                    .some((hint) => hint.description === "follow the link");
                press(editor, "<Esc>");
                return [ getLinkUnderCursor(editor), isHinted ];
            };
            const reference = { href: "#r", isReference: true };
            const link = { href: "#l", isReference: false };
            expect(read("")).toEqual([ null, false ]);
            expect(read("l")).toEqual([ reference, true ]);
            expect(read("l")).toEqual([ null, false ]);
            expect(read("l")).toEqual([ link, true ]);
            expect(read("l")).toEqual([ link, true ]);
            expect(read("j")).toEqual([ null, false ]);
            press(editor, "k0li");
            expect(getLinkUnderCursor(editor)).toBeNull();
            press(editor, "<Esc>3lv");
            expect(getLinkUnderCursor(editor)).toEqual(link);

            const plain = await createTestEditor([ Paragraph, ReferenceLink ]);
            setModelData(plain.model,
                "<paragraph>[<reference href=\"#r\"></reference>]</paragraph>");
            expect(getLinkUnderCursor(plain)).toEqual(reference);
        });

        it("are the web address of a link preview under the cursor", async () => {
            const preview = (name: string, url: string) =>
                `<${name} url="${url}" embedType="opengraph"></${name}>`;
            const editor = await createVimEditor(
                `<paragraph>[]a${preview("linkMention", "https://e.co/")}</paragraph>`
                + preview("linkEmbed", "https://f.co/")
                + `<paragraph>${preview("linkMention", "javascript:alert(1)")}</paragraph>`,
                {}, [ LinkEmbed ], { linkEmbed: createLinkEmbedHost() });
            const web = (href: string) => ({ href, isReference: false });
            expect(getLinkUnderCursor(editor)).toBeNull();
            press(editor, "l");
            expect(getLinkUnderCursor(editor)).toEqual(web("https://e.co/"));
            press(editor, "j");
            expect(getLinkUnderCursor(editor)).toEqual(web("https://f.co/"));
            press(editor, "j");
            expect(getCursor(editor)).toBe("2:0");
            expect(getLinkUnderCursor(editor)).toBeNull();
        });
    });

    describe("widgets", () => {
        it("enter the caption of an image, or open a line next to another widget", async () => {
            const editor = await createVimEditor(
                "[<imageBlock src=\"a.png\"><caption>cap</caption></imageBlock>]"
                + "<horizontalLine></horizontalLine>", {}, [ ImageBlock ]);
            press(editor, "i");
            expect(getStatus(editor).mode).toBe("insert");
            typeText(editor, "X");
            press(editor, "<Esc>");
            expect(getContent(editor)).toContain("<caption>Xcap</caption>");
            press(editor, "<Esc>");
            press(editor, "gga");
            typeText(editor, "Y");
            press(editor, "<Esc><Esc>");
            expect(getContent(editor)).toContain("<caption>XcapY</caption>");
            press(editor, "jA");
            typeText(editor, "after");
            press(editor, "<Esc>");
            expect(getLines(editor)).toBe("\u{FFFC}|\u{FFFC}|after");
            press(editor, "kI");
            typeText(editor, "before");
            press(editor, "<Esc>");
            expect(getLines(editor)).toBe("\u{FFFC}|before|\u{FFFC}|after");
        });

        it("give an image without a caption a caption to type in", async () => {
            const editor = await createVimEditor("[<imageBlock src=\"a.png\"></imageBlock>]", {},
                [ ImageBlock ]);
            press(editor, "i");
            typeText(editor, "cap");
            press(editor, "<Esc>");
            expect(getContent(editor)).toContain("<caption>cap</caption>");
        });

        it("enter the editor of an embed", async () => {
            const nested = await createVimEditor(paragraphs("[]inner"));
            const enter = vi.fn((dom: HTMLElement) => {
                const root = document.createElement("div");
                root.className = "ck-editor__editable";
                Object.assign(root, { ckeditorInstance: nested });
                dom.append(root);
                return true;
            });
            const editor = await createVimEditor("[<contentEmbed noteId=\"n1\"></contentEmbed>]",
                {},
                [ ContentEmbed ]);
            editor.config.set("contentEmbed", { enter });
            press(editor, "A");
            expect(enter).toHaveBeenCalledWith(expect.any(HTMLElement), "end");
            expect(getStatus(nested).mode).toBe("insert");
            expect(getStatus(editor).mode).toBe("normal");
        });

        it("read a selected container as the cursor at the start of its first line", async () => {
            const box = aside(paragraphs("s1", "s2"));
            const editor = await createVimEditor();
            const select = (content = box) =>
                setVimData(editor, `${paragraphs("a")}[${content}]${paragraphs("b")}`);
            const selection = editor.model.document.selection;

            select();
            expect(getStatus(editor).mode).toBe("normal");
            expect(getCursor(editor)).toBe("1:0");
            expect(selection.getSelectedElement()?.name).toBe("asideBlock");
            for (const [ keys, lines, cursor ] of [
                [ "j", "a|s1|s2|b", "2:0" ], [ "x", "a|1|s2|b", "1:0" ], [ "dd", "a|s2|b", "1:0" ]
            ]) {
                select();
                press(editor, keys);
                expect(getLines(editor), keys).toBe(lines);
                expect(getCursor(editor), keys).toBe(cursor);
                expect(selection.isCollapsed, keys).toBe(true);
            }
            select();
            press(editor, "i");
            typeText(editor, "X");
            press(editor, "<Esc>");
            expect(getLines(editor)).toBe("a|Xs1|s2|b");

            select("<table><tableRow><tableCell>" + paragraphs("t1", "t2")
                + "</tableCell></tableRow></table>");
            press(editor, "x");
            expect(getLines(editor)).toBe("a|1|t2|b");

            setVimData(editor, `${paragraphs("[]a")}${box}`);
            press(editor, "v");
            editor.model.change((writer) =>
                writer.setSelection(editor.model.document.getRoot()?.getChild(1) as never, "on"));
            expect(getStatus(editor).mode).toBe("normal");
            expect(getCursor(editor)).toBe("1:0");
        });
    });

    it("needs no session to load the engine twice", async () => {
        const editor = await createVimEditor(paragraphs("[]a"));
        expect(getAdapter(editor).getLine(0)).toBe("a");
    });
});
