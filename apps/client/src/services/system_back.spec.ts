import { describe, expect, it, vi } from "vitest";

import { handleSystemBack, onSystemBack } from "./system_back";

describe("system back", () => {
    it("asks the newest handler first, skips one with nothing to go back from, and forgets a removed one", () => {
        const note = vi.fn(() => true);
        const dialog = vi.fn(() => true);
        const idleMenu = vi.fn(() => false);
        const stopNote = onSystemBack(note);
        const stopDialog = onSystemBack(dialog);
        const stopMenu = onSystemBack(idleMenu);

        expect(handleSystemBack()).toBe(true);
        expect(idleMenu).toHaveBeenCalledOnce();
        expect(dialog).toHaveBeenCalledOnce();
        expect(note).not.toHaveBeenCalled();

        stopDialog();
        expect(handleSystemBack()).toBe(true);
        expect(note).toHaveBeenCalledOnce();

        stopNote();
        expect(handleSystemBack()).toBe(false);
        stopMenu();
    });
});
