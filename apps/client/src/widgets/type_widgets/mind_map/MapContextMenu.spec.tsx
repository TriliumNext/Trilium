import i18next from "i18next";
import type { MindElixirInstance, NodeObj, Topic } from "mind-elixir";
import { act } from "preact/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import contextMenu, { type ContextMenuOptions } from "../../../menus/context_menu";
import englishTranslation from "../../../translations/en/translation.json";
import { renderInto } from "../../../test/render";
import type { MindMapCommand } from "./context_menu";
import MapContextMenu from "./MapContextMenu";

vi.mock("../../../menus/context_menu", () => ({ default: { show: vi.fn() } }));

beforeAll(() => i18next.init({ lng: "en", resources: { en: { translation: englishTranslation } } }));
beforeEach(() => vi.mocked(contextMenu.show).mockClear());

const ROOT: NodeObj = { id: "root", topic: "Root" };

/**
 * A stand-in for the Mind Elixir instance exposing only what the menu touches: the map the far end
 * of an arrow is clicked on, the selection, and the drawing of the arrow itself.
 */
function buildMind() {
    const map = document.createElement("div");
    document.body.appendChild(map);

    const listeners = new Set<(e: MouseEvent) => void>();
    const mind = {
        map,
        currentNode: buildTopic("n1"),
        currentNodes: [],
        createArrow: vi.fn(),
        bus: {
            addListener: (_type: string, listener: (e: MouseEvent) => void) => listeners.add(listener),
            removeListener: (_type: string, listener: (e: MouseEvent) => void) => listeners.delete(listener)
        }
    } as unknown as MindElixirInstance;

    /** Right-clicks a node, as the map's own pointer handling reports it. */
    const rightClick = () => act(() => {
        for (const listener of listeners) listener(new MouseEvent("contextmenu"));
    });

    return { mind, map, rightClick };
}

/** A node as the map builds it, laid onto the map so a click on it can be seen. */
function buildTopic(id: string) {
    const topic = document.createElement("me-tpc");
    (topic as unknown as Topic).nodeObj = { id, topic: id, parent: ROOT };
    return topic as unknown as Topic;
}

/** What the last menu shown was told to do when the given entry was chosen. */
function choose(command: MindMapCommand) {
    const options = vi.mocked(contextMenu.show).mock.lastCall?.[0] as ContextMenuOptions<MindMapCommand>;
    act(() => options.selectMenuItemHandler({ title: "", command }, null as never));
}

/** Builds the menu and settles it, so that what it listens to is listened to before it speaks. */
function renderMenu(mind: MindElixirInstance) {
    let container: HTMLElement | undefined;
    act(() => { container = renderInto(<MapContextMenu mind={mind} />); });
    if (!container) throw new Error("the menu was not rendered");
    return container;
}

function hint(container: HTMLElement) {
    return container.querySelector(".mind-map-arrow-hint");
}

describe("MapContextMenu", () => {
    it("opens Trilium's own menu where the map says one was asked for", () => {
        const { mind, rightClick } = buildMind();
        renderMenu(mind);

        rightClick();

        const options = vi.mocked(contextMenu.show).mock.lastCall?.[0];
        expect(options?.items.length).toBeGreaterThan(0);
    });

    it("opens nothing where the right-click landed on no node", () => {
        const { mind, rightClick } = buildMind();
        (mind as { currentNode: Topic | null }).currentNode = null;
        renderMenu(mind);

        rightClick();

        expect(contextMenu.show).not.toHaveBeenCalled();
    });

    it("asks for the far end of an arrow, and draws it to the node clicked next", () => {
        const { mind, map, rightClick } = buildMind();
        const from = mind.currentNode;
        const to = buildTopic("n2");
        map.appendChild(to);
        const container = renderMenu(mind);

        rightClick();
        choose("drawArrowBidirectional");
        expect(hint(container)).not.toBeNull();

        act(() => { to.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

        expect(mind.createArrow).toHaveBeenCalledWith(from, to, { bidirectional: true });
        expect(hint(container)).toBeNull();
    });

    it("draws a one-way arrow without asking for one back", () => {
        const { mind, map, rightClick } = buildMind();
        const to = buildTopic("n2");
        map.appendChild(to);
        renderMenu(mind);

        rightClick();
        choose("drawArrow");
        act(() => { to.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

        expect(mind.createArrow).toHaveBeenCalledWith(mind.currentNode, to, undefined);
    });

    it("gives the arrow up on a click beside a node, and on Escape", () => {
        const { mind, map, rightClick } = buildMind();
        const container = renderMenu(mind);

        rightClick();
        choose("drawArrow");
        act(() => { map.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        expect(mind.createArrow).not.toHaveBeenCalled();
        expect(hint(container)).toBeNull();

        rightClick();
        choose("drawArrow");
        expect(hint(container)).not.toBeNull();
        act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });

        expect(mind.createArrow).not.toHaveBeenCalled();
        expect(hint(container)).toBeNull();
    });

    it("draws no arrow from a node to itself", () => {
        const { mind, map, rightClick } = buildMind();
        const from = mind.currentNode;
        if (from) map.appendChild(from);
        const container = renderMenu(mind);

        rightClick();
        choose("drawArrow");
        act(() => { from?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

        expect(mind.createArrow).not.toHaveBeenCalled();
        // Given up all the same: the click was spent, and a hint left standing would be a lie.
        expect(hint(container)).toBeNull();
    });
});
