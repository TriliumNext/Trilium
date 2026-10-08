import {
    addListToDropdown,
    ButtonView,
    Collection,
    createDropdown,
    type ListDropdownGroupDefinition,
    type Locale,
    Plugin,
    UIModel,
    WidgetToolbarRepository
} from "ckeditor5";

import multicolumnIcon from "../../icons/multicolumn.svg?raw";
import { findSelectedWidget } from "../widget_utils.js";
import { COLUMN_RATIOS, getColumnCount, LAYOUT_WIDGET_PROPERTY } from "./constants.js";
import type {
    ColumnLayoutCommand, InsertMulticolumnLayoutCommand
} from "./multicolumn_commands.js";

/**
 * The insert button for multicolumn layouts, and the contextual toolbar with the column layout
 * dropdown, shown while the selection is inside a layout.
 */
export default class MulticolumnUI extends Plugin {

    public static get pluginName() {
        return "MulticolumnUI" as const;
    }

    public static get requires() {
        return [WidgetToolbarRepository] as const;
    }

    public init(): void {
        const factory = this.editor.ui.componentFactory;
        factory.add("multicolumnLayout", locale => this.createInsertButton(locale));
        factory.add("columnLayout", locale => this.createLayoutDropdown(locale));
    }

    public afterInit(): void {
        this.editor.plugins.get(WidgetToolbarRepository).register("multicolumnLayout", {
            ariaLabel: this.editor.t("Multicolumn layout toolbar"),
            items: ["columnLayout"],
            getRelatedElement: selection => findSelectedWidget(selection, LAYOUT_WIDGET_PROPERTY)
        });
    }

    private createInsertButton(locale: Locale) {
        const editor = this.editor;
        // MulticolumnEditing, which the glue plugin loads first, registers every command.
        const command = editor.commands.get("multicolumnLayout") as InsertMulticolumnLayoutCommand;
        const button = new ButtonView(locale);
        button.set({ label: editor.t("Multicolumn layout"), icon: multicolumnIcon, tooltip: true });
        button.bind("isEnabled").to(command, "isEnabled");

        this.listenTo(button, "execute", () => {
            editor.execute("multicolumnLayout");
            editor.editing.view.focus();
        });
        return button;
    }

    /** A dropdown of every column layout, grouped by column count. */
    private createLayoutDropdown(locale: Locale) {
        const editor = this.editor;
        const t = editor.t;
        const command = editor.commands.get("columnLayout") as ColumnLayoutCommand;
        const dropdown = createDropdown(locale);
        dropdown.buttonView.set({ withText: true, tooltip: t("Column layout") });
        dropdown.buttonView.bind("label").to(command, "value", value =>
            value ? formatRatios(value) : "");
        dropdown.bind("isEnabled").to(command, "isEnabled");

        const groups = new Map<number, ListDropdownGroupDefinition>();
        for (const ratios of COLUMN_RATIOS) {
            const count = getColumnCount(ratios);
            let group = groups.get(count);
            if (!group) {
                group = { type: "group", label: t("%0 columns", count), items: new Collection() };
                groups.set(count, group);
            }

            const model = new UIModel({
                label: formatRatios(ratios),
                ratios,
                role: "menuitemradio",
                withText: true
            });
            model.bind("isOn").to(command, "value", value => value === ratios);
            group.items.add({ type: "button", model });
        }
        addListToDropdown(dropdown, new Collection([...groups.values()]), { role: "menu" });

        this.listenTo(dropdown, "execute", evt => {
            const { ratios } = evt.source as unknown as { ratios: string };
            editor.execute("columnLayout", { value: ratios });
            editor.editing.view.focus();
        });
        return dropdown;
    }
}

/** Formats column weights as rounded percentages, such as `25%-75%` for `1-3`. */
export function formatRatios(ratios: string): string {
    const weights = ratios.split("-").map(Number);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.map(weight => `${Math.round(weight / total * 100)}%`).join("-");
}
