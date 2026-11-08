import { history, isolateHistory, undo } from "@codemirror/commands";
import {
    EditorSelection, EditorState, type Extension, type SelectionRange, Text, Transaction
} from "@codemirror/state";
import type { LineOperation, TextTransform } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { hasSelectedText, runLineOperation, runTextTransform } from "./text_tools.js";

describe("hasSelectedText", () => {
    it("tells whether any range of the selection holds text", () => {
        expect(hasSelectedText(createTarget("a|b").state)).toBe(false);
        expect(hasSelectedText(createTarget("|a[b]").state)).toBe(true);
    });
});

describe("runLineOperation", () => {
    it("changes the whole lines the selection touches, and selects them", () => {
        const target = createTarget("keep\nc[2\nb2\na]2\nkeep");
        expect(runLineOperation(target, "sortAscending")).toBe(true);
        expect(target.marked).toBe("keep\n[a2\nb2\nc2]\nkeep");
    });

    it("leaves out the line that a selection ends at the start of", () => {
        const target = createTarget("[c\nb\n]a");
        runLineOperation(target, "sortAscending");
        expect(target.marked).toBe("[b\nc]\na");
    });

    it("changes each block of lines on its own, joining the ranges on one line", () => {
        const target = createTarget("[b\na] [x]\nz\n[d\nc]", 2);
        runLineOperation(target, "sortAscending");
        expect(target.marked).toBe("[a x\nb]\nz\n[c\nd]");
        expect(target.state.selection.mainIndex).toBe(1);

        const trimmed = createTarget("[  b\n  a]  [x]  ");
        runLineOperation(trimmed, "trimBoth");
        expect(trimmed.marked).toBe("[b\na  x]");

        const withCursor = createTarget("x|y\n[c\nb]", 1);
        runLineOperation(withCursor, "sortAscending");
        expect(withCursor.marked).toBe("xy\n[b\nc]");
    });

    it("runs each operation on the lines", () => {
        expect(run("[  b \n\n  a  \n  a  ]", "deduplicate")).toBe("[  b \n\n  a  ]");
        expect(run("[1\n2\n3]", "reverse")).toBe("[3\n2\n1]");
        expect(run("x\n  [b  ]", "trimLeading")).toBe("x\n[b  ]");
        expect(run("x\n  [b  ]", "trimTrailing")).toBe("x\n[  b]");
        expect(run("x\n  [b  ]", "trimBoth")).toBe("x\n[b]");
        expect(run("[a\n \n\nb]", "removeBlankLines")).toBe("[a\nb]");
        expect(run("[10\n9\n\nb\nA]", "sortDescending")).toBe("[b\nA\n10\n9\n]");
    });

    it("passes the locale, the date formats and the random source on", () => {
        const sorted = createTarget("[01.10.26\n30.09.26]");
        runLineOperation(sorted, "sortAscending", { locale: "en", dateFormats: [ "DD.MM.YY" ] });
        expect(sorted.marked).toBe("[30.09.26\n01.10.26]");

        const collated = createTarget("[z\nä\na]");
        runLineOperation(collated, "sortAscending", { locale: "sv" });
        expect(collated.marked).toBe("[a\nz\nä]");

        const shuffled = createTarget("[a\nb\nc\nd]");
        runLineOperation(shuffled, "shuffle", { random: () => 0 });
        expect(shuffled.marked).toBe("[b\nc\nd\na]");
    });

    it("keeps the direction of each range", () => {
        const target = createTarget("c\nb\na\n\nz\ny");
        target.dispatch(target.state.update({
            selection: EditorSelection.create([
                EditorSelection.range(5, 0), EditorSelection.range(7, 10)
            ])
        }));
        runLineOperation(target, "sortAscending");
        expect(target.state.sliceDoc()).toBe("a\nb\nc\n\ny\nz");
        expect(target.state.selection.ranges).toMatchObject([
            { anchor: 5, head: 0 }, { anchor: 7, head: 10 }
        ]);
    });

    it("removes the line break of a block that has no line left", () => {
        expect(run("a\n[\n ]\nb", "removeBlankLines")).toBe("a\n|b");
        expect(run("a\n[\n ]", "removeBlankLines")).toBe("a|");
        expect(run("[ \n]x", "removeBlankLines")).toBe("|x");
        expect(run("[\n]x", "removeBlankLines")).toBe("|x");
        expect(run("[\n ]", "removeBlankLines")).toBe("|");
    });

    it("keeps the line breaks of the editor", () => {
        const target = createTarget("[b\na]", 0, [ EditorState.lineSeparator.of("\r\n") ]);
        runLineOperation(target, "sortAscending");
        expect(target.state.sliceDoc()).toBe("a\r\nb");
        expect(target.marked).toBe("[a\nb]");
    });

    it("dispatches nothing when the lines do not change", () => {
        const target = createTarget("[a\nb]");
        expect(runLineOperation(target, "sortAscending")).toBe(true);
        expect(target.transactions).toHaveLength(0);
    });

    it("refuses a selection without text and a read-only editor", () => {
        expect(runLineOperation(createTarget("b\n|a"), "sortAscending")).toBe(false);
        const readOnly = createTarget("[b\na]", 0, [ EditorState.readOnly.of(true) ]);
        expect(runLineOperation(readOnly, "sortAscending")).toBe(false);
        expect(readOnly.transactions).toHaveLength(0);
    });

    it("makes one undo step that later typing does not join", () => {
        const target = createTarget("[c\nb\na]", 0, [ history() ]);
        runLineOperation(target, "sortAscending");
        runLineOperation(target, "reverse");
        target.dispatch(target.state.update({
            changes: { from: 5, insert: "!" },
            userEvent: "input.type"
        }));
        expect(target.state.sliceDoc()).toBe("c\nb\na!");

        undo(target);
        expect(target.state.sliceDoc()).toBe("c\nb\na");
        undo(target);
        expect(target.state.sliceDoc()).toBe("a\nb\nc");
        undo(target);
        expect(target.state.sliceDoc()).toBe("c\nb\na");

        const [ transaction ] = target.transactions;
        expect(transaction.annotation(Transaction.userEvent)).toBe("input.transform");
        expect(transaction.annotation(isolateHistory)).toBe("full");
        expect(transaction.scrollIntoView).toBe(true);
    });
});

describe("runTextTransform", () => {
    it("changes each range of the selection and keeps it selected", () => {
        expect(transform("[hello] world| [foo]", "upperCase")).toBe("[HELLO] world| [FOO]");
        expect(transform("[straße] x", "upperCase", "de")).toBe("[STRASSE] x");
        expect(transform("[ÉTÉ]", "removeDiacritics")).toBe("[ETE]");
    });

    it("reads the rest of the line to find where words and sentences start and end", () => {
        expect(transform("Hello world. [FOO bar]", "sentenceCase")).toBe("Hello world. [Foo bar]");
        expect(transform("hel[LO WORLD]", "sentenceCase")).toBe("hel[lo world]");
        expect(transform("[FIRST\nSECOND]", "sentenceCase")).toBe("[First\nSecond]");
        expect(transform("the lord [OF THE] rings", "titleCase")).toBe("the lord [of the] rings");
        expect(transform("the lord of the [rings]", "titleCase")).toBe("the lord of the [Rings]");
        expect(transform("Ο[Σ] x", "lowerCase", "el")).toBe("Ο[ς] x");
    });

    it("uses the locale", () => {
        expect(transform("[istanbul]", "upperCase", "tr")).toBe("[İSTANBUL]");
        expect(transform("[istanbul]", "upperCase", "en")).toBe("[ISTANBUL]");
    });

    it("keeps the direction of a range", () => {
        const target = createTarget("abc");
        target.dispatch(target.state.update({ selection: EditorSelection.range(3, 0) }));
        runTextTransform(target, "upperCase");
        expect(target.state.selection.main).toMatchObject({ anchor: 3, head: 0 });
    });

    it("selects the new length of a text with line breaks of the editor", () => {
        const target = createTarget("[ab\ncd]", 0, [ EditorState.lineSeparator.of("\r\n") ]);
        runTextTransform(target, "upperCase");
        expect(target.state.sliceDoc()).toBe("AB\r\nCD");
        expect(target.marked).toBe("[AB\nCD]");
    });

    it("dispatches nothing for unchanged text, and refuses what it cannot change", () => {
        const unchanged = createTarget("[ABC]");
        expect(runTextTransform(unchanged, "upperCase")).toBe(true);
        expect(unchanged.transactions).toHaveLength(0);

        expect(runTextTransform(createTarget("ab|c"), "upperCase")).toBe(false);
        const readOnly = createTarget("[abc]", 0, [ EditorState.readOnly.of(true) ]);
        expect(runTextTransform(readOnly, "upperCase")).toBe(false);
    });

    it("makes one undo step", () => {
        const target = createTarget("[abc] [def]", 0, [ history() ]);
        runTextTransform(target, "upperCase");
        expect(target.state.sliceDoc()).toBe("ABC DEF");
        undo(target);
        expect(target.state.sliceDoc()).toBe("abc def");
        expect(target.transactions[0].annotation(isolateHistory)).toBe("full");
    });
});

interface Target {
    readonly state: EditorState;
    dispatch(transaction: Transaction): void;
    readonly transactions: Transaction[];
    /** The document, with `[` and `]` around each selected range and `|` at each cursor. */
    readonly marked: string;
}

/**
 * A state and a dispatch function that keeps the transactions. In `marked`, `[` and `]` surround a
 * selected range and `|` is a cursor; `mainIndex` picks the main range.
 */
function createTarget(marked: string, mainIndex = 0, extensions: Extension[] = []): Target {
    let doc = "";
    let rangeStart = 0;
    const ranges: SelectionRange[] = [];
    for (const character of marked) {
        if (character === "[") {
            rangeStart = doc.length;
        } else if (character === "]") {
            ranges.push(EditorSelection.range(rangeStart, doc.length));
        } else if (character === "|") {
            ranges.push(EditorSelection.cursor(doc.length));
        } else {
            doc += character;
        }
    }

    // Built from lines: an editor with a line separator of its own does not split a string at "\n".
    let state = EditorState.create({
        doc: Text.of(doc.split("\n")),
        selection: EditorSelection.create(ranges.length ? ranges : [ EditorSelection.cursor(0) ],
            mainIndex),
        extensions: [ EditorState.allowMultipleSelections.of(true), ...extensions ]
    });
    const transactions: Transaction[] = [];
    return {
        get state() {
            return state;
        },
        dispatch(transaction) {
            transactions.push(transaction);
            state = transaction.state;
        },
        transactions,
        get marked() {
            return markSelection(state);
        }
    };
}

function markSelection(state: EditorState) {
    const text = state.doc.toString();
    let result = "";
    let position = 0;
    for (const range of state.selection.ranges) {
        result += text.slice(position, range.from);
        result += range.empty ? "|" : `[${text.slice(range.from, range.to)}]`;
        position = range.to;
    }
    return result + text.slice(position);
}

function run(marked: string, operation: LineOperation) {
    const target = createTarget(marked);
    runLineOperation(target, operation, { locale: "en" });
    return target.marked;
}

function transform(marked: string, name: TextTransform, locale = "en") {
    const target = createTarget(marked);
    runTextTransform(target, name, { locale });
    return target.marked;
}
