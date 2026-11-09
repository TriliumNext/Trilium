import { describe, expect, it, vi } from "vitest";

const useStaticTooltip = vi.hoisted(() => vi.fn());
vi.mock("./hooks", () => ({ useStaticTooltip }));

import { renderInto } from "../../test/render";
import TabStrip from "./TabStrip";

const tabs = [
    { id: "outline", title: "Outline", icon: "bx bx-list-ul" },
    { id: "chat", title: "AI chat", icon: "bx bx-bot" }
] as const;

describe("TabStrip", () => {
    it("names each icon by its tooltip, and selects a tab on a click", () => {
        const onSelect = vi.fn();
        const container = renderInto(<TabStrip tabs={[ ...tabs ]} activeTabId="chat" onSelect={onSelect} />);
        const buttons = [ ...container.querySelectorAll("button.tab-strip-tab") ];

        expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([ "Outline", "AI chat" ]);
        expect(buttons.map((b) => b.getAttribute("aria-selected"))).toEqual([ "false", "true" ]);
        expect(container.querySelectorAll(".tab-strip-tab-icon")).toHaveLength(2);
        expect(container.querySelector(".tab-strip-tab-label")).toBeNull();
        expect(useStaticTooltip).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: "Outline" }));

        (buttons[0] as HTMLButtonElement).click();
        expect(onSelect).toHaveBeenCalledWith("outline");
    });

    it("names each tab in text when labelled, with its icon above only when asked to", () => {
        useStaticTooltip.mockClear();
        const labelled = renderInto(<TabStrip tabs={[ ...tabs ]} onSelect={vi.fn()} labelled />);
        expect(labelled.querySelector(".tab-strip")?.classList.contains("tab-strip-labelled")).toBe(true);
        expect([ ...labelled.querySelectorAll(".tab-strip-tab-label") ].map((l) => l.textContent)).toEqual([ "Outline", "AI chat" ]);
        expect(labelled.querySelector(".tab-strip-tab-icon")).toBeNull();
        expect(labelled.querySelector("button")?.hasAttribute("aria-label")).toBe(false);
        expect(useStaticTooltip).toHaveBeenCalledWith(expect.anything(), undefined);
        expect(useStaticTooltip).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: "Outline" }));

        const withIcons = renderInto(<TabStrip tabs={[ ...tabs ]} onSelect={vi.fn()} labelled withIcons />);
        expect(withIcons.querySelector(".tab-strip")?.classList.contains("tab-strip-with-icons")).toBe(true);
        expect(withIcons.querySelectorAll(".tab-strip-tab-icon")).toHaveLength(2);
        expect(withIcons.querySelectorAll(".tab-strip-tab-label")).toHaveLength(2);
    });
});
