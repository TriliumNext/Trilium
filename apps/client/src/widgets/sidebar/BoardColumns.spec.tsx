import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteContextDataMap } from "../../components/note_context";
import options from "../../services/options";
import BoardColumns from "./BoardColumns";

// The board publishes its columns through the note context, which needs the whole app around it,
// so the panel is handed them directly here.
const shown = vi.hoisted(() => ({
    board: null as NoteContextDataMap["boardColumns"] | null
}));
vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));
vi.mock("../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks")>()),
    useGetContextData: () => shown.board
}));

let container: HTMLDivElement;

beforeEach(() => {
    // The widget stands in a RightPanelWidget, which reads which panels the user collapsed.
    options.set("rightPaneCollapsedItems", JSON.stringify([]));
    shown.board = {
        columns: [
            { value: "", title: "Inbox", icon: "bx bxs-inbox", count: 2 },
            { value: "To Do", title: "To Do", icon: "bx bx-circle", count: 7 },
            { value: "Done", title: "Done", icon: "bx bx-check", count: 0 }
        ],
        scrollToColumn: vi.fn()
    };

    container = document.createElement("div");
    document.body.append(container);
});

afterEach(() => {
    act(() => render(null, container));
    container.remove();
    shown.board = null;
});

describe("BoardColumns", () => {
    it("lists the columns in the board's own order, each with its icon and how many it holds", () => {
        renderPanel();

        const entries = [ ...container.querySelectorAll(".board-column-entry") ];
        expect(entries.map((entry) => entry.querySelector(".board-column-name")?.textContent))
            .toEqual([ "Inbox", "To Do", "Done" ]);
        expect(entries.map((entry) => entry.querySelector(".badge")?.textContent))
            .toEqual([ "2", "7", "0" ]);
        expect(entries[1].querySelector("span.bx-circle")).toBeTruthy();
    });

    it("asks the board to scroll to the column that was pressed, by mouse or by keyboard", () => {
        renderPanel();
        const entries = [ ...container.querySelectorAll<HTMLElement>(".board-column-entry") ];

        entries[2].click();
        expect(shown.board?.scrollToColumn).toHaveBeenCalledWith("Done");

        act(() => {
            entries[0].dispatchEvent(
                new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        });
        // The inbox is named by the empty value, which is what it is identified by throughout.
        expect(shown.board?.scrollToColumn).toHaveBeenLastCalledWith("");
    });

    it("says so for a board with no columns at all", () => {
        shown.board = { columns: [], scrollToColumn: vi.fn() };
        renderPanel();

        expect(container.querySelector(".board-column-entry")).toBeNull();
        expect(container.querySelector(".no-columns")?.textContent)
            .toBe("board_view.columns-empty");
    });
});

function renderPanel() {
    act(() => render(<BoardColumns />, container));
}
