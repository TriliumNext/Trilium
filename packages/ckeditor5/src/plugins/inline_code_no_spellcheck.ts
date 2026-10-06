import { Plugin } from "ckeditor5";

/**
 * Stops the browser spellchecker underlining inline code, which is identifiers rather than prose.
 *
 * Only the editing view carries `spellcheck`, so the attribute never reaches the note's stored
 * content. Emitting it into the data instead makes a note's HTML depend on whether the editor has
 * opened it: `sanitizeHtml` passes a raw `<code>` through untouched, so the same note round-trips
 * as `<code>` until an edit rewrites every one of them.
 */
export default class InlineCodeNoSpellcheck extends Plugin {

    init() {
        this.editor.conversion.for("editingDowncast").attributeToElement({
            model: "code",
            view: (modelAttributeValue, conversionApi) => {
                const { writer } = conversionApi;
                return writer.createAttributeElement("code", {
                    spellcheck: "false"
                });
            },
            converterPriority: "high"
        });
    }

}
