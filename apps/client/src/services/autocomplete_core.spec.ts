import $ from "jquery";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
    showSpy,
    hideSpy,
    updateDisplayedShortcutsSpy,
    saveFocusedElementSpy,
    focusSavedElementSpy
} = vi.hoisted(() => ({
    showSpy: vi.fn(),
    hideSpy: vi.fn(),
    updateDisplayedShortcutsSpy: vi.fn(),
    saveFocusedElementSpy: vi.fn(),
    focusSavedElementSpy: vi.fn()
}));

vi.mock("bootstrap", () => ({
    Modal: {
        getOrCreateInstance: vi.fn(() => ({
            show: showSpy,
            hide: hideSpy
        }))
    }
}));

vi.mock("./keyboard_actions.js", () => ({
    default: {
        updateDisplayedShortcuts: updateDisplayedShortcutsSpy
    }
}));

vi.mock("./focus.js", () => ({
    saveFocusedElement: saveFocusedElementSpy,
    focusSavedElement: focusSavedElementSpy
}));

import { closeAllHeadlessAutocompletes, registerHeadlessAutocompleteCloser } from "./autocomplete_core.js";
import { openDialog } from "./dialog.js";

describe("headless autocomplete closing", () => {
    const unregisterClosers: Array<() => void> = [];

    beforeEach(() => {
        vi.clearAllMocks();
        (window as any).glob = {
            ...(window as any).glob,
            activeDialog: null
        };
    });

    afterEach(() => {
        while (unregisterClosers.length > 0) {
            unregisterClosers.pop()?.();
        }
    });

    it("closes every registered closer and skips unregistered ones", () => {
        const closer1 = vi.fn();
        const closer2 = vi.fn();
        const closer3 = vi.fn();

        unregisterClosers.push(registerHeadlessAutocompleteCloser(closer1));
        const unregister2 = registerHeadlessAutocompleteCloser(closer2);
        unregisterClosers.push(unregister2);
        unregisterClosers.push(registerHeadlessAutocompleteCloser(closer3));

        unregister2();

        closeAllHeadlessAutocompletes();

        expect(closer1).toHaveBeenCalledTimes(1);
        expect(closer2).not.toHaveBeenCalled();
        expect(closer3).toHaveBeenCalledTimes(1);
    });

    it("closes registered autocompletes when a dialog finishes hiding", async () => {
        const closer = vi.fn();
        unregisterClosers.push(registerHeadlessAutocompleteCloser(closer));

        const dialogEl = document.createElement("div");
        const $dialog = $(dialogEl);

        await openDialog($dialog, false);
        $dialog.trigger("hidden.bs.modal");

        expect(showSpy).toHaveBeenCalledTimes(1);
        expect(updateDisplayedShortcutsSpy).toHaveBeenCalledWith($dialog);
        expect(saveFocusedElementSpy).toHaveBeenCalledTimes(1);
        expect(closer).toHaveBeenCalledTimes(1);
        expect(focusSavedElementSpy).toHaveBeenCalledTimes(1);
    });
});
