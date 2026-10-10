import {
    addListToDropdown,
    ButtonView,
    Collection,
    type Command,
    createDropdown,
    focusChildOnDropdownOpen,
    IconRemove,
    type ListDropdownItemDefinition,
    type Locale,
    Plugin,
    SplitButtonView,
    ViewModel,
    WidgetToolbarRepository
} from "ckeditor5";

import multicolumnIcon from "../../icons/multicolumn.svg?raw";
import TileRowView from "../tile_row_view.js";
import { findSelectedWidget } from "../widget_utils.js";
import {
    COLUMN_RATIOS, getColumnCount, getDefaultRatios, LAYOUT_WIDGET_PROPERTY, MAX_COLUMNS,
    MIN_COLUMNS
} from "./constants.js";
import type { ColumnLayoutCommand } from "./multicolumn_commands.js";

/**
 * The insert split button for multicolumn layouts, and the contextual toolbar with the column
 * layout dropdown and the remove button, shown while the selection is inside a layout.
 */
export default class MulticolumnUI extends Plugin {

    public static get pluginName() {
        return "MulticolumnUI" as const;
    }

    public static get requires() {
        return [WidgetToolbarRepository] as const;
    }

    public init(): void {
        const t = this.editor.t;
        const factory = this.editor.ui.componentFactory;
        factory.add("multicolumnLayout", locale => this.createInsertDropdown(locale));
        factory.add("columnLayout", locale => this.createLayoutDropdown(locale));
        this.addCommandButton("removeMulticolumnLayout", t("Remove layout"), IconRemove);
    }

    public afterInit(): void {
        this.editor.plugins.get(WidgetToolbarRepository).register("multicolumnLayout", {
            ariaLabel: this.editor.t("Multicolumn layout toolbar"),
            items: ["columnLayout", "removeMulticolumnLayout"],
            getRelatedElement: selection => findSelectedWidget(selection, LAYOUT_WIDGET_PROPERTY)
        });
    }

    /** Adds a button named after the command it runs. */
    private addCommandButton(name: string, label: string, icon: string) {
        const editor = this.editor;
        editor.ui.componentFactory.add(name, locale => {
            // MulticolumnEditing, which the glue plugin loads first, registers every command.
            const command = editor.commands.get(name) as Command;
            const button = new ButtonView(locale);
            button.set({ label, icon, tooltip: true });
            button.bind("isEnabled").to(command, "isEnabled");

            this.listenTo(button, "execute", () => {
                editor.execute(name);
                editor.editing.view.focus();
            });
            return button;
        });
    }

    /**
     * A split button that inserts two equal columns, with a list that inserts two to four equal
     * columns.
     */
    private createInsertDropdown(locale: Locale) {
        const editor = this.editor;
        const command = editor.commands.get("multicolumnLayout") as Command;
        const dropdown = createDropdown(locale, SplitButtonView);
        dropdown.buttonView.set({
            label: editor.t("Multiple column layout"),
            icon: multicolumnIcon,
            tooltip: true
        });
        // `createDropdown` binds the split button's `isEnabled` to the dropdown's.
        dropdown.bind("isEnabled").to(command, "isEnabled");

        const items = new Collection<ListDropdownItemDefinition>();
        for (let count = MIN_COLUMNS; count <= MAX_COLUMNS; count++) {
            const ratios = getDefaultRatios(count);
            items.add({
                type: "button",
                model: new ViewModel({
                    commandParam: ratios,
                    label: editor.t("%0 columns", count),
                    icon: createLayoutFigure(ratios, BUTTON_ICON_SIZE),
                    role: "menuitem",
                    withText: true
                })
            });
        }
        addListToDropdown(dropdown, items);

        const insert = (value?: string) => {
            editor.execute("multicolumnLayout", { value });
            editor.editing.view.focus();
        };
        this.listenTo(dropdown.buttonView, "execute", () => insert());
        this.listenTo(dropdown, "execute", evt =>
            insert((evt.source as { commandParam?: string }).commandParam));
        return dropdown;
    }

    /**
     * A dropdown with a figure of every column layout, grouped by column count. Its button shows
     * the figure and the column count of the current layout.
     */
    private createLayoutDropdown(locale: Locale) {
        const editor = this.editor;
        const label = editor.t("Column layout");
        const command = editor.commands.get("columnLayout") as ColumnLayoutCommand;
        const getCountLabel = (ratios: string | undefined) =>
            ratios && editor.t("%0 columns", getColumnCount(ratios));
        const dropdown = createDropdown(locale);
        dropdown.buttonView.set({ ariaLabelledBy: undefined, withText: true, tooltip: label });
        dropdown.buttonView.bind("icon").to(command, "value", value =>
            value ? createLayoutFigure(value, BUTTON_ICON_SIZE) : multicolumnIcon);
        dropdown.buttonView.bind("label").to(command, "value", value =>
            getCountLabel(value) || label);
        dropdown.buttonView.bind("ariaLabel").to(command, "value", value => {
            const countLabel = getCountLabel(value);
            return countLabel ? `${countLabel}, ${label}` : label;
        });
        dropdown.bind("isEnabled").to(command, "isEnabled");

        const groups = new Map<number, ButtonView[]>();
        for (const ratios of COLUMN_RATIOS) {
            const count = getColumnCount(ratios);
            const tile = new ButtonView(locale);
            tile.set({
                label: editor.t("%0 columns (%1)", [count, formatRatios(ratios)]),
                icon: createLayoutFigure(ratios, TILE_ICON_SIZE),
                tooltip: true,
                isToggleable: true
            });
            tile.bind("isOn").to(command, "value", value => value === ratios);
            this.listenTo(tile, "execute", () => {
                editor.execute("columnLayout", { value: ratios });
                editor.editing.view.focus();
            });
            groups.set(count, [...groups.get(count) ?? [], tile]);
        }

        const row = new TileRowView(locale, [...groups.values()], label);
        row.delegate("execute").to(dropdown);
        dropdown.panelView.children.add(row);
        focusChildOnDropdownOpen(dropdown, () => row.tiles.find(tile => tile.isOn));
        return dropdown;
    }
}

/** Formats column weights as rounded percentages, such as `25%-75%` for `1-3`. */
export function formatRatios(ratios: string): string {
    return getShares(ratios).map(share => `${Math.round(share * 100)}%`).join("-");
}

/**
 * Draws column weights as a square icon of `size` pixels: a rounded rectangle split into columns by
 * dotted lines, with 4px of padding and corner radius at 44px. The outline, the dots and the gap
 * between the end dots and the outline are in pixels, so each size has a drawing of its own.
 */
export function createLayoutFigure(ratios: string, size: number): string {
    const outline = 1.5;
    const dotRadius = 1;
    const padding = size / 11;
    const width = size - 2 * padding;
    const top = size * .15;
    const height = size * .7;
    const inset = outline / 2 + 1 + dotRadius;
    const span = height - 2 * inset;
    const steps = Math.max(1, Math.round(span / 3));

    let edge = padding;
    const dots = getShares(ratios).slice(0, -1).flatMap(share => {
        edge += share * width;
        return Array.from({ length: steps + 1 }, (_, step) => {
            const y = top + inset + span * step / steps;
            return `<circle cx="${round(edge)}" cy="${round(y)}" r="${dotRadius}"/>`;
        });
    });

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">` +
        `<rect x="${round(padding)}" y="${round(top)}" width="${round(width)}" ` +
        `height="${round(height)}" rx="${round(padding)}" fill="none" stroke="currentColor" ` +
        `stroke-width="${outline}"/><g fill="currentColor">${dots.join("")}</g></svg>`;
}

/** The icon sizes of a list style tile and of a toolbar button, in pixels. */
const TILE_ICON_SIZE = 44;
export const BUTTON_ICON_SIZE = 20;

function getShares(ratios: string) {
    const weights = ratios.split("-").map(Number);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.map(weight => weight / total);
}

function round(value: number) {
    return Math.round(value * 100) / 100;
}
