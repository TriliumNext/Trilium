import { act } from "preact/test-utils";
import { afterEach, vi } from "vitest";

import type { MenuItem } from "../menus/context_menu";
import { getContentEmbedTools } from "../widgets/type_widgets/text/content_embed_tools";

/** The `data-code-*` attribute that each setting of `setContentEmbedCodeView` sets. */
const CODE_VIEW_ATTRIBUTES = {
    language: "data-code-language",
    tabWidth: "data-code-tab-width",
    indentWithTabs: "data-code-indent-with-tabs",
    wrapLines: "data-code-wrap-lines",
    lineNumbers: "data-code-line-numbers"
};

const editables: HTMLElement[] = [];

/**
 * The editable root of a text editor, in the page, and the editor, whose code view command sets
 * the `data-code-*` attributes of the embed it selects, as the text editor renders them. Put the
 * embed in `editable`; it leaves the page after each test.
 */
export function buildCodeViewTextEditor() {
    let selected: Element | null = null;
    const textEditor = {
        selectEmbedAt: vi.fn((element: Element) => {
            selected = element.closest(".include-note");
            return true;
        }),
        plugins: { get: () => ({ selectEmbedAt: textEditor.selectEmbedAt }) },
        execute: vi.fn((_name: string, codeView: Record<string, unknown>) => {
            for (const [ setting, attribute ] of Object.entries(CODE_VIEW_ATTRIBUTES)) {
                const value = codeView[setting];
                if (value === null) {
                    selected?.removeAttribute(attribute);
                } else if (value !== undefined) {
                    selected?.setAttribute(attribute, String(value));
                }
            }
        })
    };
    const editable = document.createElement("div");
    editable.className = "ck-editor__editable";
    Object.assign(editable, { ckeditorInstance: textEditor });
    document.body.append(editable);
    editables.push(editable);
    return { textEditor, editable };
}

/** The items that the content of `figure` adds to the menu of its embed. */
export function getEmbedMenuItems(figure: HTMLElement) {
    return getContentEmbedTools(figure)?.getMenuItems?.() ?? [];
}

/** The title, the checked state and the items of `item`, for comparing. */
export function summarizeMenuItem<T>(item: MenuItem<T>): unknown {
    if ("kind" in item) return item;
    return {
        title: item.title,
        ...("checked" in item && { checked: item.checked }),
        ...(item.items && { items: item.items.map(summarizeMenuItem) })
    };
}

/** Runs the item `index` of the menu of the embed, or the item `subIndex` of its submenu. */
export async function runEmbedMenuItem(figure: HTMLElement, index: number, subIndex?: number) {
    const item = getEmbedMenuItems(figure)[index];
    const target = item && !("kind" in item) && subIndex !== undefined
        ? item.items?.[subIndex]
        : item;
    if (!target || "kind" in target) throw new Error(`No menu item at ${index}.`);
    await act(async () => target.handler?.(target, new MouseEvent("click")));
}

afterEach(() => {
    for (const editable of editables) {
        editable.remove();
    }
    editables.length = 0;
});
