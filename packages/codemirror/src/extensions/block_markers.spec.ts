import { history, undoDepth } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import {
    ChangeSet, EditorSelection, EditorState, type Extension, Text, Transaction
} from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    applyOutsideHistory, blockMarkers, type BlockMarkerOptions, findMarkers, flashLines,
    getChangeRecord, rebaseChangeRecord, setChangeRecord, trackPositions
} from "./block_markers.js";

const marker = (id: string) => `<a data-trilium-block-id="${id}"></a>`;

let view: EditorView | undefined;

afterEach(() => {
    view?.destroy();
    view = undefined;
    vi.useRealTimers();
});

describe("blockMarkers", () => {
    it("draws each marker outside code as an atomic chip", () => {
        const code = `\`${marker("code")}\`\n\n\`\`\`\n${marker("f")}\n\`\`\``;
        const editor = build(`Text ${marker("a")}\n\n${code}\n\nBad ${marker("a:b")}`);

        const chips = [ ...editor.dom.querySelectorAll(".cm-block-marker") ];
        expect(chips.map((chip) => chip.getAttribute("title"))).toEqual([ "a", "" ]);
        expect(chips[0].querySelector(".bx-anchor")).not.toBeNull();
        expect(findMarkers(editor.state).map(({ id }) => id)).toEqual([ "a", null ]);

        const start = "Text ".length;
        editor.dispatch({ selection: EditorSelection.cursor(start) });
        editor.dispatch({ selection: editor.moveByChar(editor.state.selection.main, true) });
        expect(editor.state.selection.main.head).toBe(start + marker("a").length);
    });

    it("dims a marker that the renderer reads as marking no block, once the document rests", () => {
        vi.useFakeTimers();
        const readMarkers = vi.fn((doc: string) => [
            { from: doc.indexOf("<a"), to: doc.indexOf("</a>") + 4, isEffective: false },
            { from: doc.lastIndexOf("<a"), to: doc.length, isEffective: true }
        ]);
        const getTitle = vi.fn((found: { id: string | null }, isEffective: boolean) =>
            `${found.id} ${isEffective ? "marks" : "marks nothing"}`);
        const editor = build(`Text ${marker("a")} ${marker("b")}`, { readMarkers, getTitle });
        expect(editor.dom.querySelector(".cm-block-marker.inert")).toBeNull();

        vi.advanceTimersByTime(300);
        expect(readMarkers).toHaveBeenCalledOnce();
        const chips = [ ...editor.dom.querySelectorAll(".cm-block-marker") ];
        expect(chips.map((chip) => [ chip.className, chip.getAttribute("title") ])).toEqual([
            [ "cm-block-marker inert", "a marks nothing" ],
            [ "cm-block-marker", "b marks" ]
        ]);

        // An edit before the marker moves what was read with it until the next read.
        editor.dispatch({ changes: { from: 0, insert: "More " } });
        expect(editor.dom.querySelector(".cm-block-marker.inert")).not.toBeNull();
        vi.advanceTimersByTime(300);
        expect(readMarkers).toHaveBeenCalledTimes(2);
    });

    it("reads nothing of a document without markers", () => {
        vi.useFakeTimers();
        const readMarkers = vi.fn(() => []);
        const editor = build(`Text ${marker("a")}`, { readMarkers });
        vi.advanceTimersByTime(300);
        expect(readMarkers).toHaveBeenCalledOnce();

        editor.dispatch({ changes: { from: 4, to: editor.state.doc.length } });
        vi.advanceTimersByTime(300);
        expect(readMarkers).toHaveBeenCalledOnce();
        expect(editor.dom.querySelectorAll(".cm-block-marker")).toHaveLength(0);
    });

    it("opens the menu of a chip with its marker", () => {
        const openMenu = vi.fn();
        const editor = build(`Text ${marker("a")}`, { openMenu });
        const chip = editor.dom.querySelector<HTMLElement>(".cm-block-marker");
        chip?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

        expect(openMenu).toHaveBeenCalledWith(
            { from: 5, to: 5 + marker("a").length, id: "a" }, chip);
        build(`Text ${marker("a")}`).dom.querySelector(".cm-block-marker")
            ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        editorText().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    describe("keys", () => {
        it("deletes in front of the markers before the caret with Backspace", () => {
            const doc = `Héllo${marker("a")}${marker("b")}`;
            const editor = build(doc, {}, doc.length);
            press(editor, "Backspace");
            expect(editor.state.doc.toString()).toBe(`Héll${marker("a")}${marker("b")}`);
            expect(editor.state.selection.main.head).toBe(editor.state.doc.length);

            const atLineStart = build(`One\n${marker("a")} two`, {}, 4 + marker("a").length);
            press(atLineStart, "Backspace");
            expect(atLineStart.state.doc.toString()).toBe(`One${marker("a")} two`);

            const atStart = build(`${marker("a")}x`, {}, marker("a").length);
            expect(press(atStart, "Backspace")).toBe(true);
            expect(atStart.state.doc.toString()).toBe(`${marker("a")}x`);
        });

        it("deletes after the markers past the caret with Delete", () => {
            const editor = build(`${marker("a")}${marker("b")}xy`, {}, 0);
            press(editor, "Delete");
            expect(editor.state.doc.toString()).toBe(`${marker("a")}${marker("b")}y`);

            const atLineEnd = build(`One ${marker("a")}\nTwo`, {}, 4);
            press(atLineEnd, "Delete");
            expect(atLineEnd.state.doc.toString()).toBe(`One ${marker("a")}Two`);

            const atEnd = build(`x${marker("a")}`, {}, 1);
            expect(press(atEnd, "Delete")).toBe(true);
            expect(atEnd.state.doc.toString()).toBe(`x${marker("a")}`);
        });

        it("leaves Backspace and Delete away from a marker and with a selection alone", () => {
            const editor = build(`Text ${marker("a")}`, {}, 2);
            expect(press(editor, "Backspace")).toBe(false);
            expect(press(editor, "Delete")).toBe(false);
            editor.dispatch({ selection: EditorSelection.range(0, 2) });
            expect(press(editor, "Backspace")).toBe(false);
            expect(press(editor, "Delete")).toBe(false);
            expect(press(editor, "Enter")).toBe(false);
        });

        it("opens a line above a marker line with Enter at its end", () => {
            const doc = `Intro\n\n${marker("a")}\n## Heading`;
            const end = doc.indexOf("\n## ");
            const editor = build(doc, {}, end);
            press(editor, "Enter");
            expect(editor.state.doc.toString()).toBe(`Intro\n\n\n${marker("a")}\n## Heading`);
            expect(editor.state.selection.main.head).toBe("Intro\n\n".length);

            const notAlone = build(`x ${marker("a")}`, {}, `x ${marker("a")}`.length);
            expect(press(notAlone, "Enter")).toBe(false);
        });

        it("leaves Backspace, Delete and Enter beside a marker alone when read-only", () => {
            const doc = `One\n${marker("a")}\nTwo`;
            const lineEnd = doc.indexOf("\nTwo");
            const pressReadOnly = (key: string, caret: number) => {
                const editor = build(doc, {}, caret, [ EditorState.readOnly.of(true) ]);
                return [ press(editor, key), editor.state.doc.toString() ];
            };

            expect([
                pressReadOnly("Backspace", lineEnd),
                pressReadOnly("Delete", "One\n".length),
                pressReadOnly("Enter", lineEnd)
            ]).toStrictEqual([ [ false, doc ], [ false, doc ], [ false, doc ] ]);
        });
    });

    describe("filters", () => {
        it("widens a change over part of a marker, and moves an insertion out of one", () => {
            const doc = `ab${marker("a")}cd`;
            const start = 2;
            const state = createState(doc);
            const partial = state.update({ changes: { from: 1, to: start + 3 } }).state;
            expect(partial.doc.toString()).toBe("acd");
            const inside = state.update({ changes: { from: start + 4, insert: "x" } }).state;
            expect(inside.doc.toString()).toBe(`ab${marker("a")}xcd`);
            const whole = state.update({
                changes: { from: start, to: start + marker("a").length }
            }).state;
            expect(whole.doc.toString()).toBe("abcd");
            const plain = state.update({ changes: { from: 0, to: 1 } }).state;
            expect(plain.doc.toString()).toBe(`b${marker("a")}cd`);
            const undone = state.update({
                changes: { from: 1, to: start + 3 }, userEvent: "undo"
            }).state;
            expect(undone.doc.toString()).toBe(`a${doc.slice(start + 3)}`);
            // Two changes over the same marker become one.
            const end = start + marker("a").length;
            const both = state.update({
                changes: [ { from: 1, to: 3 }, { from: end - 2, to: end + 1 } ]
            });
            expect(both.state.doc.toString()).toBe("ad");
        });

        it("keeps the marker at the end of a split line on its first part", () => {
            const doc = `Some text ${marker("a")}`;
            const enter = (position: number) => createState(doc).update({
                changes: { from: position, insert: "\n" }, userEvent: "input.type"
            }).state.doc.toString();

            expect(enter(4)).toBe(`Some ${marker("a")}\n text`);
            expect(enter(5)).toBe(`Some ${marker("a")}\ntext`);
            expect(enter("Some text".length)).toBe(`Some text ${marker("a")}\n`);
            // At the start of the text, the whole line moves down with its marker.
            expect(enter(0)).toBe(`\n${doc}`);
            const indented = createState(`  Some ${marker("a")}`).update({
                changes: { from: 4, insert: "\n" }, userEvent: "input.type"
            }).state.doc.toString();
            expect(indented).toBe(`  So ${marker("a")}\nme`);
        });

        it("drops a pasted marker whose id the note holds, outside code and the change", () => {
            const state = createState(`One ${marker("a")}\n\n`
                + `<details data-trilium-block-id="d">x</details>\n`
                + `<div data-trilium-block-id="a:b"></div>\n`);
            const paste = (insert: string, from = state.doc.length) =>
                state.update({ changes: { from, insert }, userEvent: "input.paste" }).state.doc
                    .sliceString(from);

            expect(paste(`Copy ${marker("a")}`)).toBe("Copy ");
            expect(paste(`Copy ${marker("d")}`)).toBe("Copy ");
            expect(paste(`Copy ${marker("b")} ${marker("b")}`)).toBe(`Copy ${marker("b")} `);
            expect(paste("No markers")).toBe("No markers");
            // A marker without a valid id marks nothing, so it stays.
            expect(paste(`Bad ${marker("a:b")}`)).toBe(`Bad ${marker("a:b")}`);
            // A marker that lands in a pasted fence is text, beside a marker of the same id too.
            const fence = (id: string) => `\`\`\`\n${marker(id)}\n\`\`\``;
            expect(paste(`\nCopy ${marker("a")}\n\n${fence("a")}\n`))
                .toBe(`\nCopy \n\n${fence("a")}\n`);
            expect(paste(`\n${fence("y")}\n\nCopy ${marker("y")}\n`))
                .toBe(`\n${fence("y")}\n\nCopy ${marker("y")}\n`);
            // Without a language, nothing is code.
            const plain = EditorState.create({
                doc: `One ${marker("a")}`, extensions: [ blockMarkers() ]
            });
            expect(plain.update({
                changes: { from: plain.doc.length, insert: ` ${marker("a")}` },
                userEvent: "input.paste"
            }).state.doc.toString()).toBe(`One ${marker("a")} `);

            // A cut and paste, and a move in one transaction, keep the id.
            const moved = state.update({
                changes: [
                    { from: 4, to: 4 + marker("a").length },
                    { from: state.doc.length, insert: marker("a") }
                ]
            }).state.doc.toString();
            expect(moved.endsWith(marker("a"))).toBe(true);
            // A marker in code is text, and history replays as it was.
            const fenced = createState(`${marker("a")}\n\n\`\`\`\nx\n\`\`\``);
            const inFence = fenced.update({
                changes: { from: fenced.doc.length - 4, insert: marker("a") }
            });
            expect(inFence.state.doc.toString()).toContain(`x${marker("a")}\n\`\`\``);
            const redone = state.update({
                changes: { from: 0, insert: marker("a") }, userEvent: "redo"
            });
            expect(redone.state.doc.toString().startsWith(marker("a"))).toBe(true);
        });

        it("leaves a document load alone", () => {
            const state = createState(`One ${marker("a")}`);
            const loaded = state.update({
                changes: { from: 0, to: state.doc.length, insert: `${marker("a")} ${marker("a")}` },
                annotations: Transaction.addToHistory.of(false)
            }).state;
            expect(loaded.doc.toString()).toBe(`${marker("a")} ${marker("a")}`);
        });
    });

    it("records the changes since the record started, and starts again on a load", () => {
        const editor = build("abc");
        const base = editor.state.doc;
        editor.dispatch({ changes: { from: 3, insert: "d" } });
        editor.dispatch({ changes: { from: 0, insert: "x" } });
        const record = getChangeRecord(editor.state);
        expect(record.base).toBe(base);
        expect(record.changes.apply(base).toString()).toBe("xabcd");

        setChangeRecord(editor);
        expect(getChangeRecord(editor.state).base).toBe(editor.state.doc);
        expect(getChangeRecord(editor.state).changes.empty).toBe(true);
        const replay = {
            base: Text.of([ "abcd" ]), changes: ChangeSet.of({ from: 0, insert: "x" }, 4)
        };
        setChangeRecord(editor, replay);
        expect(getChangeRecord(editor.state)).toBe(replay);

        // A paste over the whole document is an edit, a replacement without a user event a load.
        editor.dispatch({
            changes: { from: 0, to: 5, insert: "pasted" }, userEvent: "input.paste"
        });
        expect(getChangeRecord(editor.state).base.toString()).toBe("abcd");
        editor.dispatch({ changes: { from: 0, to: 6, insert: "new" } });
        expect(getChangeRecord(editor.state).base.toString()).toBe("new");
        expect(getChangeRecord(editor.state).changes.empty).toBe(true);
    });

    it("moves the record onto a base that another writer changed", () => {
        const editor = build("one two");
        editor.dispatch({ changes: { from: 7, insert: " three" } });
        const brackets = [ { from: 0, to: 0, insert: "<" }, { from: 3, to: 3, insert: ">" } ];
        applyOutsideHistory(editor, brackets);
        expect(editor.state.doc.toString()).toBe("<one> two three");
        const withHistory = EditorState.create({ doc: "a", extensions: [ history() ] });
        const historyView = new EditorView({ state: withHistory });
        applyOutsideHistory(historyView, [ { from: 1, to: 1, insert: "b" } ]);
        expect(undoDepth(historyView.state)).toBe(0);
        historyView.destroy();

        // The other writer wrote the same brackets on the base.
        rebaseChangeRecord(editor, getChangeRecord(editor.state), brackets);
        const { base, changes } = getChangeRecord(editor.state);
        expect(base.toString()).toBe("<one> two");
        expect(changes.apply(base).toString()).toBe("<one> two three");
    });

    it("tracks positions through the changes until others are tracked or a load", () => {
        const editor = build("one two");
        const read = trackPositions(editor, [ { pos: 4, assoc: 1 }, { pos: 4, assoc: -1 } ]);
        editor.dispatch({ changes: { from: 4, insert: "big " } });
        editor.dispatch({ selection: EditorSelection.cursor(0) });
        expect(read()).toEqual([ 8, 4 ]);

        const next = trackPositions(editor, [ { pos: 0, assoc: 1 } ]);
        expect(read()).toBeNull();
        expect(next()).toEqual([ 0 ]);
        editor.dispatch({
            changes: { from: 0, to: editor.state.doc.length, insert: "loaded" },
            annotations: Transaction.addToHistory.of(false)
        });
        expect(next()).toBeNull();

        const plain = new EditorView({ state: EditorState.create({ doc: "x" }) });
        expect(trackPositions(plain, [ { pos: 0, assoc: 1 } ])()).toBeNull();
        plain.destroy();
    });

    it("highlights lines for a while, and a later flash outlasts an earlier one", () => {
        vi.useFakeTimers();
        const editor = build("one\ntwo\nthree");
        flashLines(editor, 2, 9, 1000);
        const flashed = [ ...editor.dom.querySelectorAll(".cm-block-flash") ];
        expect(flashed.map((line) => line.textContent))
            .toEqual([ "two", "three" ]);

        vi.advanceTimersByTime(500);
        flashLines(editor, 1, 1, 1000);
        vi.advanceTimersByTime(600);
        expect(editor.dom.querySelectorAll(".cm-block-flash").length).toBe(1);
        vi.advanceTimersByTime(500);
        expect(editor.dom.querySelectorAll(".cm-block-flash").length).toBe(0);
    });
});

function createState(doc: string) {
    const state = EditorState.create({ doc, extensions: [ markdown(), blockMarkers() ] });
    ensureSyntaxTree(state, doc.length);
    return state;
}

function build(
    doc: string, options: BlockMarkerOptions = {}, caret = 0, extensions: Extension[] = []
) {
    view?.destroy();
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    view = new EditorView({
        parent,
        state: EditorState.create({
            doc, extensions: [ markdown(), blockMarkers(options), ...extensions ]
        })
    });
    ensureSyntaxTree(view.state, doc.length);
    view.dispatch({ selection: EditorSelection.cursor(caret) });
    return view;
}

function press(editor: EditorView, key: string) {
    return runScopeHandlers(editor, new KeyboardEvent("keydown", { key }), "editor");
}

function editorText() {
    return view?.contentDOM ?? document.body;
}
