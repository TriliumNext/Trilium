import {
    _getModelData as getModelData, _setModelData as setModelData, Alignment, BlockQuote, Bold, Code,
    CodeBlock, type Editor, Essentials, Heading, HorizontalLine, Image, ImageCaption, ImageInline,
    Indent, IndentBlock, Italic, Link, List, type ModelElement, Paragraph, Table, TableCaption
} from "ckeditor5";

import Admonition from "../src/plugins/admonition/admonition.js";
import Collapsible from "../src/plugins/collapsible/collapsible.js";
import CollapsibleHeadings from "../src/plugins/collapsible_headings/collapsible_headings.js";
import CollapsibleListItems from "../src/plugins/collapsible_list_items.js";
import KeepViewMappings from "../src/plugins/keep_view_mappings.js";
import Multicolumn from "../src/plugins/multicolumn/multicolumn.js";
import SortSelection from "../src/plugins/sort_selection/sort_selection.js";
import Tabs from "../src/plugins/tabs/tabs.js";
import TriliumVim, { type VimConfig } from "../src/plugins/vim/vim.js";
import type VimAdapter from "../src/plugins/vim/vim_adapter.js";
import { createTestEditor } from "./editor-kit.js";
import { TestBoxPlugin } from "./fixture-plugins.js";
import { HEADING_OPTIONS } from "./headings-kit.js";

type Plugins = NonNullable<Parameters<typeof createTestEditor>[0]>;

/** The plugins of the editors of the Vim specs: the structures a text note has. */
export const VIM_PLUGINS: Plugins = [
    Essentials, Paragraph, Heading, Bold, Italic, Code, Link, List, BlockQuote, CodeBlock, Table,
    TableCaption, HorizontalLine, Image, ImageCaption, ImageInline, Indent, IndentBlock, Alignment,
    Admonition, Collapsible, CollapsibleHeadings, CollapsibleListItems, Multicolumn, Tabs,
    SortSelection, TestBoxPlugin, KeepViewMappings, TriliumVim
];

/** An editor with Vim mode on, and the content `data` in the model data format. */
export async function createVimEditor(
    data?: string, config: VimConfig = {}, plugins: Plugins = [],
        editorConfig: Record<string, unknown> = {}
) {
    const editor = await createTestEditor([ ...VIM_PLUGINS, ...plugins ], {
        heading: { options: HEADING_OPTIONS },
        vim: { enabled: true, ...config },
        ...editorConfig
    });
    if (data !== undefined) {
        setVimData(editor, data);
    }
    return editor;
}

/**
 * Sets the content of `editor`, with the selection that `data` marks with `[]`. A `·` is a space
 * that the data parser would collapse, such as one that starts a paragraph.
 */
export function setVimData(editor: Editor, data: string) {
    setModelData(editor.model, data);
    restoreSpaces(editor);
    editor.commands.get("undo")?.clearStack();
    if (editor.plugins.get(TriliumVim).isActive) {
        getAdapter(editor).operation(() => undefined);
    }
}

/** The content of `editor` in the model data format, with the selection. */
export function getVimData(editor: Editor, options: { withoutSelection?: boolean } = {}) {
    return getModelData(editor.model, options);
}

/**
 * The content of `editor` without the selection, with the list item IDs renamed `a`, `b`, `c`, …
 * in the order they first come, since new items get random ones.
 */
export function getContent(editor: Editor): string {
    const ids = new Map<string, string>();
    return getModelData(editor.model, { withoutSelection: true }).replace(/listItemId="([^"]*)"/g,
        (_match, id: string) => {
        if (!ids.has(id)) {
            ids.set(id, String.fromCharCode(97 + ids.size));
        }
        return `listItemId="${ids.get(id)}"`;
    });
}

/** A list item paragraph in the model data format. */
export function item(text: string, id: string, indent = 0, type = "bulleted") {
    const attributes = `listIndent="${indent}" listItemId="${id}" listType="${type}"`;
    return `<paragraph ${attributes}>${text}</paragraph>`;
}

/** Paragraphs in the model data format, one per text. */
export function paragraphs(...texts: string[]) {
    return texts.map((text) => `<paragraph>${text}</paragraph>`).join("");
}

/** The adapter that the Vim engine drives in `editor`. */
export function getAdapter(editor: Editor): VimAdapter {
    const session = (
        editor.plugins.get(TriliumVim) as unknown as {
        session: { adapter: VimAdapter } | null }).session;
    if (!session) {
        throw new Error("Vim mode is off.");
    }
    return session.adapter;
}

/** The cursor of the engine, as `line:ch`. */
export function getCursor(editor: Editor): string {
    const cursor = getAdapter(editor).getCursor();
    return `${cursor.line}:${cursor.ch}`;
}

/** The lines of the note as the engine reads them, joined with `|`. */
export function getLines(editor: Editor): string {
    const adapter = getAdapter(editor);
    const lines: string[] = [];
    for (let line = 0; line <= adapter.lastLine(); line++) {
        lines.push(adapter.getLine(line));
    }
    return lines.join("|");
}

/** The status of the Vim mode of `editor`. */
export function getStatus(editor: Editor) {
    return editor.plugins.get(TriliumVim).status;
}

/**
 * Presses `keys`, written as Vim writes them (`dd`, `<Esc>`, `<C-r>`, `<CR>`), in the editing root.
 * Returns whether the last key was taken.
 */
export function press(editor: Editor, keys: string): boolean {
    let isTaken = false;
    for (const key of splitKeys(keys)) {
        isTaken = dispatchKey(editor, key);
    }
    return isTaken;
}

/**
 * Types `text` as the browser would in Insert mode: each character is a key that the editor
 * inserts unless a listener takes it.
 */
export function typeText(editor: Editor, text: string) {
    for (const character of text) {
        if (!dispatchKey(editor, character)) {
            if (character === "\n") {
                editor.execute("enter");
            } else {
                editor.execute("insertText", { text: character });
            }
        }
    }
}

/** The keys of `keys`, each a character or a `<…>` name. */
export function splitKeys(keys: string): string[] {
    return keys.match(/<[^<>]+>|./gsu) ?? [];
}

const SPECIAL_KEYS: Record<string, string> = {
    Esc: "Escape", CR: "Enter", BS: "Backspace", Del: "Delete", Tab: "Tab", Space: " ",
    Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft", Right: "ArrowRight", Home: "Home",
    End: "End", PageUp: "PageUp", PageDown: "PageDown", lt: "<"
};

const KEY_CODES: Record<string, number> = {
    Escape: 27, Enter: 13, Backspace: 8, Delete: 46, Tab: 9, " ": 32, ArrowUp: 38, ArrowDown: 40,
    ArrowLeft: 37, ArrowRight: 39
};

/**
 * Dispatches the keydown of `key` in the open command line, or else in the focused editable of
 * `editor`.
 */
function dispatchKey(editor: Editor, key: string): boolean {
    const init = getKeyInit(key);
    const input = getStatus(editor).commandLine?.element.querySelector("input");
    if (input) {
        typeInInput(input, init);
        return true;
    }
    const event = createKeyEvent("keydown", init);
    getFocusTarget(editor).dispatchEvent(event);
    return event.defaultPrevented;
}

/**
 * Types a key in `input` as the browser does: the keydown, then the edit unless prevented, then the
 * keyup, in the element that has the focus by then.
 */
function typeInInput(input: HTMLInputElement, init: KeyboardEventInit) {
    const name = init.key ?? "";
    const keyDown = createKeyEvent("keydown", init);
    input.dispatchEvent(keyDown);
    const isPlain = !init.ctrlKey && !init.altKey && !init.metaKey;
    if (!keyDown.defaultPrevented && input.isConnected && isPlain) {
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        if (name.length === 1) {
            input.setRangeText(name, start, end, "end");
            input.dispatchEvent(
                new InputEvent("input", { bubbles: true, data: name, inputType: "insertText" }));
        } else if (name === "Backspace" && (start !== end || start > 0)) {
            input.setRangeText("", start === end ? start - 1 : start, end, "end");
            input.dispatchEvent(
                new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
        }
    }
    const keyUpTarget = input.isConnected ? input : document.activeElement ?? document.body;
    keyUpTarget.dispatchEvent(createKeyEvent("keyup", init));
}

function getKeyInit(key: string): KeyboardEventInit {
    const init: KeyboardEventInit = { bubbles: true, cancelable: true };
    let name = key;
    const named = /^<((?:[CSAM]-)*)(.+)>$/.exec(key);
    if (named) {
        const modifiers = named[1];
        init.ctrlKey = modifiers.includes("C-");
        init.shiftKey = modifiers.includes("S-");
        init.altKey = modifiers.includes("A-");
        init.metaKey = modifiers.includes("M-");
        name = SPECIAL_KEYS[named[2]] ?? named[2];
    } else if (key === "\n") {
        name = "Enter";
    } else if (/^[A-Z]$/.test(key)) {
        init.shiftKey = true;
    }
    init.key = name;
    return init;
}

function createKeyEvent(type: string, init: KeyboardEventInit): KeyboardEvent {
    const name = init.key ?? "";
    const keyCode = KEY_CODES[name] ?? (name.length === 1 ? name.toUpperCase().charCodeAt(0) : 0);
    const event = new KeyboardEvent(type, init);
    Object.defineProperty(event, "keyCode", { value: keyCode });
    return event;
}

/** The editable that holds the selection of `editor`, such as a caption, or its root. */
function getFocusTarget(editor: Editor): HTMLElement {
    const { mapper, view } = editor.editing;
    const position = editor.model.document.selection.getFirstPosition();
    const root = view.getDomRoot() as HTMLElement;
    if (!position) {
        return root;
    }
    const viewPosition = mapper.toViewPosition(position);
    const editable = viewPosition.parent.is("$text")
        ? viewPosition.parent.parent
        : viewPosition.parent;
    const domElement = editable && view.domConverter.mapViewToDom(editable as never);
    return domElement instanceof HTMLElement ? domElement : root;
}

/** Turns each `·` of the content into a space, and keeps the selection. */
function restoreSpaces(editor: Editor) {
    const model = editor.model;
    const root = model.document.getRoot() as ModelElement;
    const places: { path: number[]; attributes: [ string, unknown ][] }[] = [];
    for (
        const { item,
        previousPosition } of model.createRangeIn(root).getWalker({ singleCharacters: true })) {
        if (item.is("$textProxy") && item.data === "·") {
            places.push({ path: previousPosition.path, attributes: [ ...item.getAttributes() ] });
        }
    }
    if (!places.length) {
        return;
    }
    const selection = model.document.selection;
    const anchor = selection.anchor?.path;
    const focus = selection.focus?.path;
    model.enqueueChange({ isUndoable: false }, (writer) => {
        for (const { path, attributes } of places.reverse()) {
            const position = writer.createPositionFromPath(root, path);
            writer.remove(writer.createRange(position, position.getShiftedBy(1)));
            writer.insertText(" ", Object.fromEntries(attributes), position);
        }
        if (anchor && focus) {
            const anchorPosition = writer.createPositionFromPath(root, anchor);
            const focusPosition = writer.createPositionFromPath(root, focus);
            const isBackward = focusPosition.isBefore(anchorPosition);
            writer.setSelection(writer.createRange(isBackward ? focusPosition : anchorPosition,
                isBackward ? anchorPosition : focusPosition), { backward: isBackward });
        }
    });
}
