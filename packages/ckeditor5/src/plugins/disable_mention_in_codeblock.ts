import { Plugin } from "ckeditor5";

/**
 * Disables the mention feature (triggered by `@`) inside code blocks.
 * This prevents the autocomplete popup from appearing when typing `@` within code blocks.
 */
export default class DisableMentionInCodeBlock extends Plugin {
    public static get pluginName() {
        return "DisableMentionInCodeBlock" as const;
    }

    init() {
        const editor = this.editor;
        const schema = editor.model.schema;

        // Disallow mention attribute inside code blocks
        schema.addAttributeCheck((context, attributeName) => {
            if (attributeName === 'mention' && context.endsWith('codeBlock $text')) {
                return false;
            }
        });
    }
}
