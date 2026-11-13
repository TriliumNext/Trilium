import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../test/render";
import { LaunchBarActionButton, LaunchBarContext, LaunchBarDropdownButton } from "./launch_bar_widgets";

describe("launch bar buttons", () => {
    it("show the launcher's title under the icon in a navigation rail, and only there", () => {
        const labels = (showLabels: boolean) => {
            const container = renderInto(
                <LaunchBarContext.Provider value={{ isHorizontalLayout: !showLabels, showLabels }}>
                    <LaunchBarActionButton icon="bx bx-search" text="Search notes" />
                    <LaunchBarDropdownButton icon="bx bx-calendar" title="Calendar"><div /></LaunchBarDropdownButton>
                </LaunchBarContext.Provider>
            );
            return [ ...container.querySelectorAll(".launcher-button .launcher-button-label") ]
                .map((label) => label.textContent);
        };

        expect(labels(true)).toEqual([ "Search notes", "Calendar" ]);
        expect(labels(false)).toEqual([]);
    });

    it("tell the navigation rail when a launcher's popup opens, besides the launcher's own handler", async () => {
        const onPopupShown = vi.fn();
        const onShown = vi.fn();
        const container = renderInto(
            <LaunchBarContext.Provider value={{ isHorizontalLayout: false, showLabels: true, onPopupShown }}>
                <LaunchBarDropdownButton icon="bx bx-calendar" title="Calendar" onShown={onShown}><div /></LaunchBarDropdownButton>
            </LaunchBarContext.Provider>
        );
        const toggle = container.querySelector<HTMLButtonElement>("button.launcher-button");
        expect(toggle).not.toBeNull();

        await act(async () => toggle?.click());
        expect(onPopupShown).toHaveBeenCalledTimes(1);
        expect(onShown).toHaveBeenCalledTimes(1);
    });
});
