import { useCallback, useContext, useEffect, useMemo, useState } from "preact/hooks";

import appContext, { CommandNames } from "../../components/app_context";
import FNote from "../../entities/fnote";
import date_notes from "../../services/date_notes";
import dialog from "../../services/dialog";
import { LauncherWidgetDefinitionWithType } from "../../services/frontend_script_api_preact";
import { t } from "../../services/i18n";
import toast from "../../services/toast";
import { getErrorMessage, isMobile } from "../../services/utils";
import BasicWidget from "../basic_widget";
import NoteContextAwareWidget from "../note_context_aware_widget";
import QuickSearchWidget from "../quick_search";
import { useGlobalShortcut, useLegacyWidget, useNoteLabel, useNoteRelationTarget, useTriliumOptionBool } from "../react/hooks";
import { ParentComponent } from "../react/react_utils";
import { CustomNoteLauncher } from "./GenericButtons";
import { LaunchBarActionButton, LaunchBarContext, LauncherNoteProps, useLauncherIconAndTitle } from "./launch_bar_widgets";

export function CommandButton({ launcherNote }: LauncherNoteProps) {
    const { icon, title } = useLauncherIconAndTitle(launcherNote);
    const [ command ] = useNoteLabel(launcherNote, "command");

    return command && (
        <LaunchBarActionButton
            icon={icon}
            text={title}
            triggerCommand={command as CommandNames}
        />
    );
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
                    dialog.info(t("note_launcher.this_launcher_doesnt_define_target_note"));
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
            icon={icon}
            text={title}
            onClick={launch}
        />
    );
}

export function AiChatButton({ launcherNote }: LauncherNoteProps) {
    const [ aiEnabled ] = useTriliumOptionBool("aiEnabled");
    const { icon, title } = useLauncherIconAndTitle(launcherNote);

    return aiEnabled && (
        <LaunchBarActionButton
            icon={icon}
            text={title}
            triggerCommand="createAiChat"
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

export function QuickSearchLauncherWidget() {
    const { isHorizontalLayout } = useContext(LaunchBarContext);
    const widget = useMemo(() => new QuickSearchWidget(), []);
    const parentComponent = useContext(ParentComponent) as BasicWidget | null;
    const isEnabled = isHorizontalLayout && !isMobile();
    parentComponent?.contentSized();

    return (
        <div>
            {isEnabled && <LegacyWidgetRenderer widget={widget} />}
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
        <div>
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
