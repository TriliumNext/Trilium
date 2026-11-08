import { isolateHistory } from "@codemirror/commands";
import {
    type ChangeSpec, EditorSelection, type EditorState, type Transaction, type TransactionSpec
} from "@codemirror/state";
import {
    type LineOperation, type LineOperationOptions, type TextTransform, type TextTransformOptions,
    transformLines, transformText
} from "@triliumnext/commons";

/** What the text tools change: an `EditorView`, or a state with a dispatch function. */
export interface TextToolTarget {
    readonly state: EditorState;
    dispatch(transaction: Transaction): void;
}

/** Whether the selection holds any text for the text tools to change. */
export function hasSelectedText(state: EditorState) {
    return state.selection.ranges.some((range) => !range.empty);
}

/**
 * Applies `operation` to the whole lines that the selection touches, in one undo step, and selects
 * the changed lines in the direction of each range. Each range of the selection changes its own
 * lines. Returns `false` when nothing is selected or the editor is read-only.
 */
export function runLineOperation(
    target: TextToolTarget,
    operation: LineOperation,
    options: LineOperationOptions = {}
) {
    const { state } = target;
    if (state.readOnly || !hasSelectedText(state)) {
        return false;
    }

    const { blocks, mainIndex } = getLineBlocks(state);
    const changes = state.changes(blocks.flatMap((block) => {
        const lines = state.sliceDoc(block.from, block.to).split(state.lineBreak);
        const result = transformLines(lines, operation, options);
        return isSameLines(lines, result) ? [] : [ toLineChange(state, block, result) ];
    }));
    if (changes.empty) {
        return true;
    }

    const ranges = blocks.map((block) => {
        const from = changes.mapPos(block.from, -1);
        const to = changes.mapPos(block.to, 1);
        return block.isBackward ? EditorSelection.range(to, from) : EditorSelection.range(from, to);
    });
    target.dispatch(state.update({
        changes,
        selection: EditorSelection.create(ranges, mainIndex),
        ...EDIT
    }));
    return true;
}

/**
 * Applies `transform` to each range of the selection, in one undo step, and keeps the ranges
 * selected. Returns `false` when nothing is selected or the editor is read-only.
 */
export function runTextTransform(
    target: TextToolTarget,
    transform: TextTransform,
    options: Pick<TextTransformOptions, "locale"> = {}
) {
    const { state } = target;
    if (state.readOnly || !hasSelectedText(state)) {
        return false;
    }

    let isChanged = false;
    const spec = state.changeByRange((range) => {
        const text = state.sliceDoc(range.from, range.to);
        const replaced = transformText(text, transform, {
            locale: options.locale,
            before: state.sliceDoc(state.doc.lineAt(range.from).from, range.from),
            after: state.sliceDoc(range.to, state.doc.lineAt(range.to).to)
        });
        if (replaced === text) {
            return { range };
        }

        isChanged = true;
        const end = range.from + state.toText(replaced).length;
        return {
            changes: { from: range.from, to: range.to, insert: replaced },
            range: range.anchor === range.from
                ? EditorSelection.range(range.from, end)
                : EditorSelection.range(end, range.from)
        };
    });

    if (isChanged) {
        target.dispatch(state.update(spec, EDIT));
    }
    return true;
}

/** A run of whole lines, from the start of the first to the end of the last. */
interface LineBlock {
    from: number;
    to: number;
    /** Whether the first range in the block has its head before its anchor. */
    isBackward: boolean;
}

/** The text tools change the document as one undo step, which later typing does not join. */
const EDIT = {
    scrollIntoView: true,
    userEvent: "input.transform",
    annotations: isolateHistory.of("full")
} satisfies TransactionSpec;

/**
 * The blocks of lines that the ranges of the selection touch, and the index of the block of the
 * main range. A range that ends at the start of a line leaves that line out, and ranges that
 * touch one line share a block.
 */
function getLineBlocks(state: EditorState) {
    const { doc, selection } = state;
    const blocks: LineBlock[] = [];
    let mainIndex = 0;

    for (const [ index, range ] of selection.ranges.entries()) {
        if (range.empty) continue;

        const first = doc.lineAt(range.from);
        let last = doc.lineAt(range.to);
        if (range.to === last.from && last.number > first.number) {
            last = doc.line(last.number - 1);
        }

        const previous = blocks[blocks.length - 1];
        if (previous && first.from <= previous.to) {
            previous.to = Math.max(previous.to, last.to);
        } else {
            blocks.push({ from: first.from, to: last.to, isBackward: range.head < range.anchor });
        }
        if (index === selection.mainIndex) {
            mainIndex = blocks.length - 1;
        }
    }

    return { blocks, mainIndex };
}

function isSameLines(lines: string[], result: string[]) {
    return lines.length === result.length && lines.every((line, index) => line === result[index]);
}

/** Replaces `block` with `lines`. With no lines, it also removes a line break next to the block. */
function toLineChange(state: EditorState, block: LineBlock, lines: string[]): ChangeSpec {
    if (lines.length) {
        return { from: block.from, to: block.to, insert: lines.join(state.lineBreak) };
    }
    if (block.to < state.doc.length) {
        return { from: block.from, to: block.to + 1 };
    }
    return { from: Math.max(block.from - 1, 0), to: block.to };
}
