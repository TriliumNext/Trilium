import { ClassicEditor, Essentials, FindAndReplace, Paragraph, _getModelData as getModelData } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CollapsibleEditing from "../src/collapsible-editing.js";
import { TRANSIENT_OPEN_ATTRIBUTE } from "../src/constants.js";

/**
 * Find-in-note reveal: when the find highlight lands inside a collapsed block the
 * block opens just enough to show the match, and re-collapses the moment the
 * highlight leaves. This is transient editing-view state — it must never reach the
 * model or the saved HTML, so a user's saved open/closed layout survives a search.
 */
describe("collapsible find-in-note reveal", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;
    let model: ClassicEditor["model"];

    beforeEach(async () => {
        domElement = document.createElement("div");
        document.body.appendChild(domElement);
        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [Essentials, Paragraph, FindAndReplace, CollapsibleEditing]
        });
        model = editor.model;
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    const domRoot = () => editor.editing.view.getDomRoot() as HTMLElement;
    const detailsDom = (index = 0) =>
        domRoot().querySelectorAll<HTMLDetailsElement>("details.trilium-collapsible")[index];
    const isTransient = (index = 0) => detailsDom(index).hasAttribute(TRANSIENT_OPEN_ATTRIBUTE);

    const twoSiblings =
        "<details class=\"trilium-collapsible\"><summary>A</summary><p>needle one</p></details>" +
        "<details class=\"trilium-collapsible\"><summary>B</summary><p>needle two</p></details>";

    it("opens a collapsed block to reveal a match, marks it transient, and leaves the saved HTML untouched", () => {
        editor.setData("<details class=\"trilium-collapsible\"><summary>T</summary><p>needle in body</p></details>");
        expect(detailsDom().open).toBe(false);

        editor.execute("find", "needle");

        expect(detailsDom().open).toBe(true);
        expect(isTransient()).toBe(true);
        // Neither the model nor the saved HTML learns about the reveal.
        expect(getModelData(model, { withoutSelection: true })).not.toContain("open");
        expect(editor.getData()).toBe(
            "<details class=\"trilium-collapsible\"><summary>T</summary><p>needle in body</p></details>"
        );
    });

    it("follows the highlight: the previous block re-collapses as the next one opens", () => {
        editor.setData(twoSiblings);

        editor.execute("find", "needle"); // highlights the first match (block A)
        expect(detailsDom(0).open).toBe(true);
        expect(isTransient(0)).toBe(true);
        expect(detailsDom(1).open).toBe(false);

        editor.execute("findNext"); // moves to block B
        expect(detailsDom(0).open).toBe(false);
        expect(isTransient(0)).toBe(false);
        expect(detailsDom(1).open).toBe(true);
        expect(isTransient(1)).toBe(true);
    });

    it("opens every collapsed ancestor of a nested match", () => {
        editor.setData(
            "<details class=\"trilium-collapsible\"><summary>Outer</summary>" +
                "<details class=\"trilium-collapsible\"><summary>Inner</summary><p>needle</p></details>" +
            "</details>"
        );

        editor.execute("find", "needle");

        expect(detailsDom(0).open).toBe(true);
        expect(isTransient(0)).toBe(true);
        expect(detailsDom(1).open).toBe(true);
        expect(isTransient(1)).toBe(true);
    });

    it("does not mark a block the user already left open as transient", () => {
        editor.setData("<details class=\"trilium-collapsible\" open><summary>T</summary><p>needle</p></details>");
        expect(detailsDom().open).toBe(true);

        editor.execute("find", "needle");

        expect(detailsDom().open).toBe(true);
        expect(isTransient()).toBe(false);
        // Its genuine `open` is still saved.
        expect(editor.getData()).toContain("open");
    });

    it("re-collapses everything once the search is cleared", () => {
        editor.setData(twoSiblings);
        editor.execute("find", "needle");
        expect(detailsDom(0).open).toBe(true);

        const findEditing = editor.plugins.get("FindAndReplaceEditing");
        findEditing.state?.clear(model);

        expect(detailsDom(0).open).toBe(false);
        expect(isTransient(0)).toBe(false);
        expect(detailsDom(1).open).toBe(false);
    });

    it("keeps a block open, and drops the transient marker, if the user toggles it open mid-search", () => {
        editor.setData("<details class=\"trilium-collapsible\"><summary>T</summary><p>needle</p></details>");
        editor.execute("find", "needle");
        expect(isTransient()).toBe(true);

        // User genuinely opens it via the arrow while the match is highlighted.
        domRoot().querySelector<HTMLElement>(".trilium-collapsible-arrow")?.dispatchEvent(
            new MouseEvent("click", { bubbles: true })
        );
        // Highlight moves away (search cleared).
        editor.plugins.get("FindAndReplaceEditing").state?.clear(model);

        expect(detailsDom().open).toBe(true);
        expect(isTransient()).toBe(false);
        expect(editor.getData()).toContain("open");
    });
});
