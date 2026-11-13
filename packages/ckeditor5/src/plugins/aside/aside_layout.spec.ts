import { _setModelData as setModelData, Essentials, Paragraph } from "ckeditor5";
import editorStylesheetUrl from "ckeditor5/ckeditor5.css?url";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import Aside from "./aside.js";

const WIDTH = 800;

/** Renders saved HTML the way the read-only view and shared pages do. */
function renderContent(html: string, width = WIDTH) {
    const container = document.createElement("div");
    container.className = "ck-content";
    container.style.width = `${width}px`;
    container.innerHTML = html;
    document.body.appendChild(container);
    onTestFinished(() => container.remove());
    return container;
}

/** Where the aside of `container` is, relative to the container, and how it flows. */
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
        em: parseFloat(style.fontSize)
    };
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
            expect(right).toMatchObject({ float: "right", right: 0, width: 22 * right.em });

            const left = renderContent("<aside data-position=\"wrap-left\" " +
                `style="--aside-width:10em;"><p>A</p></aside>${text}`);
            const measured = measureAside(left);
            expect(measured).toMatchObject({ float: "left", left: 0, width: 10 * measured.em });
            // The line of text beside the float, which starts after the gap.
            const line = document.createRange();
            line.selectNodeContents(left.querySelector(":scope > p") as HTMLElement);
            const lineLeft = line.getClientRects()[0]?.left ?? 0;
            expect(Math.round(lineLeft - left.getBoundingClientRect().left))
                .toBe(Math.round(11.5 * measured.em));
        });

    it("keeps the gap from pushing an aside as wide as the text past it", () => {
        const container = renderContent(
            "<aside data-position=\"wrap-right\" style=\"--aside-width:100em;\"><p>A</p></aside>",
            300);

        expect(measureAside(container)).toMatchObject({ left: 0, right: 0, width: 300 });
    });

    it("sets an aside on a line of its own at the side, or across the text without a position",
        () => {
            const left = measureAside(renderContent(
                "<aside data-position=\"left\"><p>A</p></aside><p>Text</p>"));
            expect(left).toMatchObject({ float: "none", left: 0, width: 22 * left.em });

            const right = measureAside(renderContent(
                "<aside data-position=\"right\"><p>A</p></aside><p>Text</p>"));
            expect(right).toMatchObject({ float: "none", right: 0, width: 22 * right.em });

            expect(measureAside(renderContent("<aside><p>A</p></aside>")))
                .toMatchObject({ float: "none", left: 0, right: 0, width: WIDTH });
            const centered = measureAside(renderContent(
                "<aside style=\"--aside-width:20em;\"><p>A</p></aside>"));
            expect(centered.left).toBe(centered.right);
        });

    it("stacks a wrapped aside in the text on a phone, across the whole width", () => {
        const container = renderContent(
            "<aside data-position=\"wrap-left\"><p>A</p></aside><p>Text</p>");
        expect(measureAside(container).float).toBe("left");

        document.body.classList.add("mobile");
        onTestFinished(() => document.body.classList.remove("mobile"));
        expect(measureAside(container))
            .toMatchObject({ float: "none", left: 0, right: 0, width: WIDTH });
    });

    it("sets the blocks of an aside against its edges, saved and in the editor", async () => {
        const saved = renderContent(
            "<aside data-position=\"wrap-right\"><p>First</p><p>Last</p></aside>");
        const editor = await createTestEditor([ Essentials, Paragraph, Aside ]);
        setModelData(editor.model, "<asideBlock position=\"wrap-right\"><asideContent>" +
            "<paragraph>First</paragraph><paragraph>Last</paragraph></asideContent></asideBlock>");
        const editing = editor.editing.view.getDomRoot()?.querySelector<HTMLElement>("aside");

        for (const aside of [ saved.querySelector("aside"), editing ]) {
            const box = aside?.getBoundingClientRect();
            const [ first, last ] = [ ...aside?.querySelectorAll("p") ?? [] ]
                .map((paragraph) => paragraph.getBoundingClientRect());
            expect([
                Math.round((first?.top ?? 0) - (box?.top ?? 0)),
                Math.round((box?.bottom ?? 0) - (last?.bottom ?? 0)),
                Math.round((first?.left ?? 0) - (box?.left ?? 0))
            ]).toEqual([ 0, 0, 0 ]);
        }
    });
});
