import type { MindElixirInstance, NodeObj, Topic } from "mind-elixir";

import type { MenuItem } from "../../../menus/context_menu";
import { t } from "../../../services/i18n";

/** What the menu offers to do with the node it was opened on. */
export type MindMapCommand =
    | "addChild" | "addSibling" | "addParent"
    | "moveUp" | "moveDown"
    | "drawArrow" | "drawArrowBidirectional" | "summary"
    | "focus"
    | "remove";

/** An arrow the user has asked for and must now choose the far end of (see MapContextMenu). */
export interface ArrowRequest {
    from: Topic;
    bidirectional: boolean;
}

/**
 * What the menu holds for the node it was opened on, in groups: what is added beside it, where it
 * sits among its siblings, what is drawn from it, what the map is narrowed to, and — last, apart
 * from the rest — what removes it.
 *
 * Everything a root cannot take part in is left out rather than shown greyed, which is what Mind
 * Elixir's own menu did: six of its eleven entries greyed out on the very node a map opens with,
 * leaving a menu that was mostly unavailable on the node most likely to be asked.
 *
 * @param node the node the menu was opened on.
 */
export function buildNodeMenuItems(node: NodeObj): MenuItem<MindMapCommand>[] {
    // Filled in by Mind Elixir as it reads a map; the root is the one node left without one.
    const isRoot = !node.parent;

    const items: (MenuItem<MindMapCommand> | null)[] = [
        { title: t("mind-map.addChild"), command: "addChild", uiIcon: "bx bx-subdirectory-right", shortcut: "Tab" },
        !isRoot ? { title: t("mind-map.addSibling"), command: "addSibling", uiIcon: "bx bx-plus", shortcut: "Enter" } : null,
        !isRoot ? { title: t("mind-map.addParent"), command: "addParent", uiIcon: "bx bx-git-merge", shortcut: "Ctrl+Enter" } : null,

        !isRoot ? { kind: "separator" } : null,
        !isRoot ? { title: t("mind-map.moveUp"), command: "moveUp", uiIcon: "bx bx-chevron-up", shortcut: "PgUp" } : null,
        !isRoot ? { title: t("mind-map.moveDown"), command: "moveDown", uiIcon: "bx bx-chevron-down", shortcut: "PgDn" } : null,

        { kind: "separator" },
        { title: t("mind-map.draw-arrow"), command: "drawArrow", uiIcon: "bx bx-right-arrow-alt" },
        { title: t("mind-map.draw-arrow-bidirectional"), command: "drawArrowBidirectional", uiIcon: "bx bx-transfer-alt" },
        { title: t("mind-map.summary"), command: "summary", uiIcon: "bx bx-bracket" },

        // Narrowing the map to the root is what leaving focus mode does, so the root is not offered
        // it — and leaving is offered by the toolbar rather than here (see MapToolbar).
        !isRoot ? { kind: "separator" } : null,
        !isRoot ? { title: t("mind-map.focus"), command: "focus", uiIcon: "bx bx-crosshair" } : null,

        !isRoot ? { kind: "separator" } : null,
        !isRoot ? { title: t("mind-map.removeNode"), command: "remove", uiIcon: "bx bx-trash", shortcut: "Delete" } : null
    ];

    return items.filter((item) => item !== null);
}

/**
 * Carries out what was chosen, over the selection the map already holds — the node under the
 * pointer having been selected before the menu was asked for.
 *
 * @param mind the instance the menu was opened over.
 * @param command what was chosen; anything unknown is ignored.
 * @param requestArrow asked for the two ends of an arrow, which takes a further click on the map
 *                     and so cannot be finished here (see MapContextMenu).
 */
export function runNodeMenuCommand(
    mind: MindElixirInstance,
    command: MindMapCommand | undefined,
    requestArrow: (request: ArrowRequest) => void
) {
    const node = mind.currentNode;

    switch (command) {
        case "addChild":
            void mind.addChild();
            break;
        case "addSibling":
            void mind.insertSibling("after");
            break;
        case "addParent":
            void mind.insertParent();
            break;
        case "moveUp":
            void mind.moveUpNode();
            break;
        case "moveDown":
            void mind.moveDownNode();
            break;
        case "drawArrow":
        case "drawArrowBidirectional":
            if (node) requestArrow({ from: node, bidirectional: command === "drawArrowBidirectional" });
            break;
        case "summary":
            mind.createSummary();
            // The summary opens for naming the moment it is drawn, and the nodes it was drawn over
            // would otherwise stay selected under it — a Delete meant for the name taking them with it.
            mind.unselectNodes(mind.currentNodes);
            break;
        case "focus":
            if (node) mind.focusNode(node);
            break;
        case "remove":
            void mind.removeNodes(mind.currentNodes);
            break;
    }
}

/**
 * The node an arrow being drawn should end at, for a click landing anywhere within it — its text,
 * one of its icons, or the picture it carries.
 *
 * Mind Elixir's own menu read the element clicked and asked what its parent was, so a click on
 * anything a node holds — every icon we dress a node with among them (see icons.ts) — missed the
 * node and quietly dropped the arrow.
 *
 * @returns the node clicked, or `null` where the click landed beside one.
 */
export function findArrowTarget(target: EventTarget | null): Topic | null {
    if (!(target instanceof Element)) return null;

    const topic = target.closest("me-tpc");
    // A topic carries the node it stands for; anything else wearing the tag is not one to draw to.
    return topic && "nodeObj" in topic ? topic as Topic : null;
}
