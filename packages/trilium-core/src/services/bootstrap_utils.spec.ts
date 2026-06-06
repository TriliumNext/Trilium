import { afterEach, describe, expect, it } from "vitest";

import attributes from "./attributes.js";
import getSharedBootstrapItems, { getIconConfig } from "./bootstrap_utils.js";
import * as cls from "./context.js";
import notes from "./notes.js";
import options from "./options.js";

const ASSET_PATH = "assets-x";

function withTheme<T>(theme: string, fn: () => T): T {
    const previous = options.getOption("theme");
    try {
        cls.init(() => options.setOption("theme", theme));
        return fn();
    } finally {
        cls.init(() => options.setOption("theme", previous));
    }
}

/** Returns the bootstrap payload for an initialized DB, narrowed to the full shape. */
function fullPayload(theme: string) {
    const items = withTheme(theme, () => getSharedBootstrapItems(ASSET_PATH, true));
    if (!("customThemeCssUrl" in items)) {
        throw new Error("Expected the initialized bootstrap payload");
    }
    return items;
}

describe("bootstrap_utils (real DB)", () => {
    afterEach(() => cls.reset());

    it("returns the minimal setup payload before the DB is initialized", () => {
        const items = getSharedBootstrapItems(ASSET_PATH, false);

        expect(items.dbInitialized).toBe(false);
        expect(items.theme).toBe("next");
        expect(items.themeCssUrl).toBe(false);
        expect(items.appCssNoteIds).toEqual([]);
        // Common items + icon config are always present.
        expect(items.assetPath).toBe(ASSET_PATH);
        expect(items.iconRegistry).toBeTruthy();
        expect(typeof items.iconPackCss).toBe("string");
    });

    it("returns the full payload once the DB is initialized, including app CSS note ids", () => {
        const appCssNoteId = cls.init(() => {
            const { note } = notes.createNewNote({
                parentNoteId: "root",
                title: "App CSS",
                content: "body {}",
                type: "code",
                mime: "text/css"
            });
            attributes.createLabel(note.noteId, "appCss", "");
            return note.noteId;
        });

        const items = fullPayload("next");

        expect(items.dbInitialized).toBe(true);
        expect(typeof items.maxEntityChangeIdAtLoad).toBe("number");
        expect(typeof items.maxEntityChangeSyncIdAtLoad).toBe("number");
        expect(items.isProtectedSessionAvailable).toBe(false);
        expect(items.theme).toBe("next");
        expect(items.appCssNoteIds).toContain(appCssNoteId);
    });

    it("maps each built-in theme to its stylesheet URL", () => {
        const expectations: Record<string, string | false> = {
            auto: `${ASSET_PATH}/stylesheets/theme.css`,
            light: false,
            dark: `${ASSET_PATH}/stylesheets/theme-dark.css`,
            next: `${ASSET_PATH}/stylesheets/theme-next.css`,
            "next-light": `${ASSET_PATH}/stylesheets/theme-next-light.css`,
            "next-dark": `${ASSET_PATH}/stylesheets/theme-next-dark.css`
        };

        for (const [theme, expected] of Object.entries(expectations)) {
            const items = fullPayload(theme);
            expect(items.themeCssUrl, `theme=${theme}`).toBe(expected);
            // Built-in themes never expose a custom CSS URL.
            expect(items.customThemeCssUrl, `theme=${theme}`).toBeUndefined();
        }
    });

    it("resolves a custom theme note to a download URL", () => {
        const noteId = cls.init(() => {
            const { note } = notes.createNewNote({
                parentNoteId: "root",
                title: "Custom Theme",
                content: "body {}",
                type: "code",
                mime: "text/css"
            });
            attributes.createLabel(note.noteId, "appTheme", "myCustomTheme");
            attributes.createLabel(note.noteId, "appThemeBase", "next-dark");
            return note.noteId;
        });

        const items = fullPayload("myCustomTheme");
        expect(items.themeCssUrl).toBe(`api/notes/download/${noteId}`);
        expect(items.customThemeCssUrl).toBe(`api/notes/download/${noteId}`);
        expect(items.themeBase).toBe("next-dark");
    });

    it("falls back to the baseline light theme for an unknown theme with no matching note", () => {
        const items = fullPayload("ghostThemeWithoutNote");
        expect(items.themeCssUrl).toBe(false);
        expect(items.customThemeCssUrl).toBeUndefined();
    });

    it("getIconConfig produces an icon registry and CSS", () => {
        const config = getIconConfig(ASSET_PATH);
        expect(config.iconRegistry).toBeTruthy();
        expect(typeof config.iconPackCss).toBe("string");
    });
});
