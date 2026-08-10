import { Tooltip } from "bootstrap";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type DelayedVisibilityPhase, useDelayedVisibility, useImperativeSearchHighlighlighting, useStaticTooltip, useTooltip } from "./hooks";

/**
 * mark.js delegating to the real implementation, so marking still works, while recording the calls
 * `unmark()` receives — its DOM effect cannot be observed under happy-dom, where it removes nothing.
 */
const markSpies = vi.hoisted(() => ({ unmark: vi.fn() }));

vi.mock("mark.js", async (importOriginal) => {
    const actual = await importOriginal<{ default: new (ctx: unknown) => Record<string, (...args: unknown[]) => unknown> }>();

    return {
        default: class {
            private inner: Record<string, (...args: unknown[]) => unknown>;

            constructor(ctx: unknown) {
                this.inner = new actual.default(ctx);
            }

            markRegExp(...args: unknown[]) {
                return this.inner.markRegExp(...args);
            }

            unmark(...args: unknown[]) {
                markSpies.unmark(...args);
                return this.inner.unmark(...args);
            }
        }
    };
});

let currentPhase: DelayedVisibilityPhase | undefined;

function Probe({ active }: { active: boolean }) {
    currentPhase = useDelayedVisibility(active, { graceMs: 150, minVisibleMs: 280, stalledMs: 8000 });
    return null;
}

describe("useDelayedVisibility", () => {
    let container: HTMLElement;

    beforeEach(() => {
        vi.useFakeTimers();
        currentPhase = undefined;
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        vi.useRealTimers();
    });

    async function show(active: boolean) {
        await act(async () => {
            render(<Probe active={active} />, container);
        });
    }

    async function advance(ms: number) {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(ms);
        });
    }

    it("never shows when loading finishes within the grace period", async () => {
        await show(true);
        expect(currentPhase).toBe("hidden");

        await advance(100); // still within the 150ms grace window
        await show(false);
        await advance(1000);

        expect(currentPhase).toBe("hidden");
    });

    it("shows after the grace period and stays for the minimum visible time", async () => {
        await show(true);
        await advance(150);
        expect(currentPhase).toBe("visible");

        // Loading finishes shortly after the indicator appeared...
        await advance(10);
        await show(false);

        // ...but the indicator must not flicker away before the minimum visible time.
        await advance(200);
        expect(currentPhase).toBe("visible");

        await advance(100);
        expect(currentPhase).toBe("hidden");
    });

    it("escalates to stalled after continuous loading, then hides immediately once loading ends", async () => {
        await show(true);
        await advance(150);
        expect(currentPhase).toBe("visible");

        await advance(8000);
        expect(currentPhase).toBe("stalled");

        // The minimum visible time has long passed, so deactivation hides without further delay.
        await show(false);
        await advance(0);
        expect(currentPhase).toBe("hidden");
    });
});

describe("useStaticTooltip", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        for (const orphan of document.querySelectorAll(".tooltip")) {
            orphan.remove();
        }
    });

    function TooltipHarness({ generation }: { generation: number }) {
        const ref = useRef<HTMLSpanElement>(null);
        // The inline config object gets a new identity on every render, so the hook's effect
        // re-runs after each commit — mirroring SyncStatus, where the cleanup for the previous
        // trigger element runs only after the keyed remount has already detached it.
        useStaticTooltip(ref, { title: "Sync status", animation: false });
        return <span key={generation} ref={ref} />;
    }

    it("removes a shown tooltip popup when the trigger element is remounted (#10567)", async () => {
        await act(async () => render(<TooltipHarness generation={1} />, container));

        const trigger = container.querySelector("span");
        expect(trigger).not.toBeNull();
        act(() => {
            if (trigger) Tooltip.getInstance(trigger)?.show();
        });
        expect(document.querySelector(".tooltip")).not.toBeNull();

        // Remount the trigger while its tooltip is shown — like a sync state change
        // arriving while the user hovers the sync button.
        await act(async () => render(<TooltipHarness generation={2} />, container));

        expect(document.querySelector(".tooltip")).toBeNull();
    });

    it("puts the tooltip away on a press, which would otherwise leave it standing over what the press opened", async () => {
        await act(async () => render(<TooltipHarness generation={1} />, container));

        const trigger = container.querySelector("span");
        expect(trigger).not.toBeNull();
        act(() => {
            if (trigger) Tooltip.getInstance(trigger)?.show();
        });
        expect(document.querySelector(".tooltip"), "shown").not.toBeNull();

        // The press leaves the trigger focused, and Bootstrap declines to put a tooltip away while a
        // trigger of its own is still active — so nothing else takes it down, pointer gone or not.
        await act(async () => { trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        expect(document.querySelector(".tooltip"), "gone with the press").toBeNull();
    });
});

describe("useTooltip", () => {
    let container: HTMLElement;
    let show: (() => void) | undefined;
    let hide: (() => void) | undefined;

    // Bootstrap defers show()'s completion until the fade-in ends, so the hover state it keeps
    // settles a tick after the event that drove it.
    const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
    const isShown = () => document.querySelector(".tooltip") !== null;

    const CONFIG = { title: "Show help", trigger: "manual" } satisfies Partial<Tooltip.Options>;

    function TooltipHarness() {
        const ref = useRef<HTMLSpanElement>(null);
        ({ showTooltip: show, hideTooltip: hide } = useTooltip(ref, CONFIG));
        return <span ref={ref} />;
    }

    beforeEach(async () => {
        container = document.createElement("div");
        document.body.appendChild(container);
        await act(async () => render(<TooltipHarness />, container));
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        show = hide = undefined;
        for (const orphan of document.querySelectorAll(".tooltip")) {
            orphan.remove();
        }
    });

    it("keeps a manually shown tooltip up after a hover too short for its fade-in", async () => {
        act(() => show?.());
        await settle();
        expect(isShown(), "shown on the first hover").toBe(true);

        // A quick pass over the trigger: away again before the fade-in has finished, which used to
        // leave Bootstrap's own hover flag set with nothing shown (see clearStaleHoverState).
        act(() => show?.());
        act(() => hide?.());
        await settle();
        expect(isShown(), "hidden once the pointer has left").toBe(false);

        // The hover that follows it must stand rather than being put away by the one before.
        act(() => show?.());
        expect(isShown(), "shown straight away").toBe(true);
        await settle();
        expect(isShown(), "still shown with the pointer where it is").toBe(true);
    });
});

describe("useImperativeSearchHighlighlighting", () => {
    let container: HTMLElement;
    let highlight: ((el: HTMLElement | null | undefined) => void) | undefined;

    function Probe({ tokens }: { tokens: string[] | null | undefined }) {
        highlight = useImperativeSearchHighlighlighting(tokens);
        return null;
    }

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        highlight = undefined;
    });

    async function mount(tokens: string[] | null | undefined) {
        await act(async () => render(<Probe tokens={tokens} />, container));
    }

    function content(html: string): HTMLElement {
        const el = document.createElement("div");
        el.innerHTML = html;
        document.body.appendChild(el);
        return el;
    }

    it("highlights matches and opens the collapsed <details> that contains them", async () => {
        await mount([ "needle" ]);
        const target = content("<details><summary>t</summary><p>a needle here</p></details>");

        highlight?.(target);

        expect(target.querySelectorAll(".ck-find-result").length).toBeGreaterThan(0);
        expect(target.querySelector("details")?.open).toBe(true);
        target.remove();
    });

    it("clears previous highlights once the tokens are cleared", async () => {
        // Callers that keep the same element and merely drop the tokens — emptying a filter box —
        // rely on this, or the old highlights stay in the DOM for good.
        //
        // The removal itself is asserted through mark.js rather than the DOM: its `unmark()` is a
        // no-op under happy-dom (it removes nothing even from a fresh instance), so only the call
        // can be observed here.
        await mount([ "needle" ]);
        const target = content("<p>a needle here</p>");
        highlight?.(target);
        expect(target.querySelectorAll(".ck-find-result").length).toBeGreaterThan(0);
        markSpies.unmark.mockClear();

        await mount(null);
        highlight?.(target);

        expect(markSpies.unmark).toHaveBeenCalled();
        target.remove();
    });

    it("does not touch an element that was never highlighted", async () => {
        await mount(null);
        const target = content("<p>a needle here</p>");
        markSpies.unmark.mockClear();

        highlight?.(target);

        expect(markSpies.unmark).not.toHaveBeenCalled();
        expect(target.innerHTML).toBe("<p>a needle here</p>");
        target.remove();
    });

    it("leaves a collapsed block closed when it holds no match", async () => {
        await mount([ "needle" ]);
        const target = content("<details><summary>t</summary><p>nothing relevant</p></details>");

        highlight?.(target);

        expect(target.querySelector("details")?.open).toBe(false);
        target.remove();
    });

    it("does nothing without tokens", async () => {
        await mount([]);
        const target = content("<details><summary>t</summary><p>needle</p></details>");

        highlight?.(target);

        expect(target.querySelectorAll(".ck-find-result").length).toBe(0);
        expect(target.querySelector("details")?.open).toBe(false);
        target.remove();
    });
});
