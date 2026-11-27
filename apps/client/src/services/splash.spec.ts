import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SplashPhase } from "./splash";

const PHASES: SplashPhase[] = [
    { id: "first", weight: 1, status: "First…" },
    { id: "second", weight: 3, status: "Second…" },
    { id: "third", weight: 2, status: "Third…" }
];

/** The module tracks the reported phase, so each test needs a fresh copy of it. */
async function freshSplash(): Promise<typeof import("./splash")> {
    vi.resetModules();
    return import("./splash");
}

function renderSplash() {
    document.body.innerHTML = `
        <div id="splash">
            <div class="splash-bar"><div class="splash-bar-fill"></div></div>
            <div id="splash-status"></div>
        </div>`;
}

function fillWidth(): string {
    return document.querySelector<HTMLElement>(".splash-bar-fill")?.style.width ?? "";
}

beforeEach(() => {
    vi.useFakeTimers();
    renderSplash();
});

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
});

describe("splash", () => {
    it("updates the status line and switches to the error state", async () => {
        const { updateSplashStatus, showSplashError } = await freshSplash();

        updateSplashStatus("Opening your notes…");
        expect(document.getElementById("splash-status")?.textContent).toBe("Opening your notes…");

        showSplashError("something broke");
        expect(document.getElementById("splash")?.classList.contains("splash-error")).toBe(true);
        expect(document.getElementById("splash-status")?.textContent).toBe("something broke");
    });

    it("tracks the running phase's share of the total weight", async () => {
        const { initSplashProgress, reportSplashPhase } = await freshSplash();
        initSplashProgress(PHASES);

        const bar = document.querySelector(".splash-bar");
        expect(bar?.classList.contains("is-continuous")).toBe(true);

        // Weights 1, 3, 2: the bar eases towards the end of whichever phase is running.
        reportSplashPhase("first");
        expect(fillWidth()).toBe("17%");
        reportSplashPhase("second");
        expect(fillWidth()).toBe("67%");
        expect(document.getElementById("splash-status")?.textContent).toBe("Second…");
    });

    it("stops short of a full bar while the startup is still running", async () => {
        const { initSplashProgress, reportSplashPhase } = await freshSplash();
        initSplashProgress(PHASES);

        // The last phase ends the sequence, but a full bar would read as finished.
        reportSplashPhase("third");
        expect(fillWidth()).toBe("95%");
    });

    it("never moves backwards, and ignores an unknown phase", async () => {
        const { initSplashProgress, reportSplashPhase } = await freshSplash();
        initSplashProgress(PHASES);

        reportSplashPhase("second");
        // A phase reported late — or, in a follower tab, out of order — must not undo progress.
        reportSplashPhase("first");
        reportSplashPhase("nonexistent");
        expect(fillWidth()).toBe("67%");
        expect(document.getElementById("splash-status")?.textContent).toBe("Second…");
    });

    it("runs the bar out to full, then fades the splash out and removes it", async () => {
        const { initSplashProgress, reportSplashPhase, hideSplash } = await freshSplash();
        initSplashProgress(PHASES);
        reportSplashPhase("second");

        hideSplash();
        expect(fillWidth()).toBe("100%");
        const bar = document.querySelector(".splash-bar");
        expect(bar?.classList.contains("is-finishing")).toBe(true);
        expect(document.getElementById("splash")?.classList.contains("splash-hidden")).toBe(true);

        vi.runAllTimers();
        expect(document.getElementById("splash")).toBeNull();
    });

    it("reports only an error when the splash is not in the document, on a screen of its own", async () => {
        const {
            initSplashProgress, reportSplashPhase, updateSplashStatus, showSplashError, hideSplash
        } = await freshSplash();
        document.body.innerHTML = "";

        expect(() => {
            initSplashProgress(PHASES);
            reportSplashPhase("first");
            updateSplashStatus("status");
            hideSplash();
        }).not.toThrow();
        expect(document.body.childElementCount).toBe(0);

        showSplashError("something broke");
        const alert = document.body.querySelector("#startup-error[role=alert]");
        expect(alert?.querySelector("img.startup-error-logo")).toBeInstanceOf(HTMLImageElement);
        expect(alert?.querySelector(".startup-error-title")?.textContent).toBe("Trilium Notes");
        expect(alert?.querySelector(".startup-error-message")?.textContent).toBe("something broke");
    });

    it("shows a failure after the splash began to fade on a screen of its own, and logs it", async () => {
        const { hideSplash, showStartupFailure } = await freshSplash();
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        hideSplash();
        const error = new Error("chunk failed");

        showStartupFailure(error);
        expect(document.getElementById("splash")?.classList.contains("splash-error")).toBe(false);
        expect(document.querySelector("#startup-error .startup-error-message")?.textContent)
            .toBe("Trilium failed to start: chunk failed — reload the page to try again.");
        expect(consoleError).toHaveBeenCalledWith("Trilium failed to start:", error);
        consoleError.mockRestore();
    });
});
