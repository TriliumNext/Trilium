import {
    _getModelData as getModelData, _setModelData as setModelData,
    _VIEW_INLINE_FILLER as INLINE_FILLER, Bold, type ClassicEditor, Essentials, type ModelElement,
    Paragraph, type ViewElement
} from "ckeditor5";
import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { createTestEditor, pressKey } from "../../test/editor-kit.js";
import { TestChipPlugin } from "../../test/fixture-plugins.js";
import { registerTestCleanup } from "../../test/globals-test-kit.js";
import InlineWidgetCaret from "./inline_widget_caret.js";

// A line of the test editor holds five of these words.
const TWO_LINES = "lorem ".repeat(8);
const THREE_LINES = "lorem ".repeat(14);

describe("InlineWidgetCaret", () => {
    describe("block filler", () => {
        it("follows a widget that ends a text block, inside attribute elements too", async () => {
            const editor = await createEditor();
            setModelData(editor.model,
                `<paragraph>a${chip("x")}</paragraph>` +
                `<paragraph>${chip("x")} b</paragraph>` +
                `<paragraph><$text bold="true">a</$text>${chip("x", "bold=\"true\" ")}` +
                "</paragraph><paragraph></paragraph>");

            expect(getBlocks(editor).map(describeDom)).toEqual([
                "a,chip,filler",
                "chip,\u{a0}b",
                "strong,filler",
                "filler"
            ]);
            expect(editor.getData()).not.toContain("<br");
        });

        it("comes and goes with the text after the widget", async () => {
            const editor = await createEditor();
            setModelData(editor.model,
                `<paragraph>a[]</paragraph><paragraph>${chip("x")}</paragraph>`);
            const paragraph = editor.model.document.getRoot()?.getChild(1) as ModelElement;

            editor.model.change((writer) => writer.insertText(" b", paragraph, "end"));
            expect(describeDom(getBlocks(editor)[1])).toBe("chip,\u{a0}b");

            editor.model.change((writer) => {
                writer.remove(writer.createRange(
                    writer.createPositionAt(paragraph, 1),
                    writer.createPositionAt(paragraph, "end")));
            });
            expect(describeDom(getBlocks(editor)[1])).toBe("chip,filler");
        });

        it("looks past UI elements after the widget", async () => {
            const editor = await createEditor();
            setModelData(editor.model,
                `<paragraph>a[]</paragraph><paragraph>${chip("x")}</paragraph>`);
            const paragraph = editor.model.document.getRoot()?.getChild(1) as ModelElement;
            const viewParagraph = editor.editing.mapper.toViewElement(paragraph) as ViewElement;

            editor.editing.view.change((writer) => {
                writer.insert(
                    writer.createPositionAt(viewParagraph, "end"), writer.createUIElement("span"));
            });
            expect(describeDom(getBlocks(editor)[1])).toBe("chip,span,filler");
        });

        it("leaves the caret after the widget in an inline filler", async () => {
            const editor = await createEditor();
            setModelData(editor.model, `<paragraph>${chip("x")}[]</paragraph>`);

            const block = getBlocks(editor)[0];
            const caret = document.getSelection()?.focusNode;
            expect(caret?.parentNode).toBe(block);
            expect(describeDom(block)).toBe("chip,inline filler,filler");
        });

        it("leaves a text element alone that the editing view does not draw", async () => {
            const editor = await createEditor();
            editor.model.schema.register("undrawn", {
                allowWhere: "$block",
                allowContentOf: "$block"
            });
            editor.editing.downcastDispatcher.on("insert:undrawn", (evt, data, { consumable }) => {
                consumable.consume(data.item, evt.name);
            });

            setModelData(editor.model,
                `<paragraph>a[]</paragraph><paragraph>${chip("x")}</paragraph><undrawn></undrawn>`);
            expect(getBlocks(editor).map(describeDom)).toEqual([ "a", "chip,filler" ]);
        });
    });

    describe("Up and Down", () => {
        it("moves up from the end of a wrapped widget to its start", async () => {
            const editor = await createEditor();
            setModelData(editor.model,
                `<paragraph>a</paragraph><paragraph>${chip(TWO_LINES)}[]</paragraph>`);
            expectLines(editor, 0, 2);

            expect(pressKey(editor, "ArrowUp")).toBe(false);
            expect(getFocusPath(editor)).toEqual([ 1, 0 ]);
        });

        it("moves down from the start of a widget over its middle line to its end", async () => {
            const editor = await createEditor();
            setModelData(editor.model,
                `<paragraph>[]${chip(THREE_LINES)}</paragraph><paragraph>a</paragraph>`);
            expectLines(editor, 0, 3);

            expect(pressKey(editor, "ArrowDown")).toBe(true);
            expect(getFocusPath(editor)).toEqual([ 0, 1 ]);
        });

        it("moves up from the text after a widget over its middle line to its start", async () => {
            const editor = await createEditor();
            setModelData(editor.model, `<paragraph>ab ${chip(THREE_LINES)}cd[]</paragraph>`);
            expectLines(editor, 0, 3);

            expect(pressKey(editor, "ArrowUp")).toBe(true);
            expect(getFocusPath(editor)).toEqual([ 0, 3 ]);
        });

        it("moves down to the edge between two widgets", async () => {
            const editor = await createEditor();
            setModelData(editor.model,
                `<paragraph>[]${chip(TWO_LINES)}${chip("lorem ".repeat(4))}</paragraph>`);
            expectLines(editor, 0, 2);
            expectLines(editor, 1, 2);

            expect(pressKey(editor, "ArrowDown")).toBe(false);
            expect(getFocusPath(editor)).toEqual([ 0, 1 ]);
        });

        it("moves only the focus with Shift", async () => {
            const editor = await createEditor();
            setModelData(editor.model,
                `<paragraph>[a</paragraph><paragraph>${chip(TWO_LINES)}]</paragraph>`);

            expect(pressKey(editor, "ArrowUp", { shiftKey: true })).toBe(true);
            expect(editor.model.document.selection.anchor?.path).toEqual([ 0, 0 ]);
            expect(getFocusPath(editor)).toEqual([ 1, 0 ]);
        });

        it("leaves lines with text and other blocks to the browser", async () => {
            const editor = await createEditor();
            setModelData(editor.model,
                `<paragraph>a</paragraph><paragraph>[]${chip(TWO_LINES)}</paragraph>`);

            expect(pressKey(editor, "ArrowDown")).toBe(false);
            expect(pressKey(editor, "ArrowUp")).toBe(false);
            expect(getFocusPath(editor)).toEqual([ 1, 0 ]);
        });

        it("ignores other keys, selected widgets, ranges and blocks without widgets", async () => {
            const editor = await createEditor();
            const cases: [ string, string, KeyboardEventInit ][] = [
                [ `<paragraph>[]${chip(THREE_LINES)}</paragraph>`, "ArrowDown", { ctrlKey: true } ],
                [ `<paragraph>[]${chip(THREE_LINES)}</paragraph>`, "End", {} ],
                [ `<paragraph>[${chip(THREE_LINES)}]</paragraph>`, "ArrowDown", {} ],
                [ `<paragraph>[a${chip(THREE_LINES)}]</paragraph>`, "ArrowUp", {} ],
                [ "<paragraph>a</paragraph><paragraph>b[]</paragraph>", "ArrowUp", {} ]
            ];

            for (const [ data, key, modifiers ] of cases) {
                setModelData(editor.model, data);
                expect(pressKey(editor, key, modifiers)).toBe(false);
                expect(getModelData(editor.model)).toBe(data);
            }
        });

        it("leaves the key to the browser where the caret has no box", async () => {
            const editor = await createEditor();
            const data = `<paragraph>[a</paragraph><paragraph>${chip(TWO_LINES)}` +
                "<softBreak></softBreak>]</paragraph>";
            setModelData(editor.model, data);

            expect(pressKey(editor, "ArrowUp", { shiftKey: true })).toBe(false);
            expect(getModelData(editor.model)).toBe(data);
        });
    });

    // The paragraphs `x` and `y` around the tested lines tell a move to the next line apart from
    // Chromium's jump to the start or the end of the note.
    describe("real key presses", () => {
        it("stops on each paragraph of a widget, down and up", async () => {
            const editor = await createEditor();
            setModelData(editor.model, "<paragraph>x</paragraph><paragraph>a[]</paragraph>" +
                `<paragraph>${chip("short")}</paragraph><paragraph>${chip("short")}</paragraph>` +
                "<paragraph>b</paragraph><paragraph>y</paragraph>");

            expect(await pressKeys(editor, "ArrowDown", "ArrowDown", "ArrowDown"))
                .toEqual([ [ 2, 1 ], [ 3, 1 ], [ 4, 1 ] ]);
            expect(await pressKeys(editor, "ArrowUp", "ArrowUp", "ArrowUp"))
                .toEqual([ [ 3, 1 ], [ 2, 1 ], [ 1, 1 ] ]);
        });

        it("enters a wrapped widget on its last line, and leaves it from its first", async () => {
            const editor = await createEditor();
            setModelData(editor.model, "<paragraph>x</paragraph><paragraph>a[]</paragraph>" +
                `<paragraph>${chip(THREE_LINES)}</paragraph>` +
                "<paragraph>b</paragraph><paragraph>y</paragraph>");
            expectLines(editor, 0, 3);

            expect(await pressKeys(editor, "ArrowDown", "ArrowDown", "ArrowUp", "ArrowUp"))
                .toEqual([ [ 2, 1 ], [ 3, 1 ], [ 2, 1 ], [ 1, 0 ] ]);
        });

        it("goes on from the edge between two widgets to the line after it", async () => {
            const editor = await createEditor();
            setModelData(editor.model, "<paragraph>x</paragraph>" +
                `<paragraph>[]${chip(TWO_LINES)}${chip("lorem ".repeat(4))}</paragraph>` +
                "<paragraph>b</paragraph><paragraph>y</paragraph>");
            expectLines(editor, 1, 2);

            expect(await pressKeys(editor, "ArrowDown", "ArrowDown", "ArrowUp", "ArrowUp"))
                .toEqual([ [ 1, 2 ], [ 2, 1 ], [ 1, 2 ], [ 0, 0 ] ]);
        });

        it("moves over the middle line of a widget, and on from the line after it", async () => {
            const editor = await createEditor();
            setModelData(editor.model, "<paragraph>x</paragraph>" +
                `<paragraph>ab ${chip(THREE_LINES)}cd[]</paragraph><paragraph>y</paragraph>`);
            expectLines(editor, 0, 3);
            expect(await pressKeys(editor, "ArrowUp", "ArrowUp")).toEqual([ [ 1, 3 ], [ 0, 1 ] ]);

            setModelData(editor.model, "<paragraph>x</paragraph>" +
                `<paragraph>[]${chip(THREE_LINES)}</paragraph>` +
                "<paragraph>b</paragraph><paragraph>y</paragraph>");
            expect(await pressKeys(editor, "ArrowDown", "ArrowDown"))
                .toEqual([ [ 1, 1 ], [ 2, 1 ] ]);
        });
    });

    describe("caret inside a widget", () => {
        it("goes after the widget, or before it from above its last line", async () => {
            const editor = await createEditor();
            setModelData(editor.model,
                `<paragraph>a[]</paragraph><paragraph>${chip("short")} b</paragraph>` +
                `<paragraph>${chip(TWO_LINES)}</paragraph>`);

            pressKey(editor, "ArrowDown");
            await collapseDomSelection(getLabel(editor, 0), 2);
            expect(getFocusPath(editor)).toEqual([ 1, 1 ]);

            pressKey(editor, "ArrowDown");
            await collapseDomSelection(getLabel(editor, 1), 0);
            expect(getFocusPath(editor)).toEqual([ 2, 0 ]);
        });

        it("stays after a click, outside widgets of this editor, or in a range", async () => {
            const editor = await createEditor();
            setModelData(editor.model, `<paragraph>[]ab${chip("short")}</paragraph>`);
            const domRoot = editor.editing.view.getDomRoot() as HTMLElement;
            const outside = document.createElement("div");
            outside.textContent = "outside";
            document.body.append(outside);
            registerTestCleanup(() => outside.remove());
            // A widget of an editor inside a UI element, such as an embedded note.
            const nestedWidget = document.createElement("span");
            nestedWidget.className = "ck-widget";
            nestedWidget.textContent = "nested";
            getLabel(editor, 0).parentElement?.append(nestedWidget);

            pressKey(editor, "ArrowDown");
            await collapseDomSelection(outside.firstChild as Node, 1);
            await changeDomSelection(() => {
                const label = getLabel(editor, 0);
                document.getSelection()?.setBaseAndExtent(label, 0, label, 2);
            });
            await collapseDomSelection(getBlocks(editor)[0], 0);
            await collapseDomSelection(nestedWidget.firstChild as Node, 1);
            // Down is still the last key, so a caret inside the inline widget goes after it.
            await collapseDomSelection(getLabel(editor, 0), 1);
            expect(getFocusPath(editor)).toEqual([ 0, 3 ]);

            pressKey(editor, "ArrowDown");
            domRoot.dispatchEvent(new PointerEvent("pointerdown"));
            await collapseDomSelection(getLabel(editor, 0), 2);
            expect(getFocusPath(editor)).toEqual([ 0, 3 ]);
        });
    });
});

async function createEditor() {
    const style = document.createElement("style");
    style.textContent =
        ".ck-editor__editable { width: 30ch; padding: 0; font: 16px/20px monospace; }" +
        ".ck-editor__editable p { margin: 0 0 10px; }";
    document.head.append(style);
    registerTestCleanup(() => style.remove());

    const editor = await createTestEditor([
        Essentials, Paragraph, Bold, TestChipPlugin, InlineWidgetCaret
    ]);
    editor.editing.view.focus();
    return editor;
}

/** A `testChip` with `label` in model data, after the other `attributes`. */
function chip(label: string, attributes = "") {
    return `<testChip ${attributes}label="${label}"></testChip>`;
}

function getBlocks(editor: ClassicEditor) {
    return Array.from(editor.editing.view.getDomRoot()?.querySelectorAll("p") ?? []);
}

/** The text node of the label of the chip at `index` in the editing DOM. */
function getLabel(editor: ClassicEditor, index: number) {
    const labels = editor.editing.view.getDomRoot()?.querySelectorAll(".test-chip-label");
    return labels?.[index]?.firstChild as Node;
}

/** The children of `block`: text, the chips, the fillers, and other elements by tag. */
function describeDom(block: Element) {
    return Array.from(block.childNodes, (node) => {
        if (!(node instanceof HTMLElement)) {
            return node.textContent === INLINE_FILLER ? "inline filler" : node.textContent;
        }
        if (node.dataset.ckeFiller) {
            return "filler";
        }
        return node.classList.contains("test-chip") ? "chip" : node.tagName.toLowerCase();
    }).join(",");
}

function getFocusPath(editor: ClassicEditor) {
    return editor.model.document.selection.focus?.path;
}

/** Presses each of `keys` in the browser, and returns the path of the focus after each press. */
async function pressKeys(editor: ClassicEditor, ...keys: string[]) {
    const paths = [];
    for (const key of keys) {
        await userEvent.keyboard(`{${key}}`);
        paths.push(getFocusPath(editor));
    }
    return paths;
}

/** Checks that the chip at `index` wraps over `count` lines, as the spec expects. */
function expectLines(editor: ClassicEditor, index: number, count: number) {
    const chips = editor.editing.view.getDomRoot()?.querySelectorAll(".test-chip");
    expect(chips?.[index]?.getClientRects().length).toBe(count);
}

async function collapseDomSelection(node: Node, offset: number) {
    await changeDomSelection(() => document.getSelection()?.collapse(node, offset));
}

/** Runs `change` and waits for the `selectionchange` it causes, which the plugin handles first. */
async function changeDomSelection(change: () => void) {
    const changed = new Promise((resolve) => {
        document.addEventListener("selectionchange", resolve, { once: true });
    });
    change();
    await changed;
}
