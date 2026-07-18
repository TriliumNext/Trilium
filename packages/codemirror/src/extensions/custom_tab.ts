import { indentLess, indentMore } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { EditorSelection, EditorState, SelectionRange, type Transaction, type ChangeSpec } from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";

/**
 * Custom key binding for indentation:
 *
 * - <kbd>Tab</kbd> while at the beginning of a line will indent the line.
 * - <kbd>Tab</kbd> while not at the beginning of a line will insert a tab character.
 * - <kbd>Tab</kbd> while not at the beginning of a line while text is selected will replace the txt with a tab character.
 * - <kbd>Shift</kbd>+<kbd>Tab</kbd> will always unindent.
 */
const smartIndentWithTab: KeyBinding[] = [
    {
        key: "Tab",
        run({ state, dispatch }) {
            if (state.facet(EditorState.readOnly)) {
                return false;
            }

            const { selection } = state;

            // Step 1: Handle non-empty selections → replace with tab
            if (selection.ranges.some(range => !range.empty)) {
                // If multiple lines are selected, insert a tab character at the start of each line
                // and move the cursor to the position after the tab character.
                const linesCovered = new Set<number>();
                for (const range of selection.ranges) {
                    const startLine = state.doc.lineAt(range.from);
                    const endLine = state.doc.lineAt(range.to);

                    for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber++) {
                        linesCovered.add(lineNumber);
                    }
                }

                if (linesCovered.size > 1) {
                    // Multiple lines are selected, indent each line.
                    return indentMore({ state, dispatch });
                } else {
                    return handleSingleLineSelection(state, dispatch);
                }
            }

            // Step 2: Handle empty selections
            return handleEmptySelections(state, dispatch);
        },
        shift: indentLess
    },
]
export default smartIndentWithTab;

function handleSingleLineSelection(state: EditorState, dispatch: (transaction: Transaction) => void) {
    const changes: ChangeSpec[] = [];
    const newSelections: SelectionRange[] = [];
    const unit = state.facet(indentUnit);

    // Single line selection, replace with indent unit.
    for (let range of state.selection.ranges) {
        changes.push({ from: range.from, to: range.to, insert: unit });
        newSelections.push(EditorSelection.cursor(range.from + unit.length));
    }

    dispatch(
        state.update({
            changes,
            selection: EditorSelection.create(newSelections),
            scrollIntoView: true,
            userEvent: "input"
        })
    );

    return true;
}

function handleEmptySelections(state: EditorState, dispatch: (transaction: Transaction) => void) {
    const changes: ChangeSpec[] = [];
    const newSelections: SelectionRange[] = [];
    const unit = state.facet(indentUnit);

    for (let range of state.selection.ranges) {
        const line = state.doc.lineAt(range.head);
        const beforeCursor = state.doc.sliceString(line.from, range.head);

        if (/^\s*$/.test(beforeCursor)) {
            // Only whitespace before cursor → indent line
            return indentMore({ state, dispatch });
        } else {
            // Insert configured indent unit at cursor
            changes.push({ from: range.head, to: range.head, insert: unit });
            newSelections.push(EditorSelection.cursor(range.head + unit.length));
        }
    }

    if (changes.length) {
        dispatch(
            state.update({
                changes,
                selection: EditorSelection.create(newSelections),
                scrollIntoView: true,
                userEvent: "input"
            })
        );
        return true;
    }

    return false;
}
