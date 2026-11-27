import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteContextDataMap } from "../../components/note_context";
import options from "../../services/options";
import ChatHighlightsList from "./ChatHighlightsList";
import { NavigatedInNote } from "./RightPanelWidget";

const shown = vi.hoisted(() => ({
    chat: null as NoteContextDataMap["chatHighlights"] | null
}));
vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));
vi.mock("../react/hooks/tree", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks/tree")>()),
    useGetContextData: () => shown.chat
}));

let container: HTMLDivElement;

beforeEach(() => {
    options.set("rightPaneCollapsedItems", JSON.stringify([]));
    shown.chat = {
        highlights: [
            { id: "h1", text: "First quote" },
            { id: "h2", text: "Second quote" }
        ],
        scrollToHighlight: vi.fn(),
        removeHighlight: vi.fn()
    } as unknown as NoteContextDataMap["chatHighlights"];

    container = document.createElement("div");
    document.body.append(container);
});

afterEach(() => {
    act(() => render(null, container));
    container.remove();
    shown.chat = null;
});

describe("ChatHighlightsList", () => {
    it("scrolls to the highlight and tells the mobile panel, by mouse or by keyboard", () => {
        const onNavigated = vi.fn();
        act(() => render(
            <NavigatedInNote.Provider value={onNavigated}>
                <ChatHighlightsList />
            </NavigatedInNote.Provider>, container));
        const rows = [ ...container.querySelectorAll<HTMLElement>(".chat-highlight-text") ];

        rows[1].click();
        expect(shown.chat?.scrollToHighlight).toHaveBeenCalledWith("h2");
        expect(onNavigated).toHaveBeenCalledTimes(1);

        act(() => {
            rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        });
        expect(shown.chat?.scrollToHighlight).toHaveBeenLastCalledWith("h1");
        expect(onNavigated).toHaveBeenCalledTimes(2);
    });
});
