import { Tooltip } from "bootstrap";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `isMobile()` is read once, when the module loads, so the touch branch needs a file of its own; the
 * pointer behaviour is what `ActionButton.spec.tsx` covers.
 */
vi.mock("../../services/utils", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../services/utils")>(),
    isMobile: () => true
}));

import ActionButton from "./ActionButton";

describe("ActionButton on a touch screen", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    it("declines its tooltip where asked, handing the label to assistive technology instead", async () => {
        await act(async () => render(
            <ActionButton icon="bx bx-arrow-back" text="Back" noTooltipOnTouch />, container));

        const button = container.querySelector("button");

        // Nothing to open with the tap that presses the button, and the name is still given.
        expect(button && Tooltip.getInstance(button)).toBeNull();
        expect(button?.getAttribute("aria-label")).toBe("Back");
    });

    it("keeps the tooltip, and leaves the name to it, for a button that did not ask", async () => {
        await act(async () => render(
            <ActionButton icon="bx bx-refresh" text="Measure again" />, container));

        const button = container.querySelector("button");

        expect(button && Tooltip.getInstance(button)).not.toBeNull();
        expect(button?.getAttribute("aria-label")).toBeNull();
    });
});
