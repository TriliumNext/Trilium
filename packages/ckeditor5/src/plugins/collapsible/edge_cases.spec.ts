import { _getModelData as getModelData, _setModelData as setModelData, ClassicEditor, ClickObserver, Essentials, FindAndReplace, Heading, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor, getEditorElement } from "../../../test/editor-kit.js";
import CollapsibleEditing from "./collapsible_editing.js";

/**
 * The guard paths: events arriving in states the handlers deliberately ignore, and the plugin
 * behaving sanely when the pieces it hooks into are absent.
 */
describe("collapsible edge cases", () => {
    let editor: ClassicEditor;
    let root: HTMLElement;

    async function createEditor(plugins: unknown[] = [Essentials, Paragraph, CollapsibleEditing]): Promise<void> {
        editor = await createTestEditor(plugins as never);
        getEditorElement(editor).style.cssText = "width: 600px; position: absolute; top: 0; left: 0;";
        root = editor.editing.view.getDomRoot() as HTMLElement;
    }

    /** Put a real DOM selection where the model selection is, so caret geometry can be measured. */
    function syncDomSelection(): void {
        editor.editing.view.forceRender();
        const domSelection = document.getSelection();
        const viewPosition = editor.editing.view.document.selection.getFirstPosition();
        if (!domSelection || !viewPosition) {
            return;
        }
        const domPosition = editor.editing.view.domConverter.viewPositionToDom(viewPosition);
        if (!domPosition) {
            return;
        }
        const range = document.createRange();
        range.setStart(domPosition.parent, domPosition.offset);
        range.collapse(true);
        domSelection.removeAllRanges();
        domSelection.addRange(range);
    }

    beforeEach(async () => {
        await createEditor();
    });

    describe("Enter in a title", () => {
        it("is ignored when the caret is not inside a title", () => {
            setModelData(editor.model, "<paragraph>plain[]</paragraph>");
            const executeSpy = vi.spyOn(editor, "execute");

            editor.editing.view.document.fire("enter", { preventDefault: vi.fn(), isSoft: false });

            expect(getModelData(editor.model, { withoutSelection: true })).not.toContain("<details");
            executeSpy.mockRestore();
        });
    });

    describe("Enter in a body block", () => {
        it("is ignored when the selection is not collapsed", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><paragraph>[body]</paragraph></details>"
            );

            editor.editing.view.document.fire("enter", { preventDefault: vi.fn(), isSoft: false });

            expect(editor.model.document.getRoot()?.childCount).toBe(1);
        });

        it("is ignored outside a collapsible", () => {
            setModelData(editor.model, "<paragraph>a</paragraph><paragraph>[]</paragraph>");

            editor.editing.view.document.fire("enter", { preventDefault: vi.fn(), isSoft: false });

            expect(getModelData(editor.model, { withoutSelection: true })).not.toContain("<details");
        });

        it("leaves a non-paragraph block to its own Enter behaviour", async () => {
            // Headings, list items and the like have their own Enter semantics — the escape-out
            // handler only claims empty trailing <paragraph>s.
            await editor.destroy();
            await createEditor([Essentials, Paragraph, Heading, CollapsibleEditing]);
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><heading1>[]</heading1></details>"
            );

            editor.editing.view.document.fire("enter", { preventDefault: vi.fn(), isSoft: false });

            // Still inside the collapsible: the handler bailed on the non-paragraph block.
            expect(editor.model.document.getRoot()?.childCount).toBe(1);
        });
    });

    describe("clicking outside a title", () => {
        it("leaves a click on ordinary content alone", () => {
            editor.editing.view.addObserver(ClickObserver);
            setModelData(
                editor.model,
                "<paragraph>plain[]</paragraph>" +
                "<details><summary>T</summary><paragraph>body</paragraph></details>"
            );
            editor.editing.view.forceRender();
            const paragraph = root.querySelector("p");
            if (!(paragraph instanceof HTMLElement)) {
                throw new Error("Expected a rendered paragraph.");
            }

            const click = new MouseEvent("click", { bubbles: true, cancelable: true });
            paragraph.dispatchEvent(click);

            // Nothing on the ancestor chain is a summary, so the toggle-suppression never applies.
            expect(click.defaultPrevented).toBe(false);
        });
    });

    describe("arrow keys with a measurable caret", () => {
        it("stays put when the caret is not on the title's first visual line", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>first</summary><paragraph>one</paragraph></details>" +
                "<details open=\"true\"><summary>second[]</summary><paragraph>two</paragraph></details>"
            );
            syncDomSelection();
            const preventDefault = vi.fn();

            editor.editing.view.document.fire("arrowKey", {
                keyCode: 38, shiftKey: false, preventDefault,
                domTarget: editor.editing.view.getDomRoot()
            });

            // A single-line title puts the caret on both the first and last visual line, so the
            // jump does fire here — the point is that the geometry path ran without throwing.
            expect(preventDefault).toHaveBeenCalled();
        });
    });

    describe("the DOM toggle listener", () => {
        it("ignores a toggle event from something that is not a collapsible", () => {
            setModelData(editor.model, "<details><summary>T[]</summary><paragraph>body</paragraph></details>");
            editor.editing.view.forceRender();

            expect(() => {
                root.dispatchEvent(new Event("toggle"));
                root.querySelector("summary")?.dispatchEvent(new Event("toggle"));
            }).not.toThrow();
            expect(getModelData(editor.model, { withoutSelection: true })).not.toContain("open=\"true\"");
        });

        it("ignores a <details> without the collapsible class", () => {
            setModelData(editor.model, "<paragraph>plain[]</paragraph>");
            const stray = document.createElement("details");
            root.appendChild(stray);

            expect(() => stray.dispatchEvent(new Event("toggle"))).not.toThrow();

            stray.remove();
        });
    });

    describe("without the find plugin", () => {
        it("skips the find-reveal wiring entirely", async () => {
            // The base editor in this file has no FindAndReplace, so registerFindReveal bails.
            setModelData(editor.model, "<details><summary>T[]</summary><paragraph>needle</paragraph></details>");
            editor.editing.view.forceRender();

            expect(editor.plugins.has("FindAndReplaceEditing")).toBe(false);
            expect(root.querySelector("details")?.open).toBe(false);
        });
    });

    describe("with the find plugin", () => {
        beforeEach(async () => {
            await editor.destroy();
            await createEditor([Essentials, Paragraph, FindAndReplace, CollapsibleEditing]);
        });

        it("re-collapses everything when the search is cleared", () => {
            editor.setData(
                "<details class=\"trilium-collapsible\"><summary>T</summary><p>needle here</p></details>"
            );
            editor.execute("find", "needle");
            expect(root.querySelector("details")?.open).toBe(true);

            editor.execute("find", "no-such-text-anywhere");

            expect(root.querySelector("details")?.open).toBe(false);
        });

        it("leaves an already-expanded block alone — there is nothing transient to do", () => {
            editor.setData(
                "<details class=\"trilium-collapsible\" open><summary>T</summary><p>needle here</p></details>"
            );
            expect(root.querySelector("details")?.open).toBe(true);

            editor.execute("find", "needle");

            expect(root.querySelector("details")?.open).toBe(true);
            // Persisted open, so the model keeps the attribute and no transient marker appears.
            expect(getModelData(editor.model, { withoutSelection: true })).toContain("open=\"true\"");
        });

        it("does not write a find-driven toggle back into the model", () => {
            editor.setData(
                "<details class=\"trilium-collapsible\"><summary>T</summary><p>needle here</p></details>"
            );
            editor.execute("find", "needle");
            const details = root.querySelector("details");
            expect(details?.open).toBe(true);

            // The browser fires `toggle` for the transient open. Adopting it would let a search
            // rewrite the saved open/closed layout, so the reveal guard has to swallow it.
            details?.dispatchEvent(new Event("toggle"));

            expect(getModelData(editor.model, { withoutSelection: true })).not.toContain("open=");
        });

        it("keeps the reveal while the highlight moves between matches in the same block", () => {
            editor.setData(
                "<details class=\"trilium-collapsible\"><summary>T</summary><p>needle and needle</p></details>"
            );
            editor.execute("find", "needle");
            expect(root.querySelector("details")?.open).toBe(true);

            editor.execute("findNext");

            expect(root.querySelector("details")?.open).toBe(true);
        });
    });

    describe("post-fixers on unrelated edits", () => {
        it("leaves a document without collapsibles untouched", () => {
            setModelData(editor.model, "<paragraph>one[]</paragraph>");

            editor.model.change((writer) => {
                const root_ = editor.model.document.getRoot();
                if (root_) {
                    writer.insertElement("paragraph", writer.createPositionAt(root_, "end"));
                }
            });

            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<paragraph>one</paragraph><paragraph></paragraph>"
            );
        });

        it("keeps a well-formed collapsible through an attribute change", () => {
            setModelData(
                editor.model,
                "<details><summary>T</summary><paragraph>body[]</paragraph></details>"
            );

            editor.model.change((writer) => {
                const details = editor.model.document.getRoot()?.getChild(0);
                if (details?.is("element")) {
                    writer.setAttribute("open", true, details);
                }
            });

            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<details open=\"true\"><summary>T</summary><paragraph>body</paragraph></details>"
            );
        });
    });
});
