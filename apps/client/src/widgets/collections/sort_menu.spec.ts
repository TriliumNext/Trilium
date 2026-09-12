import { describe, expect, it, vi } from "vitest";

import type { MenuItem } from "../../menus/context_menu";
import type { PromotedAttribute } from "./promoted_attributes";
import {
    buildSortMenuItems, sortEntries, sortMenuTitle, type SortMenuOptions
} from "./sort_menu";

// i18next is never initialised under test, so `t` echoes the key it is given.
vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));

describe("buildSortMenuItems", () => {
    it("offers the collection's own order, no sorting, the built-in keys and the direction", () => {
        expect(icons(build())).toEqual([
            "bx bx-collection",
            "bx bx-move-vertical",
            "bx bx-text",
            "bx bx-calendar-plus",
            "separator",
            "bx bx-sort-up",
            "bx bx-sort-down"
        ]);
    });

    it("names both fallbacks itself, and lets the caller name them otherwise", () => {
        expect(titles(build()).slice(0, 2)).toEqual([ "sorting.default", "sorting.none" ]);
        expect(titles(build({ defaultTitle: "Board's default", noneTitle: "Manually" }))
            .slice(0, 2)).toEqual([ "Board's default", "Manually" ]);
    });

    /** The menu that sets the collection's own order has nothing above it to take one from. */
    it("leaves out the collection's own order where the caller hides it", () => {
        expect(titles(build({ hideDefault: true }))[0]).toBe("sorting.none");
        expect(icons(build({ hideDefault: true }))).not.toContain("bx bx-collection");
    });

    it("checks no sorting while nothing is sorted, and offers no direction", () => {
        const items = build();

        expect(items[1]).toMatchObject({ trailingIcon: "bx bx-check" });
        expect(items[2]).toMatchObject({ trailingIcon: undefined });
        expect(items.at(-2)).toMatchObject({ enabled: false, trailingIcon: undefined });
        expect(items.at(-1)).toMatchObject({ enabled: false, trailingIcon: undefined });
    });

    /** The order comes from above with a direction of its own, so there is none to pick here. */
    it("checks the collection's own order, and offers no direction with it", () => {
        const items = build({ orderBy: "default", isDescending: true });

        expect(items[0]).toMatchObject({ trailingIcon: "bx bx-check" });
        expect(items[1]).toMatchObject({ trailingIcon: undefined });
        expect(items.at(-2)).toMatchObject({ enabled: false });
        expect(items.at(-1)).toMatchObject({ enabled: false, trailingIcon: "bx bx-check" });
    });

    it("checks the key it sorts by, and the direction it sorts in", () => {
        const ascending = build({ orderBy: "title" });
        expect(ascending[1]).toMatchObject({ trailingIcon: undefined });
        expect(ascending[2]).toMatchObject({ trailingIcon: "bx bx-check" });
        expect(ascending.at(-2)).toMatchObject({ enabled: true, trailingIcon: "bx bx-check" });
        expect(ascending.at(-1)).toMatchObject({ enabled: true, trailingIcon: undefined });

        const descending = build({ orderBy: "title", isDescending: true });
        expect(descending.at(-2)).toMatchObject({ trailingIcon: undefined });
        expect(descending.at(-1)).toMatchObject({ trailingIcon: "bx bx-check" });
    });

    it("lists the attributes under the built-in keys, each with its own icon", () => {
        const items = build({
            orderBy: "attr:owner",
            attributes: [
                attribute({ name: "dueDate", title: "Due date", labelType: "date" }),
                attribute({ name: "owner", title: "Owner", type: "relation" })
            ]
        });

        expect(titles(items).slice(4, 6)).toEqual([
            `<span class="tn-menu-name">Due date</span>`,
            `<span class="tn-menu-name">Owner</span>`
        ]);
        expect(items[4]).toMatchObject({ uiIcon: "bx bx-calendar", trailingIcon: undefined });
        expect(items[5]).toMatchObject({ uiIcon: "bx bx-transfer", trailingIcon: "bx bx-check" });
    });

    it("escapes what a crafted attribute name would plant in the menu", () => {
        const items = build({
            attributes: [ attribute({ name: "x", title: `<img src=x onerror="alert(1)">` }) ]
        });

        expect(titles(items)[4]).toBe("<span class=\"tn-menu-name\">"
            + "&lt;img src&#x3D;x onerror&#x3D;&quot;alert(1)&quot;&gt;</span>");
    });

    it("reports the key a pick names, and no key at all for the manual order", () => {
        const onSelect = vi.fn();
        const items = build({
            attributes: [ attribute({ name: "dueDate", title: "Due date" }) ]
        }, { onSelect });

        pick(items[0]);
        expect(onSelect).toHaveBeenCalledWith("default");

        pick(items[2]);
        expect(onSelect).toHaveBeenCalledWith("title");

        pick(items[3]);
        expect(onSelect).toHaveBeenCalledWith("creationDate");

        pick(items[4]);
        expect(onSelect).toHaveBeenCalledWith("attr:dueDate");

        pick(items[1]);
        expect(onSelect).toHaveBeenCalledWith(undefined);
    });

    it("reports the direction a pick names", () => {
        const onDirectionChange = vi.fn();
        const items = build({ orderBy: "title" }, { onDirectionChange });

        pick(items.at(-1));
        expect(onDirectionChange).toHaveBeenCalledWith(true);

        pick(items.at(-2));
        expect(onDirectionChange).toHaveBeenCalledWith(false);
    });
});

describe("sortEntries", () => {
    const attributes = [ attribute({ name: "dueDate", title: "Due date" }) ];

    it("offers the orders a collection can take, each named and iconed once", () => {
        const { orders, directions } = entries({ attributes });

        expect(orders.map((entry) => [ entry.key, entry.title, entry.icon ])).toEqual([
            [ "default", "sorting.default", "bx bx-collection" ],
            [ "none", "sorting.none", "bx bx-move-vertical" ],
            [ "title", "sorting.title", "bx bx-text" ],
            [ "creationDate", "sorting.creation-date", "bx bx-calendar-plus" ],
            // Named as the collection names it, and worn by the icon of what it holds.
            [ "attr:dueDate", "Due date", "bx bx-text" ]
        ]);
        expect(directions.map((entry) => entry.key)).toEqual([ "ascending", "descending" ]);
        // Only a name the user wrote is escaped and clipped where a menu draws it.
        expect(orders.map((entry) => entry.isUserNamed))
            .toEqual([ false, false, false, false, true ]);
    });

    it("marks the order the collection is in, and turns the direction off while it has none", () => {
        const unsorted = entries({ attributes });
        expect(unsorted.orders.map((entry) => entry.isSelected))
            .toEqual([ false, true, false, false, false ]);
        expect(unsorted.directions.map((entry) => entry.isEnabled)).toEqual([ false, false ]);

        const sorted = entries({ attributes, orderBy: "attr:dueDate", isDescending: true });
        expect(sorted.orders.map((entry) => entry.isSelected))
            .toEqual([ false, false, false, false, true ]);
        expect(sorted.directions.map((entry) => entry.isSelected)).toEqual([ false, true ]);
        expect(sorted.directions.map((entry) => entry.isEnabled)).toEqual([ true, true ]);
    });

    it("reports what a pick names", () => {
        const onSelect = vi.fn();
        const onDirectionChange = vi.fn();
        const { orders, directions } = entries({ attributes }, { onSelect, onDirectionChange });

        orders[4].pick();
        expect(onSelect).toHaveBeenCalledWith("attr:dueDate");

        orders[0].pick();
        expect(onSelect).toHaveBeenLastCalledWith("default");

        orders[1].pick();
        expect(onSelect).toHaveBeenLastCalledWith(undefined);

        directions[1].pick();
        expect(onDirectionChange).toHaveBeenCalledWith(true);
    });

    function entries(
        options: Partial<SortMenuOptions> = {},
        handlers: Partial<Pick<SortMenuOptions, "onSelect" | "onDirectionChange">> = {}
    ) {
        return sortEntries({
            orderBy: undefined,
            isDescending: false,
            attributes: [],
            onSelect: handlers.onSelect ?? (() => {}),
            onDirectionChange: handlers.onDirectionChange ?? (() => {}),
            ...options
        });
    }
});

describe("sortMenuTitle", () => {
    const attributes = [ attribute({ name: "dueDate", title: "Due date" }) ];

    it("names the built-in keys, and the manual order by what the caller calls it", () => {
        expect(sortMenuTitle({ orderBy: undefined, attributes })).toBe("sorting.none");
        expect(sortMenuTitle({ orderBy: undefined, attributes, noneTitle: "Manually" }))
            .toBe("Manually");
        expect(sortMenuTitle({ orderBy: "title", attributes })).toBe("sorting.title");
        expect(sortMenuTitle({ orderBy: "creationDate", attributes }))
            .toBe("sorting.creation-date");
    });

    it("names an attribute as the collection names it, and an unknown one by its own name", () => {
        expect(sortMenuTitle({ orderBy: "attr:dueDate", attributes })).toBe("Due date");
        expect(sortMenuTitle({ orderBy: "attr:owner", attributes })).toBe("owner");
    });
});

function build(
    options: Partial<SortMenuOptions> = {},
    handlers: Partial<Pick<SortMenuOptions, "onSelect" | "onDirectionChange">> = {}
) {
    return buildSortMenuItems<string>({
        orderBy: undefined,
        isDescending: false,
        attributes: [],
        onSelect: handlers.onSelect ?? (() => {}),
        onDirectionChange: handlers.onDirectionChange ?? (() => {}),
        ...options
    });
}

function attribute(fields: Partial<PromotedAttribute> & { name: string }): PromotedAttribute {
    return {
        definitionName: `label:${fields.name}`,
        type: "label",
        title: fields.name,
        hidden: false,
        definitionValue: "",
        isOwned: true,
        isInheritable: true,
        ...fields
    };
}

const titles = (items: MenuItem<string>[]) =>
    items.map(item => (item && "title" in item ? item.title : "separator"));

const icons = (items: MenuItem<string>[]) =>
    items.map(item => (item && "uiIcon" in item ? item.uiIcon : "separator"));

function pick(item: MenuItem<string> | undefined) {
    if (!item || !("handler" in item)) throw new Error("expected a menu entry");
    item.handler?.(item, {} as never);
}
