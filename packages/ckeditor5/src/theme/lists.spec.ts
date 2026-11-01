import "ckeditor5/ckeditor5.css";
import "./todo_lists.css";
import "./lists.css";

import { Alignment, Essentials, List, Paragraph, Table, TableCellProperties, TodoList } from "ckeditor5";
import type { ClassicEditor } from "ckeditor5";
import { describe, expect, it, onTestFinished } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import ListItemAlignment from "../plugins/list_item_alignment.js";
import { applyListItemAlignment } from "../plugins/list_item_alignment_read_only.js";

const PLUGINS = [
    Essentials, Paragraph, List, TodoList, Table, TableCellProperties, Alignment, ListItemAlignment
];
const TODO_ITEM = `<li><label class="todo-list__label"><input type="checkbox" disabled="disabled"></label>`;
const ALIGNED_ITEMS = `
    <ul><li><p style="text-align:center">a</p></li></ul>
    <ol><li><p style="text-align:right">b</p></li></ol>
    <ul><li>c</li></ul>
    <ul class="todo-list">${TODO_ITEM}<p style="text-align:center">d</p></li></ul>
`;

describe("lists.css", () => {
    it("moves the items of a list in a centered or right-aligned cell with their text", async () => {
        const tableWidth = document.head.appendChild(document.createElement("style"));
        tableWidth.textContent = ".ck-content .table { width: 600px; }";
        onTestFinished(() => tableWidth.remove());
        const editor = await editorWith(`<figure class="table"><table><tbody><tr>
            <td style="text-align:center"><ul><li>a</li></ul></td>
            <td style="text-align:right"><ol><li><p>b</p><p>c</p></li></ol></td>
            <td><ul><li>d</li></ul></td>
            <td style="text-align:center"><ul class="todo-list">${TODO_ITEM}<p>e</p></li></ul></td>
        </tr></tbody></table></figure>`);
        const [ centered, rightAligned, plain, todo ] = items(editingRoot(editor));

        expectCentered(centered);
        expectRightAligned(rightAligned);
        expectFullWidth(plain);
        expectCentered(todo);
        expectCheckboxBeforeText(todo);
    });

    it("moves list items aligned with the alignment button with their text", async () => {
        const editor = await editorWith(ALIGNED_ITEMS);
        const [ centered, rightAligned, plain, todo ] = items(editingRoot(editor));

        expectCentered(centered);
        expectRightAligned(rightAligned);
        expectFullWidth(plain);
        expectCentered(todo);
        expectCheckboxBeforeText(todo);
    });

    it("moves aligned list items in saved content shown outside the editor", () => {
        const container = document.body.appendChild(document.createElement("div"));
        onTestFinished(() => container.remove());
        container.className = "ck-content";
        container.innerHTML = ALIGNED_ITEMS;
        applyListItemAlignment(container);
        const [ centered, rightAligned, plain, todo ] = items(container);

        expectCentered(centered);
        expectRightAligned(rightAligned);
        expectFullWidth(plain);
        expectCentered(todo);
        expectCheckboxBeforeText(todo);
    });

    it("moves a left-aligned item to the left in right-to-left content", async () => {
        const editor = await editorWith(`
            <ul><li><p style="text-align:left">a</p></li></ul>
            <p>-</p>
            <ul><li>b</li></ul>
        `, "ar");
        const [ leftAligned, plain ] = items(editingRoot(editor));

        expect(leftAligned.getBoundingClientRect().left).toBeCloseTo(listBox(leftAligned).left, 0);
        expect(leftAligned.getBoundingClientRect().width).toBeLessThan(listBox(leftAligned).width / 2);
        expectFullWidth(plain);
    });
});

async function editorWith(data: string, contentLanguage = "en") {
    const editor = await createTestEditor(PLUGINS, { language: { ui: "en", content: contentLanguage } });
    editor.setData(data);
    return editor;
}

function editingRoot(editor: ClassicEditor) {
    const root = editor.editing.view.getDomRoot();
    if (!root) {
        throw new Error("The editor has no editing root.");
    }
    return root;
}

/** The first list item of each top-level list, or of each table cell, in document order. */
function items(root: HTMLElement) {
    const lists = root.querySelectorAll(":is(td, .ck-content) > :is(ul, ol)");
    const result: HTMLLIElement[] = [];
    for (const list of lists) {
        const item = list.querySelector("li");
        if (!item) {
            throw new Error("A list has no items.");
        }
        result.push(item);
    }
    return result;
}

function expectCentered(item: HTMLLIElement) {
    const box = item.getBoundingClientRect();
    const list = listBox(item);
    expect(box.width).toBeLessThan(list.width / 2);
    expect(box.left - list.left).toBeCloseTo(list.right - box.right, 0);
}

function expectRightAligned(item: HTMLLIElement) {
    expect(item.getBoundingClientRect().width).toBeLessThan(listBox(item).width / 2);
    expect(item.getBoundingClientRect().right).toBeCloseTo(listBox(item).right, 0);
}

function expectFullWidth(item: HTMLLIElement) {
    expect(item.getBoundingClientRect().width).toBeCloseTo(listBox(item).width, 0);
}

/** The checkbox ends at most a few pixels before the item's text. */
function expectCheckboxBeforeText(item: HTMLLIElement) {
    const checkbox = item.querySelector("input")?.getBoundingClientRect();
    const textElement = item.querySelector(":is(p, .todo-list__label__description)");
    if (!checkbox || !textElement) {
        throw new Error("The to-do item has no checkbox or text.");
    }
    const range = document.createRange();
    range.selectNodeContents(textElement);
    const text = range.getBoundingClientRect();
    expect(text.left - checkbox.right).toBeGreaterThanOrEqual(0);
    expect(text.left - checkbox.right).toBeLessThan(16);
}

/** The box the list's items lay out in: the list without its padding. */
function listBox(item: HTMLLIElement) {
    const list = item.parentElement;
    if (!list) {
        throw new Error("The item is not in a list.");
    }
    const rect = list.getBoundingClientRect();
    const style = getComputedStyle(list);
    const left = rect.left + parseFloat(style.paddingLeft);
    const right = rect.right - parseFloat(style.paddingRight);
    return { left, right, width: right - left };
}
