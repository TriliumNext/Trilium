import { Dialog, Dropdown } from "@univerjs/design";
import { options, render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installRadixPortalFixes } from "./radix_portals";

describe("installRadixPortalFixes", () => {
    let uninstall: () => void;
    let container: HTMLElement | undefined;

    beforeEach(() => {
        uninstall = installRadixPortalFixes(document);
    });

    afterEach(() => {
        if (container) {
            const mounted = container;
            act(() => render(null, mounted));
            container = undefined;
        }
        uninstall();
        document.body.replaceChildren();
    });

    it("keeps Univer's dialog open when an item in a dropdown inside it is picked", async () => {
        const onClose = vi.fn();
        const onSelect = vi.fn();

        // Mirrors `SortOptionItem` in `@univerjs/sheets-sort-ui`, which closes its dropdown on pick.
        function Panel() {
            const [ visible, setVisible ] = useState(false);
            const pick = () => {
                onSelect();
                setVisible(false);
            };
            return (
                <Dialog open mask draggable onClose={onClose}>
                    <Dropdown
                        open={visible}
                        onOpenChange={setVisible}
                        overlay={<ul><li id="option" onClick={pick}>Column B</li></ul>}
                    >
                        <button id="trigger">Column A</button>
                    </Dropdown>
                </Dialog>
            );
        }

        const mounted = document.createElement("div");
        container = mounted;
        const sheet = document.createElement("div");
        document.body.append(mounted, sheet);
        act(() => render(<Panel />, mounted));
        await waitForRadix();

        await click(getElement("#trigger"));
        await click(getElement("#option"));
        expect(onSelect).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();

        await click(sheet);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it("keeps a layer open when a dropdown portaled out of it is focused", () => {
        document.body.innerHTML = `
            <div id="radix-dialog"><button aria-controls="radix-dropdown">Column A</button></div>
            <div id="radix-dropdown"><ul><li id="option">Column B</li></ul></div>
            <div id="sheet"></div>
        `;
        const name = "dismissableLayer.focusOutside";

        const inPortal = dispatchOutsideEvent(getElement("#option"), name);
        expect(inPortal.onFocusOutside).not.toHaveBeenCalled();
        expect(inPortal.onDismiss).not.toHaveBeenCalled();

        const onSheet = dispatchOutsideEvent(getElement("#sheet"), name);
        expect(onSheet.onFocusOutside).toHaveBeenCalledOnce();
        expect(onSheet.onDismiss).toHaveBeenCalledOnce();
    });

    it("keeps a cell popup open while a menu opened from inside it is clicked", () => {
        document.body.innerHTML = `
            <section data-u-comp="rect-popup">
                <div data-u-comp="select" aria-controls="radix-select">Contains</div>
            </section>
            <div id="radix-select">
                <div id="condition">Equals</div>
                <div id="submenu-trigger" aria-controls="radix-submenu">More</div>
            </div>
            <div id="radix-submenu"><div id="nested">Begins with</div></div>
            <div data-u-comp="toolbar"><button aria-controls="radix-toolbar-menu">Sort</button></div>
            <div id="radix-toolbar-menu"><div id="toolbar-item">Sort A to Z</div></div>
        `;
        const onWindowPointerDown = vi.fn();
        window.addEventListener("pointerdown", onWindowPointerDown);
        try {
            for (const selector of [ "#condition", "#nested", "#toolbar-item" ]) {
                getElement(selector).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            }
            expect(onWindowPointerDown).toHaveBeenCalledOnce();
            expect(onWindowPointerDown.mock.calls[0][0].target).toBe(getElement("#toolbar-item"));
        } finally {
            window.removeEventListener("pointerdown", onWindowPointerDown);
        }
    });
});

/** Radix registers its document `pointerdown` listener in a `setTimeout(0)` after mounting. */
async function waitForRadix() {
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

/**
 * Dispatches the event sequence of a primary-button mouse click.
 *
 * A browser runs microtasks, and with them Preact's renders, between the listeners of an event it
 * dispatches itself, so a state change in a listener reaches the DOM before the next listener runs.
 * `debounceRendering` renders synchronously to match, which a script-dispatched event does not.
 */
async function click(target: HTMLElement) {
    const previousDebounce = options.debounceRendering;
    options.debounceRendering = (callback) => callback();
    try {
        const init = { bubbles: true, cancelable: true, button: 0 };
        target.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse" }));
        target.dispatchEvent(new MouseEvent("mousedown", init));
        target.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerType: "mouse" }));
        target.dispatchEvent(new MouseEvent("mouseup", init));
        target.dispatchEvent(new MouseEvent("click", init));
    } finally {
        options.debounceRendering = previousDebounce;
    }
    await waitForRadix();
}

/** Dispatches an outside event the way Radix's `DismissableLayer` does, returning its callbacks. */
function dispatchOutsideEvent(target: Element, name: string) {
    const onFocusOutside = vi.fn();
    const onDismiss = vi.fn();
    target.addEventListener(name, (e) => {
        onFocusOutside(e);
        if (!e.defaultPrevented) onDismiss();
    }, { once: true });
    target.dispatchEvent(new CustomEvent(name, { bubbles: false, cancelable: true }));
    return { onFocusOutside, onDismiss };
}

function getElement(selector: string) {
    const element = document.querySelector(selector);
    expect(element).toBeInstanceOf(HTMLElement);
    return element as HTMLElement;
}
