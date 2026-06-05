import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// bootstrap is used both by FormList (Dropdown) and by useStaticTooltip (Tooltip).
vi.mock("bootstrap", () => {
    const dropdownInstances = new Map<Element, FakeDropdown>();
    class FakeDropdown {
        element: Element;
        disposed = false;
        constructor(el: Element) { this.element = el; }
        static getOrCreateInstance(el: Element) {
            let inst = dropdownInstances.get(el);
            if (!inst) {
                inst = new FakeDropdown(el);
                dropdownInstances.set(el, inst);
            }
            return inst;
        }
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

const openInAppHelpFromUrlMock = vi.fn();
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    openInAppHelpFromUrl: (...args: unknown[]) => openInAppHelpFromUrlMock(...args)
}));

import * as utils from "../../services/utils";
import FormList, {
    FormDropdownDivider, FormDropdownSubmenu, FormListHeader, FormListItem, FormListToggleableItem
} from "./FormList";

// --- Render helper ----------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
function renderInto(vnode: unknown) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(vnode as never, container as HTMLDivElement));
    return container;
}

beforeEach(() => {
    openInAppHelpFromUrlMock.mockReset();
});

afterEach(() => {
    if (container) {
        act(() => render(null, container as HTMLDivElement));
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- FormList (the dropdown container) --------------------------------------------------------------

describe("FormList", () => {
    it("renders the wrapper/menu structure with default classes", () => {
        const root = renderInto(
            <FormList>
                <FormListItem value="a">Apple</FormListItem>
            </FormList>
        );

        const wrapper = root.querySelector(".dropdownWrapper");
        expect(wrapper).not.toBeNull();
        const menu = root.querySelector(".dropdown-menu");
        expect(menu?.className).toContain("static");
        expect(menu?.className).toContain("show");
        // The hidden toggle button wired up for bootstrap.
        const trigger = root.querySelector("button[data-bs-toggle='dropdown']");
        expect(trigger?.getAttribute("data-bs-display")).toBe("static");
        // The child item rendered inside the menu.
        expect(menu?.querySelector(".dropdown-item")?.getAttribute("data-value")).toBe("a");
    });

    it("applies wrapperClassName and fullHeight builtin styles", () => {
        const root = renderInto(
            <FormList wrapperClassName="my-extra" fullHeight>
                <FormListItem value="x">X</FormListItem>
            </FormList>
        );

        const wrapper = root.querySelector(".dropdownWrapper");
        expect(wrapper?.className).toContain("my-extra");
        expect((wrapper as HTMLElement).style.height).toBe("100%");
        expect((wrapper as HTMLElement).style.overflow).toBe("auto");
    });

    it("merges the consumer-provided style onto the menu and keeps relative position", () => {
        const root = renderInto(
            <FormList style={{ width: "200px" }}>
                <FormListItem value="x">X</FormListItem>
            </FormList>
        );

        const menu = root.querySelector(".dropdown-menu") as HTMLElement;
        expect(menu.style.width).toBe("200px");
        expect(menu.style.position).toBe("relative");
    });

    it("fires onSelect with the clicked item's data-value", () => {
        const onSelect = vi.fn();
        const root = renderInto(
            <FormList onSelect={onSelect}>
                <FormListItem value="apple">Apple</FormListItem>
                <FormListItem value="banana">Banana</FormListItem>
            </FormList>
        );

        const banana = root.querySelector(".dropdown-item[data-value='banana']") as HTMLElement;
        banana.click();
        expect(onSelect).toHaveBeenCalledWith("banana");
    });

    it("does not throw on click when there is no value and/or no onSelect", () => {
        // No onSelect at all.
        const noHandlerRoot = renderInto(
            <FormList>
                <FormListItem value="a">A</FormListItem>
            </FormList>
        );
        (noHandlerRoot.querySelector(".dropdown-item") as HTMLElement).click();

        // onSelect present, but the clicked target has no data-value (click on the menu itself).
        const onSelect = vi.fn();
        if (container) { act(() => render(null, container as HTMLDivElement)); container.remove(); container = undefined; }
        const root = renderInto(
            <FormList onSelect={onSelect}>
                <FormListHeader text="Header" />
            </FormList>
        );
        (root.querySelector(".dropdown-menu") as HTMLElement).click();
        expect(onSelect).not.toHaveBeenCalled();
    });

    it("disposes the bootstrap dropdown on unmount (cleanup effect runs)", () => {
        const root = renderInto(
            <FormList>
                <FormListItem value="a">A</FormListItem>
            </FormList>
        );
        // Unmount triggers the effect's cleanup; should not throw.
        act(() => render(null, root));
        expect(root.querySelector(".dropdownWrapper")).toBeNull();
        // re-create container so afterEach teardown is a no-op safe path
        container = undefined;
    });
});

// --- FormListItem -----------------------------------------------------------------------------------

describe("FormListItem", () => {
    it("composes the state classes (active/disabled/selected/container) and custom className", () => {
        const root = renderInto(
            <FormListItem value="v" active disabled selected container className="custom">Label</FormListItem>
        );
        const li = root.querySelector("li.dropdown-item") as HTMLElement;
        expect(li.className).toContain("active");
        expect(li.className).toContain("disabled");
        expect(li.className).toContain("selected");
        expect(li.className).toContain("dropdown-container-item");
        expect(li.className).toContain("custom");
        // container -> tabIndex -1
        expect(li.tabIndex).toBe(-1);
        expect(li.getAttribute("data-value")).toBe("v");
    });

    it("uses tabIndex 0 when not a container and omits state classes when defaults", () => {
        const root = renderInto(<FormListItem value="v">Label</FormListItem>);
        const li = root.querySelector("li.dropdown-item") as HTMLElement;
        expect(li.tabIndex).toBe(0);
        expect(li.className).not.toContain("active");
        expect(li.className).not.toContain("dropdown-container-item");
    });

    it("forces the check icon when checked is true", () => {
        const root = renderInto(<FormListItem value="v" checked icon="bx bx-something">Checked</FormListItem>);
        const icon = root.querySelector("li .tn-icon") as HTMLElement;
        expect(icon.className).toContain("bx-check");
    });

    it("renders the provided icon when not checked", () => {
        const root = renderInto(<FormListItem value="v" icon="bx bx-star">Star</FormListItem>);
        const icon = root.querySelector("li .tn-icon") as HTMLElement;
        expect(icon.className).toContain("bx-star");
    });

    it("sets title, dir=rtl and data-trigger-command", () => {
        const root = renderInto(
            <FormListItem value="v" title="Tip" rtl triggerCommand="showOptions">RTL</FormListItem>
        );
        const li = root.querySelector("li.dropdown-item") as HTMLElement;
        expect(li.getAttribute("title")).toBe("Tip");
        expect(li.getAttribute("dir")).toBe("rtl");
        expect(li.getAttribute("data-trigger-command")).toBe("showOptions");
    });

    it("fires onClick", () => {
        const onClick = vi.fn();
        const root = renderInto(<FormListItem value="v" onClick={onClick}>Click</FormListItem>);
        (root.querySelector("li.dropdown-item") as HTMLElement).click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("wraps content in a div when a description is provided and renders the description", () => {
        const root = renderInto(
            <FormListItem value="v" description="Some description">Main</FormListItem>
        );
        const li = root.querySelector("li.dropdown-item") as HTMLElement;
        // description branch wraps FormListContent in an extra <div>
        const innerDiv = li.querySelector(":scope > div");
        expect(innerDiv).not.toBeNull();
        expect(li.querySelector(".description")?.textContent).toBe("Some description");
    });

    it("renders badges", () => {
        const root = renderInto(
            <FormListItem value="v" badges={[ { text: "New" }, { className: "badge-warn", text: "Beta" } ]}>Main</FormListItem>
        );
        const badges = root.querySelectorAll("li .badge");
        expect(badges.length).toBe(2);
        expect(badges[0].textContent).toBe("New");
        expect(badges[1].className).toContain("badge-warn");
        expect(badges[1].textContent).toBe("Beta");
    });

    it("renders the disabled tooltip indicator only when disabled and disabledTooltip set", () => {
        const enabledRoot = renderInto(
            <FormListItem value="v" disabledTooltip="why">Main</FormListItem>
        );
        // Not disabled -> no info-circle indicator.
        expect(enabledRoot.querySelector("li .bx-info-circle")).toBeNull();

        if (container) { act(() => render(null, container as HTMLDivElement)); container.remove(); container = undefined; }
        const disabledRoot = renderInto(
            <FormListItem value="v" disabled disabledTooltip="why">Main</FormListItem>
        );
        const indicator = disabledRoot.querySelector("li .bx-info-circle") as HTMLElement;
        expect(indicator).not.toBeNull();
        expect(indicator.getAttribute("title")).toBe("why");
    });

    it("writes back the element to an external ref via useSyncedRef", () => {
        const externalRef = { current: null as HTMLLIElement | null };
        renderInto(<FormListItem value="v" itemRef={externalRef}>Main</FormListItem>);
        expect(externalRef.current).toBeInstanceOf(HTMLLIElement);
    });
});

// --- FormListToggleableItem -------------------------------------------------------------------------

describe("FormListToggleableItem", () => {
    it("renders a toggle and invokes onChange with the negated value on item click", async () => {
        const onChange = vi.fn(async () => {});
        const root = renderInto(
            <FormListToggleableItem title="Wrap" currentValue={false} onChange={onChange} />
        );
        const li = root.querySelector("li.dropdown-item") as HTMLElement;
        await act(async () => { li.click(); });
        expect(onChange).toHaveBeenCalledWith(true);
        // The FormToggle is rendered inside.
        expect(root.querySelector(".switch-widget")).not.toBeNull();
    });

    it("does not call onChange when disabled", async () => {
        const onChange = vi.fn(async () => {});
        const root = renderInto(
            <FormListToggleableItem title="Wrap" currentValue={false} disabled onChange={onChange} />
        );
        const li = root.querySelector("li.dropdown-item") as HTMLElement;
        await act(async () => { li.click(); });
        expect(onChange).not.toHaveBeenCalled();
    });

    it("ignores clicks originating from the contextual help element", async () => {
        const onChange = vi.fn(async () => {});
        const root = renderInto(
            <FormListToggleableItem title="Wrap" currentValue={true} helpPage="some/page" onChange={onChange} />
        );
        const help = root.querySelector(".contextual-help") as HTMLElement;
        expect(help).not.toBeNull();
        await act(async () => { help.click(); });
        // Click went to contextual-help -> onChange skipped, help opener invoked.
        expect(onChange).not.toHaveBeenCalled();
        expect(openInAppHelpFromUrlMock).toHaveBeenCalledWith("some/page");
    });

    it("does not double-invoke onChange while a previous change is still pending", async () => {
        let resolveChange: (() => void) | undefined;
        const onChange = vi.fn(() => new Promise<void>((resolve) => { resolveChange = resolve; }));
        const root = renderInto(
            <FormListToggleableItem title="Wrap" currentValue={false} onChange={onChange} />
        );
        const li = root.querySelector("li.dropdown-item") as HTMLElement;
        // First click starts the pending change.
        act(() => { li.click(); });
        // Second click while waiting -> guarded out.
        act(() => { li.click(); });
        expect(onChange).toHaveBeenCalledTimes(1);
        await act(async () => { resolveChange?.(); });
    });
});

// --- FormListHeader / FormDropdownDivider -----------------------------------------------------------

describe("FormListHeader and FormDropdownDivider", () => {
    it("renders a header with the dropdown-header text", () => {
        const root = renderInto(<FormListHeader text="My header" />);
        const header = root.querySelector(".dropdown-header") as HTMLElement;
        expect(header.textContent).toBe("My header");
    });

    it("renders a divider and stops click propagation", () => {
        const parentClick = vi.fn();
        const root = renderInto(
            <div onClick={parentClick}>
                <FormDropdownDivider />
            </div>
        );
        const divider = root.querySelector(".dropdown-divider") as HTMLElement;
        divider.click();
        expect(parentClick).not.toHaveBeenCalled();
    });
});

// --- FormDropdownSubmenu ----------------------------------------------------------------------------

describe("FormDropdownSubmenu", () => {
    it("renders the toggle, icon and title with dropstart class", () => {
        const root = renderInto(
            <FormDropdownSubmenu icon="bx bx-folder" title="Submenu" dropStart>
                <FormListItem value="child">Child</FormListItem>
            </FormDropdownSubmenu>
        );
        const li = root.querySelector("li.dropdown-submenu") as HTMLElement;
        expect(li.className).toContain("dropstart");
        expect(li.querySelector(".dropdown-toggle .tn-icon")?.className).toContain("bx-folder");
        // The children are rendered inside the nested submenu list.
        expect(li.querySelector("ul.dropdown-menu .dropdown-item[data-value='child']")).not.toBeNull();
    });

    it("on desktop calls onDropdownToggleClicked and does not toggle the mobile open class", () => {
        vi.spyOn(utils, "isMobile").mockReturnValue(false);
        const onToggle = vi.fn();
        const root = renderInto(
            <FormDropdownSubmenu icon="bx bx-folder" title="Submenu" onDropdownToggleClicked={onToggle}>
                <FormListItem value="c">C</FormListItem>
            </FormDropdownSubmenu>
        );
        const toggle = root.querySelector(".dropdown-toggle") as HTMLElement;
        act(() => { toggle.click(); });
        expect(onToggle).toHaveBeenCalledTimes(1);
        expect((root.querySelector("li.dropdown-submenu") as HTMLElement).className).not.toContain("submenu-open");
        expect((root.querySelector("ul.dropdown-menu") as HTMLElement).className).not.toContain("show");
    });

    it("on desktop with no handler provided does nothing on click", () => {
        vi.spyOn(utils, "isMobile").mockReturnValue(false);
        const root = renderInto(
            <FormDropdownSubmenu icon="bx bx-folder" title="Submenu">
                <FormListItem value="c">C</FormListItem>
            </FormDropdownSubmenu>
        );
        const toggle = root.querySelector(".dropdown-toggle") as HTMLElement;
        // No onDropdownToggleClicked and not mobile -> neither branch runs; should not throw or open.
        act(() => { toggle.click(); });
        expect((root.querySelector("li.dropdown-submenu") as HTMLElement).className).not.toContain("submenu-open");
    });

    it("on mobile toggles the submenu open state instead of calling the handler", () => {
        vi.spyOn(utils, "isMobile").mockReturnValue(true);
        const onToggle = vi.fn();
        const root = renderInto(
            <FormDropdownSubmenu icon="bx bx-folder" title="Submenu" onDropdownToggleClicked={onToggle}>
                <FormListItem value="c">C</FormListItem>
            </FormDropdownSubmenu>
        );
        const toggle = root.querySelector(".dropdown-toggle") as HTMLElement;
        act(() => { toggle.click(); });
        expect(onToggle).not.toHaveBeenCalled();
        expect((root.querySelector("li.dropdown-submenu") as HTMLElement).className).toContain("submenu-open");
        expect((root.querySelector("ul.dropdown-menu") as HTMLElement).className).toContain("show");
        // Toggle back off.
        act(() => { toggle.click(); });
        expect((root.querySelector("li.dropdown-submenu") as HTMLElement).className).not.toContain("submenu-open");
    });
});
