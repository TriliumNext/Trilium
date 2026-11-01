// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import setupExpanders from "./navigation.js";

describe("setupExpanders", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        vi.useRealTimers();
    });

    it("expands and collapses a page's subtree, animating its height", () => {
        vi.useFakeTimers();
        document.body.innerHTML = `
            <nav id="menu">
                <ul>
                    <li class="submenu-item">
                        <div class="tree-item-row">
                            <button class="collapse-button" aria-expanded="false"></button>
                            <a href="./parent">Parent</a>
                        </div>
                        <ul><li><a href="./child">Child</a></li></ul>
                    </li>
                </ul>
            </nav>
        `;
        const item = document.querySelector(".submenu-item");
        const subtree = item?.querySelector("ul");
        const expander = item?.querySelector<HTMLElement>(".collapse-button");
        if (!item || !subtree || !expander) {
            throw new Error("The tree is incomplete.");
        }
        Object.defineProperty(subtree, "scrollHeight", { value: 40 });
        setupExpanders();

        const click = new MouseEvent("click", { bubbles: true, cancelable: true });
        expander.dispatchEvent(click);
        expect(click.defaultPrevented).toBe(true);
        expect(item.classList.contains("expanded")).toBe(true);
        expect(expander.getAttribute("aria-expanded")).toBe("true");
        expect(subtree.style.height).toBe("40px");
        expect(subtree.style.overflow).toBe("hidden");
        vi.advanceTimersByTime(200);
        expect(subtree.style.height).toBe("");
        expect(subtree.style.overflow).toBe("");

        expander.click();
        expect(item.classList.contains("expanded")).toBe(false);
        expect(expander.getAttribute("aria-expanded")).toBe("false");
        expect(subtree.style.height).toBe("0px");
        vi.advanceTimersByTime(200);
        expect(subtree.style.height).toBe("");
    });

    it("ignores an expander without a subtree or outside a list item", () => {
        document.body.innerHTML = `
            <nav id="menu">
                <div class="submenu-item"><span class="collapse-button" id="loose"></span></div>
                <ul>
                    <li class="submenu-item"><span class="collapse-button" id="leaf"></span></li>
                </ul>
            </nav>
        `;
        setupExpanders();

        document.getElementById("loose")?.click();
        document.getElementById("leaf")?.click();

        expect(document.querySelector(".expanded")).toBeNull();
    });
});
