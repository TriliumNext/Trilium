// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import setupLayout from "./layout.js";

describe("setupLayout", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        document.body.className = "";
        document.documentElement.className = "";
        localStorage.clear();
        vi.unstubAllGlobals();
    });

    it("collapses a pane on a wide screen and remembers it", () => {
        vi.stubGlobal("innerWidth", 1024);
        renderPage();

        click("left-pane-toggle-button");
        expect(document.documentElement.classList.contains("left-pane-collapsed")).toBe(true);
        expect(localStorage.getItem("left-pane-collapsed")).toBe("true");

        click("toc-pane-toggle-button");
        click("left-pane-toggle-button");
        expect(document.documentElement.className).toBe("toc-pane-collapsed");
        expect(localStorage.getItem("left-pane-collapsed")).toBe("false");
        expect(localStorage.getItem("toc-pane-collapsed")).toBe("true");
    });

    it("opens one pane at a time on a narrow screen, closed by the backdrop or a return", () => {
        vi.stubGlobal("innerWidth", 768);
        renderPage();

        click("left-pane-toggle-button");
        expect(document.body.className).toBe("menu-open");
        click("toc-pane-toggle-button");
        expect(document.body.className).toBe("toc-open");
        expect(localStorage.length).toBe(0);

        click("mobile-backdrop");
        expect(document.body.className).toBe("");

        click("left-pane-toggle-button");
        window.dispatchEvent(pageShow(false));
        expect(document.body.className).toBe("menu-open");
        window.dispatchEvent(pageShow(true));
        expect(document.body.className).toBe("");
    });

    it("leaves out the controls a page does not have", () => {
        expect(() => setupLayout()).not.toThrow();
    });
});

function renderPage() {
    document.body.innerHTML = `
        <button id="left-pane-toggle-button"></button>
        <button id="toc-pane-toggle-button"></button>
        <div id="mobile-backdrop"></div>
    `;
    setupLayout();
}

function click(id: string) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`#${id} is missing.`);
    }
    element.click();
}

/** A `pageshow` event, for a page restored from the back/forward cache when `persisted`. */
function pageShow(persisted: boolean) {
    return Object.assign(new Event("pageshow"), { persisted });
}
