import { describe, expect, it } from "vitest";

import { getShortcutOptionValue, parseShortcutInput } from "./shortcuts_model";

describe("shortcuts options model", () => {
    it("serializes an empty shortcut input as an empty effective shortcut override", () => {
        expect(parseShortcutInput("")).toEqual([]);
        expect(getShortcutOptionValue("")).toBe("[]");
    });

    it("parses comma-separated shortcuts while preserving comma keys", () => {
        expect(parseShortcutInput("Ctrl+S, Ctrl+,")).toEqual([
            "Ctrl+S",
            "Ctrl+,"
        ]);
    });
});
