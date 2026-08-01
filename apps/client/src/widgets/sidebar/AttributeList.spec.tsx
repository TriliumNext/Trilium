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
    items: { kind?: string; uiIcon?: string; handler?: () => void }[];
}

// Copying and pasting report what they did; the toasts themselves belong to no widget.
const toast = vi.hoisted(() => ({ showMessage: vi.fn(), showError: vi.fn() }));
vi.mock("../../services/toast", () => ({ default: toast }));

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
import { writeAttributes } from "../../services/attribute_clipboard";
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

    it("holds the note's own attributes, the inherited ones and the definitions of either in one list", () => {
        renderPanel(noteWithAttributes());

        // One card for the lot, every run of it under a heading of its own — the card names the
        // panel, so the note's own attributes need one as much as the rest do.
        expect(container.querySelectorAll(".card")).toHaveLength(1);
        expect(groupIds()).toEqual([ "attributes-owned", "attributes-inherited", "attributes-definitions" ]);
        expect(namesIn(group("attributes-owned"))).toEqual([ "author", "cssClass", "template" ]);
        expect(namesIn(group("attributes-inherited"))).toEqual([ "inheritedLabel", "archived" ]);
        // The definitions of both notes share a group, the note's own first, and lose their prefix.
        expect(namesIn(group("attributes-definitions"))).toEqual([ "priority", "status" ]);

        // The kind is carried by the icon; a definition takes the icon of the field it sets up.
        expect(iconsIn(group("attributes-owned"))).toEqual([ "bx bx-hash", "bx bx-hash", "bx bx-transfer" ]);

        // The icon also carries the row's one tooltip — the row itself has none to compete with it.
        // Only its presence: the wording is translated, and translations stay unloaded here.
        expect(container.querySelector(".attribute-row")?.hasAttribute("title")).toBe(false);
        expect(container.querySelector(".attribute-kind")?.hasAttribute("title")).toBe(true);
        // A definition that names no type sets up a text field, and takes that field's icon.
        expect(iconsIn(group("attributes-definitions"))).toEqual([ "bx bx-calendar", "bx bx-text" ]);

        // The names Trilium reads for itself come last, below a rule, and are marked as such.
        expect(group("attributes-owned").querySelectorAll("hr.attribute-rows-divider")).toHaveLength(1);
        expect([ ...group("attributes-owned").querySelectorAll(".attribute-kind") ]
            .map((kind) => kind.className.includes("marker-system")))
            .toEqual([ false, true, true ]);

        // A row of the note's own is deletable and unattributed; an inherited one names its note instead.
        expect(group("attributes-owned").querySelectorAll(".attribute-delete-button")).toHaveLength(3);
        expect(group("attributes-owned").querySelectorAll(".attribute-owner")).toHaveLength(0);
        expect(group("attributes-inherited").querySelectorAll(".attribute-delete-button")).toHaveLength(0);
        expect(group("attributes-inherited").querySelectorAll(".attribute-owner")).toHaveLength(2);
        // Only what the note may edit is deletable, whichever run it is in.
        expect(group("attributes-definitions").querySelectorAll(".attribute-delete-button")).toHaveLength(1);

        // An inheritable attribute is marked, and every definition previews what it sets up — a
        // set-holding one (label:status, "multi") by a mark of its own rather than by words.
        expect(group("attributes-inherited").querySelectorAll(".attribute-marker")).toHaveLength(2);
        expect(group("attributes-definitions").querySelectorAll(".attribute-value.definition")).toHaveLength(2);
        expect(group("attributes-definitions").querySelectorAll(".definition-marker")).toHaveLength(1);
    });

    it("folds a run of rows away by its heading, and remembers it folded", async () => {
        options.set("rightPaneCollapsedItems", JSON.stringify([ "attributes-inherited" ]));
        renderPanel(noteWithAttributes());

        // Remembered from before, so the run arrives folded and its rows are not drawn at all.
        expect(group("attributes-inherited").className).toContain("collapsed");
        expect(namesIn(group("attributes-inherited"))).toEqual([]);
        // The card is the only one its tab has, so it is not itself something to fold away.
        expect(container.querySelector(".card")?.className).toContain("not-collapsible");

        await act(async () => groupHeader("attributes-inherited").click());
        expect(group("attributes-inherited").className).not.toContain("collapsed");
        expect(namesIn(group("attributes-inherited"))).toEqual([ "inheritedLabel", "archived" ]);
        expect(JSON.parse(options.get("rightPaneCollapsedItems") ?? "[]")).not.toContain("attributes-inherited");

        // And folding one back up is remembered the same way.
        await act(async () => groupHeader("attributes-definitions").click());
        expect(JSON.parse(options.get("rightPaneCollapsedItems") ?? "[]")).toContain("attributes-definitions");
    });

    it("leaves a note carrying no attributes its heading and the way in, and says nothing besides", () => {
        renderPanel(buildNote({ id: "empty", title: "Empty" }));

        // The run stands, empty. Nothing stands in for its rows: the heading counts them — at zero —
        // and the add row says what there is to do about it, so any "no attributes" beside those two
        // would be a third telling of the one fact, and the loudest of the three at that.
        expect(container.querySelectorAll(".attribute-row")).toHaveLength(0);
        expect(container.querySelector(".no-items")).toBeNull();
        expect(groupIds()).toEqual([ "attributes-owned" ]);
        expect(group("attributes-owned").querySelector(".attribute-group-count")?.textContent).toBe("0");
        expect(group("attributes-owned").querySelector(".attribute-add-row")).not.toBeNull();
    });

    it("leaves what Trilium wrote for itself out of a release build, and gives it its own run in a development one", () => {
        buildNote({ id: "target", title: "Target" });
        const note = buildNote({ id: "linking", title: "Linking", "#author": "Elian", "~internalLink": "target" });

        renderPanel(note);
        expect(groupIds()).toEqual([ "attributes-owned" ]);

        // Unmounted first, the panel collecting the attributes of the note it is handed as it mounts.
        setDevBuild(true);
        render(null, container);
        renderPanel(note);

        expect(groupIds()).toEqual([ "attributes-owned", "attributes-internal" ]);
        const internal = group("attributes-internal");
        expect(namesIn(internal)).toEqual([ "internalLink" ]);
        // Nothing on such a row is the note's to change, and nothing marks it as Trilium's own: the
        // heading it is under says as much of every row it holds.
        expect(internal.querySelectorAll(".attribute-delete-button")).toHaveLength(0);
        expect(internal.querySelectorAll(".attribute-owner")).toHaveLength(0);
        expect(internal.querySelector(".attribute-kind")?.className).not.toContain("marker-system");
        expect(internal.querySelectorAll("hr.attribute-rows-divider")).toHaveLength(0);
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

    it("adds a definition from the panel's menu or the run's own way in, saving it once the popup is closed", async () => {
        renderPanel(noteWithAttributes());

        // One list, so one button, and it offers every kind: the definitions had a button of their
        // own while they had a card of their own, which offered nothing this one does not.
        const addButton = container.querySelector<HTMLElement>(".card-header-buttons .bx-plus");
        act(() => addButton?.click());

        // Four kinds and the rule setting the definitions apart from what they define.
        const { items } = showContextMenu.mock.calls[0][0];
        expect(items).toHaveLength(5);
        expect(items[2].kind).toBe("separator");

        // A definition still goes through the form, its settings needing one; nothing is saved until
        // it is closed, and a press beside it keeps the edits — which for a list of rows means saving.
        act(() => items[3].handler?.());
        expect(document.querySelector(".attr-detail")).not.toBeNull();
        expect(put).not.toHaveBeenCalled();

        await act(async () => {
            document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        });

        expect(document.querySelector(".attr-detail")).toBeNull();
        const [ , saved ] = put.mock.calls[0] as [ string, { name: string; value: string }[] ];
        expect(saved.at(-1)).toEqual(
            { type: "label", name: "label:myLabel", value: "promoted,single,text", isInheritable: false });

        // The run has a way in of its own too, as the note's own attributes do: the panel's button is
        // a long way from the definitions once a template has filled the pane. It adds the one kind —
        // the form's own list of field types is where a relation definition is reached — so it opens
        // the same popup on the same thing the menu's third entry did, with no menu in between.
        const definitionAddRow = group("attributes-definitions").querySelector<HTMLElement>(".attribute-add-row");
        expect(definitionAddRow).not.toBeNull();
        act(() => definitionAddRow?.click());
        expect(document.querySelector(".attr-detail")).not.toBeNull();
        expect(put).toHaveBeenCalledOnce();

        await act(async () => {
            document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        });

        const [ , savedAgain ] = put.mock.calls[1] as [ string, { name: string; value: string }[] ];
        expect(savedAgain.at(-1)).toEqual(
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
        const archived = [ ...group("attributes-inherited").querySelectorAll(".attribute-row") ]
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

    it("picks rows out with the modifiers, across the cards, and lets a plain press take over again", () => {
        renderPanel(noteWithAttributes());

        // Control adds and removes the one row, as a list of files is picked through.
        pick(0, { ctrlKey: true });
        expect(selectedNames()).toEqual([ "author" ]);
        pick(0, { ctrlKey: true });
        expect(selectedNames()).toEqual([]);
        // The rows are not what the press was about, so no form is opened over them.
        expect(document.querySelector(".attr-detail")).toBeNull();

        // Shift draws a range from the row last picked out, over the cards' boundaries: the owned
        // card's three rows and the first of the inherited card's.
        pick(0, { ctrlKey: true });
        pick(3, { shiftKey: true });
        expect(selectedNames()).toEqual([ "author", "cssClass", "template", "inheritedLabel" ]);

        // While rows are being picked out the whole row picks, so a press with nothing held down
        // picks too rather than opening the form and letting the selection go.
        act(() => rows()[1].click());
        expect(selectedNames()).toEqual([ "author", "template", "inheritedLabel" ]);
        expect(document.querySelector(".attr-detail")).toBeNull();

        // With none picked out it is the one attribute it landed on again.
        act(() => barButton("bx bx-x")?.click());
        act(() => rows()[1].click());
        expect(selectedNames()).toEqual([]);
        expect(document.querySelector(".attr-detail")).not.toBeNull();
    });

    it("keeps a press on a picked row from whatever it lands on within it", () => {
        renderPanel(noteWithAttributes());

        // Nothing picked out: the value is its own way in, which opens the field over it.
        act(() => rows()[0].querySelector<HTMLElement>(".attribute-value")?.click());
        expect(container.querySelector(".attribute-value-editor")).not.toBeNull();

        pick(2, { ctrlKey: true });
        expect(selectedNames()).toEqual([ "template" ]);

        // Picked out, the same press picks the row instead — and is refused besides, so that a
        // relation's value, which is a link to the note it points at, is not navigated to either.
        const press = new MouseEvent("click", { bubbles: true, cancelable: true });
        act(() => void rows()[0].querySelector(".attribute-value")?.dispatchEvent(press));

        expect(press.defaultPrevented).toBe(true);
        // Read in the order the rows are drawn, whichever order they were picked out in.
        expect(selectedNames()).toEqual([ "author", "template" ]);
        expect(container.querySelectorAll(".attribute-value-editor")).toHaveLength(0);
    });

    it("copies the picked rows as the text the attributes editor spells them out in", () => {
        renderPanel(noteWithAttributes());

        // Nothing picked out: the press is about whatever text is selected, and is left alone.
        const untouched = copyFrom(firstPanel());
        expect(untouched.defaultPrevented).toBe(false);
        expect(untouched.written).toEqual({});

        pick(0, { ctrlKey: true });
        pick(2, { ctrlKey: true });

        const copied = copyFrom(firstPanel());
        expect(copied.defaultPrevented).toBe(true);
        // Both flavours, the relation as the path in the one and as a reference link in the other.
        expect(copied.written["text/plain"]).toBe("#author=Elian ~template=#root/tpl");
        expect(copied.written["text/html"]).toContain('href="#root/tpl"');
        expect(toast.showMessage).toHaveBeenCalledOnce();
    });

    it("pastes attributes onto the note, replacing a name it already carries and adding the rest", async () => {
        // A note of its own: the effective-attribute cache is shared between the tests, so a note
        // named as another test's would arrive carrying that one's inherited attributes.
        const note = buildNote({ id: "pastee", title: "Pastee", "#author": "Someone" });
        const existingId = note.getOwnedAttributes()[0].attributeId;
        renderPanel(note);

        await act(async () => pasteInto(firstPanel(), { "text/plain": "#author=Elian #tag=new ~parent=#root/tpl" }));

        expect(put).toHaveBeenCalledOnce();
        const [ url, saved ] = put.mock.calls[0] as [ string, Attribute[] ];
        expect(url).toBe("notes/pastee/attributes");
        expect(saved).toMatchObject([
            // Replaced in place, the attribute staying the one it was rather than a second `author`.
            { type: "label", name: "author", value: "Elian", attributeId: existingId },
            { type: "label", name: "tag", value: "new" },
            { type: "relation", name: "parent", value: "tpl" }
        ]);
        // Nothing of the note the attributes were copied from comes across with them.
        expect(saved[1].attributeId).toBeUndefined();
        expect(namesIn(container)).toEqual([ "author", "tag", "parent" ]);
    });

    it("says what it made of a clipboard that is not attributes, and saves nothing over it", async () => {
        renderPanel(buildNote({ id: "subject", title: "Subject", "#author": "Someone" }));

        await act(async () => pasteInto(firstPanel(), { "text/plain": "just some prose" }));
        expect(toast.showError).toHaveBeenCalledOnce();
        expect(put).not.toHaveBeenCalled();

        // An empty clipboard is not an error, only nothing to do.
        await act(async () => pasteInto(firstPanel(), { "text/plain": "" }));
        expect(toast.showError).toHaveBeenCalledOnce();
        expect(put).not.toHaveBeenCalled();
    });

    it("offers the picked rows to a right press, narrowing down to the one row pressed outside them", async () => {
        renderPanel(noteWithAttributes());
        pick(0, { ctrlKey: true });
        pick(1, { ctrlKey: true });

        // A right press on a row among those picked out is about all of them.
        rightPress(1);
        expect(selectedNames()).toEqual([ "author", "cssClass" ]);

        // Deleting the lot is confirmed once, as a single row's deletion is.
        confirm.mockResolvedValueOnce(true);
        await act(async () => menuItem("bx bx-trash")?.handler?.());
        expect(confirm).toHaveBeenCalledOnce();
        const [ , saved ] = put.mock.calls[0] as [ string, Attribute[] ];
        expect(saved.map((attribute) => attribute.name)).toEqual([ "template", "label:priority" ]);

        // Deleting the lot let them all go, so nothing is picked out now — and a right press then
        // picks nothing out for itself: it is a press asking what can be done to the row under it,
        // not one picking that row out, and picking it would turn the whole panel over to the
        // standing rows are picked out in, bar and checkboxes and all, for a menu about one row.
        expect(selectedNames()).toEqual([]);
        rightPress(0);
        expect(selectedNames()).toEqual([]);
        expect(container.querySelector(".attribute-selection-bar")).toBeNull();
        expect(container.querySelector(".attribute-list-panel")?.className).not.toContain("selecting");
        // The menu is about the row pressed all the same, which is the point of the press.
        expect(menuItem("bx bx-copy")).toBeDefined();
        expect(menuItem("bx bx-trash")).toBeDefined();

        // With rows picked out, though, a right press outside them narrows down to that row alone:
        // what the menu acts on has to be what the panel shows as picked.
        pick(1, { ctrlKey: true });
        rightPress(0);
        expect(selectedNames()).toEqual([ "template" ]);
        // An inherited row is the source note's to delete, so only copying is offered over it.
        rightPress(1);
        expect(menuItem("bx bx-trash")).toBeUndefined();
        expect(menuItem("bx bx-copy")).toBeDefined();
    });

    it("pastes from a menu what Trilium last copied, beside the rows as well as on them", async () => {
        renderPanel(buildNote({ id: "source", title: "Source", "#author": "Elian", "#tag": "book" }));
        pick(0, { ctrlKey: true });
        pick(1, { ctrlKey: true });
        // Copied from the menu, which is the way in that holds on to them for a menu to paste.
        rightPress(0);
        expect(menuItem("bx bx-copy")).toBeDefined();
        await act(async () => menuItem("bx bx-copy")?.handler?.());

        // A note with no attributes at all has no row to press: the card itself offers the paste.
        renderPanel(buildNote({ id: "blank", title: "Blank" }));
        expect(container.querySelectorAll(".attribute-row")).toHaveLength(0);
        act(() => {
            firstPanel().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
        });

        await act(async () => menuItem("bx bx-paste")?.handler?.());
        const [ url, saved ] = put.mock.calls[0] as [ string, Attribute[] ];
        expect(url).toBe("notes/blank/attributes");
        expect(saved).toMatchObject([
            { type: "label", name: "author", value: "Elian" },
            { type: "label", name: "tag", value: "book" }
        ]);
        expect(namesIn(container)).toEqual([ "author", "tag" ]);
    });

    it("offers no menu of its own beside the rows while there is nothing to paste", () => {
        // Whatever an earlier test copied is still held, the store being the module's own — as the
        // note tree's clipboard is. Copying nothing is how a session that has copied nothing looks.
        writeAttributes(null, []);
        renderPanel(buildNote({ id: "blank", title: "Blank" }));

        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        act(() => {
            firstPanel().dispatchEvent(event);
        });

        // Left to the browser's own menu, rather than shown an empty one of ours.
        expect(showContextMenu).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it("picks rows out by the checkbox standing in the kind icon's slot, no modifier held", () => {
        renderPanel(noteWithAttributes());

        // Every row offers one — the stylesheet is what shows it only over the row being pointed at
        // — but the rows Trilium keeps for itself offer none, being carried nowhere.
        expect(container.querySelectorAll(".attribute-kind-check")).toHaveLength(7);

        checkbox(0).click();
        expect(selectedNames()).toEqual([ "author" ]);
        // A checkbox adds rather than takes over, which is what a checkbox means.
        checkbox(2).click();
        expect(selectedNames()).toEqual([ "author", "template" ]);
        // And is not the row's press: no form opens behind the selection.
        expect(document.querySelector(".attr-detail")).toBeNull();

        checkbox(0).click();
        expect(selectedNames()).toEqual([ "template" ]);
    });

    it("stands a bar at the foot of the list saying what can be done to the rows picked out", async () => {
        renderPanel(noteWithAttributes());

        // Nothing picked out: no bar, and the list says it is not picking rows out — which is what
        // draws the checkboxes.
        expect(container.querySelector(".attribute-selection-bar")).toBeNull();
        expect(firstPanel().className).not.toContain("selecting");

        checkbox(0).click();
        const bar = container.querySelector(".attribute-selection-bar");
        expect(bar).not.toBeNull();
        expect(firstPanel().className).toContain("selecting");
        // The bar belongs to the whole list rather than to a run of it, the rows it acts on being
        // picked out anywhere: it stands at the list's own foot, outside every folding run.
        expect(bar?.closest(".attribute-group")).toBeNull();
        expect(bar?.closest(".attribute-list-panel")).not.toBeNull();
        // Adding an attribute stays on offer beside the note's own rows; the bar took nothing over.
        expect(container.querySelector(".attribute-add-row")).not.toBeNull();
        // Only that the count has a slot: the wording is translated, and translations stay unloaded.
        expect(bar?.querySelector(".attribute-selection-count")).not.toBeNull();

        // Copy, delete and the way out, the note owning the one row picked out; nothing to paste yet.
        writeAttributes(null, []);
        checkbox(1).click();
        expect(barIcons()).toEqual([ "bx bx-copy", "bx bx-trash", "bx bx-x" ]);

        // Copying from the bar holds the attributes, which is what puts pasting on offer.
        await act(async () => barButton("bx bx-copy")?.click());
        expect(barIcons()).toEqual([ "bx bx-copy", "bx bx-paste", "bx bx-trash", "bx bx-x" ]);

        // An inherited row is the source note's to delete, so the lot cannot be.
        checkbox(3).click();
        expect(barIcons()).not.toContain("bx bx-trash");

        // The way out is letting every row go, which takes the bar with it.
        act(() => barButton("bx bx-x")?.click());
        expect(selectedNames()).toEqual([]);
        expect(container.querySelector(".attribute-selection-bar")).toBeNull();
        expect(firstPanel().className).not.toContain("selecting");
    });

    function rows() {
        return [ ...container.querySelectorAll<HTMLElement>(".attribute-row") ];
    }

    function checkbox(index: number) {
        const box = container.querySelectorAll<HTMLElement>(".attribute-kind-check")[index];
        expect(box).toBeDefined();
        return { click: () => act(() => box.click()) };
    }

    /** An action button wears its icon as classes of its own, rather than around a glyph of one. */
    function barIcons() {
        return [ ...container.querySelectorAll(".attribute-selection-bar .icon-action") ]
            .map((button) => [ ...button.classList ].filter((name) => name.startsWith("bx")).join(" "));
    }

    function barButton(icon: string) {
        return container.querySelector<HTMLElement>(
            `.attribute-selection-bar .icon-action.${icon.split(" ").join(".")}`);
    }

    function selectedNames() {
        return [ ...container.querySelectorAll(".attribute-row.selected .attribute-name") ]
            .map((name) => name.textContent);
    }

    function firstPanel() {
        const panel = container.querySelector<HTMLElement>(".attribute-list-panel");
        expect(panel).not.toBeNull();
        return panel as HTMLElement;
    }

    /** A press on a row with the modifiers held down that pick it out rather than open it. */
    function pick(index: number, modifiers: { ctrlKey?: boolean; shiftKey?: boolean }) {
        act(() => {
            rows()[index].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers }));
        });
    }

    function rightPress(index: number) {
        act(() => {
            rows()[index].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
        });
    }

    /** The copy key over the panel, reporting what it wrote onto the clipboard it was handed. */
    function copyFrom(panel: HTMLElement) {
        const written: Record<string, string> = {};
        const event = clipboardEvent("copy", { setData: (type: string, data: string) => { written[type] = data; } });
        panel.dispatchEvent(event);

        return { written, defaultPrevented: event.defaultPrevented };
    }

    /** The paste key over the panel, the clipboard holding the given flavours. */
    function pasteInto(panel: HTMLElement, flavours: Record<string, string>) {
        panel.dispatchEvent(clipboardEvent("paste", { getData: (type: string) => flavours[type] ?? "" }));
    }

    /**
     * A clipboard event carrying the given stand-in for the system clipboard: the constructor takes
     * no data of its own, so it is hung on the event as the browser hangs the real one.
     */
    function clipboardEvent(type: string, clipboardData: Partial<DataTransfer>) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.assign(event, { clipboardData });

        return event;
    }

    /** The entry of the menu last shown carrying the given icon, which is what names it here: the
     *  titles are translated, and translations stay unloaded in these tests. */
    function menuItem(icon: string) {
        const call = showContextMenu.mock.lastCall?.[0];
        return call?.items.find((item) => item.uiIcon === icon);
    }

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

    function groupIds() {
        return [ ...container.querySelectorAll(".attribute-group") ]
            .map((el) => [ ...el.classList ].find((name) => name.startsWith("attributes-")));
    }

    function group(id: string) {
        const el = container.querySelector<HTMLElement>(`.attribute-group.${id}`);
        expect(el, id).not.toBeNull();
        return el as HTMLElement;
    }

    function groupHeader(id: string) {
        const header = group(id).querySelector<HTMLElement>(".attribute-group-header");
        expect(header, id).not.toBeNull();
        return header as HTMLElement;
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
    // The icon alone: the slot also holds the checkbox that stands in for it while rows are picked out.
    return [ ...root.querySelectorAll(".attribute-kind > .tn-icon") ].map(
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
