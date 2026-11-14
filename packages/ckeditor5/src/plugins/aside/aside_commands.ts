import { type Batch, Command, type Editor, type ModelElement, type ModelWriter } from "ckeditor5";

import { COLOR_ATTRIBUTE, DEFAULT_COLOR, DEFAULT_POSITION, ELEMENTS } from "./constants.js";

/**
 * Inserts an aside at the right of the text, in the default color. It replaces an empty block,
 * else it goes before the block that holds the caret, so that the block wraps around it. Selected
 * content moves into the aside, which takes its place. The caret goes to the end of the aside.
 */
export class InsertAsideCommand extends Command {

    override refresh() {
        const model = this.editor.model;
        const position = model.document.selection.getFirstPosition();
        this.isEnabled = !!position && !getSelectedAside(this.editor)
            && !!model.schema.findAllowedParent(position, ELEMENTS.aside);
    }

    override execute() {
        const model = this.editor.model;
        const selection = model.document.selection;

        model.change((writer) => {
            const selected = selection.isCollapsed ? null : model.getSelectedContent(selection);
            const aside = writer.createElement(ELEMENTS.aside, {
                position: DEFAULT_POSITION,
                [COLOR_ATTRIBUTE]: DEFAULT_COLOR
            });
            const content = writer.createElement(ELEMENTS.content);
            writer.appendElement("paragraph", content);
            writer.append(content, aside);

            const caret = selection.getFirstPosition();
            if (selected || !caret) {
                model.insertObject(aside);
            } else {
                // At the start of a block, `insertObject()` goes before it, or replaces it when
                // it is empty.
                model.insertObject(aside, writer.createPositionAt(caret.parent, 0));
            }
            if (selected) {
                model.insertContent(selected, writer.createRangeIn(content));
            }
            writer.setSelection(content, "end");
        });
    }
}

/**
 * Replaces the selected aside, or the one that holds the selection, with its blocks.
 */
export class RemoveAsideCommand extends Command {

    override refresh() {
        this.isEnabled = !!getSelectedAside(this.editor);
    }

    override execute() {
        const aside = getSelectedAside(this.editor);
        /* v8 ignore next 3 -- execute() runs only while refresh() keeps the command enabled */
        if (!aside) {
            return;
        }

        this.editor.model.change((writer) => {
            for (const content of aside.getChildren()) {
                writer.move(writer.createRangeIn(content as ModelElement),
                    writer.createPositionBefore(aside));
            }
            writer.remove(aside);
        });
    }
}

/**
 * Sets the background color of the selected aside, or of the aside around the selection. An empty
 * value removes it. `batch` groups the changes of the color picker into one undo step, as for the
 * font color commands.
 */
export class AsideColorCommand extends Command {

    declare value: string | undefined;

    override refresh() {
        const aside = getSelectedAside(this.editor);
        this.isEnabled = !!aside;
        this.value = aside?.getAttribute(COLOR_ATTRIBUTE) as string | undefined;
    }

    override execute({ value, batch }: { value?: string | null; batch?: Batch } = {}) {
        const model = this.editor.model;
        const aside = getSelectedAside(this.editor);
        /* v8 ignore next 3 -- execute() runs only while refresh() keeps the command enabled */
        if (!aside) {
            return;
        }

        const setColor = (writer: ModelWriter) => {
            if (value) {
                writer.setAttribute(COLOR_ATTRIBUTE, value, aside);
            } else {
                writer.removeAttribute(COLOR_ATTRIBUTE, aside);
            }
        };
        if (batch) {
            model.enqueueChange(batch, setColor);
        } else {
            model.change(setColor);
        }
    }

}

/** The selected aside, or the one that holds the selection, or `null`. */
export function getSelectedAside(editor: Editor): ModelElement | null {
    const selection = editor.model.document.selection;
    const selected = selection.getSelectedElement();
    if (selected?.is("element", ELEMENTS.aside)) {
        return selected;
    }
    return selection.getFirstPosition()?.findAncestor(ELEMENTS.aside) ?? null;
}
