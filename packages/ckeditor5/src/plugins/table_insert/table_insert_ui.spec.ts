import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    BlockToolbar,
    ClassicEditor,
    ContextualBalloon,
    DropdownView,
    Essentials,
    IconTable,
    keyCodes,
    Paragraph,
    Table,
    TableUtils
} from "ckeditor5";
import editorStylesheetUrl from "ckeditor5/ckeditor5.css?url";
import type { ModelElement } from "ckeditor5";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { createTestEditor } from "../../../test/editor-kit.js";
import TableInsertFormView, {
    DEFAULT_TABLE_SIZE,
    MAX_TABLE_CELLS,
    MAX_TABLE_COLUMNS
} from "./table_insert_form.js";
import TableInsertUI from "./table_insert_ui.js";

describe("TableInsertUI", () => {
    let editor: ClassicEditor;
    let balloon: ContextualBalloon;

    // The grid, the dropdown panel and the balloon need the editor's stylesheet to have a layout.
    beforeAll(() => new Promise<void>((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = editorStylesheetUrl;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error("the editor stylesheet did not load"));
        document.head.appendChild(link);
    }));

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Table, TableInsertUI], {
            toolbar: ["insertTable"]
        });
        balloon = editor.plugins.get(ContextualBalloon);
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        editor.editing.view.focus();
    });

    describe("dropdown", () => {
        it("keeps the button of the upstream dropdown", () => {
            expect(getToolbarDropdown(editor).buttonView).toMatchObject({
                label: "Insert table",
                icon: IconTable,
                tooltip: true
            });
        });

        it("is enabled with the insertTable command", () => {
            const dropdown = getToolbarDropdown(editor);
            expect(dropdown.isEnabled).toBe(true);

            editor.enableReadOnlyMode("spec");
            expect(dropdown.isEnabled).toBe(false);

            editor.disableReadOnlyMode("spec");
            expect(dropdown.isEnabled).toBe(true);
        });

        it("shows the Insert table… button, a separator and the size grid", async () => {
            const dropdown = getToolbarDropdown(editor);
            expect(dropdown.panelView.children.length).toBe(0);

            await openDropdown(dropdown);

            const panel = getElement(dropdown.panelView);
            const button = getFormButton(dropdown);
            const separator = panel.querySelector(".ck-list__separator");
            const grid = panel.querySelector(".ck-insert-table-dropdown__grid");
            expect(button.textContent).toBe("Insert table…");
            expect(button.classList.contains("ck-button_with-text")).toBe(true);
            expect(button.parentElement?.classList.contains("ck-list__item")).toBe(true);
            expect(button.compareDocumentPosition(separator as Node))
                .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
            expect(separator?.compareDocumentPosition(grid as Node))
                .toBe(Node.DOCUMENT_POSITION_FOLLOWING);

            // The grid keeps the size label of the upstream dropdown.
            expect(panel.querySelector(".ck-insert-table-dropdown__label")?.textContent)
                .toBe("1 × 1");

            // The panel is built once, not on every opening.
            dropdown.isOpen = false;
            dropdown.isOpen = true;
            expect(dropdown.panelView.children.length).toBe(1);
            expect(panel.querySelectorAll(".ck-list__item")).toHaveLength(1);
        });

        it("inserts the table picked in the grid", async () => {
            const dropdown = getToolbarDropdown(editor);
            await openDropdown(dropdown);

            const box = getElement(dropdown.panelView)
                .querySelector<HTMLElement>("[data-row=\"3\"][data-column=\"4\"]");
            if (!box) {
                throw new Error("The grid has no 3 × 4 box.");
            }
            await userEvent.hover(box);
            await userEvent.click(box);

            expect(getTableSize(editor)).toEqual({ rows: 3, columns: 4 });
            expect(dropdown.isOpen).toBe(false);
            expect(balloon.visibleView).toBeNull();
            expect(editor.editing.view.document.isFocused).toBe(true);
        });

        it("moves the focus between the grid and the button with Tab", async () => {
            const dropdown = getToolbarDropdown(editor);
            // Keeps the pointer off the grid, whose boxes take the focus on hover.
            await userEvent.hover(getElement(dropdown.buttonView));
            getElement(dropdown.buttonView).focus();

            await userEvent.keyboard("{ArrowDown}");
            expect(dropdown.isOpen).toBe(true);
            const firstBox = getElement(dropdown.panelView)
                .querySelector(".ck-insert-table-dropdown-grid-box");
            expect(document.activeElement).toBe(firstBox);

            await userEvent.keyboard("{Tab}");
            expect(document.activeElement).toBe(getFormButton(dropdown));
            await userEvent.keyboard("{Tab}");
            expect(document.activeElement).toBe(firstBox);
            await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
            expect(document.activeElement).toBe(getFormButton(dropdown));

            await userEvent.keyboard("{Enter}");
            expect(dropdown.isOpen).toBe(false);
            expect(document.activeElement).toBe(getForm(balloon).rowsField.inputView.element);
        });
    });

    describe("form", () => {
        it("opens at the caret when Insert table… is clicked", async () => {
            const dropdown = getToolbarDropdown(editor);
            await openDropdown(dropdown);

            await userEvent.click(getFormButton(dropdown));

            expect(dropdown.isOpen).toBe(false);
            const form = getForm(balloon);
            expect(getInput(form, "rows").value).toBe(String(DEFAULT_TABLE_SIZE));
            expect(getInput(form, "columns").value).toBe(String(DEFAULT_TABLE_SIZE));
            expect(document.activeElement).toBe(getInput(form, "rows"));

            // The balloon points at the caret, after "foo".
            const caret = getCaretRect(editor);
            const panel = getElement(balloon.view).getBoundingClientRect();
            expect(balloon.view.isVisible).toBe(true);
            expect(caret.left).toBeGreaterThanOrEqual(panel.left);
            expect(caret.left).toBeLessThanOrEqual(panel.right);
            const gap = Math.min(
                Math.abs(panel.top - caret.bottom),
                Math.abs(caret.top - panel.bottom)
            );
            expect(gap).toBeLessThan(30);
        });

        it("inserts a table of the typed size and closes", async () => {
            const form = await openForm(editor);

            await userEvent.fill(getInput(form, "rows"), "5");
            await userEvent.fill(getInput(form, "columns"), "7");
            await userEvent.click(getElement(form.insertButtonView));

            expect(getTableSize(editor)).toEqual({ rows: 5, columns: 7 });
            expect(balloon.hasView(form)).toBe(false);
            expect(editor.editing.view.document.isFocused).toBe(true);
            expect(editor.model.document.selection.getFirstPosition()?.findAncestor("tableCell"))
                .not.toBeNull();

            // One undo step removes the table.
            editor.execute("undo");
            expect(getModelData(editor.model, { withoutSelection: true }))
                .toBe("<paragraph>foo</paragraph>");
        });

        it("inserts the table on Enter", async () => {
            const form = await openForm(editor);

            await userEvent.fill(getInput(form, "columns"), "3");
            await userEvent.keyboard("{Enter}");

            expect(getTableSize(editor)).toEqual({ rows: DEFAULT_TABLE_SIZE, columns: 3 });
            expect(balloon.hasView(form)).toBe(false);
        });

        it("stays open and reports invalid values", async () => {
            const form = await openForm(editor);

            await userEvent.fill(getInput(form, "rows"), "0");
            await userEvent.fill(getInput(form, "columns"), String(MAX_TABLE_COLUMNS + 1));
            await userEvent.keyboard("{Enter}");

            expect(getTableSize(editor)).toBeNull();
            expect(balloon.visibleView).toBe(form);
            expect(form.rowsField.errorText).not.toBeNull();
            expect(form.columnsField.errorText).not.toBeNull();
            expect(document.activeElement).toBe(getInput(form, "rows"));

            await userEvent.fill(getInput(form, "rows"), "3");
            await userEvent.keyboard("{Enter}");
            expect(getTableSize(editor)).toBeNull();
            expect(document.activeElement).toBe(getInput(form, "columns"));

            await userEvent.fill(getInput(form, "columns"), "4");
            await userEvent.keyboard("{Enter}");
            expect(getTableSize(editor)).toEqual({ rows: 3, columns: 4 });
        });

        it("reports a table with too many cells and inserts nothing", async () => {
            const form = await openForm(editor);

            await userEvent.fill(getInput(form, "rows"), "1000");
            await userEvent.fill(getInput(form, "columns"), "6");
            await userEvent.keyboard("{Enter}");

            const message = getElement(form)
                .querySelector<HTMLElement>(".ck-table-insert-form__size-error");
            expect(getTableSize(editor)).toBeNull();
            expect(balloon.visibleView).toBe(form);
            expect(message?.textContent)
                .toBe(`The table is too large (max ${MAX_TABLE_CELLS} cells).`);
            expect(message?.checkVisibility()).toBe(true);
            expect(document.activeElement).toBe(getInput(form, "rows"));

            await userEvent.fill(getInput(form, "rows"), "100");
            expect(message?.checkVisibility()).toBe(false);

            await userEvent.keyboard("{Enter}");
            expect(getTableSize(editor)).toEqual({ rows: 100, columns: 6 });
            expect(balloon.hasView(form)).toBe(false);
        });

        it("closes on Esc without inserting", async () => {
            const form = await openForm(editor);
            await userEvent.fill(getInput(form, "rows"), "4");

            await userEvent.keyboard("{Escape}");

            expect(balloon.hasView(form)).toBe(false);
            expect(getTableSize(editor)).toBeNull();
            expect(editor.editing.view.document.isFocused).toBe(true);

            // Closing a closed form does nothing.
            expect(() => form.keystrokes.press(createEscEvent())).not.toThrow();
            expect(balloon.visibleView).toBeNull();
        });

        it("closes on a click outside without inserting", async () => {
            const form = await openForm(editor);

            document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

            expect(balloon.hasView(form)).toBe(false);
            expect(getTableSize(editor)).toBeNull();
        });

        it("stays open on a click inside", async () => {
            const form = await openForm(editor);

            await userEvent.click(getInput(form, "columns"));

            expect(balloon.visibleView).toBe(form);
        });

        it("opens with the default size every time", async () => {
            let form = await openForm(editor);
            await userEvent.fill(getInput(form, "rows"), "0");
            await userEvent.keyboard("{Enter}");
            await userEvent.keyboard("{Escape}");

            form = await openForm(editor);

            expect(getInput(form, "rows").value).toBe(String(DEFAULT_TABLE_SIZE));
            expect(form.rowsField.errorText).toBeNull();
        });

        it("showForm() leaves an open form alone", async () => {
            const form = await openForm(editor);
            await userEvent.fill(getInput(form, "rows"), "9");
            const add = vi.spyOn(balloon, "add");

            editor.plugins.get(TableInsertUI).showForm();

            expect(add).not.toHaveBeenCalled();
            expect(getInput(form, "rows").value).toBe("9");
        });

        it("does not insert while the insertTable command is disabled", async () => {
            const form = await openForm(editor);

            editor.enableReadOnlyMode("spec");
            expect(form.insertButtonView.isEnabled).toBe(false);
            form.fire("submit");

            expect(getTableSize(editor)).toBeNull();
            expect(balloon.visibleView).toBe(form);

            editor.disableReadOnlyMode("spec");
            expect(form.insertButtonView.isEnabled).toBe(true);
        });

        it("translates its strings", async () => {
            const translated = await createTestEditor([Essentials, Paragraph, TableInsertUI], {
                toolbar: ["insertTable"],
                translations: [{}, {
                    en: {
                        dictionary: {
                            "Insert table…": "Tabel personalizat…",
                            "Rows": "Rânduri",
                            "Columns": "Coloane",
                            "Enter a whole number between 1 and %0.": "Între 1 și %0."
                        }
                    }
                }]
            });
            const dropdown = getToolbarDropdown(translated);
            dropdown.isOpen = true;
            expect(getFormButton(dropdown).textContent).toBe("Tabel personalizat…");

            getFormButton(dropdown).click();
            const form = getForm(translated.plugins.get(ContextualBalloon));
            const labels = Array.from(getElement(form).querySelectorAll("label"))
                .map((label) => label.textContent);
            expect(labels).toEqual(["Rânduri", "Coloane"]);

            getInput(form, "rows").value = "0";
            form.validate();
            expect(form.rowsField.errorText).toBe("Între 1 și 1000.");
        });
    });

    describe("in a block toolbar", () => {
        it("hides the block toolbar and focuses the form", async () => {
            const blockEditor = await createTestEditor(
                [Essentials, Paragraph, Table, TableInsertUI, BlockToolbar],
                { toolbar: [], blockToolbar: ["insertTable"] }
            );
            setModelData(blockEditor.model, "<paragraph>foo[]</paragraph>");
            blockEditor.editing.view.focus();

            const blockToolbar = blockEditor.plugins.get(BlockToolbar);
            blockToolbar.panelView.isVisible = true;
            const dropdown = getDropdown(blockToolbar.toolbarView.items.first);
            dropdown.isOpen = true;

            getFormButton(dropdown).click();

            expect(blockToolbar.panelView.isVisible).toBe(false);
            const form = getForm(blockEditor.plugins.get(ContextualBalloon));
            expect(document.activeElement).toBe(getInput(form, "rows"));
        });
    });
});

function getElement(view: { element: HTMLElement | null }): HTMLElement {
    if (!view.element) {
        throw new Error("The view is not rendered.");
    }
    return view.element;
}

function getDropdown(view: unknown): DropdownView {
    expect(view).toBeInstanceOf(DropdownView);
    return view as DropdownView;
}

function getToolbarDropdown(editor: ClassicEditor): DropdownView {
    return getDropdown(editor.ui.view.toolbar.items.first);
}

async function openDropdown(dropdown: DropdownView) {
    await userEvent.click(getElement(dropdown.buttonView));
    expect(dropdown.isOpen).toBe(true);
}

function getFormButton(dropdown: DropdownView): HTMLElement {
    const button = getElement(dropdown.panelView)
        .querySelector<HTMLElement>(".ck-insert-table-dropdown__content .ck-list__item > button");
    if (!button) {
        throw new Error("The dropdown has no Insert table… button.");
    }
    return button;
}

function getForm(balloon: ContextualBalloon): TableInsertFormView {
    const form = balloon.visibleView;
    expect(form).toBeInstanceOf(TableInsertFormView);
    return form as TableInsertFormView;
}

async function openForm(editor: ClassicEditor): Promise<TableInsertFormView> {
    const dropdown = getToolbarDropdown(editor);
    await openDropdown(dropdown);
    await userEvent.click(getFormButton(dropdown));
    return getForm(editor.plugins.get(ContextualBalloon));
}

function getInput(form: TableInsertFormView, field: "rows" | "columns"): HTMLInputElement {
    const view = field === "rows" ? form.rowsField.inputView : form.columnsField.inputView;
    return getElement(view) as HTMLInputElement;
}

/** The size of the table in the document, or `null` when there is none. */
function getTableSize(editor: ClassicEditor): { rows: number; columns: number } | null {
    const root = editor.model.document.getRoot();
    const children = root ? Array.from(root.getChildren()) : [];
    const table = children.find((child) => child.is("element", "table")) as
        ModelElement | undefined;
    if (!table) {
        return null;
    }

    const tableUtils = editor.plugins.get(TableUtils);
    return { rows: tableUtils.getRows(table), columns: tableUtils.getColumns(table) };
}

function getCaretRect(editor: ClassicEditor): DOMRect {
    const view = editor.editing.view;
    const range = view.document.selection.getFirstRange();
    if (!range) {
        throw new Error("The editing view has no selection.");
    }
    return view.domConverter.viewRangeToDom(range).getBoundingClientRect();
}

function createEscEvent() {
    return {
        keyCode: keyCodes.esc,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        preventDefault: () => undefined,
        stopPropagation: () => undefined
    };
}
