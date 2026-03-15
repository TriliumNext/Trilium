import { describe, expect, it } from "vitest";

import { shouldAutocompleteHandleEnterKey } from "./attribute_autocomplete.js";

describe("attribute autocomplete enter handling", () => {
    it("delegates plain Enter when the panel is open and an item is active", () => {
        expect(shouldAutocompleteHandleEnterKey(
            { key: "Enter", ctrlKey: false, metaKey: false },
            { isPanelOpen: true, hasActiveItem: true }
        )).toBe(true);
    });

    it("does not delegate plain Enter when there is no active suggestion", () => {
        expect(shouldAutocompleteHandleEnterKey(
            { key: "Enter", ctrlKey: false, metaKey: false },
            { isPanelOpen: true, hasActiveItem: false }
        )).toBe(false);
    });

    it("does not delegate plain Enter when the panel is closed", () => {
        expect(shouldAutocompleteHandleEnterKey(
            { key: "Enter", ctrlKey: false, metaKey: false },
            { isPanelOpen: false, hasActiveItem: false }
        )).toBe(false);
    });

    it("does not delegate Ctrl+Enter even when an item is active", () => {
        expect(shouldAutocompleteHandleEnterKey(
            { key: "Enter", ctrlKey: true, metaKey: false },
            { isPanelOpen: true, hasActiveItem: true }
        )).toBe(false);
    });

    it("does not delegate Cmd+Enter even when an item is active", () => {
        expect(shouldAutocompleteHandleEnterKey(
            { key: "Enter", ctrlKey: false, metaKey: true },
            { isPanelOpen: true, hasActiveItem: true }
        )).toBe(false);
    });

    it("ignores non-Enter keys", () => {
        expect(shouldAutocompleteHandleEnterKey(
            { key: "ArrowDown", ctrlKey: false, metaKey: false },
            { isPanelOpen: false, hasActiveItem: false }
        )).toBe(true);
    });
});
