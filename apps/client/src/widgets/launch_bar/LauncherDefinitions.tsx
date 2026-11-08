import { useCallback, useContext, useEffect, useState } from "preact/hooks";

import appContext, { CommandNames } from "../../components/app_context";
import FNote from "../../entities/fnote";
import type { MenuItem } from "../../menus/context_menu";
import { showLauncherContextMenu } from "../../menus/launcher_button_context_menu";
import { getRecentlyChangedNotesMenuItems } from "../../menus/recent_changes_menu_items";
import date_notes from "../../services/date_notes";
import { LauncherWidgetDefinitionWithType } from "../../services/frontend_script_api_preact";
import { t } from "../../services/i18n";
import toast from "../../services/toast";
import { getErrorMessage, isMobile } from "../../services/utils";
import BasicWidget from "../basic_widget";
import NoteContextAwareWidget from "../note_context_aware_widget";
import QuickSearch from "../quick_search";
import {
    useGlobalShortcut, useHoldContextMenu, useLegacyWidget, useNoteLabel, useNoteRelationTarget
} from "../react/hooks";
import { ParentComponent } from "../react/react_utils";
import { CustomNoteLauncher } from "./GenericButtons";
import { LaunchBarActionButton, LaunchBarContext, launcherContextMenuHandler, LauncherNoteProps, useLauncherIconAndTitle } from "./launch_bar_widgets";

export function CommandButton({ launcherNote }: LauncherNoteProps) {
    const { icon, title } = useLauncherIconAndTitle(launcherNote);
    const [ command ] = useNoteLabel(launcherNote, "command");
    const contextMenuProps = useCommandLauncherContextMenu(command, launcherNote);

    return command && (
        <LaunchBarActionButton
            launcherNote={launcherNote}
            icon={icon}
            text={title}
            triggerCommand={command as CommandNames}
            {...contextMenuProps}
        />
    );
}

/** The menu sections that command launchers list above "Remove from launch bar". */
const COMMAND_MENU_ITEMS: Partial<Record<string, () => Promise<MenuItem<CommandNames>[]>>> = {
    showRecentChanges: getRecentlyChangedNotesMenuItems
};

/**
 * Returns props that open the launcher menu with the section of `command` from
 * {@link COMMAND_MENU_ITEMS}, on a right-click or a held press. Returns nothing for a command
 * without a section.
 */
export function useCommandLauncherContextMenu(
    command: string | null | undefined,
    launcherNote: FNote
) {
    const getMenuItems = command ? COMMAND_MENU_ITEMS[command] : undefined;
    const handler = useCallback((e: MouseEvent) => {
        e.preventDefault();
        void getMenuItems?.().then((extraItems) => {
            void showLauncherContextMenu(launcherNote, e, { extraItems });
        });
    }, [ getMenuItems, launcherNote ]);
    const holdProps = useHoldContextMenu(handler);

    return getMenuItems ? holdProps : undefined;
}

// we're intentionally displaying the launcher title and icon instead of the target,
// e.g. you want to make launchers to 2 mermaid diagrams which both have mermaid icon (ok),
// but on the launchpad you want them distinguishable.
// for titles, the note titles may follow a different scheme than maybe desirable on the launchpad
// another reason is the discrepancy between what user sees on the launchpad and in the config (esp. icons).
// The only downside is more work in setting up the typical case
// where you actually want to have both title and icon in sync, but for those cases there are bookmarks
export function NoteLauncher({ launcherNote, ...restProps }: { launcherNote: FNote, hoistedNoteId?: string }) {
    return (
        <CustomNoteLauncher
            launcherNote={launcherNote}
            getTargetNoteId={(launcherNote) => {
                const targetNoteId = launcherNote.getRelationValue("target");
                if (!targetNoteId) {
                    toast.showError(t("note_launcher.this_launcher_doesnt_define_target_note"));
                    return null;
                }
                return targetNoteId;
            }}
            getHoistedNoteId={launcherNote => launcherNote.getRelationValue("hoistedNote")}
            {...restProps}
        />
    );
}

export function ScriptLauncher({ launcherNote }: LauncherNoteProps) {
    const { icon, title } = useLauncherIconAndTitle(launcherNote);

    const launch = useCallback(async () => {
        if (launcherNote.isLabelTruthy("scriptInLauncherContent")) {
            await launcherNote.executeScript();
        } else {
            const script = await launcherNote.getRelationTarget("script");
            if (script) {
                await script.executeScript();
            }
        }
    }, [ launcherNote ]);

    // Keyboard shortcut.
    const [ shortcut ] = useNoteLabel(launcherNote, "keyboardShortcut");
    useGlobalShortcut(shortcut, launch);

    return (
        <LaunchBarActionButton
            launcherNote={launcherNote}
            icon={icon}
            text={title}
            onClick={launch}
        />
    );
}

export function TodayLauncher({ launcherNote }: LauncherNoteProps) {
    return (
        <CustomNoteLauncher
            launcherNote={launcherNote}
            getTargetNoteId={async () => {
                const todayNote = await date_notes.getTodayNote();
                return todayNote?.noteId ?? null;
            }}
        />
    );
}

export function QuickSearchLauncherWidget({ launcherNote }: LauncherNoteProps) {
    const { isHorizontalLayout } = useContext(LaunchBarContext);
    const parentComponent = useContext(ParentComponent) as BasicWidget | null;
    const isEnabled = isHorizontalLayout && !isMobile();
    parentComponent?.contentSized();

    return (
        <div onContextMenu={launcherContextMenuHandler(launcherNote)}>
            {isEnabled && <QuickSearch />}
        </div>
    );
}

export function CustomWidget({ launcherNote }: LauncherNoteProps) {
    const [ widgetNote ] = useNoteRelationTarget(launcherNote, "widget");
    const [ widget, setWidget ] = useState<BasicWidget | NoteContextAwareWidget | LauncherWidgetDefinitionWithType>();

    const parentComponent = useContext(ParentComponent) as BasicWidget | null;
    parentComponent?.contentSized();

    useEffect(() => {
        (async function() {
            let widget: BasicWidget;
            try {
                widget = await widgetNote?.executeScript();
            } catch (e) {
                toast.showError(t("toast.bundle-error.message", {
                    id: widgetNote?.noteId,
                    title: widgetNote?.title,
                    message: getErrorMessage(e)
                }));
                return;
            }

            if (widgetNote && widget instanceof BasicWidget) {
                widget._noteId = widgetNote.noteId;
            }
            setWidget(widget);
        })();
    }, [ widgetNote ]);

    return (
        <div onContextMenu={launcherContextMenuHandler(launcherNote)}>
            {widget && (
                ("type" in widget && widget.type === "preact-launcher-widget")
                    ? <ReactWidgetRenderer widget={widget as LauncherWidgetDefinitionWithType} />
                    : <LegacyWidgetRenderer widget={widget as BasicWidget} />
            )}
        </div>
    );
}

export function LegacyWidgetRenderer({ widget }: { widget: BasicWidget }) {
    const [ widgetEl ] = useLegacyWidget(() => widget, {
        noteContext: appContext.tabManager.getActiveContext() ?? undefined
    });

    return widgetEl;
}

function ReactWidgetRenderer({ widget }: { widget: LauncherWidgetDefinitionWithType }) {
    const El = widget.render;
    return <El />;
}
