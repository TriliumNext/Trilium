import type { HighlightedTokenInfo } from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../../test/easy-froca";
import { type DelayedVisibilityPhase, useDelayedVisibility, useImperativeSearchHighlighlighting, useNoteLabelBoolean, useStaticTooltip, useTooltip } from "./hooks";

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

            mark(...args: unknown[]) {
                return this.inner.mark(...args);
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

    // Module-level (not recreated per render) on purpose, as the icon picker's `ICON_TOOLTIP_CONFIG`
    // is: the container effect never re-runs when the virtualized grid re-keys a cell, so the
    // MutationObserver #10680's fix installs has to survive across that re-render on its own — a
    // config recreated inline, like TooltipHarness above, would re-run the effect and mask exactly
    // what this test checks.
    const DELEGATED_CONFIG = {
        selector: "span",
        animation: false,
        title() {
            return this.getAttribute("title") || "";
        }
    } satisfies Partial<Tooltip.Options>;

    function DelegatedTooltipHarness({ generation }: { generation: number }) {
        const ref = useRef<HTMLDivElement>(null);
        useStaticTooltip(ref, DELEGATED_CONFIG);
        return (
            <div ref={ref}>
                <span key={generation} title="smile" />
            </div>
        );
    }

    it("removes an orphaned popup when a delegated tooltip's hovered child is removed without a mouseleave (#10680)", async () => {
        await act(async () => render(<DelegatedTooltipHarness generation={1} />, container));

        const span = container.querySelector("span");
        expect(span).not.toBeNull();

        // A synthetic mouseenter does not reliably reach Bootstrap's own delegated listener under
        // happy-dom, so the per-span instance is created directly instead — the fix only depends on
        // showing it firing `inserted.bs.tooltip` on the span, which then bubbles to the container
        // exactly as it would from Bootstrap's own delegated hover handling.
        act(() => {
            if (span) {
                Tooltip.getOrCreateInstance(span, {
                    animation: false,
                    title() {
                        return this.getAttribute("title") || "";
                    }
                }).show();
            }
        });
        expect(document.querySelector(".tooltip"), "shown before the remount").not.toBeNull();

        // Replace the hovered span with a fresh one — a keyed remount, like the icon picker's grid
        // re-keying its cells on every keystroke in its search box — without ever firing mouseleave.
        await act(async () => render(<DelegatedTooltipHarness generation={2} />, container));

        // The MutationObserver callback runs as a microtask; give it a turn to fire.
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

        expect(document.querySelector(".tooltip"), "gone once the observer sees the removal").toBeNull();
    });

    it("stops tracking a delegated tooltip that was put away normally, and leaves its instance alone", async () => {
        const observe = vi.spyOn(MutationObserver.prototype, "observe");
        const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
        await act(async () => render(<DelegatedTooltipHarness generation={1} />, container));

        const span = container.querySelector("span");
        expect(span).not.toBeNull();
        // The container is watched only while a popup is up, not from the moment it mounts.
        expect(observe, "not observing before anything is shown").not.toHaveBeenCalled();

        let instance: Tooltip | undefined;
        act(() => {
            if (span) {
                instance = Tooltip.getOrCreateInstance(span, {
                    animation: false,
                    title() {
                        return this.getAttribute("title") || "";
                    }
                });
                instance.show();
            }
        });
        expect(document.querySelector(".tooltip"), "shown").not.toBeNull();
        expect(observe, "observing once a popup is shown").toHaveBeenCalledTimes(1);

        // An ordinary mouseleave-driven hide fires `hidden.bs.tooltip`, which must untrack the
        // span — otherwise the observer below would dispose an instance Bootstrap still owns.
        disconnect.mockClear();
        act(() => instance?.hide());
        expect(document.querySelector(".tooltip"), "hidden the normal way").toBeNull();
        expect(disconnect, "observer let go once nothing is shown").toHaveBeenCalled();
        observe.mockRestore();
        disconnect.mockRestore();

        await act(async () => render(<DelegatedTooltipHarness generation={2} />, container));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

        expect(span && Tooltip.getInstance(span), "instance untouched by the observer").not.toBeNull();
    });

    it("leaves a shown delegated tooltip standing when the mutation removed something else", async () => {
        await act(async () => render(<DelegatedTooltipHarness generation={1} />, container));

        const span = container.querySelector("span");
        expect(span).not.toBeNull();
        act(() => {
            if (span) {
                Tooltip.getOrCreateInstance(span, {
                    animation: false,
                    title() {
                        return this.getAttribute("title") || "";
                    }
                }).show();
            }
        });
        expect(document.querySelector(".tooltip"), "shown").not.toBeNull();

        // Add and remove an unrelated sibling — the observer fires, but the hovered span is
        // still connected, so its tooltip must stay up.
        await act(async () => {
            const bystander = document.createElement("i");
            span?.parentElement?.appendChild(bystander);
            bystander.remove();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(document.querySelector(".tooltip"), "still shown after an unrelated mutation").not.toBeNull();
    });

    it("removes the popup by its aria-describedby link when the instance is already gone", async () => {
        await act(async () => render(<DelegatedTooltipHarness generation={1} />, container));

        const span = container.querySelector("span");
        expect(span).not.toBeNull();

        // Simulate a popup whose Tooltip instance has already been torn down on its own: no
        // instance on the span, just the shown-state markers Bootstrap leaves while a popup is up.
        const strayPopup = document.createElement("div");
        strayPopup.id = "stray-popup-10680";
        strayPopup.className = "tooltip";
        document.body.appendChild(strayPopup);
        act(() => {
            span?.setAttribute("aria-describedby", strayPopup.id);
            span?.dispatchEvent(new Event("inserted.bs.tooltip", { bubbles: true }));
        });

        await act(async () => render(<DelegatedTooltipHarness generation={2} />, container));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

        expect(document.getElementById(strayPopup.id), "stray popup swept by its id").toBeNull();
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
    let target: HTMLElement;
    let liveHighlight: ((el: HTMLElement | null | undefined) => void) | undefined;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        target.remove();
        liveHighlight = undefined;
    });

    function Probe({ tokens, onReady }: {
        tokens: (string | HighlightedTokenInfo)[] | null | undefined;
        onReady: (fn: (el: HTMLElement | null | undefined) => void) => void;
    }) {
        const highlight = useImperativeSearchHighlighlighting(tokens);
        onReady(highlight);
        return null;
    }

    /** Mounts a fresh hook instance (so each call gets its own `Mark` instance) and applies it to `target`. */
    function highlight(tokens: (string | HighlightedTokenInfo)[] | null | undefined, html: string) {
        target.innerHTML = html;
        render(null, container);
        let highlightFn: ((el: HTMLElement | null | undefined) => void) | undefined;
        act(() => {
            render(<Probe tokens={tokens} onReady={(fn) => { highlightFn = fn; }} />, container);
        });
        highlightFn?.(target);
        return target;
    }

    function markedTexts(el: HTMLElement) {
        return Array.from(el.querySelectorAll("span.ck-find-result")).map((mark) => mark.textContent);
    }

    /**
     * Re-renders the *same* hook instance with new tokens, unlike {@link highlight}, which remounts.
     * Keeping the instance alive is the point: its `Mark` has to survive into the next call for the
     * clear-on-empty behaviour to be observable at all.
     */
    async function remount(tokens: (string | HighlightedTokenInfo)[] | null | undefined) {
        await act(async () => {
            render(<Probe tokens={tokens} onReady={(fn) => { liveHighlight = fn; }} />, container);
        });
    }

    /** A detached element to highlight into, so it outlives a {@link remount}. */
    function content(html: string): HTMLElement {
        const el = document.createElement("div");
        el.innerHTML = html;
        document.body.appendChild(el);
        return el;
    }

    it("wraps a diacritic match when searching a plain, unaccented token (#10616)", () => {
        const el = highlight(["ktory"], "<p>Aký ktorý</p>");
        expect(markedTexts(el)).toEqual(["ktorý"]);
    });

    it("wraps a CJK substring match inside a larger word", () => {
        const el = highlight(["笔记"], "<p>我的笔记本</p>");
        expect(markedTexts(el)).toEqual(["笔记"]);
    });

    it("clears previous highlights once the tokens are cleared", async () => {
        // Callers that keep the same element and merely drop the tokens — emptying a filter box —
        // rely on this, or the old highlights stay in the DOM for good.
        //
        // The removal itself is asserted through mark.js rather than the DOM: its `unmark()` is a
        // no-op under happy-dom (it removes nothing even from a fresh instance), so only the call
        // can be observed here.
        await remount([ "needle" ]);
        const el = content("<p>a needle here</p>");
        liveHighlight?.(el);
        expect(el.querySelectorAll(".ck-find-result").length).toBeGreaterThan(0);
        markSpies.unmark.mockClear();

        await remount(null);
        liveHighlight?.(el);

        expect(markSpies.unmark).toHaveBeenCalled();
        el.remove();
    });

    it("does not touch an element that was never highlighted", async () => {
        await remount(null);
        const el = content("<p>a needle here</p>");
        markSpies.unmark.mockClear();

        liveHighlight?.(el);

        expect(markSpies.unmark).not.toHaveBeenCalled();
        expect(el.innerHTML).toBe("<p>a needle here</p>");
        el.remove();
    });

    it("wraps every match of a regex-typed token (#5332)", () => {
        const el = highlight([{ token: "ba.", type: "regex" }], "<p>foo bar baz qux</p>");
        expect(markedTexts(el)).toEqual(["bar", "baz"]);
    });

    it("skips an invalid regex token without throwing", () => {
        expect(() => highlight([{ token: "(unterminated", type: "regex" }], "<p>foo bar</p>")).not.toThrow();
        expect(markedTexts(target)).toEqual([]);
    });

    it("still highlights when given legacy string[] input", () => {
        const el = highlight(["bar"], "<p>foo bar baz</p>");
        expect(markedTexts(el)).toEqual(["bar"]);
    });

    it("is a no-op for null or undefined tokens", () => {
        expect(() => highlight(null, "<p>foo bar</p>")).not.toThrow();
        expect(markedTexts(target)).toEqual([]);

        expect(() => highlight(undefined, "<p>foo bar</p>")).not.toThrow();
        expect(markedTexts(target)).toEqual([]);

        highlight([], "<details><summary>t</summary><p>needle</p></details>");
        expect(markedTexts(target)).toEqual([]);
        expect(target.querySelector("details")?.open).toBe(false);
    });

    it("highlights matches and opens the collapsed <details> that contains them", () => {
        const el = highlight(["needle"], "<details><summary>t</summary><p>a needle here</p></details>");
        expect(markedTexts(el)).toEqual(["needle"]);
        expect(el.querySelector("details")?.open).toBe(true);
    });

    it("leaves a collapsed block closed when it holds no match", () => {
        const el = highlight(["needle"], "<details><summary>t</summary><p>nothing relevant</p></details>");
        expect(markedTexts(el)).toEqual([]);
        expect(el.querySelector("details")?.open).toBe(false);
    });
});

describe("useNoteLabelBoolean", () => {
    let container: HTMLElement | undefined;

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    /**
     * The render that mounts a consumer has already read the label, so forcing another one after it
     * draws everything twice for a value that has not changed. A board draws this once a card.
     */
    it("draws a consumer once for a label that has not changed", async () => {
        const note = buildNote({ title: "Card", "#archived": "true" });
        const draws: boolean[] = [];

        function Consumer() {
            const [ archived ] = useNoteLabelBoolean(note, "archived");
            draws.push(archived);
            return <span>{String(archived)}</span>;
        }

        container = document.body.appendChild(document.createElement("div"));
        await act(async () => {
            render(<Consumer />, container as HTMLElement);
            await new Promise((resolve) => setTimeout(resolve));
        });

        expect(draws).toEqual([ true ]);
    });
});
