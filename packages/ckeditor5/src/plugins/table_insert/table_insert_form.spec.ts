import { Locale } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import TableInsertFormView, {
    DEFAULT_TABLE_SIZE,
    MAX_TABLE_CELLS,
    MAX_TABLE_COLUMNS,
    MAX_TABLE_ROWS,
    parseTableSize,
    type TableSizeFieldView
} from "./table_insert_form.js";

describe("parseTableSize", () => {
    it("accepts a whole number from 1 to the maximum", () => {
        expect(parseTableSize("1", 10)).toBe(1);
        expect(parseTableSize("10", 10)).toBe(10);
        expect(parseTableSize("007", 10)).toBe(7);
        expect(parseTableSize(" 4 ", 10)).toBe(4);
    });

    it("rejects anything else", () => {
        for (const value of ["", " ", "0", "00", "11", "-1", "+3", "1.5", "1e1", "abc", "3x"]) {
            expect(parseTableSize(value, 10), value).toBeNull();
        }
        expect(parseTableSize("9".repeat(400), 10)).toBeNull();
    });
});

describe("TableInsertFormView", () => {
    let form: TableInsertFormView;

    beforeEach(() => {
        form = new TableInsertFormView(new Locale());
        form.render();
        document.body.appendChild(getElement(form));
        form.reset();
    });

    afterEach(() => {
        getElement(form).remove();
        form.destroy();
    });

    it("renders the Rows and Columns fields and a submit button", () => {
        const element = getElement(form);
        expect(element.tagName).toBe("FORM");
        expect(element.getAttribute("aria-label")).toBe("Insert table");

        const [rowsLabel, columnsLabel] = Array.from(element.querySelectorAll("label"));
        expect(rowsLabel.textContent).toBe("Rows");
        expect(columnsLabel.textContent).toBe("Columns");
        expect(rowsLabel.htmlFor).toBe(getInput(form.rowsField).id);
        expect(columnsLabel.htmlFor).toBe(getInput(form.columnsField).id);
        expect(getInput(form.rowsField).id).not.toBe(getInput(form.columnsField).id);

        expect(getInput(form.rowsField)).toMatchObject({ type: "number", min: "1", step: "1" });
        expect(getInput(form.rowsField).max).toBe(String(MAX_TABLE_ROWS));
        expect(getInput(form.columnsField).max).toBe(String(MAX_TABLE_COLUMNS));
        expect(getInput(form.rowsField).inputMode).toBe("numeric");

        const button = getElement(form.insertButtonView);
        expect(button.textContent).toBe("Insert");
        expect(button.getAttribute("type")).toBe("submit");
        expect(element.lastElementChild).toBe(button);
    });

    it("returns the entered size", () => {
        getInput(form.rowsField).value = "12";
        getInput(form.columnsField).value = "3";

        expect(form.validate()).toEqual({ rows: 12, columns: 3 });
        expect(form.rowsField.errorText).toBeNull();
        expect(form.columnsField.errorText).toBeNull();
    });

    it("accepts the largest value of each field and rejects one more", () => {
        setSize(form, MAX_TABLE_ROWS, 1);
        expect(form.validate()).toEqual({ rows: MAX_TABLE_ROWS, columns: 1 });
        setSize(form, 1, MAX_TABLE_COLUMNS);
        expect(form.validate()).toEqual({ rows: 1, columns: MAX_TABLE_COLUMNS });

        setSize(form, MAX_TABLE_ROWS + 1, MAX_TABLE_COLUMNS + 1);
        expect(form.validate()).toBeNull();
        expect(form.rowsField.errorText)
            .toBe(`Enter a whole number between 1 and ${MAX_TABLE_ROWS}.`);
        expect(form.columnsField.errorText)
            .toBe(`Enter a whole number between 1 and ${MAX_TABLE_COLUMNS}.`);
        expect(form.sizeErrorText).toBeNull();
    });

    it("accepts a table at the cell limit and rejects a larger one", () => {
        const rowsAtLimit = MAX_TABLE_CELLS / MAX_TABLE_COLUMNS;
        setSize(form, rowsAtLimit, MAX_TABLE_COLUMNS);
        expect(form.validate()).toEqual({ rows: rowsAtLimit, columns: MAX_TABLE_COLUMNS });
        expect(getSizeError(form).classList.contains("ck-hidden")).toBe(true);

        setSize(form, rowsAtLimit + 1, MAX_TABLE_COLUMNS);
        expect(form.validate()).toBeNull();

        const error = getSizeError(form);
        expect(form.sizeErrorText)
            .toBe(`The table is too large (max ${MAX_TABLE_CELLS} cells).`);
        expect(error.textContent).toBe(form.sizeErrorText);
        expect(error.classList.contains("ck-hidden")).toBe(false);
        expect(error.getAttribute("role")).toBe("alert");
        expectValid(form.rowsField);
        expectValid(form.columnsField);
        expect(document.activeElement).toBe(getInput(form.rowsField));
    });

    it("clears the size error when either field is edited", async () => {
        setSize(form, MAX_TABLE_ROWS, MAX_TABLE_COLUMNS);
        form.validate();
        expect(form.sizeErrorText).not.toBeNull();

        await userEvent.fill(getInput(form.rowsField), "999");
        expect(form.sizeErrorText).toBeNull();
        expect(getSizeError(form).classList.contains("ck-hidden")).toBe(true);

        form.validate();
        expect(form.sizeErrorText).not.toBeNull();
        await userEvent.fill(getInput(form.columnsField), "99");
        expect(form.sizeErrorText).toBeNull();
    });

    it("shows the error of an invalid field and focuses it", () => {
        getInput(form.rowsField).value = "5";
        getInput(form.columnsField).value = "0";

        expect(form.validate()).toBeNull();
        expectValid(form.rowsField);
        expectInvalid(form.columnsField);
        expect(document.activeElement).toBe(getInput(form.columnsField));
    });

    it("focuses the first invalid field when both are invalid", () => {
        getInput(form.rowsField).value = "";
        getInput(form.columnsField).value = "0";

        expect(form.validate()).toBeNull();
        expectInvalid(form.rowsField);
        expectInvalid(form.columnsField);
        expect(document.activeElement).toBe(getInput(form.rowsField));
    });

    it("clears the error of a field when its value is edited", async () => {
        getInput(form.rowsField).value = "0";
        getInput(form.columnsField).value = "0";
        form.validate();

        await userEvent.fill(getInput(form.rowsField), "3");

        expectValid(form.rowsField);
        expectInvalid(form.columnsField);
    });

    it("reset() restores the default size and clears the errors", async () => {
        await userEvent.fill(getInput(form.rowsField), "9");
        getInput(form.columnsField).value = "0";
        form.validate();
        setSize(form, MAX_TABLE_ROWS, MAX_TABLE_COLUMNS);
        form.validate();

        form.reset();
        expect(form.sizeErrorText).toBeNull();

        const defaultText = String(DEFAULT_TABLE_SIZE);
        expect(getInput(form.rowsField).value).toBe(defaultText);
        expect(getInput(form.columnsField).value).toBe(defaultText);
        expectValid(form.rowsField);
        expectValid(form.columnsField);
        expect(form.validate()).toEqual({ rows: DEFAULT_TABLE_SIZE, columns: DEFAULT_TABLE_SIZE });
    });

    it("focus() focuses the Rows field and selects its value", () => {
        const select = vi.spyOn(form.rowsField.inputView, "select");

        form.focus();

        expect(document.activeElement).toBe(getInput(form.rowsField));
        expect(select).toHaveBeenCalled();
    });

    it("cycles the focus with Tab and Shift+Tab", async () => {
        form.focus();

        await userEvent.keyboard("{Tab}");
        expect(document.activeElement).toBe(getInput(form.columnsField));
        await userEvent.keyboard("{Tab}");
        expect(document.activeElement).toBe(getElement(form.insertButtonView));
        await userEvent.keyboard("{Tab}");
        expect(document.activeElement).toBe(getInput(form.rowsField));
        await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
        expect(document.activeElement).toBe(getElement(form.insertButtonView));
    });

    it("fires submit for the Insert button and for Enter", async () => {
        const submit = vi.fn();
        form.on("submit", submit);

        await userEvent.click(getElement(form.insertButtonView));
        expect(submit).toHaveBeenCalledTimes(1);

        form.focus();
        await userEvent.keyboard("{Enter}");
        expect(submit).toHaveBeenCalledTimes(2);
    });
});

function getElement(view: { element: HTMLElement | null }): HTMLElement {
    if (!view.element) {
        throw new Error("The view is not rendered.");
    }
    return view.element;
}

function getInput(field: TableSizeFieldView): HTMLInputElement {
    return getElement(field.inputView) as HTMLInputElement;
}

function setSize(form: TableInsertFormView, rows: number, columns: number) {
    getInput(form.rowsField).value = String(rows);
    getInput(form.columnsField).value = String(columns);
}

function getSizeError(form: TableInsertFormView): HTMLElement {
    const error = getElement(form).querySelector<HTMLElement>(".ck-table-insert-form__size-error");
    if (!error) {
        throw new Error("The form has no size error element.");
    }
    return error;
}

function getError(field: TableSizeFieldView): HTMLElement {
    const error = getElement(field).querySelector<HTMLElement>(".ck-table-insert-form__error");
    if (!error) {
        throw new Error("The field has no error element.");
    }
    return error;
}

function expectInvalid(field: TableSizeFieldView) {
    const input = getInput(field);
    const error = getError(field);

    expect(field.errorText).toMatch(/^Enter a whole number between 1 and \d+\.$/);
    expect(error.textContent).toBe(field.errorText);
    expect(error.classList.contains("ck-hidden")).toBe(false);
    expect(error.getAttribute("role")).toBe("alert");
    expect(input.classList.contains("ck-error")).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
}

function expectValid(field: TableSizeFieldView) {
    const input = getInput(field);
    const error = getError(field);

    expect(field.errorText).toBeNull();
    expect(error.classList.contains("ck-hidden")).toBe(true);
    expect(error.hasAttribute("role")).toBe(false);
    expect(input.classList.contains("ck-error")).toBe(false);
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(input.hasAttribute("aria-describedby")).toBe(false);
}
