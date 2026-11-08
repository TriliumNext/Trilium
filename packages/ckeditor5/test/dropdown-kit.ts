import {
    ButtonView, type DropdownView, ListItemGroupView, ListItemView, type ListView, type View
} from "ckeditor5";

/**
 * The rows of the list of `dropdown`, which opens once to build it: a heading as `# label`, and a
 * row that is on with a check.
 */
export function getListRows(dropdown: DropdownView) {
    dropdown.isOpen = true;
    dropdown.isOpen = false;
    const text = (items: Iterable<View>): string[] => [ ...items ].flatMap((item) => {
        if (item instanceof ListItemGroupView) return [ `# ${item.label}`, ...text(item.items) ];
        const button = item instanceof ListItemView ? item.children.first : null;
        if (!(button instanceof ButtonView)) return [];
        return [ button.isOn ? `${button.label} ✓` : button.label ?? "" ];
    });
    return text((dropdown.listView as ListView).items);
}

/** The button of the row `label` under the heading `heading` of the list of `dropdown`. */
export function getListRow(dropdown: DropdownView, heading: string, label: string) {
    dropdown.isOpen = true;
    const isHeading = (item: View): item is ListItemGroupView => {
        return item instanceof ListItemGroupView && item.label === heading;
    };
    const group = [ ...(dropdown.listView as ListView).items ].find(isHeading);
    const button = [ ...group?.items ?? [] ]
        .map((item) => (item instanceof ListItemView ? item.children.first : null))
        .find((view): view is ButtonView => view instanceof ButtonView && view.label === label);
    if (!button) throw new Error(`expected "${label}" under "${heading}"`);
    return button;
}

/** Runs the row `label` under the heading `heading` of the list of `dropdown`. */
export function pickListRow(dropdown: DropdownView, heading: string, label: string) {
    getListRow(dropdown, heading, label).fire("execute");
}
