import {
    _getModelData as getModelData, _setModelData as setModelData, type ClassicEditor
} from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
    createHeadingsEditor, findBlock, getDomBlock, outline
} from "../../../test/headings-kit.js";

const DOCUMENT = "<paragraph>in[]tro</paragraph>" +
    "<heading2 headingCollapsed=\"true\">Alpha</heading2><paragraph>a1</paragraph>" +
    "<heading2>Beta</heading2><paragraph>b1</paragraph>" +
    "<heading2>Gamma</heading2>";

describe("CollapsibleHeadingsUI", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createHeadingsEditor();
        setModelData(editor.model, DOCUMENT);
    });

    function getHeading(text: string) {
        return getDomBlock(editor, findBlock(editor, text));
    }

    /** The heading named `text`, located by its accessible name, which leaves the arrow out. */
    function locate(text: string) {
        return page.getByRole("heading", { name: text, exact: true });
    }

    /** A point on the arrow of `heading`, at the end of its first line. */
    function arrowOf(heading: HTMLElement) {
        return { x: heading.offsetWidth - 6, y: 6 };
    }

    it("toggles a heading on a press on its arrow, and leaves the caret where it is", async () => {
        const beta = getHeading("Beta");

        await userEvent.click(locate("Beta"), { position: arrowOf(beta) });
        expect(outline(editor)).toBe("intro, ▸Alpha, (a1), ▸Beta, (b1), Gamma");
        expect(getModelData(editor.model)).toContain("<paragraph>in[]tro</paragraph>");

        await userEvent.click(locate("Alpha"), { position: arrowOf(getHeading("Alpha")) });
        expect(outline(editor)).toBe("intro, Alpha, a1, ▸Beta, (b1), Gamma");
    });

    it("leaves a press on the text or on a heading without a section to the editor", async () => {
        const gamma = getHeading("Gamma");

        await userEvent.click(locate("Beta"), { position: { x: 4, y: 6 } });
        await userEvent.click(locate("Gamma"), { position: arrowOf(gamma) });

        expect(outline(editor)).toBe("intro, ▸Alpha, (a1), Beta, b1, Gamma");
        expect(getModelData(editor.model)).toContain("<heading2>Gamma[]</heading2>");
    });

    it("shows the arrow of the heading under the pointer, and fills it on the arrow", async () => {
        const beta = getHeading("Beta");

        await userEvent.hover(locate("Beta"), { position: { x: 4, y: 6 } });
        expect([ ...beta.classList ]).toContain("trilium-heading-hovered");
        expect([ ...beta.classList ]).not.toContain("trilium-heading-arrow-hovered");

        await userEvent.hover(locate("Beta"), { position: arrowOf(beta) });
        expect([ ...beta.classList ]).toContain("trilium-heading-arrow-hovered");

        await userEvent.hover(locate("Gamma"), { position: { x: 4, y: 6 } });
        expect([ ...beta.classList ]).not.toContain("trilium-heading-hovered");
        expect([ ...getHeading("Gamma").classList ]).not.toContain("trilium-heading-hovered");

        await userEvent.hover(locate("Beta"), { position: { x: 4, y: 6 } });
        await userEvent.hover(document.body, { position: { x: 1, y: 1 } });
        expect([ ...beta.classList ]).not.toContain("trilium-heading-hovered");
    });

    it("keeps hidden arrows out of hit tests, and arrows out of heading names", async () => {
        const beta = getHeading("Beta");
        const arrow = (heading: HTMLElement) => getComputedStyle(heading, "::after");
        expect(arrow(beta).visibility).toBe("hidden");
        expect(arrow(getHeading("Alpha")).visibility).toBe("visible");

        await userEvent.hover(locate("Beta"), { position: { x: 4, y: 6 } });
        await expect.poll(() => arrow(beta).visibility).toBe("visible");
        // The empty alternative text of the glyph.
        expect(arrow(beta).content).toMatch(/ \/ ""$/);
    });

    it("leaves the arrow alone while a button is held, as in a drag that selects text", () => {
        const beta = getHeading("Beta");
        const rect = beta.getBoundingClientRect();

        beta.dispatchEvent(new MouseEvent("mousemove", {
            bubbles: true, buttons: 1, clientX: rect.right - 6, clientY: rect.top + 6
        }));

        expect([ ...beta.classList ]).not.toContain("trilium-heading-hovered");
    });

    it("shows the arrow of the heading with the caret in a focused editor", async () => {
        editor.editing.view.focus();
        await expect.poll(() => editor.editing.view.document.isFocused).toBe(true);

        editor.model.change((writer) => writer.setSelection(findBlock(editor, "Beta"), 1));
        expect([ ...getHeading("Beta").classList ]).toContain("trilium-heading-selected");

        editor.model.change((writer) => writer.setSelection(findBlock(editor, "Gamma"), 1));
        expect([ ...getHeading("Beta").classList ]).not.toContain("trilium-heading-selected");
        expect([ ...getHeading("Gamma").classList ]).not.toContain("trilium-heading-selected");
    });
});
