import { describe, expect, it } from "vitest";

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
});
