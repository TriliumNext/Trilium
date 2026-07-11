import "./MobileNoteNavigator.css";

import clsx from "clsx";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import type Component from "../../components/component";
import type FNote from "../../entities/fnote";
import contextMenu from "../../menus/context_menu";
import { buildTreeContextMenuItems, handleTreeContextMenuSelect } from "../../menus/tree_context_menu";
import { getReadableTextColor } from "../../services/css_class_manager";
import froca from "../../services/froca";
import hoisted_note from "../../services/hoisted_note";
import { t } from "../../services/i18n";
import note_create from "../../services/note_create";
import utils from "../../services/utils";
import { NoteContent } from "../collections/legacy/ListOrGridView";
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
    const manualStackRef = useRef(false);

    // Hoisting always reframes the navigator around the hoisted note, so drop
    // any manual drill position when it changes.
    useEffect(() => {
        manualStackRef.current = false;
    }, [effectiveHoistedId]);

    // Sync stack with the active note path unless the user has manually drilled.
    useEffect(() => {
        if (manualStackRef.current) return;
        const newStack = buildStackForActiveNote(activeNotePath, effectiveHoistedId);
        setStack(newStack);
        setNextStack(null);
    }, [activeNotePath, effectiveHoistedId]);

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
    const children = useNavigatorChildren(parentNote, hideArchived, isLoaded, isParentSubtreeHidden);
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
        setStack(nextStack);
        setReadyForNoteId(pendingId);
        setNextStack(null);
        setNextReadyNoteId(null);
        setCommitCounter((c) => c + 1);
        // Reset scroll so the committed tile is visible at the top of the column.
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [nextStack, pendingId, nextReadyNoteId]);

    // Brief slide-in on forward / back so the swap feels directional without blocking the user.
    useLayoutEffect(() => {
        if (commitCounter === 0) return;
        const direction = directionRef.current;
        directionRef.current = null;
        if (!direction || !bodyRef.current) return;
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
                setStack(newStack);
            }
        },
        []
    );

    const goBack = useCallback(() => {
        if (stack.length <= 1) return;
        manualStackRef.current = true;
        directionRef.current = "backward";
        navigateTo(stack.slice(0, -1));
    }, [stack, navigateTo]);

    const openNotePath = useCallback(
        async (notePath: string) => {
            await noteContext?.setNote(notePath);
            manualStackRef.current = false;
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
            manualStackRef.current = true;
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
                                <span className="mobile-navigator-current-title">{parentTitle ?? parentNote.title}</span>
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
                            {t("mobile_note_navigator.children_count", { count: children.length })}
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
            style={workspaceColor ? {
                "--color": workspaceColor,
                "color": getReadableTextColor(workspaceColor)
            } as Record<string, string> : undefined}
        />
    );
}

interface NavigatorRowProps {
    note: FNote;
    parentNoteId: string | undefined;
    childNotePath: string;
    isActive: boolean;
    isPending: boolean;
    onDrill: (notePath: string) => void;
    onOpen: (notePath: string) => void;
    parentComponent: Component | null;
}

function NavigatorRow({ note, parentNoteId, childNotePath, isActive, isPending, onDrill, onOpen, parentComponent }: NavigatorRowProps) {
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
                "has-children": hasChildren
            })}
            role="button"
            tabIndex={0}
            onClick={isPending ? undefined : () => (hasChildren ? onDrill(childNotePath) : onOpen(childNotePath))}
            {...contextProps}
        >
            <Icon icon={icon ?? "bx bx-note"} className="mobile-navigator-row-icon" />
            <span className="mobile-navigator-row-title">{title}</span>
            {showHiddenBadge && (
                <span
                    className="mobile-navigator-row-hidden-badge"
                    title={t("note_tree.subtree-hidden-tooltip", { count: rawChildCount })}
                >
                    {rawChildCount}
                </span>
            )}
            {isPending ? (
                <Icon icon="bx bx-loader bx-spin" className="mobile-navigator-row-chevron" />
            ) : hasChildren ? (
                <Icon icon="bx bx-chevron-right" className="mobile-navigator-row-chevron" />
            ) : null}
        </div>
    );
}

interface NavigatorChild {
    note: FNote;
    branchId: string;
}

function useNavigatorChildren(
    parentNote: FNote | null | undefined,
    hideArchived: boolean,
    isLoaded: boolean,
    isParentSubtreeHidden: boolean
): NavigatorChild[] {
    const [children, setChildren] = useState<NavigatorChild[]>([]);
    // Re-run when the parent's child list mutates in place (e.g., a new branch is added by
    // froca_updater). The join captures the current ordered noteIds so a real change in the
    // children set produces a new dep value.
    const childrenKey = parentNote?.children?.join(",");

    useEffect(() => {
        if (!parentNote || !isLoaded || isParentSubtreeHidden) {
            setChildren([]);
            return;
        }
        let cancelled = false;
        const branches = parentNote.getChildBranches().filter((b): b is NonNullable<typeof b> => !!b);
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
    }, [parentNote, childrenKey, hideArchived, isLoaded, isParentSubtreeHidden]);

    return children;
}

function getLastSegment(notePath: string): string {
    const idx = notePath.lastIndexOf("/");
    return idx >= 0 ? notePath.slice(idx + 1) : notePath;
}

function buildStackForActiveNote(activeNotePath: string | null | undefined, hoistedId: string): string[] {
    if (!activeNotePath) return [hoistedId];

    const segments = activeNotePath.split("/");
    const activeNoteId = segments[segments.length - 1];
    const activeNote = froca.getNoteFromCache(activeNoteId);

    // If the active note is a folder, show its own children; otherwise show its parent's.
    // Notes marked with `#subtreeHidden` hide their children (e.g. options), so we
    // treat them like leaves and land on the parent column instead of an empty one.
    const treatAsFolder = !!activeNote?.hasChildren() && !activeNote.isLabelTruthy("subtreeHidden");
    const parentSegments = treatAsFolder ? segments : segments.slice(0, -1);

    // Clamp to the hoisted root.
    let start = parentSegments.indexOf(hoistedId);
    if (start < 0) start = 0;
    const clamped = parentSegments.slice(start);
    if (clamped.length === 0) {
        return [hoistedId];
    }

    const stack: string[] = [];
    for (let i = 0; i < clamped.length; i++) {
        stack.push(clamped.slice(0, i + 1).join("/"));
    }
    return stack;
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
            onBeforeCommand: () => {
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
