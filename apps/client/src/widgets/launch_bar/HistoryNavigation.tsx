import { useMemo } from "preact/hooks";

import FNote from "../../entities/fnote";
import contextMenu, { MenuCommandItem } from "../../menus/context_menu";
import { showLauncherContextMenu } from "../../menus/launcher_button_context_menu";
import froca from "../../services/froca";
import link from "../../services/link";
import tree from "../../services/tree";
import { isElectron } from "../../services/utils";
import { LaunchBarActionButton, useLauncherIconAndTitle } from "./launch_bar_widgets";

interface HistoryNavigationProps {
    launcherNote: FNote;
    command: "backInNoteHistory" | "forwardInNoteHistory";
}

const HISTORY_LIMIT = 20;

export default function HistoryNavigationButton({ launcherNote, command }: HistoryNavigationProps) {
    const { icon, title } = useLauncherIconAndTitle(launcherNote);
    const hasApi = useMemo(() => isElectron() && !!window.electronApi, []);

    return (
        <LaunchBarActionButton
            icon={icon}
            text={title}
            triggerCommand={command}
            onContextMenu={async (e) => {
                e.preventDefault();
                const items = hasApi ? await getHistoryItems() : [];
                showLauncherContextMenu<string>(launcherNote, e, {
                    extraItems: items,
                    onCommand: (cmd) => {
                        if (cmd && hasApi) {
                            window.electronApi?.navigation.navigationGoToIndex(parseInt(cmd, 10));
                        }
                    }
                });
            }}
        />
    );
}

async function getHistoryItems(): Promise<MenuCommandItem<string>[]> {
    const api = window.electronApi?.navigation;
    if (!api || api.navigationLength() < 2) return [];

    let items: MenuCommandItem<string>[] = [];

    const history = api.navigationGetAllEntries();
    const activeIndex = api.navigationGetActiveIndex();

    for (const idx in history) {
        const { noteId, notePath } = link.parseNavigationStateFromUrl(history[idx].url);
        if (!noteId || !notePath) continue;

        const title = await tree.getNotePathTitle(notePath);
        const index = parseInt(idx, 10);
        const note = froca.getNoteFromCache(noteId);

        items.push({
            title,
            command: idx,
            checked: index === activeIndex,
            enabled: index !== activeIndex,
            uiIcon: note?.getIcon()
        });
    }

    items.reverse();

    if (items.length > HISTORY_LIMIT) {
        items = items.slice(0, HISTORY_LIMIT);
    }

    return items;
}

export function handleHistoryContextMenu() {
    return async (e: MouseEvent) => {
        e.preventDefault();

        const items = await getHistoryItems();
        if (items.length === 0) return;

        contextMenu.show({
            x: e.pageX,
            y: e.pageY,
            items,
            selectMenuItemHandler: (item: MenuCommandItem<string>) => {
                if (item && item.command) {
                    const idx = parseInt(item.command, 10);
                    window.electronApi?.navigation.navigationGoToIndex(idx);
                }
            }
        });
    };
}
