import { Plugin, toWidget, Widget } from "ckeditor5";

/**
 * Minimal inline widget plugin for tests: registers a `testChip` inline object with a `label`,
 * drawn in the editing view as `<span class="test-chip">` around a UI element that holds the
 * label, the way a link preview is drawn, so a long label wraps over several lines.
 */
export class TestChipPlugin extends Plugin {
    static get requires() {
        return [Widget];
    }

    init() {
        const { model, conversion } = this.editor;

        model.schema.register("testChip", {
            inheritAllFrom: "$inlineObject",
            allowAttributes: ["label"]
        });

        conversion.for("upcast").elementToElement({
            model: (viewElement, { writer }) =>
                writer.createElement("testChip", { label: viewElement.getAttribute("data-label") }),
            view: { name: "span", classes: "test-chip" }
        });

        conversion.for("dataDowncast").elementToElement({
            model: "testChip",
            view: (element, { writer }) => writer.createContainerElement("span", {
                class: "test-chip",
                "data-label": element.getAttribute("label") as string
            })
        });

        conversion.for("editingDowncast").elementToElement({
            model: "testChip",
            view: (element, { writer }) => {
                const chip = writer.createContainerElement("span", { class: "test-chip" });
                const label = writer.createUIElement("span", {
                    class: "test-chip-label",
                    "data-cke-ignore-events": "true"
                }, function (domDocument) {
                    const domElement = this.toDomElement(domDocument);
                    domElement.textContent = element.getAttribute("label") as string;
                    return domElement;
                });
                writer.insert(writer.createPositionAt(chip, 0), label);
                return toWidget(chip, writer, { label: "test chip widget" });
            }
        });
    }
}

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
