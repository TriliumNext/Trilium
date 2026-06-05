import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------
// `cachedIsMobile = isMobile()` and `isDesktop()` (via ButtonOrActionButton) are read from
// services/utils; mock it so the keyboard-shortcut <kbd> branch renders and isDesktop is controllable.
let mockedIsDesktop = true;
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isMobile: () => false,
    isDesktop: () => mockedIsDesktop
}));
// ActionButton (rendered by ButtonOrActionButton on non-desktop) pulls in bootstrap tooltips +
// keyboard_actions; stub them so the real DOM still renders without side effects.
vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    return { Tooltip, default: { Tooltip } };
});
vi.mock("../../services/keyboard_actions", () => ({
    default: { getAction: vi.fn(async () => ({ effectiveShortcuts: [] })) }
}));

import Button, { ButtonGroup, ButtonOrActionButton, SplitButton } from "./Button";

// --- Render helper -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
function renderInto(vnode: unknown) {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(vnode as never, container);
    return container;
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    mockedIsDesktop = true;
    vi.restoreAllMocks();
});

// --- Button --------------------------------------------------------------------------------------

describe("Button", () => {
    it("primary kind: btn-primary class, type=button with handler, fires onClick", () => {
        const onClick = vi.fn();
        const btn = renderInto(<Button text="Save" onClick={onClick} kind="primary" name="saveBtn" />).querySelector("button");
        expect(btn?.className).toContain("btn");
        expect(btn?.className).toContain("btn-primary");
        expect(btn?.getAttribute("type")).toBe("button");
        expect(btn?.getAttribute("name")).toBe("saveBtn");
        btn?.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("lowProfile kind maps to tn-low-profile and forwards className + size=small", () => {
        const btn = renderInto(<Button text="Low" kind="lowProfile" className="extra" size="small" />).querySelector("button");
        expect(btn?.className).toContain("tn-low-profile");
        expect(btn?.className).toContain("extra");
        expect(btn?.className).toContain("btn-sm");
        expect(btn?.className).not.toContain("btn-micro");
    });

    it("default/secondary kind, size=micro, and applies inline style", () => {
        const btn = renderInto(<Button text="Micro" size="micro" style={{ color: "red" }} />).querySelector("button");
        expect(btn?.className).toContain("btn-secondary");
        expect(btn?.className).toContain("btn-micro");
        expect(btn?.style.color).toBe("red");
    });

    it("submits (type=submit) when no handler or command; passes through title via restProps", () => {
        const btn = renderInto(<Button text="Submit" title="A title" />).querySelector("button");
        expect(btn?.getAttribute("type")).toBe("submit");
        expect(btn?.getAttribute("title")).toBe("A title");
    });

    it("triggerCommand makes type=button and sets data-trigger-command (no onClick)", () => {
        const btn = renderInto(<Button text="Cmd" triggerCommand="openAboutDialog" />).querySelector("button");
        expect(btn?.getAttribute("type")).toBe("button");
        expect(btn?.getAttribute("data-trigger-command")).toBe("openAboutDialog");
    });

    it("renders an icon and reflects disabled state (no click)", () => {
        const onClick = vi.fn();
        const root = renderInto(<Button text="Del" icon="bx-trash" disabled onClick={onClick} />);
        const btn = root.querySelector("button");
        expect(btn?.disabled).toBe(true);
        expect(root.querySelector("span.bx.bx-trash")).toBeTruthy();
        btn?.click();
        expect(onClick).not.toHaveBeenCalled();
    });

    it("renders keyboard shortcut as <kbd> chunks joined by '+' (desktop, non-mobile)", () => {
        const root = renderInto(<Button text="Find" keyboardShortcut="ctrl+k" />);
        const kbds = root.querySelectorAll("kbd");
        expect(kbds.length).toBe(2);
        expect(kbds[0]?.textContent).toBe("CTRL");
        expect(kbds[1]?.textContent).toBe("K");
        // The "+" separator sits between the two kbd chunks but not after the last.
        expect(root.querySelector("button")?.textContent).toContain("+");
    });

    it("single-key shortcut renders one <kbd> and no trailing '+'", () => {
        const root = renderInto(<Button text="Esc" keyboardShortcut="esc" />);
        const kbds = root.querySelectorAll("kbd");
        expect(kbds.length).toBe(1);
        expect(kbds[0]?.textContent).toBe("ESC");
    });

    it("renders no <kbd> when no keyboardShortcut is provided", () => {
        const root = renderInto(<Button text="Plain" />);
        expect(root.querySelectorAll("kbd").length).toBe(0);
    });

    it("forwards a buttonRef to the rendered element", () => {
        const ref = { current: null as HTMLButtonElement | null };
        renderInto(<Button text="Ref" buttonRef={ref} />);
        expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    });
});

// --- ButtonGroup ---------------------------------------------------------------------------------

describe("ButtonGroup", () => {
    it("renders role=group with btn-group and a size modifier + custom class", () => {
        const div = renderInto(
            <ButtonGroup size="lg" className="mine"><span>child</span></ButtonGroup>
        ).querySelector("div");
        expect(div?.getAttribute("role")).toBe("group");
        expect(div?.className).toContain("btn-group");
        expect(div?.className).toContain("btn-group-lg");
        expect(div?.className).toContain("mine");
        expect(div?.querySelector("span")?.textContent).toBe("child");
    });

    it("omits the size modifier and tolerates no className", () => {
        const div = renderInto(<ButtonGroup><span /></ButtonGroup>).querySelector("div");
        expect(div?.className).toContain("btn-group");
        expect(div?.className).not.toContain("btn-group-");
    });
});

// --- SplitButton ---------------------------------------------------------------------------------

describe("SplitButton", () => {
    it("renders a main button (with icon), a dropdown toggle, and the dropdown children", () => {
        const onClick = vi.fn();
        const root = renderInto(
            <SplitButton text="Open" icon="bx-folder" title="open" onClick={onClick}>
                <li>item</li>
            </SplitButton>
        );
        const buttons = root.querySelectorAll("button");
        expect(buttons.length).toBe(2);
        expect(root.querySelector("span.bx.bx-folder")).toBeTruthy();
        expect(buttons[1]?.className).toContain("dropdown-toggle-split");
        expect(root.querySelector("ul.dropdown-menu li")?.textContent).toBe("item");
        buttons[0]?.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("renders without an icon", () => {
        const root = renderInto(<SplitButton text="NoIcon"><li /></SplitButton>);
        expect(root.querySelector("span.bx")).toBeNull();
        expect(root.querySelectorAll("button").length).toBe(2);
    });
});

// --- ButtonOrActionButton ------------------------------------------------------------------------

describe("ButtonOrActionButton", () => {
    it("renders a full Button on desktop", () => {
        mockedIsDesktop = true;
        const root = renderInto(<ButtonOrActionButton text="Go" icon="bx-play" triggerCommand="openAboutDialog" />);
        const btn = root.querySelector("button");
        // Button wraps the icon in <span class="bx ..."> and exposes the trigger command.
        expect(root.querySelector("span.bx.bx-play")).toBeTruthy();
        expect(btn?.getAttribute("data-trigger-command")).toBe("openAboutDialog");
        expect(btn?.className).toContain("btn-secondary");
    });

    it("renders an ActionButton on non-desktop", () => {
        mockedIsDesktop = false;
        const root = renderInto(<ButtonOrActionButton text="Go" icon="bx-play" triggerCommand="openAboutDialog" />);
        const btn = root.querySelector("button");
        // ActionButton applies the icon-action class and puts the icon directly on the button.
        expect(btn?.className).toContain("icon-action");
        expect(btn?.className).toContain("bx-play");
        expect(btn?.getAttribute("data-trigger-command")).toBe("openAboutDialog");
    });
});
