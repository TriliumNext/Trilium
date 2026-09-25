import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import Dropdown from "./Dropdown";

// This spec keeps Bootstrap real for the tooltip and for closing the menu. Dropdown.spec.tsx mocks
// Bootstrap to assert the wiring of the component.

class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

describe("Dropdown tooltip", () => {
    let container: HTMLElement;

    /** Bootstrap defers both the show and its completion, so the tooltip settles a tick after the event. */
    const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
    const shownTooltips = () => document.querySelectorAll(".tooltip").length;

    function mount() {
        act(() => render(<Dropdown title="Show help" iconAction hideToggleArrow>item</Dropdown>, container));
        const toggle = container.querySelector("button");
        expect(toggle).not.toBeNull();
        return toggle as HTMLButtonElement;
    }

    /** Bootstrap listens for `mouseover` and tells a hover from a move within by the related target. */
    const hover = (element: Element) =>
        act(() => { element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: null })); });

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        act(() => render(null, container));
        container.remove();
        for (const orphan of document.querySelectorAll(".tooltip")) {
            orphan.remove();
        }
    });

    it("hangs the tooltip off the wrapper, which Bootstrap will register it against", () => {
        const toggle = mount();
        const wrapper = container.querySelector(".dropdown");

        // Bootstrap moves the `title` of whatever it is initialised on into `data-bs-original-title`, so
        // this says which element it is driving — without reaching into its internals.
        expect(wrapper?.getAttribute("data-bs-original-title"), "driven by the wrapper").toBe("Show help");
        expect(wrapper?.getAttribute("title"), "handed over to Bootstrap").toBeNull();

        // Not the toggle: Bootstrap keeps one component instance per element and the toggle is already
        // the dropdown's, so a tooltip put there is refused registration and can never be disposed.
        expect(toggle.getAttribute("data-bs-original-title"), "not by the toggle").toBeNull();
    });

    it("takes its tooltip down with it, rather than leaving the popup on screen", async () => {
        const toggle = mount();

        await hover(toggle);
        await settle();
        expect(shownTooltips(), "shown on hover").toBe(1);

        // Unmounted with the tooltip still up — a sidebar card rebuilt under the pointer, say. Nothing
        // else would ever take the popup down, so they piled up on screen one hover at a time.
        await act(async () => render(null, container));
        await settle();
        expect(shownTooltips(), "gone with the dropdown").toBe(0);
    });
});

describe("Dropdown with a disabled toggle", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        act(() => render(null, container));
        container.remove();
    });

    it("closes an open menu when the toggle becomes disabled", () => {
        act(() => render(<Dropdown>item</Dropdown>, container));
        const toggle = container.querySelector("button");
        const menu = container.querySelector(".dropdown-menu");
        act(() => toggle?.click());
        expect(menu?.classList.contains("show"), "opened by the click").toBe(true);

        act(() => render(<Dropdown disabled>item</Dropdown>, container));
        expect(menu?.classList.contains("show"), "closed by the disable").toBe(false);
        expect(toggle?.disabled).toBe(true);
        expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    });
});
