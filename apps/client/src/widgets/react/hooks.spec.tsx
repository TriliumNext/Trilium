import type { HighlightedTokenInfo } from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type DelayedVisibilityPhase, useDelayedVisibility, useImperativeSearchHighlighlighting, useStaticTooltip } from "./hooks";

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
});

describe("useImperativeSearchHighlighlighting", () => {
    let container: HTMLElement;
    let target: HTMLElement;

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

    it("wraps a diacritic match when searching a plain, unaccented token (#10616)", () => {
        const el = highlight(["ktory"], "<p>Aký ktorý</p>");
        expect(markedTexts(el)).toEqual(["ktorý"]);
    });

    it("wraps a CJK substring match inside a larger word", () => {
        const el = highlight(["笔记"], "<p>我的笔记本</p>");
        expect(markedTexts(el)).toEqual(["笔记"]);
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
