import {
    _setModelData as setModelData,
    Bold, ButtonView, type ClassicEditor, Essentials, HorizontalLine, IconPreviousArrow, IconText, Italic, Paragraph,
    ToolbarSeparatorView
} from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import TriliumFormatPainter from "./format_painter/format_painter.js";
import TextFormattingToolbar from "./text_formatting_toolbar.js";
import ToolbarGroupMenu, { type ToolbarGroupMenuRequest } from "./toolbar_group_menu.js";

describe("TextFormattingToolbar", () => {
    async function createEditor(extraConfig = {}) {
        const editor = await createTestEditor([Essentials, Paragraph, Bold, Italic, TextFormattingToolbar], {
            toolbar: ["textFormatting", "italic"],
            textFormattingToolbar: ["bold", "|", "italic"],
            ...extraConfig
        });
        return { editor, plugin: editor.plugins.get(TextFormattingToolbar) };
    }

    it("holds a back button, a separator and the configured items, rendered and tracked by the editor", async () => {
        const { editor, plugin } = await createEditor();
        const [back, separator, bold, rule, italic] = [...plugin.toolbarView.items];

        expect(back).toBeInstanceOf(ButtonView);
        expect(back).toMatchObject({ label: "Back", icon: IconPreviousArrow, tooltip: true });
        expect(separator).toBeInstanceOf(ToolbarSeparatorView);
        expect((bold as ButtonView).label).toBe("Bold");
        expect(rule).toBeInstanceOf(ToolbarSeparatorView);
        expect((italic as ButtonView).label).toBe("Italic");

        const element = plugin.toolbarView.element;
        expect(element).not.toBeNull();
        expect(editor.ui.focusTracker.elements).toContain(element);
    });

    it("swaps in from its button and out from the back button, keeping the editor focused", async () => {
        const { editor, plugin } = await createEditor();
        const focus = vi.spyOn(editor.editing.view, "focus");
        const button = getToolbarButton(editor, 0);
        // Marked as opening a row of its own, which the host draws a chevron for.
        expect(button).toMatchObject({ label: "Text formatting", icon: IconText, tooltip: true, class: "ck-opens-row" });
        expect(plugin.isActive).toBe(false);

        button.fire("execute");
        expect(plugin.isActive).toBe(true);
        expect(focus).toHaveBeenCalledTimes(1);

        (plugin.toolbarView.items.first as ButtonView).fire("execute");
        expect(plugin.isActive).toBe(false);
        expect(focus).toHaveBeenCalledTimes(2);
    });

    it("holds only the back button when no items are configured", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, TextFormattingToolbar], {
            toolbar: ["textFormatting"]
        });
        expect(editor.plugins.get(TextFormattingToolbar).toolbarView.items.length).toBe(1);
    });

    it("lets ToolbarGroupMenu open its groups marked asMenu", async () => {
        const requests: ToolbarGroupMenuRequest[] = [];
        const host = { show: vi.fn((request: ToolbarGroupMenuRequest) => requests.push(request)), hide: vi.fn(), destroy: vi.fn() };
        const editor = await createTestEditor([Essentials, Paragraph, Bold, Italic, TextFormattingToolbar, ToolbarGroupMenu], {
            toolbar: ["textFormatting"],
            textFormattingToolbar: [{ label: "More", icon: "text", asMenu: true, items: ["bold", "italic"] }],
            toolbarGroupMenu: { host: () => host }
        });

        const group = editor.plugins.get(TextFormattingToolbar).toolbarView.items.last as unknown as {
            buttonView: ButtonView; isOpen: boolean;
        };
        group.buttonView.fire("open");
        expect(group.isOpen).toBe(false);
        expect(requests.at(-1)?.items.map((item) => item.kind === "entry" && item.label)).toStrictEqual(["Bold", "Italic"]);
    });

    it("swaps in as text is selected, and out as the selection collapses", async () => {
        const { editor, plugin } = await createEditor();
        const focus = vi.spyOn(editor.editing.view, "focus");
        setModelData(editor.model, "<paragraph>fo[]obar</paragraph>");
        expect(plugin.isActive).toBe(false);

        select(editor, 0, 3);
        expect(plugin.isActive).toBe(true);

        // Dragging a selection handle keeps the toolbar, and so does a format applied to the text.
        select(editor, 0, 5);
        editor.execute("bold");
        expect(plugin.isActive).toBe(true);

        // Typing over the selection collapses it.
        editor.execute("insertText", { text: "x" });
        expect(plugin.isActive).toBe(false);
        expect(focus).not.toHaveBeenCalled();
    });

    it("leaves the swap to the buttons once one of them is pressed", async () => {
        const { editor, plugin } = await createEditor();
        setModelData(editor.model, "<paragraph>fo[]obar</paragraph>");
        const textFormatting = getToolbarButton(editor, 0);
        const back = plugin.toolbarView.items.first as ButtonView;

        // Opened from its button, the toolbar outlasts a selection made and collapsed.
        textFormatting.fire("execute");
        select(editor, 0, 3);
        select(editor, 1, 1);
        expect(plugin.isActive).toBe(true);
        back.fire("execute");

        // Closed from the back button over a selection, the toolbar waits for the next selection.
        select(editor, 0, 3);
        expect(plugin.isActive).toBe(true);
        back.fire("execute");
        select(editor, 0, 4);
        expect(plugin.isActive).toBe(false);
        select(editor, 2, 2);
        select(editor, 0, 2);
        expect(plugin.isActive).toBe(true);
    });

    it("does not swap in for a selected object, which holds no text to format", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, Bold, HorizontalLine, TextFormattingToolbar], {
            toolbar: ["textFormatting"],
            textFormattingToolbar: ["bold"]
        });
        const plugin = editor.plugins.get(TextFormattingToolbar);
        setModelData(editor.model, "<paragraph>fo[]obar</paragraph><horizontalLine></horizontalLine>");

        editor.model.change((writer) => writer.setSelection(editor.model.document.getRoot()?.getChild(1) ?? null, "on"));
        expect(plugin.isActive).toBe(false);

        // Text selected from there still swaps it in.
        select(editor, 0, 3);
        expect(plugin.isActive).toBe(true);
    });

    it("stays while the format painter is armed, so its button can apply or cancel it", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, Bold, TriliumFormatPainter, TextFormattingToolbar], {
            toolbar: ["textFormatting"],
            textFormattingToolbar: ["formatPainter"]
        });
        const plugin = editor.plugins.get(TextFormattingToolbar);
        setModelData(editor.model, "<paragraph>foo bar</paragraph>");
        select(editor, 0, 3);
        expect(plugin.isActive).toBe(true);

        const painter = plugin.toolbarView.items.get(2) as ButtonView;
        painter.fire("execute");
        select(editor, 5, 5);
        expect(plugin.isActive).toBe(true);

        // Painting disarms it, and the caret it leaves takes the toolbar with it.
        editor.editing.view.getDomRoot()?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        expect(plugin.isActive).toBe(false);
    });

    it("does not follow the selection when no items are configured", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, TextFormattingToolbar], {
            toolbar: ["textFormatting"]
        });
        setModelData(editor.model, "<paragraph>fo[]obar</paragraph>");
        select(editor, 0, 3);
        expect(editor.plugins.get(TextFormattingToolbar).isActive).toBe(false);
    });

    it("destroys its toolbar with the editor", async () => {
        const { editor, plugin } = await createEditor();
        const destroy = vi.spyOn(plugin.toolbarView, "destroy");
        await editor.destroy();
        expect(destroy).toHaveBeenCalled();
    });
});

/** Selects from `start` to `end` in the first paragraph, which is a caret where they are equal. */
function select(editor: ClassicEditor, start: number, end: number) {
    editor.model.change((writer) => {
        const paragraph = editor.model.document.getRoot()?.getChild(0);
        if (!paragraph) {
            throw new Error("expected a paragraph");
        }
        writer.setSelection(writer.createRange(
            writer.createPositionAt(paragraph, start), writer.createPositionAt(paragraph, end)
        ));
    });
}

function getToolbarButton(editor: ClassicEditor, index: number) {
    const item = editor.ui.view.toolbar.items.get(index);
    if (!(item instanceof ButtonView)) {
        throw new Error(`toolbar item ${index} is not a button`);
    }
    return item;
}
