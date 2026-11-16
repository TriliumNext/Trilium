import "../../theme/table_scroll.css";
import "../../theme/tables.css";
import "../../theme/todo_lists.css";

import { _setModelData as setModelData, Essentials, Paragraph } from "ckeditor5";
import editorStylesheetUrl from "ckeditor5/ckeditor5.css?url";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { applyTableScroll } from "../table_scroll_read_only.js";
import Aside from "./aside.js";

const WIDTH = 800;

/** Renders saved HTML the way the read-only view and shared pages do. */
function renderContent(html: string, width = WIDTH) {
    const container = document.createElement("div");
    container.className = "ck-content";
    container.style.width = `${width}px`;
    // Keeps a wrapped aside out of the container that follows.
    container.style.display = "flow-root";
    container.innerHTML = html;
    document.body.appendChild(container);
    onTestFinished(() => container.remove());
    return container;
}

/** Where the aside of `container` is, relative to the container, how it flows and its margins. */
function measureAside(container: HTMLElement) {
    const aside = container.querySelector("aside");
    if (!aside) {
        throw new Error("Expected an aside.");
    }
    const box = aside.getBoundingClientRect();
    const outer = container.getBoundingClientRect();
    const style = getComputedStyle(aside);
    return {
        float: style.float,
        left: Math.round(box.left - outer.left),
        right: Math.round(outer.right - box.right),
        width: Math.round(box.width),
        marginBlock: [ parseFloat(style.marginTop), parseFloat(style.marginBottom) ],
        em: parseFloat(style.fontSize)
    };
}

/** The first `selector` element of `container`, and its box relative to the container. */
function measure(container: HTMLElement, selector: string) {
    const element = container.querySelector<HTMLElement>(selector);
    if (!element) {
        throw new Error(`Expected ${selector}.`);
    }
    const box = element.getBoundingClientRect();
    const outer = container.getBoundingClientRect();
    return {
        element,
        left: box.left - outer.left,
        right: box.right - outer.left,
        top: box.top - outer.top,
        bottom: box.bottom - outer.top
    };
}

/** Where the first line of text of `element` starts, relative to the page. */
function getTextLeft(element: Element) {
    const range = document.createRange();
    range.selectNodeContents(element.firstChild as Node);
    return range.getClientRects()[0]?.left ?? NaN;
}

describe("aside styles", () => {
    beforeAll(() => new Promise<void>((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = editorStylesheetUrl;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error("the editor stylesheet did not load"));
        document.head.appendChild(link);
    }));

    it("floats a wrapped aside at the side, 22em wide unless resized, with a gap to the text",
        () => {
            const text = "<p>Text beside the aside.</p>";
            const right = measureAside(renderContent(
                `<aside data-position="wrap-right"><p>A</p></aside>${text}`));
            expect(right).toMatchObject(
                { float: "right", right: 0, width: Math.round(22 * right.em) });

            const left = renderContent("<aside data-position=\"wrap-left\" " +
                `style="--aside-width:10em;"><p>A</p></aside>${text}`);
            const measured = measureAside(left);
            expect(measured).toMatchObject({ float: "left", left: 0, width: 10 * measured.em });
            expect(measured.marginBlock[1]).toBe(measured.em / 2);
            // The line of text beside the float, which starts after the gap.
            const line = document.createRange();
            line.selectNodeContents(left.querySelector(":scope > p") as HTMLElement);
            const lineLeft = line.getClientRects()[0]?.left ?? 0;
            expect(Math.round(lineLeft - left.getBoundingClientRect().left))
                .toBe(Math.round(12 * measured.em));
        });

    it("lines the top of a wrapped aside up with the capitals of the text beside it", () => {
        for (const position of [ "wrap-left", "wrap-right" ]) {
            // An empty inline block sits on the baseline; the last block is as high as a capital.
            const container = renderContent(`<p>Before</p><aside data-position="${position}">` +
                "<p>A</p></aside><p>Hello<span style=\"display:inline-block;\"></span></p>" +
                "<div style=\"height:1cap;\"></div>");
            const aside = container.querySelector("aside");
            const baseline = container.querySelector("span");
            const capital = container.querySelector(":scope > div");
            if (!aside || !baseline || !capital) {
                throw new Error("Expected an aside, a baseline and a capital.");
            }

            const capitalsTop = baseline.getBoundingClientRect().bottom
                - capital.getBoundingClientRect().height;
            expect(Math.abs(aside.getBoundingClientRect().top - capitalsTop), position)
                .toBeLessThan(1);
        }
    });

    it("keeps the gap from pushing an aside as wide as the text past it", () => {
        const container = renderContent(
            "<aside data-position=\"wrap-right\" style=\"--aside-width:100em;\"><p>A</p></aside>",
            300);

        expect(measureAside(container)).toMatchObject({ left: 0, right: 0, width: 300 });
    });

    it("sets a heading, a code block and a table in the width beside a wrapped aside", () => {
        const table = (cell: string) => "<figure class=\"table\"><table><tbody><tr>" +
            `<td>${cell}</td><td>b</td></tr></tbody></table></figure>`;
        const blocks = `<h2>Heading</h2><pre><code>code</code></pre>${table("a")}`;

        for (const position of [ "wrap-left", "wrap-right" ]) {
            const container = renderContent(`<aside data-position="${position}" ` +
                `style="--aside-width:10em;">${"<p>A</p>".repeat(12)}</aside>${blocks}`);
            const aside = measure(container, "aside");
            const style = getComputedStyle(aside.element);
            const free = position === "wrap-left"
                ? [ aside.right + parseFloat(style.marginRight), WIDTH ]
                : [ 0, aside.left - parseFloat(style.marginLeft) ];

            for (const selector of [ "h2", "pre", "figure.table" ]) {
                const block = measure(container, selector);
                expect([ block.left, block.right ].map(Math.round), `${selector} ${position}`)
                    .toEqual(free.map(Math.round));
                expect(block.top, `${selector} ${position}`).toBeLessThan(aside.bottom);
            }
        }

        // Without an aside beside it, a table is as wide as the text, in a table cell too.
        const container = renderContent(table(`<div>a</div>${table("a")}`));
        const outer = measure(container, "figure.table");
        expect([ outer.left, outer.right ]).toEqual([ 0, WIDTH ]);
        const cell = measure(container, "td > div");
        const inner = measure(container, "td > figure.table");
        expect([ inner.left, inner.right ]).toEqual([ cell.left, cell.right ]);
    });

    it("sets a scrollable table of the read-only view in the width beside a wrapped aside", () => {
        const table = (style = "") => `<figure class="table"${style}><table><tbody><tr>` +
            "<td>a</td><td>b</td></tr></tbody></table></figure>";
        const render = (position: string, width = WIDTH) => {
            const container = renderContent(`<aside data-position="${position}" ` +
                `style="--aside-width:16em;">${"<p>A</p>".repeat(12)}</aside>` +
                `${table()}${table(" style=\"width:20%;\"")}`, width);
            applyTableScroll(container);
            return container;
        };

        for (const position of [ "wrap-left", "wrap-right" ]) {
            const container = render(position);
            const aside = measure(container, "aside");
            const style = getComputedStyle(aside.element);
            const free = position === "wrap-left"
                ? [ aside.right + parseFloat(style.marginRight), WIDTH ]
                : [ 0, aside.left - parseFloat(style.marginLeft) ];
            const unsized = measure(container, "figure:nth-of-type(1)");
            const sized = measure(container, "figure:nth-of-type(2)");

            expect(unsized.element.style.getPropertyValue("--table-width")).not.toBe("");
            expect([ unsized.left, unsized.right ].map(Math.round), position)
                .toEqual(free.map(Math.round));
            expect(unsized.top, position).toBeLessThan(aside.bottom);
            // A saved width narrower than the free width stays, centered in it.
            const [ start = NaN, end = NaN ] = free;
            expect(Math.round(sized.right - sized.left), position).toBe(WIDTH / 5);
            expect(Math.abs((sized.left - start) - (end - sized.right)), position)
                .toBeLessThan(1);
            expect(sized.top, position).toBeLessThan(aside.bottom);
        }

        // A free width narrower than 200px leaves the table below the aside, at its full width.
        const narrow = render("wrap-right", 400);
        const aside = measure(narrow, "aside");
        const unsized = measure(narrow, "figure:nth-of-type(1)");
        expect(aside.left).toBeLessThan(200);
        expect([ unsized.left, unsized.right ]).toEqual([ 0, 400 ]);
        expect(unsized.top).toBeGreaterThanOrEqual(aside.bottom);
    });

    it("moves a heading below a wrapped aside that leaves no room for its longest word", () => {
        const container = renderContent("<aside data-position=\"wrap-right\" " +
            "style=\"--aside-width:17em;\"><p>A</p><p>B</p></aside><h2>Unbreakable</h2>", 300);
        const aside = measure(container, "aside");
        const heading = measure(container, "h2");

        expect([ heading.left, heading.right ]).toEqual([ 0, 300 ]);
        expect(heading.top).toBeGreaterThanOrEqual(aside.bottom);
    });

    it("keeps the markers, nesting and checkboxes of a list out of an aside at its start", () => {
        const lists = "<ol><li>One<ol><li>Nested</li></ol></li></ol>" +
            "<ul class=\"todo-list\"><li><label class=\"todo-list__label\">" +
            "<input type=\"checkbox\" disabled=\"disabled\">" +
            "<span class=\"todo-list__label__description\">Task</span></label></li></ul>";
        const render = (position: string, dir = "ltr") => {
            const container = renderContent(`<aside data-position="${position}" ` +
                `style="--aside-width:10em;">${"<p>A</p>".repeat(8)}</aside>${lists}`);
            container.dir = dir;
            return container;
        };
        const getDisplays = (container: HTMLElement) =>
            [ ...container.querySelectorAll(":scope > :is(ol, ul)") ]
                .map((list) => getComputedStyle(list).display);

        const container = render("wrap-left");
        const aside = measure(container, "aside");
        expect(measure(container, "ol").left).toBeGreaterThan(aside.right);
        expect(measure(container, "input").left).toBeGreaterThan(aside.right);
        const [ item, nested ] = [ ...container.querySelectorAll("ol > li") ].map(getTextLeft);
        expect(nested).toBeGreaterThan(item ?? NaN);

        // The markers are at the other side of the text, so the lines wrap one by one.
        expect(getDisplays(render("wrap-right"))).toEqual([ "block", "block" ]);
        expect(getDisplays(render("wrap-right", "rtl"))).toEqual([ "flow-root", "flow-root" ]);
        expect(getDisplays(render("wrap-left", "rtl"))).toEqual([ "block", "block" ]);
    });

    it("sets an aside on a line of its own at the side, or across the text without a position",
        () => {
            const left = measureAside(renderContent(
                "<aside data-position=\"left\"><p>A</p></aside><p>Text</p>"));
            expect(left).toMatchObject(
                { float: "none", left: 0, width: Math.round(22 * left.em) });
            expect(left.marginBlock).toEqual([ left.em / 2, left.em / 2 ]);

            const right = measureAside(renderContent(
                "<aside data-position=\"right\"><p>A</p></aside><p>Text</p>"));
            expect(right).toMatchObject(
                { float: "none", right: 0, width: Math.round(22 * right.em) });

            expect(measureAside(renderContent("<aside><p>A</p></aside>")))
                .toMatchObject({ float: "none", left: 0, right: 0, width: WIDTH });
            const centered = measureAside(renderContent(
                "<aside style=\"--aside-width:20em;\"><p>A</p></aside>"));
            expect(centered.left).toBe(centered.right);
        });

    it("stacks a wrapped or resized aside in the text on a phone, across the whole width", () => {
        const container = renderContent(
            "<aside data-position=\"wrap-left\"><p>A</p></aside><p>Text</p>");
        expect(measureAside(container).float).toBe("left");
        const centered = renderContent("<aside style=\"--aside-width:20em;\"><p>A</p></aside>");
        const resized = measureAside(centered);
        expect(resized.width).toBe(20 * resized.em);

        document.body.classList.add("mobile");
        onTestFinished(() => document.body.classList.remove("mobile"));
        const stacked = measureAside(container);
        expect(stacked).toMatchObject({ float: "none", left: 0, right: 0, width: WIDTH });
        expect(stacked.marginBlock).toEqual([ stacked.em / 2, stacked.em / 2 ]);
        expect(measureAside(centered)).toMatchObject({ left: 0, right: 0, width: WIDTH });
    });

    it("shows no buttons that insert a paragraph beside a selected aside", async () => {
        const editor = await createTestEditor([ Essentials, Paragraph, Aside ]);
        setModelData(editor.model, "[<asideBlock position=\"wrap-right\"><asideContent>" +
            "<paragraph>A</paragraph></asideContent></asideBlock>]");
        const typeAround = editor.editing.view.getDomRoot()
            ?.querySelector<HTMLElement>("aside > .ck-widget__type-around");
        const buttons = [
            ...typeAround?.querySelectorAll(".ck-widget__type-around__button") ?? []
        ].map((button) => getComputedStyle(button).display);

        expect(buttons).toEqual([ "none", "none" ]);
        // The fake caret that the arrow keys show beside the aside stays.
        expect(typeAround && getComputedStyle(typeAround).display).not.toBe("none");
    });

    it("insets the blocks of an aside, colored or not, saved and in the editor", async () => {
        const blocks = "<p>First</p><p>Last</p>";
        const colored = `<aside style="background-color:#e64d4d;">${blocks}</aside>`;
        const saved = renderContent(`${colored}<aside>${blocks}</aside>`);
        const editor = await createTestEditor([ Essentials, Paragraph, Aside ]);
        const content = (first: string) => `<asideContent><paragraph>${first}</paragraph>` +
            "<paragraph>Last</paragraph></asideContent>";
        setModelData(editor.model,
            `<asideBlock backgroundColor="#e64d4d">${content("[]First")}</asideBlock>` +
            `<asideBlock>${content("First")}</asideBlock>`);
        editor.editing.view.focus();
        const editing = [
            ...editor.editing.view.getDomRoot()?.querySelectorAll<HTMLElement>("aside") ?? []
        ];
        const asides = [ ...saved.querySelectorAll("aside"), ...editing ];
        expect(asides).toHaveLength(4);

        for (const aside of asides) {
            const box = aside.getBoundingClientRect();
            const [ first, last ] = [ ...aside.querySelectorAll("p") ]
                .map((paragraph) => paragraph.getBoundingClientRect());
            const em = parseFloat(getComputedStyle(aside).fontSize);
            expect([
                Math.round((first?.top ?? 0) - box.top),
                Math.round(box.bottom - (last?.bottom ?? 0)),
                Math.round((first?.left ?? 0) - box.left)
            ]).toEqual([ em / 2, em / 2, em ].map(Math.round));
            expect(getComputedStyle(aside).borderTopLeftRadius).toBe("8px");
        }

        // The padding is on the editable, so a click in it puts the caret in the text.
        for (const aside of editing) {
            const content = aside.querySelector(".aside-content");
            const em = parseFloat(getComputedStyle(aside).fontSize);
            expect([
                getComputedStyle(aside).padding, content && getComputedStyle(content).padding
            ]).toEqual([ "0px", `${em / 2}px ${em}px` ]);
        }

        // The color of the aside shows through the editable that has the caret.
        const focused = editing[0]?.querySelector(".aside-content");
        expect(focused?.classList.contains("ck-editor__nested-editable_focused")).toBe(true);
        expect(focused && getComputedStyle(focused).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    });

    it("sets the text of an aside at .85 of the text around it, saved and in the editor",
        async () => {
            const saved = renderContent("<aside><p>Aside</p></aside><p>Text</p>");
            const editor = await createTestEditor([ Essentials, Paragraph, Aside ]);
            setModelData(editor.model, "<asideBlock><asideContent><paragraph>Aside</paragraph>" +
                "</asideContent></asideBlock><paragraph>Text</paragraph>");
            const fontSize = (element: Element | null | undefined) =>
                element ? parseFloat(getComputedStyle(element).fontSize) : NaN;

            for (const root of [ saved, editor.editing.view.getDomRoot() ]) {
                expect(fontSize(root?.querySelector("aside p")))
                    .toBeCloseTo(.85 * fontSize(root?.querySelector(":scope > p")));
            }
        });
});
