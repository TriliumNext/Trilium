import {
    _getModelData as getModelData, _setModelData as setModelData, BalloonEditor, BlockQuote,
    BlockToolbar, type ClassicEditor, CodeBlock, Essentials, Heading, List, type ModelNode,
    Paragraph, Table
} from "ckeditor5";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { createTestEditor, createTestEditorOf } from "../../../test/editor-kit.js";
import BlockDragHandle from "../block_drag_handle.js";
import Multicolumn from "../multicolumn/multicolumn.js";
import BlockReference from "./block_reference.js";
import { assignBlockId, type LinkedBlockChangedEvent } from "./block_reference_editing.js";

const PLUGINS = [
    Essentials, Paragraph, Heading, BlockQuote, CodeBlock, List, Table, BlockReference
];

describe("BlockReference", () => {
    describe("conversion", () => {
        it("keeps the id of every kind of block", async () => {
            const editor = await createTestEditor(PLUGINS);
            const data = [
                "<p data-trilium-block-id=\"p1\">Paragraph</p>",
                "<h2 data-trilium-block-id=\"h1\">Heading</h2>",
                "<blockquote data-trilium-block-id=\"q1\">"
                    + "<p data-trilium-block-id=\"q2\">Quote</p></blockquote>",
                "<pre><code class=\"language-plaintext\" data-trilium-block-id=\"c1\">"
                    + "code</code></pre>",
                "<ul><li data-list-item-id=\"e1\"><p data-trilium-block-id=\"l1\">Item</p></li>"
                    + "<li data-list-item-id=\"e2\">Plain item</li></ul>",
                "<figure class=\"table\" data-trilium-block-id=\"t1\">"
                    + "<table><tbody><tr><td>Cell</td></tr></tbody></table></figure>"
            ].join("");

            editor.setData(data);

            expect(editor.getData()).toBe(data);
            const heading = getEditable(editor).querySelector("[data-trilium-block-id='h1']");
            expect(heading?.tagName).toBe("H2");
        });

        it("keeps any id without a colon", async () => {
            const editor = await createTestEditor(PLUGINS);

            editor.setData(
                "<p data-trilium-block-id=\"intro &amp; more?\">A</p>"
                + "<p data-trilium-block-id=\"a:b\">B</p>"
                + "<p data-trilium-block-id=\"\">C</p>"
            );

            expect(editor.getData()).toBe(
                "<p data-trilium-block-id=\"intro &amp; more?\">A</p><p>B</p><p>C</p>"
            );
        });

        it("ignores the id on inline content", async () => {
            const editor = await createTestEditor(PLUGINS);

            editor.setData("<p><span data-trilium-block-id=\"s1\">text</span></p>");

            expect(editor.getData()).toBe("<p>text</p>");
        });
    });

    describe("assignBlockReference", () => {
        it("gives an id to the selected block and reuses it", async () => {
            const editor = await createTestEditor(PLUGINS);
            setModelData(editor.model, "<paragraph>one</paragraph><paragraph>t[]wo</paragraph>");

            const reference = editor.execute("assignBlockReference");
            const id = getBlock(editor, 1).getAttribute("blockId");

            expect(id).toMatch(/^[A-Za-z0-9]{12}$/);
            expect(reference).toEqual({ startId: id, endId: id, count: 1 });
            expect(getBlock(editor, 0).hasAttribute("blockId")).toBe(false);
            expect(editor.execute("assignBlockReference")).toEqual(reference);

            editor.execute("undo");
            expect(getBlock(editor, 1).hasAttribute("blockId")).toBe(false);
        });

        it("gives ids to the first and the last block of a range", async () => {
            const editor = await createTestEditor(PLUGINS);
            setModelData(editor.model,
                "<blockQuote><paragraph>o[ne</paragraph></blockQuote>"
                + "<paragraph>two</paragraph><paragraph>thr]ee</paragraph>"
            );
            expect(editor.commands.get("assignBlockReference")?.value).toBe(3);

            const reference = editor.execute("assignBlockReference");
            const quote = editor.model.document.getRoot()?.getChild(0);
            const first = quote?.is("element") ? quote.getChild(0) : null;

            expect(reference).toEqual({
                startId: first?.getAttribute("blockId"),
                endId: getBlock(editor, 2).getAttribute("blockId"),
                count: 3
            });
            expect(getBlock(editor, 1).hasAttribute("blockId")).toBe(false);
        });

        it("gives an id to an item of a list, which then saves as a paragraph", async () => {
            const editor = await createTestEditor(PLUGINS);
            editor.setData("<ul><li data-list-item-id=\"e1\">Item</li></ul>");
            editor.model.change((writer) => writer.setSelection(getBlock(editor, 0), "end"));

            const reference = editor.execute("assignBlockReference");

            expect(editor.getData()).toBe("<ul><li data-list-item-id=\"e1\">"
                + `<p data-trilium-block-id="${reference?.startId}">Item</p></li></ul>`);
            const item = getEditable(editor).querySelector("li > [data-trilium-block-id]");
            expect(item?.textContent).toBe("Item");
        });

        it("references a table instead of the blocks of its cells", async () => {
            const editor = await createTestEditor(PLUGINS);
            setModelData(editor.model,
                "<table><tableRow><tableCell><paragraph>[a</paragraph></tableCell>"
                + "<tableCell><paragraph>b]</paragraph></tableCell></tableRow></table>"
            );
            expect(editor.commands.get("assignBlockReference")?.value).toBe(1);

            const reference = editor.execute("assignBlockReference");

            expect(reference?.count).toBe(1);
            expect(getBlock(editor, 0).getAttribute("blockId")).toBe(reference?.startId);
        });

        it("references a block in a column of a layout, and a table there as a whole", async () => {
            const editor = await createTestEditor([ ...PLUGINS, Multicolumn ]);
            setModelData(editor.model,
                "<multicolumnLayout columnRatios=\"1-1\"><multicolumnColumn>"
                + "<paragraph>one</paragraph><paragraph>two</paragraph></multicolumnColumn>"
                + "<multicolumnColumn><table><tableRow><tableCell><paragraph>cell</paragraph>"
                + "</tableCell></tableRow></table></multicolumnColumn></multicolumnLayout>"
            );
            const layout = getBlock(editor, 0);
            const paragraph = layout.getNodeByPath([ 0, 1 ]);
            const table = layout.getNodeByPath([ 1, 0 ]);

            expect(getReferenced(editor, paragraph, "end")).toBe(paragraph);
            expect(getReferenced(editor, layout.getNodeByPath([ 1, 0, 0, 0, 0 ]), "end"))
                .toBe(table);
            expect(getReferenced(editor, layout, "on")).toBe(layout);
        });

        it("is disabled in read-only mode", async () => {
            const editor = await createTestEditor(PLUGINS);
            setModelData(editor.model, "<paragraph>[]one</paragraph>");
            const command = editor.commands.get("assignBlockReference");

            editor.enableReadOnlyMode("spec");

            expect(command?.isEnabled).toBe(false);
            expect(editor.execute("assignBlockReference")).toBeUndefined();
        });

        it("skips blocks inside an object that cannot hold an id", async () => {
            const editor = await createTestEditor(PLUGINS);
            editor.model.schema.register("frame", {
                isObject: true,
                allowWhere: "$block",
                allowContentOf: "$root"
            });
            editor.conversion.elementToElement({ model: "frame", view: "aside" });
            setModelData(editor.model, "<frame><paragraph>[]one</paragraph></frame>");

            expect(editor.commands.get("assignBlockReference")).toMatchObject({
                isEnabled: false,
                value: 0
            });
        });
    });

    describe("assignBlockId", () => {
        it("gives a block a new id outside the undo history, and returns an id it has", async () => {
            const editor = await createTestEditor(PLUGINS);
            setModelData(editor.model,
                "<paragraph>one[]</paragraph><heading1 blockId=\"a\">two</heading1>");
            editor.execute("insertText", { text: "!" });

            const id = assignBlockId(editor.model, getBlock(editor, 0));
            expect(id).toMatch(/^[A-Za-z0-9]{12}$/);
            expect(getBlock(editor, 0).getAttribute("blockId")).toBe(id);
            expect(assignBlockId(editor.model, getBlock(editor, 0))).toBe(id);
            expect(assignBlockId(editor.model, getBlock(editor, 1))).toBe("a");

            // The first undo takes back the typing, not the id.
            editor.execute("undo");
            expect(editor.getData()).toBe(
                `<p data-trilium-block-id="${id}">one</p><h2 data-trilium-block-id="a">two</h2>`);
        });
    });

    describe("duplicate ids", () => {
        it("removes the id from a pasted copy", async () => {
            const editor = await createTestEditor(PLUGINS);
            editor.setData("<p data-trilium-block-id=\"a\">one</p><p>two</p>");
            editor.model.change((writer) => writer.setSelection(getBlock(editor, 1), "end"));

            editor.model.insertContent(editor.data.parse(
                "<blockquote><p data-trilium-block-id=\"a\">one</p></blockquote>"
            ));

            expect(editor.getData()).toBe(
                "<p data-trilium-block-id=\"a\">one</p><p>two</p>"
                + "<blockquote><p>one</p></blockquote>"
            );
        });

        it("keeps the id of a block moved within one change", async () => {
            const editor = await createTestEditor(PLUGINS);
            editor.setData("<p data-trilium-block-id=\"a\">one</p><p>two</p>");

            editor.model.change((writer) => {
                const root = editor.model.document.getRoot();
                if (!root) return;
                writer.insert(writer.cloneElement(getBlock(editor, 0)), root, "end");
                writer.remove(getBlock(editor, 0));
            });

            expect(editor.getData()).toBe("<p>two</p><p data-trilium-block-id=\"a\">one</p>");
        });

        it("keeps the id with the text when Enter splits a block", async () => {
            const editor = await createTestEditor(PLUGINS);
            const split = (modelData: string) => {
                setModelData(editor.model, modelData);
                editor.execute("enter");
                return getModelData(editor.model, { withoutSelection: true });
            };

            expect(split("<paragraph blockId=\"a\">o[]ne</paragraph>")).toBe(
                "<paragraph blockId=\"a\">o</paragraph><paragraph>ne</paragraph>"
            );
            expect(split("<paragraph blockId=\"a\">one[]</paragraph>")).toBe(
                "<paragraph blockId=\"a\">one</paragraph><paragraph></paragraph>"
            );
            expect(split("<paragraph blockId=\"a\">[]one</paragraph>")).toBe(
                "<paragraph></paragraph><paragraph blockId=\"a\">one</paragraph>"
            );
            expect(split("<paragraph blockId=\"a\">[]</paragraph>")).toBe(
                "<paragraph blockId=\"a\"></paragraph><paragraph></paragraph>"
            );

            editor.execute("insertText", { text: "x" });
            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<paragraph blockId=\"a\"></paragraph><paragraph>x</paragraph>"
            );
        });

        it("keeps the first of duplicate ids in loaded content", async () => {
            const editor = await createTestEditor(PLUGINS);

            editor.setData(
                "<p data-trilium-block-id=\"a\">one</p><p data-trilium-block-id=\"a\">two</p>"
            );

            expect(editor.getData()).toBe("<p data-trilium-block-id=\"a\">one</p><p>two</p>");
        });
    });

    describe("linkedBlockChanged", () => {
        const CONTENT = "<heading1 blockId=\"h\">Intro[]</heading1>"
            + "<blockQuote blockId=\"q\"><paragraph>Quote</paragraph></blockQuote>"
            + "<paragraph>Plain</paragraph>";

        /** An editor with `modelData`, and the ids each `linkedBlockChanged` reports since. */
        async function watch(modelData = CONTENT) {
            const editor = await createTestEditor(PLUGINS);
            vi.useFakeTimers();
            onTestFinished(() => {
                vi.useRealTimers();
            });
            setModelData(editor.model, modelData);
            const reports: (string[] | null)[] = [];
            editor.plugins.get("BlockReferenceEditing").on<LinkedBlockChangedEvent>(
                "linkedBlockChanged",
                (_evt, blockIds) => reports.push(blockIds && [ ...blockIds ].sort())
            );
            vi.runAllTimers();
            reports.length = 0;
            return { editor, reports };
        }

        function type(editor: ClassicEditor, block: ModelNode) {
            editor.model.change((writer) => writer.setSelection(block, "end"));
            editor.execute("insertText", { text: "!" });
        }

        it("reports the blocks with an id whose text changed once editing pauses", async () => {
            const { editor, reports } = await watch();

            editor.execute("insertText", { text: "!" });
            vi.advanceTimersByTime(299);
            editor.execute("insertText", { text: "?" });
            vi.advanceTimersByTime(299);
            expect(reports).toStrictEqual([]);
            vi.advanceTimersByTime(1);
            expect(reports).toStrictEqual([ [ "h" ] ]);

            // A block counts for the blocks around it, and a pause reports all of them at once.
            type(editor, getBlock(editor, 1).getChild(0) as ModelNode);
            type(editor, getBlock(editor, 0));
            vi.runAllTimers();
            expect(reports).toStrictEqual([ [ "h" ], [ "h", "q" ] ]);
        });

        it("reports nothing for blocks without an id, for formatting or for a redraw", async () => {
            const { editor, reports } = await watch();

            type(editor, getBlock(editor, 2));
            editor.execute("enter");
            editor.execute("insertTable", { rows: 1, columns: 1 });
            editor.model.change((writer) => writer.setAttribute(
                "bold", true, writer.createRangeIn(getBlock(editor, 0))
            ));
            editor.editing.reconvertItem(getBlock(editor, 0));
            vi.runAllTimers();
            expect(reports).toStrictEqual([]);

            type(editor, getBlock(editor, 0));
            vi.runAllTimers();
            expect(reports).toStrictEqual([ [ "h" ] ]);
        });

        it("reports a block that gets or loses its id, or that is removed", async () => {
            const { editor, reports } = await watch(
                "<heading1 blockId=\"h\">Intro</heading1><paragraph blockId=\"p\">Text</paragraph>"
            );
            const report = (change: Parameters<typeof editor.model.change>[0]) => {
                editor.model.change(change);
                vi.runAllTimers();
                return reports.at(-1);
            };

            expect(report((writer) => writer.setAttribute("blockId", "n", getBlock(editor, 1))))
                .toStrictEqual([ "n", "p" ]);
            expect(report((writer) => writer.removeAttribute("blockId", getBlock(editor, 1))))
                .toStrictEqual([ "n" ]);
            expect(report((writer) => writer.remove(getBlock(editor, 0)))).toStrictEqual([ "h" ]);
        });

        it("reports any block once a block that holds others is inserted or removed", async () => {
            const { editor, reports } = await watch();

            type(editor, getBlock(editor, 0));
            editor.model.change((writer) => writer.remove(getBlock(editor, 1)));
            vi.runAllTimers();
            editor.model.change((writer) => writer.setSelection(getBlock(editor, 1), "end"));
            editor.execute("blockQuote");
            type(editor, getBlock(editor, 0));
            vi.runAllTimers();

            expect(reports).toStrictEqual([ null, null ]);
        });

        it("reports nothing once it is destroyed", async () => {
            const { editor } = await watch();
            const plugin = editor.plugins.get("BlockReferenceEditing");
            // `destroy()` also removes the listeners, so the report is caught where it is fired.
            const fire = vi.spyOn(plugin, "fire");

            editor.execute("insertText", { text: "!" });
            vi.runAllTimers();
            expect(fire).toHaveBeenCalledExactlyOnceWith("linkedBlockChanged", new Set([ "h" ]));
            editor.execute("insertText", { text: "!" });
            plugin.destroy();
            vi.runAllTimers();

            expect(fire).toHaveBeenCalledExactlyOnceWith("linkedBlockChanged", new Set([ "h" ]));
        });
    });

    describe("range editor", () => {
        it("gives an id to a new block at either edge, and returns the range", async () => {
            const editor = await createRangeEditor(
                "<p data-trilium-block-id=\"a\">one</p><p data-trilium-block-id=\"b\">two</p>"
            );
            const plugin = editor.plugins.get("BlockReferenceEditing");
            expect(plugin.getRange()).toEqual({ startId: "a", endId: "b" });

            editor.model.change((writer) => writer.setSelection(getBlock(editor, 1), "end"));
            editor.execute("enter");
            const endId = getBlock(editor, 2).getAttribute("blockId");
            expect(endId).toMatch(/^[A-Za-z0-9]{12}$/);
            expect(plugin.getRange()).toEqual({ startId: "a", endId });

            editor.model.change((writer) => writer.setSelection(getBlock(editor, 0), 0));
            editor.execute("enter");
            const startId = getBlock(editor, 0).getAttribute("blockId");
            expect(getBlock(editor, 1).getAttribute("blockId")).toBe("a");
            expect(getBlock(editor, 2).getAttribute("blockId")).toBe("b");
            expect(plugin.getRange()).toEqual({ startId, endId });
            expect(new Set([ startId, endId, "a", "b" ]).size).toBe(4);
        });

        it("prefers the given ids at an edge whose blocks have several", async () => {
            const editor = await createRangeEditor(
                "<blockquote data-trilium-block-id=\"q\"><p data-trilium-block-id=\"a\">one</p>"
                + "<p data-trilium-block-id=\"b\">two</p></blockquote>"
            );
            const plugin = editor.plugins.get("BlockReferenceEditing");

            expect(plugin.getRange()).toEqual({ startId: "q", endId: "q" });
            expect(plugin.getRange({ startId: "a", endId: "b" }))
                .toEqual({ startId: "a", endId: "b" });
            expect(plugin.getRange({ startId: "x", endId: "y" }))
                .toEqual({ startId: "q", endId: "q" });
        });

        it("gives an id to a table rather than to its cells", async () => {
            const editor = await createRangeEditor(
                "<figure class=\"table\"><table><tbody><tr><td>"
                + "<p data-trilium-block-id=\"c\">Cell</p></td></tr></tbody></table></figure>"
            );

            const tableId = getBlock(editor, 0).getAttribute("blockId");
            expect(tableId).toMatch(/^[A-Za-z0-9]{12}$/);
            expect(editor.plugins.get("BlockReferenceEditing").getRange())
                .toEqual({ startId: tableId, endId: tableId });
        });

        it("leaves an edge that cannot have an id, and a regular editor, without one", async () => {
            const editor = await createRangeEditor("<p>one</p>");
            editor.model.schema.register("divider", { allowIn: "$root" });
            editor.conversion.elementToElement({ model: "divider", view: "hr" });
            setModelData(editor.model, "<divider></divider>");
            expect(editor.plugins.get("BlockReferenceEditing").getRange()).toBeNull();

            const regularEditor = await createTestEditor(PLUGINS);
            regularEditor.setData("<p>one</p>");
            expect(regularEditor.getData()).toBe("<p>one</p>");
            expect(regularEditor.plugins.get("BlockReferenceEditing").getRange()).toBeNull();
        });
    });

    describe("block handle menu", () => {
        it("asks the host to open the menu for the selected blocks", async () => {
            const openHandleMenu = vi.fn();
            const editor = await createTestEditor([ ...PLUGINS, BlockDragHandle ], {
                blockReference: { openHandleMenu }
            });
            setModelData(editor.model, "<paragraph>[one</paragraph><paragraph>two]</paragraph>");
            const handle = getHandle(editor.plugins.get(BlockDragHandle).buttonView?.element);

            const rightDown = new MouseEvent("mousedown", { button: 2, cancelable: true });
            const leftDown = new MouseEvent("mousedown", { button: 0, cancelable: true });
            handle.dispatchEvent(rightDown);
            handle.dispatchEvent(leftDown);
            const contextMenu = new MouseEvent("contextmenu", { cancelable: true });
            handle.dispatchEvent(contextMenu);

            expect(rightDown.defaultPrevented).toBe(true);
            expect(leftDown.defaultPrevented).toBe(false);
            expect(contextMenu.defaultPrevented).toBe(true);
            expect(openHandleMenu).toHaveBeenCalledWith(contextMenu, 2);

            editor.enableReadOnlyMode("spec");
            handle.dispatchEvent(new MouseEvent("contextmenu", { cancelable: true }));
            expect(openHandleMenu).toHaveBeenCalledTimes(1);
        });

        it("uses the button of the block toolbar in the floating toolbar editor", async () => {
            const openHandleMenu = vi.fn();
            const editor = await createTestEditorOf(BalloonEditor, [ ...PLUGINS, BlockToolbar ], {
                blockToolbar: [ "heading" ],
                blockReference: { openHandleMenu }
            });
            setModelData(editor.model, "<paragraph>[]one</paragraph>");

            getHandle(editor.plugins.get(BlockToolbar).buttonView.element)
                .dispatchEvent(new MouseEvent("contextmenu", { cancelable: true }));

            expect(openHandleMenu).toHaveBeenCalledWith(expect.any(MouseEvent), 1);
        });

        it("keeps the browser menu away without a host for the menu", async () => {
            const editor = await createTestEditor([ ...PLUGINS, BlockDragHandle ]);
            setModelData(editor.model, "<paragraph>[one]</paragraph>");
            const handle = getHandle(editor.plugins.get(BlockDragHandle).buttonView?.element);

            const contextMenu = new MouseEvent("contextmenu", { cancelable: true });
            handle.dispatchEvent(contextMenu);

            expect(contextMenu.defaultPrevented).toBe(true);
        });

        it("does nothing in an editor without a block handle", async () => {
            const editor = await createTestEditor(PLUGINS);

            expect(editor.plugins.get(BlockReference)).toBeInstanceOf(BlockReference);
        });
    });
});

function getEditable(editor: ClassicEditor) {
    const editable = editor.ui.getEditableElement();
    if (!editable) {
        throw new Error("The editor has no editable.");
    }

    return editable;
}

async function createRangeEditor(data: string) {
    const editor = await createTestEditor(PLUGINS);
    editor.plugins.get("BlockReferenceEditing").editRange();
    editor.setData(data);
    return editor;
}

function getBlock(editor: ClassicEditor, index: number) {
    const block = editor.model.document.getRoot()?.getChild(index);
    if (!block?.is("element")) {
        throw new Error(`The editor has no block ${index}.`);
    }

    return block;
}

/** The element that gets the id when a reference is copied with `node` selected at `place`. */
function getReferenced(editor: ClassicEditor, node: ModelNode, place: "end" | "on") {
    editor.model.change((writer) => writer.setSelection(node, place));
    const id = editor.execute("assignBlockReference")?.startId;
    const root = editor.model.document.getRoot();
    const items = root ? Array.from(editor.model.createRangeIn(root).getItems()) : [];
    return items.find((item) => item.is("element") && item.getAttribute("blockId") === id);
}

function getHandle(element: HTMLElement | undefined) {
    if (!element) {
        throw new Error("The block handle is not rendered.");
    }

    return element;
}
