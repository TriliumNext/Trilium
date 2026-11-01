import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import themes, { getThemeById } from "./color_themes.js";

describe("color themes", () => {
    it("declares a unique id and a known variant for every theme", () => {
        // The id is what gets persisted in the `codeNoteTheme` option, so a duplicate would make
        // one of the two unreachable, and an id that ever changes silently resets a user's choice.
        expect(themes.length).toBeGreaterThan(0);
        expect(new Set(themes.map((t) => t.id)).size).toBe(themes.length);

        for (const theme of themes) {
            expect(theme.id).not.toBe("");
            expect(theme.name).not.toBe("");
            expect([ "light", "dark" ]).toContain(theme.variant);
        }
    });

    it("offers both a light and a dark option", () => {
        // The theme picker groups by variant, and the auto-switching light/dark pair needs at
        // least one of each to resolve to.
        const variants = new Set(themes.map((t) => t.variant));
        expect(variants).toContain("light");
        expect(variants).toContain("dark");
    });

    // Every theme is a dynamic import reaching for one named export; a renamed export in an
    // upstream release only shows up when a user actually selects that theme.
    it.each(themes.map((t) => t.id))("loads a usable extension for %s", async (id) => {
        const theme = getThemeById(id);
        expect(theme).not.toBeNull();
        if (!theme) return;

        const extension = await theme.load();
        expect(extension).toBeTruthy();
        expect(() => EditorState.create({ doc: "x", extensions: [ extension ] })).not.toThrow();
    });

    describe("getThemeById", () => {
        it("finds a theme by its id", () => {
            const first = themes[0];
            expect(getThemeById(first.id)).toBe(first);
            expect(getThemeById(themes[themes.length - 1].id)).toBe(themes[themes.length - 1]);
        });

        it("returns null for an id that no longer exists", () => {
            // A stored option can outlive the theme it names, e.g. after an upgrade drops one.
            expect(getThemeById("theme-that-was-removed")).toBeNull();
            expect(getThemeById("")).toBeNull();
        });
    });
});
