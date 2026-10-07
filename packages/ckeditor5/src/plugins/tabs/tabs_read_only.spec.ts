import { describe, expect, it } from "vitest";

import { applyTabs, revealTab } from "./tabs_read_only.js";

const PLACEHOLDER = "Tab title";

function renderTabs(html: string) {
    const container = document.createElement("div");
    container.innerHTML = html;
    applyTabs(container, { placeholder: PLACEHOLDER });
    return container;
}

function tab(title: string, body: string) {
    return `<section class="trilium-tab"><p class="trilium-tab-title">${title}</p>` +
        `<div class="trilium-tab-panel">${body}</div></section>`;
}

function titleOf(container: HTMLElement, text: string) {
    const title = [...container.querySelectorAll<HTMLElement>(".trilium-tab-title")]
        .find(element => element.textContent === text);
    expect(title).toBeDefined();
    return title as HTMLElement;
}

function activeTitles(container: HTMLElement) {
    return [...container.querySelectorAll(".trilium-tab--active > .trilium-tab-title")]
        .map(title => title.textContent);
}

function press(element: HTMLElement, key: string) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event;
}

describe("applyTabs", () => {
    it("shows the first tab and links each title to its panel", () => {
        const container = renderTabs(`<div class="trilium-tabs">${tab("A", "<p>a</p>")}${tab("B", "<p>b</p>")}</div>`);

        expect(activeTitles(container)).toEqual(["A"]);
        const titles = [...container.querySelectorAll<HTMLElement>(".trilium-tab-title")];
        const panels = [...container.querySelectorAll<HTMLElement>(".trilium-tab-panel")];
        expect(titles.map(title => title.getAttribute("aria-expanded"))).toEqual(["true", "false"]);
        for (const [index, title] of titles.entries()) {
            const panel = panels[index];
            expect(title.getAttribute("role")).toBe("button");
            expect(title.tabIndex).toBe(0);
            expect(panel.id).not.toBe("");
            expect(title.getAttribute("aria-controls")).toBe(panel.id);
            expect(panel.getAttribute("role")).toBe("region");
            expect(panel.getAttribute("aria-labelledby")).toBe(title.id);
        }
        expect(new Set([...titles, ...panels].map(element => element.id)).size).toBe(4);
    });

    it("switches tabs on click, Enter and Space", () => {
        const container = renderTabs(
            `<div class="trilium-tabs">${tab("A", "")}${tab("B", "")}${tab("C", "")}</div>`
        );

        titleOf(container, "B").click();
        expect(activeTitles(container)).toEqual(["B"]);
        expect(titleOf(container, "A").getAttribute("aria-expanded")).toBe("false");
        expect(titleOf(container, "B").getAttribute("aria-expanded")).toBe("true");

        press(titleOf(container, "C"), "Enter");
        expect(activeTitles(container)).toEqual(["C"]);

        expect(press(titleOf(container, "A"), " ").defaultPrevented).toBe(true);
        expect(activeTitles(container)).toEqual(["A"]);
    });

    it("moves between titles with the arrow, Home and End keys", () => {
        const container = renderTabs(
            `<div class="trilium-tabs">${tab("A", "")}${tab("B", "")}${tab("C", "")}</div>`
        );
        document.body.appendChild(container);

        press(titleOf(container, "A"), "ArrowRight");
        expect(activeTitles(container)).toEqual(["B"]);
        expect(document.activeElement).toBe(titleOf(container, "B"));

        press(titleOf(container, "B"), "End");
        expect(activeTitles(container)).toEqual(["C"]);

        press(titleOf(container, "C"), "ArrowRight");
        expect(activeTitles(container)).toEqual(["A"]);

        press(titleOf(container, "A"), "ArrowLeft");
        expect(activeTitles(container)).toEqual(["C"]);

        press(titleOf(container, "C"), "Home");
        expect(activeTitles(container)).toEqual(["A"]);
        expect(document.activeElement).toBe(titleOf(container, "A"));

        titleOf(container, "B").click();
        applyTabs(container, { placeholder: PLACEHOLDER });
        expect(activeTitles(container)).toEqual(["B"]);
        press(titleOf(container, "B"), "ArrowRight");
        expect(activeTitles(container)).toEqual(["C"]);

        container.remove();
    });

    it("labels a title that has no text with the editor's placeholder", () => {
        const container = renderTabs(
            `<div class="trilium-tabs">${tab("&nbsp;", "")}${tab("", "")}${tab("Named", "")}</div>`
        );
        const label = PLACEHOLDER;
        const titles = [...container.querySelectorAll<HTMLElement>(".trilium-tab-title")];
        expect(titles).toHaveLength(3);

        for (const title of titles.slice(0, 2)) {
            expect(title.textContent).toBe("");
            expect(title.dataset.placeholder).toBe(label);
            expect(title.getAttribute("aria-label")).toBe(label);
        }
        expect(titles[2].dataset.placeholder).toBeUndefined();
        expect(titles[2].hasAttribute("aria-label")).toBe(false);
    });

    it("keeps nested tabs blocks independent", () => {
        const inner = `<div class="trilium-tabs">${tab("Inner 1", "")}${tab("Inner 2", "")}</div>`;
        const container = renderTabs(
            `<div class="trilium-tabs">${tab("Outer 1", inner)}${tab("Outer 2", "")}</div>`
        );
        expect(activeTitles(container)).toEqual(["Outer 1", "Inner 1"]);

        titleOf(container, "Inner 2").click();
        expect(activeTitles(container)).toEqual(["Outer 1", "Inner 2"]);

        press(titleOf(container, "Inner 2"), "ArrowRight");
        expect(activeTitles(container)).toEqual(["Outer 1", "Inner 1"]);
    });

    it("reveals every tab that encloses an element", () => {
        const inner = `<div class="trilium-tabs">${tab("Inner 1", "")}${tab("Inner 2", "<p id=\"target\">x</p>")}</div>`;
        const container = renderTabs(
            `<div class="trilium-tabs">${tab("Outer 1", "")}${tab("Outer 2", inner)}</div><p id="outside">y</p>`
        );
        expect(activeTitles(container)).toEqual(["Outer 1", "Inner 1"]);

        const target = container.querySelector("#target");
        expect(target).not.toBeNull();
        revealTab(target as Element);
        expect(activeTitles(container)).toEqual(["Outer 2", "Inner 2"]);
        expect(titleOf(container, "Outer 1").getAttribute("aria-expanded")).toBe("false");

        titleOf(container, "Outer 1").click();
        revealTab(container.querySelector("#outside") as Element);
        expect(activeTitles(container)).toEqual(["Outer 1", "Inner 2"]);
    });
});
