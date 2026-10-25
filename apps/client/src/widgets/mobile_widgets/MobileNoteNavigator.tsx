import "./MobileNoteNavigator.css";

import clsx from "clsx";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import type Component from "../../components/component";
import type FNote from "../../entities/fnote";
import contextMenu from "../../menus/context_menu";
import { buildTreeContextMenuItems, handleTreeContextMenuSelect } from "../../menus/tree_context_menu";
import { getReadableTextColor } from "../../services/css_class_manager";
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
import { Badge } from "../react/Badge";
import {
    useActiveNoteContext,
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
import { getLastSegment, getSpotlightedNoteId, getTreeStack, setTabTree } from "./tab_navigation";

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
    const pendingNote = useNote(pendingId);
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

    // Gate the visible body on the content preview being ready to avoid a layout shift
    // when the preview finishes rendering. Tied to the parent's noteId so a stale "ready"
    // flag from the previous column can't leak into the new one.
    const [readyForNoteId, setReadyForNoteId] = useState<string | null>(null);
    const previewReady = !!parentNote && readyForNoteId === parentNote.noteId;
    const bodyVisible = previewReady && isLoaded;
    const onPreviewReady = useCallback(() => {
        if (parentNote) setReadyForNoteId(parentNote.noteId);
    }, [parentNote]);

    // Full-screen spinner only for the very first render — once a body has been shown,
    // subsequent navigations swap views without a global placeholder.
    const hasCommittedOnceRef = useRef(false);
    if (bodyVisible) hasCommittedOnceRef.current = true;
    const showInitialLoader = !bodyVisible && !hasCommittedOnceRef.current;

    // Preload state for the pending stack target. Once ready, commit the stack change.
    const [nextReadyNoteId, setNextReadyNoteId] = useState<string | null>(null);
    const onPendingReady = useCallback(() => {
        if (pendingNote) setNextReadyNoteId(pendingNote.noteId);
    }, [pendingNote]);

    const scrollRef = useRef<HTMLDivElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const directionRef = useRef<"forward" | "backward" | null>(null);
    const [commitCounter, setCommitCounter] = useState(0);

    useEffect(() => {
        if (!nextStack || !pendingId || nextReadyNoteId !== pendingId) return;
        commitStack(nextStack);
        setReadyForNoteId(pendingId);
        setNextStack(null);
        setNextReadyNoteId(null);
        setCommitCounter((c) => c + 1);
        // Reset scroll so the committed tile is visible at the top of the column.
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [nextStack, pendingId, nextReadyNoteId, commitStack]);

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
    const showToolbar = canGoBack || isHoisted;

    const currentContextHandler = useMemo(
        () => buildNoteContextMenu(currentParentPath, parentComponent),
        [currentParentPath, parentComponent]
    );
    const currentContextProps = useLongPressContextMenu(currentContextHandler);

    return (
        <div className="mobile-note-navigator">
            {showToolbar && (
                <div className="mobile-navigator-toolbar">
                    <button
                        type="button"
                        className={clsx("mobile-navigator-back", !canGoBack && "invisible")}
                        onClick={canGoBack && !pendingPop ? goBack : undefined}
                        disabled={!canGoBack || pendingPop}
                        aria-label={t("mobile_note_navigator.back")}
                    >
                        <Icon
                            icon={pendingPop ? "bx bx-loader bx-spin" : "bx bx-chevron-left"}
                            className="mobile-navigator-back-icon"
                        />
                        <span className="mobile-navigator-back-title">
                            {backTargetTitle ?? ""}
                        </span>
                    </button>
                    <HoistedNoteBadge hoistedNoteId={effectiveHoistedId} />
                </div>
            )}

            <div ref={scrollRef} className={clsx("mobile-navigator-scroll", showInitialLoader && "is-pending")}>
                <div ref={bodyRef} className="mobile-navigator-body">
                    {!isHoisted && currentParentId === "root" && <WorkspaceCards />}
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
                                <NoteContent
                                    note={parentNote}
                                    trim
                                    noChildrenList
                                    highlightedTokens={null}
                                    includeArchivedNotes={!hideArchived}
                                    onReady={onPreviewReady}
                                />
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

            {/* Hidden preloader: renders NoteContent for the pending target so we can
                commit the stack change only after its preview is ready. */}
            {pendingNote && (
                <div className="mobile-navigator-preloader" aria-hidden="true">
                    <NoteContent
                        key={pendingNote.noteId}
                        note={pendingNote}
                        trim
                        noChildrenList
                        highlightedTokens={null}
                        includeArchivedNotes={!hideArchived}
                        onReady={onPendingReady}
                    />
                </div>
            )}
        </div>
    );
}

/**
 * Hoisted-note badge (mirrors Breadcrumb.tsx): only shown when hoisted below
 * root; click anywhere on the badge (including the X) to unhoist. Respects
 * workspace icon/color overrides.
 */
function HoistedNoteBadge({ hoistedNoteId }: { hoistedNoteId: string }) {
    const isHoisted = hoistedNoteId !== "root";
    const hoistedNote = useNote(isHoisted ? hoistedNoteId : undefined);
    const hoistedNoteIcon = useNoteIcon(hoistedNote);
    const hoistedTitle = useNoteTitle(isHoisted ? hoistedNoteId : undefined, undefined);
    const [isWorkspace] = useNoteLabelBoolean(hoistedNote, "workspace");
    const [workspaceIconClass] = useNoteLabel(hoistedNote, "workspaceIconClass");
    const [workspaceColor] = useNoteLabel(hoistedNote, "workspaceTabBackgroundColor");

    if (!isHoisted || !hoistedNote) return null;

    return (
        <Badge
            className="mobile-navigator-hoisted-badge"
            icon={isWorkspace ? (workspaceIconClass || hoistedNoteIcon) : "bx bxs-chevrons-up"}
            text={<>
                <span className="mobile-navigator-hoisted-title">{hoistedTitle ?? hoistedNote.title}</span>
                <Icon icon="bx bx-x" className="mobile-navigator-hoisted-close" />
            </>}
            tooltip={t("breadcrumb.hoisted_badge_title")}
            onClick={() => hoisted_note.unhoist()}
            style={workspaceColorStyle(workspaceColor)}
        />
    );
}

/**
 * The workspace notes, as the empty tab lists them, for the root column of a tab that is not
 * hoisted: a heading and a grid of cards, each with the workspace's icon over its title.
 * Tapping one hoists the tab into it.
 */
export function WorkspaceCards() {
    const [ workspaceNotes, setWorkspaceNotes ] = useState<FNote[]>([]);
    const parentComponent = useContext(ParentComponent);

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
                        onClick={() => parentComponent?.triggerCommand("hoistNote", { noteId: workspaceNote.noteId })}
                    />
                ))}
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
        <div
            className={clsx("mobile-navigator-workspace", { "has-color": !!workspaceColor })}
            role="button"
            tabIndex={0}
            onClick={onClick}
        >
            <Icon
                icon={workspaceIconClass || icon}
                className="mobile-navigator-workspace-icon"
                style={workspaceColorStyle(workspaceColor)}
            />
            <span className="mobile-navigator-workspace-title">{title ?? note.title}</span>
        </div>
    );
}

/** Paints an element in the workspace's `#workspaceTabBackgroundColor`, with a text color readable on it. */
function workspaceColorStyle(workspaceColor: string | null | undefined) {
    if (!workspaceColor) return undefined;
    return { "--color": workspaceColor, "color": getReadableTextColor(workspaceColor) } as Record<string, string>;
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
                <Icon icon="bx bx-chevron-right" className="mobile-navigator-row-chevron" />
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
