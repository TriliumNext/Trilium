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
