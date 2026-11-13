import { Command, type Editor, type ModelElement } from "ckeditor5";

import { DEFAULT_POSITION, ELEMENTS } from "./constants.js";

/**
 * Inserts an aside at the right of the text. It replaces an empty block, else it goes before the
 * block that holds the caret, so that the block wraps around it. Selected content moves into the
 * aside, which takes its place. The caret goes to the end of the aside.
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
            const aside = writer.createElement(ELEMENTS.aside, { position: DEFAULT_POSITION });
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

/** The selected aside, or the one that holds the selection, or `null`. */
export function getSelectedAside(editor: Editor): ModelElement | null {
    const selection = editor.model.document.selection;
    const selected = selection.getSelectedElement();
    if (selected?.is("element", ELEMENTS.aside)) {
        return selected;
    }
    return selection.getFirstPosition()?.findAncestor(ELEMENTS.aside) ?? null;
}
