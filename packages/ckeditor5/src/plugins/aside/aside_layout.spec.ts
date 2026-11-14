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
            expect(measured.marginBlock).toEqual([ 0, measured.em / 2 ]);
            // The line of text beside the float, which starts after the gap.
            const line = document.createRange();
            line.selectNodeContents(left.querySelector(":scope > p") as HTMLElement);
            const lineLeft = line.getClientRects()[0]?.left ?? 0;
            expect(Math.round(lineLeft - left.getBoundingClientRect().left))
                .toBe(Math.round(11 * measured.em));
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
            expect(left.marginBlock).toEqual([ left.em / 2, left.em / 2 ]);

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
        const stacked = measureAside(container);
        expect(stacked).toMatchObject({ float: "none", left: 0, right: 0, width: WIDTH });
        expect(stacked.marginBlock).toEqual([ stacked.em / 2, stacked.em / 2 ]);
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
            ]).toEqual([ em / 2, em / 2, em ]);
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
});
