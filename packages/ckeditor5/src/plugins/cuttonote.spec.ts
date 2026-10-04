import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    ClassicEditor,
    Essentials,
    List,
    Paragraph,
    Table,
    TableSelection
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { installGlobMock } from "../../test/globals-test-kit.js";
import CutToNotePlugin from "./cuttonote.js";

describe("CutToNotePlugin", () => {
    let editor: ClassicEditor;
    let triggerCommand: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        triggerCommand = vi.fn();
        installGlobMock({
            getComponentByEl: () => ({ triggerCommand })
        });

        editor = await createTestEditor([Essentials, Paragraph, CutToNotePlugin]);
    });

    it("loads the plugin and registers the toolbar button", () => {
        expect(editor.plugins.get(CutToNotePlugin)).toBeInstanceOf(CutToNotePlugin);
        expect(editor.ui.componentFactory.has("cutToNote")).toBe(true);

        // No dictionary is configured here, so `t()` renders the message id, which is the English
        // label.
        const view = editor.ui.componentFactory.create("cutToNote") as { label?: string };
        expect(view.label).toBe("Cut selection into a sub-note");
    });

    it("triggers the cutIntoNote command on the Trilium component when the button is executed", () => {
        const view = editor.ui.componentFactory.create("cutToNote") as { fire(name: string): void };
        view.fire("execute");
        expect(triggerCommand).toHaveBeenCalledWith("cutIntoNote");
    });

    it("augments the editor with getSelectedHtml that serializes the selected content", () => {
        setModelData(editor.model, "<paragraph>foo[bar]baz</paragraph>");

        const html = editor.getSelectedHtml();
        expect(html).toContain("bar");
        expect(html).not.toContain("foo");
        expect(html).not.toContain("baz");
    });

    it("serializes a multi-paragraph selection into block markup via getSelectedHtml", () => {
        setModelData(editor.model, "<paragraph>[first</paragraph><paragraph>second]</paragraph>");

        const html = editor.getSelectedHtml();
        expect(html).toContain("first");
        expect(html).toContain("second");
        expect(html).toContain("<p>");
    });

    it("omits editor-only data-list-item-id from getSelectedHtml via the clipboard pipeline", async () => {
        const listEditor = await createTestEditor([Essentials, Paragraph, List, CutToNotePlugin]);
        setModelData(
            listEditor.model,
            `<paragraph listIndent="0" listItemId="a00" listType="bulleted">[foo]</paragraph>`
        );

        // Stored/data output keeps the id; the clipboard-pipeline selection drops it.
        expect(listEditor.getData()).toContain("data-list-item-id");

        const html = listEditor.getSelectedHtml();
        expect(html).toContain("foo");
        expect(html).not.toContain("data-list-item-id");
    });

    it("returns an empty string from getSelectedHtml when nothing is selected", () => {
        // What the host takes as "there is nothing to cut here" before it creates a sub-note (#9890).
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

        expect(editor.getSelectedHtml()).toBe("");
    });

    it("augments the editor with getSelectedPlainText for the plain-text flavor", () => {
        setModelData(editor.model, "<paragraph>foo[bar]baz</paragraph>");

        expect(editor.getSelectedPlainText()).toBe("bar");
    });

    it("pasteContent runs the given flavors through the clipboard paste pipeline", () => {
        setModelData(editor.model, "<paragraph>a[]b</paragraph>");
        editor.pasteContent("<span>X</span>", "X");
        expect(editor.getData()).toContain("aXb");

        // Without HTML the text flavor pastes as plain text.
        setModelData(editor.model, "<paragraph>c[]d</paragraph>");
        editor.pasteContent("", "plain");
        expect(editor.getData()).toContain("plain");

        // With neither flavor nothing is inserted.
        setModelData(editor.model, "<paragraph>e[]f</paragraph>");
        editor.pasteContent("", "");
        expect(editor.getData()).toContain("ef");
    });

    describe("capturePasteTarget", () => {
        it("pastes at the selection captured before the content arrived", () => {
            setModelData(editor.model, "<paragraph>a[]b</paragraph><paragraph>cd</paragraph>");
            editor.capturePasteTarget().paste("", "X");
            expect(editor.getData()).toBe("<p>aXb</p><p>cd</p>");

            setModelData(editor.model, "<paragraph>a[]b</paragraph><paragraph>cd</paragraph>");
            const target = editor.capturePasteTarget();
            moveCaret(editor, 1, 1);
            target.paste("", "X");
            expect(editor.getData()).toBe("<p>aXb</p><p>cd</p>");
        });

        it("restores the captured selection, or reports that its content is gone", () => {
            setModelData(editor.model, "<paragraph>a[]b</paragraph><paragraph>cd</paragraph>");
            const target = editor.capturePasteTarget();
            moveCaret(editor, 1, 1);

            expect(target.restore()).toBe(true);
            expect(getModelData(editor.model))
                .toBe("<paragraph>a[]b</paragraph><paragraph>cd</paragraph>");

            const gone = editor.capturePasteTarget();
            editor.setData("<p>other</p>");
            expect(gone.restore()).toBe(false);
            expect(getModelData(editor.model)).toBe("<paragraph>[]other</paragraph>");
        });

        it("discards the paste when the captured content was removed", () => {
            setModelData(editor.model, "<paragraph>a[]b</paragraph><paragraph>cd</paragraph>");
            const target = editor.capturePasteTarget();
            editor.model.change((writer) => {
                const first = editor.model.document.getRoot()?.getChild(0);
                if (first) {
                    writer.remove(first);
                }
            });
            moveCaret(editor, 0, 1);

            target.paste("", "X");

            expect(editor.getData()).toBe("<p>cd</p>");
        });

        it("discards the paste when the editor loads other content, such as another note", () => {
            for (const data of [
                "<paragraph>a[]b</paragraph>",
                "<paragraph>a[b</paragraph><paragraph>c]d</paragraph>",
                "<paragraph>[abcd]</paragraph>"
            ]) {
                setModelData(editor.model, data);
                const target = editor.capturePasteTarget();
                editor.setData("<p>other</p>");

                target.paste("", "X");

                expect(editor.getData(), data).toBe("<p>other</p>");
            }
        });

        it("does nothing once the editor is destroyed", async () => {
            const element = document.createElement("div");
            document.body.appendChild(element);
            try {
                const shortLived = await ClassicEditor.create(element, {
                    licenseKey: "GPL",
                    plugins: [Essentials, Paragraph, CutToNotePlugin]
                });
                const target = shortLived.capturePasteTarget();
                await shortLived.destroy();

                expect(() => target.paste("", "X")).not.toThrow();
                target.release();
            } finally {
                element.remove();
            }
        });
    });

    describe("table cell selections", () => {
        let tableEditor: ClassicEditor;

        beforeEach(async () => {
            tableEditor = await createTestEditor([Essentials, Paragraph, Table, CutToNotePlugin]);
        });

        it("serializes a cell selection as a table of just the selected cells", () => {
            setModelData(tableEditor.model, modelTable([
                ["a1", "b1", "c1"],
                ["a2", "b2", "c2"],
                ["a3", "b3", "c3"]
            ]));
            selectCells(tableEditor, [1, 1], [2, 2]);

            const html = tableEditor.getSelectedHtml();
            expect(html).toContain("<table");
            for (const kept of ["b2", "c2", "b3", "c3"]) {
                expect(html).toContain(kept);
            }
            for (const dropped of ["a1", "b1", "c1", "a2", "a3"]) {
                expect(html).not.toContain(dropped);
            }
        });

        it("keeps header cells when the selection includes the heading row", () => {
            setModelData(tableEditor.model,
                modelTable([["h1", "h2"], ["a1", "a2"]], 'headingRows="1"'));
            selectCells(tableEditor, [0, 0], [1, 1]);

            const html = tableEditor.getSelectedHtml();
            expect(html).toContain("<th>");
            expect(html).toContain("h1");
            expect(html).toContain("a2");
        });

        it("reads a cell selection as cell text via getSelectedPlainText", () => {
            setModelData(tableEditor.model, modelTable([["a1", "b1"], ["a2", "b2"]]));
            selectCells(tableEditor, [0, 0], [1, 0]);

            const text = tableEditor.getSelectedPlainText();
            expect(text).toContain("a1");
            expect(text).toContain("a2");
            expect(text).not.toContain("b1");
        });

        it("pasteContent merges a copied cell fragment into a cell selection", () => {
            setModelData(tableEditor.model, modelTable([["a1", "b1"], ["a2", "b2"]]));
            selectCells(tableEditor, [0, 0], [1, 1]);
            const html = tableEditor.getSelectedHtml();

            setModelData(tableEditor.model, modelTable([["x1", "y1"], ["x2", "y2"]]));
            selectCells(tableEditor, [0, 0], [1, 1]);
            tableEditor.pasteContent(html, "");

            const data = tableEditor.getData();
            expect(data).toContain("a1");
            expect(data).toContain("b2");
            expect(data).not.toContain("x1");
        });

        it("capturePasteTarget discards a table paste when the editor loads other content", () => {
            const html = "<table><tbody><tr><td>new</td></tr></tbody></table>";
            const selections: (() => void)[] = [
                () => selectCells(tableEditor, [0, 0], [1, 1]),
                () => selectRoot(tableEditor, "on"),
                () => selectRoot(tableEditor, "in")
            ];

            for (const [index, select] of selections.entries()) {
                setModelData(tableEditor.model, modelTable([["a1", "b1"], ["a2", "b2"]]));
                select();
                const target = tableEditor.capturePasteTarget();
                tableEditor.setData("<p>other</p>");

                target.paste(html, "");

                expect(tableEditor.getData(), `selection ${index}`).toBe("<p>other</p>");
            }
        });

        it("capturePasteTarget restores a cell selection before pasting into it", () => {
            setModelData(tableEditor.model, modelTable([["a1", "b1"], ["a2", "b2"]]));
            selectCells(tableEditor, [0, 0], [1, 1]);
            const html = tableEditor.getSelectedHtml();

            setModelData(tableEditor.model,
                modelTable([["x1", "y1", "z1"], ["x2", "y2", "z2"]]));
            selectCells(tableEditor, [0, 0], [1, 1]);
            const target = tableEditor.capturePasteTarget();
            selectCells(tableEditor, [0, 2], [0, 2]);
            target.paste(html, "");

            const data = tableEditor.getData();
            expect(data).toContain("a1");
            expect(data).toContain("b2");
            expect(data).not.toContain("x1");
            expect(data).toContain("z1");
        });
    });

    it("removeSelection deletes the selection, inserts a paragraph and saves the note", async () => {
        setModelData(editor.model, "<paragraph>foo[bar]baz</paragraph>");

        await editor.removeSelection();

        expect(editor.getData()).not.toContain("bar");
        expect(editor.getData()).toContain("foobaz");
        expect(triggerCommand).toHaveBeenCalledWith("saveNoteDetailNow");
    });

    it("removeSelection on a collapsed selection still inserts a paragraph and saves", async () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

        await editor.removeSelection();

        expect(editor.getData()).toContain("foobar");
        expect(triggerCommand).toHaveBeenCalledWith("saveNoteDetailNow");
    });
});

function modelTable(rows: string[][], attributes = ""): string {
    const rowsMarkup = rows
        .map((cells) => {
            const cellsMarkup = cells
                .map((cell) => `<tableCell><paragraph>${cell}</paragraph></tableCell>`)
                .join("");
            return `<tableRow>${cellsMarkup}</tableRow>`;
        })
        .join("");
    return `<table${attributes ? ` ${attributes}` : ""}>${rowsMarkup}</table>`;
}

/** Moves the caret to `offset` in the root child at `childIndex`. */
function moveCaret(editor: ClassicEditor, childIndex: number, offset: number) {
    editor.model.change((writer) => {
        const block = editor.model.document.getRoot()?.getChild(childIndex);
        if (!block?.is("element")) {
            throw new Error(`No element at root child ${childIndex}.`);
        }
        writer.setSelection(block, offset);
    });
}

function selectCells(editor: ClassicEditor, anchor: [number, number], target: [number, number]) {
    const getCell = (row: number, column: number) => {
        const cell = editor.model.document.getRoot()?.getNodeByPath([0, row, column]);
        if (!cell || !cell.is("element", "tableCell")) {
            throw new Error(`No table cell at row ${row}, column ${column}.`);
        }
        return cell;
    };

    editor.plugins.get(TableSelection).setCellSelection(
        getCell(anchor[0], anchor[1]),
        getCell(target[0], target[1])
    );
}

/** Selects the first element of the root (`"on"`) or the whole content of the root (`"in"`). */
function selectRoot(editor: ClassicEditor, placement: "on" | "in") {
    const root = editor.model.document.getRoot();
    const first = root?.getChild(0);
    if (!root || !first) {
        throw new Error("The document is empty.");
    }

    editor.model.change((writer) => {
        if (placement === "on") {
            writer.setSelection(first, "on");
        } else {
            writer.setSelection(writer.createRangeIn(root));
        }
    });
}
