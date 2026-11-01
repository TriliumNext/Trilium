import { afterEach, describe, expect, it, vi } from "vitest";

import contextMenu, { type ContextMenuEvent, type MenuItem } from "../../../menus/context_menu";
import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import type { PromotedAttributeSetting } from "../promoted_attributes";
import { openCalendarContextMenu } from "./context_menu";

vi.mock("../../../menus/link_context_menu", () => ({
    default: {
        getItems: () => [ { title: "Open note" } ],
        handleLinkContextMenuItem: () => {}
    }
}));

// i18next is never initialised under test, so `t` echoes the key with the name it interpolates.
vi.mock("../../../services/i18n", () => ({
    t: (key: string, values?: { name?: string }) => (values?.name ? `${key}:${values.name}` : key),
    translationsInitializedPromise: Promise.resolve()
}));

afterEach(() => vi.restoreAllMocks());

describe("openCalendarContextMenu", () => {
    it("offers the attributes the events show, under the board's rules", () => {
        const items = open([
            { name: "done" }, { name: "priority" }, { name: "notes" }, { name: "startDate" }
        ]);

        expect(titles(items)).toContain("attribute_menu.attributes");
        expect(titles(items)).toContain(name("done"));
        expect(titles(items)).toContain(name("priority"));
        // Text needs a field to type into.
        expect(titles(items)).not.toContain(name("notes"));
        // The date an event is drawn at is the calendar's own.
        expect(titles(items)).not.toContain(name("startDate"));
    });

    it("puts no separator above the section's heading, which draws its own line", () => {
        const items = open([ { name: "done" } ]);
        const heading = items.findIndex((item) => "kind" in item && item.kind === "header");

        expect(heading).toBeGreaterThan(0);
        expect(items[heading - 1]).not.toMatchObject({ kind: "separator" });
        // Without the section, a separator still parts the open-in entries from Archive.
        expect(open([ { name: "done", hidden: true } ])[1]).toMatchObject({ kind: "separator" });
    });

    it("leaves out what the calendar hides, including what its settings never named", () => {
        const items = open([ { name: "done", hidden: true } ]);

        expect(titles(items)).not.toContain(name("done"));
        expect(titles(items)).not.toContain(name("priority"));
        expect(titles(items)).not.toContain("attribute_menu.attributes");
    });

    it("offers no attributes on a read-only calendar", () => {
        const items = open([ { name: "done" } ], true);

        expect(titles(items)).not.toContain("attribute_menu.attributes");
    });
});

/** Opens the menu of an event on a calendar defining a flag, a state, text and a start date. */
function open(settings: PromotedAttributeSetting[], isReadOnly = false) {
    const calendar = buildNote({
        title: "Calendar",
        "#label:done(inheritable)": "promoted,single,boolean",
        "#label:priority(inheritable)": "promoted,single,select,options=Low;High",
        "#label:notes(inheritable)": "promoted,single,text",
        "#label:startDate(inheritable)": "promoted,single,date",
        children: [ { title: "Event", "#startDate": "2026-10-21" } ]
    });
    const event = froca.notes[calendar.getChildNoteIds()[0] ?? ""];
    if (!event) throw new Error("expected the event to be built");

    const show = vi.spyOn(contextMenu, "show").mockResolvedValue(undefined);
    openCalendarContextMenu(fakeEvent(), event, calendar, undefined, isReadOnly, settings);
    const items = show.mock.calls.at(-1)?.[0].items;
    if (!items) throw new Error("expected the menu to open");
    return items;
}

function fakeEvent() {
    return { pageX: 0, pageY: 0, preventDefault() {}, stopPropagation() {} } as unknown as ContextMenuEvent;
}

const titles = (items: MenuItem<unknown>[]) =>
    items.map((item) => (item && "title" in item ? item.title : undefined));

/** An untitled label's entry, as `defaultTitle()` names it. */
const name = (label: string) =>
    `<span class="tn-menu-name">promoted_attributes.label_name:${label}</span>`;
