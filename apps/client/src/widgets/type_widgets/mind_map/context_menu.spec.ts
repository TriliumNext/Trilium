import i18next from "i18next";
import type { MindElixirInstance, NodeObj, Topic } from "mind-elixir";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { MenuCommandItem } from "../../../menus/context_menu";
import englishTranslation from "../../../translations/en/translation.json";
import { buildNodeMenuItems, findArrowTarget, type MindMapCommand, runNodeMenuCommand } from "./context_menu";

// The entries are named through i18next, which nothing else in the suite sets up.
beforeAll(() => i18next.init({ lng: "en", resources: { en: { translation: englishTranslation } } }));

const ROOT: NodeObj = { id: "root", topic: "Root" };
const CHILD: NodeObj = { id: "n1", topic: "Node", parent: ROOT };

/** The commands the menu offers for a node, in the order it offers them. */
function commandsFor(node: NodeObj) {
    return buildNodeMenuItems(node)
        .filter((item): item is MenuCommandItem<MindMapCommand> => "command" in item)
        .map((item) => item.command);
}

/**
 * A stand-in for the Mind Elixir instance exposing only what the menu touches: the selection, and
 * the calls each entry stands for.
 */
function buildMind(node: Topic | null = { nodeObj: CHILD } as Topic) {
    return {
        currentNode: node,
        currentNodes: node ? [ node ] : [],
        addChild: vi.fn(),
        insertSibling: vi.fn(),
        insertParent: vi.fn(),
        moveUpNode: vi.fn(),
        moveDownNode: vi.fn(),
        createSummary: vi.fn(),
        unselectNodes: vi.fn(),
        focusNode: vi.fn(),
        removeNodes: vi.fn()
    } as unknown as MindElixirInstance;
}

describe("buildNodeMenuItems", () => {
    it("offers everything the map's own menu did, bar what moved to the toolbar", () => {
        expect(commandsFor(CHILD)).toEqual([
            "addChild", "addSibling", "addParent",
            "moveUp", "moveDown",
            "drawArrow", "drawArrowBidirectional", "summary",
            "focus",
            "remove"
        ]);
    });

    it("leaves out what a root cannot take part in, rather than greying it", () => {
        expect(commandsFor(ROOT)).toEqual([ "addChild", "drawArrow", "drawArrowBidirectional", "summary" ]);
        expect(buildNodeMenuItems(ROOT).every((item) => !("enabled" in item && item.enabled === false))).toBe(true);
    });

    it("leaves no rule of separators over an empty group, nor one at either end", () => {
        for (const node of [ ROOT, CHILD ]) {
            const items = buildNodeMenuItems(node);
            const separators = items.map((item) => "kind" in item && item.kind === "separator");

            expect(separators[0]).toBe(false);
            expect(separators[separators.length - 1]).toBe(false);
            expect(separators.some((isSeparator, at) => isSeparator && separators[at + 1])).toBe(false);
        }
    });

    it("names every entry and gives it a mark", () => {
        for (const item of buildNodeMenuItems(CHILD)) {
            if (!("command" in item)) continue;
            expect(item.title).toBeTruthy();
            // A key that was never translated, rather than a name.
            expect(item.title).not.toContain("mind-map.");
            expect(item.uiIcon).toMatch(/^bx /);
        }
    });
});

describe("runNodeMenuCommand", () => {
    const requestArrow = vi.fn();

    it.each([
        [ "addChild", "addChild" ],
        [ "addParent", "insertParent" ],
        [ "moveUp", "moveUpNode" ],
        [ "moveDown", "moveDownNode" ],
        [ "focus", "focusNode" ],
        [ "remove", "removeNodes" ]
    ] as const)("carries out %s", (command, method) => {
        const mind = buildMind();
        runNodeMenuCommand(mind, command, requestArrow);
        expect(mind[method]).toHaveBeenCalled();
    });

    it("adds a sibling after the node rather than before it", () => {
        const mind = buildMind();
        runNodeMenuCommand(mind, "addSibling", requestArrow);
        expect(mind.insertSibling).toHaveBeenCalledWith("after");
    });

    it("lets go of the nodes a summary was drawn over, the summary opening for naming over them", () => {
        const mind = buildMind();
        runNodeMenuCommand(mind, "summary", requestArrow);
        expect(mind.createSummary).toHaveBeenCalled();
        expect(mind.unselectNodes).toHaveBeenCalledWith(mind.currentNodes);
    });

    it("asks for the far end of an arrow rather than drawing one, and says which kind", () => {
        const mind = buildMind();
        const asked = vi.fn();

        runNodeMenuCommand(mind, "drawArrow", asked);
        expect(asked).toHaveBeenCalledWith({ from: mind.currentNode, bidirectional: false });

        runNodeMenuCommand(mind, "drawArrowBidirectional", asked);
        expect(asked).toHaveBeenCalledWith({ from: mind.currentNode, bidirectional: true });
    });

    it("does nothing where there is no node under the menu, or no command", () => {
        const mind = buildMind(null);

        runNodeMenuCommand(mind, "focus", requestArrow);
        runNodeMenuCommand(mind, "drawArrow", requestArrow);
        runNodeMenuCommand(mind, undefined, requestArrow);

        expect(mind.focusNode).not.toHaveBeenCalled();
        expect(requestArrow).not.toHaveBeenCalled();
    });
});

describe("findArrowTarget", () => {
    /** A node as the map builds it: a topic carrying its object, with an icon inside it. */
    function buildTopic() {
        const topic = document.createElement("me-tpc");
        (topic as unknown as Topic).nodeObj = CHILD;
        topic.innerHTML = `<span class="mind-map-lead-icon bx bx-star"></span>Node`;
        return topic;
    }

    it("finds the node a click landed on", () => {
        const topic = buildTopic();
        expect(findArrowTarget(topic)).toBe(topic);
    });

    it("finds it through whatever the node holds, an icon of ours among them", () => {
        const topic = buildTopic();
        expect(findArrowTarget(topic.querySelector(".mind-map-lead-icon"))).toBe(topic);
    });

    it("finds nothing beside a node, or on a topic standing for none", () => {
        expect(findArrowTarget(document.createElement("div"))).toBeNull();
        expect(findArrowTarget(document.createElement("me-tpc"))).toBeNull();
        expect(findArrowTarget(null)).toBeNull();
    });
});
