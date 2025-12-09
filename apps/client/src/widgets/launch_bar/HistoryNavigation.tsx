import type { WebContents } from "electron";
import { useMemo } from "preact/hooks";

import FNote from "../../entities/fnote";
import contextMenu, { MenuCommandItem } from "../../menus/context_menu";
import froca from "../../services/froca";
import link from "../../services/link";
import tree from "../../services/tree";
import { dynamicRequire, isElectron } from "../../services/utils";
import { LaunchBarActionButton, useLauncherIconAndTitle } from "./launch_bar_widgets";

interface HistoryNavigationProps {
    launcherNote: FNote;
    command: "backInNoteHistory" | "forwardInNoteHistory";
}

const HISTORY_LIMIT = 20;

export default function HistoryNavigationButton({ launcherNote, command }: HistoryNavigationProps) {
    const { icon, title } = useLauncherIconAndTitle(launcherNote);
    const webContents = useMemo(() => isElectron() ? dynamicRequire("@electron/remote").getCurrentWebContents() : undefined, []);

    return (
        <LaunchBarActionButton
            icon={icon}
            text={title}
            triggerCommand={command}
            onContextMenu={webContents ? handleHistoryContextMenu(webContents) : undefined}
        />
    );
}

export function handleHistoryContextMenu(webContents: WebContents) {
    return async (e: MouseEvent) => {
        e.preventDefault();

        if (!webContents || webContents.navigationHistory.length() < 2) {
            return;
        }

        let items: MenuCommandItem<string>[] = [];

        const history = webContents.navigationHistory.getAllEntries();
        const activeIndex = webContents.navigationHistory.getActiveIndex();

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

        contextMenu.show({
            x: e.pageX,
            y: e.pageY,
            items,
            selectMenuItemHandler: (item: MenuCommandItem<string>) => {
                if (item && item.command && webContents) {
                    const idx = parseInt(item.command, 10);
                    webContents.navigationHistory.goToIndex(idx);
                }
            }
        });
    };
}
