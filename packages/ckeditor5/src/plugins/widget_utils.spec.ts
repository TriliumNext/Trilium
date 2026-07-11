import {
    ClassicEditor,
    Essentials,
    Paragraph,
    _setModelData as setModelData,
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { TestBoxPlugin } from "../../test/fixture-plugins.js";
import { preventCKEditorHandling } from "./widget_utils.js";

describe("preventCKEditorHandling", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, TestBoxPlugin]);
    });

    it("attaches event listeners without throwing", () => {
        const inner = document.createElement("span");
        document.body.appendChild(inner);
        expect(() => preventCKEditorHandling(inner, editor)).not.toThrow();
        inner.remove();
    });

    it("mousedown: sets isFocused to false on renderer and stops bubbling propagation", () => {
        const inner = document.createElement("span");
        const outer = document.createElement("div");
        outer.appendChild(inner);
        document.body.appendChild(outer);

        preventCKEditorHandling(inner, editor);

        // Force isFocused to true so we can verify it gets set to false.
        // @ts-expect-error: accessing private field for test assertion
        editor.editing.view._renderer.isFocused = true;

        // Bubble-phase spy on the outer: stopPropagation in capture halts bubbling so spy stays silent.
        const bubbleSpy = vi.fn();
        outer.addEventListener("mousedown", bubbleSpy);

        inner.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

        // @ts-expect-error: accessing private field for test assertion
        expect(editor.editing.view._renderer.isFocused).toBe(false);
        expect(bubbleSpy).not.toHaveBeenCalled();

        outer.removeEventListener("mousedown", bubbleSpy);
        outer.remove();
    });

    it("focus: sets isFocused to false on renderer", () => {
        const inner = document.createElement("input");
        const outer = document.createElement("div");
        outer.appendChild(inner);
        document.body.appendChild(outer);

        preventCKEditorHandling(inner, editor);

        // @ts-expect-error: accessing private field for test assertion
        editor.editing.view._renderer.isFocused = true;

        inner.dispatchEvent(new Event("focus", { bubbles: true, cancelable: true }));

        // @ts-expect-error: accessing private field for test assertion
        expect(editor.editing.view._renderer.isFocused).toBe(false);

        outer.remove();
    });

    it("keydown: sets isFocused to false on renderer", () => {
        const inner = document.createElement("input");
        const outer = document.createElement("div");
        outer.appendChild(inner);
        document.body.appendChild(outer);

        preventCKEditorHandling(inner, editor);

        // @ts-expect-error: accessing private field for test assertion
        editor.editing.view._renderer.isFocused = true;

        inner.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true }));

        // @ts-expect-error: accessing private field for test assertion
        expect(editor.editing.view._renderer.isFocused).toBe(false);

        outer.remove();
    });

    it("mousedown: selectParentWidget — no parent element (detached node)", () => {
        // When the element has no parentElement, selectParentWidget returns early.
        const detached = document.createElement("span");
        // Do NOT attach to the DOM so parentElement is null.
        preventCKEditorHandling(detached, editor);

        expect(() => {
            detached.dispatchEvent(new MouseEvent("mousedown", { bubbles: false, cancelable: true }));
        }).not.toThrow();
    });

    it("mousedown: selectParentWidget — parent exists but element is not in editor DOM (no view mapping)", () => {
        // Element has a parent but is NOT part of CKEditor's DOM tree.
        // domConverter.mapDomToView returns undefined → early return on line 43.
        const parent = document.createElement("div");
        const inner = document.createElement("span");
        parent.appendChild(inner);
        document.body.appendChild(parent);

        preventCKEditorHandling(inner, editor);

        expect(() => {
            inner.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        }).not.toThrow();

        parent.remove();
    });

    it("mousedown: selectParentWidget — widget wrapper ancestor found but still not a view element", () => {
        // Parent has a [data-cke-widget-wrapper] ancestor but it's outside the editor view.
        // closest() branch is exercised; mapDomToView still returns nothing.
        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-cke-widget-wrapper", "true");
        const parent = document.createElement("div");
        const inner = document.createElement("span");
        parent.appendChild(inner);
        wrapper.appendChild(parent);
        document.body.appendChild(wrapper);

        preventCKEditorHandling(inner, editor);

        expect(() => {
            inner.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        }).not.toThrow();

        wrapper.remove();
    });

    it("mousedown: selectParentWidget — closest() returns an SVGElement (not HTMLElement), early return", () => {
        // The guard `if (!(widgetDom instanceof HTMLElement)) return` is hit when
        // closest("[data-cke-widget-wrapper]") returns an SVG element.
        const svgWrapper = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svgWrapper.setAttribute("data-cke-widget-wrapper", "true");
        const parent = document.createElement("div");
        // Use an SVG child as the inner element so its parentElement is an HTMLElement
        // but the closest "[data-cke-widget-wrapper]" match is the SVGElement.
        const inner = document.createElementNS("http://www.w3.org/2000/svg", "g") as unknown as HTMLElement;
        parent.appendChild(inner);
        svgWrapper.appendChild(parent);
        document.body.appendChild(svgWrapper);

        preventCKEditorHandling(inner, editor);

        expect(() => {
            inner.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        }).not.toThrow();

        svgWrapper.remove();
    });

    it("mousedown: selectParentWidget — real widget in editor selects it (full success path)", () => {
        // Insert a testBox widget and trigger mousedown on an inner child element.
        // This exercises lines 45-51: modelElement is found → focus + setSelection.
        setModelData(editor.model, "<testBox></testBox>");

        // toWidget() adds the "ck-widget" class to the DOM element. Use that to find it.
        const domRoot = editor.editing.view.getDomRoot();
        const widgetDom = domRoot?.querySelector(".ck-widget");
        expect(widgetDom).toBeTruthy();
        if (!widgetDom || !(widgetDom instanceof HTMLElement)) {
            return;
        }

        // Create an inner child to simulate the UI element that calls preventCKEditorHandling.
        const inner = document.createElement("span");
        widgetDom.appendChild(inner);

        preventCKEditorHandling(inner, editor);

        expect(() => {
            inner.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        }).not.toThrow();

        // Verify the widget was selected.
        const selection = editor.model.document.selection;
        const selected = selection.getSelectedElement();
        expect(selected?.name).toBe("testBox");
    });

    it("mousedown: selectParentWidget — view element maps to nothing in model (mapper returns undefined)", () => {
        // Insert a widget but then spy on toModelElement to return undefined,
        // exercising the `if (!modelElement) return` branch (line 46).
        setModelData(editor.model, "<testBox></testBox>");

        const domRoot = editor.editing.view.getDomRoot();
        const widgetDom = domRoot?.querySelector(".ck-widget");
        if (!widgetDom || !(widgetDom instanceof HTMLElement)) {
            return;
        }

        const inner = document.createElement("span");
        widgetDom.appendChild(inner);

        // Patch mapper to return undefined so we exercise the null check on line 46.
        vi.spyOn(editor.editing.mapper, "toModelElement").mockReturnValueOnce(undefined);

        preventCKEditorHandling(inner, editor);

        expect(() => {
            inner.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        }).not.toThrow();

        vi.restoreAllMocks();
    });
});
