import { ClassicEditor, Essentials, Paragraph, _getModelData as getModelData } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CollapsibleEditing from "../src/collapsible-editing.js";

describe("CollapsibleEditing conversion", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;

    beforeEach(async () => {
        domElement = document.createElement("div");
        document.body.appendChild(domElement);
        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [Essentials, Paragraph, CollapsibleEditing]
        });
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    describe("upcast", () => {
        it("maps <details>/<summary>/<p> to the model details/summary/paragraph", () => {
            editor.setData("<details><summary>Title</summary><p>Body</p></details>");
            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<details><summary>Title</summary><paragraph>Body</paragraph></details>"
            );
        });

        it("preserves multiple body blocks", () => {
            editor.setData(
                "<details><summary>Title</summary><p>First</p><p>Second</p></details>"
            );
            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<details><summary>Title</summary>" +
                    "<paragraph>First</paragraph><paragraph>Second</paragraph>" +
                "</details>"
            );
        });

        it("preserves nested collapsibles", () => {
            editor.setData(
                "<details><summary>Outer</summary>" +
                    "<details><summary>Inner</summary><p>Nested</p></details>" +
                "</details>"
            );
            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<details><summary>Outer</summary>" +
                    "<details><summary>Inner</summary><paragraph>Nested</paragraph></details>" +
                "</details>"
            );
        });
    });

    describe("editing downcast", () => {
        it("wraps the body blocks in a content container, <summary> stays a direct child", () => {
            editor.setData("<details><summary>Title</summary><p>First</p><p>Second</p></details>");
            const root = editor.editing.view.getDomRoot();
            const details = root?.querySelector("details.trilium-collapsible");
            expect(details).toBeTruthy();
            // <summary> must stay a direct child so native collapse keeps it visible.
            expect(details?.querySelector(":scope > summary")).toBeTruthy();
            // Body blocks live inside the wrapper — not as direct children of <details>,
            // which is what Chromium's drag-selection cannot span.
            const content = details?.querySelector(":scope > .trilium-collapsible-content");
            expect(content).toBeTruthy();
            expect(details?.querySelectorAll(":scope > p").length).toBe(0);
            expect(content?.querySelectorAll(":scope > p").length).toBe(2);
        });

        it("preserves the open state across the reconversion a body-block change triggers", () => {
            editor.setData("<details><summary>Title</summary><p>First</p></details>");
            const root = editor.editing.view.getDomRoot();
            const selector = "details.trilium-collapsible";
            const detailsBefore = root?.querySelector<HTMLDetailsElement>(selector);
            // Simulate a toggle the plugin didn't originate (the browser expanding a
            // block to reveal a find-in-page match): flip `open` and fire the native
            // `toggle` event, which the plugin adopts into the model.
            if (detailsBefore) {
                detailsBefore.open = true;
                detailsBefore.dispatchEvent(new Event("toggle"));
            }

            // Add a second body paragraph — this changes the <details> children and
            // makes elementToStructure rebuild its DOM (fresh, hence closed).
            editor.model.change((writer) => {
                const details = editor.model.document.getRoot()?.getChild(0);
                if (details?.is("element", "details")) {
                    writer.insertElement("paragraph", details, "end");
                }
            });

            const detailsAfter = root?.querySelector<HTMLDetailsElement>(selector);
            expect(detailsAfter?.open).toBe(true);
        });
    });

    describe("data downcast", () => {
        it("emits the trilium-collapsible class on the rendered <details>", () => {
            editor.setData("<details><summary>Title</summary><p>Body</p></details>");
            expect(editor.getData()).toBe(
                "<details class=\"trilium-collapsible\">" +
                    "<summary>Title</summary><p>Body</p>" +
                "</details>"
            );
        });

        it("roundtrips lossless when the source already has the class", () => {
            const html = "<details class=\"trilium-collapsible\">" +
                "<summary>Title</summary><p>Body</p>" +
                "</details>";
            editor.setData(html);
            expect(editor.getData()).toBe(html);
        });
    });
});
