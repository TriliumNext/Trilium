import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The strip's names live in tooltips only; Bootstrap's own machinery is not what is under test here.
const useStaticTooltip = vi.hoisted(() => vi.fn());
vi.mock("../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks")>()),
    useStaticTooltip
}));

import RightPaneTabs, { RightPaneTabDefinition } from "./RightPaneTabs";

const TABS: RightPaneTabDefinition[] = [
    { id: "outline", title: "Outline", icon: "bx bx-list-ul", alwaysShown: true },
    { id: "attributes", title: "Attributes", icon: "bx bx-hash" }
];

describe("RightPaneTabs", () => {
    let container: HTMLElement;

    beforeEach(() => {
        vi.clearAllMocks();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    it("draws a tab per group, names it where a name can be read, and marks the one on show", () => {
        const onSelect = vi.fn();
        act(() => render(
            <RightPaneTabs tabs={TABS} activeTabId={TABS[1].id} onSelect={onSelect} />, container));

        const buttons = [ ...container.querySelectorAll<HTMLButtonElement>("[role=tab]") ];
        expect(container.querySelector("[role=tablist]")).not.toBeNull();
        expect(buttons).toHaveLength(2);
        expect(buttons.map((button) => button.getAttribute("aria-selected"))).toEqual([ "false", "true" ]);
        expect(buttons[1].className).toContain("active");
        expect(buttons[0].className).not.toContain("active");
        // The icon is all the strip shows, so the name has to reach the accessibility tree by itself.
        expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([ "Outline", "Attributes" ]);
        expect(buttons[0].querySelector("span")?.className).toContain("bx-list-ul");
        expect(useStaticTooltip).toHaveBeenCalledTimes(2);

        act(() => buttons[0].click());
        expect(onSelect).toHaveBeenCalledExactlyOnceWith("outline");
    });
});
