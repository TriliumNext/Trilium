import { _getModelData as getModelData, _setModelData as setModelData, ClassicEditor, Essentials, Heading, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { installGlobMock, mockClipboard } from "../../test/globals-test-kit.js";
import BlockId, { BLOCK_ID_ATTRIBUTE, BLOCK_ID_VIEW_ATTRIBUTE } from "./block_id.js";

describe("BlockId", () => {
    let editor: ClassicEditor;
    let getActiveContextNote: ReturnType<typeof vi.fn>;
    let getReferenceLinkTitleSync: ReturnType<typeof vi.fn>;
    let clipboardWrite: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        getActiveContextNote = vi.fn(() => ({ noteId: "noteAbc" }));
        getReferenceLinkTitleSync = vi.fn(() => "Some title");
        installGlobMock({ getActiveContextNote, getReferenceLinkTitleSync });

        clipboardWrite = vi.fn(() => Promise.resolve());
        mockClipboard({ write: clipboardWrite });

        editor = await createTestEditor([Essentials, Paragraph, Heading, BlockId]);
    });

    /** The href handed to the clipboard by the last `copyBlockLink` execution. */
    function copiedHref(): string {
        return getReferenceLinkTitleSync.mock.calls[0]?.[0] as string;
    }

    it("registers the plugin, the command and the toolbar button", () => {
        expect(editor.plugins.get(BlockId)).toBeInstanceOf(BlockId);
        expect(editor.commands.get("copyBlockLink")).toBeDefined();
        expect(editor.ui.componentFactory.has("copyBlockLink")).toBe(true);
    });

    describe("conversion", () => {
        it("round-trips data-block-id through the data pipeline", () => {
            editor.setData(`<p ${BLOCK_ID_VIEW_ATTRIBUTE}="abc123">Hello</p>`);

            expect(getModelData(editor.model, { withoutSelection: true }))
                .toContain(`${BLOCK_ID_ATTRIBUTE}="abc123"`);
            expect(editor.getData()).toContain(`${BLOCK_ID_VIEW_ATTRIBUTE}="abc123"`);
        });

        it("applies to headings as well as paragraphs", () => {
            editor.setData(`<h2 ${BLOCK_ID_VIEW_ATTRIBUTE}="head-1">Title</h2>`);

            expect(editor.getData()).toContain(`${BLOCK_ID_VIEW_ATTRIBUTE}="head-1"`);
        });

        it("drops the view attribute when the model attribute is removed", () => {
            setModelData(editor.model, `<paragraph ${BLOCK_ID_ATTRIBUTE}="gone">[]Text</paragraph>`);

            editor.model.change((writer) => {
                const block = editor.model.document.getRoot()?.getChild(0);
                if (block?.is("element")) {
                    writer.removeAttribute(BLOCK_ID_ATTRIBUTE, block);
                }
            });

            expect(editor.getData()).not.toContain(BLOCK_ID_VIEW_ATTRIBUTE);
        });

        it("omits block IDs on the clipboard pipeline so a paste cannot duplicate one", () => {
            setModelData(editor.model, `[<paragraph ${BLOCK_ID_ATTRIBUTE}="copied">Text</paragraph>]`);

            const model = editor.model;
            const view = editor.data.toView(
                model.getSelectedContent(model.document.selection),
                { isClipboardPipeline: true }
            );

            expect(editor.data.processor.toData(view)).not.toContain(BLOCK_ID_VIEW_ATTRIBUTE);
            // …while the ordinary data pipeline keeps it.
            expect(editor.getData()).toContain(`${BLOCK_ID_VIEW_ATTRIBUTE}="copied"`);
        });
    });

    describe("duplicate IDs", () => {
        it("reissues a duplicate, letting the first block in document order keep the ID", () => {
            setModelData(
                editor.model,
                `<paragraph ${BLOCK_ID_ATTRIBUTE}="dup">[]First</paragraph>`
                + `<paragraph ${BLOCK_ID_ATTRIBUTE}="dup">Second</paragraph>`
            );

            const root = editor.model.document.getRoot();
            expect(root?.getChild(0)?.getAttribute(BLOCK_ID_ATTRIBUTE)).toBe("dup");

            const second = root?.getChild(1)?.getAttribute(BLOCK_ID_ATTRIBUTE);
            expect(second).toBeTruthy();
            expect(second).not.toBe("dup");
        });

        it("gives the lower half a fresh ID when a linked block is split", () => {
            setModelData(editor.model, `<paragraph ${BLOCK_ID_ATTRIBUTE}="split-me">Above[]Below</paragraph>`);

            editor.execute("enter");

            const root = editor.model.document.getRoot();
            expect(root?.childCount).toBe(2);
            expect(root?.getChild(0)?.getAttribute(BLOCK_ID_ATTRIBUTE)).toBe("split-me");
            expect(root?.getChild(1)?.getAttribute(BLOCK_ID_ATTRIBUTE)).not.toBe("split-me");
        });

        it("leaves distinct IDs untouched", () => {
            setModelData(
                editor.model,
                `<paragraph ${BLOCK_ID_ATTRIBUTE}="one">[]First</paragraph>`
                + `<paragraph ${BLOCK_ID_ATTRIBUTE}="two">Second</paragraph>`
            );

            const root = editor.model.document.getRoot();
            expect(root?.getChild(0)?.getAttribute(BLOCK_ID_ATTRIBUTE)).toBe("one");
            expect(root?.getChild(1)?.getAttribute(BLOCK_ID_ATTRIBUTE)).toBe("two");
        });

        it("ignores blocks that carry no ID", () => {
            setModelData(editor.model, "<paragraph>[]First</paragraph><paragraph>Second</paragraph>");

            expect(editor.getData()).not.toContain(BLOCK_ID_VIEW_ATTRIBUTE);
        });
    });

    describe("copyBlockLink", () => {
        it("mints an ID on demand and copies a reference link to it", () => {
            setModelData(editor.model, "<paragraph>Some text[]</paragraph>");

            editor.execute("copyBlockLink");

            const blockId = editor.model.document.getRoot()?.getChild(0)?.getAttribute(BLOCK_ID_ATTRIBUTE);
            expect(blockId).toBeTruthy();
            expect(copiedHref()).toBe(`#root/noteAbc?blockId=${blockId}`);
            expect(clipboardWrite).toHaveBeenCalledTimes(1);
        });

        it("reuses an ID the block already has", () => {
            setModelData(editor.model, `<paragraph ${BLOCK_ID_ATTRIBUTE}="existing">Text[]</paragraph>`);

            editor.execute("copyBlockLink");

            expect(editor.model.document.getRoot()?.getChild(0)?.getAttribute(BLOCK_ID_ATTRIBUTE)).toBe("existing");
            expect(copiedHref()).toBe("#root/noteAbc?blockId=existing");
        });

        it("copies both an HTML reference link and the bare href", () => {
            setModelData(editor.model, `<paragraph ${BLOCK_ID_ATTRIBUTE}="abc">Text[]</paragraph>`);

            editor.execute("copyBlockLink");

            const item = clipboardWrite.mock.calls[0]?.[0]?.[0] as ClipboardItem;
            expect(item.types).toContain("text/html");
            expect(item.types).toContain("text/plain");
        });

        it("is driven by the toolbar button", () => {
            setModelData(editor.model, "<paragraph>Text[]</paragraph>");

            const button = editor.ui.componentFactory.create("copyBlockLink") as { fire(name: string): void };
            button.fire("execute");

            expect(clipboardWrite).toHaveBeenCalledTimes(1);
        });

        it("is disabled, and does nothing, without an active note", async () => {
            installGlobMock({ getActiveContextNote: vi.fn(() => undefined), getReferenceLinkTitleSync });
            const noNoteEditor = await createTestEditor([Essentials, Paragraph, BlockId]);
            setModelData(noNoteEditor.model, "<paragraph>Text[]</paragraph>");

            expect(noNoteEditor.commands.get("copyBlockLink")?.isEnabled).toBe(false);

            noNoteEditor.execute("copyBlockLink");
            expect(clipboardWrite).not.toHaveBeenCalled();
        });
    });
});
