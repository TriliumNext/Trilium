import { Plugin, TodoList, type ModelElement, type ModelWriter } from "ckeditor5";

const TODO_LIST_CHECKED_ATTRIBUTE = "todoListChecked";

/**
 * Makes a new to-do item created with <kbd>Enter</kbd> start unchecked.
 *
 * Pressing Enter splits the current block, and CKEditor's `writer.split()` copies every block
 * attribute — including `todoListChecked` — onto the new row, so a new task inherits the checked
 * state of the row above it (TriliumNext/Trilium#10084). This is stock CKEditor behavior, reported
 * upstream as ckeditor/ckeditor5#5620 (a confirmed `type:bug`, but closed unfixed as stale in
 * 2023), and is unrelated to custom task states — hence a standalone plugin alongside `TodoList`.
 * The custom-state counterpart (clearing `taskState`) lives in `TodoListMultistateEditing` and
 * reuses the {@link onTodoRowSplit} seam below.
 */
export default class TodoListUncheckOnEnter extends Plugin {

    static get requires() {
        return [TodoList] as const;
    }

    init() {
        onTodoRowSplit(this, (writer, block) => {
            writer.removeAttribute(TODO_LIST_CHECKED_ATTRIBUTE, block);
        });
    }

}

/**
 * Runs `callback` for the to-do row freshly created by an <kbd>Enter</kbd> split, so callers can
 * reset state the split copied over from the previous row. No-op when the Enter feature is absent.
 */
export function onTodoRowSplit(plugin: Plugin, callback: (writer: ModelWriter, block: ModelElement) => void): void {
    const editor = plugin.editor;
    const enterCommand = editor.commands.get("enter");
    if (!enterCommand) {
        return;
    }

    plugin.listenTo(enterCommand, "afterExecute", (_evt, data: { writer: ModelWriter }) => {
        // After a plain Enter the selection collapses into the new row, so this iterates exactly
        // that block; `getSelectedBlocks()` only yields elements, so no extra narrowing is needed.
        for (const block of editor.model.document.selection.getSelectedBlocks()) {
            if (block.getAttribute("listType") === "todo") {
                callback(data.writer, block);
            }
        }
    });
}
