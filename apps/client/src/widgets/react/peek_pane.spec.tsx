import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isWithinPeek, persistedPaneVisible, reducePaneMode, usePeekDismiss } from "./peek_pane";

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

    it("docks and closes unconditionally", () => {
        for (const prev of ["closed", "peek", "docked"] as const) {
            expect(reducePaneMode(prev, "dock")).toBe("docked");
            expect(reducePaneMode(prev, "close")).toBe("closed");
        }
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
