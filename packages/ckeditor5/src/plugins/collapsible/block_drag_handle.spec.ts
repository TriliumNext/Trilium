import { _getModelData as getModelData, _setModelData as setModelData, ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor, getEditorElement } from "../../../test/editor-kit.js";
import BlockDragHandle from "./block_drag_handle.js";
import CollapsibleEditing from "./collapsible_editing.js";

const INDICATOR_CLASS = "test-drop-indicator";

describe("BlockDragHandle", () => {
    let editor: ClassicEditor;
    let handle: BlockDragHandle;
    let root: HTMLElement;

    /** Centre of the DOM element rendering the nth top-level block. */
    function blockCentre(index: number): { x: number; y: number } {
        const rect = topLevelDom(index).getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    function topLevelDom(index: number): HTMLElement {
        const child = root.children[index];
        if (!(child instanceof HTMLElement)) {
            throw new Error(`No top-level block rendered at index ${index}.`);
        }
        return child;
    }

    function modelBlock(index: number) {
        const block = editor.model.document.getRoot()?.getChild(index);
        if (!block?.is("element")) {
            throw new Error(`No model block at index ${index}.`);
        }
        return block;
    }

    function mouse(type: "mousemove" | "mouseup", x: number, y: number): void {
        document.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
    }

    function indicator(): HTMLElement | null {
        return document.querySelector(`.${INDICATOR_CLASS}`);
    }

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, CollapsibleEditing]);
        // The editable needs real layout for elementFromPoint()/getBoundingClientRect().
        getEditorElement(editor).style.cssText = "width: 600px; position: absolute; top: 0; left: 0;";
        root = editor.editing.view.getDomRoot() as HTMLElement;
        handle = new BlockDragHandle({ editor, indicatorClass: INDICATOR_CLASS });
    });

    describe("click vs drag", () => {
        it("treats a mouseup below the movement threshold as a click", () => {
            setModelData(editor.model, "<paragraph>one[]</paragraph><paragraph>two</paragraph>");
            const onClick = vi.fn();
            const clickHandle = new BlockDragHandle({ editor, indicatorClass: INDICATOR_CLASS, onClick });
            const block = modelBlock(0);

            clickHandle.start(100, 100, block, root);
            // Under the 4px threshold — jitter, not a drag.
            mouse("mousemove", 101, 101);
            expect(indicator()).toBeNull();

            mouse("mouseup", 101, 101);

            expect(onClick).toHaveBeenCalledWith(block);
            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<paragraph>one</paragraph><paragraph>two</paragraph>"
            );
        });

        it("does not require an onClick callback to be supplied", () => {
            setModelData(editor.model, "<paragraph>one[]</paragraph>");

            handle.start(100, 100, modelBlock(0), root);
            expect(() => mouse("mouseup", 100, 100)).not.toThrow();
        });

        it("shows the drop indicator once the pointer crosses the threshold", () => {
            setModelData(editor.model, "<paragraph>one[]</paragraph><paragraph>two</paragraph>");
            const target = blockCentre(1);

            handle.start(100, 100, modelBlock(0), root);
            mouse("mousemove", target.x, target.y);

            const bar = indicator();
            expect(bar).not.toBeNull();
            expect(bar?.style.display).toBe("block");
            expect(bar?.style.width).not.toBe("");
        });
    });

    describe("dropping", () => {
        it("moves the block after the target when dropped on its lower half", () => {
            setModelData(editor.model, "<paragraph>one[]</paragraph><paragraph>two</paragraph>");
            const rect = topLevelDom(1).getBoundingClientRect();
            const lowerHalf = { x: rect.left + 5, y: rect.bottom - 2 };

            handle.start(0, 0, modelBlock(0), root);
            mouse("mousemove", lowerHalf.x, lowerHalf.y);
            mouse("mouseup", lowerHalf.x, lowerHalf.y);

            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<paragraph>two</paragraph><paragraph>one</paragraph>"
            );
        });

        it("moves the block before the target when dropped on its upper half", () => {
            setModelData(editor.model, "<paragraph>one</paragraph><paragraph>two[]</paragraph>");
            const rect = topLevelDom(0).getBoundingClientRect();
            const upperHalf = { x: rect.left + 5, y: rect.top + 1 };

            handle.start(0, 0, modelBlock(1), root);
            mouse("mousemove", upperHalf.x, upperHalf.y);
            mouse("mouseup", upperHalf.x, upperHalf.y);

            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<paragraph>two</paragraph><paragraph>one</paragraph>"
            );
        });

        it("ignores a drop onto the dragged block itself", () => {
            setModelData(editor.model, "<paragraph>one[]</paragraph><paragraph>two</paragraph>");
            const self = blockCentre(0);

            handle.start(0, 0, modelBlock(0), root);
            mouse("mousemove", self.x, self.y);
            mouse("mouseup", self.x, self.y);

            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<paragraph>one</paragraph><paragraph>two</paragraph>"
            );
        });

        it("rejects a drop into the dragged block's own subtree", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><paragraph>inside[]</paragraph></details>"
            );
            const inner = root.querySelector("details p");
            if (!(inner instanceof HTMLElement)) {
                throw new Error("Expected a paragraph inside the collapsible.");
            }
            const rect = inner.getBoundingClientRect();

            handle.start(0, 0, modelBlock(0), root);
            mouse("mousemove", rect.left + 5, rect.top + 2);
            mouse("mouseup", rect.left + 5, rect.top + 2);

            // Still a single top-level <details>; nothing was moved into itself.
            expect(editor.model.document.getRoot()?.childCount).toBe(1);
        });

        it("does nothing when the drop lands outside any block", () => {
            setModelData(editor.model, "<paragraph>one[]</paragraph><paragraph>two</paragraph>");

            handle.start(0, 0, modelBlock(0), root);
            mouse("mousemove", 50, 50);
            // Far below the document — elementFromPoint finds nothing mappable.
            mouse("mouseup", -500, -500);

            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<paragraph>one</paragraph><paragraph>two</paragraph>"
            );
        });
    });

    describe("finding a target", () => {
        it("falls back to the nearest top-level block when the pointer is in the margin", () => {
            setModelData(editor.model, "<paragraph>one</paragraph><paragraph>two[]</paragraph>");
            const rect = topLevelDom(0).getBoundingClientRect();
            // To the left of the editable, level with the first block: no element under the
            // cursor, so the nearest-child fallback picks it by vertical distance.
            const margin = { x: rect.left - 40, y: rect.top + 2 };

            handle.start(0, 0, modelBlock(1), root);
            mouse("mousemove", margin.x, margin.y);
            mouse("mouseup", margin.x, margin.y);

            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<paragraph>two</paragraph><paragraph>one</paragraph>"
            );
        });
    });

    describe("target refinement", () => {
        it("keeps the original target when refineTarget returns it unchanged", () => {
            setModelData(editor.model, "<paragraph>one[]</paragraph><paragraph>two</paragraph>");
            const refineTarget = vi.fn((model) => model);
            const refining = new BlockDragHandle({ editor, indicatorClass: INDICATOR_CLASS, refineTarget });
            const rect = topLevelDom(1).getBoundingClientRect();
            const lowerHalf = { x: rect.left + 5, y: rect.bottom - 2 };

            refining.start(0, 0, modelBlock(0), root);
            mouse("mousemove", lowerHalf.x, lowerHalf.y);
            mouse("mouseup", lowerHalf.x, lowerHalf.y);

            expect(refineTarget).toHaveBeenCalled();
            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<paragraph>two</paragraph><paragraph>one</paragraph>"
            );
        });

        it("tolerates a refineTarget that returns something with no rendered DOM", () => {
            setModelData(editor.model, "<paragraph>one[]</paragraph><paragraph>two</paragraph>");
            // A detached element maps to no DOM, so the original element's rect is kept.
            const detached = editor.model.change((writer) => writer.createElement("paragraph"));
            const refining = new BlockDragHandle({
                editor,
                indicatorClass: INDICATOR_CLASS,
                refineTarget: () => detached
            });
            const target = blockCentre(1);

            refining.start(0, 0, modelBlock(0), root);

            expect(() => {
                mouse("mousemove", target.x, target.y);
                mouse("mouseup", target.x, target.y);
            }).not.toThrow();
        });

        it("re-routes the target through refineTarget", () => {
            setModelData(
                editor.model,
                "<paragraph>one[]</paragraph>" +
                "<details open=\"true\"><summary>T</summary><paragraph>body</paragraph></details>"
            );
            // A hit anywhere inside the collapsible retargets to the <details> itself.
            const refineTarget = vi.fn((model) => {
                for (let node = model; node; node = node.parent) {
                    if (node.is?.("element", "details")) {
                        return node;
                    }
                }
                return model;
            });
            const refining = new BlockDragHandle({ editor, indicatorClass: INDICATOR_CLASS, refineTarget });

            const body = root.querySelector("details p");
            if (!(body instanceof HTMLElement)) {
                throw new Error("Expected a paragraph inside the collapsible.");
            }
            const rect = body.getBoundingClientRect();

            refining.start(0, 0, modelBlock(0), root);
            mouse("mousemove", rect.left + 5, rect.top + 2);
            mouse("mouseup", rect.left + 5, rect.bottom + 200);

            expect(refineTarget).toHaveBeenCalled();
        });
    });

    describe("lifecycle", () => {
        it("cancel() removes the indicator and stops tracking", () => {
            setModelData(editor.model, "<paragraph>one[]</paragraph><paragraph>two</paragraph>");
            const target = blockCentre(1);

            handle.start(0, 0, modelBlock(0), root);
            mouse("mousemove", target.x, target.y);
            expect(indicator()).not.toBeNull();

            handle.cancel();

            expect(indicator()).toBeNull();
            // Further events are inert — the model must not change.
            mouse("mouseup", target.x, target.y);
            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<paragraph>one</paragraph><paragraph>two</paragraph>"
            );
        });

        it("cancel() is safe when no drag is in progress", () => {
            expect(() => handle.cancel()).not.toThrow();
        });

        it("starting a new drag cancels the previous one", () => {
            setModelData(editor.model, "<paragraph>one[]</paragraph><paragraph>two</paragraph>");
            const target = blockCentre(1);

            handle.start(0, 0, modelBlock(0), root);
            mouse("mousemove", target.x, target.y);
            expect(document.querySelectorAll(`.${INDICATOR_CLASS}`)).toHaveLength(1);

            handle.start(0, 0, modelBlock(1), root);
            expect(indicator()).toBeNull();

            mouse("mousemove", target.x, target.y);
            expect(document.querySelectorAll(`.${INDICATOR_CLASS}`)).toHaveLength(1);
        });
    });
});
