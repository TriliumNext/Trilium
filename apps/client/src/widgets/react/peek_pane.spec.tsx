import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isWithinPeek, PaneModeController, persistedPaneVisible, reducePaneMode, usePaneMode, usePeekDismiss } from "./peek_pane";

describe("reducePaneMode", () => {
    it("opens as peek from closed and closes otherwise", () => {
        expect(reducePaneMode("closed", "togglePeek")).toBe("peek");
        expect(reducePaneMode("peek", "togglePeek")).toBe("closed");
        expect(reducePaneMode("docked", "togglePeek")).toBe("closed");
    });

    it("opens as docked from closed and closes otherwise", () => {
        expect(reducePaneMode("closed", "toggleDocked")).toBe("docked");
        expect(reducePaneMode("peek", "toggleDocked")).toBe("closed");
        expect(reducePaneMode("docked", "toggleDocked")).toBe("closed");
    });

    it("docks, and both close and dismiss reach closed, unconditionally", () => {
        for (const prev of ["closed", "peek", "docked"] as const) {
            expect(reducePaneMode(prev, "dock")).toBe("docked");
            expect(reducePaneMode(prev, "close")).toBe("closed");
            expect(reducePaneMode(prev, "dismiss")).toBe("closed");
        }
    });
});

describe("usePaneMode", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("keeps content mounted across a soft dismiss, and unmounts on a hard close", () => {
        let controller: PaneModeController | undefined;
        const host = document.createElement("div");
        document.body.appendChild(host);
        function Harness() {
            controller = usePaneMode("rightPaneVisible");
            return null;
        }
        act(() => render(<Harness />, host));

        // Starts closed (the mocked option is unset) and unmounted.
        expect(controller?.mode).toBe("closed");
        expect(controller?.mounted).toBe(false);

        act(() => controller?.togglePeek());
        expect(controller?.mode).toBe("peek");
        expect(controller?.visible).toBe(true);
        expect(controller?.mounted).toBe(true);

        // Peek button while open (togglePeek) soft-dismisses: hidden but still mounted.
        act(() => controller?.togglePeek());
        expect(controller?.mode).toBe("closed");
        expect(controller?.visible).toBe(false);
        expect(controller?.mounted).toBe(true);

        // Re-peek reuses it; outside-press/Esc (dismiss) is also soft.
        act(() => controller?.togglePeek());
        act(() => controller?.dismiss());
        expect(controller?.visible).toBe(false);
        expect(controller?.mounted).toBe(true);

        // The × button (hard close) unmounts.
        act(() => controller?.close());
        expect(controller?.visible).toBe(false);
        expect(controller?.mounted).toBe(false);

        act(() => render(null, host));
    });
});

describe("persistedPaneVisible", () => {
    it("persists only when the docked/closed distinction changes", () => {
        // No docked-ness change -> no write (peek is ephemeral).
        expect(persistedPaneVisible("closed", "peek")).toBe(null);
        expect(persistedPaneVisible("peek", "closed")).toBe(null);
        // Becoming docked persists true; leaving docked persists false.
        expect(persistedPaneVisible("closed", "docked")).toBe(true);
        expect(persistedPaneVisible("peek", "docked")).toBe(true);
        expect(persistedPaneVisible("docked", "closed")).toBe(false);
        expect(persistedPaneVisible("docked", "peek")).toBe(false);
    });
});

describe("isWithinPeek", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    const selector = "#right-pane, .my-peek-button";

    it("matches elements inside the allowlisted selector, not outside it or non-elements", () => {
        document.body.innerHTML = `
            <div id="right-pane"><span class="item">x</span></div>
            <button class="my-peek-button"></button>
            <div id="center-pane"><p class="editor">z</p></div>
        `;
        expect(isWithinPeek(document.querySelector(".item"), selector)).toBe(true);
        expect(isWithinPeek(document.querySelector(".my-peek-button"), selector)).toBe(true);
        expect(isWithinPeek(document.querySelector(".editor"), selector)).toBe(false);
        expect(isWithinPeek(document.body, selector)).toBe(false);
        expect(isWithinPeek(null, selector)).toBe(false);
        expect(isWithinPeek(document, selector)).toBe(false);
    });
});

describe("usePeekDismiss", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    function renderHook(active: boolean, onDismiss: () => void, keepOpenSelector = "#right-pane") {
        const host = document.createElement("div");
        document.body.appendChild(host);
        function Harness() {
            usePeekDismiss(active, onDismiss, { keepOpenSelector });
            return null;
        }
        // act() flushes the effect so the document listeners are attached before we dispatch.
        act(() => render(<Harness />, host));
        return () => act(() => render(null, host)); // unmount
    }

    it("keeps the peek open for the instance selector and default popups, dismisses outside", () => {
        document.body.innerHTML = `
            <div id="right-pane"></div>
            <ul class="dropdown-menu"></ul>
            <div id="center-pane"></div>
        `;
        const onDismiss = vi.fn();
        const unmount = renderHook(true, onDismiss);

        // Inside the instance selector keeps it open...
        document.querySelector("#right-pane")?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        // ...as does a default popup root (not in keepOpenSelector, but in the built-in allowlist).
        document.querySelector(".dropdown-menu")?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        expect(onDismiss).not.toHaveBeenCalled();

        // A press anywhere else dismisses.
        document.querySelector("#center-pane")?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        expect(onDismiss).toHaveBeenCalledTimes(1);

        unmount();
    });

    it("dismisses on Escape, and does nothing while inactive", () => {
        const onDismiss = vi.fn();

        const unmountInactive = renderHook(false, onDismiss);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        document.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        expect(onDismiss).not.toHaveBeenCalled();
        unmountInactive();

        const unmountActive = renderHook(true, onDismiss);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(onDismiss).toHaveBeenCalledTimes(1);
        unmountActive();
    });
});
