import { Plugin } from "ckeditor5";

export default class InlineCodeNoSpellcheck extends Plugin {

    init() {
        this.editor.conversion.for('downcast').attributeToElement({
            model: 'code',
            view: (modelAttributeValue, conversionApi) => {
                const { writer } = conversionApi;
                return writer.createAttributeElement('code', {
                    spellcheck: 'false'
                });
            },
            converterPriority: 'high'
        });
    }

}
