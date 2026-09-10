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

// `mobileBottomSheet` only takes effect on a mobile layout, which has to be answerable per test.
const isMobileMock = vi.hoisted(() => vi.fn(() => false));
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isMobile: () => isMobileMock()
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
        isMobileMock.mockReturnValue(false);
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

    it("preserves Bootstrap's open marker when the button class changes", () => {
        const el = renderInto(<Dropdown buttonClassName="bx bx-note">item</Dropdown>);
        const dropdownEl = el.querySelector(".dropdown");
        expect(dropdownEl).toBeTruthy();

        void act(() => {
            $(dropdownEl as HTMLElement).trigger("show.bs.dropdown");
        });
        getToggle().classList.add("show");
        expect(getToggle().classList.contains("show")).toBe(true);

        void act(() => render(<Dropdown buttonClassName="bx bx-star">item</Dropdown>, el));

        expect(getToggle().classList.contains("bx-star")).toBe(true);
        expect(getToggle().classList.contains("show")).toBe(true);
        expect(getToggle().getAttribute("aria-expanded")).toBe("true");
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
        // `tn-dropdown-portal` is what style.css hangs the out-of-modal z-index on; without it a
        // portaled menu paints under whatever dialog it was opened from.
        expect(menu?.parentElement?.classList.contains("tn-dropdown-portal")).toBe(true);

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

    /**
     * A menu that is a task of its own dims the page behind it. The cover is drawn inside the same
     * portal, before the menu, so what covers what is document order rather than two z-index scales
     * meeting; and only while the menu is actually open, an armed but closed one covering nothing.
     */
    it("draws a backdrop under a portaled menu while it is open", () => {
        const el = renderInto(
            <Dropdown portalToBody backdrop className="my-scope">
                <li>entry</li>
            </Dropdown>
        );

        fire(getToggle(), "pointerdown");
        expect(document.body.querySelector(":scope > .my-scope > .tn-dropdown-backdrop")).toBeNull();

        const dropdownEl = el.querySelector(".dropdown");
        void act(() => {
            $(dropdownEl as HTMLElement).trigger("show.bs.dropdown");
        });

        const wrapper = document.body.querySelector<HTMLElement>(":scope > .my-scope");
        const drawn = [ ...(wrapper?.children ?? []) ].map(child => child.className.split(" ")[0]);
        expect(drawn).toEqual([ "tn-dropdown-backdrop", "dropdown-menu" ]);

        void act(() => {
            $(dropdownEl as HTMLElement).trigger("hide.bs.dropdown");
        });
        expect(document.body.querySelector(":scope > .my-scope")).toBeNull();
    });

    it("leaves a menu without the prop undimmed", () => {
        const el = renderInto(
            <Dropdown portalToBody className="my-scope"><li>entry</li></Dropdown>
        );

        fire(getToggle(), "pointerdown");
        void act(() => {
            $(el.querySelector(".dropdown") as HTMLElement).trigger("show.bs.dropdown");
        });

        expect(document.body.querySelector(":scope > .my-scope > .tn-dropdown-backdrop")).toBeNull();
    });

    it("leaves a mobileBottomSheet menu alone on a desktop layout", () => {
        const el = renderInto(<Dropdown mobileBottomSheet forceShown>item</Dropdown>);

        // Nested next to the toggle, unclassed and undimmed: the sheet is a mobile arrangement only.
        expect(el.querySelector(".dropdown > .dropdown-menu")).toBeTruthy();
        expect(el.querySelector(".mobile-bottom-menu")).toBeNull();
    });

    it("makes a mobileBottomSheet menu a bottom sheet on mobile: classed, portaled out and over the backdrop", () => {
        isMobileMock.mockReturnValue(true);
        const cover = document.createElement("div");
        cover.id = "context-menu-cover";
        document.body.appendChild(cover);

        const el = renderInto(<Dropdown mobileBottomSheet>item</Dropdown>);
        const dropdownEl = el.querySelector(".dropdown");
        void act(() => {
            $(dropdownEl as HTMLElement).trigger("show.bs.dropdown");
        });

        // The one prop stands in for all three pieces the arrangement needs.
        expect(instance._menu?.classList.contains("mobile-bottom-menu")).toBe(true);
        expect(el.contains(instance._menu)).toBe(false);
        expect(instance._menu?.closest("body")).toBeTruthy();
        expect(cover.classList.contains("show")).toBe(true);

        void act(() => {
            $(dropdownEl as HTMLElement).trigger("hide.bs.dropdown");
        });
        expect(cover.classList.contains("show")).toBe(false);
        cover.remove();
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
