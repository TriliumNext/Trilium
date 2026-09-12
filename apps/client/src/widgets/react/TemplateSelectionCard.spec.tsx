import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import Component from "../../components/component";
import type FNote from "../../entities/fnote";
import contextMenu from "../../menus/context_menu";
import branches from "../../services/branches";
import froca from "../../services/froca";
import dialog from "../../services/dialog";
import LoadResults from "../../services/load_results";
import note_create from "../../services/note_create";
import { getNoteTypeOptions, type NoteTypeOption } from "../../services/note_types";
import server from "../../services/server";
import { ParentComponent } from "./react_utils";
import TemplateSelectionCard from "./TemplateSelectionCard";

// i18next is never initialised under test, so every label would read as undefined.
vi.mock("../../services/i18n", () => ({
    t: (key: string) => key
}));

// The listing is tested where it lives; the card is given a short one of each kind.
vi.mock("../../services/note_types", async () => {
    const actual = await vi.importActual<typeof import("../../services/note_types")>(
        "../../services/note_types");
    return { ...actual, getNoteTypeOptions: vi.fn(async () => AVAILABLE) };
});

/** Everything the app can create, as `getNoteTypeOptions` reports it. */
const AVAILABLE = [
    [ "type:text:text/html", "Text", "type" ],
    [ "type:code:text/x-markdown", "Markdown", "type" ],
    [ "type:canvas:application/json", "Canvas", "type" ],
    [ "template:shipped", "Shipped template", "builtin" ],
    [ "template:mine", "My template", "user" ]
].map(([ id, title, group ]) => ({
    id,
    title,
    group,
    icon: "bx bx-note",
    options: { type: "text", templateNoteId: id.split(":")[1] }
}) as NoteTypeOption);

/** The parent note a template created here is filed under. */
const OWNER = { noteId: "owner1" } as FNote;

describe("TemplateSelectionCard", () => {
    let container: HTMLElement;
    let stored: string[][];
    let offered: string[];
    let host: Component;

    beforeEach(() => {
        stored = [];
        host = new Component();
        offered = [ "type:text:text/html", "type:code:text/x-markdown" ];
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    it("lists what it is given, in the order it is given them, under the caller's words", async () => {
        await draw();

        expect(captions()).toEqual([ "Text", "Markdown" ]);
        expect(container.querySelector(".tn-card-heading")?.textContent).toContain("What to use");
        expect(container.querySelector(".tn-card-description")?.textContent)
            .toBe("Pick what a new one is made from.");
    });

    /** The grip leads, leaving the trailing edge to the entry's own buttons. */
    it("carries the grip at the start of an entry and the way to remove it at the end", async () => {
        await draw();
        const [ first ] = segments();

        expect(first.firstElementChild?.className).toContain("tn-sortable-grip");
        // Inside the segment's content, which is what renderItem draws.
        expect(first.querySelector(".tn-sortable-content")?.lastElementChild?.className)
            .toContain("template-selection-remove");
    });

    it("stores the order the reader puts them in", async () => {
        await draw();

        press(segments()[0], "ArrowDown", { ctrlKey: true });

        expect(stored).toEqual([ [ "type:code:text/x-markdown", "type:text:text/html" ] ]);
    });

    it("takes an entry away, and leaves the last one alone", async () => {
        await draw();

        act(() => { segments()[0].querySelector<HTMLElement>(".template-selection-remove")?.click(); });

        expect(stored).toEqual([ [ "type:code:text/x-markdown" ] ]);
        // Gone from the card too, which renders from its own state rather than the caller's.
        expect(captions()).toEqual([ "Markdown" ]);

        // An empty list creates nothing, so the last entry offers no way to remove it.
        offered = [ "type:text:text/html" ];
        await draw();
        expect(segments()[0].querySelector(".template-selection-remove")).toBeNull();
    });

    /** A template has a note behind it and so carries note commands; a note type does not. */
    describe("the commands on a template", () => {
        beforeEach(() => {
            offered = [ "type:text:text/html", "template:mine" ];
            vi.spyOn(froca, "getNote").mockResolvedValue({
                noteId: "mine",
                title: "My template",
                getIcon: () => "bx bx-note",
                getParentBranches: () => [ { branchId: "b_mine", parentNoteId: "owner1" } ]
            } as unknown as FNote);
        });

        it("offers a menu on a template and none on a note type", async () => {
            await draw();

            expect(segments()[0].querySelector(".template-selection-menu")).toBeNull();
            expect(segments()[1].querySelector(".template-selection-menu")).not.toBeNull();
        });

        it("lists what can be done with the note, and quick-edits it", async () => {
            const shown = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});
            const command = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined);
            await draw();

            act(() => { segments()[1].querySelector<HTMLElement>(".template-selection-menu")?.click(); });

            const items = shown.mock.calls.at(-1)?.[0].items ?? [];
            expect(items.map((item) => item && "uiIcon" in item ? item.uiIcon : "---")).toEqual([
                "bx bx-edit", "bx bx-window-open", "bx bx-outline", "---",
                "bx bx-trash destructive-action-icon"
            ]);
            // The last entry deletes the note rather than removing it from the list.
            expect(items.map((item) => item && "title" in item ? item.title : "---")).toEqual([
                "tree-context-menu.open-in-popup", "tree-context-menu.open-in-a-new-window",
                "tree-context-menu.duplicate", "---", "note_actions.delete_note"
            ]);

            const quick = items[0];
            if (!quick || !("handler" in quick)) throw new Error("expected a quick edit entry");
            quick.handler?.(quick, {} as never);
            expect(command)
                .toHaveBeenCalledWith("openInPopup", { noteIdOrPath: "mine", showNoteTypeSwitcher: true });
        });

        it("quick-edits and deletes from the keyboard", async () => {
            const command = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined);
            const deleted = vi.spyOn(branches, "deleteNotes").mockResolvedValue(true);
            await draw();

            press(segments()[1], " ");
            expect(command)
                .toHaveBeenCalledWith("openInPopup", { noteIdOrPath: "mine", showNoteTypeSwitcher: true });

            press(segments()[1], "Delete");
            await act(async () => { await Promise.resolve(); await Promise.resolve(); });
            expect(deleted).toHaveBeenCalledWith([ "b_mine" ], false, false);
            // Taken off the list once the note is deleted.
            expect(stored.at(-1)).toEqual([ "type:text:text/html" ]);
        });

        it("puts a duplicate beside the template it was copied from", async () => {
            offered = [ "type:text:text/html", "template:mine", "type:canvas:application/json" ];
            vi.spyOn(froca, "getNote").mockImplementation(async (noteId) => ({
                noteId,
                title: noteId === "copy1" ? "My template (copy)" : "My template",
                getIcon: () => "bx bx-note",
                getParentBranches: () => [ { branchId: `b_${noteId}`, parentNoteId: "owner1" } ]
            } as unknown as FNote));
            vi.spyOn(server, "post").mockResolvedValue({ note: { noteId: "copy1" } } as never);
            const shown = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});
            await draw();

            act(() => {
                segments()[1].querySelector<HTMLElement>(".template-selection-menu")?.click();
            });
            const copy = (shown.mock.calls.at(-1)?.[0].items ?? [])[2];
            if (!copy || !("handler" in copy)) throw new Error("expected a duplicate entry");
            await act(async () => {
                copy.handler?.(copy, {} as never);
                for (let step = 0; step < 6; step++) {
                    await Promise.resolve();
                }
            });

            expect(stored.at(-1)).toEqual([
                "type:text:text/html", "template:mine", "template:copy1",
                "type:canvas:application/json"
            ]);
            expect(captions())
                .toEqual([ "Text", "My template", "My template (copy)", "Canvas" ]);
        });

        /** A note type has no note behind it, so it handles none of those keys. */
        it("leaves the keys alone on a note type", async () => {
            // Cleared rather than created: an existing spy is returned with its calls.
            const command = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined);
            command.mockClear();
            await draw();

            press(segments()[0], " ");

            expect(command).not.toHaveBeenCalled();
        });
    });

    describe("adding one", () => {
        it("offers the note types and the reader's own templates, and not the app's", async () => {
            const picking = vi.spyOn(dialog, "pickSingleItem").mockResolvedValue(null);
            await draw();

            await add("template_selection.add-existing");

            const groups = picking.mock.calls.at(-1)?.[0].items as {
                key: string, items: { key: string }[]
            }[];
            expect(groups.map((group) => group.key)).toEqual([ "type", "user" ]);
            // What the caller already offers is left out, as is everything the app ships.
            expect(groups.flatMap((group) => group.items.map((item) => item.key)))
                .toEqual([ "type:canvas:application/json", "template:mine" ]);
        });

        it("adds what was picked to the end of the list", async () => {
            vi.spyOn(dialog, "pickSingleItem")
                .mockResolvedValue({ key: "template:mine", caption: "My template" });
            await draw();

            await add("template_selection.add-existing");

            expect(stored.at(-1))
                .toEqual([ "type:text:text/html", "type:code:text/x-markdown", "template:mine" ]);
            expect(captions()).toEqual([ "Text", "Markdown", "My template" ]);
        });

        it("adds nothing where the reader backed out of the picker", async () => {
            vi.spyOn(dialog, "pickSingleItem").mockResolvedValue(null);
            await draw();

            await add("template_selection.add-existing");

            expect(stored).toEqual([]);
            expect(captions()).toEqual([ "Text", "Markdown" ]);
        });

        /**
         * Until the read answers, `templates` cannot be resolved, and a creation would be stored
         * as the whole list.
         */
        it("offers no way to create one until it knows what exists", async () => {
            let answer: (options: NoteTypeOption[]) => void = () => {};
            vi.mocked(getNoteTypeOptions)
                .mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
            await draw();

            expect(adders().map((button) => (button as HTMLButtonElement).disabled))
                .toEqual([ true, true ]);

            await act(async () => {
                answer(AVAILABLE);
                await Promise.resolve();
            });

            expect(adders().map((button) => (button as HTMLButtonElement).disabled))
                .toEqual([ false, false ]);
            expect(stored).toEqual([]);
        });

        /**
         * The second button creates a template of its own: a note carrying `#template`, opened for
         * editing and offered from then on.
         */
        it("makes a template under the board, and offers it from then on", async () => {
            const made = vi.spyOn(note_create, "createTemplateNote").mockResolvedValue({
                noteId: "fresh",
                title: "template_selection.new-name",
                type: "text",
                mime: "text/html",
                getIcon: () => "bx bx-note"
            } as unknown as FNote);
            await draw();

            expect(adders().map((button) => button.textContent?.trim())).toEqual([
                "template_selection.add-existing", "template_selection.create"
            ]);

            await add("template_selection.create");

            expect(made).toHaveBeenCalledWith("owner1", "template_selection.new-name");
            expect(stored.at(-1)).toEqual([
                "type:text:text/html", "type:code:text/x-markdown", "template:fresh"
            ]);
            // Drawn straight away: the board has yet to hear of the note this was made from.
            expect(captions()).toEqual([ "Text", "Markdown", "template_selection.new-name" ]);
        });

        /** A caller whose templates are all of one kind says what one is called. */
        it("calls a template what the caller calls one", async () => {
            const made = vi.spyOn(note_create, "createTemplateNote").mockResolvedValue({
                noteId: "fresh",
                title: "New card template",
                type: "text",
                mime: "text/html",
                getIcon: () => "bx bx-note"
            } as unknown as FNote);
            await draw({ newTemplateName: "New card template" });

            await add("template_selection.create");

            expect(made).toHaveBeenCalledWith("owner1", "New card template");
            expect(captions().at(-1)).toBe("New card template");
        });

        it("adds nothing where the template could not be made", async () => {
            vi.spyOn(note_create, "createTemplateNote").mockResolvedValue(undefined);
            await draw();

            await add("template_selection.create");

            expect(stored).toEqual([]);
            expect(captions()).toEqual([ "Text", "Markdown" ]);
        });
    });

    /**
     * A template is a note, and the popup editor the menu opens writes to it. The entry follows the
     * note rather than the reading taken when the card was drawn.
     */
    describe("a template edited while the card is open", () => {
        beforeEach(() => { offered = [ "type:text:text/html", "template:mine" ]; });

        it("takes the new title once the note is renamed", async () => {
            await draw();
            expect(captions()).toEqual([ "Text", "My template" ]);

            answerWith("template:mine", { title: "Renamed" });
            await report(noteChanged("mine"));

            expect(captions()).toEqual([ "Text", "Renamed" ]);
        });

        it("takes the new icon, which is a label rather than part of the note", async () => {
            await draw();

            answerWith("template:mine", { icon: "bx bx-star" });
            await report(attributeChanged("iconClass", "mine"));

            expect(icons().at(-1)).toContain("bx-star");
        });

        it("reads again for a note it offers, and not for any other", async () => {
            await draw();
            const reads = () => vi.mocked(getNoteTypeOptions).mock.calls.length;
            const drawn = reads();

            await report(noteChanged("someOtherNote"));
            expect(reads()).toBe(drawn);

            await report(noteChanged("mine"));
            expect(reads()).toBe(drawn + 1);
        });
    });

    // #region The dialog, and what the test does to it

    /** Drawn, and given the moment it takes to read what a note can be made from. */
    async function draw({ newTemplateName }: { newTemplateName?: string } = {}) {
        await act(async () => {
            render(
                <ParentComponent.Provider value={host}>
                    <TemplateSelectionCard
                        heading="What to use"
                        instruction="Pick what a new one is made from."
                        note={OWNER}
                        newTemplateName={newTemplateName}
                        templates={offered}
                        onChange={(ids) => stored.push(ids)}
                    />
                </ParentComponent.Provider>,
                container);
            await Promise.resolve();
        });
    }

    function segments() {
        return [ ...container.querySelectorAll<HTMLElement>(".tn-sortable-segment") ];
    }

    function captions() {
        return segments().map((element) =>
            element.querySelector(".template-selection-name")?.textContent);
    }

    function adders() {
        return [ ...container.querySelectorAll<HTMLElement>(".tn-sortable-adder") ];
    }

    async function add(label: string) {
        const button = adders().find((element) => element.textContent?.trim() === label);
        await act(async () => {
            button?.click();
            await Promise.resolve();
            await Promise.resolve();
        });
    }

    function icons() {
        return segments().map((element) => element.querySelector(".bx")?.className);
    }

    /** Answers the next read with one entry changed, the rest as they were. */
    function answerWith(id: string, changed: Partial<NoteTypeOption>) {
        vi.mocked(getNoteTypeOptions).mockResolvedValueOnce(
            AVAILABLE.map((option) => option.id === id ? { ...option, ...changed } : option));
    }

    /** A renamed note, as the app reports one. */
    function noteChanged(noteId: string) {
        const results = new LoadResults([]);
        results.addNote(noteId, "other");
        return results;
    }

    /** A label written on a note, which is how an icon is changed. */
    function attributeChanged(name: string, noteId: string) {
        const results = new LoadResults([ {
            entityName: "attributes",
            entityId: "attr1",
            entity: { attributeId: "attr1", noteId, type: "label", name }
        } as never ]);
        results.addAttribute("attr1", "other");
        return results;
    }

    /** Hands the card what the app reports, and lets the read it asks for answer. */
    async function report(loadResults: LoadResults) {
        await act(async () => {
            host.handleEvent("entitiesReloaded", { loadResults });
            await Promise.resolve();
            await Promise.resolve();
        });
    }

    function press(target: Element, key: string, options: KeyboardEventInit = {}) {
        act(() => {
            target.dispatchEvent(
                new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
        });
    }

    // #endregion
});
