import { afterEach, describe, expect, it, vi } from "vitest";

import type NoteContext from "../components/note_context";
import protectedSessionHolder from "../services/protected_session_holder";
import { buildNote } from "../test/easy-froca";
import TabRowWidget from "./tab_row";

vi.mock("../services/i18n", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../services/i18n")>()),
    t: (key: string) => key
}));

describe("TabRowWidget.updateTabTitle", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    async function renderTitle(isUnlocked: boolean) {
        vi.spyOn(protectedSessionHolder, "isProtectedSessionAvailable").mockReturnValue(isUnlocked);
        const note = buildNote({ title: "Secret" });
        note.isProtected = true;
        const context = {
            note,
            ntxId: "ntx",
            getNavigationTitle: async () => note.title
        } as unknown as NoteContext;
        const $tab = $(`<div><div class="note-tab-title"></div></div>`);

        await new TabRowWidget().updateTabTitle($tab, [ context ], "ntx", false);
        return $tab;
    }

    it("shows Protected and a lock in caption and tooltip while locked", async () => {
        const $locked = await renderTitle(false);
        const $segment = $locked.find(".note-tab-segment");
        const label = $segment.find(".protected-title").text();
        expect(label).toBe("protected_session.locked_note_title");
        expect($segment.children().last().is(".protected-icon.bx-lock-alt")).toBe(true);
        expect($segment.text()).not.toContain("Secret");
        expect($locked.attr("data-tab-title")).toBe($segment.html());
        expect($segment.html()).toContain("bx-lock-alt");

        const $unlocked = await renderTitle(true);
        expect($unlocked.find(".note-tab-segment").text()).toBe("Secret");
        expect($unlocked.find(".protected-icon").length).toBe(0);
        expect($unlocked.attr("data-tab-title")).toBe("Secret");
    });
});
