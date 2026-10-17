import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    _WIDGET_TYPE_AROUND_SELECTION_ATTRIBUTE as TYPE_AROUND_ATTRIBUTE,
    type ClassicEditor,
    Essentials,
    HorizontalLine,
    MentionEditing,
    Paragraph,
    Table,
    Widget
} from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor, destroyTrackedEditors, pressKey } from "../../../test/editor-kit.js";
import { installGlobMock } from "../../../test/globals-test-kit.js";
import TriliumMentionUI from "../mention/trilium_mention_ui.js";
import type { MentionHostedList } from "../mention/types.js";
import ContentEmbed from "./content_embed.js";
import ContentEmbedCaret from "./content_embed_caret.js";

const EMBED = "<contentEmbed boxSize=\"medium\" noteId=\"n1\"></contentEmbed>";
const CAPTIONED_EMBED = "<contentEmbed boxSize=\"medium\" noteId=\"n1\">"
    + "<caption>Caption</caption></contentEmbed>";
const CAPTIONED_EMBED_AT_START = "<contentEmbed boxSize=\"medium\" noteId=\"n1\">"
    + "<caption>[]Caption</caption></contentEmbed>";
const AB = "<paragraph>ab</paragraph>";
const CD = "<paragraph>cd</paragraph>";
const HR = "<horizontalLine></horizontalLine>";
const TEXT_PLUGINS = [
    Essentials, Paragraph, Widget, HorizontalLine, ContentEmbed, ContentEmbedCaret
];

describe("ContentEmbedCaret entering an embed", () => {
    let editor: ClassicEditor;
    let enterContentEmbed: ReturnType<typeof vi.fn<(embed: HTMLElement, edge: string) => boolean>>;

    beforeEach(async () => {
        enterContentEmbed = vi.fn(() => true);
        installGlobMock({
            getComponentByEl: () => ({ loadEmbeddedNote: vi.fn(), enterContentEmbed })
        });
        editor = await createTestEditor(TEXT_PLUGINS);
    });

    it("enters the embed beside the caret with Left and Right", () => {
        setModelData(editor.model, `<paragraph>ab[]</paragraph>${EMBED}<paragraph>cd</paragraph>`);
        expect(pressKey(editor, "ArrowRight")).toBe(true);
        expect(enterContentEmbed).toHaveBeenLastCalledWith(getEmbedDom(editor), "start");

        setModelData(editor.model, `<paragraph>ab</paragraph>${EMBED}<paragraph>[]cd</paragraph>`);
        expect(pressKey(editor, "ArrowLeft")).toBe(true);
        expect(enterContentEmbed).toHaveBeenLastCalledWith(getEmbedDom(editor), "end");

        enterContentEmbed.mockClear();
        setModelData(editor.model, `<paragraph>a[]b</paragraph>${EMBED}`);
        expect(pressKey(editor, "ArrowRight")).toBe(false);
        expect(pressKey(editor, "Enter")).toBe(false);
        expect(enterContentEmbed).not.toHaveBeenCalled();
    });

    it("enters with Up and Down only from the line next to the embed", () => {
        setModelData(editor.model, `<paragraph>a<softBreak></softBreak>b[]c</paragraph>${EMBED}`);
        expect(pressKey(editor, "ArrowDown")).toBe(true);
        expect(enterContentEmbed).toHaveBeenLastCalledWith(getEmbedDom(editor), "start");

        setModelData(editor.model, `${EMBED}<paragraph>a[]b<softBreak></softBreak>c</paragraph>`);
        expect(pressKey(editor, "ArrowUp")).toBe(true);
        expect(enterContentEmbed).toHaveBeenLastCalledWith(getEmbedDom(editor), "end");

        enterContentEmbed.mockClear();
        setModelData(editor.model, `<paragraph>a[]b<softBreak></softBreak>c</paragraph>${EMBED}`);
        expect(pressKey(editor, "ArrowDown")).toBe(false);
        setModelData(editor.model, `${EMBED}<paragraph>a<softBreak></softBreak>b[]c</paragraph>`);
        expect(pressKey(editor, "ArrowUp")).toBe(false);
        setModelData(editor.model, `<paragraph>ab[]</paragraph><paragraph>cd</paragraph>${EMBED}`);
        expect(pressKey(editor, "ArrowDown")).toBe(false);
        setModelData(editor.model, `<paragraph>ab[]</paragraph>${HR}${EMBED}`);
        expect(pressKey(editor, "ArrowDown")).toBe(false);
        expect(enterContentEmbed).not.toHaveBeenCalled();
    });

    it("enters from the fake caret beside a selected embed, and forward from the embed", () => {
        setModelData(editor.model, `<paragraph>ab</paragraph>[${EMBED}]<paragraph>cd</paragraph>`);
        setTypeAround(editor, "before");
        expect(pressKey(editor, "ArrowDown")).toBe(true);
        expect(enterContentEmbed).toHaveBeenLastCalledWith(getEmbedDom(editor), "start");

        setTypeAround(editor, "after");
        expect(pressKey(editor, "ArrowLeft")).toBe(true);
        expect(enterContentEmbed).toHaveBeenLastCalledWith(getEmbedDom(editor), "end");

        setTypeAround(editor, null);
        expect(pressKey(editor, "ArrowRight")).toBe(true);
        expect(enterContentEmbed).toHaveBeenLastCalledWith(getEmbedDom(editor), "start");

        enterContentEmbed.mockClear();
        expect(pressKey(editor, "ArrowUp")).toBe(false);
        setTypeAround(editor, "after");
        expect(pressKey(editor, "ArrowDown")).toBe(false);
        setModelData(editor.model, "<paragraph>ab</paragraph>[<horizontalLine></horizontalLine>]");
        expect(pressKey(editor, "ArrowDown")).toBe(false);
        expect(enterContentEmbed).not.toHaveBeenCalled();
    });

    it("enters an embed with a caption from below only through its caption", () => {
        setModelData(editor.model, `<paragraph>ab</paragraph>${CAPTIONED_EMBED_AT_START}`);
        expect(pressKey(editor, "ArrowLeft")).toBe(true);
        expect(enterContentEmbed).toHaveBeenLastCalledWith(getEmbedDom(editor), "end");
        expect(pressKey(editor, "ArrowUp")).toBe(true);
        expect(enterContentEmbed).toHaveBeenCalledTimes(2);

        enterContentEmbed.mockClear();
        setModelData(editor.model, AB + CAPTIONED_EMBED_AT_START.replace("[]C", "C[]"));
        expect(pressKey(editor, "ArrowLeft")).toBe(false);
        expect(pressKey(editor, "ArrowDown")).toBe(false);
        setModelData(editor.model, `${CAPTIONED_EMBED}<paragraph>[]cd</paragraph>`);
        expect(pressKey(editor, "ArrowLeft")).toBe(false);
        expect(pressKey(editor, "ArrowUp")).toBe(false);
        setModelData(editor.model, `<paragraph>ab</paragraph>[${CAPTIONED_EMBED}]`);
        setTypeAround(editor, "after");
        expect(pressKey(editor, "ArrowUp")).toBe(false);
        expect(enterContentEmbed).not.toHaveBeenCalled();

        setModelData(editor.model, `<paragraph>ab[]</paragraph>${CAPTIONED_EMBED}`);
        expect(pressKey(editor, "ArrowDown")).toBe(true);
        expect(enterContentEmbed).toHaveBeenLastCalledWith(getEmbedDom(editor), "start");
    });

    it("enters from the caption while the caption has the focus", () => {
        setModelData(editor.model, AB + CAPTIONED_EMBED_AT_START);
        expect(pressFocusedKey(editor, "ArrowLeft")).toBe(true);
        expect(enterContentEmbed).toHaveBeenLastCalledWith(getEmbedDom(editor), "end");
    });

    it("leaves the key to the editor when the embed takes no caret", () => {
        enterContentEmbed.mockReturnValue(false);
        setModelData(editor.model, `<paragraph>ab[]</paragraph>${EMBED}`);
        expect(pressKey(editor, "ArrowRight")).toBe(false);
        expect(enterContentEmbed).toHaveBeenCalledOnce();

        installGlobMock({ getComponentByEl: () => ({ loadEmbeddedNote: vi.fn() }) });
        expect(pressKey(editor, "ArrowRight")).toBe(false);
    });

    it("ignores modified keys, a read-only editor and a selection of text", () => {
        setModelData(editor.model, `<paragraph>ab[]</paragraph>${EMBED}`);
        for (const modifier of [ "shiftKey", "ctrlKey", "altKey", "metaKey", "isComposing" ]) {
            expect(pressKey(editor, "ArrowRight", { [modifier]: true })).toBe(false);
        }

        editor.enableReadOnlyMode("spec");
        expect(pressKey(editor, "ArrowRight")).toBe(false);
        editor.disableReadOnlyMode("spec");

        setModelData(editor.model, `<paragraph>[ab]</paragraph>${EMBED}`);
        expect(pressKey(editor, "ArrowRight")).toBe(false);
        expect(enterContentEmbed).not.toHaveBeenCalled();

        setModelData(editor.model, `<paragraph>ab[]</paragraph>${EMBED}`);
        expect(pressKey(editor, "ArrowRight")).toBe(true);
    });

    it("leaves the keys of the editor in the embed alone", () => {
        setModelData(editor.model, `<paragraph>ab</paragraph>[${EMBED}]`);
        const nestedRoot = document.createElement("div");
        nestedRoot.tabIndex = -1;
        getEmbedContent(editor).append(nestedRoot);

        const event = new KeyboardEvent("keydown", {
            key: "ArrowDown", bubbles: true, cancelable: true
        });
        nestedRoot.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(enterContentEmbed).not.toHaveBeenCalled();
        expect(pressKey(editor, "ArrowDown")).toBe(true);
    });

    it("follows the screen in right-to-left content", async () => {
        const rtlEditor = await createTestEditor(TEXT_PLUGINS, { language: { content: "ar" } });
        setModelData(rtlEditor.model, `<paragraph>ab[]</paragraph>${EMBED}`);
        expect(pressKey(rtlEditor, "ArrowRight")).toBe(false);
        expect(pressKey(rtlEditor, "ArrowLeft")).toBe(true);
        expect(enterContentEmbed).toHaveBeenLastCalledWith(getEmbedDom(rtlEditor), "start");
    });
});

describe("ContentEmbedCaret leaving an embed", () => {
    let editor: ClassicEditor;
    let plugin: ContentEmbedCaret;

    beforeEach(async () => {
        installGlobMock({ getComponentByEl: () => ({ loadEmbeddedNote: vi.fn() }) });
        editor = await createTestEditor(TEXT_PLUGINS);
        plugin = editor.plugins.get(ContentEmbedCaret);
    });

    // Destroying a focused editor with an embed selected reads the `glob` mock, which the global
    // cleanups remove first.
    afterEach(() => destroyTrackedEditors());

    it("focuses the editor with the caret in the text beside the embed", () => {
        setModelData(editor.model, `<paragraph>ab</paragraph>${EMBED}<paragraph>cd</paragraph>`);
        expect(plugin.leaveEmbed(getEmbedContent(editor), "end")).toBe(true);
        expect(getModelData(editor.model)).toBe(`${AB}${EMBED}<paragraph>[]cd</paragraph>`);
        expect(editor.editing.view.document.isFocused).toBe(true);

        expect(plugin.leaveEmbed(getEmbedContent(editor), "start")).toBe(true);
        expect(getModelData(editor.model)).toBe(`<paragraph>ab[]</paragraph>${EMBED}${CD}`);
    });

    it("shows the fake caret beside an embed with no text beside it", () => {
        setModelData(editor.model, AB + EMBED + HR);
        expect(plugin.leaveEmbed(getEmbedContent(editor), "end")).toBe(true);
        expect(editor.model.document.selection.getSelectedElement()?.name).toBe("contentEmbed");
        expect(editor.model.document.selection.getAttribute(TYPE_AROUND_ATTRIBUTE)).toBe("after");

        setModelData(editor.model, `${EMBED}<paragraph>ab</paragraph>`);
        expect(plugin.leaveEmbed(getEmbedContent(editor), "start")).toBe(true);
        expect(editor.model.document.selection.getSelectedElement()?.name).toBe("contentEmbed");
        expect(editor.model.document.selection.getAttribute(TYPE_AROUND_ATTRIBUTE)).toBe("before");
    });

    it("scrolls to the fake caret below an embed taller than the window", () => {
        installGlobMock({
            getComponentByEl: () => ({
                loadEmbeddedNote: (_noteId: string, wrapper: HTMLElement) => {
                    const content = document.createElement("div");
                    content.style.height = `${window.innerHeight * 3}px`;
                    wrapper.append(content);
                }
            })
        });
        setModelData(editor.model, AB + EMBED);
        // As after reading down to the end of the embed, its top is above the window.
        window.scrollTo(0, document.documentElement.scrollHeight);

        expect(plugin.leaveEmbed(getEmbedContent(editor), "end")).toBe(true);
        const fakeCaret = getEmbedDom(editor).querySelector(
            ":scope > .ck-widget__type-around > .ck-widget__type-around__fake-caret"
        );
        const rect = fakeCaret?.getBoundingClientRect();
        expect(rect?.top).toBeGreaterThanOrEqual(0);
        expect(rect?.bottom).toBeLessThanOrEqual(window.innerHeight);
    });

    it("puts the caret in the caption below the content", () => {
        setModelData(editor.model, AB + CAPTIONED_EMBED + CD);
        expect(plugin.leaveEmbed(getEmbedContent(editor), "end")).toBe(true);
        expect(getModelData(editor.model)).toBe(
            AB + CAPTIONED_EMBED.replace(">Caption", ">[]Caption") + CD
        );

        expect(plugin.leaveEmbed(getEmbedContent(editor), "start")).toBe(true);
        expect(getModelData(editor.model))
            .toBe(`<paragraph>ab[]</paragraph>${CAPTIONED_EMBED}${CD}`);
    });

    it("returns false for an element outside its embeds", () => {
        setModelData(editor.model, `<paragraph>[]ab</paragraph>${EMBED}`);
        expect(plugin.leaveEmbed(document.body, "end")).toBe(false);
        expect(getModelData(editor.model)).toBe(`<paragraph>[]ab</paragraph>${EMBED}`);
    });
});

describe("ContentEmbedCaret as the editor of an embed", () => {
    let editor: ClassicEditor;
    let plugin: ContentEmbedCaret;

    beforeEach(async () => {
        installGlobMock({ getComponentByEl: () => ({ loadEmbeddedNote: vi.fn() }) });
        editor = await createTestEditor(TEXT_PLUGINS);
        plugin = editor.plugins.get(ContentEmbedCaret);
    });

    /** The edge that the plugin of `target` reports for `key` pressed in its editing root. */
    function getEdge(key: string, init: KeyboardEventInit = {}, target = editor) {
        const root = getDomRoot(target);
        let edge: string | null | undefined;
        root.addEventListener("keydown", (event) => {
            edge = target.plugins.get(ContentEmbedCaret).getEdgeLeftBy(event);
        }, { once: true });
        root.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
        return edge;
    }

    it("focuses the editor with the caret at either edge of its content", () => {
        editor.setData("<p>ab</p><p>cd</p>");
        plugin.focusAt("start");
        expect(getModelData(editor.model)).toBe(`<paragraph>[]ab</paragraph>${CD}`);
        expect(editor.editing.view.document.isFocused).toBe(true);

        plugin.focusAt("end");
        expect(getModelData(editor.model)).toBe(`${AB}<paragraph>cd[]</paragraph>`);
    });

    it("shows the fake caret outside an object at the edge it focuses", () => {
        editor.setData("<hr><p>ab</p><hr>");
        plugin.focusAt("start");
        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            HR + AB + HR
        );
        expect(editor.model.document.selection.getSelectedElement()?.index).toBe(0);
        expect(editor.model.document.selection.getAttribute(TYPE_AROUND_ATTRIBUTE)).toBe("before");

        plugin.focusAt("end");
        expect(editor.model.document.selection.getSelectedElement()?.index).toBe(2);
        expect(editor.model.document.selection.getAttribute(TYPE_AROUND_ATTRIBUTE)).toBe("after");
    });

    it("leaves by Left and Right at the edges of the content", () => {
        setModelData(editor.model, "<paragraph>[]ab</paragraph><paragraph>cd</paragraph>");
        expect(getEdge("ArrowLeft")).toBe("start");
        expect(getEdge("ArrowRight")).toBe(null);
        setModelData(editor.model, "<paragraph>ab</paragraph><paragraph>c[]d</paragraph>");
        expect(getEdge("ArrowRight")).toBe(null);
        setModelData(editor.model, "<paragraph>ab</paragraph><paragraph>cd[]</paragraph>");
        expect(getEdge("ArrowRight")).toBe("end");
        expect(getEdge("ArrowLeft")).toBe(null);
        expect(getEdge("Enter")).toBe(null);
    });

    it("leaves by Up and Down from the first and the last line", () => {
        setModelData(editor.model, "<paragraph>a[]b<softBreak></softBreak>cd</paragraph>");
        expect(getEdge("ArrowUp")).toBe("start");
        expect(getEdge("ArrowDown")).toBe(null);
        setModelData(editor.model, "<paragraph>ab<softBreak></softBreak>c[]d</paragraph>");
        expect(getEdge("ArrowUp")).toBe(null);
        expect(getEdge("ArrowDown")).toBe("end");
        setModelData(editor.model, "<paragraph>a[]b</paragraph><paragraph>cd</paragraph>");
        expect(getEdge("ArrowDown")).toBe(null);
        setModelData(editor.model, "<paragraph>ab[]</paragraph><horizontalLine></horizontalLine>");
        expect(getEdge("ArrowDown")).toBe(null);
    });

    it("measures the lines of a wrapped paragraph", () => {
        getDomRoot(editor).style.width = "120px";
        const text = "one two three four five six seven eight nine ten";
        editor.setData(`<p>${text}</p>`);
        const paragraph = editor.model.document.getRoot()?.getChild(0);
        if (!paragraph) {
            throw new Error("Expected a paragraph.");
        }

        editor.model.change((writer) => writer.setSelection(paragraph, 1));
        expect(getEdge("ArrowUp")).toBe("start");
        expect(getEdge("ArrowDown")).toBe(null);
        editor.model.change((writer) => writer.setSelection(paragraph, text.length - 1));
        expect(getEdge("ArrowUp")).toBe(null);
        expect(getEdge("ArrowDown")).toBe("end");
    });

    it("leaves from the last row of a table that has the focus", async () => {
        const tableEditor = await createTestEditor([ ...TEXT_PLUGINS, Table ]);
        const tablePlugin = tableEditor.plugins.get(ContentEmbedCaret);
        tableEditor.setData("<p>ab</p><table><tr><td>cd</td><td>ef</td></tr></table>");
        const cell = tableEditor.model.document.getRoot()?.getNodeByPath([ 1, 0, 1, 0 ]);
        if (!cell) {
            throw new Error("Expected a paragraph in the last cell.");
        }
        tableEditor.model.change((writer) => writer.setSelection(cell, 1));

        let edge: string | null = null;
        const onKeyDown = (event: KeyboardEvent) => {
            edge = tablePlugin.getEdgeLeftBy(event);
        };
        document.addEventListener("keydown", onKeyDown, { capture: true });
        pressFocusedKey(tableEditor, "ArrowDown");
        document.removeEventListener("keydown", onKeyDown, { capture: true });
        expect(edge).toBe("end");
    });

    it("leaves from a selected object at the edge, unless the fake caret is inside", () => {
        setModelData(editor.model, "<paragraph>ab</paragraph>[<horizontalLine></horizontalLine>]");
        expect(getEdge("ArrowDown")).toBe("end");
        expect(getEdge("ArrowUp")).toBe(null);
        setTypeAround(editor, "after");
        expect(getEdge("ArrowRight")).toBe("end");
        setTypeAround(editor, "before");
        expect(getEdge("ArrowDown")).toBe(null);
        setModelData(editor.model, "[<horizontalLine></horizontalLine>]<paragraph>ab</paragraph>");
        expect(getEdge("ArrowDown")).toBe(null);
        expect(getEdge("ArrowLeft")).toBe("start");
    });

    it("stays in a table whose last cell ends with an object", async () => {
        const tableEditor = await createTestEditor([ ...TEXT_PLUGINS, Table ]);
        setModelData(tableEditor.model, "<table>"
            + "<tableRow><tableCell><paragraph>a[]</paragraph></tableCell></tableRow>"
            + `<tableRow><tableCell>${HR}</tableCell></tableRow></table>`);
        expect(getEdge("ArrowDown", {}, tableEditor)).toBe(null);
    });

    it("leaves the arrow keys to an open mention list", async () => {
        const list = {
            element: null as HTMLElement | null,
            show: () => { list.element = document.body; },
            hide: () => { list.element = null; },
            handleKeyDown: () => true
        } satisfies MentionHostedList;
        const mentionEditor = await createTestEditor(
            [ ...TEXT_PLUGINS, MentionEditing, TriliumMentionUI ],
            { mention: { feeds: [], hostedFeeds: [ { marker: "/", list: () => list } ] } }
        );
        setModelData(mentionEditor.model, "<paragraph>[]</paragraph>");
        mentionEditor.model.change((writer) => {
            mentionEditor.model.insertContent(writer.createText("/"));
        });

        expect(list.element).not.toBeNull();
        expect(getEdge("ArrowDown", {}, mentionEditor)).toBe(null);
        expect(getEdge("ArrowRight", {}, mentionEditor)).toBe(null);
        list.hide();
        expect(getEdge("ArrowDown", {}, mentionEditor)).toBe("end");
    });

    it("ignores modified keys, a selection of text and keys from other elements", () => {
        setModelData(editor.model, "<paragraph>ab[]</paragraph>");
        expect(getEdge("ArrowRight", { shiftKey: true })).toBe(null);
        const undispatched = new KeyboardEvent("keydown", { key: "ArrowRight" });
        expect(plugin.getEdgeLeftBy(undispatched)).toBe(null);
        setModelData(editor.model, "<paragraph>[ab]</paragraph>");
        expect(getEdge("ArrowRight")).toBe(null);
    });
});

/**
 * Focuses `editor` and presses `key` in the element that takes the focus, such as a caption or a
 * table cell, and returns whether a listener prevented it.
 */
function pressFocusedKey(editor: ClassicEditor, key: string) {
    editor.editing.view.focus();
    const target = document.activeElement;
    if (!(target instanceof HTMLElement) || !getDomRoot(editor).contains(target)) {
        throw new Error("Expected the focus in the editor.");
    }
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
}

function setTypeAround(editor: ClassicEditor, side: "before" | "after" | null) {
    editor.model.change((writer) => {
        if (side) {
            writer.setSelectionAttribute(TYPE_AROUND_ATTRIBUTE, side);
        } else {
            writer.removeSelectionAttribute(TYPE_AROUND_ATTRIBUTE);
        }
    });
}

function getDomRoot(editor: ClassicEditor) {
    const root = editor.editing.view.getDomRoot();
    if (!root) {
        throw new Error("Expected the editing root.");
    }
    return root;
}

function getEmbedDom(editor: ClassicEditor) {
    const embed = getDomRoot(editor).querySelector<HTMLElement>("figure.include-note");
    if (!embed) {
        throw new Error("Expected a rendered embed.");
    }
    return embed;
}

/** An element in the content of the rendered embed, as the editor of the embed is. */
function getEmbedContent(editor: ClassicEditor) {
    const wrapper = getEmbedDom(editor).querySelector<HTMLElement>(".include-note-wrapper");
    if (!wrapper) {
        throw new Error("Expected the wrapper of the embed.");
    }
    return wrapper;
}
