import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FNote from "../../entities/fnote";

// What this file is for: the panel draws its runs one way for a pointer and another for a thumb, and
// the device is read once at module load (see `IS_MOBILE`), so the two cannot be told apart within a
// single file. Everything else about the panel is covered against a pointer in AttributeList.spec.
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isMobile: () => true
}));

const shownNote = vi.hoisted(() => ({ current: null as FNote | null }));
vi.mock("../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks")>()),
    useActiveNoteContext: () => ({ note: shownNote.current })
}));

const showContextMenu = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../menus/context_menu", () => ({ default: { show: showContextMenu } }));
vi.mock("../../services/dialog", () => ({ default: { confirm: vi.fn(async () => true) } }));
vi.mock("../../services/toast", () => ({ default: { showMessage: vi.fn(), showError: vi.fn() } }));

import FAttribute, { FAttributeRow } from "../../entities/fattribute";
import { holdAttributes } from "../../services/attribute_clipboard";
import froca from "../../services/froca";
import noteAttributeCache from "../../services/note_attribute_cache";
import options from "../../services/options";
import server from "../../services/server";
import { buildNote } from "../../test/easy-froca";
import AttributeList from "./AttributeList";

describe("AttributeList on a phone", () => {
    let container: HTMLElement;
    let put: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        options.set("rightPaneCollapsedItems", "[]");
        // What Trilium last copied outlives a render, so each test says for itself whether there is
        // anything to paste.
        holdAttributes([]);
        put = vi.fn(async () => ({}));
        server.put = put as unknown as typeof server.put;
        server.post = (async () => ({ results: [], count: 0 })) as unknown as typeof server.post;
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        vi.useRealTimers();
    });

    it("draws a card per run rather than the tree a pointer gets", () => {
        renderPanel(noteWithRuns());

        // A card each, as the panel had before its runs became headings of one card: the tree that
        // gathers them is a pointer's affordance — hairlines, hover, a fold — drawn for a pane a hand
        // wide, and a phone has neither the pointer nor the want of room.
        expect(container.querySelectorAll(".attribute-group")).toHaveLength(0);
        expect(container.querySelectorAll(".attribute-group-header")).toHaveLength(0);
        expect(sectionIds()).toEqual([ "attributes-owned", "attributes-inherited", "attributes-definitions" ]);

        // Each card names its run and counts it beside the name, as the headings do on a desktop.
        expect(section("attributes-owned").querySelector(".attribute-run-count")?.textContent).toBe("2");
        expect(section("attributes-definitions").querySelector(".attribute-run-count")?.textContent).toBe("2");

        // The rows themselves are unchanged — menu items, which is what a phone's lists are made of.
        expect(namesIn(section("attributes-owned"))).toEqual([ "author", "template" ]);
        expect(section("attributes-owned").querySelector(".attribute-row")?.className).toContain("dropdown-item");
    });

    it("keeps the ways in on the cards' own headers, there being no row to hover for one", () => {
        renderPanel(noteWithRuns());

        // The panel's own two ride on the first card, there being no header above the cards; the
        // menu is also the only way to a relation here, whose creation editor is a pointer's.
        expect(iconsIn(header("attributes-owned"))).toEqual([ "bx bx-help-circle", "bx bx-plus" ]);
        // A run that can be added to says so in its own header, definitions included; one that
        // cannot — the inherited, which are another note's — says nothing.
        expect(iconsIn(header("attributes-definitions"))).toEqual([ "bx bx-plus" ]);
        expect(iconsIn(header("attributes-inherited"))).toEqual([]);

        // The ghost row at the foot of a run is a hover affordance, so it stays on the desktop.
        expect(container.querySelector(".attribute-add-row")).toBeNull();
    });

    it("offers pasting from the first card's header, which is a phone's only way to it", async () => {
        // Nothing copied, nothing offered — as the row menu and the selection's bar do.
        renderPanel(noteWithRuns());
        expect(iconsIn(header("attributes-owned"))).not.toContain("bx bx-paste");

        // The note that most wants pasting into is the one carrying nothing, and it is exactly the
        // note where every other way in is gone: no row to hold down, so no selection and no bar,
        // and the list a press beside the rows would land on has no rows to give it a height. The
        // header stands whatever the run holds, which is why the way in belongs there.
        render(null, container);
        holdAttributes([ { type: "label", name: "author", value: "Elian", isInheritable: false } ]);
        renderPanel(buildNote({ id: "phone-bare", title: "Bare" }));

        expect(container.querySelectorAll(".attribute-row")).toHaveLength(0);
        expect(container.querySelector(".attribute-selection-bar")).toBeNull();
        expect(iconsIn(header("attributes-owned"))).toEqual([ "bx bx-help-circle", "bx bx-paste", "bx bx-plus" ]);

        const paste = header("attributes-owned")?.querySelector<HTMLElement>(".bx-paste");
        await act(async () => paste?.click());

        const [ url, saved ] = put.mock.calls[0] as [ string, { name: string; value: string }[] ];
        expect(url).toBe("notes/phone-bare/attributes");
        expect(saved).toEqual([ { type: "label", name: "author", value: "Elian", isInheritable: false } ]);
    });

    it("still picks rows out, by the press held down, and says what can be done with them", () => {
        vi.useFakeTimers();
        renderPanel(noteWithRuns());

        const row = section("attributes-owned").querySelector(".attribute-row");
        act(() => {
            row?.dispatchEvent(new Event("touchstart", { bubbles: true }));
        });
        // Held long enough, the press picks the row out rather than opening it.
        act(() => void vi.advanceTimersByTime(600));

        expect(row?.className).toContain("selected");
        // The mark a menu item is checked with, in the slot the kind icon holds — a phone has no
        // checkbox to put there.
        expect(row?.querySelector(".bx-check")).not.toBeNull();
        expect(container.querySelector(".attribute-list-panel")?.className).toContain("selecting");

        // The bar stands after the cards, the rows it acts on being picked out among any of them.
        const bar = container.querySelector(".attribute-selection-bar");
        expect(bar).not.toBeNull();
        expect(iconsIn(bar)).toEqual([ "bx bx-copy", "bx bx-trash", "bx bx-x" ]);
        expect(bar?.compareDocumentPosition(section("attributes-definitions")))
            .toBe(Node.DOCUMENT_POSITION_PRECEDING);
    });

    function renderPanel(note: FNote) {
        shownNote.current = note;
        act(() => render(<AttributeList />, container));
    }

    function sectionIds() {
        return [ ...container.querySelectorAll(".options-section") ]
            .map((el) => [ ...el.classList ].find((name) => name.startsWith("attributes-")));
    }

    function section(id: string) {
        const el = container.querySelector<HTMLElement>(`.options-section.${id}`);
        expect(el, id).not.toBeNull();
        return el as HTMLElement;
    }

    function header(id: string) {
        return section(id).querySelector<HTMLElement>(".options-section-header");
    }
});

function namesIn(root: Element) {
    return [ ...root.querySelectorAll(".attribute-name") ].map((name) => name.textContent);
}

/** The icons a header (or the selection bar) offers, which is what its buttons are known by: the
 *  titles are translated, and translations stay unloaded in these tests. */
function iconsIn(root: Element | null) {
    return [ ...(root?.querySelectorAll(".bx") ?? []) ]
        .map((icon) => [ ...icon.classList ].filter((name) => name.startsWith("bx")).join(" "));
}

/** A note with all three of the runs a phone can be shown, each holding more than one row. */
function noteWithRuns() {
    buildNote({ id: "tpl", title: "Template" });
    const note = buildNote({
        id: "phone-subject",
        title: "Subject",
        "#author": "Elian",
        "~template": "tpl",
        "#label:priority": "promoted,single,date"
    });

    noteAttributeCache.attributes[note.noteId] = [
        ...note.getOwnedAttributes(),
        inherited({ name: "inheritedLabel", value: "x" }),
        inherited({ name: "archived", value: "" }),
        inherited({ name: "label:status", value: "promoted,multi" })
    ];

    return note;
}

function inherited(row: Partial<FAttributeRow>) {
    return new FAttribute(froca, {
        attributeId: `inh-${row.name}`,
        noteId: "tpl",
        type: "label",
        name: "",
        value: "",
        position: 0,
        isInheritable: true,
        ...row
    } as FAttributeRow);
}
