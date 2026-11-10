import { _setModelData as setModelData, Essentials, Paragraph } from "ckeditor5";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { createTestEditor } from "../../../test/editor-kit.js";
import {
    createHeadingsEditor, findBlock, getDomBlock, outline
} from "../../../test/headings-kit.js";
import {
    applyCollapsedHeadings, isOnHeadingArrow, revealCollapsedHeadings
} from "./collapsible_headings_read_only.js";

/**
 * Saved content with a collapsed `A` (a paragraph, a collapsed `h3`, a list item with a heading in
 * it, a table), an `E` with nothing under it, a collapsed `B` (a paragraph, a block quote with a
 * collapsed heading of its own) and the footnotes.
 */
const CONTENT = "<p>intro</p>" +
    "<h2 data-trilium-collapsed=\"true\">A</h2><p>a1</p>" +
    "<h3 data-trilium-collapsed=\"true\">Sub</h3><p>s1</p>" +
    "<ul><li><h4>Listed</h4></li></ul>" +
    "<figure class=\"table\"><table><tbody><tr><td>cell</td></tr></tbody></table></figure>" +
    "<h2>E</h2>" +
    "<h2 data-trilium-collapsed=\"true\">B</h2><p>b1</p>" +
    "<blockquote><h3 data-trilium-collapsed=\"true\">Quoted</h3><p>q1</p></blockquote>" +
    "<section class=\"footnote-section\"><p>note</p></section>";

describe("applyCollapsedHeadings", () => {
    let container: HTMLElement;
    let dispose: () => void;

    afterEach(() => {
        dispose?.();
        container?.remove();
    });

    function render(html = CONTENT) {
        container = document.createElement("div");
        container.className = "ck-content";
        container.style.setProperty("padding", "0 24px");
        container.innerHTML = html;
        document.body.prepend(container);
        dispose = applyCollapsedHeadings(container);
    }

    /**
     * The children of `parent`, with `▸` before a collapsed heading, `^` after a shown arrow, and
     * a hidden block in parentheses.
     */
    function read(parent: Element = container) {
        return [ ...parent.children ].map((child) => {
            const isCollapsed = child.classList.contains("trilium-heading-collapsed");
            const hasArrow = child.classList.contains("trilium-section-heading")
                && Number(getComputedStyle(child, "::after").opacity) > 0;
            const text = child.matches("h2, h3, h4, p") ? child.textContent : child.localName;
            const label = `${isCollapsed ? "▸" : ""}${text}${hasArrow ? "^" : ""}`;
            return child.checkVisibility() ? label : `(${label})`;
        }).join(", ");
    }

    function getHeading(text: string) {
        const heading = [ ...container.querySelectorAll("h2, h3, h4") ]
            .find((element) => element.textContent === text);
        if (!(heading instanceof HTMLElement)) {
            throw new Error(`No heading "${text}".`);
        }
        return heading;
    }

    /** Clicks the arrow of `heading`, at the end of its first line. */
    async function clickArrow(heading: HTMLElement) {
        await userEvent.click(heading, { position: { x: heading.offsetWidth - 6, y: 6 } });
    }

    it("hides the sections saved as collapsed, with an arrow on their headings", () => {
        render();

        expect(read()).toBe("intro, ▸A^, (a1), (▸Sub^), (s1), (ul), (figure), E, ▸B^, (b1), " +
            "(blockquote), section");
        expect(getHeading("Listed").classList.contains("trilium-section-heading")).toBe(false);
    });

    it("toggles a heading on a click on its arrow only, and keeps the saved state", async () => {
        render();
        const heading = getHeading("A");

        await userEvent.click(heading, { position: { x: 4, y: 6 } });
        expect(read()).toContain("▸A^, (a1)");

        // The pointer stays on the arrow, which shows. `Sub` hides its own section.
        await clickArrow(heading);
        expect(read()).toBe("intro, A^, a1, ▸Sub^, (s1), (ul), (figure), E, ▸B^, (b1), " +
            "(blockquote), section");

        await clickArrow(heading);
        expect(read()).toContain("▸A^, (a1), (▸Sub^), (s1)");
        const saved = [ ...container.querySelectorAll("[data-trilium-collapsed]") ];
        expect(saved.every((element) => element.getAttribute("data-trilium-collapsed") === "true"))
            .toBe(true);
    });

    it("hides a section inside a block quote", async () => {
        render();

        await clickArrow(getHeading("B"));

        const quote = container.querySelector("blockquote") as HTMLElement;
        expect(read(quote)).toBe("▸Quoted^, (q1)");
    });

    it("lights the arrow under the pointer, for headings with blocks under them", async () => {
        render();
        const heading = getHeading("A");

        await userEvent.hover(heading, { position: { x: 4, y: 6 } });
        expect([ ...heading.classList ]).toContain("trilium-heading-hovered");
        expect([ ...heading.classList ]).not.toContain("trilium-heading-arrow-hovered");

        await userEvent.hover(heading, { position: { x: heading.offsetWidth - 6, y: 6 } });
        expect([ ...heading.classList ]).toContain("trilium-heading-arrow-hovered");

        const empty = getHeading("E");
        await userEvent.hover(empty, { position: { x: empty.offsetWidth - 6, y: 6 } });
        expect([ ...heading.classList ]).not.toContain("trilium-heading-hovered");
        expect([ ...empty.classList ]).not.toContain("trilium-heading-hovered");

        container.dispatchEvent(new MouseEvent("mouseleave"));
        expect(container.querySelector(".trilium-heading-hovered")).toBe(null);

        // A held button selects text.
        heading.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, buttons: 1 }));
        expect(container.querySelector(".trilium-heading-hovered")).toBe(null);
    });

    it("expands the headings that hide an element, at every level", () => {
        render();

        revealCollapsedHeadings(container.querySelector("td") as Element);

        expect(read())
            .toBe("intro, A, a1, Sub, s1, ul, figure, E, ▸B^, (b1), (blockquote), section");
    });

    it("leaves the hidden text out of a copy", () => {
        render();

        const selection = window.getSelection() as Selection;
        selection.selectAllChildren(container);

        expect(selection.toString()).not.toContain("a1");
        expect(selection.toString()).toContain("intro");
    });

    it("stops answering the pointer once disposed", async () => {
        render();
        dispose();

        await clickArrow(getHeading("A"));

        expect(read()).toContain("▸A^, (a1)");
    });

    it("toggles a section of 50 among 5,000 blocks in little time", () => {
        render(Array.from({ length: 100 }, (_, index) => (
            `<h2 data-trilium-collapsed="true">H${index}</h2>${"<p>text</p>".repeat(49)}`
        )).join(""));
        const heading = getHeading("H50");
        const rect = heading.getBoundingClientRect();

        const start = performance.now();
        heading.dispatchEvent(new MouseEvent("click", {
            bubbles: true, clientX: rect.right - 6, clientY: rect.top + 6
        }));
        heading.getBoundingClientRect();
        const elapsed = performance.now() - start;

        expect(heading.classList.contains("trilium-heading-collapsed")).toBe(false);
        expect(elapsed, `${elapsed} ms`).toBeLessThan(100);
    });
});

describe("isOnHeadingArrow", () => {
    it("finds the arrow in the padding at the end of the heading, on either side", () => {
        const heading = document.createElement("h2");
        heading.style.cssText = "width: 200px; padding-inline-end: 30px; margin: 0";
        heading.textContent = "Title";
        document.body.prepend(heading);
        const rect = heading.getBoundingClientRect();

        expect(isOnHeadingArrow(heading, rect.right - 10)).toBe(true);
        expect(isOnHeadingArrow(heading, rect.left + 10)).toBe(false);

        heading.dir = "rtl";
        expect(isOnHeadingArrow(heading, rect.left + 10)).toBe(true);
        expect(isOnHeadingArrow(heading, rect.right - 10)).toBe(false);
        heading.remove();
    });
});

describe("revealCollapsedHeadings in an editor", () => {
    it("shows the hidden blocks in the editor without changing the note", async () => {
        const editor = await createHeadingsEditor();
        setModelData(editor.model,
            "<heading2 headingCollapsed=\"true\">Alpha</heading2><paragraph>a1</paragraph>");

        revealCollapsedHeadings(getDomBlock(editor, findBlock(editor, "a1")));

        expect(outline(editor)).toBe("▸Alpha, a1");
    });

    it("does nothing in an editor without hidden blocks", async () => {
        const editor = await createTestEditor([ Essentials, Paragraph ]);
        setModelData(editor.model, "<paragraph>text</paragraph>");
        const paragraph = editor.editing.view.getDomRoot()?.querySelector("p") as HTMLElement;

        expect(() => revealCollapsedHeadings(paragraph)).not.toThrow();
    });
});
