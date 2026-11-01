import { useCallback } from "preact/hooks";

import appContext, { CommandNames } from "../../components/app_context";
import FNote from "../../entities/fnote";
import { showLauncherContextMenu } from "../../menus/launcher_button_context_menu";
import link_context_menu from "../../menus/link_context_menu";
import { isCtrlKey } from "../../services/utils";
import { useGlobalShortcut, useNoteLabel } from "../react/hooks";
import { LaunchBarActionButton, useLauncherIconAndTitle } from "./launch_bar_widgets";

/** How a click on a launcher button finds the note it opens, and where it opens it. */
interface NoteLaunchOptions {
    launcherNote: FNote;
    getTargetNoteId: (launcherNote: FNote) => string | null | Promise<string | null>;
    getHoistedNoteId?: (launcherNote: FNote) => string | null;
    /** A `#bookmarkOpenMode` value. Without one, a plain click opens the note in the current tab. */
    getOpenMode?: (launcherNote: FNote) => string | null;
}

/** The link menu commands that open a note as each `#bookmarkOpenMode` value says. */
const OPEN_MODE_COMMANDS = new Map<string, CommandNames>([
    [ "newSplit", "openNoteInNewSplit" ],
    [ "newWindow", "openNoteInNewWindow" ],
    [ "quickEdit", "openNoteInPopup" ]
]);

export function CustomNoteLauncher(props: NoteLaunchOptions & {
    keyboardShortcut?: string;
    /** The launch bar section that shows the button. See `ShowLauncherContextMenuOptions`. */
    parentNoteId?: string;
}) {
    const { launcherNote, getTargetNoteId, getHoistedNoteId, parentNoteId } = props;
    const { icon, title } = useLauncherIconAndTitle(launcherNote);

    const launch = useCallback(async (evt: MouseEvent | KeyboardEvent) => {
        await launchCustomNoteLauncher(evt, props);
    }, [ props ]);

    // Keyboard shortcut.
    const [ shortcut ] = useNoteLabel(launcherNote, "keyboardShortcut");
    useGlobalShortcut(shortcut, launch);

    return (
        <LaunchBarActionButton
            icon={icon}
            text={title}
            onClick={launch}
            onAuxClick={launch}
            onContextMenu={async evt => {
                // Must preventDefault synchronously — awaiting getTargetNoteId first would let the
                // native browser context menu open before showLauncherContextMenu gets a chance to.
                evt.preventDefault();
                const targetNoteId = await getTargetNoteId(launcherNote);
                const hoistedNoteId = getHoistedNoteId?.(launcherNote) ?? null;
                const linkItems = targetNoteId ? link_context_menu.getItems(evt) : [];
                await showLauncherContextMenu<CommandNames>(launcherNote, evt, {
                    parentNoteId,
                    extraItems: linkItems,
                    onCommand: (command) => {
                        if (command && targetNoteId) {
                            link_context_menu.handleLinkContextMenuItem(command, evt, targetNoteId, {}, hoistedNoteId);
                        }
                    }
                });
            }}
        />
    );
}

export async function launchCustomNoteLauncher(
    evt: MouseEvent | KeyboardEvent,
    options: NoteLaunchOptions
) {
    const { launcherNote, getTargetNoteId, getHoistedNoteId, getOpenMode } = options;
    if (evt.which === 3) return;

    const targetNoteId = await getTargetNoteId(launcherNote);
    if (!targetNoteId) return;

    const hoistedNoteIdWithDefault = getHoistedNoteId?.(launcherNote) || appContext.tabManager.getActiveContext()?.hoistedNoteId;
    const ctrlKey = isCtrlKey(evt);

    if ((evt.which === 1 && ctrlKey) || evt.which === 2) {
        const activate = !!evt.shiftKey;
        await appContext.tabManager.openInNewTab(
            targetNoteId, hoistedNoteIdWithDefault, activate, "afterCurrent"
        );
    } else {
        await openInMode(
            evt, targetNoteId, hoistedNoteIdWithDefault ?? null, getOpenMode?.(launcherNote)
        );
    }
}

/**
 * Opens `targetNoteId` where `openMode`, a `#bookmarkOpenMode` value, says. A new tab opened this
 * way is activated, unlike one opened with Ctrl or the middle button.
 */
async function openInMode(
    evt: MouseEvent | KeyboardEvent,
    targetNoteId: string,
    hoistedNoteId: string | null,
    openMode: string | null | undefined
) {
    const command = openMode ? OPEN_MODE_COMMANDS.get(openMode) : undefined;

    if (openMode === "newTab") {
        await appContext.tabManager.openInNewTab(targetNoteId, hoistedNoteId, true, "afterCurrent");
    } else if (command) {
        link_context_menu.handleLinkContextMenuItem(command, evt, targetNoteId, {}, hoistedNoteId);
    } else {
        await appContext.tabManager.openInSameTab(targetNoteId, hoistedNoteId);
    }
}
