import { useCallback, useLayoutEffect, useState } from "preact/hooks";
import FNote from "../../entities/fnote";
import froca from "../../services/froca";
import { isDesktop, isMobile } from "../../services/utils";
import CalendarWidget from "./CalendarWidget";
import SpacerWidget from "./SpacerWidget";
import BookmarkButtons from "./BookmarkButtons";
import ProtectedSessionStatusWidget from "./ProtectedSessionStatusWidget";
import SyncStatus from "./SyncStatus";
import HistoryNavigationButton from "./HistoryNavigation";
import { AiChatButton, CommandButton, CustomWidget, NoteLauncher, QuickSearchLauncherWidget, ScriptLauncher, TodayLauncher } from "./LauncherDefinitions";
import { useTriliumEvent } from "../react/hooks";
import { onWheelHorizontalScroll } from "../widget_utils";
import { LaunchBarContext } from "./launch_bar_widgets";

export default function LauncherContainer({ isHorizontalLayout }: { isHorizontalLayout: boolean }) {
    const childNotes = useLauncherChildNotes();

    return (
        <div
            id="launcher-container"
            style={{
                display: "flex",
                flexGrow: 1,
                flexDirection: isHorizontalLayout ? "row" : "column"
            }}
            onWheel={isHorizontalLayout ? (e) => {
                if ((e.target as HTMLElement).closest(".dropdown-menu")) return;
                onWheelHorizontalScroll(e);
            } : undefined}
        >
            <LaunchBarContext.Provider value={{
                isHorizontalLayout
            }}>
                {childNotes?.map(childNote => {
                    if (childNote.type !== "launcher") {
                        throw new Error(`Note '${childNote.noteId}' '${childNote.title}' is not a launcher even though it's in the launcher subtree`);
                    }

                    if (!isDesktop() && childNote.isLabelTruthy("desktopOnly")) {
                        return false;
                    }

                    return <Launcher key={childNote.noteId} note={childNote} isHorizontalLayout={isHorizontalLayout} />
                })}
            </LaunchBarContext.Provider>
        </div>
    )
}

function Launcher({ note, isHorizontalLayout }: { note: FNote, isHorizontalLayout: boolean }) {
    const launcherType = note.getLabelValue("launcherType");
    if (glob.TRILIUM_SAFE_MODE && launcherType === "customWidget") return;

    switch (launcherType) {
        case "command":
            return <CommandButton launcherNote={note} />;
        case "note":
            return <NoteLauncher launcherNote={note} />;
        case "script":
            return <ScriptLauncher launcherNote={note} />;
        case "customWidget":
            return <CustomWidget launcherNote={note} />;
        case "builtinWidget":
            return initBuiltinWidget(note, isHorizontalLayout);
        default:
            throw new Error(`Unrecognized launcher type '${launcherType}' for launcher '${note.noteId}' title '${note.title}'`);
    }
}

function initBuiltinWidget(note: FNote, isHorizontalLayout: boolean) {
    const builtinWidget = note.getLabelValue("builtinWidget");
    switch (builtinWidget) {
        case "calendar":
            return <CalendarWidget launcherNote={note} />
        case "spacer":
            // || has to be inside since 0 is a valid value
            const baseSize = parseInt(note.getLabelValue("baseSize") || "40");
            const growthFactor = parseInt(note.getLabelValue("growthFactor") || "100");

            return <SpacerWidget baseSize={baseSize} growthFactor={growthFactor} />;
        case "bookmarks":
            return <BookmarkButtons />;
        case "protectedSession":
            return <ProtectedSessionStatusWidget />;
        case "syncStatus":
            return <SyncStatus />;
        case "backInHistoryButton":
            return <HistoryNavigationButton launcherNote={note} command="backInNoteHistory" />
        case "forwardInHistoryButton":
            return <HistoryNavigationButton launcherNote={note} command="forwardInNoteHistory" />
        case "todayInJournal":
            return <TodayLauncher launcherNote={note} />
        case "quickSearch":
            return <QuickSearchLauncherWidget />
        case "aiChatLauncher":
            return <AiChatButton launcherNote={note} />
        default:
            throw new Error(`Unrecognized builtin widget ${builtinWidget} for launcher ${note.noteId} "${note.title}"`);
    }
}

function useLauncherChildNotes() {
    const [ visibleLaunchersRoot, setVisibleLaunchersRoot ] = useState<FNote | undefined | null>();
    const [ childNotes, setChildNotes ] = useState<FNote[]>();

    // Load the root note.
    useLayoutEffect(() => {
        const visibleLaunchersRootId = isMobile() ? "_lbMobileVisibleLaunchers" : "_lbVisibleLaunchers";
        froca.getNote(visibleLaunchersRootId, true).then(setVisibleLaunchersRoot);
    }, []);

    // Load the children.
    const refresh = useCallback(() => {
        if (!visibleLaunchersRoot) return;
        visibleLaunchersRoot.getChildNotes().then(setChildNotes);
    }, [ visibleLaunchersRoot, setChildNotes ]);
    useLayoutEffect(refresh, [ visibleLaunchersRoot ]);

    // React to position changes.
    useTriliumEvent("entitiesReloaded", ({loadResults}) => {
        if (loadResults.getBranchRows().find((branch) => branch.parentNoteId && froca.getNoteFromCache(branch.parentNoteId)?.isLaunchBarConfig())) {
            refresh();
        }
    });

    return childNotes;
}
