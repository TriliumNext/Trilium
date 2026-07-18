import $ from "jquery";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A single fake Bootstrap dropdown instance so the component wiring (dropdownRef, `_menu`
// re-pointing, dispose-on-unmount) can be asserted without real Bootstrap/Popper.
const { instance, getOrCreateInstance } = vi.hoisted(() => {
    const instance = {
        show: vi.fn(),
        hide: vi.fn(),
        update: vi.fn(),
        dispose: vi.fn(),
        _menu: null as HTMLElement | null
    };
    return { instance, getOrCreateInstance: vi.fn(() => instance) };
});

vi.mock("bootstrap", () => ({
    Dropdown: { getOrCreateInstance },
    Tooltip: class {}
}));

// Stub only the Bootstrap-Tooltip hook; keep the rest of the hooks module real. The stubs must be
// referentially stable across renders — onShown/onHidden depend on hideTooltip's identity.
const tooltipStub = vi.hoisted(() => ({ showTooltip: vi.fn(), hideTooltip: vi.fn() }));
vi.mock("./hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./hooks")>()),
    useTooltip: () => tooltipStub
}));

import Dropdown from "./Dropdown";

// happy-dom has no ResizeObserver; the component only needs observe/disconnect to exist.
class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

let container: HTMLDivElement | undefined;
function renderInto(vnode: preact.ComponentChild) {
    const el = document.createElement("div");
    container = el;
    document.body.appendChild(el);
    void act(() => render(vnode, el));
    return el;
}

function getToggle() {
    const button = container?.querySelector("button");
    expect(button).toBeTruthy();
    return button as HTMLButtonElement;
}

function fire(target: EventTarget, eventName: string) {
    void act(() => {
        target.dispatchEvent(new Event(eventName, { bubbles: true }));
    });
}

describe("Dropdown", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        instance._menu = null;
    });

    afterEach(() => {
        if (container) {
            const el = container;
            void act(() => render(null, el));
            el.remove();
            container = undefined;
        }
    });

    it("renders a non-portaled menu inline, exposes the instance via dropdownRef and disposes it on unmount", () => {
        const dropdownRef = { current: null };
        const el = renderInto(<Dropdown dropdownRef={dropdownRef}>item</Dropdown>);

        // Menu is nested next to the toggle, not in the body.
        expect(el.querySelector(".dropdown .dropdown-menu")).toBeTruthy();
        expect(dropdownRef.current).toBe(instance);

        void act(() => render(null, el));
        expect(instance.dispose).toHaveBeenCalledTimes(1);
    });

    it("mounts the portaled menu on arm (pointerdown/focus), wires _menu, and tears down on blur without open", () => {
        renderInto(<Dropdown portalToBody className="my-scope" text="btn">item</Dropdown>);

        // Not mounted while idle — no empty wrapper left in the body.
        expect(document.body.querySelector(":scope > .my-scope")).toBeNull();

        // Pointer press arms it: the wrapper + menu mount in the body and _menu is re-pointed.
        fire(getToggle(), "pointerdown");
        const menu = document.body.querySelector(":scope > .my-scope > .dropdown-menu");
        expect(menu).toBeTruthy();
        expect(instance._menu).toBe(menu);

        // Releasing focus without opening tears the empty menu back down.
        fire(getToggle(), "focusout");
        expect(document.body.querySelector(":scope > .my-scope")).toBeNull();

        // Focusing the toggle (keyboard path) arms it too.
        fire(getToggle(), "focusin");
        expect(document.body.querySelector(":scope > .my-scope > .dropdown-menu")).toBeTruthy();
    });

    it("keeps an open portaled menu mounted through blur and unmounts it on hide", () => {
        const onShown = vi.fn();
        const onHidden = vi.fn();
        const el = renderInto(
            <Dropdown portalToBody className="my-scope" onShown={onShown} onHidden={onHidden}>
                <li>entry</li>
            </Dropdown>
        );

        fire(getToggle(), "pointerdown");

        // Bootstrap opens the dropdown: children render and blur no longer unmounts.
        const dropdownEl = el.querySelector(".dropdown");
        expect(dropdownEl).toBeTruthy();
        void act(() => {
            $(dropdownEl as HTMLElement).trigger("show.bs.dropdown");
        });
        expect(onShown).toHaveBeenCalledTimes(1);
        expect(document.body.querySelector(":scope > .my-scope li")).toBeTruthy();

        fire(getToggle(), "focusout");
        expect(document.body.querySelector(":scope > .my-scope > .dropdown-menu")).toBeTruthy();

        // Hiding resets both `shown` and `armed`, unmounting the portaled menu.
        void act(() => {
            $(dropdownEl as HTMLElement).trigger("hide.bs.dropdown");
        });
        expect(onHidden).toHaveBeenCalledTimes(1);
        expect(document.body.querySelector(":scope > .my-scope")).toBeNull();
    });

    it("mounts and shows a forceShown portaled dropdown immediately", () => {
        // No className: the portaled wrapper falls back to an empty class.
        renderInto(<Dropdown portalToBody forceShown>item</Dropdown>);

        expect(instance.show).toHaveBeenCalledTimes(1);
        // The menu was mounted into the body (via the class-less wrapper) and wired as _menu.
        expect(instance._menu?.classList.contains("dropdown-menu")).toBe(true);
        expect(instance._menu?.closest("body")).toBeTruthy();
    });
});
