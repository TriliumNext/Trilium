import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type DelayedVisibilityPhase, useDelayedVisibility } from "./hooks";

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
