import {
    addListToDropdown, Collection, createDropdown, ListItemGroupView, UIModel
} from "ckeditor5";
import type {
    ButtonView, Command, DropdownView, Editor, ListDropdownButtonDefinition,
    ListDropdownItemDefinition, Locale
} from "ckeditor5";

import { openListAsMenu } from "./toolbar_group_menu.js";

/** A row of a position dropdown: the value that it runs the command with, its label and icon. */
export interface PositionRow {
    value: string;
    label: string;
    icon: string;
}

/** The rows under one heading of a position dropdown, or rows without a heading. */
export interface PositionGroup {
    label?: string;
    rows: PositionRow[];
}

/** What a position dropdown is built from. */
export interface PositionDropdownOptions {
    commandName: string;
    label: string;
    groups: PositionGroup[];
    /**
     * The observable of the command that lists the values offered for the selected object. A row
     * not listed is hidden, and so is a group none of whose rows is. Every row shows when left out.
     */
    offeredProperty?: string;
}

/** A command with the observable that lists the values it offers now. */
type OfferingCommand = Command & Record<string, readonly string[]>;

/**
 * Creates a dropdown that runs `commandName` with the `value` of the row picked, as
 * `{ value }`. The rows are grouped by how text runs around the object, as Word and Google Docs
 * name it, and a group without rows is left out. The button shows the icon of the command's
 * value, or of the first row. As a menu of `ToolbarGroupMenu`, as on a phone, the rows are tiles
 * under their headings.
 */
export function createPositionDropdown(
    editor: Editor,
    locale: Locale,
    { commandName, label, groups, offeredProperty }: PositionDropdownOptions
): DropdownView {
    const command = editor.commands.get(commandName) as OfferingCommand;
    const rows = groups.flatMap((group) => group.rows);

    const items = new Collection<ListDropdownItemDefinition>();
    const shownGroups: PositionGroup[] = [];
    for (const group of groups) {
        const buttons = new Collection<ListDropdownButtonDefinition>();
        for (const row of group.rows) {
            buttons.add(createRow(row, command, offeredProperty));
        }
        if (!buttons.length) {
            continue;
        }
        if (group.label) {
            items.add({ type: "group", label: group.label, items: buttons });
            shownGroups.push(group);
        } else {
            items.addMany(buttons);
        }
    }

    const dropdown = createDropdown(locale);
    addListToDropdown(dropdown, items, { role: "menu" });
    if (offeredProperty) {
        // The list is built when the dropdown first opens, after `addListToDropdown` has.
        dropdown.once("change:isOpen", () => {
            const listView = dropdown.listView;
            /* v8 ignore next 3 -- `addListToDropdown` built the list as the dropdown opened */
            if (!listView) {
                return;
            }
            const groupViews = [ ...listView.items ]
                .filter((item) => item instanceof ListItemGroupView);
            for (const [ index, groupView ] of groupViews.entries()) {
                const group = shownGroups[index];
                groupView.bind("isVisible").to(command, offeredProperty, (offered) =>
                    group.rows.some((row) => offered.includes(row.value)));
            }
        }, { priority: "high" });
    }
    dropdown.buttonView.set({ label, tooltip: true });
    dropdown.buttonView.bind("icon").to(command, "value", (value) => {
        return (rows.find((row) => row.value === value) ?? rows[0])?.icon;
    });
    dropdown.bind("isEnabled").to(command);
    dropdown.on("execute", (evt) => {
        const { positionValue } = evt.source as ButtonView & { positionValue: string };
        editor.execute(commandName, { value: positionValue });
        editor.editing.view.focus();
    });
    openListAsMenu(dropdown, { layout: "tiles" });
    return dropdown;
}

function createRow(
    row: PositionRow, command: OfferingCommand, offeredProperty?: string
): ListDropdownButtonDefinition {
    const model = new UIModel({
        label: row.label,
        icon: row.icon,
        withText: true,
        role: "menuitemradio",
        positionValue: row.value
    });
    model.bind("isOn").to(command, "value", (value) => value === row.value);
    if (offeredProperty) {
        model.bind("isVisible").to(command, offeredProperty, (offered) =>
            offered.includes(row.value));
    }
    return { type: "button", model };
}
