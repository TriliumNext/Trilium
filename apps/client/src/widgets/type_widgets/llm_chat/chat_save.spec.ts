import { describe, expect, it } from "vitest";

import { canSaveToSubNote } from "./chat_save.js";

describe("canSaveToSubNote", () => {
    it("offers the command in a note chat with no selection and a non-empty message", () => {
        expect(canSaveToSubNote("root/abc", false, "some reply text")).toBe(true);
    });

    it("hides the command when text is selected (the selection commands apply instead)", () => {
        expect(canSaveToSubNote("root/abc", true, "some reply text")).toBe(false);
    });

    it("hides the command outside a note chat (no parent note path)", () => {
        expect(canSaveToSubNote(undefined, false, "some reply text")).toBe(false);
        expect(canSaveToSubNote(null, false, "some reply text")).toBe(false);
    });

    it("hides the command when the message has no text to save", () => {
        expect(canSaveToSubNote("root/abc", false, "")).toBe(false);
        expect(canSaveToSubNote("root/abc", false, "   \n\t ")).toBe(false);
    });
});
