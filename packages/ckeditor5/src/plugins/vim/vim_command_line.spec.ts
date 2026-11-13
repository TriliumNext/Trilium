import type { Editor } from "ckeditor5";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    createVimEditor, getLines, getStatus, paragraphs, press, setVimData
} from "../../../test/vim-kit.js";
import type { VimConfig } from "./vim.js";
import { getPromptKind, PromptAssistant } from "./vim_command_line.js";

/** An editor with key hints on, unless `config` turns them off. */
function createHintEditor(data: string, config: VimConfig = {}) {
    return createVimEditor(data, { areHintsEnabled: () => true, ...config });
}

/** The rows of the completion list: `>` before the selected one, `⏎` after the default. */
function getRows(): string[] | null {
    const list = document.querySelector(".ck-vim-completion");
    if (!list) {
        return null;
    }
    return [ ...list.querySelectorAll(".ck-vim-completion__row") ].map((row) => {
        const name = row.querySelector(".ck-vim-completion__name")?.textContent;
        const isSelected = row.getAttribute("aria-selected") === "true";
        const isDefault = !!row.querySelector(".ck-vim-completion__default");
        const isMuted = row.classList.contains("ck-vim-completion__row_muted");
        const marks = `${isDefault ? " ⏎" : ""}${isMuted ? " (muted)" : ""}`;
        return `${isSelected ? "> " : ""}${name}${marks}`;
    });
}

function getInput(editor: Editor): HTMLInputElement | null {
    return getStatus(editor).commandLine?.element.querySelector("input") ?? null;
}

/** The hints at the right end of the prompt, as text. */
function getPromptHints(editor: Editor): string[] | null {
    const hints = getStatus(editor).hints;
    if (!hints) {
        return null;
    }
    expect(hints.kind).toBe("prompt");
    return hints.hints.map(({ keys, description }) => [ ...keys, description ].join(" "));
}

describe("the command line with key hints", () => {
    afterEach(() => {
        vi.useRealTimers();
        for (const list of document.querySelectorAll(".ck-vim-completion")) {
            list.remove();
        }
    });

    it("names the kind of each prompt, and has no hints for a prompt it does not know", () => {
        expect([ ":", "/", "?", "replace with x (y/n/a/q/l)", "other" ].map(getPromptKind))
            .toEqual([ "command", "search", "search", "confirm", "other" ]);
        const input = document.createElement("input");
        const showHints = vi.fn();
        const assistant = new PromptAssistant("other", input, document.createElement("div"), {
            translate: (message) => message,
            areHintsEnabled: () => true,
            isJavaScriptRegex: () => true,
            getEditorCommands: () => [],
            showHints
        });
        assistant.update();
        expect(showHints).toHaveBeenCalledExactlyOnceWith([]);
        expect(input.hasAttribute("aria-autocomplete")).toBe(false);
        expect(assistant.onKeyDown(new KeyboardEvent("keydown", { key: "Tab" }))).toBe(false);
    });

    it("opens the list after a pause, follows the typing, and closes with the prompt",
        async () => {
        vi.useFakeTimers();
        const editor = await createHintEditor(paragraphs("[]a"));
        press(editor, ":");
        expect(getRows()).toBeNull();
        vi.advanceTimersByTime(400);
        expect(getRows()?.slice(0, 5))
            .toEqual([ "s[ubstitute]", "w[rite]", "q[uit]", "noh[lsearch]", "sor[t]" ]);
        expect(getInput(editor)?.getAttribute("aria-expanded")).toBe("true");
        press(editor, "s");
        expect(getRows()).toEqual([ "s[ubstitute] ⏎", "sor[t]", "se[t]", "start[insert]" ]);
        press(editor, "o");
        expect(getRows()).toEqual([ "sor[t]" ]);
        press(editor, "x");
        expect(getRows()).toEqual([ "no command starts with sox (muted)" ]);
        press(editor, "<Tab>");
        expect(getInput(editor)?.value).toBe("sox");
        press(editor, "<BS><BS> ");
        expect(getRows()).toBeNull();
        expect(getInput(editor)?.getAttribute("aria-expanded")).toBe("false");
        press(editor, "<Tab>");
        expect(getInput(editor)?.value).toBe("s ");
        expect(getRows()).toBeNull();
        press(editor, "<Esc>");
        expect(getStatus(editor).commandLine).toBeNull();

        press(editor, ":w<CR>");
        vi.advanceTimersByTime(1000);
        expect(getRows()).toBeNull();
    });

    it("walks the list with Tab and Shift+Tab, and Enter runs what the prompt holds",
        async () => {
        const editor = await createHintEditor(paragraphs("[]b a", "c"));
        press(editor, ":%s<Tab>");
        expect(getInput(editor)?.value).toBe("%substitute");
        expect(getRows()?.slice(0, 2)).toEqual([ "> s[ubstitute] ⏎", "sor[t]" ]);
        const input = getInput(editor);
        expect(input?.getAttribute("aria-activedescendant"))
            .toBe(document.querySelector(".ck-vim-completion__row")?.id);
        press(editor, "<Tab>");
        expect(getInput(editor)?.value).toBe("%sort");
        press(editor, "<S-Tab><S-Tab>");
        expect(getInput(editor)?.value).toBe("%startinsert");
        expect(getRows()?.at(-1)).toBe("> start[insert]");
        press(editor, "<BS><BS><BS><BS><BS><BS><BS><BS><BS><BS>");
        expect(getInput(editor)?.value).toBe("%s");
        press(editor, "<S-Tab>");
        expect(getInput(editor)?.value).toBe("%startinsert");
        press(editor, "<Esc>:%sor<CR>");
        expect(getLines(editor)).toBe("b a|c");
        expect(getRows()).toBeNull();
    });

    it("walks the list with Down and Up, and leaves Up to the history until something is typed",
        async () => {
        vi.useFakeTimers();
        const editor = await createHintEditor(paragraphs("[]a"));
        press(editor, ":noh<CR>:nohlsearch<CR>:<Up>");
        expect(getInput(editor)?.value).toBe("nohlsearch");
        vi.advanceTimersByTime(400);
        expect(getRows()).toEqual([ "noh[lsearch] ⏎" ]);
        press(editor, "<Up>");
        expect(getInput(editor)?.value).toBe("noh");
        press(editor, "<Down>");
        expect(getInput(editor)?.value).toBe("nohlsearch");
        expect(getRows()).toEqual([ "noh[lsearch] ⏎" ]);
        press(editor, "<Tab><C-u><Down>");
        expect(getInput(editor)?.value).toBe("substitute");
        expect(getRows()?.slice(0, 2)).toEqual([ "> s[ubstitute]", "w[rite]" ]);
        press(editor, "<C-u><Up>");
        expect(getInput(editor)?.value).toBe("noh");
        press(editor, "<BS><BS><BS><Down>");
        expect(getInput(editor)?.value).toBe("substitute");

        press(editor, "<Esc>:s");
        vi.advanceTimersByTime(400);
        press(editor, "<Up>");
        expect(getInput(editor)?.value).toBe("startinsert");
        expect(getRows()?.at(-1)).toBe("> start[insert]");
        press(editor, "<Down><Down><S-Up>");
        expect(getInput(editor)?.value).toBe("sort");
        expect(getRows()).toEqual([ "s[ubstitute] ⏎", "> sor[t]", "se[t]", "start[insert]" ]);
        press(editor, "<Up><Up>");
        expect(getInput(editor)?.value).toBe("startinsert");
        press(editor, "<Esc>");
    });

    it("completes with Tab while the hints are off, and fills a clicked row", async () => {
        vi.useFakeTimers();
        const editor = await createHintEditor(paragraphs("[]a"), { areHintsEnabled: () => false });
        press(editor, ":no");
        vi.advanceTimersByTime(1000);
        expect(getRows()).toBeNull();
        press(editor, "<Tab>");
        expect(getRows()?.slice(0, 2)).toEqual([ "> no[remap] ⏎", "noh[lsearch]" ]);
        const rows = document.querySelectorAll(".ck-vim-completion__row");
        const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        rows[1].dispatchEvent(mouseDown);
        expect(mouseDown.defaultPrevented).toBe(true);
        (rows[1] as HTMLElement).click();
        expect(getInput(editor)?.value).toBe("nohlsearch");
        expect(getRows()?.slice(0, 2)).toEqual([ "no[remap] ⏎", "> noh[lsearch]" ]);
        expect(getStatus(editor).hints).toBeNull();
        press(editor, "<C-c>");
    });

    it("paints the list in the opaque menu color unless background and backdrop effects are on",
        async () => {
        const style = document.createElement("style");
        style.textContent = `:root {
            --menu-background-color: rgb(1, 1, 1);
            --menu-background-color-no-backdrop: rgb(2, 2, 2);
        }`;
        document.head.append(style);
        try {
            const editor = await createHintEditor(paragraphs("[]a"));
            press(editor, ":<Tab>");
            const list = document.querySelector(".ck-vim-completion");
            if (!list) {
                throw new Error("The completion list did not open.");
            }
            expect(getComputedStyle(list).backgroundColor).toBe("rgb(2, 2, 2)");
            document.body.classList.add("background-effects");
            expect(getComputedStyle(list).backgroundColor).toBe("rgb(1, 1, 1)");
            document.body.classList.add("backdrop-effects-disabled");
            expect(getComputedStyle(list).backgroundColor).toBe("rgb(2, 2, 2)");
            press(editor, "<Esc>");
        } finally {
            document.body.classList.remove("background-effects", "backdrop-effects-disabled");
            style.remove();
        }
    });

    it("forgets a prompt once it closes", async () => {
        vi.useFakeTimers();
        const editor = await createHintEditor(paragraphs("[]a"));
        press(editor, ":");
        const closed = getInput(editor);
        press(editor, "<Esc>/");
        const hints = getStatus(editor).hints;
        if (!closed) {
            throw new Error("The command line did not open.");
        }
        closed.value = "s";
        closed.dispatchEvent(new InputEvent("input", { bubbles: true }));
        vi.advanceTimersByTime(1000);
        expect(getStatus(editor).hints).toBe(hints);
        expect(getRows()).toBeNull();
        press(editor, "<Esc>");
    });

    it("follows the command recalled from the history", async () => {
        const editor = await createHintEditor(paragraphs("[]a"));
        press(editor, ":noh<CR>:<Tab>");
        expect(getRows()?.[0]).toBe("> s[ubstitute]");
        press(editor, "<C-u>");
        expect(getRows()?.[0]).toBe("s[ubstitute]");
        press(editor, "<Up>");
        expect(getInput(editor)?.value).toBe("noh");
        expect(getRows()).toEqual([ "noh[lsearch] ⏎" ]);
        press(editor, "<Esc>");
    });

    it("lists the editor commands of :ck and the options of :set", async () => {
        const editor = await createHintEditor(paragraphs("[]a"));
        press(editor, ":ck bol<Tab>");
        expect(getInput(editor)?.value).toBe("ck bold");
        expect(getRows()?.[0]).toBe("> bold");
        press(editor, "<Esc>:set <Tab>");
        expect(getRows()).toEqual([ "> hints", "nohints" ]);
        expect(document.querySelector(".ck-vim-completion__summary")?.textContent)
            .toBe("show the key hints");
        press(editor, "<Esc>");
        editor.commands.get("bold")?.forceDisabled("spec");
        press(editor, ":ck bold<Tab>");
        expect(getRows()).toEqual([ "> bold (muted)" ]);
        press(editor, "<Esc>");
    });

    it("says what a range means and shows the form of the arguments", async () => {
        const editor = await createHintEditor(paragraphs("[]a", "b"));
        press(editor, "Vj:");
        expect(getInput(editor)?.value).toBe("'<,'>");
        expect(getPromptHints(editor)).toEqual([ "the lines of the selection" ]);
        press(editor, "s/");
        expect(getPromptHints(editor)?.[0]).toBe("pattern/replacement/flags");
        expect(getStatus(editor).hints?.hints[0].emphasis).toEqual({ start: 0, end: 7 });
        press(editor, "<Esc>:noh");
        expect(getPromptHints(editor)).toEqual([ "clear the search highlights" ]);
        press(editor, "<C-u>");
        expect(getPromptHints(editor)).toBeNull();
        press(editor, "<Esc>");
    });

    it("tells the keys of the search prompt and how the pattern is read", async () => {
        const editor = await createHintEditor(paragraphs("[]a"));
        press(editor, "/");
        expect(getPromptHints(editor)).toEqual([
            "Enter go to the match", "↑ ↓ earlier searches", "JavaScript regex", "case ignored"
        ]);
        press(editor, "A");
        expect(getPromptHints(editor)?.at(-1)).toBe("case matched");
        press(editor, "(");
        expect(getPromptHints(editor)?.at(-1)).toBe("incomplete pattern");
        press(editor, "<Esc>");
        expect(getStatus(editor).hints?.kind).toBe("mode");
    });

    it("tells the keys after a search, while n and N are pressed", async () => {
        vi.useFakeTimers();
        const editor = await createHintEditor(paragraphs("[]a b", "b a"));
        const keys = () => getStatus(editor).message?.hints?.map((hint) => hint.keys.join(" "));
        press(editor, "/b<CR>");
        expect(keys()).toEqual([ "n", "N", "Esc" ]);
        expect(getStatus(editor).message?.hints?.[0].description).toBe("next");
        press(editor, "n");
        expect(keys()).toEqual([ "n", "N", "Esc" ]);
        vi.advanceTimersByTime(4000);
        press(editor, "N");
        vi.advanceTimersByTime(4000);
        expect(keys()).toEqual([ "n", "N", "Esc" ]);
        press(editor, "l");
        expect(getStatus(editor).message).toBeNull();

        press(editor, "*");
        expect(keys()).toEqual([ "n", "N", "Esc" ]);
        vi.advanceTimersByTime(5000);
        expect(getStatus(editor).message).toBeNull();
        press(editor, "g#");
        expect(keys()).toEqual([ "n", "N", "Esc" ]);
        press(editor, "<Esc>");
        expect(getStatus(editor).message).toBeNull();

        press(editor, "/zzz<CR>");
        expect(getStatus(editor).message?.hints).toBeUndefined();
        press(editor, "<Esc>/b<CR>n/zzz<CR>");
        expect(getStatus(editor).message?.hints).toBeUndefined();
        vi.advanceTimersByTime(20000);
        setVimData(editor, paragraphs("[]a b", "b a"));
        press(editor, "<Esc>d/b<CR>");
        expect(getStatus(editor).message).toBeNull();
        press(editor, "u0d*");
        expect(getLines(editor)).toBe("a");
        expect(getStatus(editor).message).toBeNull();
    });

    it("shows nothing after a search while the hints are off", async () => {
        const editor = await createHintEditor(paragraphs("[]a b"),
            { areHintsEnabled: () => false });
        press(editor, "/b<CR>");
        expect(getStatus(editor).message).toBeNull();
        press(editor, "/");
        expect(getStatus(editor).hints).toBeNull();
        press(editor, "<Esc>");
    });

    it("turns the hints on and off with :set, through the host", async () => {
        let isEnabled = true;
        const setHintsEnabled = vi.fn((value: boolean) => {
            isEnabled = value;
        });
        const editor = await createVimEditor(paragraphs("[]a"),
            { areHintsEnabled: () => isEnabled, host: { setHintsEnabled } });
        press(editor, ":set nohints<CR>");
        expect(setHintsEnabled).toHaveBeenCalledExactlyOnceWith(false);
        expect(getStatus(editor).hints).toBeNull();
        press(editor, ":set hints?<CR>");
        expect(getStatus(editor).message?.text).toContain("nohints");
        press(editor, "<Esc>:set hints<CR>");
        expect(setHintsEnabled).toHaveBeenLastCalledWith(true);
        expect(getStatus(editor).hints?.kind).toBe("mode");

        const alone = await createVimEditor(paragraphs("[]a"));
        press(alone, ":set hints?<CR>");
        expect(getStatus(alone).message?.text).toContain("nohints");
    });
});
