import { _getModelData as getModelData, _setModelData as setModelData, ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { createTestEditor } from "../../../test/editor-kit.js";
import CollapsibleEditing from "./collapsible_editing.js";

/**
 * Deleting across a collapsible's boundary.
 *
 * CKEditor's own `deleteContent` folds a block that a deletion left empty *into* the
 * <details> holding the other end of the range, renaming it to `summary` on the way. The
 * model that comes out is fine, but the editing view keeps the moved element's old view
 * element (reconverting a <details> re-slots its children rather than converting them
 * again), so the collapsible renders with no title at all and the next caret move throws
 * `mapping-model-offset-not-found`. Every test here asserts the *rendered* result, not
 * just the model — the model was never the broken half.
 */
describe("collapsible: deleting across the boundary", () => {
    let editor: ClassicEditor;
    let root: HTMLElement;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, CollapsibleEditing]);
        root = editor.editing.view.getDomRoot() as HTMLElement;
    });

    function fireDelete(direction: "backward" | "forward" = "forward"): void {
        editor.editing.view.document.fire("delete", { direction, unit: "character", preventDefault: vi.fn() });
        editor.editing.view.forceRender();
    }

    /**
     * A delete carrying a browser-computed range, the way `DeleteObserver` reports one for
     * `deleteContentBackward`. `selectionToRemove` is built from a model range so a spec can
     * state the span it means; the observer derives the same thing from the DOM.
     */
    function fireDeleteSelection(range: any, direction: "backward" | "forward" = "backward"): void {
        const view = editor.editing.view;
        view.document.fire("delete", {
            direction,
            unit: "selection",
            selectionToRemove: view.createSelection(editor.editing.mapper.toViewRange(range)),
            preventDefault: vi.fn()
        });
        view.forceRender();
    }

    /** Model range between two positions, each given as a path from the root. */
    function modelRange(start: number[], end: number[]): any {
        const model = editor.model;
        const root = model.document.getRoot() as any;
        return model.createRange(
            model.createPositionFromPath(root, start),
            model.createPositionFromPath(root, end)
        );
    }

    /** The editing view of the outermost collapsible, as rendered. */
    function renderedCollapsible(): { title: string | null, body: string | null } {
        const details = root.querySelector("details.trilium-collapsible");
        return {
            title: details?.querySelector(":scope > summary")?.textContent ?? null,
            body: details?.querySelector(":scope > .trilium-collapsible-content")?.textContent ?? null
        };
    }

    describe("Delete on a blank line above a collapsible", () => {
        it("drops the blank line and moves the caret into the title", () => {
            setModelData(
                editor.model,
                "<paragraph>[]</paragraph>" +
                "<details open=\"true\"><summary>Title</summary><paragraph>body</paragraph></details>"
            );

            fireDelete();

            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary>[]Title</summary><paragraph>body</paragraph></details>"
            );
            // The title still renders as a <summary> holding the model's text — the
            // regression replaced it with the blank line's <p>, leaving the browser to
            // draw its default "Details" marker.
            expect(renderedCollapsible()).toEqual({ title: "Title", body: "body" });
            // A second press used to throw mapping-model-offset-not-found.
            expect(() => fireDelete()).not.toThrow();
        });

        it("works the same on a collapsed collapsible", () => {
            setModelData(
                editor.model,
                "<paragraph>[]</paragraph>" +
                "<details><summary>Title</summary><paragraph>body</paragraph></details>"
            );

            fireDelete();

            expect(getModelData(editor.model)).toBe(
                "<details><summary>[]Title</summary><paragraph>body</paragraph></details>"
            );
            expect(renderedCollapsible().title).toBe("Title");
        });

        it("moves into a nested collapsible from a blank body line", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>Outer</summary>" +
                    "<paragraph>[]</paragraph>" +
                    "<details open=\"true\"><summary>Inner</summary><paragraph>b</paragraph></details>" +
                "</details>"
            );

            fireDelete();

            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary>Outer</summary>" +
                    "<details open=\"true\"><summary>[]Inner</summary><paragraph>b</paragraph></details>" +
                "</details>"
            );
            expect(root.querySelectorAll("summary")).toHaveLength(2);
        });

        it("only moves the caret when the blank block is the title itself", () => {
            // An empty <summary> is a title, not a blank line: removing it would only make
            // the summary-invariant post-fixer put a fresh one back.
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>[]</summary>" +
                    "<details open=\"true\"><summary>Inner</summary><paragraph>b</paragraph></details>" +
                "</details>"
            );

            fireDelete();

            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary></summary>" +
                    "<details open=\"true\"><summary>[]Inner</summary><paragraph>b</paragraph></details>" +
                "</details>"
            );
            expect(root.querySelectorAll("summary")).toHaveLength(2);
        });

        it("leaves a block with content to CKEditor's own merge", () => {
            setModelData(
                editor.model,
                "<paragraph>a[]</paragraph>" +
                "<details open=\"true\"><summary>Title</summary><paragraph>body</paragraph></details>"
            );

            fireDelete();

            // Merged left: the title text joins the paragraph and the collapsible keeps an
            // empty title. Nothing was moved into the <details>, so the view is consistent.
            expect(getModelData(editor.model)).toBe(
                "<paragraph>a[]Title</paragraph>" +
                "<details open=\"true\"><summary></summary><paragraph>body</paragraph></details>"
            );
            expect(renderedCollapsible()).toEqual({ title: "", body: "body" });
        });
    });

    describe("selections running from above into a collapsible", () => {
        it("deletes the selected content without folding the blank line into the title", () => {
            setModelData(
                editor.model,
                "<paragraph>[</paragraph>" +
                "<details open=\"true\"><summary>Ti]tle</summary><paragraph>body</paragraph></details>"
            );

            fireDelete();

            expect(getModelData(editor.model)).toBe(
                "<paragraph>[]</paragraph>" +
                "<details open=\"true\"><summary>tle</summary><paragraph>body</paragraph></details>"
            );
            expect(renderedCollapsible()).toEqual({ title: "tle", body: "body" });
        });

        it("holds when the selection reaches into the body", () => {
            setModelData(
                editor.model,
                "<paragraph>[</paragraph>" +
                "<details open=\"true\"><summary>Title</summary><paragraph>bo]dy</paragraph></details>"
            );

            fireDelete();

            expect(getModelData(editor.model)).toBe(
                "<paragraph>[]</paragraph>" +
                "<details open=\"true\"><summary></summary><paragraph>dy</paragraph></details>"
            );
            expect(renderedCollapsible()).toEqual({ title: "", body: "dy" });
        });

        it("holds when the selection is typed over", () => {
            setModelData(
                editor.model,
                "<paragraph>[</paragraph>" +
                "<details open=\"true\"><summary>Ti]tle</summary><paragraph>body</paragraph></details>"
            );

            editor.execute("insertText", { text: "Z" });
            editor.editing.view.forceRender();

            expect(getModelData(editor.model)).toBe(
                "<paragraph>Z[]</paragraph>" +
                "<details open=\"true\"><summary>tle</summary><paragraph>body</paragraph></details>"
            );
            expect(renderedCollapsible().title).toBe("tle");
        });

        it("still merges when content survives in the block above", () => {
            setModelData(
                editor.model,
                "<paragraph>ab[c</paragraph>" +
                "<details open=\"true\"><summary>Ti]tle</summary><paragraph>body</paragraph></details>"
            );

            fireDelete();

            expect(getModelData(editor.model)).toBe(
                "<paragraph>ab[]tle</paragraph>" +
                "<details open=\"true\"><summary></summary><paragraph>body</paragraph></details>"
            );
        });

        it("still merges a selection that stays inside one collapsible", () => {
            // Both ends share the same <details>, so nothing is moved into it — the title
            // is renamed into the body block it merges with, which reconverts correctly,
            // and the summary-invariant post-fixer restores a blank title.
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>[Ti</summary><paragraph>bo]dy</paragraph></details>"
            );

            fireDelete();

            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary></summary><paragraph>[]dy</paragraph></details>"
            );
            expect(renderedCollapsible()).toEqual({ title: "", body: "dy" });
        });

        it("still merges when the selection runs out of a collapsible instead of into one", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><paragraph>[x</paragraph></details>" +
                "<paragraph>y]z</paragraph>"
            );

            fireDelete();

            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary>T</summary><paragraph>[]z</paragraph></details>"
            );
            expect(renderedCollapsible()).toEqual({ title: "T", body: "z" });
        });
    });

    /**
     * Backspace at the start of the line below a *collapsed* collapsible (issue #11050).
     *
     * Chrome derives the target range of `deleteContentBackward` from the rendered layout,
     * where a closed collapsible shows nothing but its title, so it reports a range running
     * from the end of the <summary> through every hidden block to the caret. Acting on it
     * wipes the body while the block stays closed, and the user sees nothing happen. The
     * first four need a real key press: a synthetic `delete` event carries no browser range.
     */
    describe("Backspace below a collapsed collapsible", () => {
        const BODY = "<paragraph>one</paragraph><paragraph>two</paragraph>";
        const CLOSED = `<details><summary>Title</summary>${BODY}</details>`;
        const OPEN = `<details open="true"><summary>Title</summary>${BODY}</details>`;

        it("removes the blank line and leaves the hidden body untouched", async () => {
            setModelData(editor.model, `${CLOSED}<paragraph>[]</paragraph>`);
            editor.editing.view.focus();

            await userEvent.keyboard("{Backspace}");

            expect(getModelData(editor.model)).toBe(
                `<details><summary>Title[]</summary>${BODY}</details>`
            );
            expect(renderedCollapsible()).toEqual({ title: "Title", body: "onetwo" });
        });

        it("expands the block when the line below it has content to merge in", async () => {
            setModelData(editor.model, `${CLOSED}<paragraph>[]after</paragraph>`);
            editor.editing.view.focus();

            await userEvent.keyboard("{Backspace}");

            // Merging "after" into a hidden block would take it off screen with no sign of
            // where it went, so the collapsible opens and the result stays in view.
            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary>Title</summary>" +
                    "<paragraph>one</paragraph><paragraph>two[]after</paragraph>" +
                "</details>"
            );
            expect(renderedCollapsible()).toEqual({ title: "Title", body: "onetwoafter" });
        });

        it("takes back the merge and the reveal on one undo", async () => {
            setModelData(editor.model, `${CLOSED}<paragraph>[]after</paragraph>`);
            editor.editing.view.focus();

            await userEvent.keyboard("{Backspace}");
            editor.execute("undo");

            // The reveal rides the deletion's batch, so the block is collapsed again rather
            // than left open over restored content.
            expect(getModelData(editor.model)).toBe(
                `<details><summary>Title[]</summary>${BODY}</details><paragraph>after</paragraph>`
            );
        });

        it("expands a nested collapsed block that content merges into", async () => {
            setModelData(editor.model,
                "<details open=\"true\"><summary>Outer</summary>" +
                    `<details><summary>Inner</summary>${BODY}</details>` +
                    "<paragraph>[]x</paragraph>" +
                "</details>");
            editor.editing.view.focus();

            await userEvent.keyboard("{Backspace}");

            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary>Outer</summary>" +
                    "<details open=\"true\"><summary>Inner</summary>" +
                        "<paragraph>one</paragraph><paragraph>two[]x</paragraph>" +
                    "</details>" +
                "</details>"
            );
        });

        it("leaves the block closed when the merge guard cancels the merge", () => {
            // The range runs out of one collapsed block and into the next, so the guard sets
            // `leaveUnmerged` and nothing is folded into the first — there is nothing to reveal.
            setModelData(editor.model,
                "<details><summary>A</summary><paragraph>[x</paragraph></details>" +
                "<details><summary>B</summary><paragraph>y]z</paragraph></details>");

            fireDeleteSelection(editor.model.document.selection.getFirstRange());

            // A keeps its collapsed state; the caret lands in its title because the emptied
            // body is hidden. B's title went with the selected range, as it always has.
            expect(getModelData(editor.model)).toBe(
                "<details><summary>A[]</summary><paragraph></paragraph></details>" +
                "<details><summary></summary><paragraph>z</paragraph></details>"
            );
        });

        it("protects a collapsed collapsible nested in an open one", async () => {
            setModelData(editor.model,
                "<details open=\"true\"><summary>Outer</summary>" +
                    `<details><summary>Inner</summary>${BODY}</details>` +
                    "<paragraph>[]</paragraph>" +
                "</details>");
            editor.editing.view.focus();

            await userEvent.keyboard("{Backspace}");

            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary>Outer</summary>" +
                    `<details><summary>Inner[]</summary>${BODY}</details>` +
                "</details>"
            );
        });

        it("leaves an open collapsible to CKEditor's own merge", async () => {
            setModelData(editor.model, `${OPEN}<paragraph>[]</paragraph>`);
            editor.editing.view.focus();

            await userEvent.keyboard("{Backspace}");

            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary>Title</summary>" +
                    "<paragraph>one</paragraph><paragraph>two[]</paragraph>" +
                "</details>"
            );
        });

        it("keeps a range the user selected across a collapsed collapsible", () => {
            // A hand-made selection can legitimately span a closed block — dragging from
            // above it to below it — and deleting that is what was asked for. Only a
            // collapsed caret gets the browser's range second-guessed.
            setModelData(editor.model,
                `<paragraph>a[bove</paragraph>${CLOSED}<paragraph>be]low</paragraph>`);

            fireDeleteSelection(editor.model.document.selection.getFirstRange());

            expect(getModelData(editor.model)).toBe("<paragraph>a[]low</paragraph>");
        });

        it("leaves a browser range that stays clear of a collapsed body alone", () => {
            setModelData(editor.model, `${CLOSED}<paragraph>abc[]</paragraph>`);

            fireDeleteSelection(modelRange([1, 0], [1, 2]));

            expect(getModelData(editor.model)).toBe(`${CLOSED}<paragraph>[]c</paragraph>`);
        });

        it("leaves a browser range confined to one collapsed collapsible alone", () => {
            // Both ends sit inside the same closed block, so nothing is hidden from the
            // range and the browser's reading of it stands. Reachable while find-in-note
            // holds a match's block open without touching its model attribute.
            setModelData(editor.model, `${CLOSED}<paragraph>[]</paragraph>`);

            fireDeleteSelection(modelRange([0, 1, 0], [0, 1, 3]));

            expect(getModelData(editor.model)).toBe(
                "<details><summary>Title[]</summary>" +
                    "<paragraph></paragraph><paragraph>two</paragraph>" +
                "</details><paragraph></paragraph>"
            );
        });

        it("leaves a browser range crossing an open collapsible alone", () => {
            setModelData(editor.model, `${OPEN}<paragraph>[]after</paragraph>`);

            // End of the last body block → start of the line below: what the browser reports
            // when the body is on screen, and what CKEditor should act on unchanged.
            fireDeleteSelection(modelRange([0, 2, 3], [1, 0]));

            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary>Title</summary>" +
                    "<paragraph>one</paragraph><paragraph>two[]after</paragraph>" +
                "</details>"
            );
        });
    });
});
