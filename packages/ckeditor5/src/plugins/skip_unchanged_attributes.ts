import { Plugin } from "ckeditor5";

/**
 * Skips the DOM writes of the editing view that set an attribute to the value it already has.
 *
 * `Renderer` writes every attribute of an element again when one of them changes, such as the
 * `ck-focused` class of the root on each focus change. Chromium restyles the whole subtree on a
 * write to `lang` or `dir`, even when the value is the same.
 */
export default class SkipUnchangedAttributes extends Plugin {

    static get pluginName() {
        return "SkipUnchangedAttributes" as const;
    }

    init() {
        const domConverter = this.editor.editing.view.domConverter;
        const setDomElementAttribute = domConverter.setDomElementAttribute.bind(domConverter);

        domConverter.setDomElementAttribute = (domElement, key, value, relatedViewElement) => {
            // `setDomElementAttribute()` renames an unsafe attribute, so that write still happens.
            const tagName = domElement.tagName.toLowerCase();
            if (domElement.getAttribute(key) === value
                && domConverter.shouldRenderAttribute(key, value, tagName)) {
                return;
            }
            setDomElementAttribute(domElement, key, value, relatedViewElement);
        };
    }

}
