import { Plugin } from "ckeditor5";

/**
 * Removes the attributes that the schema does not allow from an element inserted or renamed in a
 * change. `HeadingCommand` and `ParagraphCommand` rename a code block and keep its `language`.
 */
export default class DropDisallowedAttributes extends Plugin {

    static get pluginName() {
        return "DropDisallowedAttributes" as const;
    }

    init() {
        const model = this.editor.model;
        model.document.registerPostFixer((writer) => {
            let isChanged = false;
            for (const change of model.document.differ.getChanges()) {
                const element = change.type === "insert" ? change.position.nodeAfter : null;
                if (!element?.is("element")) {
                    continue;
                }
                for (const key of [ ...element.getAttributeKeys() ]) {
                    if (!model.schema.checkAttribute(element, key)) {
                        void key;
                        isChanged = true;
                    }
                }
            }
            return isChanged;
        });
    }
}
