import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NARROW_LAYOUT, STACKED_TREE_LAYOUT } from "../../services/utils";
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

/** Answers `matchMedia()` as a phone, a tablet in portrait or a tablet in landscape would. */
function mockWidth(width: "phone" | "portrait" | "landscape") {
    return vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
        matches: (query === STACKED_TREE_LAYOUT && width === "phone")
            || (query === NARROW_LAYOUT && width !== "landscape"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
    }) as unknown as MediaQueryList);
}

/** Renders the button at a width and clicks it. */
function clickAt(width: "phone" | "portrait") {
    mockWidth(width);

    const container = renderInto(<ToggleSidebarButton />);
    // `SplitNoteContainer` binds this on the `.note-split` the button renders inside.
    const activateSplit = vi.fn();
    container.addEventListener("click", activateSplit);

    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    button?.click();

    expect(activateSplit).not.toHaveBeenCalled();
    return button;
}

describe("ToggleSidebarButton", () => {
    beforeEach(() => {
        triggerCommand.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("goes back to the tree on a phone, where the tree lies under the note, without activating the split it sits in", () => {
        const button = clickAt("phone");

        expect(button?.classList.contains("bx-chevron-left")).toBe(true);
        expect(triggerCommand).toHaveBeenCalledWith("setActiveScreen", { screen: "tree" });
        expect(triggerCommand).not.toHaveBeenCalledWith("toggleLeftPane");
    });

    it("shows and hides the docked tree on a tablet in portrait, whose launch bar sits at the bottom", () => {
        const button = clickAt("portrait");

        expect(button?.classList.contains("bx-sidebar")).toBe(true);
        expect(triggerCommand).toHaveBeenCalledWith("toggleLeftPane");
        expect(triggerCommand).not.toHaveBeenCalledWith("setActiveScreen", expect.anything());
    });

    it("leaves a tablet's sidebar in landscape to the toggle in the launch bar", () => {
        mockWidth("landscape");
        const container = renderInto(<ToggleSidebarButton />);
        expect(container.querySelector(".toggle-sidebar-button")).toBeInstanceOf(HTMLElement);
        expect(container.querySelector("button")).toBeNull();
    });
});
