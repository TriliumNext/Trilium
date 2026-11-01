import { type DowncastConversionApi, type Editor, ModelElement, toWidget, toWidgetEditable, type ViewContainerElement } from "ckeditor5";

import { ATTRIBUTES, CLASSES, ELEMENTS } from "./constants.js";
import { viewQueryElement } from "./utils.js";

/**
 * Defines methods for converting between model, data view, and editing view representations of
 * each element type.
 */
export const defineConverters = (editor: Editor): void => {
    const conversion = editor.conversion;
    const t = editor.t;

    /* Attribute conversion */

    conversion.for("downcast").attributeToAttribute({
        model: ATTRIBUTES.footnoteId,
        view: ATTRIBUTES.footnoteId
    });

    conversion.for("downcast").attributeToAttribute({
        model: ATTRIBUTES.footnoteIndex,
        view: ATTRIBUTES.footnoteIndex
    });

    /* Footnote section */

    // (data view -> model)
    conversion.for("upcast").elementToElement({
        view: {
            attributes: {
                [ATTRIBUTES.footnoteSection]: true
            }
        },
        model: ELEMENTS.footnoteSection,
        converterPriority: "high"
    });

    // (model -> data view)
    conversion.for("dataDowncast").elementToElement({
        model: ELEMENTS.footnoteSection,
        view: {
            name: "ol",
            attributes: {
                [ATTRIBUTES.footnoteSection]: "",
                role: "doc-endnotes"
            },
            classes: [CLASSES.footnoteSection, CLASSES.footnotes]
        }
    });

    // (model -> editing view)
    conversion.for("editingDowncast").elementToElement({
        model: ELEMENTS.footnoteSection,
        view: (_, conversionApi) => {
            const viewWriter = conversionApi.writer;

            /**
             * The below is a div rather than an ol because using an ol here caused weird behaviour,
             * including randomly duplicating the footnotes section. This is technically invalid
             * HTML, but it is valid in the data view (that is, the version shown in the post).
             * `role='list'` is added as a next-best option, per ARIA recommendations.
             */
            const section = viewWriter.createContainerElement("div", {
                [ATTRIBUTES.footnoteSection]: "",
                role: "doc-endnotes list",
                class: CLASSES.footnoteSection
            });

            // Announced by screen readers when the widget is selected; lowercase to match the
            // "image widget" / "table widget" labels CKEditor gives its own widgets.
            return toWidget(section, viewWriter, { label: t("footnote widget") });
        }
    });

    /* Footnote content */

    conversion.for("upcast").elementToElement({
        view: {
            attributes: {
                [ATTRIBUTES.footnoteContent]: true
            }
        },
        model: (_, conversionApi) => conversionApi.writer.createElement(ELEMENTS.footnoteContent)
    });

    conversion.for("dataDowncast").elementToElement({
        model: ELEMENTS.footnoteContent,
        view: {
            name: "div",
            attributes: { [ATTRIBUTES.footnoteContent]: "" },
            classes: [CLASSES.footnoteContent]
        }
    });

    conversion.for("editingDowncast").elementToElement({
        model: ELEMENTS.footnoteContent,
        view: (_, conversionApi) => {
            const viewWriter = conversionApi.writer;
            // Note: the more specialised createEditableElement() is used here.
            const section = viewWriter.createEditableElement("div", {
                [ATTRIBUTES.footnoteContent]: "",
                class: CLASSES.footnoteContent
            });

            return toWidgetEditable(section, viewWriter);
        }
    });

    /* Footnote item */

    conversion.for("upcast").elementToElement({
        view: {
            attributes: {
                [ATTRIBUTES.footnoteItem]: true
            }
        },
        model: (viewElement, conversionApi) => {
            const id = viewElement.getAttribute(ATTRIBUTES.footnoteId);
            const index = viewElement.getAttribute(ATTRIBUTES.footnoteIndex);
            if (id === undefined || index === undefined) {
                return null;
            }

            return conversionApi.writer.createElement(ELEMENTS.footnoteItem, {
                [ATTRIBUTES.footnoteIndex]: index,
                [ATTRIBUTES.footnoteId]: id
            });
        },

        /**
         * converterPriority is needed to supersede the built-in upcastListItemStyle which, for
         * unknown reasons, causes a null reference error.
         */
        converterPriority: "high"
    });

    conversion.for("dataDowncast").elementToElement({
        model: ELEMENTS.footnoteItem,
        view: createFootnoteItemViewElement
    });

    conversion.for("editingDowncast").elementToElement({
        model: ELEMENTS.footnoteItem,
        view: createFootnoteItemViewElement
    });

    /* Footnote reference */

    conversion.for("upcast").elementToElement({
        view: {
            attributes: {
                [ATTRIBUTES.footnoteReference]: true
            }
        },
        model: (viewElement, conversionApi) => {
            const index = viewElement.getAttribute(ATTRIBUTES.footnoteIndex);
            const id = viewElement.getAttribute(ATTRIBUTES.footnoteId);
            if (index === undefined || id === undefined) {
                return null;
            }

            return conversionApi.writer.createElement(ELEMENTS.footnoteReference, {
                [ATTRIBUTES.footnoteIndex]: index,
                [ATTRIBUTES.footnoteId]: id
            });
        }
    });

    conversion.for("editingDowncast").elementToElement({
        model: ELEMENTS.footnoteReference,
        view: (modelElement, conversionApi) => {
            const footnoteReferenceViewElement = createFootnoteReferenceViewElement(modelElement, conversionApi);
            return toWidget(footnoteReferenceViewElement, conversionApi.writer);
        }
    });

    conversion.for("dataDowncast").elementToElement({
        model: ELEMENTS.footnoteReference,
        view: createFootnoteReferenceViewElement
    });

    /**
     * Listens for changes to the `data-footnote-index` attribute on `footnoteReference` elements.
     * When that fires, the callback updates the displayed view of the footnote reference in the
     * editor to match the new index.
     */
    conversion.for("editingDowncast").add((dispatcher) => {
        dispatcher.on(
            `attribute:${ATTRIBUTES.footnoteIndex}:${ELEMENTS.footnoteReference}`,
            (_, data, conversionApi) => updateFootnoteReferenceView(data, conversionApi, editor),
            { priority: "high" }
        );
    });

    /* Footnote back link */

    conversion.for("upcast").elementToElement({
        view: {
            attributes: {
                [ATTRIBUTES.footnoteBackLink]: true
            }
        },
        model: (viewElement, conversionApi) => {
            const id = viewElement.getAttribute(ATTRIBUTES.footnoteId);
            if (id === undefined) {
                return null;
            }

            return conversionApi.writer.createElement(ELEMENTS.footnoteBackLink, {
                [ATTRIBUTES.footnoteId]: id
            });
        }
    });

    conversion.for("dataDowncast").elementToElement({
        model: ELEMENTS.footnoteBackLink,
        view: createFootnoteBackLinkViewElement
    });

    conversion.for("editingDowncast").elementToElement({
        model: ELEMENTS.footnoteBackLink,
        view: createFootnoteBackLinkViewElement
    });
};

/**
 * Creates and returns a view element for a footnote backlink, which navigates back to the inline
 * reference in the text. Used for both data and editing downcasts.
 */
function createFootnoteBackLinkViewElement(
    modelElement: ModelElement,
    conversionApi: DowncastConversionApi
): ViewContainerElement {
    const viewWriter = conversionApi.writer;
    const id = `${modelElement.getAttribute(ATTRIBUTES.footnoteId)}`;

    const footnoteBackLinkView = viewWriter.createContainerElement("span", {
        class: CLASSES.footnoteBackLink,
        [ATTRIBUTES.footnoteBackLink]: "",
        [ATTRIBUTES.footnoteId]: id
    });
    const sup = viewWriter.createContainerElement("sup");
    const strong = viewWriter.createContainerElement("strong");
    const anchor = viewWriter.createContainerElement("a", { href: `#fnref${id}` });
    const innerText = viewWriter.createText("^");

    viewWriter.insert(viewWriter.createPositionAt(anchor, 0), innerText);
    viewWriter.insert(viewWriter.createPositionAt(strong, 0), anchor);
    viewWriter.insert(viewWriter.createPositionAt(sup, 0), strong);
    viewWriter.insert(viewWriter.createPositionAt(footnoteBackLinkView, 0), sup);

    return footnoteBackLinkView;
}

/**
 * Creates and returns a view element for an inline footnote reference. Used for both data downcast
 * and editing downcast conversions.
 */
function createFootnoteReferenceViewElement(
    modelElement: ModelElement,
    conversionApi: DowncastConversionApi
): ViewContainerElement {
    const viewWriter = conversionApi.writer;
    const index = `${modelElement.getAttribute(ATTRIBUTES.footnoteIndex)}`;
    const id = `${modelElement.getAttribute(ATTRIBUTES.footnoteId)}`;
    if (index === "undefined") {
        throw new Error("Footnote reference has no provided index.");
    }
    if (id === "undefined") {
        throw new Error("Footnote reference has no provided id.");
    }

    const footnoteReferenceView = viewWriter.createContainerElement("span", {
        class: CLASSES.footnoteReference,
        [ATTRIBUTES.footnoteReference]: "",
        [ATTRIBUTES.footnoteIndex]: index,
        [ATTRIBUTES.footnoteId]: id,
        role: "doc-noteref",
        id: `fnref${id}`
    });

    const innerText = viewWriter.createText(`[${index}]`);
    const link = viewWriter.createContainerElement("a", { href: `#fn${id}` });
    const superscript = viewWriter.createContainerElement("sup");
    viewWriter.insert(viewWriter.createPositionAt(link, 0), innerText);
    viewWriter.insert(viewWriter.createPositionAt(superscript, 0), link);
    viewWriter.insert(viewWriter.createPositionAt(footnoteReferenceView, 0), superscript);

    return footnoteReferenceView;
}

/**
 * Creates and returns a view element for a footnote item in the footnote section. Used for both
 * data downcast and editing downcast conversions.
 */
function createFootnoteItemViewElement(
    modelElement: ModelElement,
    conversionApi: DowncastConversionApi
): ViewContainerElement {
    const index = modelElement.getAttribute(ATTRIBUTES.footnoteIndex);
    const id = modelElement.getAttribute(ATTRIBUTES.footnoteId);
    if (!index) {
        throw new Error("Footnote item has no provided index.");
    }
    if (!id) {
        throw new Error("Footnote item has no provided id.");
    }

    return conversionApi.writer.createContainerElement("li", {
        class: CLASSES.footnoteItem,
        [ATTRIBUTES.footnoteItem]: "",
        [ATTRIBUTES.footnoteIndex]: `${index}`,
        [ATTRIBUTES.footnoteId]: `${id}`,
        role: "doc-endnote",
        id: `fn${id}`
    });
}

/**
 * Triggers when the index attribute of a footnote changes, and updates the editor display of
 * footnote references accordingly.
 */
function updateFootnoteReferenceView(
    data: {
        item: ModelElement;
        attributeOldValue: string;
        attributeNewValue: string;
    },
    conversionApi: DowncastConversionApi,
    editor: Editor
) {
    const { item, attributeNewValue: newIndex } = data;
    /* v8 ignore next 6 -- defensive: the dispatcher only fires this for footnoteReference
       elements, and the high-priority listener always consumes first */
    if (
        !(item instanceof ModelElement) ||
        !conversionApi.consumable.consume(item, `attribute:${ATTRIBUTES.footnoteIndex}:${ELEMENTS.footnoteReference}`)
    ) {
        return;
    }

    const footnoteReferenceView = conversionApi.mapper.toViewElement(item);

    /* v8 ignore next 3 -- defensive: a downcast reference is always mapped to its view element */
    if (!footnoteReferenceView) {
        return;
    }

    const viewWriter = conversionApi.writer;

    const anchor = viewQueryElement(editor, footnoteReferenceView, (element) => element.name === "a");
    const textNode = anchor?.getChild(0);

    /* v8 ignore next 4 -- defensive: createFootnoteReferenceViewElement always builds the anchor
       and its text, so a mapped reference view always has both */
    if (!textNode || !anchor) {
        viewWriter.remove(footnoteReferenceView);
        return;
    }

    viewWriter.remove(textNode);
    const innerText = viewWriter.createText(`[${newIndex}]`);
    viewWriter.insert(viewWriter.createPositionAt(anchor, 0), innerText);

    viewWriter.setAttribute("href", `#fn${item.getAttribute(ATTRIBUTES.footnoteId)}`, anchor);
    viewWriter.setAttribute(ATTRIBUTES.footnoteIndex, newIndex, footnoteReferenceView);
}
