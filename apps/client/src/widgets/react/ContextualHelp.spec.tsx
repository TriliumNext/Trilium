import { type ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The tooltip itself is Bootstrap's; what this component decides is the configuration it hands over,
// so the hook is stubbed and the configuration asserted on.
const mocks = vi.hoisted(() => ({
    useStaticTooltip: vi.fn(),
    /** Which affordance the component is built for; read once, when its module is first evaluated. */
    isMobile: vi.fn(() => false)
}));

vi.mock("./hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./hooks")>()),
    useStaticTooltip: mocks.useStaticTooltip
}));

vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isMobile: mocks.isMobile
}));

// The sheet is the app's own modal, which on a phone every dialog already is; what matters here is
// that the message is handed to one, and only once the icon has been tapped.
vi.mock("./Modal", () => ({
    default: ({ children, show, ariaLabel }: { children: ComponentChildren, show: boolean, ariaLabel?: string }) => (
        show ? <div className="sheet-stub" role="dialog" aria-label={ariaLabel}>{children}</div> : null
    )
}));

// Nothing initializes i18next for the tests, so the wording is stood in for by the key and the
// values interpolated into it — which is what the assertions here are actually about.
vi.mock("../../services/i18n", () => ({
    t: (key: string, opts?: Record<string, string>) => `${key}(${opts?.message ?? ""})`
}));

import { Tooltip } from "bootstrap";

import ContextualHelp from "./ContextualHelp";

/** Presses a key on the icon the way a keyboard user would, and answers whether it was handled. */
function press(element: Element | null | undefined, key: string) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });

    act(() => { element?.dispatchEvent(event); });
    return event.defaultPrevented;
}

describe("ContextualHelp", () => {
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

    it("is an info icon explaining itself through the app's tooltip, raised above any dialog", () => {
        act(() => render(<ContextualHelp helpMessage="What this figure covers." />, container));

        const span = container.querySelector("span");
        expect(span?.className).toBe("bx bx-info-circle contextual-help-icon");
        // No title of its own: a native tooltip would open somewhere else, in its own styling.
        expect(span?.getAttribute("title")).toBeNull();

        expect(mocks.useStaticTooltip).toHaveBeenLastCalledWith(expect.anything(), {
            title: "What this figure covers.",
            placement: "bottom",
            customClass: "tooltip-top"
        });
    });

    it("is a control in its own right: reachable, named by its explanation, and worked by key", () => {
        const tooltip = { toggle: vi.fn(), hide: vi.fn() };
        vi.spyOn(Tooltip, "getInstance").mockReturnValue(tooltip as unknown as Tooltip);

        act(() => render(<ContextualHelp helpMessage="What this figure covers." />, container));
        const span = container.querySelector("span");

        expect(span?.getAttribute("role")).toBe("button");
        expect(span?.getAttribute("tabindex")).toBe("0");
        // The explanation is the accessible name, so it is there to be read whether or not a
        // tooltip happens to be on screen at the time.
        expect(span?.getAttribute("aria-label")).toBe("contextual_help.label(What this figure covers.)");

        // Both activation keys reveal it, and both are swallowed — Space would otherwise scroll the
        // page out from under what is being explained.
        expect(press(span, "Enter")).toBe(true);
        expect(press(span, " ")).toBe(true);
        expect(tooltip.toggle).toHaveBeenCalledTimes(2);

        // Dismissed from the keyboard too, without having to tab away. Bootstrap stamps
        // `aria-describedby` on the trigger for as long as its tooltip is on screen.
        const escaped = vi.fn();
        container.addEventListener("keydown", escaped);
        span?.setAttribute("aria-describedby", "tooltip-1");

        press(span, "Escape");
        expect(tooltip.hide).toHaveBeenCalledTimes(1);
        // And the key goes no further: these icons sit inside dialogs that close on Escape, and
        // putting a tooltip away must not throw away what the dialog was being told.
        expect(escaped).not.toHaveBeenCalled();

        // With nothing up, the key was never ours — the dialog around it is welcome to it.
        span?.removeAttribute("aria-describedby");
        press(span, "Escape");
        expect(tooltip.hide).toHaveBeenCalledTimes(1);
        expect(escaped).toHaveBeenCalledTimes(1);
    });

    it("hands the tooltip the same configuration until the message itself changes", () => {
        act(() => render(<ContextualHelp helpMessage="First." />, container));
        const [ , first ] = mocks.useStaticTooltip.mock.calls.at(-1) ?? [];

        // A re-render with the same message must not tear the tooltip down and build it again:
        // the hook rebuilds on any new configuration object.
        act(() => render(<ContextualHelp helpMessage="First." />, container));
        expect(mocks.useStaticTooltip.mock.calls.at(-1)?.[1]).toBe(first);

        act(() => render(<ContextualHelp helpMessage="Second." />, container));
        expect(mocks.useStaticTooltip.mock.calls.at(-1)?.[1]).not.toBe(first);
        expect(mocks.useStaticTooltip.mock.calls.at(-1)?.[1]).toMatchObject({ title: "Second." });
    });

    it("opens the message in a sheet on tap instead, where nothing hovers", async () => {
        const OnMobile = await loadOnMobile();
        act(() => render(<OnMobile helpMessage="What this figure covers." />, container));

        // The same affordance, and no tooltip behind it: a phone would never show one.
        const span = container.querySelector("span");
        expect(span?.className).toBe("bx bx-info-circle contextual-help-icon");
        expect(mocks.useStaticTooltip).not.toHaveBeenCalled();
        expect(document.body.querySelector(".sheet-stub")).toBeNull();

        act(() => { span?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        // Out at the body rather than beside the icon: where the icon sits — a chart, a cell, a
        // scroll container — is exactly what must not lay the sheet out or clip it.
        const sheet = document.body.querySelector(".sheet-stub");
        expect(sheet?.textContent).toBe("What this figure covers.");
        expect(container.contains(sheet)).toBe(false);
    });

    it("opens that sheet from the keyboard as well, and says that it opens one", async () => {
        const OnMobile = await loadOnMobile();
        act(() => render(<OnMobile helpMessage="What this figure covers." />, container));

        const span = container.querySelector("span");
        expect(span?.getAttribute("role")).toBe("button");
        expect(span?.getAttribute("aria-haspopup")).toBe("dialog");

        expect(press(span, "Enter")).toBe(true);

        const sheet = document.body.querySelector(".sheet-stub");
        expect(sheet?.textContent).toBe("What this figure covers.");
        // Named, since it carries no title of its own: an unnamed dialog is announced as nothing
        // more than "dialog", leaving the reader to work out what has just opened.
        expect(sheet?.getAttribute("aria-label")).toBe("contextual_help.sheet_label()");
    });
});

/** The component as a phone loads it — the layout is read as its module is evaluated, once. */
async function loadOnMobile() {
    mocks.isMobile.mockReturnValue(true);
    vi.resetModules();

    return (await import("./ContextualHelp")).default;
}
