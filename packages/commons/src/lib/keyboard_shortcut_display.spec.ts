import { describe, expect, it } from "vitest";

import {
    formatShortcut,
    formatShortcutKey,
    joinShortcut,
    SHORTCUT_KEY_PREFIX,
    splitShortcutForDisplay
} from "./keyboard_shortcut_display.js";

/**
 * Stand-in for the caller's i18n `t()`. Returns the bare id so assertions stay language-independent
 * (`keyboard_shortcut_keys.ctrl` -> `ctrl`) — see CLAUDE.md: never assert on translated strings.
 */
const translate = (key: string) => key.replace(`${SHORTCUT_KEY_PREFIX}.`, "");

describe("splitShortcutForDisplay", () => {
    it("splits on + and strips the global: storage prefix", () => {
        expect(splitShortcutForDisplay("Ctrl+Shift+J")).toEqual(["Ctrl", "Shift", "J"]);
        expect(splitShortcutForDisplay("global:Meta+Plus")).toEqual(["Meta", "Plus"]);
        expect(splitShortcutForDisplay("F5")).toEqual(["F5"]);
    });

    it("preserves the original casing of each token", () => {
        expect(splitShortcutForDisplay("cTrL+j")).toEqual(["cTrL", "j"]);
    });

    it("returns no tokens for an empty, blank or missing shortcut", () => {
        expect(splitShortcutForDisplay("")).toEqual([]);
        expect(splitShortcutForDisplay("   ")).toEqual([]);
        expect(splitShortcutForDisplay("global:")).toEqual([]);
        // Callers read shortcuts straight out of options, which can be unset.
        expect(splitShortcutForDisplay(undefined as unknown as string)).toEqual([]);
    });

    it("resolves the plus key, which doubles as the separator", () => {
        // `+` is both the separator and a key, so the plus key is stored either as a lone `+` or
        // as a trailing `++`. Both must yield a single `+` token, not an empty one.
        expect(splitShortcutForDisplay("+")).toEqual(["+"]);
        expect(splitShortcutForDisplay("Ctrl++")).toEqual(["Ctrl", "+"]);
        expect(splitShortcutForDisplay("Ctrl+Shift++")).toEqual(["Ctrl", "Shift", "+"]);
        // The named form is a plain token and splits normally.
        expect(splitShortcutForDisplay("Ctrl+Plus")).toEqual(["Ctrl", "Plus"]);
    });
});

describe("formatShortcutKey", () => {
    it("renders glyph tokens as universal symbols without translating them", () => {
        expect(formatShortcutKey("Up", translate)).toBe("↑");
        expect(formatShortcutKey("ArrowDown", translate)).toBe("↓");
        expect(formatShortcutKey("left", translate)).toBe("←");
        expect(formatShortcutKey("RIGHT", translate)).toBe("→");
        expect(formatShortcutKey("Plus", translate)).toBe("+");
        expect(formatShortcutKey("+", translate)).toBe("+");
    });

    it("routes modifiers and named keys through the translate function", () => {
        expect(formatShortcutKey("Ctrl", translate)).toBe("ctrl");
        expect(formatShortcutKey("Control", translate)).toBe("ctrl");
        expect(formatShortcutKey("CommandOrControl", translate)).toBe("ctrl");
        expect(formatShortcutKey("Cmd", translate)).toBe("meta");
        expect(formatShortcutKey("Esc", translate)).toBe("escape");
        expect(formatShortcutKey("Del", translate)).toBe("delete");
        expect(formatShortcutKey("PageUp", translate)).toBe("page_up");
        expect(formatShortcutKey("Ins", translate)).toBe("insert");
    });

    it("emits any other token verbatim, preserving its casing", () => {
        expect(formatShortcutKey("J", translate)).toBe("J");
        expect(formatShortcutKey("j", translate)).toBe("j");
        expect(formatShortcutKey("F11", translate)).toBe("F11");
        expect(formatShortcutKey("-", translate)).toBe("-");
    });
});

describe("formatShortcut", () => {
    it("formats each token in order on non-mac platforms", () => {
        expect(formatShortcut("Ctrl+Shift+J", translate, false)).toEqual(["ctrl", "shift", "J"]);
        expect(formatShortcut("global:Alt+Left", translate, false)).toEqual(["alt", "←"]);
        expect(formatShortcut("", translate, false)).toEqual([]);
    });

    it("renders mac modifiers as glyphs in Apple's canonical order", () => {
        // Stored order is irrelevant on macOS — both spellings must display as ⌃⌥⇧⌘.
        expect(formatShortcut("Meta+Shift+Alt+Ctrl+J", translate, true)).toEqual(["⌃", "⌥", "⇧", "⌘", "J"]);
        expect(formatShortcut("Ctrl+Alt+Shift+Meta+J", translate, true)).toEqual(["⌃", "⌥", "⇧", "⌘", "J"]);
    });

    it("renders the common named keys as mac glyphs", () => {
        expect(formatShortcut("Enter", translate, true)).toEqual(["↩"]);
        expect(formatShortcut("Escape", translate, true)).toEqual(["⎋"]);
        expect(formatShortcut("Tab", translate, true)).toEqual(["⇥"]);
        expect(formatShortcut("Delete", translate, true)).toEqual(["⌦"]);
        expect(formatShortcut("Backspace", translate, true)).toEqual(["⌫"]);
    });

    it("keeps the translated label on mac for keys whose glyph reads worse than the word", () => {
        // Page Up/Down, Home/End, Space and Insert have no entry in the mac glyph table, so they
        // fall back to the cross-platform rendering rather than an obscure symbol.
        expect(formatShortcut("Meta+PageUp", translate, true)).toEqual(["⌘", "page_up"]);
        expect(formatShortcut("Meta+Home", translate, true)).toEqual(["⌘", "home"]);
        expect(formatShortcut("Meta+Space", translate, true)).toEqual(["⌘", "space"]);
        expect(formatShortcut("Meta+Insert", translate, true)).toEqual(["⌘", "insert"]);
    });

    it("falls back to arrow glyphs and verbatim tokens for non-modifier keys on mac", () => {
        expect(formatShortcut("Meta+Left", translate, true)).toEqual(["⌘", "←"]);
        expect(formatShortcut("Meta+Plus", translate, true)).toEqual(["⌘", "+"]);
        expect(formatShortcut("Meta+F5", translate, true)).toEqual(["⌘", "F5"]);
    });

    it("folds CommandOrControl into a modifier glyph on mac", () => {
        expect(formatShortcut("CommandOrControl+J", translate, true)).toEqual(["⌃", "J"]);
    });
});

describe("joinShortcut", () => {
    it("concatenates with no separator on mac and with + elsewhere", () => {
        expect(joinShortcut(["⇧", "⌘", "J"], true)).toBe("⇧⌘J");
        expect(joinShortcut(["ctrl", "shift", "J"], false)).toBe("ctrl+shift+J");
    });

    it("honours a custom separator off mac only", () => {
        // The command palette spaces its shortcuts out; macOS keeps the native tight form.
        expect(joinShortcut(["ctrl", "J"], false, " + ")).toBe("ctrl + J");
        expect(joinShortcut(["⌘", "J"], true, " + ")).toBe("⌘J");
    });

    it("returns an empty string when there are no tokens", () => {
        expect(joinShortcut([], false)).toBe("");
    });
});
