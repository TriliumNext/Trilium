import "./MobileNoteNavigator.css";

import clsx from "clsx";
import type { ComponentChildren } from "preact";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import type Component from "../../components/component";
import type FNote from "../../entities/fnote";
import contextMenu from "../../menus/context_menu";
import { buildTreeContextMenuItems, handleTreeContextMenuSelect } from "../../menus/tree_context_menu";
import cssClassManager from "../../services/css_class_manager";
import froca from "../../services/froca";
import hoisted_note from "../../services/hoisted_note";
import { t } from "../../services/i18n";
import note_create from "../../services/note_create";
import search from "../../services/search";
import { onSystemBack, type SystemBackHandler } from "../../services/system_back";
import tree from "../../services/tree";
import utils, { isIOS } from "../../services/utils";
import { NoteContent } from "../collections/legacy/ListOrGridView";
import { useShareState } from "../layout/NoteBadges";
import {
    useActiveNoteContext,
    useChildNotes,
    useLongPressContextMenu,
    useNote,
    useNoteColorClass,
    useNoteIcon,
    useNoteLabel,
    useNoteLabelBoolean,
    useNoteTitle,
    useTriliumEvent,
    useTriliumOptionBool
} from "../react/hooks";
import Icon from "../react/Icon";
import NoItems from "../react/NoItems";
import { ParentComponent } from "../react/react_utils";
import { enterHoistedNote, getLastSegment, getSpotlightedNoteId, getTreeStack, leaveHoistedNote, setTabTree } from "./tab_navigation";

/**
 * A touch-native replacement for the Fancytree-based note tree on mobile. Shows one
 * "column" of children at a time (iOS Files / macOS Finder style): the column's
 * current note is rendered at the top with a content preview and opens on tap,
 * while tapping child rows drills deeper without navigating.
 */
export default function MobileNoteNavigator() {
    const { notePath: activeNotePath, hoistedNoteId, noteContext, parentComponent } = useActiveNoteContext();
    const [hideArchived] = useTriliumOptionBool("hideArchivedNotes_main");

    const effectiveHoistedId = hoistedNoteId ?? "root";
    const [stack, setStack] = useState<string[]>([effectiveHoistedId]);
    // When set, a stack we want to navigate to. We render a hidden NoteContent for its
    // target to preload the preview, then commit the stack once the preview is ready.
    // This keeps the previously-committed view visible during drill/back transitions
    // so there's no placeholder flash.
    const [nextStack, setNextStack] = useState<string[] | null>(null);

    // Each tab keeps the column its tree was left on, until the tab opens another note or hoists.
    const tabId = noteContext?.getMainContext().ntxId;
    const treeOwnerRef = useRef({ tabId, notePath: activeNotePath, hoistedNoteId: effectiveHoistedId });
    treeOwnerRef.current = { tabId, notePath: activeNotePath, hoistedNoteId: effectiveHoistedId };
    const commitStack = useCallback((newStack: string[]) => {
        setStack(newStack);
        const { tabId, ...owner } = treeOwnerRef.current;
        if (tabId) setTabTree(tabId, { ...owner, stack: newStack });
    }, []);

    useEffect(() => {
        commitStack(getTreeStack(tabId, activeNotePath, effectiveHoistedId));
        setNextStack(null);
    }, [tabId, activeNotePath, effectiveHoistedId, commitStack]);

    // Rebuild when Froca reports structural changes that could affect the current column.
    // `useNavigatorChildren` is responsible for loading any newly-added child notes asynchronously.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const parentPath = stack[stack.length - 1];
        const parentNoteId = getLastSegment(parentPath);
        if (loadResults.getBranchRows().some((b) => b.parentNoteId === parentNoteId)) {
            setStack((prev) => [...prev]);
        }
    });

    const currentParentPath = stack[stack.length - 1];
    const currentParentId = getLastSegment(currentParentPath);
    const grandparentId = stack.length >= 2 ? getLastSegment(stack[stack.length - 2]) : undefined;
    const parentNote = useNote(currentParentId);
    const parentIcon = useNoteIcon(parentNote);
    const parentColorClass = useNoteColorClass(parentNote);
    const parentTitle = useNoteTitle(currentParentId, grandparentId);
    const [isParentSubtreeHidden] = useNoteLabelBoolean(parentNote, "subtreeHidden");
    const activeNoteId = activeNotePath ? getLastSegment(activeNotePath) : undefined;

    const pendingPath = nextStack?.[nextStack.length - 1];
    const pendingId = pendingPath ? getLastSegment(pendingPath) : undefined;
    const pendingChildId = nextStack && nextStack.length > stack.length ? pendingId : undefined;
    const pendingPop = !!nextStack && nextStack.length < stack.length;

    // Froca's initial `tree` response only returns the top of the tree; deeper levels are
    // normally pulled in by Fancytree's lazy-load. The navigator doesn't use Fancytree,
    // so we pull the subtree ourselves whenever the current parent changes.
    const [loadedParents, setLoadedParents] = useState<Set<string>>(() => new Set());
    useEffect(() => {
        if (!currentParentId || loadedParents.has(currentParentId)) return;
        let cancelled = false;
        froca.loadSubTree(currentParentId).then(() => {
            if (cancelled) return;
            setLoadedParents((prev) => {
                if (prev.has(currentParentId)) return prev;
                const next = new Set(prev);
                next.add(currentParentId);
                return next;
            });
        });
        return () => {
            cancelled = true;
        };
    }, [currentParentId, loadedParents]);

    const isLoaded = !!currentParentId && loadedParents.has(currentParentId);
    const spotlightedNoteId = getSpotlightedNoteId(currentParentPath, activeNotePath);
    const children = useNavigatorChildren(parentNote, hideArchived, isLoaded, isParentSubtreeHidden, spotlightedNoteId);
    const canGoBack = stack.length > 1;
    const backTargetId = canGoBack ? getLastSegment(stack[stack.length - 2]) : undefined;
    const backTargetParentId = stack.length >= 3 ? getLastSegment(stack[stack.length - 3]) : undefined;
    const backTargetTitle = useNoteTitle(backTargetId, backTargetParentId);

    // The columns shown last keep their rendered preview, so going back to one (in another tab,
    // or a step back) shows it laid out at once. The pending column renders its preview hidden,
    // and the stack commits once it is ready.
    const [previewIds, setPreviewIds] = useState<string[]>([]);
    useEffect(() => {
        if (currentParentId) setPreviewIds((prev) => getPreviewNoteIds(prev, currentParentId));
    }, [currentParentId]);
    const [readyPreviewIds, setReadyPreviewIds] = useState<ReadonlySet<string>>(() => new Set());
    const setPreviewReady = useCallback((noteId: string, ready: boolean) => {
        setReadyPreviewIds((prev) => {
            if (prev.has(noteId) === ready) return prev;
            const next = new Set(prev);
            if (ready) next.add(noteId);
            else next.delete(noteId);
            return next;
        });
    }, []);

    // Gate the visible body on the content preview being ready to avoid a layout shift
    // when the preview finishes rendering.
    const previewReady = !!currentParentId && readyPreviewIds.has(currentParentId);
    const bodyVisible = previewReady && isLoaded;

    // Full-screen spinner only for the very first render — once a body has been shown,
    // subsequent navigations swap views without a global placeholder.
    const hasCommittedOnceRef = useRef(false);
    if (bodyVisible) hasCommittedOnceRef.current = true;
    const showInitialLoader = !bodyVisible && !hasCommittedOnceRef.current;

    const scrollRef = useRef<HTMLDivElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const directionRef = useRef<"forward" | "backward" | null>(null);
    const [commitCounter, setCommitCounter] = useState(0);

    useEffect(() => {
        if (!nextStack || !pendingId || !readyPreviewIds.has(pendingId)) return;
        commitStack(nextStack);
        setNextStack(null);
        setCommitCounter((c) => c + 1);
        // Reset scroll so the committed tile is visible at the top of the column.
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [nextStack, pendingId, readyPreviewIds, commitStack]);

    // Brief slide-in on forward / back so the swap feels directional without blocking the user.
    useLayoutEffect(() => {
        if (commitCounter === 0) return;
        const direction = directionRef.current;
        directionRef.current = null;
        if (!direction || !bodyRef.current) return;
        if (document.body.classList.contains("motion-disabled")) return;
        const offset = direction === "forward" ? "60%" : "-60%";
        bodyRef.current.animate(
            [
                { transform: `translateX(${offset})`, opacity: 0.4 },
                { transform: "translateX(0)", opacity: 1 }
            ],
            { duration: 180, easing: "ease-out" }
        );
    }, [commitCounter]);

    const navigateTo = useCallback(
        (newStack: string[]) => {
            if (hasCommittedOnceRef.current) {
                setNextStack(newStack);
            } else {
                commitStack(newStack);
            }
        },
        [commitStack]
    );

    const goBack = useCallback(() => {
        if (stack.length <= 1) return;
        directionRef.current = "backward";
        navigateTo(stack.slice(0, -1));
    }, [stack, navigateTo]);

    const unhoist = useCallback(() => {
        if (tabId) leaveHoistedNote(tabId, activeNotePath, effectiveHoistedId);
        void hoisted_note.unhoist();
    }, [tabId, activeNotePath, effectiveHoistedId]);

    const enterWorkspace = useCallback((noteId: string) => {
        if (tabId) enterHoistedNote(tabId, activeNotePath, noteId);
        void parentComponent?.triggerCommand("hoistNote", { noteId });
    }, [tabId, activeNotePath, parentComponent]);

    // Registered once, so a menu or dialog opened over the tree later answers back first.
    const isTreeShown = useRef(false);
    useTriliumEvent("activeScreenChanged", ({ activeScreen }) => {
        isTreeShown.current = activeScreen === "tree";
    });
    const goBackOnSystemBack = useRef<SystemBackHandler>(() => false);
    goBackOnSystemBack.current = () => {
        if (!canGoBack || pendingPop || (utils.isNarrowLayout() && !isTreeShown.current)) return false;
        goBack();
        return true;
    };
    useEffect(() => onSystemBack(() => goBackOnSystemBack.current()), []);

    const openNotePath = useCallback(
        async (notePath: string) => {
            await noteContext?.setNote(notePath);
            parentComponent?.triggerCommand("setActiveScreen", { screen: "detail" });
        },
        [noteContext, parentComponent]
    );

    const openCurrent = useCallback(() => {
        if (!currentParentPath) return;
        openNotePath(currentParentPath);
    }, [currentParentPath, openNotePath]);

    const drillInto = useCallback(
        (childNotePath: string) => {
            directionRef.current = "forward";
            navigateTo([...stack, childNotePath]);
        },
        [stack, navigateTo]
    );

    const isCurrentActive = !!activeNoteId && activeNoteId === currentParentId;
    const isHoisted = effectiveHoistedId !== "root";
    // In tablet mode the note sits next to the tree, so there is nothing to bring back.
    const [ isPhone, setPhone ] = useState(utils.isNarrowLayout);
    useEffect(() => utils.onNarrowLayoutChange(() => setPhone(utils.isNarrowLayout())), []);
    const canGoForward = isPhone && !!activeNotePath;
    const showToolbar = canGoBack || isHoisted || canGoForward;

    const currentContextHandler = useMemo(
        () => buildNoteContextMenu(currentParentPath, parentComponent),
        [currentParentPath, parentComponent]
    );
    const currentContextProps = useLongPressContextMenu(currentContextHandler);

    return (
        <div className="mobile-note-navigator">
            {showToolbar && (
                <div className="mobile-navigator-toolbar">
                    {canGoBack ? (
                        <button
                            type="button"
                            className="mobile-navigator-toolbar-button mobile-navigator-back"
                            onClick={pendingPop ? undefined : goBack}
                            disabled={pendingPop}
                            aria-label={t("mobile_note_navigator.back")}
                        >
                            <Icon
                                icon={pendingPop ? "bx bx-loader bx-spin" : getChevronIcon("back")}
                                className="mobile-navigator-toolbar-icon"
                            />
                            <span className="mobile-navigator-toolbar-title">
                                {backTargetTitle ?? ""}
                            </span>
                        </button>
                    ) : isHoisted && (
                        <UnhoistButton hoistedNoteId={effectiveHoistedId} onUnhoist={unhoist} />
                    )}
                    {canGoForward && activeNotePath && <ForwardToNoteButton notePath={activeNotePath} />}
                </div>
            )}

            <div ref={scrollRef} className={clsx("mobile-navigator-scroll", showInitialLoader && "is-pending")}>
                <div ref={bodyRef} className="mobile-navigator-body">
                    {!isHoisted && currentParentId === "root" && <WorkspaceCards onEnter={enterWorkspace} />}
                    {!isHoisted && currentParentId === "root" && (
                        <BookmarkList
                            renderRow={({ note, notePath, parentNoteId }) => (
                                <NavigatorRow
                                    key={note.noteId}
                                    note={note}
                                    parentNoteId={parentNoteId}
                                    childNotePath={notePath}
                                    isActive={note.noteId === activeNoteId}
                                    isPending={note.noteId === pendingChildId}
                                    isSpotlighted={false}
                                    hideArchived={hideArchived}
                                    onDrill={drillInto}
                                    onOpen={openNotePath}
                                    parentComponent={parentComponent}
                                />
                            )}
                        />
                    )}
                    {parentNote && (
                        <div className="mobile-navigator-children-label">
                            {t("mobile_note_navigator.current_note")}
                        </div>
                    )}
                    {parentNote && (
                        <div
                            className={clsx("mobile-navigator-current-tile", parentColorClass, {
                                "is-active": isCurrentActive,
                                "is-archived": parentNote.isArchived
                            })}
                            role="button"
                            tabIndex={0}
                            onClick={openCurrent}
                            {...currentContextProps}
                        >
                            <div className="mobile-navigator-current-header">
                                <Icon icon={parentIcon ?? "bx bx-folder"} className="mobile-navigator-current-icon" />
                                <TitleWithIndicators note={parentNote} title={parentTitle ?? parentNote.title} className="mobile-navigator-current-title" />
                                <button
                                    type="button"
                                    className="mobile-navigator-current-action"
                                    aria-label={t("mobile_note_navigator.add_child")}
                                    title={t("mobile_note_navigator.add_child")}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (currentParentPath) note_create.createNote(currentParentPath);
                                    }}
                                >
                                    <Icon icon="bx bx-plus" />
                                </button>
                                <button
                                    type="button"
                                    className="mobile-navigator-current-action"
                                    aria-label={t("mobile_note_navigator.more_actions")}
                                    title={t("mobile_note_navigator.more_actions")}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        currentContextHandler(e as unknown as MouseEvent);
                                    }}
                                >
                                    <Icon icon="bx bx-dots-horizontal-rounded" />
                                </button>
                            </div>
                            <div className="mobile-navigator-current-preview">
                                {getPreviewNotes(getPreviewNoteIds(previewIds, currentParentId, pendingId)).map((note) => (
                                    <PreviewSlot
                                        key={note.noteId}
                                        note={note}
                                        shown={note.noteId === currentParentId}
                                        hideArchived={hideArchived}
                                        onReady={setPreviewReady}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {isLoaded && parentNote && children.length > 0 && (
                        <div className="mobile-navigator-children-label">
                            {isParentSubtreeHidden
                                ? t("mobile_note_navigator.children_hidden")
                                : t("mobile_note_navigator.children_count", { count: children.length })}
                        </div>
                    )}

                    <div className="mobile-navigator-list">
                        {!isLoaded || !parentNote ? null : children.length === 0 ? (
                            <NoItems icon="bx bx-folder-open" text={t("mobile_note_navigator.empty")} />
                        ) : (
                            children.map((child) => (
                                <NavigatorRow
                                    key={child.branchId}
                                    note={child.note}
                                    parentNoteId={currentParentId}
                                    childNotePath={`${currentParentPath}/${child.note.noteId}`}
                                    isActive={child.note.noteId === activeNoteId}
                                    isPending={child.note.noteId === pendingChildId}
                                    isSpotlighted={isParentSubtreeHidden}
                                    hideArchived={hideArchived}
                                    onDrill={drillInto}
                                    onOpen={openNotePath}
                                    parentComponent={parentComponent}
                                />
                            ))
                        )}
                    </div>
                </div>

                {showInitialLoader && (
                    <div className="mobile-navigator-placeholder">
                        <span className="bx bx-loader bx-spin" />
                    </div>
                )}
            </div>
        </div>
    );
}

/** How many columns keep their rendered preview. */
const PREVIEW_CACHE_SIZE = 5;

/**
 * The columns whose preview stays rendered: the current one, the pending one and those shown
 * last, most recent first.
 */
export function getPreviewNoteIds(recentIds: string[], currentId: string | undefined, pendingId?: string) {
    const ids = [ currentId, pendingId, ...recentIds ].filter((id): id is string => !!id);
    return [ ...new Set(ids) ].slice(0, PREVIEW_CACHE_SIZE);
}

/** Notes in a stable order, so a preview keeps its place in the DOM as the recency changes. */
function getPreviewNotes(noteIds: string[]) {
    return [ ...noteIds ].sort()
        .map((noteId) => froca.getNoteFromCache(noteId))
        .filter((note): note is FNote => !!note);
}

export function PreviewSlot({ note, shown, hideArchived, onReady }: {
    note: FNote;
    shown: boolean;
    hideArchived: boolean;
    onReady: (noteId: string, ready: boolean) => void;
}) {
    const { noteId } = note;
    useEffect(() => () => onReady(noteId, false), [ noteId, onReady ]);
    // `NoteContent` renders again only for another note, and froca updates this one in place, so
    // a content change mounts a new one, hidden until it is ready.
    const [ versions, setVersions ] = useState({ shown: 0, latest: 0 });
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (!loadResults.isNoteContentReloaded(noteId)) return;
        onReady(noteId, false);
        setVersions(({ shown, latest }) => ({ shown, latest: latest + 1 }));
    });
    const renderedVersions = versions.shown === versions.latest
        ? [ versions.shown ]
        : [ versions.shown, versions.latest ];

    return (
        <>
            {renderedVersions.map((version) => (
                <div key={version} className="mobile-navigator-preview-slot" hidden={!shown || version !== versions.shown}>
                    <NoteContent
                        note={note}
                        trim
                        noChildrenList
                        highlightedTokens={null}
                        includeArchivedNotes={!hideArchived}
                        onReady={() => {
                            if (version !== versions.latest) return;
                            setVersions((prev) => prev.shown === version ? prev : { shown: version, latest: version });
                            onReady(noteId, true);
                        }}
                    />
                </div>
            ))}
        </>
    );
}

/**
 * The back button at the top of a hoisted tree, where there is no level left to go up to: an exit
 * pointing toward the leading edge, as the back chevron does, then the hoisted note's title.
 * Tapping it unhoists the tab.
 */
export function UnhoistButton({ hoistedNoteId, onUnhoist }: { hoistedNoteId: string, onUnhoist: () => void }) {
    const hoistedNote = useNote(hoistedNoteId);
    const hoistedTitle = useNoteTitle(hoistedNoteId, undefined);
    const [ workspaceColor ] = useNoteLabel(hoistedNote, "workspaceTabBackgroundColor");

    return (
        <button
            type="button"
            className={clsx(
                "mobile-navigator-toolbar-button mobile-navigator-unhoist",
                cssClassManager.createClassForColor(workspaceColor ?? null)
            )}
            onClick={onUnhoist}
            aria-label={t("note_tree.unhoist")}
        >
            <Icon
                icon="bx bx-exit"
                className={clsx("mobile-navigator-unhoist-icon", !glob.isRtl && "bx-flip-horizontal")}
            />
            <span className="mobile-navigator-toolbar-title">
                {hoistedTitle ?? hoistedNote?.title ?? ""}
            </span>
        </button>
    );
}

/**
 * The button at the trailing end of the tree's toolbar that brings back the note at `notePath`,
 * the one the tab shows, wherever the tree has moved: the note's title, then a chevron pointing
 * forward, mirroring the back button.
 */
export function ForwardToNoteButton({ notePath }: { notePath: string }) {
    const parentComponent = useContext(ParentComponent);
    const noteIds = notePath.split("/");
    const note = useNote(noteIds.at(-1));
    const title = useNoteTitle(noteIds.at(-1), noteIds.at(-2));

    return (
        <button
            type="button"
            className="mobile-navigator-toolbar-button mobile-navigator-forward"
            onClick={() => void parentComponent?.triggerCommand("setActiveScreen", { screen: "detail" })}
            aria-label={t("mobile_note_navigator.forward")}
        >
            <span className="mobile-navigator-toolbar-title">{title ?? note?.title ?? ""}</span>
            <Icon icon={getChevronIcon("forward")} className="mobile-navigator-toolbar-icon" />
        </button>
    );
}

/**
 * The workspace notes, as the empty tab lists them, for the root column of a tab that is not
 * hoisted: a heading and a grid of cards, each with the workspace's icon over its title.
 * Tapping one calls `onEnter` with its note ID.
 */
export function WorkspaceCards({ onEnter }: { onEnter: (noteId: string) => void }) {
    const [ workspaceNotes, setWorkspaceNotes ] = useState<FNote[]>([]);

    const refresh = useCallback(() => {
        search.searchForNotes("#workspace #!template").then(setWorkspaceNotes);
    }, []);
    useEffect(refresh, [ refresh ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows().some((attr) => attr.name === "workspace")) refresh();
    });

    if (!workspaceNotes.length) return null;

    return (
        <>
            <div className="mobile-navigator-children-label mobile-navigator-workspaces-label">
                {t("mobile_note_navigator.workspaces")}
            </div>
            <div className="mobile-navigator-workspaces">
                {workspaceNotes.map((workspaceNote) => (
                    <WorkspaceCard
                        key={workspaceNote.noteId}
                        note={workspaceNote}
                        onClick={() => onEnter(workspaceNote.noteId)}
                    />
                ))}
            </div>
        </>
    );
}

interface Bookmark {
    note: FNote;
    /** The note's best path in the tree, not the one through `_lbBookmarks`. */
    notePath: string;
    parentNoteId: string | undefined;
}

/**
 * The bookmarks, as the launch bar's Bookmarks button lists them, for the root column of a tab
 * that is not hoisted: a heading and a list of rows that `renderRow` draws.
 */
export function BookmarkList({ renderRow }: { renderRow: (bookmark: Bookmark) => ComponentChildren }) {
    const bookmarkNotes = useChildNotes("_lbBookmarks");
    const [ bookmarks, setBookmarks ] = useState<Bookmark[]>([]);
    // A bookmarked note moved elsewhere in the tree changes no branch under `_lbBookmarks`.
    const [ treeVersion, setTreeVersion ] = useState(0);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const bookmarkIds = new Set(bookmarkNotes.map((note) => note.noteId));
        if (loadResults.getBranchRows().some((branch) => !!branch.noteId && bookmarkIds.has(branch.noteId))) {
            setTreeVersion((version) => version + 1);
        }
    });

    useEffect(() => {
        let cancelled = false;
        Promise.all(bookmarkNotes.map(async (note) => {
            const notePath = await tree.resolveNotePath(note.noteId);
            return notePath ? { note, notePath, parentNoteId: notePath.split("/").at(-2) } : null;
        })).then((resolved) => {
            if (!cancelled) setBookmarks(resolved.filter((bookmark): bookmark is Bookmark => !!bookmark));
        });
        return () => { cancelled = true; };
    }, [ bookmarkNotes, treeVersion ]);

    if (!bookmarks.length) return null;

    return (
        <>
            <div className="mobile-navigator-children-label mobile-navigator-bookmarks-label">
                {t("mobile_note_navigator.bookmarks")}
            </div>
            <div className="mobile-navigator-list">
                {bookmarks.map(renderRow)}
            </div>
        </>
    );
}

function WorkspaceCard({ note, onClick }: { note: FNote, onClick: () => void }) {
    const icon = useNoteIcon(note);
    const [ workspaceIconClass ] = useNoteLabel(note, "workspaceIconClass");
    const [ workspaceColor ] = useNoteLabel(note, "workspaceTabBackgroundColor");
    const title = useNoteTitle(note.noteId, undefined);

    return (
        <button type="button" className="mobile-navigator-workspace" onClick={onClick}>
            <Icon
                icon={workspaceIconClass || icon}
                className={clsx(
                    "mobile-navigator-workspace-icon",
                    cssClassManager.createClassForColor(workspaceColor ?? null)
                )}
            />
            <span className="mobile-navigator-workspace-title">{title ?? note.title}</span>
        </button>
    );
}

interface NavigatorRowProps {
    note: FNote;
    parentNoteId: string | undefined;
    childNotePath: string;
    isActive: boolean;
    isPending: boolean;
    isSpotlighted: boolean;
    hideArchived: boolean;
    onDrill: (notePath: string) => void;
    onOpen: (notePath: string) => void;
    parentComponent: Component | null;
}

function NavigatorRow({ note, parentNoteId, childNotePath, isActive, isPending, isSpotlighted, hideArchived, onDrill, onOpen, parentComponent }: NavigatorRowProps) {
    const icon = useNoteIcon(note);
    const [isSubtreeHidden] = useNoteLabelBoolean(note, "subtreeHidden");
    const rawChildCount = note.getChildNoteIds().length;
    // Notes marked with `#subtreeHidden` hide their children from the tree, so
    // the navigator treats them as leaves (open-on-tap) and shows a badge with
    // the hidden count instead of the drill-in chevron.
    const hasChildren = note.hasChildren() && !isSubtreeHidden;
    const showHiddenBadge = isSubtreeHidden && rawChildCount > 0;
    const colorClass = useNoteColorClass(note);
    const title = useNoteTitle(note.noteId, parentNoteId) ?? note.title;
    const contextHandler = useMemo(
        () => buildNoteContextMenu(childNotePath, parentComponent),
        [childNotePath, parentComponent]
    );
    const contextProps = useLongPressContextMenu(contextHandler);

    return (
        <div
            className={clsx("mobile-navigator-row", colorClass, {
                "is-active": isActive,
                "is-archived": note.isArchived,
                "is-pending": isPending,
                "is-spotlighted": isSpotlighted,
                "has-children": hasChildren
            })}
            role="button"
            tabIndex={0}
            onClick={isPending ? undefined : () => (hasChildren ? onDrill(childNotePath) : onOpen(childNotePath))}
            {...contextProps}
        >
            <Icon icon={icon ?? "bx bx-note"} className="mobile-navigator-row-icon" />
            <TitleWithIndicators note={note} title={title} className="mobile-navigator-row-title" />
            {showHiddenBadge && (
                <span
                    className="mobile-navigator-row-hidden-badge"
                    title={t("note_tree.subtree-hidden-tooltip", { count: rawChildCount })}
                >
                    {rawChildCount}
                </span>
            )}
            {hasChildren && isIOS() && (
                <span className="mobile-navigator-row-count">{getListedChildCount(note, hideArchived)}</span>
            )}
            {isPending ? (
                <Icon icon="bx bx-loader bx-spin" className="mobile-navigator-row-chevron" />
            ) : hasChildren ? (
                <Icon icon={getChevronIcon("forward")} className="mobile-navigator-row-chevron" />
            ) : null}
        </div>
    );
}

/**
 * A note's title followed by the clone and share icons the desktop tree shows. The title
 * shortens with an ellipsis, so the icons stay visible next to it.
 */
export function TitleWithIndicators({ note, title, className }: { note: FNote, title: string, className: string }) {
    const [ isShared ] = useShareState(note);
    const realParents = useRealParentNotes(note);

    return (
        <span className="mobile-navigator-title-group">
            <span className={className}>{title}</span>
            {realParents.length > 1 && (
                <Icon
                    icon="bx bxs-directions"
                    className="mobile-navigator-indicator clone-indicator"
                    role="img"
                    aria-label={tree.getCloneIndicatorTooltip(realParents)}
                />
            )}
            {isShared && (
                <Icon
                    icon="bx bx-share-alt"
                    className="mobile-navigator-indicator shared-indicator"
                    role="img"
                    aria-label={t("note_tree.shared-indicator-tooltip")}
                />
            )}
        </span>
    );
}

/** The real parents of `note`, read again when one of its branches changes. */
function useRealParentNotes(note: FNote) {
    const [ realParents, setRealParents ] = useState(() => note.getRealParentNotes());
    useEffect(() => setRealParents(note.getRealParentNotes()), [ note ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getBranchRows().some((b) => b.noteId === note.noteId)) {
            setRealParents(note.getRealParentNotes());
        }
    });
    return realParents;
}

/**
 * Counts the children that `useNavigatorChildren()` lists for `note`. A child that is not in
 * froca yet counts as listed, since its archived state is unknown until it loads.
 */
export function getListedChildCount(note: FNote, hideArchived: boolean) {
    let count = 0;
    for (const childNoteId of note.getChildNoteIds()) {
        if (childNoteId === "_hidden") continue;
        if (hideArchived && froca.getNoteFromCache(childNoteId)?.isArchived) continue;
        count++;
    }
    return count;
}

interface NavigatorChild {
    note: FNote;
    branchId: string;
}

export function useNavigatorChildren(
    parentNote: FNote | null | undefined,
    hideArchived: boolean,
    isLoaded: boolean,
    isParentSubtreeHidden: boolean,
    spotlightedNoteId: string | undefined
): NavigatorChild[] {
    const [children, setChildren] = useState<NavigatorChild[]>([]);
    // Re-run when the parent's child list mutates in place (e.g., a new branch is added by
    // froca_updater). The join captures the current ordered noteIds so a real change in the
    // children set produces a new dep value.
    const childrenKey = parentNote?.children?.join(",");

    useEffect(() => {
        if (!parentNote || !isLoaded || (isParentSubtreeHidden && !spotlightedNoteId)) {
            setChildren([]);
            return;
        }
        let cancelled = false;
        // A parent with `#subtreeHidden` lists only the child on the active note's path.
        const branches = parentNote.getChildBranches()
            .filter((b): b is NonNullable<typeof b> => !!b)
            .filter((b) => !isParentSubtreeHidden || b.noteId === spotlightedNoteId);
        // Use the async loader so notes that aren't yet in cache (e.g., freshly created via "+")
        // are pulled in. `processNoteChange` only updates notes already in froca, so without this
        // newly-created child notes would be silently skipped.
        froca.getNotes(branches.map((b) => b.noteId), true).then((notes) => {
            if (cancelled) return;
            const noteMap = new Map(notes.map((n) => [n.noteId, n]));
            const result: NavigatorChild[] = [];
            for (const branch of branches) {
                const note = noteMap.get(branch.noteId);
                if (!note) continue;
                if (note.noteId === "_hidden") continue;
                if (hideArchived && note.isArchived) continue;
                result.push({ note, branchId: branch.branchId });
            }
            setChildren(result);
        });
        return () => { cancelled = true; };
    }, [parentNote, childrenKey, hideArchived, isLoaded, isParentSubtreeHidden, spotlightedNoteId]);

    return children;
}

/**
 * Builds the same rich tree context menu as Fancytree's `TreeContextMenu`, but
 * sourced from a note path so it can be used from the mobile navigator. The
 * heavy lifting (item construction, command dispatch) lives in
 * `tree_context_menu.ts`; this function just resolves `notePath` into the shared
 * `TreeContextMenuContext` and wires up the `contextMenu.show(...)` boilerplate.
 */
function buildNoteContextMenu(notePath: string, parentComponent: Component | null) {
    return async (e: MouseEvent) => {
        e.preventDefault();

        if (!parentComponent) return;

        const segments = notePath.split("/");
        const noteId = segments[segments.length - 1];
        if (!noteId) return;
        // If the path has no parent segment (top of a hoisted column), fall back to one of
        // the note's actual parents so the menu still works for hoisted roots. Root itself
        // resolves through the special "none_root" branch and needs no parent.
        const parentNoteId = segments.length >= 2
            ? segments[segments.length - 2]
            : froca.getNoteFromCache(noteId)?.getParentNoteIds()[0];
        if (noteId !== "root" && !parentNoteId) return;

        const branchId = await froca.getBranchId(parentNoteId ?? "", noteId);
        if (!branchId) return;
        const branch = froca.getBranch(branchId);
        if (!branch) return;

        const note = await branch.getNote();
        if (!note) return;

        const ctx = {
            note,
            branch,
            notePath,
            component: parentComponent,
            target: "mobile" as const,
            onRevealNote: () => {
                if (utils.isMobile()) {
                    parentComponent.triggerCommand("setActiveScreen", { screen: "detail" });
                }
            }
        };

        await contextMenu.show({
            x: e.pageX,
            y: e.pageY,
            items: await buildTreeContextMenuItems(ctx),
            selectMenuItemHandler: (item) => handleTreeContextMenuSelect(item, ctx)
        });
    };
}

/**
 * The chevron pointing `back` toward the leading edge of the reading direction, or `forward`
 * toward the trailing one.
 */
export function getChevronIcon(direction: "back" | "forward") {
    const pointsLeft = (direction === "back") !== !!glob.isRtl;
    return pointsLeft ? "bx bx-chevron-left" : "bx bx-chevron-right";
}
