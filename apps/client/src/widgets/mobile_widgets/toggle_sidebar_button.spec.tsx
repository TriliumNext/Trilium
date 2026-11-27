import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STACKED_TREE_LAYOUT } from "../../services/utils";
import { renderInto } from "../../test/render";

const { triggerCommand } = vi.hoisted(() => ({ triggerCommand: vi.fn() }));

vi.mock("../react/hooks/note_context", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks/note_context")>()),
    useNoteContext: () => ({
        noteContext: { isMainContext: () => true },
        parentComponent: { triggerCommand }
    })
}));
vi.mock("../react/hooks/tooltip", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks/tooltip")>()),
    useStaticTooltip: vi.fn()
}));

import ToggleSidebarButton from "./toggle_sidebar_button";

/** Answers `matchMedia()` as a phone, whose tree lies under the note, or a tablet would. */
function mockWidth(width: "phone" | "tablet") {
    return vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
        matches: width === "phone" && query === STACKED_TREE_LAYOUT,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
    }) as unknown as MediaQueryList);
}

describe("ToggleSidebarButton", () => {
    beforeEach(() => {
        triggerCommand.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("goes back to the tree on a phone, where the tree lies under the note, without activating the split it sits in", () => {
        mockWidth("phone");
        const container = renderInto(<ToggleSidebarButton />);
        // `SplitNoteContainer` binds this on the `.note-split` the button renders inside.
        const activateSplit = vi.fn();
        container.addEventListener("click", activateSplit);

        const button = container.querySelector<HTMLButtonElement>("button.bx-chevron-left");
        expect(button).not.toBeNull();
        button?.click();
        expect(triggerCommand).toHaveBeenCalledWith("setActiveScreen", { screen: "tree" });
        expect(activateSplit).not.toHaveBeenCalled();
    });

    it("leaves a tablet's docked tree to the toggle in the launch bar", () => {
        mockWidth("tablet");
        const container = renderInto(<ToggleSidebarButton />);
        expect(container.querySelector(".toggle-sidebar-button")).toBeInstanceOf(HTMLElement);
        expect(container.querySelector("button")).toBeNull();
    });

    it("points back to the tree from the right in a right-to-left layout", () => {
        mockWidth("phone");
        glob.isRtl = true;
        try {
            const container = renderInto(<ToggleSidebarButton />);
            expect(container.querySelector("button.bx-chevron-right")).toBeInstanceOf(HTMLElement);
        } finally {
            delete (glob as Partial<typeof glob>).isRtl;
        }
    });
});
