import type { OptionNames } from "@triliumnext/commons";
import { afterEach, describe, expect, it, vi } from "vitest";

// `t` is imported as a named ESM export by keyboard_actions, which cannot be
// spied directly. Mock i18next so we can force a "translations not loaded yet"
// state on demand while delegating to the real implementation otherwise.
const translationState = vi.hoisted(() => ({ broken: false }));
vi.mock("i18next", async (importOriginal) => {
    const actual = await importOriginal<typeof import("i18next")>();
    return {
        ...actual,
        t: (...args: unknown[]) => (translationState.broken ? "" : (actual.t as unknown as (...a: unknown[]) => unknown)(...args))
    };
});

import * as cls from "./context.js";
import keyboardActions from "./keyboard_actions.js";
import options from "./options.js";
import { getPlatform, initPlatform } from "./platform.js";
import * as utils from "./utils/index.js";

function upsertOption(name: string, value: string) {
    cls.init(() => {
        if (options.getOptionOrNull(name as OptionNames) !== null) {
            options.setOption(name as OptionNames, value);
        } else {
            options.createOption(name as OptionNames, value, false);
        }
    });
}

describe("keyboard_actions service", () => {
    afterEach(() => {
        translationState.broken = false;
        vi.restoreAllMocks();
    });

    it("getDefaultKeyboardActions returns the action definitions", () => {
        const actions = keyboardActions.getDefaultKeyboardActions();
        expect(Array.isArray(actions)).toBe(true);
        expect(actions.some((a) => "actionName" in a && a.actionName === "jumpToNote")).toBe(true);
    });

    it("getKeyboardActions gives an action with no stored shortcuts its defaults", () => {
        vi.spyOn(options, "getOptions").mockReturnValue([]);

        const jumpToNote = keyboardActions.getKeyboardActions()
            .find((a) => "actionName" in a && a.actionName === "jumpToNote");

        expect(jumpToNote && "effectiveShortcuts" in jumpToNote && jumpToNote.effectiveShortcuts)
            .toEqual(jumpToNote && "defaultShortcuts" in jumpToNote && jumpToNote.defaultShortcuts);
        expect(jumpToNote && "defaultShortcuts" in jumpToNote && jumpToNote.defaultShortcuts?.length)
            .toBeGreaterThan(0);
    });

    it("zoomIn is bound to the plus key as well as equals, so it works on non-US layouts", () => {
        const shortcutsOf = (actionName: string) => {
            const action = keyboardActions.getDefaultKeyboardActions()
                .find((a) => "actionName" in a && a.actionName === actionName);
            return (action && "defaultShortcuts" in action && action.defaultShortcuts) || [];
        };

        vi.spyOn(utils, "isElectron").mockReturnValue(false);
        expect(shortcutsOf("zoomIn")).toEqual([]);

        vi.spyOn(utils, "isElectron").mockReturnValue(true);
        vi.spyOn(utils, "isMac").mockReturnValue(false);
        expect(shortcutsOf("zoomIn")).toEqual([ "Ctrl+=", "Ctrl+Plus" ]);
        // The other desktop-only bindings come with it.
        for (const actionName of [ "openNewTab", "closeActiveTab", "reopenLastTab", "activateNextTab",
            "activatePreviousTab", "openDevTools", "findInText", "zoomOut", "zoomReset" ]) {
            expect(shortcutsOf(actionName).length, actionName).toBeGreaterThan(0);
        }
    });

    it("ships the split actions unbound and in a section of their own", () => {
        const actions = keyboardActions.getDefaultKeyboardActions();

        const splitActions = [
            "openNewNoteSplit", "closeActiveNoteSplit", "moveActiveNoteSplitLeft", "moveActiveNoteSplitRight",
            "focusNoteSplitLeft", "focusNoteSplitRight"
        ];

        for (const actionName of splitActions) {
            const action = actions.find((a) => "actionName" in a && a.actionName === actionName);
            expect(action, actionName).toBeDefined();
            expect(action && "defaultShortcuts" in action && action.defaultShortcuts, actionName).toEqual([]);
        }

        // The options page buckets each action under the separator preceding it, and with nothing
        // bound by default that page is the only way to reach these -- so the six make up a section
        // of their own, rather than trailing the two dozen tab actions.
        const firstIndex = actions.findIndex((a) => "actionName" in a && a.actionName === splitActions[0]);
        expect(actions[firstIndex - 1]).toHaveProperty("separator");
        expect(actions.slice(firstIndex, firstIndex + splitActions.length)
            .map((a) => "actionName" in a && a.actionName)).toEqual(splitActions);
        expect(actions[firstIndex + splitActions.length]).toHaveProperty("separator");
    });

    it.each([
        [true, { jumpToNote: ["Meta+J"], backInNoteHistory: ["Meta+["] }],
        [false, { jumpToNote: ["Ctrl+J"], backInNoteHistory: ["Alt+Left"] }]
    ])("resolves CommandOrControl and the history bindings for isMac=%s", (isMac, expected) => {
        const real = getPlatform();
        initPlatform(Object.create(real, { isMac: { value: isMac } }));

        try {
            const actions = keyboardActions.getDefaultKeyboardActions();

            for (const [actionName, shortcuts] of Object.entries(expected)) {
                const action = actions.find((a) => "actionName" in a && a.actionName === actionName);
                expect(action, actionName).toBeDefined();
                expect(action && "defaultShortcuts" in action && action.defaultShortcuts, actionName).toEqual(shortcuts);
            }
        } finally {
            initPlatform(real);
        }
    });

    it("throws if loaded before translations are available", async () => {
        // keyboard_actions was already evaluated during the bootstrap (binding the
        // real i18next), so re-import a fresh copy that picks up the mocked module.
        vi.resetModules();
        translationState.broken = true;
        const freshModule = (await import("./keyboard_actions.js")).default;
        expect(() => freshModule.getDefaultKeyboardActions()).toThrow(/before translations/);
    });

    it("getKeyboardActions overlays stored shortcuts and handles bad / unknown options", () => {
        // A real action with an invalid JSON value -> parse error is logged, not thrown.
        upsertOption("keyboardShortcutsJumpToNote", "not-json");
        // An option referencing a non-existent action -> logged and skipped.
        upsertOption("keyboardShortcutsNoSuchAction", "[]");

        const actions = keyboardActions.getKeyboardActions();
        expect(Array.isArray(actions)).toBe(true);
        // The action is still present despite the unparseable override.
        expect(actions.some((a) => "actionName" in a && a.actionName === "jumpToNote")).toBe(true);
    });
});
