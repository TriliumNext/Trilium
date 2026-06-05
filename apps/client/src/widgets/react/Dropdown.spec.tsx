import { render } from "preact";
import { act } from "preact/test-utils";
import { MutableRef } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// bootstrap is used both by Dropdown (Dropdown) and by useTooltip (Tooltip).
vi.mock("bootstrap", () => {
    const dropdownInstances = new Map<Element, FakeDropdown>();
    class FakeDropdown {
        element: Element;
        disposed = false;
        shown = false;
        updateCount = 0;
        constructor(el: Element) { this.element = el; }
        static getOrCreateInstance(el: Element) {
            let inst = dropdownInstances.get(el);
            if (!inst) {
                inst = new FakeDropdown(el);
                dropdownInstances.set(el, inst);
            }
            return inst;
        }
        show() { this.shown = true; }
        hide() { this.shown = false; }
        update() { this.updateCount++; }
        dispose() { this.disposed = true; dropdownInstances.delete(this.element); }
    }
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        config: unknown;
        constructor(el: Element, config?: unknown) { this.element = el; this.config = config; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    return { Dropdown: FakeDropdown, Tooltip, default: { Dropdown: FakeDropdown, Tooltip } };
});

vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isMobile: vi.fn(() => false)
}));

import { Dropdown as BootstrapDropdown } from "bootstrap";
import { isMobile } from "../../services/utils";
import Dropdown from "./Dropdown";

// --- Render helper ----------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
function renderInto(vnode: unknown) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(vnode as never, container as HTMLDivElement));
    return container;
}

// Fake ResizeObserver that captures the callback so we can fire it manually.
const resizeCallbacks: Array<() => void> = [];
class FakeResizeObserver {
    cb: () => void;
    constructor(cb: () => void) { this.cb = cb; resizeCallbacks.push(cb); }
    observe() {}
    unobserve() {}
    disconnect() {}
}

let previousTooltipPlugin: unknown;
let previousResizeObserver: unknown;

beforeEach(() => {
    // The bootstrap tooltip jQuery plugin ($.fn.tooltip) is not registered in the test env; stub it.
    const fn = $.fn as unknown as Record<string, unknown>;
    previousTooltipPlugin = fn.tooltip;
    fn.tooltip = vi.fn();

    previousResizeObserver = (window as unknown as { ResizeObserver: unknown }).ResizeObserver;
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
    resizeCallbacks.length = 0;

    (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(false);
});

afterEach(() => {
    if (container) {
        act(() => render(null, container as HTMLDivElement));
        container.remove();
        container = undefined;
    }
    (($.fn as unknown as Record<string, unknown>)).tooltip = previousTooltipPlugin;
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = previousResizeObserver;
    document.getElementById("context-menu-cover")?.remove();
    vi.restoreAllMocks();
});

// --- Structure / default classes -------------------------------------------------------------------

describe("Dropdown structure", () => {
    it("renders the wrapper, default button and menu classes", () => {
        const root = renderInto(<Dropdown text="Menu"><span class="item">A</span></Dropdown>);

        const wrapper = root.querySelector("div.dropdown");
        expect(wrapper).not.toBeNull();
        expect((wrapper as HTMLElement).style.display).toBe("flex");

        const button = root.querySelector("button");
        expect(button?.className).toContain("btn");
        expect(button?.className).toContain("select-button");
        expect(button?.className).toContain("dropdown-toggle");
        expect(button?.getAttribute("type")).toBe("button");
        expect(button?.getAttribute("data-bs-toggle")).toBe("dropdown");
        expect(button?.getAttribute("aria-haspopup")).toBe("true");
        // text rendered, plus caret span
        expect(button?.textContent).toContain("Menu");
        expect(button?.querySelector("span.caret")).not.toBeNull();

        const menu = root.querySelector("ul");
        expect(menu?.className).toContain("dropdown-menu");
        expect(menu?.className).toContain("tn-dropdown-menu");
        expect(menu?.className).toContain("tn-dropdown-list");
        // children only render when shown
        expect(menu?.querySelector(".item")).toBeNull();

        // a generated aria id links the button and menu
        const ariaId = button?.getAttribute("id");
        expect(ariaId).toBeTruthy();
        expect(menu?.getAttribute("aria-labelledby")).toBe(ariaId);
    });

    it("applies iconAction, noSelectButtonStyle, hideToggleArrow, disabled, isStatic and noDropdownListStyle", () => {
        const root = renderInto(
            <Dropdown
                iconAction
                noSelectButtonStyle
                hideToggleArrow
                disabled
                isStatic
                noDropdownListStyle
                className="my-class"
                buttonClassName="my-btn"
                dropdownContainerClassName="my-menu"
                dropdownContainerStyle={{ width: "100px" }}
            >
                <span>X</span>
            </Dropdown>
        );

        const wrapper = root.querySelector("div.dropdown");
        expect(wrapper?.className).toContain("my-class");

        const button = root.querySelector("button");
        expect(button?.className.startsWith("icon-action")).toBe(true);
        expect(button?.className).not.toContain("select-button");
        expect(button?.className).not.toContain("dropdown-toggle");
        expect(button?.className).toContain("my-btn");
        expect(button?.hasAttribute("disabled")).toBe(true);
        expect(button?.getAttribute("data-bs-display")).toBe("static");

        const menu = root.querySelector("ul");
        expect(menu?.className).toContain("static");
        expect(menu?.className).toContain("my-menu");
        expect(menu?.className).not.toContain("tn-dropdown-list");
        expect((menu as HTMLElement).style.width).toBe("100px");
    });

    it("uses explicit id over the generated aria id and forwards buttonProps and title", () => {
        const root = renderInto(
            <Dropdown id="my-id" title="Tip" buttonProps={{ "data-foo": "bar", "aria-label": "lbl" }}>
                <span>Y</span>
            </Dropdown>
        );

        const wrapper = root.querySelector("div.dropdown");
        expect(wrapper?.getAttribute("title")).toBe("Tip");

        const button = root.querySelector("button");
        expect(button?.getAttribute("id")).toBe("my-id");
        expect(button?.getAttribute("data-foo")).toBe("bar");
        expect(button?.getAttribute("aria-label")).toBe("lbl");
        // the aria-labelledby still points to the generated id, not the explicit button id
        const menu = root.querySelector("ul");
        expect(menu?.getAttribute("aria-labelledby")).not.toBe("my-id");
    });
});

// --- Refs and bootstrap instance creation ----------------------------------------------------------

describe("Dropdown refs and instance", () => {
    it("populates dropdownRef and dropdownContainerRef and creates a bootstrap instance", () => {
        const dropdownRef: MutableRef<BootstrapDropdown | null> = { current: null };
        const containerRef: MutableRef<HTMLDivElement | null> = { current: null };

        renderInto(
            <Dropdown dropdownRef={dropdownRef} dropdownContainerRef={containerRef}>
                <span>Z</span>
            </Dropdown>
        );

        expect(dropdownRef.current).not.toBeNull();
        expect(containerRef.current).not.toBeNull();
        expect(containerRef.current?.classList.contains("dropdown")).toBe(true);
    });

    it("disposes the bootstrap instance on unmount", () => {
        const dropdownRef: MutableRef<BootstrapDropdown | null> = { current: null };
        renderInto(<Dropdown dropdownRef={dropdownRef}><span>Z</span></Dropdown>);
        const instance = dropdownRef.current as unknown as { disposed: boolean };
        expect(instance.disposed).toBe(false);

        act(() => render(null, container as HTMLDivElement));
        container?.remove();
        container = undefined;

        expect(instance.disposed).toBe(true);
    });

    it("updates the bootstrap instance when the popup resizes", () => {
        const dropdownRef: MutableRef<BootstrapDropdown | null> = { current: null };
        renderInto(<Dropdown dropdownRef={dropdownRef}><span>Z</span></Dropdown>);

        const instance = dropdownRef.current as unknown as { updateCount: number };
        const before = instance.updateCount;
        act(() => resizeCallbacks.forEach((cb) => cb()));
        expect(instance.updateCount).toBeGreaterThan(before);
    });
});

// --- forceShown ------------------------------------------------------------------------------------

describe("Dropdown forceShown", () => {
    it("shows the dropdown and renders children when forceShown is set", () => {
        const dropdownRef: MutableRef<BootstrapDropdown | null> = { current: null };
        const root = renderInto(
            <Dropdown forceShown dropdownRef={dropdownRef}>
                <span class="item">visible</span>
            </Dropdown>
        );

        const instance = dropdownRef.current as unknown as { shown: boolean };
        expect(instance.shown).toBe(true);
        expect(root.querySelector("ul .item")?.textContent).toBe("visible");
    });
});

// --- show/hide events ------------------------------------------------------------------------------

describe("Dropdown show/hide handling", () => {
    it("toggles children visibility and invokes onShown/onHidden via bootstrap dropdown events", () => {
        const onShown = vi.fn();
        const onHidden = vi.fn();
        const containerRef: MutableRef<HTMLDivElement | null> = { current: null };
        const root = renderInto(
            <Dropdown dropdownContainerRef={containerRef} onShown={onShown} onHidden={onHidden}>
                <span class="item">child</span>
            </Dropdown>
        );

        const target = containerRef.current;
        expect(target).not.toBeNull();
        if (!target) return;

        // initially hidden, no children
        expect(root.querySelector("ul .item")).toBeNull();

        act(() => { $(target).trigger("show.bs.dropdown"); });
        expect(onShown).toHaveBeenCalledTimes(1);
        expect(root.querySelector("ul .item")?.textContent).toBe("child");

        act(() => { $(target).trigger("hide.bs.dropdown"); });
        expect(onHidden).toHaveBeenCalledTimes(1);
        expect(root.querySelector("ul .item")).toBeNull();
    });

    it("toggles the mobile backdrop cover on show/hide when on mobile", () => {
        (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);

        const cover = document.createElement("div");
        cover.id = "context-menu-cover";
        document.body.appendChild(cover);

        const containerRef: MutableRef<HTMLDivElement | null> = { current: null };
        renderInto(
            <Dropdown mobileBackdrop dropdownContainerRef={containerRef}>
                <span>child</span>
            </Dropdown>
        );

        const target = containerRef.current;
        if (!target) return;

        act(() => { $(target).trigger("show.bs.dropdown"); });
        expect(cover.classList.contains("show")).toBe(true);
        expect(cover.classList.contains("global-menu-cover")).toBe(true);

        act(() => { $(target).trigger("hide.bs.dropdown"); });
        expect(cover.classList.contains("show")).toBe(false);
        expect(cover.classList.contains("global-menu-cover")).toBe(false);
    });

    it("does not touch the backdrop cover when mobileBackdrop is set but not on mobile", () => {
        (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(false);

        const cover = document.createElement("div");
        cover.id = "context-menu-cover";
        document.body.appendChild(cover);

        const containerRef: MutableRef<HTMLDivElement | null> = { current: null };
        renderInto(
            <Dropdown mobileBackdrop dropdownContainerRef={containerRef}>
                <span>child</span>
            </Dropdown>
        );

        const target = containerRef.current;
        if (!target) return;

        act(() => { $(target).trigger("show.bs.dropdown"); });
        expect(cover.classList.contains("show")).toBe(false);
    });
});

// --- tooltip on hover ------------------------------------------------------------------------------

describe("Dropdown tooltip", () => {
    it("shows the tooltip on mouse enter and hides it on mouse leave", () => {
        const tooltipFn = $.fn.tooltip as unknown as ReturnType<typeof vi.fn>;
        const root = renderInto(<Dropdown title="hover tip"><span>child</span></Dropdown>);

        const button = root.querySelector("button");
        if (!button) return;

        tooltipFn.mockClear();
        act(() => { button.dispatchEvent(new Event("mouseenter", { bubbles: true })); });
        expect(tooltipFn).toHaveBeenCalledWith("show");

        tooltipFn.mockClear();
        act(() => { button.dispatchEvent(new Event("mouseleave", { bubbles: true })); });
        expect(tooltipFn).toHaveBeenCalledWith("hide");
    });
});

// --- menu click stopPropagation --------------------------------------------------------------------

describe("Dropdown menu click", () => {
    it("stops propagation only when the click target is the menu itself", () => {
        const dropdownContainerRef: MutableRef<HTMLDivElement | null> = { current: null };
        const root = renderInto(
            <Dropdown forceShown>
                <span class="item">child</span>
            </Dropdown>
        );

        const menu = root.querySelector("ul");
        if (!menu) return;

        // Click directly on the menu -> propagation stopped.
        const directEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
        const directStop = vi.spyOn(directEvent, "stopPropagation");
        act(() => { menu.dispatchEvent(directEvent); });
        expect(directStop).toHaveBeenCalled();

        // Click on a child element -> propagation not stopped by the menu handler.
        const child = menu.querySelector(".item");
        if (!child) return;
        const childEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
        const childStop = vi.spyOn(childEvent, "stopPropagation");
        act(() => { child.dispatchEvent(childEvent); });
        expect(childStop).not.toHaveBeenCalled();
    });
});
