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
import FAttribute from "../../../entities/fattribute";
import froca from "../../../services/froca";
import LoadResults from "../../../services/load_results";
import noteAttributeCache from "../../../services/note_attribute_cache";
import server from "../../../services/server";
import utils from "../../../services/utils";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import BoardView from ".";

// The card menu opens with the shared link items, which reach for the active note context.
vi.mock("../../../menus/link_context_menu", () => ({
    default: { getItems: () => [], handleLinkContextMenuItem: () => {} }
}));

describe("Board card", () => {
    let container: HTMLElement | undefined;
    /** froca is module-level, so ids are kept distinct rather than reset between tests. */
    let idSeed = 0;

    beforeEach(() => vi.restoreAllMocks());

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

    it("follows its note's icon, which the quick edit popup sets as a label", async () => {
        const { component, first } = await renderBoard();

        expect(cardIcon(first)).not.toContain("bx-bug");

        await addLabel(component, first, "iconClass", "bx bx-bug");

        expect(cardIcon(first)).toContain("bx-bug");
    });

    it("opens the note it stands for, by click and by Enter", async () => {
        const { first } = await renderBoard();
        const openInPopup = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined);

        await act(async () => { card(first).click(); });
        expect(openInPopup)
            .toHaveBeenCalledWith("openInPopup", { noteIdOrPath: first });

        await act(async () => { press(card(first), "Enter"); });
        expect(openInPopup).toHaveBeenCalledTimes(2);
    });

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

    it("carries its own id and column in the clipboard when a drag starts", async () => {
        const { first } = await renderBoard();
        const clipboard: Record<string, string> = {};
        const dataTransfer = {
            effectAllowed: "",
            setData: (type: string, value: string) => { clipboard[type] = value; }
        };

        await act(async () => { fireDrag(card(first), "dragstart", dataTransfer); });

        expect(JSON.parse(clipboard["trilium/board-card"]))
            .toMatchObject({ noteId: first, fromColumn: "To Do", index: 0 });
        expect(dataTransfer.effectAllowed).toBe("move");

        // Dropping it anywhere clears the drag, which is what un-hides the card.
        await act(async () => { fireDrag(card(first), "dragend", dataTransfer); });
        expect(card(first).className).not.toContain("dragging");
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
    function press(target: HTMLElement, key: string) {
        target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
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
