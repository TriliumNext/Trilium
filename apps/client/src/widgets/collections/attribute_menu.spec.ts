import { beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../entities/fnote";
import type { MenuCommandItem, MenuItem } from "../../menus/context_menu";
import froca from "../../services/froca";
import { buildNote } from "../../test/easy-froca";
import DatePicker from "../react/DatePicker";
import { buildAttributeMenuItems } from "./attribute_menu";
import type { PromotedAttribute } from "./promoted_attributes";

// The writes alone, so the rest of the service reads a note the way the application does.
const writes = vi.hoisted(() => ({ setLabelValues: vi.fn() }));
vi.mock("../../services/attributes", async (importOriginal) => ({
    ...await importOriginal<object>(),
    ...writes
}));

// The picker is a component of its own, with its own spec; here only what it is handed counts.
vi.mock("../react/DatePicker", () => ({ default: vi.fn(() => null) }));

// i18next is never initialised under test, so `t` echoes the key it is given.
vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));

beforeEach(() => vi.clearAllMocks());

describe("buildAttributeMenuItems", () => {
    it("lists the flags and states an item shows, in order, under one heading", () => {
        const items = build({ title: "Card" }, [
            attribute({ name: "done", title: "Done", labelType: "boolean" }),
            attribute({ name: "notes", title: "Notes", labelType: "text" }),
            attribute({
                name: "state", title: "State", labelType: "select", selectOptions: [ "A" ]
            }),
            attribute({ name: "owner", title: "Owner", type: "relation" }),
            attribute({ name: "urgent", title: "Urgent", labelType: "boolean", hidden: true })
        ]);

        expect(items[0]).toEqual({ kind: "header", title: "attribute_menu.attributes" });
        expect(titles(items).slice(1)).toEqual([
            `<span class="tn-menu-name">Done</span>`,
            `<span class="tn-menu-name">State</span>`
        ]);
        expect(items[1]).toMatchObject({ uiIcon: "bx bx-toggle-left" });
        expect(items[2]).toMatchObject({ uiIcon: "bx bx-list-ul" });
    });

    it("answers with nothing where no attribute can be set from a menu", () => {
        expect(build({ title: "Card" }, [])).toEqual([]);
        expect(build({ title: "Card" }, [
            attribute({ name: "notes", title: "Notes", labelType: "text" }),
            // A select offering nothing would open on "Not set" alone.
            attribute({ name: "state", title: "State", labelType: "select" }),
            // Items that define it in different ways would be offered one item's options.
            attribute({
                name: "priority", title: "Priority", labelType: "select",
                selectOptions: [ "Low" ], isConflicting: true
            }),
            attribute({ name: "done", title: "Done", labelType: "boolean", isConflicting: true })
        ])).toEqual([]);
    });

    it("lets the caller name the section", () => {
        const items = build({ title: "Card" }, [
            attribute({ name: "done", title: "Done", labelType: "boolean" })
        ], "Fields");

        expect(items[0]).toEqual({ kind: "header", title: "Fields" });
    });

    describe("a flag", () => {
        const flag = [ attribute({ name: "done", title: "Done", labelType: "boolean" }) ];

        it("is marked while the item carries it, and turned off when picked", () => {
            const note = buildNote({ title: "Card", "#done": "true" });
            const items = buildAttributeMenuItems<string>({ notes: [ note ], attributes: flag });

            expect(items[1]).toMatchObject({ checked: true });
            pick(items[1]);
            expect(writes.setLabelValues).toHaveBeenCalledWith(note, "done", [ "false" ]);
        });

        it("is unmarked while the item does not, and turned on when picked", () => {
            const note = buildNote({ title: "Card" });
            const items = buildAttributeMenuItems<string>({ notes: [ note ], attributes: flag });

            expect(items[1]).toMatchObject({ checked: false });
            pick(items[1]);
            expect(writes.setLabelValues).toHaveBeenCalledWith(note, "done", [ "true" ]);
        });

        it("is marked only while every selected item carries it", () => {
            const set = buildNote({ title: "One", "#done": "true" });
            const unset = buildNote({ title: "Two" });

            expect(buildAttributeMenuItems<string>({ notes: [ set, unset ], attributes: flag })[1])
                .toMatchObject({ checked: false });
            expect(buildAttributeMenuItems<string>({
                notes: [ set, buildNote({ title: "Three", "#done": "true" }) ], attributes: flag
            })[1]).toMatchObject({ checked: true });
        });

        it("writes the value to every selected item, settling a disagreement", async () => {
            const set = buildNote({ title: "One", "#done": "true" });
            const unset = buildNote({ title: "Two" });

            await pick(
                buildAttributeMenuItems<string>({ notes: [ set, unset ], attributes: flag })[1]);

            expect(writes.setLabelValues).toHaveBeenCalledWith(set, "done", [ "true" ]);
            expect(writes.setLabelValues).toHaveBeenCalledWith(unset, "done", [ "true" ]);
        });

        // The stored values are the checkbox's own, so the entry says what the item draws: a box
        // the user unchecked holds "false", and anything else was never set through the field.
        it("counts every value but true as unset", () => {
            for (const value of [ "false", "", "yes" ]) {
                const note = buildNote({ title: "Card", "#done": value });
                const items = buildAttributeMenuItems<string>({
                    notes: [ note ], attributes: flag
                });

                expect(items[1]).toMatchObject({ checked: false });
            }
        });
    });

    describe("a state", () => {
        const state = [ attribute({
            name: "state",
            title: "State",
            labelType: "select",
            selectOptions: [ "To Do", "Doing", "Done" ]
        }) ];

        /** The entries a state's submenu offers, the caller having none of its own to add. */
        function options(...notes: FNote[]) {
            const items = buildAttributeMenuItems<string>({ notes, attributes: state });
            const entry = items[1];
            if (!entry || !("items" in entry)) throw new Error("expected a submenu");
            return entry.items ?? [];
        }

        it("offers the options as defined, below Not set and a separator, and no icons", () => {
            const items = options(buildNote({ title: "Card" }));

            expect(titles(items)).toEqual([
                `<span class="tn-menu-name">attribute_menu.not-set</span>`,
                "separator",
                `<span class="tn-menu-name">To Do</span>`,
                `<span class="tn-menu-name">Doing</span>`,
                `<span class="tn-menu-name">Done</span>`
            ]);
            expect(items.every(item => !("uiIcon" in item) || !item.uiIcon)).toBe(true);
        });

        it("marks the option the item holds", () => {
            const items = options(buildNote({ title: "Card", "#state": "Doing" }));

            expect(marked(items)).toEqual([ `<span class="tn-menu-name">Doing</span>` ]);
        });

        it("marks Not set while the item holds none", () => {
            expect(marked(options(buildNote({ title: "Card" }))))
                .toEqual([ `<span class="tn-menu-name">attribute_menu.not-set</span>` ]);
        });

        it("marks nothing for a value the definition no longer offers", () => {
            expect(marked(options(buildNote({ title: "Card", "#state": "Parked" })))).toEqual([]);
        });

        it("writes the option picked, and takes the value off for Not set", () => {
            const note = buildNote({ title: "Card", "#state": "Doing" });
            const items = options(note);

            pick(items[3]);
            expect(writes.setLabelValues).toHaveBeenCalledWith(note, "state", [ "Doing" ]);

            pick(items[0]);
            expect(writes.setLabelValues).toHaveBeenCalledWith(note, "state", []);
        });

        it("marks the option only while every selected item holds it", () => {
            const doing = buildNote({ title: "One", "#state": "Doing" });

            expect(marked(options(doing, buildNote({ title: "Two", "#state": "Doing" }))))
                .toEqual([ `<span class="tn-menu-name">Doing</span>` ]);
            expect(marked(options(doing, buildNote({ title: "Two", "#state": "Done" }))))
                .toEqual([]);
            expect(marked(options(doing, buildNote({ title: "Two" })))).toEqual([]);
        });

        it("marks Not set only while every selected item holds none", () => {
            const unset = buildNote({ title: "One" });

            expect(marked(options(unset, buildNote({ title: "Two" }))))
                .toEqual([ `<span class="tn-menu-name">attribute_menu.not-set</span>` ]);
            expect(marked(options(unset, buildNote({ title: "Two", "#state": "Doing" }))))
                .toEqual([]);
        });

        it("writes the option picked to every selected item", async () => {
            const first = buildNote({ title: "One" });
            const second = buildNote({ title: "Two", "#state": "Done" });

            await pick(options(first, second)[3]);

            expect(writes.setLabelValues).toHaveBeenCalledWith(first, "state", [ "Doing" ]);
            expect(writes.setLabelValues).toHaveBeenCalledWith(second, "state", [ "Doing" ]);
        });

        /**
         * Only the labels a note owns are removed, so a note with nothing of its own would keep the
         * value it inherits. An empty label of its own overrides it.
         */
        it("overrides an inherited value rather than removing nothing", () => {
            const parent = buildNote({
                title: "Parent",
                "#state(inheritable)": "Doing",
                children: [ { title: "Card" } ]
            });
            const note = froca.notes[parent.getChildNoteIds()[0]];
            if (!note) throw new Error("expected the card to be built");

            pick(options(note)[0]);
            expect(writes.setLabelValues).toHaveBeenCalledWith(note, "state", [ "" ]);
        });
    });

    describe("a date", () => {
        const due = [ attribute({ name: "due", title: "Due", labelType: "date" }) ];

        function entries(...notes: FNote[]) {
            const items = buildAttributeMenuItems<string>({ notes, attributes: due });
            const entry = items[1];
            if (!entry || !("items" in entry)) throw new Error("expected a submenu");
            return entry.items ?? [];
        }

        it("offers Not set, then a date picker", () => {
            const items = entries(buildNote({ title: "Card" }));

            expect(items).toHaveLength(3);
            expect(titles(items)[0]).toBe(`<span class="tn-menu-name">attribute_menu.not-set</span>`);
            expect(items.slice(1)).toMatchObject([ { kind: "separator" }, { kind: "custom" } ]);
            expect(marked(items)).toEqual([
                `<span class="tn-menu-name">attribute_menu.not-set</span>`
            ]);
            expect(marked(entries(buildNote({ title: "Card", "#due": "2026-10-22" })))).toEqual([]);
        });

        it("hands the picker the date every item holds, and writes the date picked", () => {
            const note = buildNote({ title: "Card", "#due": "2026-12-01" });
            const picker = pickerOf(entries(note, buildNote({ title: "Two", "#due": "2026-12-01" })));

            expect(picker.value).toBe("2026-12-01");
            expect(picker.onClear).toBeUndefined();
            picker.onChange("2026-12-24");
            expect(writes.setLabelValues).toHaveBeenCalledWith(note, "due", [ "2026-12-24" ]);

            expect(pickerOf(entries(note, buildNote({ title: "Three" }))).value).toBeUndefined();

            pick(entries(note)[0]);
            expect(writes.setLabelValues).toHaveBeenCalledWith(note, "due", []);
        });

        /** What the submenu's custom row hands the date picker. */
        function pickerOf(items: MenuItem<string>[]) {
            const row = items.at(-1);
            if (!row || !("kind" in row) || row.kind !== "custom") throw new Error("expected a picker");
            vi.mocked(DatePicker).mockClear();
            row.componentFn();
            const props = vi.mocked(DatePicker).mock.calls[0]?.[0];
            if (!props) throw new Error("expected the picker to render");
            return props;
        }

        it("leaves out a date and time, which a menu cannot set without its time", () => {
            expect(build({ title: "Card" }, [
                attribute({ name: "at", title: "At", labelType: "datetime" }),
                attribute({ name: "time", title: "Time", labelType: "time" })
            ])).toEqual([]);
        });
    });

    it("escapes what a crafted name would plant in the menu", () => {
        const crafted = `<img src=x onerror="alert(1)">`;
        const items = build({ title: "Card" }, [ attribute({
            name: "state", title: crafted, labelType: "select", selectOptions: [ crafted ]
        }) ]);
        const entry = items[1];
        if (!entry || !("items" in entry)) throw new Error("expected a submenu");

        const escaped = "<span class=\"tn-menu-name\">"
            + "&lt;img src&#x3D;x onerror&#x3D;&quot;alert(1)&quot;&gt;</span>";
        expect(titles(items)[1]).toBe(escaped);
        expect(titles(entry.items ?? [])[2]).toBe(escaped);
    });
});

function build(
    note: { title: string } & Record<string, string>,
    attributes: PromotedAttribute[],
    title?: string
) {
    return buildAttributeMenuItems<string>({ notes: [ buildNote(note) ], attributes, title });
}

function attribute(fields: Partial<PromotedAttribute> & { name: string }): PromotedAttribute {
    return {
        definitionName: `label:${fields.name}`,
        type: "label",
        title: fields.name,
        hidden: false,
        drawnByCollection: false,
        definitionValue: "",
        isOwned: true,
        isDefinedByItems: false,
        isConflicting: false,
        isInheritable: true,
        ...fields
    };
}

const titles = (items: MenuItem<string>[]) =>
    items.map(item => (item && "title" in item ? item.title : "separator"));

/** The titles of the entries carrying the mark, which is what says where a value stands. */
const marked = (items: MenuItem<string>[]) => items
    .filter(item => "trailingIcon" in item && item.trailingIcon)
    .map(item => ("title" in item ? item.title : ""));

/** Runs an entry's handler and hands back what it returns, so a caller can wait for its writes. */
function pick(item: MenuItem<string> | undefined) {
    if (!item || !("handler" in item)) throw new Error("expected a menu entry");
    return item.handler?.(item as MenuCommandItem<string>, {} as never);
}
