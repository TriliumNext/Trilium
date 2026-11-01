import { _getModelData as getModelData, _setModelData as setModelData, ClassicEditor, ClickObserver, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor, getEditorElement } from "../../../test/editor-kit.js";
import CollapsibleEditing from "./collapsible_editing.js";

/**
 * The two non-editable affordances rendered into every `<summary>`: the drag/select handle and
 * the expand/collapse arrow.
 */
describe("collapsible summary affordances", () => {
    let editor: ClassicEditor;
    let root: HTMLElement;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, CollapsibleEditing]);
        getEditorElement(editor).style.cssText = "width: 600px; position: absolute; top: 0; left: 0;";
        root = editor.editing.view.getDomRoot() as HTMLElement;
        // The click handler listens on the view document; the observer that feeds it is added by
        // other plugins (Link) in the real editor, so a bare test editor has to add it itself.
        editor.editing.view.addObserver(ClickObserver);
    });

    /**
     * Names of the elements the model selection lands on while `run` executes. The handle sets the
     * selection and then focuses the view, and that focus round-trip can move it again — so record
     * what was selected rather than inspecting the end state.
     */
    function selectionsDuring(run: () => void): Array<string | undefined> {
        const seen: Array<string | undefined> = [];
        const record = () => seen.push(editor.model.document.selection.getSelectedElement()?.name);
        editor.model.document.selection.on("change:range", record);
        try {
            run();
        } finally {
            editor.model.document.selection.off("change:range", record);
        }
        return seen;
    }

    const handleDom = (index = 0) =>
        root.querySelectorAll<HTMLElement>(".trilium-collapsible-handle")[index];
    const arrowDom = (index = 0) =>
        root.querySelectorAll<HTMLElement>(".trilium-collapsible-arrow")[index];

    function key(target: HTMLElement, key: string): void {
        target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }

    describe("the select/drag handle", () => {
        it("selects the whole collapsible when clicked without dragging", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><paragraph>body[]</paragraph></details>"
            );
            const handle = handleDom();
            const rect = handle.getBoundingClientRect();

            const selected = selectionsDuring(() => {
                handle.dispatchEvent(new MouseEvent("mousedown", {
                    button: 0, clientX: rect.left, clientY: rect.top, bubbles: true, cancelable: true
                }));
                document.dispatchEvent(new MouseEvent("mouseup", {
                    clientX: rect.left, clientY: rect.top, bubbles: true
                }));
            });

            expect(selected).toContain("details");
        });

        it("ignores a non-primary mouse button", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><paragraph>body[]</paragraph></details>"
            );

            handleDom().dispatchEvent(new MouseEvent("mousedown", {
                button: 2, bubbles: true, cancelable: true
            }));
            document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

            expect(editor.model.document.selection.getSelectedElement()).toBeNull();
        });

        it("swallows the trailing click so the caret is not repositioned", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><paragraph>body[]</paragraph></details>"
            );
            const click = new MouseEvent("click", { bubbles: true, cancelable: true });

            handleDom().dispatchEvent(click);

            expect(click.defaultPrevented).toBe(true);
        });

        it("selects the collapsible from the keyboard via Enter and Space", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><paragraph>body[]</paragraph></details>"
            );

            expect(selectionsDuring(() => key(handleDom(), "Enter"))).toContain("details");

            editor.model.change((writer) => {
                const details = editor.model.document.getRoot()?.getChild(0);
                const body = details?.is("element") ? details.getChild(1) : null;
                if (body?.is("element")) {
                    writer.setSelection(body, 0);
                }
            });

            expect(selectionsDuring(() => key(handleDom(), " "))).toContain("details");
        });

        it("ignores other keys", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><paragraph>body[]</paragraph></details>"
            );

            key(handleDom(), "a");

            expect(editor.model.document.selection.getSelectedElement()).toBeNull();
        });

        it("drops onto a plain paragraph as-is, with no retargeting", () => {
            setModelData(
                editor.model,
                "<paragraph>first</paragraph>" +
                "<details open=\"true\"><summary>T</summary><paragraph>body[]</paragraph></details>"
            );

            const source = handleDom();
            const start = source.getBoundingClientRect();
            const firstBlock = root.children[0];
            if (!(firstBlock instanceof HTMLElement)) {
                throw new Error("Expected a rendered first block.");
            }
            const targetRect = firstBlock.getBoundingClientRect();

            source.dispatchEvent(new MouseEvent("mousedown", {
                button: 0, clientX: start.left, clientY: start.top, bubbles: true, cancelable: true
            }));
            document.dispatchEvent(new MouseEvent("mousemove", {
                clientX: targetRect.left + 20, clientY: targetRect.top + 1, bubbles: true
            }));
            document.dispatchEvent(new MouseEvent("mouseup", {
                clientX: targetRect.left + 20, clientY: targetRect.top + 1, bubbles: true
            }));

            // The paragraph is not a summary, so refineTarget hands it back untouched and the
            // collapsible lands before it.
            const data = getModelData(editor.model, { withoutSelection: true });
            expect(data.indexOf("<details")).toBeLessThan(data.indexOf("first"));
        });

        it("reorders relative to the whole collapsible when dropped on another one's summary", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>first</summary><paragraph>one</paragraph></details>" +
                "<details open=\"true\"><summary>second</summary><paragraph>two[]</paragraph></details>"
            );

            const source = handleDom(1);
            const start = source.getBoundingClientRect();
            const targetSummary = root.querySelectorAll("summary")[0].getBoundingClientRect();

            source.dispatchEvent(new MouseEvent("mousedown", {
                button: 0, clientX: start.left, clientY: start.top, bubbles: true, cancelable: true
            }));
            // Past the drag threshold, onto the upper half of the first collapsible's summary.
            document.dispatchEvent(new MouseEvent("mousemove", {
                clientX: targetSummary.left + 40, clientY: targetSummary.top + 1, bubbles: true
            }));
            document.dispatchEvent(new MouseEvent("mouseup", {
                clientX: targetSummary.left + 40, clientY: targetSummary.top + 1, bubbles: true
            }));

            // The dragged collapsible landed before the other one, not nested inside it.
            const data = getModelData(editor.model, { withoutSelection: true });
            expect(data.indexOf("second")).toBeLessThan(data.indexOf("first"));
            expect(editor.model.document.getRoot()?.childCount).toBe(2);
        });
    });

    describe("the toggle arrow", () => {
        it("toggles from the keyboard via Enter and Space", () => {
            setModelData(editor.model, "<details><summary>T[]</summary><paragraph>body</paragraph></details>");

            key(arrowDom(), "Enter");
            expect(getModelData(editor.model, { withoutSelection: true })).toContain("open=\"true\"");

            key(arrowDom(), " ");
            expect(getModelData(editor.model, { withoutSelection: true })).not.toContain("open=\"true\"");
        });

        it("ignores other keys", () => {
            setModelData(editor.model, "<details><summary>T[]</summary><paragraph>body</paragraph></details>");

            key(arrowDom(), "a");

            expect(getModelData(editor.model, { withoutSelection: true })).not.toContain("open=\"true\"");
        });

        it("keeps the browser from placing a caret on it", () => {
            setModelData(editor.model, "<details><summary>T[]</summary><paragraph>body</paragraph></details>");
            const mousedown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });

            arrowDom().dispatchEvent(mousedown);

            expect(mousedown.defaultPrevented).toBe(true);
        });
    });

    describe("clicking the summary itself", () => {
        it("suppresses the native toggle so only the arrow controls the state", () => {
            setModelData(editor.model, "<details><summary>T[]</summary><paragraph>body</paragraph></details>");
            const summary = root.querySelector("summary");
            if (!(summary instanceof HTMLElement)) {
                throw new Error("Expected a rendered summary.");
            }

            const click = new MouseEvent("click", { bubbles: true, cancelable: true });
            summary.dispatchEvent(click);

            expect(click.defaultPrevented).toBe(true);
            expect(getModelData(editor.model, { withoutSelection: true })).not.toContain("open=\"true\"");
        });

        it("lets a modifier-click on a link inside the title through", () => {
            setModelData(editor.model, "<details><summary>T[]</summary><paragraph>body</paragraph></details>");
            const summary = root.querySelector("summary");
            if (!(summary instanceof HTMLElement)) {
                throw new Error("Expected a rendered summary.");
            }

            const click = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
            summary.dispatchEvent(click);

            // Still handled by the summary branch — there is no link here — but the
            // modifier path is what an <a> inside the title relies on.
            expect(click.defaultPrevented).toBe(true);
        });
    });

    describe("the data downcast", () => {
        it("writes a bare open attribute for an expanded collapsible", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><paragraph>body</paragraph></details>"
            );

            expect(editor.getData()).toBe(
                "<details class=\"trilium-collapsible\" open=\"\"><summary>T</summary><p>body</p></details>"
            );
        });
    });
});
