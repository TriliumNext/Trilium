import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

// Bootstrap's tooltip machinery is not what is under test here.
const useStaticTooltipWithKeyboardShortcut = vi.hoisted(() => vi.fn());
vi.mock("./hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./hooks")>()),
    useStaticTooltipWithKeyboardShortcut
}));

import PeekPaneButton, { type PaneSide } from "./PeekPaneButton";

describe("PeekPaneButton", () => {
    const host = document.createElement("div");

    afterEach(() => {
        act(() => render(null, host));
    });

    it("points the arrow into the content to peek and out of it to hide, from either edge", () => {
        expect(arrow("start", false)).toBe("bx-chevron-right");
        expect(arrow("start", true)).toBe("bx-chevron-left");
        expect(arrow("end", false)).toBe("bx-chevron-left");
        expect(arrow("end", true)).toBe("bx-chevron-right");
    });

    it("names the action a press takes, and hands the press to the pane", () => {
        const onToggle = vi.fn();
        const button = renderButton("start", false, onToggle);
        expect(button.getAttribute("aria-label")).toBe("Peek");
        expect(useStaticTooltipWithKeyboardShortcut).toHaveBeenLastCalledWith(
            expect.anything(), "Peek", "peekLeftPane", expect.anything()
        );
        expect(button.classList.contains("my-peek-button")).toBe(true);
        expect(button.classList.contains("side-start")).toBe(true);
        expect(button.classList.contains("peek-pane-button-action-expand")).toBe(true);

        button.click();
        expect(onToggle).toHaveBeenCalledTimes(1);

        const openButton = renderButton("start", true, onToggle);
        expect(openButton.getAttribute("aria-label")).toBe("Hide");
        expect(openButton.classList.contains("peek-pane-button-action-collapse")).toBe(true);
    });

    function arrow(side: PaneSide, isOpen: boolean) {
        const button = renderButton(side, isOpen, () => {});
        const chevrons = [ ...button.classList ].filter((name) => name.startsWith("bx-chevron-"));
        expect(chevrons).toHaveLength(1);
        return chevrons[0];
    }

    function renderButton(side: PaneSide, isOpen: boolean, onToggle: () => void) {
        act(() => render(
            <PeekPaneButton
                side={side}
                isOpen={isOpen}
                onToggle={onToggle}
                className="my-peek-button"
                hideText="Hide"
                peekText="Peek"
                keyboardAction="peekLeftPane"
            />,
            host
        ));
        const button = host.querySelector("button");
        if (!button) throw new Error("PeekPaneButton rendered no button");
        return button;
    }
});
