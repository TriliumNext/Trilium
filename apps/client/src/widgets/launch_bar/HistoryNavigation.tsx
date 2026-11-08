import { useCallback } from "preact/hooks";

import FNote from "../../entities/fnote";
import contextMenu, { MenuCommandItem } from "../../menus/context_menu";
import { notePathMenuItem } from "../../menus/context_menu_utils";
import { showLauncherContextMenu } from "../../menus/launcher_button_context_menu";
import link from "../../services/link";
import { useHoldContextMenu } from "../react/hooks";
import { LaunchBarActionButton, useLauncherIconAndTitle } from "./launch_bar_widgets";

export type HistoryDirection = "back" | "forward";

interface HistoryNavigationProps {
    launcherNote: FNote;
    command: "backInNoteHistory" | "forwardInNoteHistory";
}

interface HistoryEntry {
    url: string;
    go: () => void;
}

/** The number of notes the menu lists in one direction. */
const HISTORY_LIMIT = 20;
const HOLD_DURATION = 500;

export default function HistoryNavigationButton({ launcherNote, command }: HistoryNavigationProps) {
    const { icon, title } = useLauncherIconAndTitle(launcherNote);
    const direction = command === "backInNoteHistory" ? "back" : "forward";
    const historyMenuProps = useHistoryContextMenu(direction, launcherNote);

    return (
        <LaunchBarActionButton
            icon={icon}
            text={title}
            triggerCommand={command}
            {...historyMenuProps}
        />
    );
}

/**
 * Returns props that open a menu of the notes `direction` leads to, on a right-click or a held
 * press. The menu of a launcher also has the launch bar items.
 */
export function useHistoryContextMenu(direction: HistoryDirection, launcherNote?: FNote) {
    const handler = useCallback((e: MouseEvent) => {
        e.preventDefault();
        void showHistoryContextMenu(e, direction, launcherNote);
    }, [direction, launcherNote]);

    return useHoldContextMenu(handler, HOLD_DURATION);
}

async function showHistoryContextMenu(
    e: MouseEvent,
    direction: HistoryDirection,
    launcherNote?: FNote
) {
    const items = await getHistoryItems(direction);

    if (launcherNote) {
        await showLauncherContextMenu(launcherNote, e, { extraItems: items });
    } else if (items.length > 0) {
        await contextMenu.show({ x: e.pageX, y: e.pageY, items, selectMenuItemHandler: () => {} });
    }
}

export async function getHistoryItems(
    direction: HistoryDirection
): Promise<MenuCommandItem<string>[]> {
    const items: MenuCommandItem<string>[] = [];

    for (const { url, go } of getReachableEntries(direction)) {
        if (items.length >= HISTORY_LIMIT) break;

        const { noteId, notePath } = link.parseNavigationStateFromUrl(url);
        if (!noteId || !notePath) continue;

        items.push(await notePathMenuItem(notePath, go));
    }

    return items;
}

/**
 * Returns the history entries `direction` leads to, nearest first: from `navigationHistory` in the
 * desktop app, and from the Navigation API in a browser.
 */
function getReachableEntries(direction: HistoryDirection): HistoryEntry[] {
    const electronNavigation = window.electronApi?.navigation;
    if (electronNavigation) {
        const entries = electronNavigation.navigationGetAllEntries().map(({ url }, index) => ({
            url,
            go: () => electronNavigation.navigationGoToIndex(index)
        }));
        return sliceInDirection(entries, electronNavigation.navigationGetActiveIndex(), direction);
    }

    const navigation = "navigation" in window ? window.navigation : undefined;
    if (!navigation?.currentEntry) return [];

    const entries = navigation.entries().map((entry) => ({
        url: entry.url ?? "",
        go: () => {
            const { committed, finished } = navigation.traverseTo(entry.key);
            // A traversal that another navigation interrupts rejects both promises.
            void Promise.allSettled([ committed, finished ]);
        }
    }));
    return sliceInDirection(entries, navigation.currentEntry.index, direction);
}

function sliceInDirection<T>(entries: T[], activeIndex: number, direction: HistoryDirection) {
    return direction === "back"
        ? entries.slice(0, activeIndex).reverse()
        : entries.slice(activeIndex + 1);
}
