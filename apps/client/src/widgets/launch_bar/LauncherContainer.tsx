import "./LauncherContainer.css";

import type { ComponentProps, RefObject } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import FNote from "../../entities/fnote";
import { isExperimentalFeatureEnabled } from "../../services/experimental_features";
import froca from "../../services/froca";
import { hasDesktopLaunchBar, isElectron, isMobile, isTablet } from "../../services/utils";
import { useIsTablet } from "../react/hooks/dom";
import { useTriliumEvent } from "../react/hooks/events";
import { useNoteLabelBoolean } from "../react/hooks/note";
import { useTriliumOptionBool } from "../react/hooks/options";
import { useLazyModule, WithLazyModule } from "../react/LazyComponent";
import { onWheelHorizontalScroll } from "../widget_utils";
import BookmarkButtons, { BookmarkFolder, getBookmarkOpenMode } from "./BookmarkButtons";
import CalendarWidget from "./CalendarWidget";
import ColorSchemeSwitcher from "./ColorSchemeSwitcher";
import { CustomNoteLauncher } from "./GenericButtons";
import HistoryNavigationButton from "./HistoryNavigation";
import { LaunchBarActionButton, LaunchBarContext } from "./launch_bar_widgets";
import {
    CommandButton, NoteLauncher, QuickSearchLauncherWidget, ScriptLauncher, TodayLauncher
} from "./LauncherDefinitions";
import type LauncherDropTarget from "./LauncherDropTarget";
import ProtectedSessionStatusWidget from "./ProtectedSessionStatusWidget";
import SidebarChatButton from "./SidebarChatButton";
import SpacerWidget from "./SpacerWidget";
import SyncStatus from "./SyncStatus";

export default function LauncherContainer({ isHorizontalLayout }: { isHorizontalLayout: boolean }) {
    const childNotes = useLauncherChildNotes();
    const containerRef = useLauncherScrollbarCompensation(isHorizontalLayout, childNotes);
    // A swipe across the bottom bar changes tabs where a tab switcher is in it, and on a tablet, which
    // shows a tab bar instead.
    const swipesTabs = isTablet()
        || !!childNotes?.some((note) => note.getLabelValue("builtinWidget") === "mobileTabSwitcher");
    const [ dragEntered, setDragEntered ] = useState(false);

    return (
        <div
            ref={containerRef}
            id="launcher-container"
            style={{
                display: "flex",
                flexGrow: 1,
                flexDirection: isHorizontalLayout ? "row" : "column"
            }}
            onDragEnter={dragEntered ? undefined : () => setDragEntered(true)}
            onWheel={isHorizontalLayout ? (e) => {
                if ((e.target as HTMLElement).closest(".dropdown-menu")) return;
                onWheelHorizontalScroll(e);
            } : undefined}
        >
            <LaunchBarContext.Provider value={{
                isHorizontalLayout
            }}>
                {childNotes?.map(childNote => {
                    if (!hasDesktopLaunchBar() && childNote.isLabelTruthy("desktopOnly")) {
                        return false;
                    }

                    // `LauncherDropTarget` measures each launcher through its slot.
                    return (
                        <div
                            key={childNote.noteId}
                            className="launcher-slot"
                            data-launcher-id={childNote.noteId}
                        >
                            <Launcher note={childNote} isHorizontalLayout={isHorizontalLayout} />
                        </div>
                    );
                })}
            </LaunchBarContext.Provider>
            {isHorizontalLayout && swipesTabs && <LazyTabSwipe containerRef={containerRef} />}
            {dragEntered && (
                <LazyLauncherDropTarget
                    containerRef={containerRef}
                    parentNoteId={getVisibleLaunchersRootId()}
                    isHorizontalLayout={isHorizontalLayout}
                />
            )}
        </div>
    );
}

function Launcher({ note, isHorizontalLayout }: { note: FNote, isHorizontalLayout: boolean }) {
    if (note.type !== "launcher") {
        return <ClonedNoteLauncher note={note} />;
    }

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
            return <LazyCustomWidget launcherNote={note} />;
        case "builtinWidget":
            return initBuiltinWidget(note, isHorizontalLayout);
        default:
            console.warn(`Unrecognized launcher type '${launcherType}' for launcher '${note.noteId}' title '${note.title}'`);
    }
}

/** A note cloned into the launch bar opens itself, or lists its children with `#bookmarkFolder`. */
function ClonedNoteLauncher({ note }: { note: FNote }) {
    const [ isFolder ] = useNoteLabelBoolean(note, "bookmarkFolder");
    const parentNoteId = getVisibleLaunchersRootId();

    if (isFolder) {
        return <BookmarkFolder note={note} parentNoteId={parentNoteId} />;
    }
    return (
        <CustomNoteLauncher
            launcherNote={note}
            getTargetNoteId={() => note.noteId}
            getOpenMode={getBookmarkOpenMode}
            parentNoteId={parentNoteId}
        />
    );
}

function initBuiltinWidget(note: FNote, isHorizontalLayout: boolean) {
    const builtinWidget = note.getLabelValue("builtinWidget");
    switch (builtinWidget) {
        case "calendar":
            return <CalendarWidget launcherNote={note} />;
        case "spacer":
            // || has to be inside since 0 is a valid value
            const baseSize = parseInt(note.getLabelValue("baseSize") || "40");
            const growthFactor = parseInt(note.getLabelValue("growthFactor") || "100");

            return <SpacerWidget launcherNote={note} baseSize={baseSize} growthFactor={growthFactor} />;
        case "bookmarks":
            return <BookmarkButtons launcherNote={note} />;
        case "protectedSession":
            return <ProtectedSessionStatusWidget launcherNote={note} />;
        case "syncStatus":
            return <SyncStatus launcherNote={note} />;
        case "backInHistoryButton":
            return <HistoryNavigationButton launcherNote={note} command="backInNoteHistory" />;
        case "forwardInHistoryButton":
            return <HistoryNavigationButton launcherNote={note} command="forwardInNoteHistory" />;
        case "todayInJournal":
            return <TodayLauncher launcherNote={note} />;
        case "quickSearch":
            return <QuickSearchLauncherWidget launcherNote={note} />;
        case "mobileTabSwitcher":
            return <LazyTabSwitcher launcherNote={note} />;
        case "sidebarChat":
            // The mobile layout has no right pane for the chat to open in.
            return isExperimentalFeatureEnabled("llm") && !isMobile() ? <SidebarChatButton launcherNote={note} /> : undefined;
        case "recordMeeting":
            return isElectron() ? <LazyRecordMeetingButton launcherNote={note} /> : undefined;
        case "colorSchemeSwitcher":
            return <ColorSchemeSwitcher launcherNote={note} />;
        default:
            console.warn(`Unrecognized builtin widget ${builtinWidget} for launcher ${note.noteId} "${note.title}"`);
    }
}

// The mobile tab switcher shows only in the mobile launch bar, and the meeting button only in
// the desktop app, so the other bars never load them. A custom widget loads with the first launcher
// that uses one, and the drop target with the first drag over the bar.
const loadTabSwitcher = () => import("../mobile_widgets/TabSwitcher");
const loadRecordMeetingButton = () => import("./RecordMeetingButton");
const loadCustomWidget = () => import("./CustomWidget");
const loadLauncherDropTarget = () => import("./LauncherDropTarget");

/**
 * The tab switcher, or until its module loads a button that looks like `TabSwitcher`'s, so the bar
 * spreads its launchers once and they do not move when it arrives.
 */
function LazyTabSwitcher({ launcherNote }: { launcherNote: FNote }) {
    const tabSwitcher = useLazyModule(loadTabSwitcher);
    if (!tabSwitcher) {
        return <LaunchBarActionButton launcherNote={launcherNote} className="mobile-tab-switcher" icon="bx bx-rectangle" text="Tabs" />;
    }
    return <tabSwitcher.default launcherNote={launcherNote} />;
}

function LazyTabSwipe({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
    const tabSwitcher = useLazyModule(loadTabSwitcher);
    return tabSwitcher && <tabSwitcher.LaunchBarTabSwipe containerRef={containerRef} />;
}

function LazyCustomWidget({ launcherNote }: { launcherNote: FNote }) {
    const customWidget = useLazyModule(loadCustomWidget);
    return customWidget && <customWidget.default launcherNote={launcherNote} />;
}

function LazyLauncherDropTarget(props: ComponentProps<typeof LauncherDropTarget>) {
    const dropTarget = useLazyModule(loadLauncherDropTarget);
    return dropTarget && <dropTarget.default {...props} />;
}

/**
 * The meeting button, loaded once `transcriptionEnabled` is on, since it is hidden while the switch
 * is off. A recording outlives the switch, so the button also loads while the main process reports
 * one, and stays mounted after the switch turns off, to show its stop button.
 */
function LazyRecordMeetingButton({ launcherNote }: { launcherNote: FNote }) {
    const [ isEnabled ] = useTriliumOptionBool("transcriptionEnabled");
    const [ isRecording, setRecording ] = useState(false);
    const wasShown = useRef(false);
    wasShown.current ||= isEnabled || isRecording;

    useEffect(() => {
        if (wasShown.current) return;
        let cancelled = false;
        void window.electronApi?.transcription.getState().then(({ status }) => {
            if (!cancelled && status !== "idle") setRecording(true);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    return wasShown.current && (
        <WithLazyModule load={loadRecordMeetingButton}>
            {({ default: RecordMeetingButton }) => <RecordMeetingButton launcherNote={launcherNote} />}
        </WithLazyModule>
    );
}

export function useLauncherChildNotes() {
    const [ visibleLaunchersRoot, setVisibleLaunchersRoot ] = useState<FNote | undefined | null>();
    const [ childNotes, setChildNotes ] = useState<FNote[]>();
    // A foldable swaps the desktop's launchers and the mobile ones as it unfolds and folds.
    const tablet = useIsTablet();

    // Load the root note.
    const loadRoot = useCallback(() => {
        froca.getNote(getVisibleLaunchersRootId(), true).then(setVisibleLaunchersRoot);
    }, [ tablet ]);
    useLayoutEffect(loadRoot, [ loadRoot ]);

    // Load the children.
    const refresh = useCallback(() => {
        if (!visibleLaunchersRoot) return;
        visibleLaunchersRoot.getChildNotes().then(setChildNotes);
    }, [ visibleLaunchersRoot, setChildNotes ]);
    useLayoutEffect(refresh, [ visibleLaunchersRoot ]);

    // Swap to fresh FNote refs after a full froca reload (e.g. entering a protected session
    // clears the cache and creates new instances — old refs are orphaned with stale titles,
    // leaving launcher tooltips stuck at "[protected]" when the launchers themselves are
    // protected notes). Re-resolving the root also refreshes the children via the effect above.
    useTriliumEvent("frocaReloaded", loadRoot);

    // React to position changes.
    useTriliumEvent("entitiesReloaded", ({loadResults}) => {
        if (loadResults.getBranchRows().find((branch) => branch.parentNoteId && froca.getNoteFromCache(branch.parentNoteId)?.isLaunchBarConfig())) {
            refresh();
        }
    });

    return childNotes;
}

/** The note whose children are the launchers shown in this layout's launch bar. */
function getVisibleLaunchersRootId() {
    return hasDesktopLaunchBar() ? "_lbVisibleLaunchers" : "_lbMobileVisibleLaunchers";
}

// Measures the scrollbar's actual consumed size (which varies by browser and the OS "show scroll
// bars" setting) and publishes it as `--launcher-scrollbar-size`; LauncherContainer.css reserves that much on
// the opposite edge so the bar never shifts the centred buttons. Recomputed on resize and whenever
// the set of launchers changes; scroll position doesn't affect the measurement.
// Recomputed on resize and whenever the set of launchers changes (which is what makes the rail
// start or stop overflowing); scroll position doesn't affect the measurement.
function useLauncherScrollbarCompensation(isHorizontalLayout: boolean, childNotes: FNote[] | undefined) {
    const ref = useRef<HTMLDivElement>(null);

    const update = useCallback(() => {
        const el = ref.current;
        if (!el) return;

        // `offsetSize - clientSize` is the space taken by the scrollbar (the container has no
        // border); 0 when the bar overlays or the rail doesn't overflow. Unaffected by the padding
        // we set, so this can't feed back on itself.
        const scrollbarSize = isHorizontalLayout
            ? el.offsetHeight - el.clientHeight
            : el.offsetWidth - el.clientWidth;
        const value = `${scrollbarSize}px`;
        if (el.style.getPropertyValue("--launcher-scrollbar-size") !== value) {
            el.style.setProperty("--launcher-scrollbar-size", value);
        }
    }, [ isHorizontalLayout ]);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;

        update();
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
    }, [ update, childNotes ]);

    return ref;
}
