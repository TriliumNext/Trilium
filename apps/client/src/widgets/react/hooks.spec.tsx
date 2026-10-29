import type { HighlightedTokenInfo } from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import type NoteContext from "../../components/note_context";
import type TabManager from "../../components/tab_manager";
import { buildNote } from "../../test/easy-froca";
import { highlightedTexts } from "../../test/highlights";
import { setupHoldContextMenu } from "../widget_utils";
import {
    type DelayedVisibilityPhase,
    useBodyClass,
    useDelayedVisibility,
    useDetachedNoteContext,
    useDocumentFocus,
    useFocusWithin,
    useHoldContextMenu,
    useImperativeSearchHighlighlighting,
    useMediaQuery,
    useNoteLabelBoolean,
    useParentClass,
    useStaticTooltip,
    useTooltip,
    useWhenShown
} from "./hooks";

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

describe("useDetachedNoteContext", () => {
    it("registers the context while it is in use, and unregisters it once replaced or unmounted", () => {
        const tabManager = appContext.tabManager;
        const registerDetachedContext = vi.fn();
        const unregisterDetachedContext = vi.fn();
        appContext.tabManager = { registerDetachedContext, unregisterDetachedContext } as unknown as TabManager;
        try {
            const first = { ntxId: "_tree-popup" } as NoteContext;
            const second = { ntxId: "_tree-popup" } as NoteContext;
            function Host({ noteContext }: { noteContext: NoteContext }) {
                useDetachedNoteContext(noteContext);
                return null;
            }
            const container = document.createElement("div");

            act(() => render(<Host noteContext={first} />, container));
            expect(registerDetachedContext).toHaveBeenLastCalledWith(first);

            act(() => render(<Host noteContext={second} />, container));
            expect(unregisterDetachedContext).toHaveBeenLastCalledWith(first);
            expect(registerDetachedContext).toHaveBeenLastCalledWith(second);

            act(() => render(null, container));
            expect(unregisterDetachedContext).toHaveBeenLastCalledWith(second);
        } finally {
            appContext.tabManager = tabManager;
        }
    });
});

describe("useFocusWithin", () => {
    let container: HTMLElement;
    let isFocusWithin: boolean | undefined;

    function FocusProbe() {
        const ref = useRef<HTMLDivElement>(null);
        isFocusWithin = useFocusWithin(ref);
        return (
            <div ref={ref}>
                <button />
                <iframe />
            </div>
        );
    }

    beforeEach(() => {
        vi.useFakeTimers();
        isFocusWithin = undefined;
        container = document.createElement("div");
        document.body.appendChild(container);
        act(() => render(<FocusProbe />, container));
    });

    afterEach(() => {
        act(() => render(null, container));
        container.remove();
        vi.useRealTimers();
    });

    /** Fires `type` at the window, and runs what the hook defers until the focus settles. */
    async function fireOnWindow(type: "blur" | "focus") {
        await act(async () => {
            window.dispatchEvent(new FocusEvent(type));
            await vi.runAllTimersAsync();
        });
    }

    it("follows the focus into the element and out of it, but not out of the window", async () => {
        const inside = container.querySelector("button");
        const outside = document.createElement("button");
        document.body.appendChild(outside);
        expect(isFocusWithin).toBe(false);

        act(() => inside?.focus());
        expect(isFocusWithin).toBe(true);

        // Switching to another window leaves the document's active element where it was.
        await fireOnWindow("blur");
        expect(isFocusWithin).toBe(true);

        await act(async () => {
            outside.focus();
            await vi.runAllTimersAsync();
        });
        expect(isFocusWithin).toBe(false);
        outside.remove();
    });

    it("counts the focus in a frame inside, which only the window reports", async () => {
        const activeElement = vi.spyOn(document, "activeElement", "get");

        activeElement.mockReturnValue(container.querySelector("iframe"));
        await fireOnWindow("blur");
        expect(isFocusWithin).toBe(true);

        activeElement.mockReturnValue(document.body);
        await fireOnWindow("focus");
        expect(isFocusWithin).toBe(false);

        activeElement.mockRestore();
    });
});

describe("useParentClass", () => {
    function Child({ enabled }: { enabled: boolean }) {
        const ref = useRef<HTMLDivElement>(null);
        useParentClass(ref, "child-is-tall", enabled);
        return <div ref={ref} />;
    }

    it("marks the parent while enabled, and unmarks it when disabled or unmounted", () => {
        const parent = document.createElement("div");
        document.body.appendChild(parent);

        act(() => render(<Child enabled={true} />, parent));
        expect(parent.classList.contains("child-is-tall")).toBe(true);

        act(() => render(<Child enabled={false} />, parent));
        expect(parent.classList.contains("child-is-tall")).toBe(false);

        act(() => render(<Child enabled={true} />, parent));
        expect(parent.classList.contains("child-is-tall")).toBe(true);
        act(() => render(null, parent));
        expect(parent.classList.contains("child-is-tall")).toBe(false);
        parent.remove();
    });
});

describe("useBodyClass", () => {
    function Marker({ enabled }: { enabled: boolean }) {
        useBodyClass("probe-open", enabled);
        return null;
    }

    it("keeps the class while any component enables it", () => {
        const first = document.createElement("div");
        const second = document.createElement("div");
        act(() => render(<Marker enabled={true} />, first));
        act(() => render(<Marker enabled={true} />, second));
        expect(document.body.classList.contains("probe-open")).toBe(true);

        act(() => render(<Marker enabled={false} />, first));
        expect(document.body.classList.contains("probe-open")).toBe(true);

        act(() => render(null, second));
        expect(document.body.classList.contains("probe-open")).toBe(false);
        act(() => render(null, first));
    });
});

describe("useDocumentFocus", () => {
    let host: HTMLElement;
    let root: HTMLElement;
    let isFocused: boolean | undefined;

    function Probe({ selector }: { selector?: string }) {
        isFocused = useDocumentFocus(selector);
        return null;
    }

    beforeEach(() => {
        host = document.createElement("div");
        host.innerHTML = `
            <div class="note-split type-text"><input class="in-text"></div>
            <div class="note-split type-code"><input class="in-code"></div>`;
        root = document.createElement("div");
        document.body.append(host, root);
    });

    afterEach(() => {
        act(() => render(null, root));
        host.remove();
        root.remove();
    });

    function inputs() {
        const inText = host.querySelector<HTMLInputElement>(".in-text");
        const inCode = host.querySelector<HTMLInputElement>(".in-code");
        expect(inText && inCode).toBeTruthy();
        return { inText, inCode };
    }

    it("follows the focus into an element that matches the selector and out of it", () => {
        const { inText, inCode } = inputs();
        act(() => render(<Probe selector=".note-split.type-text" />, root));
        expect(isFocused).toBe(false);

        act(() => inText?.focus());
        expect(isFocused).toBe(true);

        act(() => inCode?.focus());
        expect(isFocused).toBe(false);

        act(() => inText?.focus());
        act(() => inText?.blur());
        expect(isFocused).toBe(false);
    });

    it("follows any focus without a selector, including one held before it mounts", () => {
        const { inCode } = inputs();
        act(() => inCode?.focus());
        act(() => render(<Probe />, root));
        expect(isFocused).toBe(true);

        act(() => inCode?.blur());
        expect(isFocused).toBe(false);
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

    it("hides a delegated tooltip once scrolling moves its child out of view", async () => {
        const removeListener = vi.spyOn(document, "removeEventListener");
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

        // The test container is the scroller, its view 100px tall; the span is 20px tall.
        container.getBoundingClientRect = () => new DOMRect(0, 0, 300, 100);
        const scrollSpanTo = (top: number) => act(() => {
            if (span) span.getBoundingClientRect = () => new DOMRect(0, top, 50, 20);
            container.dispatchEvent(new Event("scroll"));
        });

        scrollSpanTo(40);
        expect(document.querySelector(".tooltip"), "kept while in view").not.toBeNull();

        scrollSpanTo(90);
        expect(document.querySelector(".tooltip"), "hidden once partly out of view").toBeNull();
        expect(removeListener.mock.calls.some(([ type ]) => type === "scroll"),
            "stops listening once nothing is shown").toBe(true);
        removeListener.mockRestore();
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

    /** Mounts a fresh hook instance and applies it to `target`. */
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
        return highlightedTexts("search-match", el);
    }

    /**
     * Re-renders the *same* hook instance with new tokens, unlike {@link highlight}, which remounts.
     * Keeping the instance alive is the point: its highlights have to survive into the next call
     * for the clear-on-empty behaviour to be observable at all.
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

    it("wraps an unaccented match when searching an accented token", () => {
        const el = highlight(["ktorý"], "<p>Aky ktory</p>");
        expect(markedTexts(el)).toEqual(["ktory"]);
    });

    it("keeps a decomposed accent inside the match it belongs to", () => {
        const el = highlight(["ktory"], "<p>ktorý a</p>");
        expect(markedTexts(el)).toEqual(["ktorý"]);
    });

    it("matches a multi-word token as one phrase across any whitespace, ignoring case", () => {
        const el = highlight(["Foo bar"], "<p>foo   bar foo baz</p>");
        expect(markedTexts(el)).toEqual(["foo   bar"]);
    });

    it("leaves the content of script and style elements alone", () => {
        const el = highlight(["needle"], "<p>needle</p><style>.needle {}</style>");
        expect(markedTexts(el)).toEqual(["needle"]);
    });

    it("caps the matches of a regex token", () => {
        const el = highlight([{ token: "a", type: "regex" }], `<p>${"a".repeat(600)}</p>`);
        expect(markedTexts(el)).toHaveLength(500);
    });

    it("matches a final sigma whatever the case of the text", () => {
        const el = highlight(["ος"], "<p>ΛΟΓΟΣ λογος</p>");
        expect(markedTexts(el)).toEqual(["ΟΣ", "ος"]);
    });

    it("wraps a CJK substring match inside a larger word", () => {
        const el = highlight(["笔记"], "<p>我的笔记本</p>");
        expect(markedTexts(el)).toEqual(["笔记"]);
    });

    it("clears previous highlights once the tokens are cleared", async () => {
        // Callers that keep the same element and merely drop the tokens — emptying a filter box —
        // rely on this, or the old highlights stay in the DOM for good.
        await remount([ "needle" ]);
        const el = content("<p>a needle here</p>");
        liveHighlight?.(el);
        expect(markedTexts(el)).toEqual([ "needle" ]);

        await remount(null);
        liveHighlight?.(el);

        expect(markedTexts(el)).toEqual([]);
        el.remove();
    });

    it("stops drawing its highlights once unmounted", async () => {
        await remount([ "needle" ]);
        const el = content("<p>a needle here</p>");
        liveHighlight?.(el);
        expect(markedTexts(el)).toEqual([ "needle" ]);

        act(() => render(null, container));

        expect(markedTexts(el)).toEqual([]);
        el.remove();
    });

    it("leaves the DOM of the highlighted element untouched", async () => {
        await remount([ "needle" ]);
        const el = content("<p>a needle here</p>");

        liveHighlight?.(el);

        expect(markedTexts(el)).toEqual([ "needle" ]);
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

    it("wraps only the non-empty matches of a regex that can match nothing", () => {
        const el = highlight([{ token: "o*", type: "regex" }], "<p>foo bar</p>");
        expect(markedTexts(el)).toEqual(["oo"]);
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

describe("useMediaQuery", () => {
    it("follows whether the query matches, and stops listening once unmounted", async () => {
        const listeners = new Set<() => void>();
        const query = { matches: false, addEventListener: (_: string, cb: () => void) => listeners.add(cb),
            removeEventListener: (_: string, cb: () => void) => listeners.delete(cb) };
        vi.spyOn(window, "matchMedia").mockReturnValue(query as unknown as MediaQueryList);

        function Consumer() {
            return <span>{String(useMediaQuery("(min-width: 1100px)"))}</span>;
        }
        const host = document.body.appendChild(document.createElement("div"));
        await act(async () => { render(<Consumer />, host); });
        expect(host.textContent).toBe("false");

        query.matches = true;
        await act(async () => { for (const listener of listeners) listener(); });
        expect(host.textContent).toBe("true");

        await act(async () => { render(null, host); });
        expect(listeners.size).toBe(0);
        host.remove();
        vi.restoreAllMocks();
    });
});

describe("useWhenShown", () => {
    it("runs at once while shown, otherwise the last callback once the element shows", async () => {
        const observers: { callback: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
        const { ResizeObserver } = globalThis;
        globalThis.ResizeObserver = class {
            disconnect = vi.fn();
            constructor(callback: () => void) {
                observers.push({ callback, disconnect: this.disconnect });
            }
            observe() {}
        } as unknown as typeof ResizeObserver;
        let whenShown: ((callback: () => void) => void) | undefined;
        function Consumer() {
            const ref = useRef<HTMLDivElement>(null);
            whenShown = useWhenShown(ref);
            return <div ref={ref} />;
        }
        const host = document.body.appendChild(document.createElement("div"));

        try {
            await act(async () => { render(<Consumer />, host); });
            const runs: string[] = [];
            whenShown?.(() => runs.push("shown"));
            expect(runs).toEqual([ "shown" ]);

            host.style.display = "none";
            whenShown?.(() => runs.push("first"));
            whenShown?.(() => runs.push("last"));
            expect(observers).toHaveLength(1);
            observers[0].callback();
            expect(runs).toEqual([ "shown" ]);

            host.style.display = "";
            observers[0].callback();
            observers[0].callback();
            expect(runs).toEqual([ "shown", "last" ]);
            expect(observers[0].disconnect).toHaveBeenCalled();

            // Unmounted while a callback waits, it stops watching.
            host.style.display = "none";
            whenShown?.(() => runs.push("unmounted"));
            await act(async () => { render(null, host); });
            expect(observers[1].disconnect).toHaveBeenCalled();
            expect(runs).toEqual([ "shown", "last" ]);
        } finally {
            globalThis.ResizeObserver = ResizeObserver;
            host.remove();
        }
    });
});

type HoldMount = (container: HTMLElement, handler: () => void, onClick: () => void) => void;

describe.each<{ name: string, mount: HoldMount }>([
    {
        name: "useHoldContextMenu",
        mount: (container, handler, onClick) => {
            function HoldProbe() {
                return <button type="button" onClick={onClick} {...useHoldContextMenu(handler)} />;
            }
            act(() => render(<HoldProbe />, container));
        }
    },
    {
        name: "setupHoldContextMenu",
        mount: (container, handler, onClick) => {
            const button = document.createElement("button");
            button.addEventListener("click", onClick);
            setupHoldContextMenu(button, handler);
            container.append(button);
        }
    }
])("$name", ({ mount }) => {
    let container: HTMLElement;
    let button: HTMLButtonElement;
    const handler = vi.fn();
    const onClick = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
        handler.mockReset();
        onClick.mockReset();
        container = document.createElement("div");
        document.body.append(container);
        mount(container, handler, onClick);
        const rendered = container.querySelector("button");
        if (!rendered) throw new Error("The probe did not render its button.");
        button = rendered;
    });

    afterEach(() => {
        act(() => render(null, container));
        container.remove();
        vi.useRealTimers();
    });

    function fire(type: string, init: PointerEventInit = {}) {
        const event = type === "click" || type === "contextmenu"
            ? new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
            : new PointerEvent(type, { bubbles: true, cancelable: true, ...init });
        button.dispatchEvent(event);
        return event;
    }

    it("opens after a 500 ms hold and swallows the click that ends it", () => {
        fire("pointerdown", { button: 0, clientX: 12, clientY: 34 });
        vi.advanceTimersByTime(499);
        expect(handler).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0])
            .toMatchObject({ type: "pointerdown", clientX: 12, clientY: 34 });

        // The `contextmenu` Android raises for the same press.
        expect(fire("contextmenu").defaultPrevented).toBe(true);
        fire("pointerup", { button: 0 });
        expect(fire("click").defaultPrevented).toBe(true);
        expect(handler).toHaveBeenCalledOnce();
        expect(onClick).not.toHaveBeenCalled();

        vi.runAllTimers();
        fire("click");
        expect(onClick).toHaveBeenCalledOnce();
    });

    it("ends the hold when the press is released off the button", () => {
        fire("pointerdown", { button: 0 });
        vi.advanceTimersByTime(500);
        fire("pointerleave");
        document.body.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
        vi.runAllTimers();

        // A keyboard click and the context menu key.
        fire("click");
        expect(onClick).toHaveBeenCalledOnce();
        fire("contextmenu");
        expect(handler).toHaveBeenCalledTimes(2);
    });

    it("ignores a short press, a press that slides off or is canceled, and another button", () => {
        fire("pointerdown", { button: 0 });
        vi.advanceTimersByTime(300);
        fire("pointerup", { button: 0 });
        vi.advanceTimersByTime(500);
        fire("click");

        for (const end of [ "pointerleave", "pointercancel" ]) {
            fire("pointerdown", { button: 0 });
            fire(end);
            vi.advanceTimersByTime(500);
        }
        fire("pointerdown", { button: 1 });
        vi.runAllTimers();

        expect(handler).not.toHaveBeenCalled();
        expect(onClick).toHaveBeenCalledOnce();
    });

    it("opens on a right-click", () => {
        fire("pointerdown", { button: 2 });
        const event = fire("contextmenu");
        expect(handler).toHaveBeenCalledWith(event);
        vi.runAllTimers();
        expect(handler).toHaveBeenCalledOnce();
    });
});
