import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the labels the same way the sibling specs (command_registry, keyboard_actions) do: resolve
// `keyboard_shortcut_keys.<id>` to a recognizable `L·<ID>` so translated output is unmistakable, and
// anything else back to its key. A glyph/pass-through result (e.g. "↑", not "L·UP") then proves i18n
// was not consulted for that token.
vi.mock("./i18n.js", () => ({
    t: (key: string) =>
        key.startsWith("keyboard_shortcut_keys.")
            ? `L·${key.slice("keyboard_shortcut_keys.".length).toUpperCase()}`
            : key
}));

// The formatter branches on isMac() for the macOS glyph rendering; default to non-Mac and flip it per
// test with vi.mocked(isMac).mockReturnValue(true).
vi.mock("./utils.js", () => ({ isMac: vi.fn(() => false) }));

import {
    formatShortcut,
    formatShortcutKey,
    joinShortcut,
    SHORTCUT_KEY_PREFIX,
    splitShortcutForDisplay
} from "./keyboard_shortcut_display.js";
import { isMac } from "./utils.js";

describe("keyboard_shortcut_display", () => {
    describe("splitShortcutForDisplay", () => {
        it("splits modifiers and the final key, preserving order and casing", () => {
            expect(splitShortcutForDisplay("Ctrl+Shift+J")).toEqual([ "Ctrl", "Shift", "J" ]);
            expect(splitShortcutForDisplay("Alt+Left")).toEqual([ "Alt", "Left" ]);
            expect(splitShortcutForDisplay("F5")).toEqual([ "F5" ]);
        });

        it("keeps punctuation keys as their own token", () => {
            expect(splitShortcutForDisplay("Meta+[")).toEqual([ "Meta", "[" ]);
            expect(splitShortcutForDisplay("Ctrl+=")).toEqual([ "Ctrl", "=" ]);
            expect(splitShortcutForDisplay("Alt+-")).toEqual([ "Alt", "-" ]);
            expect(splitShortcutForDisplay("Ctrl+.")).toEqual([ "Ctrl", "." ]);
        });

        it("handles the plus key encoded as a lone or trailing '+'", () => {
            expect(splitShortcutForDisplay("+")).toEqual([ "+" ]);
            expect(splitShortcutForDisplay("Ctrl++")).toEqual([ "Ctrl", "+" ]);
            expect(splitShortcutForDisplay("Ctrl+Alt++")).toEqual([ "Ctrl", "Alt", "+" ]);
        });

        it("strips a leading global: prefix so it never reaches the display", () => {
            expect(splitShortcutForDisplay("global:Meta+Plus")).toEqual([ "Meta", "Plus" ]);
            expect(splitShortcutForDisplay("global:Ctrl+Alt+P")).toEqual([ "Ctrl", "Alt", "P" ]);
        });

        it("trims surrounding whitespace and returns [] for empty/nullish input", () => {
            expect(splitShortcutForDisplay("  Ctrl+J  ")).toEqual([ "Ctrl", "J" ]);
            expect(splitShortcutForDisplay("")).toEqual([]);
            expect(splitShortcutForDisplay("   ")).toEqual([]);
            expect(splitShortcutForDisplay(undefined as unknown as string)).toEqual([]);
        });
    });

    describe("formatShortcutKey", () => {
        it("resolves modifiers and their aliases through i18n to one id", () => {
            expect(formatShortcutKey("Ctrl")).toBe("L·CTRL");
            expect(formatShortcutKey("Control")).toBe("L·CTRL");
            expect(formatShortcutKey("CommandOrControl")).toBe("L·CTRL");
            expect(formatShortcutKey("Meta")).toBe("L·META");
            expect(formatShortcutKey("Cmd")).toBe("L·META");
            expect(formatShortcutKey("Command")).toBe("L·META");
        });

        it("resolves named-key aliases to one id and matches case-insensitively", () => {
            expect(formatShortcutKey("Enter")).toBe("L·ENTER");
            expect(formatShortcutKey("Return")).toBe("L·ENTER");
            expect(formatShortcutKey("Del")).toBe("L·DELETE");
            expect(formatShortcutKey("delete")).toBe("L·DELETE");
            expect(formatShortcutKey("ESC")).toBe("L·ESCAPE");
            expect(formatShortcutKey("PageDown")).toBe("L·PAGE_DOWN");
        });

        it("renders glyph keys (arrows, plus) as their universal symbol, not a translated label", () => {
            expect(formatShortcutKey("ArrowUp")).toBe("↑");
            expect(formatShortcutKey("up")).toBe("↑");
            expect(formatShortcutKey("Down")).toBe("↓");
            expect(formatShortcutKey("Left")).toBe("←");
            expect(formatShortcutKey("Right")).toBe("→");
            expect(formatShortcutKey("Plus")).toBe("+");
            expect(formatShortcutKey("+")).toBe("+");
        });

        it("passes non-table tokens through verbatim, not a translated label", () => {
            expect(formatShortcutKey("J")).toBe("J");
            expect(formatShortcutKey("5")).toBe("5");
            expect(formatShortcutKey("F11")).toBe("F11");
            expect(formatShortcutKey("[")).toBe("[");
            expect(formatShortcutKey("=")).toBe("=");
        });
    });

    describe("formatShortcut", () => {
        it("resolves translatable tokens and leaves glyph/pass-through tokens intact", () => {
            expect(formatShortcut("Ctrl+Shift+J")).toEqual([ "L·CTRL", "L·SHIFT", "J" ]);
            expect(formatShortcut("Alt+Left")).toEqual([ "L·ALT", "←" ]);
            expect(formatShortcut("Meta+Plus")).toEqual([ "L·META", "+" ]);
            expect(formatShortcut("F5")).toEqual([ "F5" ]);
            expect(formatShortcut("Ctrl+Up")).toEqual([ "L·CTRL", "↑" ]);
        });

        it("strips global: and normalizes aliases end-to-end", () => {
            expect(formatShortcut("global:CommandOrControl+Alt+P")).toEqual([ "L·CTRL", "L·ALT", "P" ]);
            expect(formatShortcut("Cmd+ArrowRight")).toEqual([ "L·META", "→" ]);
        });

        it("returns [] for an empty shortcut", () => {
            expect(formatShortcut("")).toEqual([]);
        });
    });

    describe("formatShortcut on macOS", () => {
        beforeEach(() => vi.mocked(isMac).mockReturnValue(true));
        afterEach(() => vi.mocked(isMac).mockReturnValue(false));

        it("renders modifiers as macOS glyphs", () => {
            expect(formatShortcut("Ctrl+J")).toEqual([ "⌃", "J" ]);
            expect(formatShortcut("Alt+J")).toEqual([ "⌥", "J" ]);
            expect(formatShortcut("Shift+J")).toEqual([ "⇧", "J" ]);
            expect(formatShortcut("Meta+J")).toEqual([ "⌘", "J" ]);
        });

        it("renders the common named keys as glyphs; arrows and letters are unchanged", () => {
            expect(formatShortcut("Meta+Enter")).toEqual([ "⌘", "↩" ]);
            expect(formatShortcut("Escape")).toEqual([ "⎋" ]);
            expect(formatShortcut("Tab")).toEqual([ "⇥" ]);
            expect(formatShortcut("Delete")).toEqual([ "⌦" ]);
            expect(formatShortcut("Backspace")).toEqual([ "⌫" ]);
            expect(formatShortcut("Meta+Up")).toEqual([ "⌘", "↑" ]);
        });

        it("keeps the rarely-glyphed keys and Space as translated labels", () => {
            expect(formatShortcut("Meta+PageUp")).toEqual([ "⌘", "L·PAGE_UP" ]);
            expect(formatShortcut("Meta+PageDown")).toEqual([ "⌘", "L·PAGE_DOWN" ]);
            expect(formatShortcut("Meta+Home")).toEqual([ "⌘", "L·HOME" ]);
            expect(formatShortcut("Meta+End")).toEqual([ "⌘", "L·END" ]);
            expect(formatShortcut("Meta+Space")).toEqual([ "⌘", "L·SPACE" ]);
        });

        it("reorders modifiers into Apple's canonical order (⌃⌥⇧⌘) regardless of stored order", () => {
            // Stored "Meta+Shift" → display ⇧⌘; "Shift+Ctrl" → ⌃⇧.
            expect(formatShortcut("Meta+Shift+J")).toEqual([ "⇧", "⌘", "J" ]);
            expect(formatShortcut("Shift+Ctrl+J")).toEqual([ "⌃", "⇧", "J" ]);
            expect(formatShortcut("Meta+Alt+Ctrl+Shift+J")).toEqual([ "⌃", "⌥", "⇧", "⌘", "J" ]);
        });

        it("maps modifier aliases to the same glyph and strips global:", () => {
            expect(formatShortcut("Cmd+J")).toEqual([ "⌘", "J" ]);
            expect(formatShortcut("Control+J")).toEqual([ "⌃", "J" ]);
            expect(formatShortcut("global:CommandOrControl+Alt+P")).toEqual([ "⌃", "⌥", "P" ]);
        });
    });

    describe("joinShortcut", () => {
        it("joins with the given separator off macOS (default '+', palette ' + ')", () => {
            expect(joinShortcut([ "Ctrl", "Shift", "J" ])).toBe("Ctrl+Shift+J");
            expect(joinShortcut([ "Ctrl", "N" ], " + ")).toBe("Ctrl + N");
        });

        it("concatenates with no separator on macOS, ignoring the separator argument", () => {
            vi.mocked(isMac).mockReturnValue(true);
            expect(joinShortcut([ "⇧", "⌘", "J" ])).toBe("⇧⌘J");
            expect(joinShortcut([ "⌃", "N" ], " + ")).toBe("⌃N");
            vi.mocked(isMac).mockReturnValue(false);
        });
    });

    it("exposes the i18n key prefix for the integration layer", () => {
        expect(SHORTCUT_KEY_PREFIX).toBe("keyboard_shortcut_keys");
    });
});
