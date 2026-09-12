import "./SortDropdown.css";

import clsx from "clsx";

import Dropdown from "../react/Dropdown";
import { FormDropdownDivider, FormListItem } from "../react/FormList";
import Icon from "../react/Icon";
import { type SortEntry, sortEntries, type SortMenuOptions, sortMenuTitle } from "./sort_menu";

/**
 * The order a collection puts its items in, picked from a dropdown.
 *
 * The same entries the sort menu offers, for a settings card: a control there is read alongside the
 * toggles and fields around it, which a button opening a context menu is not.
 */
export default function SortDropdown({
    className, ...options
}: SortMenuOptions & { className?: string }) {
    const { orderBy, isDescending, attributes, noneTitle, defaultTitle } = options;
    const { orders, directions } = sortEntries(options);

    return (
        <Dropdown
            className={clsx("sort-dropdown", className)}
            text={<>
                <Icon icon={isDescending ? "bx bx-sort-down" : "bx bx-sort-up"} />
                {sortMenuTitle({ orderBy, attributes, noneTitle, defaultTitle })}
            </>}
            mobileBottomSheet
            // The card the dropdown stands in is a backdrop root, which would otherwise flatten the
            // menu's blur into a tint.
            portalToBody
        >
            {orders.map(renderEntry)}
            <FormDropdownDivider />
            {directions.map(renderEntry)}
        </Dropdown>
    );
}

function renderEntry(entry: SortEntry) {
    return (
        <FormListItem
            key={entry.key}
            icon={entry.icon}
            selected={entry.isSelected}
            disabled={!entry.isEnabled}
            onClick={entry.pick}
        >
            {entry.title}
        </FormListItem>
    );
}
