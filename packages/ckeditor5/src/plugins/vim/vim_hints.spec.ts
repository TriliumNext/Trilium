import type { Editor } from "ckeditor5";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createVimEditor, getStatus, item, paragraphs, press } from "../../../test/vim-kit.js";
import type { VimConfig } from "./vim.js";
import { getLoadedVimEngine } from "./vim_engine.js";
import {
    getCommandHints, getKeyLabel, type HintContext, type PendingCommand, splitKeys, type VimHints
} from "./vim_hints.js";

/** A hint as the strip writes it: `[j] [k] screen line down, up`, `[a]-[z] set a mark here`. */
function write(hints: VimHints["hints"]): string[] {
    return hints.map(({ keys, isRange, description }) => {
        const keyText = isRange
            ? `[${keys[0]}]-[${keys[1]}]`
            : keys.map((key) => `[${key}]`).join(" ");
        return keyText ? `${keyText} ${description}` : description;
    });
}

/** The strip of `editor`: its kind, the keys typed so far, and the hints. */
function getStrip(editor: Editor) {
    const hints = getStatus(editor).hints;
    return hints
        && { kind: hints.kind, typed: hints.typedKeys.join(" "), hints: write(hints.hints) };
}

/** An editor with key hints on, the strip shown unless `isStripShown` is off. */
async function createHintEditor(data: string, config: VimConfig = {}, isStripShown = true) {
    let isShown = isStripShown;
    const toggleHintStrip = vi.fn(() => {
        isShown = !isShown;
    });
    const editor = await createVimEditor(data, {
        areHintsEnabled: () => true,
        isHintStripShown: () => isShown,
        ...config,
        host: { toggleHintStrip, ...config.host }
    });
    return { editor, toggleHintStrip };
}

const NORMAL_KEYS = [ "[i] insert", "[v] select", "[u] undo", "[/] search", "[:] command" ];
const VISUAL_KEYS = [
    "[y] yank (copy)", "[d] delete", "[c] change", "[>] [<] indent, outdent",
    "[i] [a] select inside, around…"
];

const NO_CURSOR: HintContext = {
    isOnLink: () => false,
    canFold: () => false,
    getParagraphObjectKind: () => "paragraph",
    isMapped: () => false
};

/** The hints for `command`, read through `context`, as the strip writes them. */
function resolve(command: Partial<PendingCommand>, context: Partial<HintContext> = {}) {
    const hints = getCommandHints({
        context: "normal", keyBuffer: "", operator: "", hasCount: false, registerName: "",
        ...command
    }, { ...NO_CURSOR, ...context }, (message) => message);
    return hints && write(hints);
}

describe("key hints", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    describe("the table", () => {
        it("names keys as the keyboard does", () => {
            expect(splitKeys("\"a3d<C-r>")).toEqual([ "\"", "a", "3", "d", "<C-r>" ]);
            expect([ "<C-r>", "<Esc>", "<CR>", "<S-Tab>", "<lt>", "<Up>", "<A-x>", "w", "<Foo>" ]
                .map(getKeyLabel)).toEqual(
                [ "Ctrl+R", "Esc", "Enter", "Shift+Tab", "<", "↑", "Alt+X", "w", "Foo" ]);
        });

        it("follows operators, counts and registers", () => {
            expect(resolve({ operator: "d" })).toEqual([
                "[d] this line", "[w] to next word", "[$] to line end", "[i] inside…",
                "[a] around…"
            ]);
            expect(resolve({ operator: "c" })?.slice(0, 2))
                .toEqual([ "[c] this line", "[w] rest of the word" ]);
            expect(resolve({ operator: ">" })).toEqual([
                "[>] this line", "[j] and the next line", "[a] around…", "[}] to next block",
                "[G] to the end"
            ]);
            expect(resolve({ operator: "gU" })?.[0]).toBe("[U] this line");
            expect(resolve({ operator: "g?" })?.[0]).toBe("[w] to next word");
            expect(resolve({ operator: "=" })).toBeNull();
            expect(resolve({ operator: "d", hasCount: true })?.[0]).toBe("[d] this line");
            expect(resolve({ hasCount: true })).toEqual([
                "a count: repeats the next command", "[j] lines down", "[w] words forward",
                "[d] [d] delete lines", "[G] go to that line"
            ]);
            expect(resolve({ registerName: "a" }))
                .toEqual([ "[y] yank into it…", "[d] delete into it…", "[p] put from it" ]);
            expect(resolve({})).toBeNull();
            expect(resolve({ keyBuffer: "\"" })?.slice(0, 2))
                .toEqual([ "[a]-[z] a named register", "[+] the clipboard" ]);
            expect(resolve({ keyBuffer: "`" })?.[1]).toBe("[`] back to before the last jump");
            expect(resolve({ keyBuffer: "'" })?.slice(0, 2))
                .toEqual([ "[a]-[z] jump to a mark", "['] back to before the last jump" ]);
            expect(resolve({ keyBuffer: "m" })).toEqual([ "[a]-[z] set a mark here" ]);
            expect(resolve({ keyBuffer: "q" }))
                .toEqual([ "[a]-[z] record a macro into this register" ]);
            expect(resolve({ keyBuffer: "@" })?.[1]).toBe("[@] the last one again");
            expect(resolve({ keyBuffer: "x" })).toBeNull();
            expect(resolve({ context: "insert", keyBuffer: "<C-r>" })?.[0])
                .toBe("[\"] the last yank or delete");
            expect(resolve({ context: "insert", keyBuffer: "j" })).toBeNull();
        });

        it("follows prefixes, and after an operator or in Visual mode their motions", () => {
            expect(resolve({ keyBuffer: "g" })?.slice(0, 3))
                .toEqual([ "[g] first line", "[j] [k] screen line down, up", "[v] reselect" ]);
            expect(resolve({ keyBuffer: "g" }, { isOnLink: () => true })?.[1])
                .toBe("[f] follow the link");
            expect(resolve({ keyBuffer: "z" })?.[0]).toBe("[z] center this line");
            expect(resolve({ keyBuffer: "z" }, { canFold: () => true })).toEqual([
                "[a] collapse or expand", "[z] center this line",
                "[t] [b] this line to top, bottom", "[j] [k] next, previous heading",
                "[o] [c] expand, collapse", "[A] [O] [C] the same, nested sections too"
            ]);
            expect(resolve({ keyBuffer: "]" })?.[0]).toBe("[]] next heading");
            expect(resolve({ keyBuffer: "[" })?.[3]).toBe("[p] put (paste) above");
            expect(resolve({ keyBuffer: "Z" })).toEqual([ "[Z] close the note tab" ]);
            expect(resolve({ operator: "d", keyBuffer: "g" })?.slice(0, 2))
                .toEqual([ "[g] to the first line", "[e] back to word end" ]);
            expect(resolve({ operator: "d", keyBuffer: "z" }))
                .toEqual([ "[j] [k] to next, previous heading" ]);
            expect(resolve({ operator: "d", keyBuffer: "]" })?.[0]).toBe("[]] to next heading");
            expect(resolve({ operator: "d", keyBuffer: "[" })?.[0])
                .toBe("[[] to previous heading");
            expect(resolve({ context: "visual", keyBuffer: "g" })?.[3])
                .toBe("[u] [U] to lower, upper case");
            expect(resolve({ operator: "d", keyBuffer: "\"" })).toBeNull();
            expect(resolve({ context: "visual", keyBuffer: "m" }))
                .toEqual([ "[a]-[z] set a mark here" ]);
        });

        it("says what a character key waits for", () => {
            expect(resolve({ keyBuffer: "f" })).toEqual([
                "any character: jump to it in this line", "then", "[;] again",
                "[,] the other way"
            ]);
            expect(resolve({ keyBuffer: "F" })?.[0])
                .toBe("any character: jump back to it in this line");
            expect(resolve({ keyBuffer: "t" })?.[0]).toBe("any character: jump to just before it");
            expect(resolve({ keyBuffer: "T" })?.[0])
                .toBe("any character: jump back to just after it");
            expect(resolve({ keyBuffer: "r" }))
                .toEqual([ "any character: it replaces the one under the cursor" ]);
            expect([ "f", "F", "t", "T", "r" ].map((key) =>
                resolve({ operator: "d", keyBuffer: key })?.[0] ?? null)).toEqual([
                "any character: up to and including it", "any character: back to and including it",
                "any character: up to just before it", "any character: back to just after it", null
            ]);
            expect([ "f", "F", "t", "T", "r" ].map((key) =>
                resolve({ context: "visual", keyBuffer: key })?.[0])).toEqual([
                "any character: extend to it", "any character: extend back to it",
                "any character: extend to just before it",
                "any character: extend back to just after it",
                "any character: it replaces each selected one"
            ]);
        });

        it("names the block that the paragraph object takes", () => {
            const describeP = (kind: ReturnType<HintContext["getParagraphObjectKind"]>) =>
                [ "i", "a" ].map((key) => resolve({ operator: "d", keyBuffer: key },
                    { getParagraphObjectKind: () => kind })?.[1]);
            expect(describeP("paragraph")).toEqual([ "[p] the paragraph", "[p] the paragraph" ]);
            expect(describeP("listItem"))
                .toEqual([ "[p] the item's paragraphs", "[p] the item, nested items too" ]);
            expect(describeP("heading"))
                .toEqual([ "[p] the heading line", "[p] the heading and its section" ]);
            expect(describeP("quote")).toEqual([ "[p] its paragraphs", "[p] the whole quote" ]);
            expect(describeP("admonition"))
                .toEqual([ "[p] its paragraphs", "[p] the whole admonition" ]);
            expect(describeP("codeBlock")).toEqual([ "[p] its lines", "[p] the code block" ]);
            expect(describeP("box")).toEqual([ "[p] its content", "[p] its content" ]);
            expect(describeP("collapsibleTitle"))
                .toEqual([ "[p] the title", "[p] the whole block" ]);
            expect(describeP("collapsibleBody")).toEqual([ "[p] the body", "[p] the whole block" ]);
            expect(describeP("widget")).toEqual([ "[p] the widget", "[p] the widget" ]);
            expect(resolve({ context: "visual", keyBuffer: "i" })?.[0]).toBe("[w] word");
        });

        it("leaves out the keys that the user mapped", () => {
            const isMapped = (keys: string) => keys === "gj" || keys === "dw";
            expect(resolve({ keyBuffer: "g" }, { isMapped })).not.toContain(
                "[j] [k] screen line down, up");
            expect(resolve({ operator: "d" }, { isMapped })?.[1]).toBe("[$] to line end");
            expect(resolve({ keyBuffer: "m" }, { isMapped: () => true }))
                .toEqual([ "[a]-[z] set a mark here" ]);
        });
    });

    describe("the strip", () => {
        it("shows the keys of Normal and Visual mode at once, and none in Insert mode",
            async () => {
            const { editor } = await createHintEditor(paragraphs("[]ab", "cd"));
            expect(getStrip(editor)).toEqual({ kind: "mode", typed: "", hints: NORMAL_KEYS });
            press(editor, "v");
            expect(getStrip(editor)).toEqual({ kind: "mode", typed: "", hints: VISUAL_KEYS });
            press(editor, "V");
            expect(getStrip(editor)?.hints).toEqual(VISUAL_KEYS);
            press(editor, "<Esc>i");
            expect(getStrip(editor)).toBeNull();
            press(editor, "<C-o>");
            expect(getStatus(editor).isOneCommand).toBe(true);
            expect(getStrip(editor)).toBeNull();
            press(editor, "<Esc>R");
            expect(getStrip(editor)).toBeNull();
            press(editor, "<Esc>");
            expect(getStrip(editor)?.hints).toEqual(NORMAL_KEYS);
        });

        it("shows the keys that can follow after a pause, and keeps them for the command",
            async () => {
            vi.useFakeTimers();
            const { editor } = await createHintEditor(paragraphs("[]ab cd", "ef"));
            const modeHints = getStatus(editor).hints;
            press(editor, "dw");
            expect(getStatus(editor).hints).toBe(modeHints);
            press(editor, "d");
            vi.advanceTimersByTime(399);
            expect(getStatus(editor).hints).toBe(modeHints);
            expect(getStatus(editor).pendingKeys).toBe("d");
            vi.advanceTimersByTime(1);
            expect(getStrip(editor)).toEqual({
                kind: "command",
                typed: "d",
                hints: [
                    "[d] this line", "[w] to next word", "[$] to line end", "[i] inside…",
                    "[a] around…", "[Esc] cancel"
                ]
            });
            press(editor, "i");
            expect(getStrip(editor)).toMatchObject({ typed: "d i" });
            expect(getStrip(editor)?.hints.slice(0, 2))
                .toEqual([ "[w] word", "[p] the paragraph" ]);
            expect(getStrip(editor)?.hints).toHaveLength(6);
            press(editor, "w");
            expect(getStrip(editor)?.hints).toEqual(NORMAL_KEYS);
            expect(getStatus(editor).hints).toBe(modeHints);

            press(editor, "g");
            vi.advanceTimersByTime(400);
            expect(getStrip(editor)?.typed).toBe("g");
            press(editor, "<Esc>");
            expect(getStrip(editor)?.hints).toEqual(NORMAL_KEYS);
            vi.advanceTimersByTime(1000);
            expect(getStrip(editor)?.hints).toEqual(NORMAL_KEYS);
        });

        it("leads with the count, the register and the keys of Insert mode", async () => {
            vi.useFakeTimers();
            const { editor } = await createHintEditor(paragraphs("[]ab", "cd"));
            press(editor, "\"a3");
            vi.advanceTimersByTime(400);
            expect(getStrip(editor)?.typed).toBe("\" a 3");
            expect(getStrip(editor)?.hints[0]).toBe("a count: repeats the next command");
            press(editor, "<Esc>\"a");
            vi.advanceTimersByTime(400);
            expect(getStrip(editor)?.hints[0]).toBe("[y] yank into it…");
            press(editor, "<Esc>i<C-r>");
            vi.advanceTimersByTime(400);
            expect(getStrip(editor)).toMatchObject({ kind: "command", typed: "Ctrl+R" });
            press(editor, "a");
            expect(getStrip(editor)).toBeNull();
            press(editor, ">");
            vi.advanceTimersByTime(400);
            expect(getStrip(editor)).toBeNull();
            const firstHints = [ "<", ">", "y", "c", "gu", "=" ].map((keys) => {
                press(editor, `<Esc>${keys}`);
                vi.advanceTimersByTime(400);
                return getStrip(editor)?.hints[0];
            });
            expect(firstHints).toEqual([
                "[<] this line", "[>] this line", "[y] this line", "[c] this line",
                "[u] this line", "[i] insert"
            ]);
        });

        it("reads the cursor for the link, the folds and the paragraph object", async () => {
            vi.useFakeTimers();
            const data = paragraphs("[]intro") + "<heading2>H</heading2>" + paragraphs("s")
                + paragraphs("<$text linkHref=\"#x\">link</$text>") + item("i", "a");
            const { editor } = await createHintEditor(data);
            press(editor, "z");
            vi.advanceTimersByTime(400);
            expect(getStrip(editor)?.hints[0]).toBe("[z] center this line");
            press(editor, "<Esc>jz");
            vi.advanceTimersByTime(400);
            expect(getStrip(editor)?.hints[0]).toBe("[a] collapse or expand");
            press(editor, "<Esc>di");
            vi.advanceTimersByTime(400);
            expect(getStrip(editor)?.hints[1]).toBe("[p] the heading line");
            press(editor, "<Esc>jjlg");
            vi.advanceTimersByTime(400);
            expect(getStrip(editor)?.hints[1]).toBe("[f] follow the link");
            press(editor, "<Esc>jda");
            vi.advanceTimersByTime(400);
            expect(getStrip(editor)?.hints[1]).toBe("[p] the item, nested items too");
        });

        it("drops the hints of keys that :map gives another meaning", async () => {
            vi.useFakeTimers();
            const { editor } = await createHintEditor(paragraphs("[]ab", "cd"));
            const isGjHinted = (commands: string) => {
                press(editor, `${commands}g`);
                vi.advanceTimersByTime(400);
                const isHinted = !!getStrip(editor)?.hints.includes("[j] [k] screen line down, up");
                press(editor, "<Esc>");
                return isHinted;
            };
            try {
                expect(isGjHinted(":nmap gj j<CR>")).toBe(false);
                expect(isGjHinted(":nmapclear<CR>")).toBe(true);
                expect(isGjHinted(":map gj j<CR>")).toBe(false);
                expect(isGjHinted(":unmap gj<CR>")).toBe(true);
                expect(isGjHinted(":map gj j<CR>:vmapclear<CR>")).toBe(false);
                expect(isGjHinted(":nmapclear<CR>")).toBe(true);
                expect(isGjHinted(":map gj j<CR>:mapclear<CR>")).toBe(true);
                expect(isGjHinted(":map gj<CR>:map<CR>:unmap<CR>")).toBe(true);
            } finally {
                getLoadedVimEngine()?.mapclear();
            }
        });

        it("spells out the confirm prompt of :s///c", async () => {
            const { editor } = await createHintEditor(paragraphs("[]a a"));
            press(editor, ":s/a/b/gc<CR>");
            expect(getStrip(editor)).toEqual({
                kind: "prompt",
                typed: "",
                hints: [
                    "[y] replace", "[n] skip", "[a] all the rest", "[q] stop here",
                    "[l] this one, then stop"
                ]
            });
            press(editor, "y");
            expect(getStrip(editor)?.kind).toBe("prompt");
            press(editor, "q");
            expect(getStatus(editor).commandLine).toBeNull();
            expect(getStrip(editor)?.hints).toEqual(NORMAL_KEYS);
        });

        it("shows nothing while the hints are off, until they are turned on", async () => {
            vi.useFakeTimers();
            let isEnabled = false;
            const { editor } = await createHintEditor(paragraphs("[]ab"),
                { areHintsEnabled: () => isEnabled });
            press(editor, "d");
            vi.advanceTimersByTime(400);
            expect(getStrip(editor)).toBeNull();
            isEnabled = true;
            editor.plugins.get("TriliumVim").refreshHints();
            expect(getStrip(editor)?.hints).toEqual(NORMAL_KEYS);
            press(editor, "<Esc>d");
            vi.advanceTimersByTime(400);
            expect(getStrip(editor)?.kind).toBe("command");
            isEnabled = false;
            editor.plugins.get("TriliumVim").refreshHints();
            expect(getStrip(editor)).toBeNull();

            const alone = await createVimEditor(paragraphs("[]ab"));
            expect(getStatus(alone).hints).toBeNull();
        });
    });

    describe("the breadcrumb view", () => {
        it("comes and goes with Esc in Normal mode when nothing else is left to do", async () => {
            vi.useFakeTimers();
            const { editor, toggleHintStrip } = await createHintEditor(paragraphs("[]ab", "cd"));
            press(editor, "<Esc>");
            expect(toggleHintStrip).toHaveBeenCalledTimes(1);
            expect(getStrip(editor)).toBeNull();
            press(editor, "v");
            expect(getStrip(editor)).toBeNull();
            press(editor, "<Esc>");
            expect(toggleHintStrip).toHaveBeenCalledTimes(1);
            press(editor, "d");
            vi.advanceTimersByTime(400);
            expect(getStrip(editor)?.kind).toBe("command");
            press(editor, "<Esc>");
            expect(getStrip(editor)).toBeNull();
            expect(toggleHintStrip).toHaveBeenCalledTimes(1);
            press(editor, "<C-[>");
            expect(toggleHintStrip).toHaveBeenCalledTimes(2);
            expect(getStrip(editor)?.hints).toEqual(NORMAL_KEYS);
        });

        it("waits for a long message to close first, and stays put with the hints off",
            async () => {
            const { editor, toggleHintStrip } = await createHintEditor(paragraphs("[]ab"));
            press(editor, ":registers<CR>");
            expect(getStatus(editor).message?.isLong).toBe(true);
            press(editor, "<Esc>");
            expect(getStatus(editor).message).toBeNull();
            expect(toggleHintStrip).not.toHaveBeenCalled();

            const off = await createHintEditor(paragraphs("[]ab"),
                { areHintsEnabled: () => false });
            press(off.editor, "<Esc>");
            expect(off.toggleHintStrip).not.toHaveBeenCalled();
        });

        it("starts without the keys of the mode when the strip is hidden", async () => {
            const { editor } = await createHintEditor(paragraphs("[]ab"), {}, false);
            expect(getStrip(editor)).toBeNull();
        });
    });
});
