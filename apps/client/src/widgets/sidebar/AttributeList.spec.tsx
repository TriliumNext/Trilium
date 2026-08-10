import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FNote from "../../entities/fnote";

// The panel follows whichever note is being read; the tests hand it one directly. Handing it another
// redraws it, as the real hook does by listening for the switch — rendering the panel a second time
// would not: the same element with no props of its own is the same vnode to Preact, which skips it.
const shownNote = vi.hoisted(() => ({ current: null as FNote | null, listeners: new Set<() => void>() }));
vi.mock("../react/hooks", async (importOriginal) => {
    const { useEffect, useState } = await import("preact/hooks");

    return {
        ...(await importOriginal<typeof import("../react/hooks")>()),
        useActiveNoteContext: () => {
            const [ , setRevision ] = useState(0);
            useEffect(() => {
                const listener = () => setRevision((revision) => revision + 1);
                shownNote.listeners.add(listener);
                return () => shownNote.listeners.delete(listener);
            }, []);

            return { note: shownNote.current };
        }
    };
});

// Deleting is confirmed first, and adding goes through a menu; neither dialog belongs to this widget.
const confirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../services/dialog", () => ({ default: { confirm } }));
const showContextMenu = vi.hoisted(() => vi.fn(async (_opts: AddMenuCall) => {}));
vi.mock("../../menus/context_menu", () => ({ default: { show: showContextMenu } }));

/** What the add button asks the context menu to show: a kind per entry, and a rule between groups. */
interface AddMenuCall {
    items: { kind?: string; handler?: () => void }[];
}

// A relation's target is picked in an Algolia autocomplete bound to jQuery, which is not loaded here:
// a bare box stands in, reporting whatever is typed into it as the noteId picked.
vi.mock("../react/NoteAutocomplete", async () => {
    const { h } = await import("preact");

    return {
        default: ({ noteId, noteIdChanged }: { noteId?: string; noteIdChanged?: (noteId: string) => void }) =>
            h("input", {
                className: "note-autocomplete-stub",
                value: noteId ?? "",
                onInput: (e: Event) => noteIdChanged?.((e.target as HTMLInputElement).value)
            })
    };
});

import appContext from "../../components/app_context";
import type Component from "../../components/component";
import FAttribute, { FAttributeRow } from "../../entities/fattribute";
import type { Attribute } from "../../services/attribute_parser";
import froca from "../../services/froca";
import type LoadResults from "../../services/load_results";
import noteAttributeCache from "../../services/note_attribute_cache";
import options from "../../services/options";
import server from "../../services/server";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import AttributeList, { getAttributeKind, getDisplayName, listInherited, listInternal, listOwned, splitIntoSections } from "./AttributeList";

describe("listOwned", () => {
    it("orders by position and leaves out the attributes Trilium maintains itself", () => {
        const rows = listOwned([
            attribute({ name: "second", position: 20 }),
            attribute({ type: "relation", name: "internalLink", value: "target", position: 30 }),
            attribute({ name: "first", position: 10, value: "red", isInheritable: true })
        ]);

        expect(rows.map((row) => row.name)).toEqual([ "first", "second" ]);
        expect(rows[0]).toMatchObject({
            type: "label", name: "first", value: "red", isInheritable: true
        });
    });
});

describe("listInherited", () => {
    it("keeps only what comes from other notes, grouped by the note it comes from", () => {
        const rows = listInherited([
            attribute({ noteId: "bbb", name: "fromB2", position: 20 }),
            attribute({ noteId: "own", name: "ownLabel" }),
            attribute({ noteId: "aaa", name: "fromA" }),
            attribute({ noteId: "bbb", name: "fromB1", position: 10 })
        ], "own");

        expect(rows.map((row) => row.name)).toEqual([ "fromA", "fromB1", "fromB2" ]);
        expect(rows.map((row) => row.noteId)).toEqual([ "aaa", "bbb", "bbb" ]);
    });
});

describe("listInternal", () => {
    it("keeps exactly what the owned list leaves out: what Trilium wrote from the note's content", () => {
        const rows = listInternal([
            attribute({ name: "author", value: "Elian" }),
            attribute({ type: "relation", name: "internalLink", value: "target", position: 30 }),
            attribute({ type: "relation", name: "imageLink", value: "image", position: 20 })
        ]);

        expect(rows.map((row) => row.name)).toEqual([ "imageLink", "internalLink" ]);
    });
});

describe("splitIntoSections", () => {
    it("sets the definitions of either aside, the note's own first, and splits the rest by ownership", () => {
        const sections = splitIntoSections(
            [ plain("cssClass"), plain("label:priority"), plain("relation:owner") ],
            [ plain("archived", "parent"), plain("label:status", "template") ]
        );

        expect(sections.owned.map((entry) => entry.attribute.name)).toEqual([ "cssClass" ]);
        expect(sections.inherited.map((entry) => entry.attribute.name)).toEqual([ "archived" ]);
        expect(sections.definitions.map((entry) => entry.attribute.name))
            .toEqual([ "label:priority", "relation:owner", "label:status" ]);
        // Which of the definitions the note may edit is the row's to know, the card holding both.
        expect(sections.definitions.map((entry) => entry.isOwned)).toEqual([ true, true, false ]);
    });

    it("sorts the names Trilium reads for itself last, each group keeping its order", () => {
        const { owned } = splitIntoSections(
            [ plain("cssClass"), plain("priority"), plain("archived"), plain("author") ],
            []
        );

        expect(owned.map((entry) => entry.attribute.name)).toEqual([ "priority", "author", "cssClass", "archived" ]);
        expect(owned.map((entry) => entry.isSystem)).toEqual([ false, false, true, true ]);
    });
});

describe("getAttributeKind / getDisplayName", () => {
    it("tells a definition from what it defines, and shows it without its prefix", () => {
        const cases: [ FAttributeRow["type"], string, string, string ][] = [
            // type, name, expected kind, expected displayed name
            [ "label", "color", "label", "color" ],
            [ "relation", "template", "relation", "template" ],
            [ "label", "label:color", "label-definition", "color" ],
            [ "label", "relation:author", "relation-definition", "author" ],
            // A bare prefix defines nothing, so it stays an ordinary label — name and all.
            [ "label", "label:", "label", "label:" ]
        ];

        for (const [ type, name, expectedKind, expectedName ] of cases) {
            const attrType = getAttributeKind({ type, name });
            expect(attrType, name).toBe(expectedKind);
            expect(getDisplayName({ type, name }, attrType), name).toBe(expectedName);
        }
    });
});

describe("AttributeList", () => {
    let container: HTMLElement;
    let put: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        options.set("rightPaneCollapsedItems", "[]");
        // A release build, unless the test at hand is about what only a development one shows.
        setDevBuild(false);
        put = vi.fn(async () => ({}));
        server.put = put as unknown as typeof server.put;
        // The detail popup looks up the notes sharing the attribute it opens on, against the tab the
        // note is being read in — neither of which a rendered widget brings with it.
        server.post = (async () => ({ results: [], count: 0 })) as unknown as typeof server.post;
        appContext.tabManager = { getActiveContext: () => null } as typeof appContext.tabManager;
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        for (const orphan of document.querySelectorAll(".attr-detail")) {
            orphan.remove();
        }
    });

    it("gives the note's own attributes, the inherited ones and the definitions of either a card each", () => {
        renderPanel(noteWithAttributes());

        // Three cards, each listing what its section holds.
        const cards = [ ...container.querySelectorAll(".card") ];
        expect(cards.map((card) => card.id)).toEqual([ "attributes", "attributes-inherited", "attributes-definitions" ]);
        expect(namesIn(cards[0])).toEqual([ "author", "cssClass", "template" ]);
        expect(namesIn(cards[1])).toEqual([ "inheritedLabel", "archived" ]);
        // The definitions of both notes share a card, the note's own first, and lose their prefix.
        expect(namesIn(cards[2])).toEqual([ "priority", "status" ]);

        // The kind is carried by the icon; a definition takes the icon of the field it sets up.
        expect(iconsIn(cards[0])).toEqual([ "bx bx-hash", "bx bx-hash", "bx bx-transfer" ]);

        // The icon also carries the row's one tooltip — the row itself has none to compete with it.
        // Only its presence: the wording is translated, and translations stay unloaded here.
        expect(cards[0].querySelector(".attribute-row")?.hasAttribute("title")).toBe(false);
        expect(cards[0].querySelector(".attribute-kind")?.hasAttribute("title")).toBe(true);
        // A definition that names no type sets up a text field, and takes that field's icon.
        expect(iconsIn(cards[2])).toEqual([ "bx bx-calendar", "bx bx-text" ]);

        // The names Trilium reads for itself come last, below a rule, and are marked as such.
        expect(cards[0].querySelectorAll("hr.attribute-rows-divider")).toHaveLength(1);
        expect([ ...cards[0].querySelectorAll(".attribute-kind") ].map((kind) => kind.className.includes("marker-system")))
            .toEqual([ false, true, true ]);

        // A row of the note's own is deletable and unattributed; an inherited one names its note instead.
        expect(cards[0].querySelectorAll(".attribute-delete-button")).toHaveLength(3);
        expect(cards[0].querySelectorAll(".attribute-owner")).toHaveLength(0);
        expect(cards[1].querySelectorAll(".attribute-delete-button")).toHaveLength(0);
        expect(cards[1].querySelectorAll(".attribute-owner")).toHaveLength(2);
        // Only what the note may edit is deletable, whichever card it is in.
        expect(cards[2].querySelectorAll(".attribute-delete-button")).toHaveLength(1);

        // An inheritable attribute is marked, and every definition previews what it sets up — a
        // set-holding one (label:status, "multi") by a mark of its own rather than by words.
        expect(cards[1].querySelectorAll(".attribute-marker")).toHaveLength(2);
        expect(cards[2].querySelectorAll(".attribute-value.definition")).toHaveLength(2);
        expect(cards[2].querySelectorAll(".definition-marker")).toHaveLength(1);
    });

    it("keeps to one card, collapsing and all, for a note with nothing but its own attributes", () => {
        renderPanel(buildNote({ id: "bare", title: "Bare", "#author": "Elian" }));

        expect(container.querySelectorAll(".card")).toHaveLength(1);
        // Down to a single card there is nothing to put away, so no chevron is offered.
        expect(container.querySelector(".card")?.className).toContain("not-collapsible");
    });

    it("says so, rather than showing an empty list, for a note carrying no attributes at all", () => {
        renderPanel(buildNote({ id: "empty", title: "Empty" }));

        expect(container.querySelectorAll(".attribute-row")).toHaveLength(0);
        expect(container.querySelector(".no-items")).not.toBeNull();
    });

    it("leaves what Trilium wrote for itself out of a release build, and gives it its own card in a development one", () => {
        buildNote({ id: "target", title: "Target" });
        const note = buildNote({ id: "linking", title: "Linking", "#author": "Elian", "~internalLink": "target" });

        renderPanel(note);
        expect(cardIds()).toEqual([ "attributes" ]);

        // Unmounted first, the panel collecting the attributes of the note it is handed as it mounts.
        setDevBuild(true);
        render(null, container);
        renderPanel(note);

        const cards = [ ...container.querySelectorAll(".card") ];
        expect(cardIds()).toEqual([ "attributes", "attributes-internal" ]);
        expect(namesIn(cards[1])).toEqual([ "internalLink" ]);
        // Nothing on such a row is the note's to change, and nothing marks it as Trilium's own: the
        // card it is in says as much of every row it holds.
        expect(cards[1].querySelectorAll(".attribute-delete-button")).toHaveLength(0);
        expect(cards[1].querySelectorAll(".attribute-owner")).toHaveLength(0);
        expect(cards[1].querySelector(".attribute-kind")?.className).not.toContain("marker-system");
        expect(cards[1].querySelectorAll("hr.attribute-rows-divider")).toHaveLength(0);
    });

    it("opens the detail popup on a row and closes it again on a press beside the rows", () => {
        renderPanel(noteWithAttributes());

        act(() => firstRow().click());
        expect(document.querySelector(".attr-detail")).not.toBeNull();
        expect(firstRow().className).toContain("active");

        act(() => container.querySelector<HTMLElement>(".attribute-list-panel")?.click());
        expect(document.querySelector(".attr-detail")).toBeNull();
        // Closing keeps what was typed, whether the press landed beside the rows or clear of the panel:
        // both are a press away from the form rather than a refusal of what is in it.
        expect(put).toHaveBeenCalledOnce();
        expect(put.mock.calls[0][0]).toBe("notes/subject/attributes");
    });

    it("edits a system attribute that is a closed set as a dropdown of the values it allows", () => {
        renderPanel(buildNote({ id: "subject", title: "Subject", "#sortDirection": "desc" }));

        act(() => firstRow().click());

        const field = document.querySelector<HTMLSelectElement>(".attr-detail .attr-input-value");
        expect(field?.tagName).toBe("SELECT");
        expect([ ...(field?.options ?? []) ].map((option) => option.value)).toEqual([ "", "asc", "desc" ]);
        expect(field?.value).toBe("desc");
        // Not framed by an input group: it has no buttons to be grouped with, and a group blanks the
        // background of the fields inside it — which is the background the themes draw the dropdown's
        // arrow on, leaving nothing to say the field is one.
        expect(field?.closest(".input-group")).toBeNull();
    });

    it("saves an attribute left open for editing to the note it belongs to, on reading another", () => {
        renderPanel(noteWithAttributes());
        act(() => firstRow().click());

        // Read another note without pressing away from the form first, as a keyboard shortcut does.
        showNote(buildNote({ id: "elsewhere", title: "Elsewhere", "#other": "x" }));

        expect(document.querySelector(".attr-detail")).toBeNull();
        expect(namesIn(container)).toEqual([ "other" ]);
        // Saved against the note it was typed on, not against the one now being read.
        expect(put).toHaveBeenCalledOnce();
        const [ url, saved ] = put.mock.calls[0] as [ string, { name: string }[] ];
        expect(url).toBe("notes/subject/attributes");
        expect(saved.map((attribute) => attribute.name)).toContain("author");
    });

    it("confirms a deletion before persisting what is left of the note's attributes", async () => {
        renderPanel(noteWithAttributes());

        confirm.mockResolvedValueOnce(false);
        await act(async () => container.querySelector<HTMLElement>(".attribute-delete-button")?.click());
        expect(confirm).toHaveBeenCalledOnce();
        expect(put).not.toHaveBeenCalled();
        expect(namesIn(container)).toContain("author");

        confirm.mockResolvedValueOnce(true);
        await act(async () => container.querySelector<HTMLElement>(".attribute-delete-button")?.click());

        expect(put).toHaveBeenCalledOnce();
        const [ url, saved ] = put.mock.calls[0] as [ string, { name: string }[] ];
        expect(url).toBe("notes/subject/attributes");
        expect(saved.map((attribute) => attribute.name)).toEqual([ "cssClass", "template", "label:priority" ]);
        expect(namesIn(container)).not.toContain("author");
    });

    it("adds a definition through the popup, saving it once the popup is closed", async () => {
        renderPanel(noteWithAttributes());

        // The panel's own button offers every kind; the definitions card offers the two definitions.
        const [ ownedMenu, definitionsMenu ] = [ ...container.querySelectorAll<HTMLElement>(".card-header-buttons .bx-plus") ];
        act(() => ownedMenu.click());
        act(() => definitionsMenu.click());

        const offered = showContextMenu.mock.calls.map(([ { items } ]) => items.length);
        // Four kinds and the rule setting the definitions apart, against the two definitions on their own.
        expect(offered).toEqual([ 5, 2 ]);

        // A definition still goes through the form, its settings needing one; nothing is saved until
        // it is closed, and a press beside it keeps the edits — which for a list of rows means saving.
        act(() => showContextMenu.mock.calls[1][0].items[0].handler?.());
        expect(document.querySelector(".attr-detail")).not.toBeNull();
        expect(put).not.toHaveBeenCalled();

        await act(async () => {
            document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        });

        expect(document.querySelector(".attr-detail")).toBeNull();
        const [ , saved ] = put.mock.calls[0] as [ string, { name: string; value: string }[] ];
        expect(saved.at(-1)).toEqual(
            { type: "label", name: "label:myLabel", value: "promoted,single,text", isInheritable: false });
    });

    it("creates a label straight in its row, and a draft left nameless not at all", async () => {
        renderPanel(noteWithAttributes());

        const ownedMenu = container.querySelector<HTMLElement>(".card-header-buttons .bx-plus");
        act(() => ownedMenu?.click());
        act(() => showContextMenu.mock.calls[0][0].items[0].handler?.());

        // The row is created in place — no popup — name box first, value beside it.
        expect(document.querySelector(".attr-detail")).toBeNull();
        const editor = container.querySelector<HTMLElement>(".attribute-creation-editor");
        expect(editor).not.toBeNull();

        const nameInput = editor?.querySelector<HTMLInputElement>(".attribute-creation-name input");
        const valueInput = editor?.querySelector<HTMLInputElement>(".attribute-creation-value input");
        act(() => {
            if (nameInput) {
                nameInput.value = "mood";
                nameInput.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        act(() => {
            if (valueInput) {
                valueInput.value = "great";
                valueInput.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        await act(async () => {
            editor?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
        });

        // Leaving the row keeps and saves the creation, and the row now stands for it.
        expect(container.querySelector(".attribute-creation-editor")).toBeNull();
        expect(put).toHaveBeenCalledOnce();
        const [ , saved ] = put.mock.calls[0] as [ string, { name: string; value: string }[] ];
        expect(saved.at(-1)).toMatchObject({ type: "label", name: "mood", value: "great" });

        // Left nameless, the draft is nothing yet: closing it creates nothing and saves nothing.
        act(() => ownedMenu?.click());
        act(() => showContextMenu.mock.calls[1][0].items[0].handler?.());
        await act(async () => {
            container.querySelector(".attribute-creation-editor")
                ?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
        });
        expect(container.querySelector(".attribute-creation-editor")).toBeNull();
        expect(put).toHaveBeenCalledOnce();
        expect(namesIn(container)).not.toContain("");
    });

    it("creates from the add row at the list's foot, the kind switched by prefix or by its icon", async () => {
        renderPanel(noteWithAttributes());

        const addRow = container.querySelector<HTMLElement>(".attribute-add-row");
        expect(addRow).not.toBeNull();
        act(() => addRow?.click());

        // Opens as a label — the kind nearly always being added...
        const editor = container.querySelector<HTMLElement>(".attribute-creation-editor");
        expect(editor?.querySelector(".attribute-creation-value input")).not.toBeNull();
        expect(editor?.querySelector(".note-autocomplete-stub")).toBeNull();

        // ...until the `~` the attributes editor spells relations with is typed at the name's head:
        // the prefix is spent on the switch, the name keeping only what follows it.
        const nameInput = editor?.querySelector<HTMLInputElement>(".attribute-creation-name input");
        act(() => {
            if (nameInput) {
                nameInput.value = "~depicts";
                nameInput.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        expect(nameInput?.value).toBe("depicts");
        expect(editor?.querySelector(".note-autocomplete-stub")).not.toBeNull();

        // The kind icon presses it back to a label, and again to a relation.
        act(() => editor?.querySelector<HTMLElement>(".attribute-creation-kind")?.click());
        expect(editor?.querySelector(".note-autocomplete-stub")).toBeNull();
        act(() => editor?.querySelector<HTMLElement>(".attribute-creation-kind")?.click());

        const target = editor?.querySelector<HTMLInputElement>(".note-autocomplete-stub");
        act(() => {
            if (target) {
                target.value = "tpl";
                target.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        await act(async () => {
            editor?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
        });

        expect(put).toHaveBeenCalledOnce();
        const [ , saved ] = put.mock.calls[0] as [ string, { name: string; value: string }[] ];
        expect(saved.at(-1)).toMatchObject({ type: "relation", name: "depicts", value: "tpl" });
    });

    it("creates a relation in its row, its target picked in the note search", async () => {
        buildNote({ id: "target-note", title: "Target" });
        renderPanel(noteWithAttributes());

        act(() => container.querySelector<HTMLElement>(".card-header-buttons .bx-plus")?.click());
        act(() => showContextMenu.mock.calls[0][0].items[1].handler?.());

        const editor = container.querySelector<HTMLElement>(".attribute-creation-editor");
        const nameInput = editor?.querySelector<HTMLInputElement>(".attribute-creation-name input");
        // The target field is the note search, stubbed here (see the mock above).
        const targetInput = editor?.querySelector<HTMLInputElement>(".attribute-creation-value .note-autocomplete-stub");
        act(() => {
            if (nameInput) {
                nameInput.value = "depicts";
                nameInput.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        act(() => {
            if (targetInput) {
                targetInput.value = "target-note";
                targetInput.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        await act(async () => {
            editor?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
        });

        expect(put).toHaveBeenCalledOnce();
        const [ , saved ] = put.mock.calls[0] as [ string, { name: string; value: string }[] ];
        expect(saved.at(-1)).toMatchObject({ type: "relation", name: "depicts", value: "target-note" });
    });

    it("edits an owned label's value in place, saving it once the field is left", async () => {
        renderPanel(noteWithAttributes());

        // The values offered for editing in place are exactly the owned labels': not a relation's
        // (whose value is a link), not a definition's (whose value is a summary), not an inherited row's.
        expect([ ...container.querySelectorAll(".attribute-value.editable") ]).toHaveLength(2);

        act(() => firstRow().querySelector<HTMLElement>(".attribute-value")?.click());

        // The press edits in place rather than opening the popup, in the field the value calls for.
        expect(document.querySelector(".attr-detail")).toBeNull();
        const input = container.querySelector<HTMLInputElement>(".attribute-value-editor input");
        expect(input?.value).toBe("Elian");

        act(() => {
            if (input) {
                input.value = "Someone else";
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        await act(async () => {
            input?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
        });

        // Leaving the field ends the edit and saves it; the row shows the value again, as typed.
        expect(container.querySelector(".attribute-value-editor")).toBeNull();
        expect(put).toHaveBeenCalledOnce();
        const [ url, saved ] = put.mock.calls[0] as [ string, { name: string; value: string }[] ];
        expect(url).toBe("notes/subject/attributes");
        expect(saved.find((attribute) => attribute.name === "author")?.value).toBe("Someone else");
        expect(firstRow().querySelector(".attribute-value")?.textContent).toBe("Someone else");
    });

    it("puts the value back on escape, and saves nothing for an edit that changed nothing", async () => {
        renderPanel(noteWithAttributes());

        act(() => firstRow().querySelector<HTMLElement>(".attribute-value")?.click());
        const input = container.querySelector<HTMLInputElement>(".attribute-value-editor input");
        act(() => {
            if (input) {
                input.value = "discarded";
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        act(() => {
            input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });

        expect(container.querySelector(".attribute-value-editor")).toBeNull();
        expect(firstRow().querySelector(".attribute-value")?.textContent).toBe("Elian");

        // Entered and left alone: nothing changed, so nothing is put to the server either way.
        act(() => firstRow().querySelector<HTMLElement>(".attribute-value")?.click());
        await act(async () => {
            container.querySelector<HTMLInputElement>(".attribute-value-editor input")
                ?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
        });
        expect(put).not.toHaveBeenCalled();
    });

    it("types the in-place field by what the label is: a closed set as a dropdown, a defined number by its definition", () => {
        renderPanel(buildNote({ id: "sorted", title: "Sorted", "#sortDirection": "desc" }));
        act(() => firstRow().querySelector<HTMLElement>(".attribute-value")?.click());

        const select = container.querySelector<HTMLSelectElement>(".attribute-value-editor select");
        expect(select?.value).toBe("desc");
        expect([ ...(select?.options ?? []) ].map((option) => option.value)).toEqual([ "", "asc", "desc" ]);

        render(null, container);
        renderPanel(buildNote({
            id: "scored", title: "Scored",
            "#score": "3",
            "#label:score": "promoted,single,number,precision=2"
        }));
        act(() => firstRow().querySelector<HTMLElement>(".attribute-value")?.click());

        const input = container.querySelector<HTMLInputElement>(".attribute-value-editor input");
        expect(input?.type).toBe("number");
        expect(input?.step).toBe("0.01");
    });

    it("repicks a relation's target from its pencil, the value itself staying the link it is", async () => {
        buildNote({ id: "tpl2", title: "Other template" });
        renderPanel(noteWithAttributes());

        // Only the relation row offers the pencil — a label's value is its own way in — and the
        // relation's value stays a link rather than becoming a click target of the edit.
        const pencils = container.querySelectorAll<HTMLElement>(".attribute-edit-button");
        expect(pencils).toHaveLength(1);
        expect(pencils[0].closest(".attribute-row")?.querySelector(".attribute-value.editable")).toBeNull();

        act(() => pencils[0].click());
        const stub = container.querySelector<HTMLInputElement>(".attribute-value-editor .note-autocomplete-stub");
        expect(stub?.value).toBe("tpl");

        act(() => {
            if (stub) {
                stub.value = "tpl2";
                stub.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        await act(async () => {
            stub?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
        });

        expect(put).toHaveBeenCalledOnce();
        const [ , saved ] = put.mock.calls[0] as [ string, { name: string; value: string }[] ];
        expect(saved.find((attribute) => attribute.name === "template")?.value).toBe("tpl2");
    });

    it("offers an empty relation's own slot for picking, there being no link in it to follow", () => {
        renderPanel(buildNote({ id: "bare-rel", title: "Bare", "~depicts": "" }));

        const placeholder = container.querySelector<HTMLElement>(".attribute-value.empty");
        expect(placeholder?.className).toContain("editable");

        act(() => placeholder?.click());
        expect(container.querySelector(".attribute-value-editor .note-autocomplete-stub")).not.toBeNull();
    });

    it("holds an empty label's slot open with a placeholder, which is the way into typing a value", () => {
        renderPanel(buildNote({ id: "bare-label", title: "Bare", "#todo": "" }));

        // The placeholder is what keeps the slot pressable at all: without text the row's centring
        // collapses the empty span to no height, and a press could never land on it. Its wording is
        // not asserted — translations stay unloaded here, as in every test of this file.
        const slot = firstRow().querySelector<HTMLElement>(".attribute-value");
        expect(slot?.className).toContain("value-placeholder");

        act(() => slot?.click());
        expect(container.querySelector<HTMLInputElement>(".attribute-value-editor input")).not.toBeNull();

        // A row the note cannot edit keeps its blank: its slot leads nowhere, so there is nothing to
        // hold open — and an inherited flag with no value is not something the note lacks.
        render(null, container);
        renderPanel(noteWithAttributes());
        const inherited = container.querySelector("#attributes-inherited");
        const archived = [ ...(inherited?.querySelectorAll(".attribute-row") ?? []) ]
            .find((row) => row.querySelector(".attribute-name")?.textContent === "archived");
        expect(archived?.querySelector(".attribute-value")?.className).not.toContain("value-placeholder");
        expect(archived?.querySelector(".attribute-value")?.textContent).toBe("");
    });

    it("leaves the open-link button out of the in-place editor, which has no room to spare for it", () => {
        renderPanel(buildNote({
            id: "linked", title: "Linked",
            "#site": "https://example.com",
            "#label:site": "promoted,single,url"
        }));

        act(() => firstRow().querySelector<HTMLElement>(".attribute-value")?.click());

        const editor = container.querySelector<HTMLElement>(".attribute-value-editor");
        expect(editor?.querySelector("input")?.type).toBe("url");
        expect(editor?.querySelector(".input-group-text")).toBeNull();
    });

    it("previews a flag as its mark and turns it over on the press itself, no editor between", async () => {
        renderPanel(buildNote({
            id: "flagged", title: "Flagged",
            "#done": "false",
            "#label:done": "promoted,single,boolean"
        }));

        // The mark a table cell reads a flag as, in place of the stored word.
        expect(firstRow().querySelector(".attribute-value .label-flag-unset")).not.toBeNull();

        await act(async () => firstRow().querySelector<HTMLElement>(".attribute-value")?.click());

        // The press toggled and saved; nothing opened, and the mark turned with it.
        expect(container.querySelector(".attribute-value-editor")).toBeNull();
        expect(put).toHaveBeenCalledOnce();
        const [ , saved ] = put.mock.calls[0] as [ string, { name: string; value: string }[] ];
        expect(saved.find((attribute) => attribute.name === "done")?.value).toBe("true");
        expect(firstRow().querySelector(".attribute-value .label-flag-set")).not.toBeNull();
    });

    it("shows a colour label as the colour itself, and edits it through the picker", () => {
        renderPanel(buildNote({ id: "tinted", title: "Tinted", "#color": "#8000ff" }));

        // The preview is the colour, not its text — which is kept to the chip's tooltip.
        const chip = firstRow().querySelector<HTMLElement>(".attribute-value .label-color-chip");
        expect(chip?.title).toBe("#8000ff");
        expect(chip?.style.backgroundColor).toBeTruthy();

        act(() => firstRow().querySelector<HTMLElement>(".attribute-value")?.click());

        const picker = container.querySelector<HTMLInputElement>(".attribute-value-editor input[type=color]");
        expect(picker?.value).toBe("#8000ff");
    });

    it("edits a select definition's options as chips in the popup, saved with the close", async () => {
        renderPanel(buildNote({
            id: "select-def", title: "Subject",
            "#label:status": "promoted,single,select,options=Todo"
        }));
        act(() => firstRow().click());

        // The options are entered as the values themselves are elsewhere: typed free, taken on enter.
        const optionsInput = document.querySelector<HTMLInputElement>(".attr-detail .values-input input");
        expect(optionsInput).not.toBeNull();
        act(() => {
            if (optionsInput) {
                optionsInput.value = "Done";
                optionsInput.dispatchEvent(new Event("input", { bubbles: true }));
                optionsInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            }
        });

        await act(async () => {
            document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        });

        expect(put).toHaveBeenCalledOnce();
        const [ , saved ] = put.mock.calls[0] as [ string, { name: string; value: string }[] ];
        expect(saved.find((attribute) => attribute.name === "label:status")?.value)
            .toContain("options=Todo;Done");
    });

    it("commits the in-place edit on enter for a label, a textarea keeping it for its lines", async () => {
        renderPanel(noteWithAttributes());
        act(() => firstRow().querySelector<HTMLElement>(".attribute-value")?.click());

        const input = container.querySelector<HTMLInputElement>(".attribute-value-editor input");
        act(() => {
            if (input) {
                input.value = "typed";
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        await act(async () => {
            input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        });

        expect(container.querySelector(".attribute-value-editor")).toBeNull();
        expect(put).toHaveBeenCalledOnce();
        const [ , saved ] = put.mock.calls[0] as [ string, { name: string; value: string }[] ];
        expect(saved.find((attribute) => attribute.name === "author")?.value).toBe("typed");

        // A textarea's enter is its own — it makes lines — so only held down with the modifier
        // does it stand for "done here".
        render(null, container);
        renderPanel(buildNote({
            id: "noted", title: "Noted",
            "#memo": "line one",
            "#label:memo": "promoted,single,textarea"
        }));
        act(() => firstRow().querySelector<HTMLElement>(".attribute-value")?.click());

        const textarea = container.querySelector<HTMLTextAreaElement>(".attribute-value-editor textarea");
        expect(textarea).not.toBeNull();
        act(() => {
            textarea?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        });
        expect(container.querySelector(".attribute-value-editor")).not.toBeNull();

        await act(async () => {
            textarea?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
        });
        expect(container.querySelector(".attribute-value-editor")).toBeNull();
    });

    it("wraps up the popup when an in-place edit starts, the new editor taking over from it", () => {
        renderPanel(noteWithAttributes());

        act(() => firstRow().click());
        expect(document.querySelector(".attr-detail")).not.toBeNull();

        act(() => firstRow().querySelector<HTMLElement>(".attribute-value")?.click());

        // The popup is committed — for a list of rows, saved — rather than left standing behind.
        expect(document.querySelector(".attr-detail")).toBeNull();
        expect(container.querySelector(".attribute-value-editor")).not.toBeNull();
        expect(put).toHaveBeenCalledOnce();
    });

    it("un-creates the creation row on escape, saving nothing", async () => {
        renderPanel(noteWithAttributes());
        act(() => container.querySelector<HTMLElement>(".attribute-add-row")?.click());

        const editor = container.querySelector<HTMLElement>(".attribute-creation-editor");
        const nameInput = editor?.querySelector<HTMLInputElement>(".attribute-creation-name input");
        act(() => {
            if (nameInput) {
                nameInput.value = "discarded";
                nameInput.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        act(() => {
            nameInput?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });

        expect(container.querySelector(".attribute-creation-editor")).toBeNull();
        expect(put).not.toHaveBeenCalled();
        expect(namesIn(container)).not.toContain("discarded");
    });

    it("skips the reloads it caused itself while an editor is open, and follows a foreign one", () => {
        const note = noteWithAttributes();
        renderPanel(note, true);

        act(() => firstRow().querySelector<HTMLElement>(".attribute-value")?.click());
        expect(container.querySelector(".attribute-value-editor")).not.toBeNull();

        // The widget's own save coming back: nothing to reload over, the edits being the freshest.
        act(() => fireEntitiesReloaded((componentId) => componentId === panelComponentId() ? [] : affectingRows(note)));
        expect(container.querySelector(".attribute-value-editor")).not.toBeNull();

        // A change made elsewhere rebuilds the rows; the editor's row is gone with them, so the
        // edit is dropped rather than left dangling over the fresher state.
        holdLabel(note, "elsewhere", "x");
        act(() => fireEntitiesReloaded(() => affectingRows(note)));
        expect(container.querySelector(".attribute-value-editor")).toBeNull();
        expect(namesIn(container)).toContain("elsewhere");

        // A creation draft is dropped the same way: the rebuilt rows have no place for it either.
        act(() => container.querySelector<HTMLElement>(".attribute-add-row")?.click());
        expect(container.querySelector(".attribute-creation-editor")).not.toBeNull();
        act(() => fireEntitiesReloaded(() => affectingRows(note)));
        expect(container.querySelector(".attribute-creation-editor")).toBeNull();
    });

    it("discards what the popup was told when it is closed rather than pressed away from", async () => {
        renderPanel(noteWithAttributes());

        act(() => firstRow().click());
        const popup = document.querySelector<HTMLElement>(".attr-detail");
        expect(popup).not.toBeNull();

        // Escape closes the popup, taking the pending edits with it — and saving nothing.
        await act(async () => {
            popup?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });
        expect(document.querySelector(".attr-detail")).toBeNull();
        expect(put).not.toHaveBeenCalled();

        // Deleting from the popup is the same deletion as from the row, confirmation and all.
        act(() => firstRow().click());
        await act(async () => document.querySelector<HTMLElement>(".attr-detail .attr-delete-button")?.click());

        expect(confirm).toHaveBeenCalledOnce();
        expect(put).toHaveBeenCalledOnce();
        expect(namesIn(container)).not.toContain("author");
    });

    /** What the panel subscribed to, when rendered under a parent component that can tell it. */
    let eventHandlers: Map<string, (data: unknown) => void>;

    function renderPanel(note: FNote, withEvents = false) {
        shownNote.current = note;
        if (!withEvents) {
            act(() => render(<AttributeList />, container));
            return;
        }

        eventHandlers = new Map();
        const parent = {
            componentId: panelComponentId(),
            registerHandler: (name: string, callback: (data: unknown) => void) => eventHandlers.set(name, callback),
            removeHandler: () => {}
        } as unknown as Component;
        act(() => render(
            <ParentComponent.Provider value={parent}>
                <AttributeList />
            </ParentComponent.Provider>,
            container
        ));
    }

    function panelComponentId() {
        return "panel-cid";
    }

    /** Hands the panel a reload, answering the row lookup as the given function does. */
    function fireEntitiesReloaded(getAttributeRows: (componentId?: string) => Partial<FAttributeRow>[]) {
        eventHandlers.get("entitiesReloaded")?.({ loadResults: { getAttributeRows } as unknown as LoadResults });
    }

    /** The reload's rows for a change touching the note, whoever made it. */
    function affectingRows(note: FNote) {
        return [ { noteId: note.noteId, type: "label", name: "changed", value: "", isInheritable: false } as Partial<FAttributeRow> ];
    }

    /** Writes another label onto the note behind the panel's back, as a foreign change would. */
    function holdLabel(note: FNote, name: string, value: string) {
        const added = attribute({ noteId: note.noteId, name, value, position: 50 });
        froca.attributes[added.attributeId] = added;
        note.attributes.push(added.attributeId);
    }

    /** Reads another note in the panel already rendered, as navigating to one does. */
    function showNote(note: FNote) {
        act(() => {
            shownNote.current = note;
            for (const listener of shownNote.listeners) {
                listener();
            }
        });
    }

    function cardIds() {
        return [ ...container.querySelectorAll(".card") ].map((card) => card.id);
    }

    function firstRow() {
        const row = container.querySelector<HTMLElement>(".attribute-row");
        expect(row).not.toBeNull();
        return row as HTMLElement;
    }
});

/** Which build the panel believes it is running in, which is all that decides one of its cards. */
function setDevBuild(isDev: boolean) {
    (window as unknown as { glob: { isDev: boolean } }).glob.isDev = isDev;
}

function namesIn(root: Element) {
    return [ ...root.querySelectorAll(".attribute-name") ].map((name) => name.textContent);
}

function iconsIn(root: Element) {
    return [ ...root.querySelectorAll(".attribute-kind > span") ].map(
        (icon) => icon.className.replace(" tn-icon", ""));
}

/**
 * A note carrying one of everything the panel sorts into cards: its own attributes (a name of its own,
 * two Trilium reads for itself), a definition, and the same two kinds reaching it from a parent.
 */
function noteWithAttributes() {
    buildNote({ id: "tpl", title: "Template" });
    buildNote({ id: "parent", title: "Parent" });
    const note = buildNote({
        id: "subject",
        title: "Subject",
        "#author": "Elian",
        "#cssClass": "wide",
        "~template": "tpl",
        "#label:priority": "promoted,single,date"
    });

    // The effective attributes the inherited ones are read out of, the note's own mixed in.
    noteAttributeCache.attributes[note.noteId] = [
        ...note.getOwnedAttributes(),
        inherited({ name: "inheritedLabel", value: "x" }),
        inherited({ name: "archived", value: "" }),
        inherited({ name: "label:status", value: "promoted,multi" })
    ];

    return note;
}

function inherited(row: Partial<FAttributeRow>) {
    return attribute({ noteId: "parent", isInheritable: true, ...row });
}

function plain(name: string, noteId = "own"): Attribute {
    return { type: "label", name, noteId, value: "", isInheritable: false };
}

function attribute(row: Partial<FAttributeRow>) {
    return new FAttribute(froca, {
        attributeId: `attr-${row.noteId ?? "own"}-${row.name ?? "x"}`,
        noteId: "own",
        type: "label",
        name: "label",
        value: "",
        position: 10,
        isInheritable: false,
        ...row
    });
}
