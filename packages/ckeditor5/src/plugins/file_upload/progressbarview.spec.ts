import { Locale } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import ProgressBarView from "./progressbarview.js";

describe("ProgressBarView", () => {
    let locale: Locale;
    let view: ProgressBarView;

    beforeEach(() => {
        locale = new Locale();
        view = new ProgressBarView(locale);
        view.render();
        document.body.appendChild(view.element as HTMLElement);
    });

    afterEach(() => {
        view.element?.remove();
        view.destroy();
    });

    it("renders a div with the ck-progress-bar class", () => {
        expect(view.element?.tagName).toBe("DIV");
        expect(view.element?.classList.contains("ck-progress-bar")).toBe(true);
    });

    it("initial width observable is 100 (rendered as 100% on the element)", () => {
        expect(view.width).toBe(100);
        expect((view.element as HTMLElement).style.width).toBe("100%");
    });

    it("initial customWidth observable is 0 (rendered as 0% on the inner progress div)", () => {
        expect(view.customWidth).toBe(0);
        const inner = view.element?.querySelector(".ck-uploading-progress") as HTMLElement;
        expect(inner).not.toBeNull();
        expect(inner.style.width).toBe("0%");
    });

    it("updates the outer width style when the width observable changes", () => {
        view.set("width", 60);
        expect((view.element as HTMLElement).style.width).toBe("60%");
    });

    it("updates the inner progress div width style when customWidth changes", () => {
        view.set("customWidth", 42);
        const inner = view.element?.querySelector(".ck-uploading-progress") as HTMLElement;
        expect(inner.style.width).toBe("42%");
    });

    it("inner div contains the 'Uploading...' text", () => {
        const inner = view.element?.querySelector(".ck-uploading-progress");
        expect(inner?.textContent).toBe("Uploading...");
    });

    it("renders a cancel button element inside the view", () => {
        const btn = view.element?.querySelector("button");
        expect(btn).not.toBeNull();
    });

    it("fires the 'cancel' event when the cancel button is executed", () => {
        let cancelFired = false;
        view.on("cancel", () => {
            cancelFired = true;
        });

        const btn = view.element?.querySelector("button") as HTMLElement;
        expect(btn).not.toBeNull();
        btn.click();

        expect(cancelFired).toBe(true);
    });

    it("the cancel button has the standard CKEditor button CSS classes", () => {
        const btn = view.element?.querySelector("button");
        expect(btn?.classList.contains("ck")).toBe(true);
        expect(btn?.classList.contains("ck-button")).toBe(true);
        expect(btn?.classList.contains("ck-off")).toBe(true);
    });
});
