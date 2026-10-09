// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import setupLayout from "./layout.js";

describe("setupLayout", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        document.body.className = "";
    });

    it("opens one pane at a time, closed by the backdrop or a return", () => {
        renderPage();

        click("left-pane-toggle-button");
        expect(document.body.className).toBe("menu-open");
        click("toc-pane-toggle-button");
        expect(document.body.className).toBe("toc-open");
        click("toc-pane-toggle-button");
        expect(document.body.className).toBe("");
        click("toc-pane-toggle-button");

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
