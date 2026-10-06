import { describe, expect, it, vi } from "vitest";

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

describe("ToggleSidebarButton", () => {
    it("opens the sidebar without activating the split it sits in", () => {
        const container = renderInto(<ToggleSidebarButton />);
        // `SplitNoteContainer` binds this on the `.note-split` the button renders inside.
        const activateSplit = vi.fn();
        container.addEventListener("click", activateSplit);

        const button = container.querySelector("button");
        expect(button).not.toBeNull();
        button?.click();

        expect(triggerCommand).toHaveBeenCalledWith("setActiveScreen", { screen: "tree" });
        expect(activateSplit).not.toHaveBeenCalled();
    });
});
