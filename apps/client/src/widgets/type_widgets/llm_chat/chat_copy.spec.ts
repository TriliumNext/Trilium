import { describe, expect, it } from "vitest";

import { canCopyMessage } from "./chat_copy.js";

describe("canCopyMessage", () => {
    it("offers the command with no selection and a non-empty message", () => {
        expect(canCopyMessage(false, "some reply text")).toBe(true);
    });

    it("hides the command when text is selected (the selection commands apply instead)", () => {
        expect(canCopyMessage(true, "some reply text")).toBe(false);
    });

    it("hides the command when the message has no text to copy", () => {
        expect(canCopyMessage(false, "")).toBe(false);
        expect(canCopyMessage(false, "   \n\t ")).toBe(false);
    });
});
