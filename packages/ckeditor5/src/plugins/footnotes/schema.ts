import { ModelSchema } from "ckeditor5";

import { ATTRIBUTES, ELEMENTS } from "./constants.js";

/**
 * Declares the custom element types used by the footnotes plugin.
 *
 * See the meanings of each rule at
 * https://ckeditor.com/docs/ckeditor5/latest/api/module_engine_model_schema-SchemaItemDefinition.html
 */
export const defineSchema = (schema: ModelSchema): void => {
    /** Footnote section at the footer of the document. */
    schema.register(ELEMENTS.footnoteSection, {
        isObject: true,
        allowWhere: "$block",
        allowIn: "$root",
        allowChildren: ELEMENTS.footnoteItem,
        allowAttributes: [ATTRIBUTES.footnoteSection]
    });

    /** Individual footnote item within the footnote section. */
    schema.register(ELEMENTS.footnoteItem, {
        isBlock: true,
        isObject: true,
        allowContentOf: "$root",
        allowAttributes: [ATTRIBUTES.footnoteSection, ATTRIBUTES.footnoteId, ATTRIBUTES.footnoteIndex]
    });

    /** Editable footnote item content container. */
    schema.register(ELEMENTS.footnoteContent, {
        allowIn: ELEMENTS.footnoteItem,
        allowContentOf: "$root",
        allowAttributes: [ATTRIBUTES.footnoteSection]
    });

    /** Inline footnote citation, placed within the main text. */
    schema.register(ELEMENTS.footnoteReference, {
        allowWhere: "$text",
        isInline: true,
        isObject: true,
        allowAttributes: [ATTRIBUTES.footnoteReference, ATTRIBUTES.footnoteId, ATTRIBUTES.footnoteIndex]
    });

    /** Return link which takes you from the footnote back to the inline reference. */
    schema.register(ELEMENTS.footnoteBackLink, {
        allowIn: ELEMENTS.footnoteItem,
        isInline: true,
        isSelectable: false,
        allowAttributes: [ATTRIBUTES.footnoteBackLink, ATTRIBUTES.footnoteId]
    });

    // A footnote may not contain the footnote section itself.
    //
    // The original plugin also rejected `listItem` here, but that element no longer exists: since
    // CKEditor 5 v41 the list feature models list entries as ordinary blocks carrying
    // `listItemId`/`listType` attributes, so the check could never fire.
    schema.addChildCheck((context, childDefinition) => {
        if (context.endsWith(ELEMENTS.footnoteContent) && childDefinition.name === ELEMENTS.footnoteSection) {
            return false;
        }
    });
};
