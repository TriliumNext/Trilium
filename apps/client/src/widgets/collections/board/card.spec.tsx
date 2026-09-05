/**
 * A card renders state that no board redraw is triggered for, so each of those has to reach the card
 * through a subscription of its own. These check that the card actually receives them.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import contextMenu from "../../../menus/context_menu";
import cssClassManager from "../../../services/css_class_manager";
import FAttribute from "../../../entities/fattribute";
import froca from "../../../services/froca";
import LoadResults from "../../../services/load_results";
import noteAttributeCache from "../../../services/note_attribute_cache";
import server from "../../../services/server";
import utils from "../../../services/utils";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import BoardApi from "./api";
import BoardView from ".";

// The card menu opens with the shared link items, which reach for the active note context.
vi.mock("../../../menus/link_context_menu", () => ({
    default: { getItems: () => [], handleLinkContextMenuItem: () => {} }
}));

/** Counts how often each card has drawn, which is what the memo boundary around it decides. */
const draws = vi.hoisted(() => new Map<string, number>());
vi.mock("../../attribute_widgets/UserAttributesList", () => ({
    default: ({ note }: { note: { noteId: string } }) => {
        draws.set(note.noteId, (draws.get(note.noteId) ?? 0) + 1);
        // What a relation draws: a link to the note it points at, and beside it one to a page of
        // its own, which is not the card's to open.
        return (
            <span className="user-attributes">
                <a className="relation-link" href="#root/targetNote">Target</a>
                <a className="outside-link" href="https://example.invalid">Elsewhere</a>
            </span>
        );
    }
}));

describe("Board card", () => {
    let container: HTMLElement | undefined;
    /** froca is module-level, so ids are kept distinct rather than reset between tests. */
    let idSeed = 0;

    beforeEach(() => {
        vi.restoreAllMocks();
        draws.clear();
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    it("dims a card when its note is archived, without the board being redrawn", async () => {
        // Archiving reaches the board two ways, and only one of them fires here. With
        // #includeArchived off the note leaves the collection's id list, which re-runs the board's
        // refresh; with it on the list is unchanged, so nothing above the card reacts at all.
        const { component, first, second } = await renderBoard();

        expect(cardClasses(first)).not.toContain("archived");

        await addLabel(component, first, "archived");

        expect(cardClasses(first)).toContain("archived");
        expect(cardClasses(second)).not.toContain("archived");
    });

    /**
     * A board holds hundreds of cards, so a refresh that redrew all of them would make one card's
     * move cost the whole board. The api is what this rests on: rebuilt per refresh, as it once was,
     * it is a new prop on every card and no card can be skipped.
     */
    it("leaves the cards a refresh did not change undrawn", async () => {
        const { component, first, second } = await renderBoard();
        const before = draws.get(first);
        expect(before).toBeGreaterThan(0);

        // The last card takes a column of its own, so the first one keeps both its column and its
        // place in it while the board rebuilds its data.
        await changeStatus(component, second, "Done");

        expect(columnsOf(container)).toContain("Done");
        expect(draws.get(first)).toBe(before);
        expect(draws.get(second)).toBeGreaterThan(before ?? 0);
    });

    /**
     * The board does not redraw a card for a colour, and a card whose props have not changed is
     * skipped by the memo around it, so the card has to hear about the label itself.
     */
    it("follows its note's colour", async () => {
        const { component, first, second } = await renderBoard();
        const coloured = cssClassManager.createClassForColor("#ff0000");

        expect(cardClasses(first)).not.toContain(coloured);

        await addLabel(component, first, "color", "#ff0000");

        expect(cardClasses(first)).toContain(coloured);
        expect(cardClasses(second)).not.toContain(coloured);
    });

    it("follows its note's icon, which the quick edit popup sets as a label", async () => {
        const { component, first } = await renderBoard();

        expect(cardIcon(first)).not.toContain("bx-bug");

        await addLabel(component, first, "iconClass", "bx bx-bug");

        expect(cardIcon(first)).toContain("bx-bug");
    });

    it("opens the note it stands for when clicked", async () => {
        const { first } = await renderBoard();
        const openInPopup = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined);

        await act(async () => { card(first).click(); });

        expect(openInPopup)
            .toHaveBeenCalledWith("openInPopup", { noteIdOrPath: first });
    });

    /**
     * A relation on a card is drawn as a link to the note it points at. The page's own link handler
     * would open that in a tab, and the card underneath would open itself over the top of it.
     */
    it("opens what a link inside it points at, and only that", async () => {
        const { first } = await renderBoard();
        const opened = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined);
        const link = card(first).querySelector<HTMLElement>(".relation-link");
        if (!link) throw new Error("expected the relation link");

        const press = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
        await act(async () => { link.dispatchEvent(press); });

        expect(opened).toHaveBeenCalledTimes(1);
        expect(opened).toHaveBeenCalledWith("openInPopup", { noteIdOrPath: "root/targetNote" });
        // Taken here, so the page's own handler never sees it and no tab is opened.
        expect(press.defaultPrevented).toBe(true);
        expect(press.cancelBubble).toBe(true);
    });

    /** A link out of Trilium is the browser's to follow, and opens no card over it. */
    it("leaves a link that names no note alone", async () => {
        const { first } = await renderBoard();
        const opened = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined);
        opened.mockClear();

        await act(async () => {
            card(first).querySelector<HTMLElement>(".outside-link")?.click();
        });

        expect(opened).not.toHaveBeenCalled();
    });

    /**
     * Enter opens the field a card is named in where a spreadsheet would add a row, and Shift puts
     * it above instead. The card itself is made by that field, once it has been given a title.
     */
    it("opens the field under the focused card for Enter, and over it for Shift and Enter",
        async () => {
            const openInPopup = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined);
            const { first } = await renderBoard();

            await act(async () => { press(card(first), "Enter"); });
            expect(fieldBeside(first)).toBe("after");

            await act(async () => { press(card(first), "Enter", { shiftKey: true }); });
            expect(fieldBeside(first)).toBe("before");

            // The card it was pressed on stays where it is; Space is what opens one.
            expect(openInPopup).not.toHaveBeenCalled();
        });

    /** Which side of a card the field for a new one stands on, or that none is open. */
    function fieldBeside(noteId: string) {
        const field = container?.querySelector(".board-new-item.inserting");
        if (!field) return "none";

        const element = card(noteId);
        if (field.previousElementSibling === element) return "after";
        if (field.nextElementSibling === element) return "before";
        return "elsewhere";
    }

    it("opens the note once for a double click, not once per click of it", async () => {
        const { first } = await renderBoard();
        const openInPopup = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined);
        const element = card(first);

        // What a browser sends for a double click: the same event twice, counted by `detail`.
        await act(async () => {
            element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
            element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
        });

        expect(openInPopup).toHaveBeenCalledTimes(1);
    });

    it("puts its title into the editor from its button and from F2, and saves it", async () => {
        const { first } = await renderBoard();
        const put = vi.spyOn(server, "put").mockResolvedValue(undefined);
        // Held on to: the editor takes the place of the title the lookup goes by.
        const element = card(first);

        await act(async () => { press(element, "F2"); });
        const editor = element.querySelector<HTMLTextAreaElement>("textarea");
        if (!editor) throw new Error("expected the title editor");

        await act(async () => {
            editor.focus();
            editor.value = "  Renamed  ";
            editor.blur();
        });
        expect(put).toHaveBeenCalledWith(`notes/${first}/title`, { title: "Renamed" });

        // The pencil opens the same editor, without also opening the note underneath it.
        const openInPopup = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined);
        await act(async () => { element.querySelector<HTMLElement>(".edit-icon")?.click(); });
        expect(element.querySelector("textarea")).toBeTruthy();
        expect(openInPopup).not.toHaveBeenCalled();
    });

    it("offers the card menu on a right click", async () => {
        const { first } = await renderBoard();
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});

        await act(async () => {
            card(first).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
        });

        expect(show).toHaveBeenCalled();
    });

    /** Presses a key on a card, which listens for them to open and to rename. */
    function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}) {
        target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
    }

    /**
     * happy-dom defines no `ondragstart` on elements, so Preact registers the handler under the
     * prop's own casing rather than the DOM event name (see drag.spec).
     */
    function fireDrag(target: HTMLElement, type: "dragstart" | "dragend", dataTransfer: unknown) {
        const cased = type === "dragstart" ? "DragStart" : "DragEnd";
        const event = new Event(`on${type}` in target ? type : cased, { bubbles: true });
        Object.defineProperty(event, "dataTransfer", { value: dataTransfer, configurable: true });
        target.dispatchEvent(event);
    }

    /** Renders a board of two cards and hands back the component their subscriptions register on. */
    async function renderBoard() {
        const first = `card${idSeed++}`;
        const second = `card${idSeed++}`;
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { id: first, title: "First", "#status": "To Do" },
                { id: second, title: "Second", "#status": "To Do" }
            ]
        });

        const component = new Component();
        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        await act(async () => {
            render(
                <ParentComponent.Provider value={component}>
                    <BoardView
                        note={note}
                        notePath={`root/${note.noteId}`}
                        noteIds={[ first, second ]}
                        highlightedTokens={null}
                        viewConfig={{ columns: [ { value: "To Do" } ] }}
                        saveConfig={() => {}}
                        media="screen"
                        onReady={() => {}}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await settle();

        return { note, component, first, second };
    }

    /** Moves a card to another column the way an edit made anywhere else reaches the board. */
    async function changeStatus(component: Component, noteId: string, value: string) {
        const attribute = (noteAttributeCache.attributes[noteId] ?? [])
            .find(candidate => candidate.name === "status");
        if (!attribute) throw new Error(`no status label on ${noteId}`);
        attribute.value = value;

        const entity = {
            attributeId: attribute.attributeId, noteId, type: "label", name: "status", value,
            isDeleted: false
        };
        const loadResults = new LoadResults([ {
            entityName: "attributes", entityId: attribute.attributeId, entity, hash: "",
            isSynced: true, isErased: false
        } ]);
        loadResults.addAttribute(attribute.attributeId, "someOtherComponent");

        await act(async () => {
            await component.handleEvent("entitiesReloaded", { loadResults });
        });
        await settle();
    }

    /** The columns the board is showing, in the order it draws them. */
    function columnsOf(root: HTMLElement | undefined) {
        return [ ...root?.querySelectorAll(".board-column") ?? [] ]
            .map(column => column.getAttribute("data-column"));
    }

    /** Adds a label to a note already in froca and announces it the way a websocket message would. */
    async function addLabel(component: Component, noteId: string, name: string, value = "") {
        const attributeId = utils.randomString(12);
        const attribute = new FAttribute(froca, {
            noteId, attributeId, type: "label", name, value, position: 0, isInheritable: false
        });

        froca.attributes[attributeId] = attribute;
        froca.notes[noteId].attributes.push(attributeId);
        noteAttributeCache.attributes[noteId] = [ ...(noteAttributeCache.attributes[noteId] ?? []), attribute ];

        const entity = { attributeId, noteId, type: "label", name, value, isDeleted: false };
        const loadResults = new LoadResults([ {
            entityName: "attributes", entityId: attributeId, entity, hash: "", isSynced: true, isErased: false
        } ]);
        loadResults.addAttribute(attributeId, "someOtherComponent");

        await act(async () => {
            await component.handleEvent("entitiesReloaded", { loadResults });
        });
        await settle();
    }

    function card(noteId: string) {
        const title = froca.notes[noteId]?.title;
        const element = [ ...(container?.querySelectorAll<HTMLElement>(".board-note") ?? []) ]
            .find((el) => el.querySelector(".title")?.textContent?.includes(title));
        if (!element) throw new Error(`no card rendered for ${noteId} ("${title}")`);

        return element;
    }

    const cardClasses = (noteId: string) => card(noteId).className;
    const cardIcon = (noteId: string) => card(noteId).querySelector(".title .icon")?.className ?? "";
});

/** Drains the async chain inside the board's `refresh()` plus any re-render it queues. */
async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve));
    });
}
