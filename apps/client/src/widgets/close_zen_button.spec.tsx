import { describe, expect, it, vi } from "vitest";

import Component from "../components/component";
import { renderInto } from "../test/render";
import { LeaveFullScreenButton } from "./close_zen_button";
import { ParentComponent } from "./react/react_utils";

describe("LeaveFullScreenButton", () => {
    it("renders a tab bar button that toggles full screen", () => {
        const parent = new Component();
        const triggerCommand = vi.spyOn(parent, "triggerCommand").mockResolvedValue(undefined);
        const container = renderInto(
            <ParentComponent.Provider value={parent}>
                <LeaveFullScreenButton />
            </ParentComponent.Provider>
        );

        const button = container.querySelector<HTMLButtonElement>(".leave-full-screen-button");
        expect(button).not.toBeNull();
        expect(button?.classList.contains("toggle-button")).toBe(true);
        expect(button?.classList.contains("bx-exit-fullscreen")).toBe(true);

        button?.click();
        expect(triggerCommand).toHaveBeenCalledWith("toggleFullscreen", expect.anything());
    });
});
