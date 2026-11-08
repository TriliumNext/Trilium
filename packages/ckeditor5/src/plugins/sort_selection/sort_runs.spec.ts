import {
    _setModelData as setModelData,
    BlockQuote,
    Essentials,
    Heading,
    HorizontalLine,
    ImageBlock,
    ImageCaption,
    Paragraph,
    Table
} from "ckeditor5";
import type { ClassicEditor, ModelElement } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import CollapsibleEditing from "../collapsible/collapsible_editing.js";
import { blockText, sortRuns, unitText } from "./sort_runs.js";

describe("sort_runs", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([
            Essentials, Paragraph, Heading, BlockQuote, Table, ImageBlock, ImageCaption,
            HorizontalLine, CollapsibleEditing
        ], { language: { content: "en" } });
    });

    function rootChildren(): ModelElement[] {
        return Array.from(editor.model.document.getRoot()?.getChildren() ?? []) as ModelElement[];
    }

    function texts(): string[] {
        return rootChildren().map((child) => blockText(editor.model, child));
    }

    function runsOf(children: ModelElement[]) {
        return children.map((child) => ({
            first: child,
            last: child,
            text: unitText(editor.model, child)
        }));
    }

    it("reads a block by the first element in it that holds text", () => {
        setModelData(editor.model,
            "<paragraph>a<softBreak></softBreak>b</paragraph>"
            + "<heading2>head</heading2>"
            + "<blockQuote><paragraph>quote</paragraph><paragraph>more</paragraph></blockQuote>"
            + "<details><summary>title</summary><paragraph>body</paragraph></details>"
            + "<table><tableRow><tableCell><paragraph>cell</paragraph></tableCell>"
            + "<tableCell><paragraph>next</paragraph></tableCell></tableRow></table>"
            + '<imageBlock src="a.png"><caption>caption</caption></imageBlock>'
            + '<imageBlock src="b.png"></imageBlock>'
            + "<horizontalLine></horizontalLine>");

        expect(rootChildren().map((child) => unitText(editor.model, child))).toEqual([
            "a b", "head", "quote", "title", "cell", "caption", "", ""
        ]);
    });

    it("moves only the runs that are out of place, in one change", () => {
        setModelData(editor.model,
            "<paragraph>b</paragraph><paragraph>a</paragraph><paragraph>c</paragraph>");
        const moves: string[] = [];
        editor.model.on("applyOperation", (_evt, [ operation ]) => {
            moves.push(operation.type);
        });
        const version = editor.model.document.version;

        expect(sortRuns(editor, runsOf(rootChildren()), false)).toBe(true);
        expect(texts()).toEqual([ "a", "b", "c" ]);
        expect(moves).toEqual([ "move" ]);
        expect(editor.model.document.version).toBe(version + 1);
    });

    it("moves a run of several nodes as one and runs the callback in the same change", () => {
        setModelData(editor.model,
            "<paragraph>b</paragraph><paragraph>b2</paragraph><paragraph>a</paragraph>");
        const [ b, b2, a ] = rootChildren();
        let changes = 0;
        editor.model.document.on("change", () => changes++);

        const isMoved = sortRuns(editor, [
            { first: b, last: b2, text: "b" },
            { first: a, last: a, text: "a" }
        ], false, (writer) => writer.setSelection(a, "in"));

        expect(isMoved).toBe(true);
        expect(texts()).toEqual([ "a", "b", "b2" ]);
        expect(editor.model.document.selection.getFirstPosition()?.parent).toBe(a);
        expect(changes).toBe(1);
    });

    it("writes nothing when the runs are already in order", () => {
        setModelData(editor.model, "<paragraph>a</paragraph><paragraph>b</paragraph>");
        const version = editor.model.document.version;

        expect(sortRuns(editor, runsOf(rootChildren()), false)).toBe(false);
        expect(editor.model.document.version).toBe(version);

        expect(sortRuns(editor, runsOf(rootChildren()), true)).toBe(true);
        expect(texts()).toEqual([ "b", "a" ]);
    });
});
