import "./TabSwitcher.css";

import clsx from "clsx";
import { ComponentChild, createPortal, Fragment } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import appContext, { CommandNames } from "../../components/app_context";
import NoteContext from "../../components/note_context";
import FNote from "../../entities/fnote";
import contextMenu from "../../menus/context_menu";
import { getHue, parseColor } from "../../services/css_class_manager";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import type { ViewMode, ViewScope } from "../../services/link";
import { isNarrowLayout } from "../../services/utils";
import { NoteContent } from "../collections/legacy/ListOrGridView";
import { LaunchBarActionButton, LauncherNoteProps } from "../launch_bar/launch_bar_widgets";
import { ICON_MAPPINGS } from "../note_bars/CollectionProperties";
import ActionButton from "../react/ActionButton";
import {
    useActiveNoteContext,
    useNote,
    useNoteColorClass,
    useNoteIcon,
    useNoteLabelBoolean,
    useNoteTitle,
    useTriliumEvents,
    useTriliumOptionBool
} from "../react/hooks";
import Icon from "../react/Icon";
import LinkButton from "../react/LinkButton";
import Modal from "../react/Modal";
import { useNavigatorChildren } from "./MobileNoteNavigator";
import { getLastSegment, getSpotlightedNoteId, getTabNavigation, type TreeStack } from "./tab_navigation";
import { isTabSwipeActive, type SwipeDirection, TabSwipe } from "./tab_swipe";

const VIEW_MODE_ICON_MAPPINGS: Record<Exclude<ViewMode, "default">, string> = {
    source: "bx bx-code",
    "contextual-help": "bx bx-help-circle",
    "note-map": "bx bxs-network-chart",
    attachments: "bx bx-paperclip"
};

/** The most rows a tree card renders, more than its height shows. */
const MAX_TREE_PREVIEW_ROWS = 12;

/** How far a finger travels sideways across the tab switcher button before it is taken for a swipe. */
const SWIPE_START = 10;
/** How long a finger can rest before release and still count as a flick. */
const FLICK_WINDOW = 100;

export default function TabSwitcher({ launcherNote }: LauncherNoteProps) {
    const [ shown, setShown ] = useState(false);
    const mainNoteContexts = useMainNoteContexts();
    const swipe = useTabSwipe(mainNoteContexts.length > 1);

    return (
        <>
            <LaunchBarActionButton
                launcherNote={launcherNote}
                className="mobile-tab-switcher"
                icon="bx bx-rectangle"
                text="Tabs"
                onClick={() => {
                    if (!swipe.takeSwipe()) setShown(true);
                }}
                onPointerDown={swipe.onPointerDown}
                onPointerMove={swipe.onPointerMove}
                onPointerUp={swipe.onPointerEnd}
                onPointerCancel={swipe.onPointerEnd}
                data-tab-count={mainNoteContexts.length > 99 ? "∞" : mainNoteContexts.length}
            />
            {createPortal(<TabBarModal mainNoteContexts={mainNoteContexts} shown={shown} setShown={setShown} />, document.body)}
        </>
    );
}

interface SwipeGesture {
    pointerId: number;
    x: number;
    y: number;
    lastX: number;
    lastTime: number;
    /** How fast, in px/ms, the finger last moved toward the other tab. */
    velocity: number;
    swipe?: TabSwipe;
}

/**
 * Slides to the next or the previous tab as a finger swipes sideways across the tab switcher button,
 * following the finger until it lifts. The click that ends a swipe is not a tap, so `takeSwipe()`
 * tells the button not to open the switcher.
 */
export function useTabSwipe(enabled: boolean) {
    const gestureRef = useRef<SwipeGesture | null>(null);
    const swipedRef = useRef(false);

    return {
        onPointerDown(e: PointerEvent) {
            swipedRef.current = false;
            const canSwipe = enabled && e.isPrimary && !isTabSwipeActive();
            gestureRef.current = canSwipe ? {
                pointerId: e.pointerId,
                x: e.clientX,
                y: e.clientY,
                lastX: e.clientX,
                lastTime: e.timeStamp,
                velocity: 0
            } : null;
        },
        onPointerMove(e: PointerEvent) {
            const gesture = gestureRef.current;
            if (!gesture || gesture.pointerId !== e.pointerId) return;

            const dx = e.clientX - gesture.x;
            if (!gesture.swipe) {
                const dy = e.clientY - gesture.y;
                const direction = getSwipeDirection(dx, dy, glob.isRtl);
                if (!direction) {
                    if (Math.abs(dy) > SWIPE_START) gestureRef.current = null;
                    return;
                }
                gesture.swipe = new TabSwipe(direction);
                swipedRef.current = true;
            }

            const toward = gesture.swipe.slide === "left" ? -1 : 1;
            const elapsed = e.timeStamp - gesture.lastTime;
            if (elapsed > 0) gesture.velocity = toward * (e.clientX - gesture.lastX) / elapsed;
            gesture.lastX = e.clientX;
            gesture.lastTime = e.timeStamp;
            gesture.swipe.move(toward * dx / getSlideWidth());
        },
        onPointerEnd(e: PointerEvent) {
            const gesture = gestureRef.current;
            gestureRef.current = null;
            if (!gesture?.swipe) return;

            const isFlick = e.type === "pointerup" && e.timeStamp - gesture.lastTime <= FLICK_WINDOW;
            gesture.swipe.release(isFlick ? gesture.velocity : 0);
        },
        takeSwipe() {
            const swiped = swipedRef.current;
            swipedRef.current = false;
            return swiped;
        }
    };
}

/** The tab a finger moving by `dx`, `dy` swipes toward, once it has moved far and level enough. */
export function getSwipeDirection(dx: number, dy: number, isRtl: boolean): SwipeDirection | undefined {
    if (Math.abs(dx) < SWIPE_START || Math.abs(dx) < 2 * Math.abs(dy)) return;
    // A swipe toward the start brings in the next tab from the end, as in Safari.
    return (dx < 0) !== isRtl ? "next" : "previous";
}

/** The distance a finger travels for the slide to go all the way to the other tab. */
function getSlideWidth() {
    return document.getElementById("mobile-rest-container")?.offsetWidth || window.innerWidth;
}

function TabBarModal({ mainNoteContexts, shown, setShown }: {
    mainNoteContexts: NoteContext[];
    shown: boolean;
    setShown: (newValue: boolean) => void;
}) {
    const [ fullyShown, setFullyShown ] = useState(false);
    const selectTab = useCallback((noteContextToActivate: NoteContext) => {
        appContext.tabManager.activateNoteContext(noteContextToActivate.ntxId);
        setShown(false);
    }, [ setShown ]);

    return (
        <Modal
            className="tab-bar-modal"
            size="xl"
            title={t("mobile_tab_switcher.title", { count: mainNoteContexts.length})}
            show={shown}
            onShown={() => setFullyShown(true)}
            customTitleBarButtons={[
                {
                    iconClassName: "bx bx-dots-vertical-rounded",
                    title: t("mobile_tab_switcher.more_options"),
                    onClick(e) {
                        contextMenu.show<CommandNames>({
                            x: e.pageX,
                            y: e.pageY,
                            items: [
                                { title: t("tab_row.new_tab"), command: "openNewTab", uiIcon: "bx bx-plus" },
                                { title: t("tab_row.reopen_last_tab"), command: "reopenLastTab", uiIcon: "bx bx-undo", enabled: appContext.tabManager.recentlyClosedTabs.length !== 0 },
                                { kind: "separator" },
                                { title: t("tab_row.close_all_tabs"), command: "closeAllTabs", uiIcon: "bx bx-trash destructive-action-icon" },
                            ],
                            selectMenuItemHandler: ({ command }) => {
                                if (command) {
                                    appContext.triggerCommand(command);
                                }
                            }
                        });
                    },
                }
            ]}
            footer={<>
                <LinkButton
                    text={t("tab_row.new_tab")}
                    onClick={() => {
                        appContext.triggerCommand("openNewTab");
                        setShown(false);
                    }}
                />
            </>}
            scrollable
            onHidden={() => {
                setShown(false);
                setFullyShown(false);
            }}
        >
            <TabBarModelContent mainNoteContexts={mainNoteContexts} selectTab={selectTab} shown={fullyShown} />
        </Modal>
    );
}

function TabBarModelContent({ mainNoteContexts, selectTab, shown }: {
    mainNoteContexts: NoteContext[];
    shown: boolean;
    selectTab: (noteContextToActivate: NoteContext) => void;
}) {
    const activeNoteContext = useActiveNoteContext();
    const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});

    // Scroll to active tab.
    useEffect(() => {
        if (!shown || !activeNoteContext?.ntxId) return;
        const correspondingEl = tabRefs.current[activeNoteContext.ntxId];
        requestAnimationFrame(() => {
            correspondingEl?.scrollIntoView();
        });
    }, [ activeNoteContext, shown ]);

    return (
        <div className="tabs">
            {mainNoteContexts.map((noteContext) => (
                <Tab
                    key={noteContext.ntxId}
                    noteContext={noteContext}
                    activeNtxId={activeNoteContext.ntxId}
                    selectTab={selectTab}
                    containerRef={el => (tabRefs.current[noteContext.ntxId ?? ""] = el)}
                />
            ))}
        </div>
    );
}

export function Tab({ noteContext, containerRef, selectTab, activeNtxId }: {
    containerRef: (el: HTMLDivElement | null) => void;
    noteContext: NoteContext;
    selectTab: (noteContextToActivate: NoteContext) => void;
    activeNtxId: string | null | undefined;
}) {
    const { note } = noteContext;
    const colorClass = note?.getColorClass() || '';
    const workspaceTabBackgroundColorHue = getWorkspaceTabBackgroundColorHue(noteContext);
    const subContexts = noteContext.getSubContexts();
    const navigation = isNarrowLayout() ? getTabNavigation(noteContext.ntxId) : undefined;
    const tree = navigation?.screen === "tree" ? navigation.tree : undefined;

    return (
        <div
            ref={containerRef}
            class={clsx("tab-card", {
                active: noteContext.ntxId === activeNtxId,
                "with-hue": workspaceTabBackgroundColorHue !== undefined,
                "with-split": !tree && subContexts.length > 1
            })}
            onClick={() => selectTab(noteContext)}
            style={{
                "--bg-hue": workspaceTabBackgroundColorHue
            }}
        >
            {tree ? (
                <TreeTabContent noteContext={noteContext} tree={tree} />
            ) : subContexts.map(subContext => (
                <Fragment key={subContext.ntxId}>
                    <TabHeader noteContext={subContext} colorClass={colorClass} />
                    <TabPreviewContent note={subContext.note} viewScope={subContext.viewScope} />
                </Fragment>
            ))}
        </div>
    );
}

/** A tab left on its note tree: the column the tree stands on, with the tab's note highlighted. */
function TreeTabContent({ noteContext, tree }: { noteContext: NoteContext, tree: TreeStack }) {
    const columnPath = tree.stack[tree.stack.length - 1];
    const columnNoteId = getLastSegment(columnPath);
    const columnParentId = tree.stack.length >= 2 ? getLastSegment(tree.stack[tree.stack.length - 2]) : undefined;
    const columnNote = useNote(columnNoteId);
    const icon = useNoteIcon(columnNote);
    const colorClass = useNoteColorClass(columnNote);
    const title = useNoteTitle(columnNoteId, columnParentId);
    const [ hideArchived ] = useTriliumOptionBool("hideArchivedNotes_main");
    const [ isSubtreeHidden ] = useNoteLabelBoolean(columnNote, "subtreeHidden");
    const spotlightedNoteId = getSpotlightedNoteId(columnPath, tree.notePath);
    const rows = useNavigatorChildren(columnNote, hideArchived, true, isSubtreeHidden, spotlightedNoteId).slice(0, MAX_TREE_PREVIEW_ROWS);
    const activeNoteId = tree.notePath ? getLastSegment(tree.notePath) : undefined;
    const isEmpty = isSubtreeHidden ? !spotlightedNoteId : !columnNote?.getChildNoteIds().length;

    return (
        <>
            <header className={colorClass}>
                <Icon icon={icon ?? "bx bx-folder"} />
                <span className="title">{title ?? columnNote?.title}</span>
                <CloseTabButton noteContext={noteContext} />
            </header>
            <div className={clsx("tab-preview type-tree", { "tab-preview-placeholder": isEmpty })}>
                {isEmpty ? <PreviewPlaceholder icon="bx bx-folder-open" /> : rows.map(({ note, branchId }) => (
                    <TreeTabRow
                        key={branchId}
                        note={note}
                        parentNoteId={columnNoteId}
                        isActive={note.noteId === activeNoteId}
                    />
                ))}
            </div>
        </>
    );
}

function TreeTabRow({ note, parentNoteId, isActive }: { note: FNote, parentNoteId: string, isActive: boolean }) {
    const icon = useNoteIcon(note);
    const colorClass = useNoteColorClass(note);
    const title = useNoteTitle(note.noteId, parentNoteId);

    return (
        <div className={clsx("tree-row", colorClass, { active: isActive })}>
            <Icon icon={icon ?? "bx bx-note"} />
            <span className="title">{title ?? note.title}</span>
        </div>
    );
}

function TabHeader({ noteContext, colorClass }: { noteContext: NoteContext, colorClass: string }) {
    const iconClass = useNoteIcon(noteContext.note);
    const [ navigationTitle, setNavigationTitle ] = useState<string | null>(null);

    // Manage the title for read-only notes
    useEffect(() => {
        noteContext?.getNavigationTitle().then(setNavigationTitle);
    }, [noteContext]);

    return (
        <header className={colorClass}>
            {noteContext.note && <Icon icon={iconClass} />}
            <span className="title">{navigationTitle ?? noteContext.note?.title ?? t("tab_row.new_tab")}</span>
            {noteContext.isMainContext() && <CloseTabButton noteContext={noteContext} />}
        </header>
    );
}

function CloseTabButton({ noteContext }: { noteContext: NoteContext }) {
    return (
        <ActionButton
            icon="bx bx-x"
            text={t("tab_row.close_tab")}
            onClick={(e) => {
                // We are closing a tab, so we need to prevent propagation for click (activate tab).
                e.stopPropagation();
                appContext.tabManager.removeNoteContext(noteContext.ntxId);
            }}
        />
    );
}

function TabPreviewContent({ note, viewScope }: {
    note: FNote | null,
    viewScope: ViewScope | undefined
}) {
    let el: ComponentChild;
    let isPlaceholder = true;

    if (!note) {
        el = <PreviewPlaceholder icon="bx bx-plus" />;
    } else if (note.type === "book") {
        el = <PreviewPlaceholder icon={ICON_MAPPINGS[note.getLabelValue("viewType") ?? ""] ?? "bx bx-book"} />;
    } else if (viewScope?.viewMode && viewScope.viewMode !== "default") {
        el = <PreviewPlaceholder icon={VIEW_MODE_ICON_MAPPINGS[viewScope?.viewMode ?? ""] ?? "bx bx-empty"} />;
    } else {
        el = <NoteContent
            note={note}
            highlightedTokens={undefined}
            trim
            includeArchivedNotes={false}
        />;
        isPlaceholder = false;
    }

    return (
        <div className={clsx("tab-preview", `type-${note?.type ?? "empty"}`, { "tab-preview-placeholder": isPlaceholder })}>{el}</div>
    );
}

function PreviewPlaceholder({ icon}: {
    icon: string;
}) {
    return (
        <div className="preview-placeholder">
            <Icon icon={icon} />
        </div>
    );
}

function getWorkspaceTabBackgroundColorHue(noteContext: NoteContext) {
    if (!noteContext.hoistedNoteId) return;
    const hoistedNote = froca.getNoteFromCache(noteContext.hoistedNoteId);
    if (!hoistedNote) return;

    const workspaceTabBackgroundColor = hoistedNote.getWorkspaceTabBackgroundColor();
    if (!workspaceTabBackgroundColor) return;

    try {
        const parsedColor = parseColor(workspaceTabBackgroundColor);
        if (!parsedColor) return;
        return getHue(parsedColor);
    } catch (e) {
        // Colors are non-critical, simply ignore.
        console.warn(e);
    }
}

function useMainNoteContexts() {
    const [ noteContexts, setNoteContexts ] = useState(appContext.tabManager.getMainNoteContexts());

    useTriliumEvents([ "newNoteContextCreated", "noteContextRemoved" ] , () => {
        setNoteContexts(appContext.tabManager.getMainNoteContexts());
    });

    return noteContexts;
}
