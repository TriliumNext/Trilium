import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

const menuItems = vi.hoisted(() => ({ loaded: false }));
vi.mock("./mobile_detail_menu_items", async (importOriginal) => {
    menuItems.loaded = true;
    return await importOriginal<typeof import("./mobile_detail_menu_items")>();
});
const noteContext = vi.hoisted(() => ({ noteId: "" }));
vi.mock("../react/hooks/note_context", async (importOriginal) => {
    const original = await importOriginal<typeof import("../react/hooks/note_context")>();
    const { default: froca } = await import("../../services/froca");
    return {
        ...original,
        useNoteContext: () => ({
            note: froca.getNoteFromCache(noteContext.noteId),
            noteContext: undefined,
            parentComponent: undefined,
            ntxId: "main",
            viewScope: { viewMode: "default" },
            hoistedNoteId: "root"
        })
    };
});

import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import MobileDetailMenu from "./mobile_detail_menu";

describe("MobileDetailMenu", () => {
    it("loads the menu's rows and dialogs once its toggle is pressed", async () => {
        noteContext.noteId = buildNote({ id: "menuNote", title: "Menu note" }).noteId;
        const container = renderInto(<MobileDetailMenu />);
        const toggle = container.querySelector<HTMLButtonElement>(".note-actions button");
        expect(toggle).toBeInstanceOf(HTMLButtonElement);
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
        expect(menuItems.loaded).toBe(false);

        act(() => { toggle?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
        await vi.waitFor(() => expect(menuItems.loaded).toBe(true));
    });
});
