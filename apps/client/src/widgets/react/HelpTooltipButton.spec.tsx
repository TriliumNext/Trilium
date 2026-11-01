import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The tooltip itself is Bootstrap's; what this component decides is the configuration it hands over,
// so the hook is stubbed and the configuration asserted on.
const useStaticTooltip = vi.hoisted(() => vi.fn());
vi.mock("./hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./hooks")>()),
    useStaticTooltip
}));

import HelpTooltipButton from "./HelpTooltipButton";

describe("HelpTooltipButton", () => {
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

    it("is a help icon of its own, reachable by keyboard, when it has no page to open", () => {
        act(() => render(<HelpTooltipButton description="A <code>value</code>." className="extra" />, container));

        const span = container.querySelector("span");
        expect(span?.className).toContain("help-tooltip-button");
        expect(span?.className).toContain("extra");
        // No button of its own, so the icon is drawn by the wrapper and is its own tab stop.
        expect(span?.className).toContain("bx bx-help-circle");
        expect(span?.getAttribute("tabindex")).toBe("0");
        expect(container.querySelector("button")).toBeNull();

        // Markup in the explanation is rendered rather than shown as text.
        expect(useStaticTooltip).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
            title: "A <code>value</code>.",
            html: true,
            placement: "top"
        }));
    });

    it("holds the help page's button instead, leaving that button the only tab stop", () => {
        act(() => render(
            <HelpTooltipButton description="Explained." helpPage="abc123" placement="right" />, container));

        const span = container.querySelector("span");
        expect(span?.className).not.toContain("bx-help-circle");
        expect(span?.getAttribute("tabindex")).toBeNull();
        // The button carries no title of its own: the explanation is the tooltip here.
        expect(container.querySelector("button")?.getAttribute("title")).toBe("");

        expect(useStaticTooltip).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
            placement: "right"
        }));
    });
});
