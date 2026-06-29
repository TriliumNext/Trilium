import { Plugin, toWidget, Widget } from "ckeditor5";

/**
 * Minimal block widget plugin for tests: registers a `testBox` object element (isObject, allowed
 * wherever a block is) that downcasts to `<div class="test-box">` and is wrapped as a widget in
 * the editing view. Used to exercise object-element / widget-selection paths. Extracted from the
 * specs that each defined an identical copy.
 */
export class TestBoxPlugin extends Plugin {
    static get requires() {
        return [Widget];
    }

    init() {
        const { model, conversion } = this.editor;

        model.schema.register("testBox", {
            isObject: true,
            allowWhere: "$block"
        });

        conversion.for("upcast").elementToElement({
            model: "testBox",
            view: { name: "div", classes: "test-box" }
        });

        conversion.for("dataDowncast").elementToElement({
            model: "testBox",
            view: (_el, { writer }) => writer.createContainerElement("div", { class: "test-box" })
        });

        conversion.for("editingDowncast").elementToElement({
            model: "testBox",
            view: (_el, { writer }) => {
                const container = writer.createContainerElement("div", { class: "test-box" });
                return toWidget(container, writer, { label: "test box widget" });
            }
        });
    }
}
