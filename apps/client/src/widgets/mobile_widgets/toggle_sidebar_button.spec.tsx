import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderInto } from "../../test/render";

const { triggerCommand } = vi.hoisted(() => ({ triggerCommand: vi.fn() }));

vi.mock("../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks")>()),
    useNoteContext: () => ({
        noteContext: { isMainContext: () => true },
        parentComponent: { triggerCommand }
    }),
    useStaticTooltip: vi.fn()
}));

import ToggleSidebarButton from "./toggle_sidebar_button";

/** Answers `matchMedia()` as a phone or a tablet would. */
function mockWidth(width: "phone" | "tablet") {
    return vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
        matches: width === "phone" && query === "(max-width: 991px)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
    }) as unknown as MediaQueryList);
}

/** Renders the button at a phone or tablet width and clicks it. */
function clickAt(width: "phone" | "tablet") {
    const matchMedia = mockWidth(width);

    const container = renderInto(<ToggleSidebarButton />);
    // `SplitNoteContainer` binds this on the `.note-split` the button renders inside.
    const activateSplit = vi.fn();
    container.addEventListener("click", activateSplit);

    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    button?.click();

    expect(matchMedia).toHaveBeenCalledWith("(max-width: 991px)");
    expect(activateSplit).not.toHaveBeenCalled();
}

describe("ToggleSidebarButton", () => {
    beforeEach(() => {
        triggerCommand.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("opens the sidebar on a phone without activating the split it sits in", () => {
        clickAt("phone");

        expect(triggerCommand).toHaveBeenCalledWith("setActiveScreen", { screen: "tree" });
        expect(triggerCommand).not.toHaveBeenCalledWith("toggleLeftPane");
    });

    it("goes back to the tree on a phone, where the tree lies under the note", () => {
        mockWidth("phone");
        const button = renderInto(<ToggleSidebarButton />).querySelector<HTMLButtonElement>("button.bx-chevron-left");
        expect(button).not.toBeNull();
        button?.click();
        expect(triggerCommand).toHaveBeenCalledWith("setActiveScreen", { screen: "tree" });

        vi.restoreAllMocks();
        mockWidth("tablet");
        expect(renderInto(<ToggleSidebarButton />).querySelector("button.bx-sidebar")).not.toBeNull();
    });

    it("toggles the sidebar on a tablet, where it sits next to the note", () => {
        clickAt("tablet");

        expect(triggerCommand).toHaveBeenCalledWith("toggleLeftPane");
        expect(triggerCommand).not.toHaveBeenCalledWith("setActiveScreen", expect.anything());
    });
});
