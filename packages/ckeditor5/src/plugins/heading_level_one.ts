import { Plugin } from "ckeditor5";

const HEADING_1 = "heading1";

/**
 * Keeps an `<h1>` of the content as a heading instead of turning it into a paragraph, without
 * offering heading 1 in the UI: the note title is a note's top heading, so `heading1` stays out of
 * `heading.options`, which feed the heading dropdown, the slash commands and the `#` autoformat.
 */
export default class HeadingLevelOne extends Plugin {

    static get pluginName() {
        return "HeadingLevelOne" as const;
    }

    init() {
        const editor = this.editor;
        editor.model.schema.register(HEADING_1, { inheritAllFrom: "$block" });
        editor.conversion.elementToElement({ model: HEADING_1, view: "h1" });
    }

    afterInit() {
        // `HeadingEditing` applies this rule only to the elements of `heading.options`.
        const editor = this.editor;
        const enterCommand = editor.commands.get("enter");
        if (!enterCommand) {
            return;
        }
        this.listenTo(enterCommand, "afterExecute", (evt, data) => {
            const parent = editor.model.document.selection.getFirstPosition()?.parent;
            if (parent?.is("element", HEADING_1) && parent.childCount === 0) {
                data.writer.rename(parent, "paragraph");
            }
        });
    }

}
