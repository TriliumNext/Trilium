import {
    ButtonView,
    FocusCycler,
    FocusTracker,
    InputNumberView,
    KeystrokeHandler,
    LabelView,
    submitHandler,
    SwitchButtonView,
    uid,
    View,
    ViewCollection
} from "ckeditor5";
import type { FocusableView, Locale } from "ckeditor5";

/** The largest number of rows the form accepts. */
export const MAX_TABLE_ROWS = 1000;

/** The largest number of columns the form accepts. */
export const MAX_TABLE_COLUMNS = 100;

/** The largest number of cells the form accepts, as rows × columns. */
export const MAX_TABLE_CELLS = 5000;

/** The number of rows and columns the form shows when it opens. */
export const DEFAULT_TABLE_SIZE = 2;

/** The number of header rows the form shows when it opens. */
export const DEFAULT_HEADING_ROWS = 1;

/** The number of header columns the form shows when it opens. */
export const DEFAULT_HEADING_COLUMNS = 0;

/** The options of the `insertTable` command that the form collects. */
export interface TableInsertOptions {
    rows: number;
    columns: number;
    headingRows?: number;
    headingColumns?: number;
}

/**
 * The balloon form behind "Insert table…": a "Columns" field, a "Rows" field, a "Use headers"
 * switch that shows the "Header columns" and "Header rows" fields, and an Insert button. Invalid
 * values are reported under their field when the form is submitted, and a table with more than
 * {@link MAX_TABLE_CELLS} cells is reported above the button.
 */
export default class TableInsertFormView extends View {

    /** The error shown when the table has too many cells, or `null`. */
    declare public sizeErrorText: string | null;

    /** Whether the header fields are shown and their values are submitted. */
    declare public useHeaders: boolean;

    public readonly rowsField: TableSizeFieldView;
    public readonly columnsField: TableSizeFieldView;
    public readonly headersSwitchView: SwitchButtonView;
    public readonly headingRowsField: TableSizeFieldView;
    public readonly headingColumnsField: TableSizeFieldView;
    public readonly insertButtonView: ButtonView;

    public readonly focusTracker = new FocusTracker();
    public readonly keystrokes = new KeystrokeHandler();

    private readonly focusables = new ViewCollection<FocusableView>();
    private readonly focusCycler: FocusCycler;
    private readonly tooLargeText: string;

    constructor(locale: Locale) {
        super(locale);
        const t = locale.t;
        const bind = this.bindTemplate;

        this.set("sizeErrorText", null);
        this.set("useHeaders", false);
        this.tooLargeText = t("The table is too large (max %0 cells).", MAX_TABLE_CELLS);

        const getSizeError = (max: number) => t("Enter a whole number between 1 and %0.", max);
        const getHeadingError = (max: number) => t("Enter a whole number between 0 and %0.", max);

        this.rowsField = new TableSizeFieldView(locale, t("Rows"), {
            min: 1,
            max: MAX_TABLE_ROWS,
            getErrorText: getSizeError
        });
        this.columnsField = new TableSizeFieldView(locale, t("Columns"), {
            min: 1,
            max: MAX_TABLE_COLUMNS,
            getErrorText: getSizeError
        });

        this.headersSwitchView = new SwitchButtonView(locale);
        this.headersSwitchView.set({ label: t("Use headers"), withText: true, role: "switch" });
        this.headersSwitchView.bind("isOn").to(this, "useHeaders");
        this.headersSwitchView.on("execute", () => {
            this.useHeaders = !this.useHeaders;
        });

        this.headingRowsField = new TableSizeFieldView(locale, t("Header rows"), {
            min: 0,
            max: MAX_TABLE_ROWS,
            getErrorText: getHeadingError
        });
        this.headingColumnsField = new TableSizeFieldView(locale, t("Header columns"), {
            min: 0,
            max: MAX_TABLE_COLUMNS,
            getErrorText: getHeadingError
        });
        for (const field of [this.headingColumnsField, this.headingRowsField]) {
            field.bind("isVisible").to(this, "useHeaders");
        }

        this.insertButtonView = new ButtonView(locale);
        this.insertButtonView.set({
            label: t("Insert"),
            withText: true,
            type: "submit",
            class: "ck-button-action ck-button-bold"
        });

        this.setTemplate({
            tag: "form",
            attributes: {
                class: ["ck", "ck-table-insert-form"],
                tabindex: "-1",
                "aria-label": t("Insert table"),
                // The fields are checked by `validate()`, which shows translated errors.
                novalidate: true
            },
            children: [
                this.columnsField,
                this.rowsField,
                this.headersSwitchView,
                this.headingColumnsField,
                this.headingRowsField,
                {
                    tag: "div",
                    attributes: {
                        class: [
                            "ck",
                            "ck-table-insert-form__error",
                            "ck-table-insert-form__size-error",
                            bind.if("sizeErrorText", "ck-hidden", (text) => !text)
                        ],
                        role: bind.if("sizeErrorText", "alert")
                    },
                    children: [{ text: bind.to("sizeErrorText") }]
                },
                this.insertButtonView
            ]
        });

        // Editing either value clears the size error and sets the limits of the header fields.
        for (const field of [this.columnsField, this.rowsField]) {
            field.inputView.on("input", () => {
                this.sizeErrorText = null;
                this.updateHeadingLimits();
            });
        }

        this.focusCycler = new FocusCycler({
            focusables: this.focusables,
            focusTracker: this.focusTracker,
            keystrokeHandler: this.keystrokes,
            actions: {
                focusPrevious: "shift + tab",
                focusNext: "tab"
            }
        });
    }

    public override render(): void {
        super.render();

        // Turns a native form submit, the Enter key included, into the view's `submit` event.
        submitHandler({ view: this });

        for (const view of [
            this.columnsField.inputView,
            this.rowsField.inputView,
            this.headersSwitchView,
            this.headingColumnsField.inputView,
            this.headingRowsField.inputView,
            this.insertButtonView
        ]) {
            this.focusables.add(view);
            /* v8 ignore next -- a child view rendered as part of this template has an element */
            if (view.element) {
                this.focusTracker.add(view.element);
            }
        }

        /* v8 ignore next -- super.render() has just built this view's element */
        if (this.element) {
            this.keystrokes.listenTo(this.element);
        }
    }

    public override destroy(): void {
        super.destroy();
        this.focusTracker.destroy();
        this.keystrokes.destroy();
    }

    /** Focuses the "Columns" field and selects its value. */
    public focus(): void {
        this.focusCycler.focusFirst();
        this.columnsField.inputView.select();
    }

    /** Turns the headers off, restores the default values and clears the errors. */
    public reset(): void {
        this.sizeErrorText = null;
        this.useHeaders = false;
        this.rowsField.reset(DEFAULT_TABLE_SIZE);
        this.columnsField.reset(DEFAULT_TABLE_SIZE);
        this.headingRowsField.reset(DEFAULT_HEADING_ROWS);
        this.headingColumnsField.reset(DEFAULT_HEADING_COLUMNS);
        this.updateHeadingLimits();
    }

    /**
     * Returns the entered size, with the header rows and columns while {@link useHeaders} is on,
     * or `null` when a field is invalid or the table has more than {@link MAX_TABLE_CELLS} cells.
     * The errors are shown, and the first field to fix is focused.
     */
    public validate(): TableInsertOptions | null {
        this.sizeErrorText = null;
        this.updateHeadingLimits();

        const columns = this.columnsField.validate();
        const rows = this.rowsField.validate();
        const headingColumns = this.useHeaders ? this.headingColumnsField.validate() : 0;
        const headingRows = this.useHeaders ? this.headingRowsField.validate() : 0;

        if (columns === null || rows === null || headingColumns === null || headingRows === null) {
            const fields = [
                this.columnsField,
                this.rowsField,
                this.headingColumnsField,
                this.headingRowsField
            ];
            fields.find((field) => field.isVisible && field.errorText)?.focus();
            return null;
        }
        if (rows * columns > MAX_TABLE_CELLS) {
            this.sizeErrorText = this.tooLargeText;
            this.columnsField.focus();
            return null;
        }
        return this.useHeaders ? { rows, columns, headingRows, headingColumns } : { rows, columns };
    }

    /** Lets the header fields accept up to the entered number of columns and rows. */
    private updateHeadingLimits(): void {
        this.headingColumnsField.max = this.columnsField.getValue() ?? MAX_TABLE_COLUMNS;
        this.headingRowsField.max = this.rowsField.getValue() ?? MAX_TABLE_ROWS;
    }
}

interface TableSizeFieldOptions {
    min: number;
    max: number;
    /** Returns the error shown for a value that is not a whole number from `min` to `max`. */
    getErrorText: (max: number) => string;
}

/**
 * A number field of {@link TableInsertFormView}: a label, the input and the error under it.
 * The element has `display: contents`, so the three parts are laid out by the form's grid.
 */
export class TableSizeFieldView extends View {

    /** The error shown under the input, or `null` when the value is valid. */
    declare public errorText: string | null;

    /** The largest value the field accepts. */
    declare public max: number;

    declare public isVisible: boolean;

    public readonly labelView: LabelView;
    public readonly inputView: InputNumberView;

    private readonly min: number;
    private readonly getErrorText: (max: number) => string;

    constructor(locale: Locale, label: string, { min, max, getErrorText }: TableSizeFieldOptions) {
        super(locale);

        const inputId = `ck-table-insert-form-input-${uid()}`;
        const errorId = `ck-table-insert-form-error-${uid()}`;
        const bind = this.bindTemplate;

        this.min = min;
        this.getErrorText = getErrorText;
        this.set("errorText", null);
        this.set("max", max);
        this.set("isVisible", true);

        this.labelView = new LabelView(locale);
        this.labelView.set({ text: label, for: inputId });

        this.inputView = new InputNumberView(locale, { min, max, step: 1 });
        this.inputView.set({ id: inputId, inputMode: "numeric" });
        this.inputView.bind("max").to(this);
        this.inputView.bind("hasError").to(this, "errorText", (text) => !!text);
        this.inputView.bind("ariaDescribedById")
            .to(this, "errorText", (text) => text ? errorId : undefined);

        // The error is cleared as soon as the value is edited.
        this.inputView.on("input", () => {
            this.errorText = null;
        });

        this.setTemplate({
            tag: "div",
            attributes: {
                class: [
                    "ck",
                    "ck-table-insert-form__field",
                    bind.if("isVisible", "ck-hidden", (isVisible) => !isVisible)
                ]
            },
            children: [
                this.labelView,
                this.inputView,
                {
                    tag: "div",
                    attributes: {
                        id: errorId,
                        class: [
                            "ck",
                            "ck-table-insert-form__error",
                            bind.if("errorText", "ck-hidden", (text) => !text)
                        ],
                        role: bind.if("errorText", "alert")
                    },
                    children: [{ text: bind.to("errorText") }]
                }
            ]
        });
    }

    /** Focuses the input and selects its value. */
    public focus(): void {
        this.inputView.focus();
        this.inputView.select();
    }

    /** Shows `value` in the input and clears the error. */
    public reset(value: number): void {
        const text = String(value);

        this.errorText = null;
        // `value` reaches the DOM only when it changes, so an edited input is written directly.
        this.inputView.value = text;
        /* v8 ignore next -- the form renders its fields before it can be shown */
        if (this.inputView.element) {
            this.inputView.element.value = text;
        }
    }

    /** Returns the entered number, or `null` when it is invalid. Shows no error. */
    public getValue(): number | null {
        /* v8 ignore next -- the form renders its fields before it reads them */
        return parseTableSize(this.inputView.element?.value ?? "", this.max, this.min);
    }

    /** Returns the entered number, or `null` after showing the error. */
    public validate(): number | null {
        const value = this.getValue();

        this.errorText = value === null ? this.getErrorText(this.max) : null;
        return value;
    }
}

/** Parses `value` as a whole number from `min` to `max`. Returns `null` for anything else. */
export function parseTableSize(value: string, max: number, min = 1): number | null {
    const text = value.trim();
    if (!/^\d+$/.test(text)) {
        return null;
    }

    const size = Number(text);
    return size >= min && size <= max ? size : null;
}
