import { isAnchorState } from "@triliumnext/commons";
import { Autoformat, blockAutoformatEditing, Plugin, TodoList } from "ckeditor5";

import TodoListMultistateEditing, { getActiveTaskStates } from "./todo_list_multistate_editing.js";

/**
 * Keyboard autoformatting for the custom task states.
 *
 * Upstream CKEditor's `Autoformat` only knows the two native markers — typing
 * `[ ]` / `[x]` on an empty paragraph turns it into an unchecked / checked todo
 * item. This plugin extends that to every configured non-anchor state: typing
 * its markdown marker (e.g. `[/]` for "doing", `[-]` for "cancelled") converts
 * the paragraph into a todo item already carrying that state, mirroring how the
 * marker round-trips through markdown import/export. See
 * {@link https://github.com/TriliumNext/Trilium/issues/10556}.
 *
 * Each rule runs the native `todoList` command (paragraph → todo item) and then
 * `setTaskState`, matching the upstream `[x]` rule that chains `todoList` +
 * `checkTodoList`.
 */
export default class TodoListMultistateAutoformat extends Plugin {

    static get requires() {
        // Autoformat: the engine this hooks into. TodoList: the `todoList` command the
        // rules run. TodoListMultistateEditing: the `setTaskState` command and the
        // configured state list this reads.
        return [Autoformat, TodoList, TodoListMultistateEditing] as const;
    }

    afterInit() {
        const editor = this.editor;
        const autoformat = editor.plugins.get(Autoformat);

        for (const state of getActiveTaskStates(editor)) {
            // Anchor states (`none`/`done`) map to `[ ]`/`[x]`, already handled by
            // upstream — registering them here would double-fire. States without a
            // marker have nothing to trigger on.
            if (isAnchorState(state.name) || !state.markdownSymbol) {
                continue;
            }

            // `^\[\s?<marker>\s?\]\s$` — same optional-inner-space shape as upstream's
            // `[x]` rule, closed by the trailing space that completes the trigger.
            const pattern = new RegExp(`^\\[\\s?${escapeRegExp(state.markdownSymbol)}\\s?\\]\\s$`);
            blockAutoformatEditing(editor, autoformat, pattern, () => {
                editor.execute("todoList");
                editor.execute("setTaskState", { state: state.name });
            });
        }
    }

}

/** Escape a single marker character so regex metacharacters (e.g. `?`, `-`, `/`) match literally. */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
