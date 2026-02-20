import { useCallback } from "preact/hooks";

import appContext from "../../components/app_context";
import FNote from "../../entities/fnote";
import link_context_menu from "../../menus/link_context_menu";
import { isCtrlKey } from "../../services/utils";
import { useGlobalShortcut, useNoteLabel } from "../react/hooks";
import { LaunchBarActionButton, useLauncherIconAndTitle } from "./launch_bar_widgets";

export function CustomNoteLauncher(props: {
    launcherNote: FNote;
    getTargetNoteId: (launcherNote: FNote) => string | null | Promise<string | null>;
    getHoistedNoteId?: (launcherNote: FNote) => string | null;
    keyboardShortcut?: string;
}) {
    const { launcherNote, getTargetNoteId } = props;
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
                evt.preventDefault();
                const targetNoteId = await getTargetNoteId(launcherNote);
                if (targetNoteId) {
                    link_context_menu.openContextMenu(targetNoteId, evt);
                }
            }}
        />
    );
}

export async function launchCustomNoteLauncher(evt: MouseEvent | KeyboardEvent, { launcherNote, getTargetNoteId, getHoistedNoteId }: {
    launcherNote: FNote;
    getTargetNoteId: (launcherNote: FNote) => string | null | Promise<string | null>;
    getHoistedNoteId?: (launcherNote: FNote) => string | null;
}) {
    if (evt.which === 3) return;

    const targetNoteId = await getTargetNoteId(launcherNote);
    if (!targetNoteId) return;

    const hoistedNoteIdWithDefault = getHoistedNoteId?.(launcherNote) || appContext.tabManager.getActiveContext()?.hoistedNoteId;
    const ctrlKey = isCtrlKey(evt);

    if ((evt.which === 1 && ctrlKey) || evt.which === 2) {
        const activate = !!evt.shiftKey;
        await appContext.tabManager.openInNewTab(targetNoteId, hoistedNoteIdWithDefault, activate);
    } else {
        await appContext.tabManager.openInSameTab(targetNoteId, hoistedNoteIdWithDefault);
    }
}
