import { Essentials, type ModelElement, Paragraph } from "ckeditor5";
import editorStylesheetUrl from "ckeditor5/ckeditor5.css?url";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import type { TabAlignment } from "./constants.js";
import Tabs from "./tabs.js";
import { applyTabs, revealTab } from "./tabs_read_only.js";

const OPTIONS = { placeholder: "Tab title", scrollLabels: { start: "Back", end: "Next" } };

function tab(title: string, body: string) {
    return `<section class="trilium-tab"><p class="trilium-tab-title">${title}</p>` +
        `<div class="trilium-tab-panel">${body}</div></section>`;
}

/** Three tabs, the last with a title of two lines, so the titles differ in height. */
function tabsHtml(alignment: TabAlignment | null) {
    const attribute = alignment ? ` data-trilium-tab-alignment="${alignment}"` : "";
    return `<div class="trilium-tabs"${attribute}>` +
        tab("Windows", "<p>Run the installer.</p>") +
        tab("Linux", "<p>Use the package.</p>") +
        tab("Two<br>lines", "<p>Wrap it.</p>") +
    "</div>";
}

/** Ten tabs, more than the titles of a 400px block can fit. */
function manyTabsHtml(alignment: TabAlignment | null = null) {
    const attribute = alignment ? ` data-trilium-tab-alignment="${alignment}"` : "";
    const tabs = Array.from({ length: 10 }, (_, index) =>
        tab(`Step ${index + 1} of the guide`, `<p>Body ${index + 1}</p>`));
    return `<div class="trilium-tabs"${attribute}>${tabs.join("")}</div>`;
}

/** Saved `html` that `applyTabs()` set up, in a container `width` pixels wide. */
function renderSaved(html: string, width = 400) {
    const container = document.createElement("div");
    container.className = "ck-content";
    container.style.width = `${width}px`;
    container.innerHTML = html;
    document.body.appendChild(container);
    const dispose = applyTabs(container, OPTIONS);
    onTestFinished(() => {
        dispose();
        container.remove();
    });
    return { container, dispose };
}

/** The first tabs block in `root` and the parts of its title bar. */
function barOf(root: Element) {
    const block = root.querySelector(".trilium-tabs") as HTMLElement;
    const bar = block.querySelector(":scope > .trilium-tabs-bar") as HTMLElement;
    const viewport = bar.querySelector(":scope > .scrollable-bar-viewport") as HTMLElement;
    const titles = [...viewport.children] as HTMLElement[];
    const end = bar.querySelector(".scrollable-bar-edge--end > button") as HTMLButtonElement;
    return { block, bar, viewport, titles, end };
}

function isOverflowing(bar: Element) {
    return bar.classList.contains("scrollable-bar--overflowing");
}

/** Whether all of `title` shows in `viewport`. */
function isShown(title: Element, viewport: Element) {
    const rect = title.getBoundingClientRect();
    const box = viewport.getBoundingClientRect();
    return rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5;
}

/** The radii of the top-left, top-right, bottom-right and bottom-left corners. */
function cornersOf(element: Element | null | undefined) {
    if (!element) {
        return null;
    }
    const style = getComputedStyle(element);
    return [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius
    ].join(" ");
}

/** The top of the text of `element`, which its padding offsets from its box. */
function textTopOf(element: Element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().top;
}

/** The height of the text of `element`, which grows with each line it wraps onto. */
function textHeightOf(element: Element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().height;
}

/** Where the titles of a tabs block sit around the panel of its first tab, and their corners. */
function measure(block: Element | null, alignment: TabAlignment) {
    expect(block).not.toBeNull();
    const titles = [...block?.querySelectorAll(".trilium-tabs-bar .trilium-tab-title") ?? []];
    const panel = block?.querySelector(".trilium-tab--active > .trilium-tab-panel");
    const panelRect = panel?.getBoundingClientRect();
    expect(titles).toHaveLength(3);
    expect(panelRect).toBeDefined();

    const gaps = titles.map(title => {
        const rect = title.getBoundingClientRect();
        const gap = alignment === "top"
            ? (panelRect?.top ?? NaN) - rect.bottom
            : rect.top - (panelRect?.bottom ?? NaN);
        return Math.round(gap);
    });
    return {
        gaps,
        inset: Math.round(titles[0].getBoundingClientRect().left - (panelRect?.left ?? NaN)),
        textOffset: Math.round(textTopOf(titles[1]) - textTopOf(titles[0])),
        corners: [panel, ...titles.slice(0, 2)].map(cornersOf)
    };
}

const EXPECTED = {
    top: {
        gaps: [0, 2, 2],
        inset: 0,
        textOffset: 0,
        corners: ["0px 8px 8px 8px", "8px 8px 0px 0px", "8px 8px 0px 0px"]
    },
    bottom: {
        gaps: [0, 2, 2],
        inset: 0,
        textOffset: 0,
        corners: ["8px 8px 8px 0px", "0px 0px 8px 8px", "0px 0px 8px 8px"]
    }
};

describe("tabs layout styles", () => {
    beforeAll(() => new Promise<void>((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = editorStylesheetUrl;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error("the editor stylesheet did not load"));
        document.head.appendChild(link);
    }));

    it("puts the titles above or below the panel in saved content", () => {
        for (const [attribute, alignment] of [[null, "top"], ["bottom", "bottom"]] as const) {
            const container = document.createElement("div");
            container.className = "ck-content";
            container.style.width = "600px";
            container.innerHTML = tabsHtml(attribute);
            document.body.appendChild(container);
            onTestFinished(() => container.remove());
            applyTabs(container, OPTIONS);

            const block = container.querySelector(".trilium-tabs");
            expect(measure(block, alignment), alignment).toEqual(EXPECTED[alignment]);
        }
    });

    it("puts the titles above or below the panel in the editor", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, Tabs]);
        const editable = editor.ui.view.editable.element as HTMLElement;
        editable.style.width = "600px";

        for (const alignment of ["top", "bottom"] as const) {
            editor.setData(tabsHtml(alignment));
            const block = editable.querySelector(".trilium-tabs.ck-widget");
            expect(measure(block, alignment), alignment).toEqual(EXPECTED[alignment]);
        }
    });

    it("trims the outer margins of the shown panel's content, saved and edited", async () => {
        const html = `<div class="trilium-tabs">` +
            `${tab("A", "<p>First</p><p>Middle</p><p>Last</p>")}${tab("B", "<p>Other</p>")}</div>`;
        const editor = await createTestEditor([Essentials, Paragraph, Tabs]);
        editor.setData(html);
        const editable = editor.ui.view.editable.element as HTMLElement;

        for (const root of [renderSaved(html).container, editable]) {
            const panel = root.querySelector(".trilium-tab--active > .trilium-tab-panel");
            const blocks = [...panel?.querySelectorAll(":scope > p") ?? []];
            expect(blocks.map(block => block.textContent)).toEqual(["First", "Middle", "Last"]);
            const [first, middle, last] = blocks.map(block => getComputedStyle(block));
            expect({ top: first.marginTop, bottom: last.marginBottom })
                .toEqual({ top: "0px", bottom: "0px" });
            expect(middle.marginTop).not.toBe("0px");
        }
    });

    it("clips a long title at 30% of the block (45% on mobile) and scrolls it back", async () => {
        const long = tab("A title far too long for a third of the block", "<p>Body</p>");
        const html = `<div class="trilium-tabs">${long}${tab("B", "")}</div>`;
        const container = document.createElement("div");
        container.className = "ck-content";
        container.style.width = "600px";
        container.innerHTML = html;
        document.body.appendChild(container);
        onTestFinished(() => container.remove());
        applyTabs(container, OPTIONS);

        const editor = await createTestEditor([Essentials, Paragraph, Tabs]);
        const editable = editor.ui.view.editable.element as HTMLElement;
        editable.style.width = "600px";
        editor.setData(html);

        const blocks = [container, editable].map(root => root.querySelector(".trilium-tabs"));
        onTestFinished(() => document.body.classList.remove("mobile"));
        for (const [isMobile, share] of [[false, 0.3], [true, 0.45]] as const) {
            document.body.classList.toggle("mobile", isMobile);
            for (const block of blocks) {
                const [long, short] = [...block?.querySelectorAll(".trilium-tab-title") ?? []];
                expect(long).toBeDefined();
                expect(short).toBeDefined();
                const width = block?.getBoundingClientRect().width ?? NaN;
                expect(long.getBoundingClientRect().width / width, `mobile: ${isMobile}`)
                    .toBeCloseTo(share, 2);
                expect(long.scrollWidth).toBeGreaterThan(long.clientWidth);
                expect(textHeightOf(long)).toBe(textHeightOf(short));
            }
        }

        const title = editable.querySelector(".trilium-tab-title") as HTMLElement;
        editor.editing.view.document.isFocused = true;
        editor.model.change(writer => {
            const root = editor.model.document.getRoot();
            if (root) {
                writer.setSelection(writer.createPositionFromPath(root, [0, 0, 0, 0]));
            }
        });
        title.scrollLeft = 40;
        expect(title.scrollLeft).toBe(40);

        editor.model.change(writer => {
            const root = editor.model.document.getRoot();
            if (root) {
                writer.setSelection(writer.createPositionFromPath(root, [0, 0, 1, 0, 0]));
            }
        });
        expect(title.scrollLeft).toBe(0);
    });

    it("outlines the innermost block holding the caret and rings only a title", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, Tabs]);
        const editable = editor.ui.view.editable.element as HTMLElement;
        editor.editing.view.document.isFocused = true;
        const rootStyle = document.documentElement.style;
        rootStyle.setProperty("--ck-color-focus-border", "rgb(12, 34, 56)");
        rootStyle.setProperty("--link-color", "rgb(65, 43, 21)");
        onTestFinished(() => {
            rootStyle.removeProperty("--ck-color-focus-border");
            rootStyle.removeProperty("--link-color");
        });
        const inner = `<div class="trilium-tabs">${tab("B1", "<p>b1</p>")}${tab("B2", "")}</div>`;
        editor.setData(
            `<p>Before</p><div class="trilium-tabs">${tab("A", inner)}${tab("C", "")}</div>`
        );
        const blocks = [...editable.querySelectorAll<HTMLElement>(".trilium-tabs.ck-widget")];
        const outlines = () => blocks.map(block => getComputedStyle(block).outlineColor);
        const focused = () => blocks.map(block =>
            block.classList.contains("trilium-tabs--focused"));
        const ring = (element: Element | null) => {
            expect(element).not.toBeNull();
            const style = getComputedStyle(element as Element);
            return [style.borderTopColor, style.boxShadow, style.transitionDuration];
        };
        const select = (path: number[]) => editor.model.change(writer => {
            const root = editor.model.document.getRoot();
            if (root) {
                writer.setSelection(writer.createPositionFromPath(root, path));
            }
        });
        expect(blocks).toHaveLength(2);
        expect(outlines()).toEqual(["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]);

        select([1, 0, 1, 0, 0, 1, 0, 0]);
        const innerPanel = blocks[1].querySelector(".trilium-tab-panel");
        expect(ring(innerPanel)).toEqual(["rgba(0, 0, 0, 0)", "none", "0s"]);
        await expect.poll(outlines).toEqual(["rgba(0, 0, 0, 0)", "rgb(65, 43, 21)"]);
        expect(focused()).toEqual([false, true]);

        select([1, 0, 0, 0]);
        const outerTitle = blocks[0].querySelector(".trilium-tab-title");
        expect(ring(outerTitle).filter((_, index) => index !== 1))
            .toEqual(["rgb(12, 34, 56)", "0s"]);
        await expect.poll(outlines).toEqual(["rgb(65, 43, 21)", "rgba(0, 0, 0, 0)"]);
        expect(focused()).toEqual([true, false]);
    });

    it("keeps overflowing titles on one scrolling row and rounds the panel corners", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, Tabs]);
        const editable = editor.ui.view.editable.element as HTMLElement;
        editable.style.width = "400px";

        for (const alignment of ["top", "bottom"] as const) {
            const html = manyTabsHtml(alignment);
            editor.setData(html);
            for (const root of [renderSaved(html).container, editable]) {
                const { block, bar, viewport, titles } = barOf(root);
                await expect.poll(() => isOverflowing(bar), alignment).toBe(true);
                const rects = titles.map(title => title.getBoundingClientRect());
                const lowestTop = Math.max(...rects.map(rect => rect.top));
                const highestBottom = Math.min(...rects.map(rect => rect.bottom));
                expect(lowestTop, alignment).toBeLessThan(highestBottom);
                expect(viewport.scrollWidth).toBeGreaterThan(viewport.clientWidth);
                const panel = block.querySelector(".trilium-tab--active > .trilium-tab-panel");
                expect(cornersOf(panel), alignment).toBe("8px 8px 8px 8px");
            }
        }
    });

    it("keeps the buttons of titles that fit the bar only without them", async () => {
        const tabs = Array.from({ length: 4 }, (_, index) =>
            tab(`Step ${index + 1} of a long guide`, "<p>Body</p>"));
        const { container } = renderSaved(`<div class="trilium-tabs">${tabs.join("")}</div>`, 300);
        const { bar, titles } = barOf(container);
        let toggles = 0;
        const observer = new MutationObserver(() => toggles++);
        observer.observe(bar, { attributeFilter: ["class"] });
        onTestFinished(() => observer.disconnect());

        for (let frame = 0; frame < 10; frame++) {
            await new Promise(requestAnimationFrame);
        }
        expect(isOverflowing(bar)).toBe(true);
        expect(toggles).toBeLessThanOrEqual(1);
        expect(titles[0].getBoundingClientRect().width / bar.getBoundingClientRect().width)
            .toBeCloseTo(0.3, 2);
    });

    it("scrolls the titles with the buttons, and reveals the title of the shown tab", async () => {
        document.body.classList.add("motion-disabled");
        onTestFinished(() => document.body.classList.remove("motion-disabled"));

        const saved = barOf(renderSaved(manyTabsHtml()).container);
        saved.end.click();
        expect(saved.viewport.scrollLeft).toBeGreaterThan(0);
        saved.titles[9].click();
        expect(isShown(saved.titles[9], saved.viewport)).toBe(true);
        saved.titles[9].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
        expect(document.activeElement).toBe(saved.titles[0]);
        expect(saved.viewport.scrollLeft).toBe(0);

        const editor = await createTestEditor([Essentials, Paragraph, Tabs]);
        const editable = editor.ui.view.editable.element as HTMLElement;
        editable.style.width = "400px";
        editor.setData(manyTabsHtml());
        const edited = barOf(editable);
        const tabs = editor.model.document.getRoot()?.getChild(0) as ModelElement;
        const selectPanel = (index: number) => editor.model.change(writer => {
            const tab = tabs.getChild(index) as ModelElement;
            writer.setSelection(tab.getChild(1) as ModelElement, 0);
        });
        await expect.poll(() => isOverflowing(edited.bar)).toBe(true);
        edited.end.click();
        expect(edited.viewport.scrollLeft).toBeGreaterThan(0);

        selectPanel(9);
        expect(isShown(edited.titles[9], edited.viewport)).toBe(true);
        selectPanel(0);
        expect(edited.viewport.scrollLeft).toBe(0);
        selectPanel(9);

        editor.execute("moveTab", { target: "first" });
        expect(edited.viewport.scrollLeft).toBe(0);
        expect(edited.viewport.firstElementChild?.textContent).toBe("Step 10 of the guide");
    });

    it("reveals the title of a nested tab that was hidden in saved content", async () => {
        document.body.classList.add("motion-disabled");
        onTestFinished(() => document.body.classList.remove("motion-disabled"));
        const innerTabs = Array.from({ length: 15 }, (_, index) =>
            tab(`Tab ${index + 1}`, index === 9 ? "<p id=\"target\">x</p>" : ""));
        const inner = `<div class="trilium-tabs">${innerTabs.join("")}</div>`;
        const { container } = renderSaved(
            `<div class="trilium-tabs">${tab("Outer 1", "")}${tab("Outer 2", inner)}</div>`);
        const { bar, viewport, titles } = barOf(container.querySelectorAll(".trilium-tab")[1]);
        expect(isOverflowing(bar)).toBe(false);

        revealTab(container.querySelector("#target") as Element);
        expect(isShown(titles[9], viewport)).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(isOverflowing(bar)).toBe(true);
        expect(isShown(titles[9], viewport)).toBe(true);
    });

    it("stops the title bars of saved content on dispose, and starts them on the next call", () => {
        const { container, dispose } = renderSaved(manyTabsHtml());
        const { bar } = barOf(container);
        expect(isOverflowing(bar)).toBe(true);

        dispose();
        expect(isOverflowing(bar)).toBe(false);

        const disposeAgain = applyTabs(container, OPTIONS);
        onTestFinished(disposeAgain);
        expect(isOverflowing(bar)).toBe(true);
        expect(container.querySelectorAll(".trilium-tabs-bar")).toHaveLength(1);
    });
});
