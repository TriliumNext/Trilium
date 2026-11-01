import {
    _InsertTableView as InsertTableView,
    ButtonView,
    clickOutsideHandler,
    ContextualBalloon,
    createDropdown,
    FocusCycler,
    FocusTracker,
    IconTable,
    KeystrokeHandler,
    ListItemView,
    ListSeparatorView,
    ListView,
    Plugin,
    Table,
    View,
    ViewCollection
} from "ckeditor5";
import type {
    DomOptimalPositionOptions,
    DropdownView,
    Editor,
    FocusableView,
    InsertTableCommand,
    Locale
} from "ckeditor5";

import "../../theme/table_insert.css";

import TableInsertFormView from "./table_insert_form.js";

/**
 * Replaces the `insertTable` dropdown with one that has an "Insert table…" button above the size
 * grid. The button opens {@link TableInsertFormView} in a balloon at the caret, where the number
 * of rows and columns is typed.
 */
export default class TableInsertUI extends Plugin {

    static get requires() {
        return [Table, ContextualBalloon] as const;
    }

    static get pluginName() {
        return "TableInsertUI" as const;
    }

    private formView: TableInsertFormView | null = null;

    init() {
        // Replaces the dropdown of `TableUI`, which `Table` initializes before this plugin.
        this.editor.ui.componentFactory.add("insertTable", (locale) => this.createDropdown(locale));
    }

    override destroy() {
        super.destroy();
        this.formView?.destroy();
    }

    /** Opens the form at the caret. Does nothing when the form is already open. */
    showForm() {
        const editor = this.editor;
        const balloon = editor.plugins.get(ContextualBalloon);
        const form = this.getFormView();

        if (balloon.hasView(form)) {
            return;
        }

        form.reset();
        balloon.add({
            view: form,
            position: getCaretPosition(editor)
        });
        form.focus();
    }

    private hideForm(form: TableInsertFormView) {
        const balloon = this.editor.plugins.get(ContextualBalloon);
        if (!balloon.hasView(form)) {
            return;
        }

        balloon.remove(form);
        this.editor.editing.view.focus();
    }

    private createDropdown(locale: Locale): DropdownView {
        const editor = this.editor;
        // Always registered: `Table` loads `TableEditing`.
        const command = editor.commands.get("insertTable") as InsertTableCommand;
        const dropdownView = createDropdown(locale);

        dropdownView.bind("isEnabled").to(command);
        dropdownView.buttonView.set({
            icon: IconTable,
            label: editor.t("Insert table"),
            tooltip: true
        });

        // The panel is built on the first opening, like the one of the upstream dropdown.
        let panelView: InsertTablePanelView | null = null;
        dropdownView.on("change:isOpen", () => {
            if (panelView) {
                return;
            }

            const panel = new InsertTablePanelView(locale);
            panelView = panel;
            dropdownView.panelView.children.add(panel);

            // Delegated so that the dropdown closes, and a block toolbar hides, on either one.
            panel.gridView.delegate("execute").to(dropdownView);
            panel.formButtonView.delegate("execute").to(dropdownView);

            // Runs after the dropdown and the block toolbar close and move the focus, so the form
            // opened here keeps it.
            dropdownView.on("execute", (evt) => {
                if (evt.source === panel.formButtonView) {
                    this.showForm();
                    return;
                }

                const { rows, columns } = panel.gridView;
                editor.execute("insertTable", { rows, columns });
                editor.editing.view.focus();
            });
        });

        return dropdownView;
    }

    private getFormView(): TableInsertFormView {
        if (this.formView) {
            return this.formView;
        }

        const editor = this.editor;
        const balloon = editor.plugins.get(ContextualBalloon);
        const form = new TableInsertFormView(editor.locale);
        this.formView = form;

        // Always registered: `Table` loads `TableEditing`.
        const command = editor.commands.get("insertTable") as InsertTableCommand;
        form.insertButtonView.bind("isEnabled").to(command);

        form.on("submit", () => {
            if (!command.isEnabled) {
                return;
            }

            const size = form.validate();
            if (size) {
                editor.execute("insertTable", size);
                this.hideForm(form);
            }
        });

        // Esc and a click outside close the form, as they do for the link balloon.
        form.keystrokes.set("Esc", (_data, cancel) => {
            this.hideForm(form);
            cancel();
        });
        clickOutsideHandler({
            emitter: form,
            activator: () => balloon.hasView(form),
            /* v8 ignore next -- the balloon renders its panel as the editor starts up */
            contextElements: () => balloon.view.element ? [balloon.view.element] : [],
            callback: () => this.hideForm(form)
        });

        return form;
    }
}

/**
 * The content of the `insertTable` dropdown: the "Insert table…" button, a separator and the
 * upstream size grid. The button and the separator form a dropdown list, so they look like the
 * items of the other dropdowns. Tab and Shift+Tab move the focus between the list and the grid.
 */
class InsertTablePanelView extends View {

    public readonly formButtonView: ButtonView;
    public readonly listView: ListView;
    public readonly gridView: InsertTableView;

    public readonly focusTracker = new FocusTracker();
    public readonly keystrokes = new KeystrokeHandler();

    private readonly focusables = new ViewCollection<FocusableView>();
    private readonly focusCycler: FocusCycler;

    constructor(locale: Locale) {
        super(locale);

        this.formButtonView = new ButtonView(locale);
        this.formButtonView.set({
            label: locale.t("Insert table…"),
            withText: true
        });

        const itemView = new ListItemView(locale);
        itemView.children.add(this.formButtonView);

        this.listView = new ListView(locale);
        this.listView.items.addMany([itemView, new ListSeparatorView(locale)]);

        this.gridView = new InsertTableView(locale);

        this.setTemplate({
            tag: "div",
            attributes: {
                class: ["ck", "ck-insert-table-dropdown__content"]
            },
            children: [this.listView, this.gridView]
        });

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

        for (const view of [this.listView, this.gridView]) {
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

    /**
     * Focuses the grid, as the upstream dropdown does when it opens. The focused grid box sets the
     * 1 × 1 size the grid label shows.
     */
    public focus(): void {
        this.gridView.focus();
    }
}

/** Places the balloon at the selection, the way the link balloon is placed. */
function getCaretPosition(editor: Editor): Partial<DomOptimalPositionOptions> {
    return {
        target: () => {
            const view = editor.editing.view;
            const range = view.document.selection.getFirstRange();
            /* v8 ignore next 3 -- the editing view has a selection once the editor is ready */
            if (!range) {
                return editor.ui.getEditableElement() as HTMLElement;
            }
            return view.domConverter.viewRangeToDom(range);
        }
    };
}
