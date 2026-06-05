import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Collapsible, { ExternallyControlledCollapsible } from "./Collapsible";

let container: HTMLDivElement | undefined;

function renderInto(vnode: unknown) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(vnode as never, container as HTMLDivElement));
    return container;
}

function rerenderInto(vnode: unknown) {
    if (!container) {
        throw new Error("Nothing rendered yet");
    }
    act(() => render(vnode as never, container as HTMLDivElement));
    return container;
}

afterEach(() => {
    if (container) {
        act(() => render(null, container as HTMLDivElement));
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

describe("Collapsible (default, internally controlled)", () => {
    it("renders collapsed by default and exposes title, button and body structure", () => {
        const root = renderInto(<Collapsible title="My Section"><p class="payload">Body</p></Collapsible>);

        const outer = root.querySelector(".collapsible");
        const button = root.querySelector("button.collapsible-title");
        const body = root.querySelector(".collapsible-body");
        const inner = root.querySelector(".collapsible-inner-body");

        expect(outer?.classList.contains("expanded")).toBe(false);
        // With no initiallyExpanded, expanded is undefined → aria-expanded is omitted.
        expect(button?.getAttribute("aria-expanded")).toBeNull();
        // Body is collapsed → height "0" (normalized to "0px"), aria-hidden true, linked to the button by id.
        expect((body as HTMLElement | null)?.style.height).toBe("0px");
        expect(body?.getAttribute("aria-hidden")).toBe("true");
        const contentId = body?.getAttribute("id");
        expect(contentId).toBeTruthy();
        expect(button?.getAttribute("aria-controls")).toBe(contentId);
        // The arrow icon and the projected children are present.
        expect(button?.querySelector("span.arrow")).toBeTruthy();
        expect(inner?.querySelector(".payload")).toBeTruthy();
        expect(button?.textContent ?? "").toContain("My Section");
    });

    it("renders expanded when initiallyExpanded is set", () => {
        const root = renderInto(<Collapsible title="Open" initiallyExpanded><span>x</span></Collapsible>);
        const outer = root.querySelector(".collapsible");
        const button = root.querySelector("button.collapsible-title");
        const body = root.querySelector(".collapsible-body");

        expect(outer?.classList.contains("expanded")).toBe(true);
        expect(button?.getAttribute("aria-expanded")).toBe("true");
        expect(body?.getAttribute("aria-hidden")).toBe("false");
    });

    it("toggles expansion when the title button is clicked", () => {
        const root = renderInto(<Collapsible title="Toggle"><span>x</span></Collapsible>);
        const button = root.querySelector("button.collapsible-title");
        const outer = root.querySelector(".collapsible");
        expect(outer?.classList.contains("expanded")).toBe(false);

        act(() => { (button as HTMLButtonElement | null)?.click(); });
        expect(outer?.classList.contains("expanded")).toBe(true);
        expect(button?.getAttribute("aria-expanded")).toBe("true");

        act(() => { (button as HTMLButtonElement | null)?.click(); });
        expect(outer?.classList.contains("expanded")).toBe(false);
        expect(button?.getAttribute("aria-expanded")).toBe("false");
    });

    it("forwards an extra className onto the outer element", () => {
        const root = renderInto(<Collapsible title="Styled" className="my-extra"><span>x</span></Collapsible>);
        const outer = root.querySelector(".collapsible");
        expect(outer?.classList.contains("my-extra")).toBe(true);
    });
});

describe("Collapsible transition lifecycle (timers)", () => {
    it("enables the transition class after the 200ms delay", () => {
        vi.useFakeTimers();
        try {
            const setExpanded = vi.fn();
            const root = renderInto(
                <ExternallyControlledCollapsible title="T" expanded={false} setExpanded={setExpanded}>
                    <span>x</span>
                </ExternallyControlledCollapsible>
            );
            const outer = root.querySelector(".collapsible");
            expect(outer?.classList.contains("with-transition")).toBe(false);

            act(() => { vi.advanceTimersByTime(200); });
            expect(outer?.classList.contains("with-transition")).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it("marks the body fully-expanded immediately when expanded before the transition is enabled", () => {
        vi.useFakeTimers();
        try {
            const setExpanded = vi.fn();
            const root = renderInto(
                <ExternallyControlledCollapsible title="T" expanded={true} setExpanded={setExpanded}>
                    <span>x</span>
                </ExternallyControlledCollapsible>
            );
            // transitionEnabled is still false at mount → fullyExpanded is set synchronously.
            const body = root.querySelector(".collapsible-body");
            expect(body?.classList.contains("fully-expanded")).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it("defers fully-expanded by 250ms once the transition is enabled and expanded becomes true", () => {
        vi.useFakeTimers();
        try {
            const setExpanded = vi.fn();
            renderInto(
                <ExternallyControlledCollapsible title="T" expanded={false} setExpanded={setExpanded}>
                    <span>x</span>
                </ExternallyControlledCollapsible>
            );

            // Enable the transition first.
            act(() => { vi.advanceTimersByTime(200); });
            const body = () => container?.querySelector(".collapsible-body");
            expect(body()?.classList.contains("fully-expanded")).toBe(false);

            // Now expand: with transition enabled, fully-expanded is deferred by 250ms.
            rerenderInto(
                <ExternallyControlledCollapsible title="T" expanded={true} setExpanded={setExpanded}>
                    <span>x</span>
                </ExternallyControlledCollapsible>
            );
            expect(body()?.classList.contains("fully-expanded")).toBe(false);

            act(() => { vi.advanceTimersByTime(250); });
            expect(body()?.classList.contains("fully-expanded")).toBe(true);

            // Collapsing again clears fully-expanded synchronously.
            rerenderInto(
                <ExternallyControlledCollapsible title="T" expanded={false} setExpanded={setExpanded}>
                    <span>x</span>
                </ExternallyControlledCollapsible>
            );
            expect(body()?.classList.contains("fully-expanded")).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("clears pending timeouts on unmount without throwing", () => {
        vi.useFakeTimers();
        try {
            const setExpanded = vi.fn();
            const root = renderInto(
                <ExternallyControlledCollapsible title="T" expanded={true} setExpanded={setExpanded}>
                    <span>x</span>
                </ExternallyControlledCollapsible>
            );
            // Enable the transition, then leave a deferred fully-expanded timeout pending.
            act(() => { vi.advanceTimersByTime(200); });
            rerenderInto(
                <ExternallyControlledCollapsible title="T" expanded={true} setExpanded={setExpanded}>
                    <span>x</span>
                </ExternallyControlledCollapsible>
            );
            // Unmount while timers are still pending → cleanup callbacks run.
            act(() => render(null, root));
            container = undefined;
            expect(() => act(() => { vi.runAllTimers(); })).not.toThrow();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("ExternallyControlledCollapsible body height", () => {
    it("collapses to height 0 and exposes the measured height when expanded", () => {
        const setExpanded = vi.fn();

        const collapsed = renderInto(
            <ExternallyControlledCollapsible title="H" expanded={false} setExpanded={setExpanded}>
                <span>x</span>
            </ExternallyControlledCollapsible>
        );
        expect((collapsed.querySelector(".collapsible-body") as HTMLElement | null)?.style.height).toBe("0px");

        // When expanded, height comes from useElementSize (a DOMRect height, "0" under happy-dom).
        rerenderInto(
            <ExternallyControlledCollapsible title="H" expanded={true} setExpanded={setExpanded}>
                <span>x</span>
            </ExternallyControlledCollapsible>
        );
        const expandedBody = container?.querySelector(".collapsible-body") as HTMLElement | null;
        expect(expandedBody?.getAttribute("aria-hidden")).toBe("false");
    });

    it("invokes setExpanded with the negated value on click", () => {
        const setExpanded = vi.fn();
        const root = renderInto(
            <ExternallyControlledCollapsible title="C" expanded={false} setExpanded={setExpanded}>
                <span>x</span>
            </ExternallyControlledCollapsible>
        );
        act(() => { (root.querySelector("button.collapsible-title") as HTMLButtonElement | null)?.click(); });
        expect(setExpanded).toHaveBeenCalledWith(true);
    });

    it("treats an undefined expanded prop as collapsed", () => {
        const setExpanded = vi.fn();
        const root = renderInto(
            <ExternallyControlledCollapsible title="U" expanded={undefined} setExpanded={setExpanded}>
                <span>x</span>
            </ExternallyControlledCollapsible>
        );
        const outer = root.querySelector(".collapsible");
        const body = root.querySelector(".collapsible-body");
        expect(outer?.classList.contains("expanded")).toBe(false);
        expect((body as HTMLElement | null)?.style.height).toBe("0px");
        // Clicking from undefined → setExpanded(true) (negation of falsy).
        act(() => { (root.querySelector("button.collapsible-title") as HTMLButtonElement | null)?.click(); });
        expect(setExpanded).toHaveBeenCalledWith(true);
    });
});
