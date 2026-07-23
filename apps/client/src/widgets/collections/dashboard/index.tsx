import "./index.css";
import "gridstack/dist/gridstack.min.css";

import type { HighlightedTokenInfo } from "@triliumnext/commons";
import { clsx } from "clsx";
import { GridStack } from "gridstack";
import { RefObject, TargetedMouseEvent } from "preact";
import { MutableRef, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import branches from "../../../services/branches";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import CollectionProperties from "../../note_bars/CollectionProperties";
import ActionButton from "../../react/ActionButton";
import { useCollectionTreeDrag, useElementSize, useNoteLabelBoolean, useSpacedUpdate } from "../../react/hooks";
import Icon from "../../react/Icon";
import NoteLink from "../../react/NoteLink";
import { ViewModeProps } from "../interface";
import { getNotePath, NoteContent } from "../legacy/ListOrGridView";
import openWidgetContextMenu from "./context_menu";
import { computeDropCell, DEFAULT_WIDGET_SIZE, GRID_COLUMNS, reconcilePersistedLayout, sameLayout, WidgetLayouts } from "./layout";

export interface DashboardViewConfig {
    widgets?: WidgetLayouts;
}

const INITIALIZED_CLASS = "dashboard-widget-initialized";
const CELL_HEIGHT = 80;
const GRID_MARGIN = 8;
/** Below this container width (in pixels) the dashboard collapses to a single column. */
const SINGLE_COLUMN_BREAKPOINT = 768;

export default function DashboardView({ note, noteIds, viewConfig, saveConfig, highlightedTokens, showTextRepresentation }: ViewModeProps<DashboardViewConfig>) {
    const [ includeArchived ] = useNoteLabelBoolean(note, "includeArchived");
    const containerRef = useRef<HTMLDivElement>(null);
    // The grid only spans its content height, so drops land on the taller scroll container instead.
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<GridStack | null>(null);

    const notes = useDashboardNotes(noteIds);
    const isCollapsed = useIsCollapsed(containerRef);
    const dropPositionsRef = useNoteTreeDropToDashboard(note, includeArchived, scrollContainerRef, containerRef, gridRef);
    useDashboardGrid({ note, notes, viewConfig, saveConfig, containerRef, gridRef, dropPositionsRef, isCollapsed });

    return (
        <div className="dashboard-view">
            <CollectionProperties note={note} />
            <div className="dashboard-scroll-container" ref={scrollContainerRef}>
                <div className="grid-stack" ref={containerRef}>
                    {notes.map((childNote) => (
                        <DashboardWidget
                            key={childNote.noteId}
                            note={childNote}
                            parentNote={note}
                            highlightedTokens={highlightedTokens}
                            includeArchived={includeArchived}
                            showTextRepresentation={showTextRepresentation}
                        />
                    ))}
                </div>
                {noteIds.length === 0 && <DashboardEmptyState collapsed={isCollapsed} />}
            </div>
        </div>
    );
}

/** Resolve the dashboard's child notes (the widgets) from their IDs. */
function useDashboardNotes(noteIds: string[]) {
    const [ notes, setNotes ] = useState<FNote[]>([]);
    useEffect(() => {
        let active = true;
        void froca.getNotes(noteIds).then(res => {
            if (active) {
                setNotes(res);
            }
        });
        return () => {
            active = false;
        };
    }, [ noteIds ]);
    return notes;
}

/** Whether the dashboard is narrow enough to collapse to a single column, where dragging and
 *  resizing are disabled (the derived single-column layout isn't persisted). */
function useIsCollapsed(containerRef: RefObject<HTMLElement>) {
    const containerSize = useElementSize(containerRef);
    return (containerSize?.width ?? Number.POSITIVE_INFINITY) < SINGLE_COLUMN_BREAKPOINT;
}

/** Saves the grid geometry to the view config (debounced) and restores it — both the locally tracked
 *  layout and external changes arriving through the viewConfig prop. Returns the bits the grid
 *  lifecycle needs: a `persistLayout(grid)` to call after the grid mutates, and `savedWidgetsRef`,
 *  the last-known persisted layout used to position widgets as they're created. */
function useDashboardLayoutPersistence({ note, viewConfig, saveConfig, gridRef, containerRef }: {
    note: FNote;
    viewConfig: DashboardViewConfig | undefined;
    saveConfig: (config: DashboardViewConfig) => void;
    gridRef: MutableRef<GridStack | null>;
    containerRef: RefObject<HTMLDivElement>;
}) {
    // Gridstack becomes the source of truth for geometry after init; capture the saved layout once
    // since the viewConfig prop changes identity after every save.
    const savedWidgetsRef = useRef<WidgetLayouts>(viewConfig?.widgets ?? {});
    const pendingConfigRef = useRef<DashboardViewConfig | null>(null);
    const spacedUpdate = useSpacedUpdate(() => {
        if (pendingConfigRef.current) {
            saveConfig(pendingConfigRef.current);
            pendingConfigRef.current = null;
        }
    });

    function persistLayout(grid: GridStack) {
        if (grid.getColumn() !== GRID_COLUMNS) {
            // Collapsed responsive mode — the geometry is a derived single-column layout;
            // persisting it would overwrite the real one.
            return;
        }

        const present: WidgetLayouts = {};
        for (const node of grid.engine.nodes) {
            if (typeof node.id === "string") {
                present[node.id] = { x: node.x ?? 0, y: node.y ?? 0, w: node.w ?? 1, h: node.h ?? 1 };
            }
        }
        // The grid only carries the widgets currently shown; pass the dashboard's full child set so
        // hidden (e.g. archived) widgets keep their saved geometry while widgets whose note is no
        // longer a child are pruned instead of lingering in the persisted layout forever.
        const widgets = reconcilePersistedLayout(savedWidgetsRef.current, present, new Set(note.children));
        if (sameLayout(widgets, savedWidgetsRef.current)) {
            return;
        }
        savedWidgetsRef.current = widgets;
        pendingConfigRef.current = { widgets };
        spacedUpdate.scheduleUpdate();
    }

    function applyLayout(widgets: WidgetLayouts) {
        const grid = gridRef.current;
        const container = containerRef.current;
        if (!grid || !container) return;
        if (grid.getColumn() !== GRID_COLUMNS) {
            // Collapsed responsive mode — the full-width coordinates don't apply to the derived
            // single-column layout. savedWidgetsRef is already updated, so the next save from this
            // side won't overwrite the external change.
            return;
        }

        grid.batchUpdate();
        try {
            for (const el of container.querySelectorAll<HTMLElement>(`.grid-stack-item.${INITIALIZED_CLASS}`)) {
                const layout = el.dataset.noteId ? widgets[el.dataset.noteId] : undefined;
                if (layout) {
                    grid.update(el, layout);
                }
            }
        } finally {
            grid.batchUpdate(false);
        }
    }

    // React to external changes of the layout (e.g. the same dashboard open in another split
    // or synced from another instance) propagated through the viewConfig prop.
    useEffect(() => {
        const widgets = viewConfig?.widgets ?? {};
        if (pendingConfigRef.current || sameLayout(widgets, savedWidgetsRef.current)) {
            // Local changes take precedence; identical layouts (e.g. our own save echoing back)
            // need no re-apply.
            return;
        }
        savedWidgetsRef.current = widgets;
        applyLayout(widgets);
    }, [ viewConfig ]);

    return { persistLayout, savedWidgetsRef };
}

/** Owns the gridstack instance and keeps it reconciled with the Preact-rendered widgets: Preact owns
 *  the element lifecycle (keyed by noteId), gridstack owns the geometry. Saving and restoring the
 *  geometry is delegated to {@link useDashboardLayoutPersistence}. */
function useDashboardGrid({ note, notes, viewConfig, saveConfig, containerRef, gridRef, dropPositionsRef, isCollapsed }: {
    note: FNote;
    notes: FNote[];
    viewConfig: DashboardViewConfig | undefined;
    saveConfig: (config: DashboardViewConfig) => void;
    containerRef: RefObject<HTMLDivElement>;
    gridRef: MutableRef<GridStack | null>;
    dropPositionsRef: MutableRef<WidgetLayouts>;
    isCollapsed: boolean;
}) {
    const { persistLayout, savedWidgetsRef } = useDashboardLayoutPersistence({ note, viewConfig, saveConfig, gridRef, containerRef });

    // Initialize the grid once per parent note.
    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const grid = GridStack.init({
            column: GRID_COLUMNS,
            cellHeight: CELL_HEIGHT,
            margin: GRID_MARGIN,
            float: true,
            handle: ".dashboard-widget-header",
            columnOpts: {
                // Collapse to a vertical stack when the dashboard itself gets narrow,
                // covering both mobile devices and narrow splits on desktop.
                breakpoints: [{ w: SINGLE_COLUMN_BREAKPOINT, c: 1 }]
            }
        }, container);
        gridRef.current = grid;
        grid.on("change", () => persistLayout(grid));

        return () => {
            grid.destroy(false);
            gridRef.current = null;
        };
    }, [ note ]);

    useEffect(() => {
        gridRef.current?.setStatic(isCollapsed);
    }, [ isCollapsed ]);

    // Reconcile the rendered children with the gridstack engine.
    useLayoutEffect(() => {
        const grid = gridRef.current;
        const container = containerRef.current;
        if (!grid || !container) return;

        let changed = false;
        grid.batchUpdate();
        try {
            // Drop engine nodes whose element Preact has already unmounted.
            for (const node of [ ...grid.engine.nodes ]) {
                if (node.el && !node.el.isConnected) {
                    grid.removeWidget(node.el, false, false);
                    changed = true;
                }
            }

            // Promote newly rendered items to widgets, restoring their saved (or just-dropped) geometry.
            for (const el of container.querySelectorAll<HTMLElement>(`.grid-stack-item:not(.${INITIALIZED_CLASS})`)) {
                const noteId = el.dataset.noteId;
                if (!noteId) continue;
                const saved = dropPositionsRef.current[noteId] ?? savedWidgetsRef.current[noteId];
                delete dropPositionsRef.current[noteId];
                grid.makeWidget(el, {
                    id: noteId,
                    ...DEFAULT_WIDGET_SIZE,
                    ...saved,
                    autoPosition: !saved
                });
                el.classList.add(INITIALIZED_CLASS);
                changed = true;
            }
        } finally {
            grid.batchUpdate(false);
        }

        // Persist auto-assigned positions and prune entries of removed notes — but only when
        // reconciliation actually touched the grid. Running on an empty grid (e.g. before the
        // notes have loaded on mount) would otherwise save an empty layout over the real one.
        if (changed) {
            persistLayout(grid);
        }
    }, [ notes ]);
}

/** Wire up dropping notes from the note tree onto the dashboard: each dropped note is cloned into
 *  the dashboard and the first one is positioned under the cursor. Returns a ref holding the drop
 *  positions of the freshly cloned notes, which the reconcile effect consumes (once) when it
 *  promotes them to grid widgets — kept out of savedWidgetsRef so persistLayout still saves them. */
function useNoteTreeDropToDashboard(note: FNote, includeArchived: boolean, dropAreaRef: RefObject<HTMLDivElement>, gridContainerRef: RefObject<HTMLDivElement>, gridRef: RefObject<GridStack | null>) {
    const dropPositionsRef = useRef<WidgetLayouts>({});

    useCollectionTreeDrag(dropAreaRef, {
        dragEnabled: true,
        includeArchived,
        async callback(treeData, e) {
            const grid = gridRef.current;
            const gridContainer = gridContainerRef.current;
            if (!grid || !gridContainer) return [];

            const dropCell = computeDropCell(grid, gridContainer, e);
            const addedNoteIds: string[] = [];
            let isFirstNewNote = true;
            for (const { noteId } of treeData) {
                const childNote = await froca.getNote(noteId, true);
                if (childNote?.getParentNoteIds().includes(note.noteId)) {
                    // Already a widget on this dashboard — don't create a duplicate clone.
                    continue;
                }
                // Place the first newly cloned note under the cursor; let the rest auto-position so
                // they don't all stack on the same cell. Skipped (already-present) notes don't count,
                // so the cursor position always lands on a note actually being added.
                if (isFirstNewNote && dropCell) {
                    dropPositionsRef.current[noteId] = { ...DEFAULT_WIDGET_SIZE, ...dropCell };
                }
                isFirstNewNote = false;
                await branches.cloneNoteToParentNote(noteId, note.noteId);
                addedNoteIds.push(noteId);
            }
            return addedNoteIds;
        }
    });

    return dropPositionsRef;
}

interface DashboardWidgetProps {
    note: FNote;
    parentNote: FNote;
    highlightedTokens: (string | HighlightedTokenInfo)[] | null | undefined;
    includeArchived: boolean;
    showTextRepresentation?: boolean;
}

function DashboardWidget({ note, parentNote, highlightedTokens, includeArchived, showTextRepresentation }: DashboardWidgetProps) {
    const notePath = getNotePath(parentNote, note);
    // Bumping the key remounts NoteContent, which re-runs the render — meaningful for render notes
    // (re-runs the script) and web views (reloads the embedded page).
    const [ refreshKey, setRefreshKey ] = useState(0);
    const canRefresh = note.type === "render" || note.type === "webView";

    /* The outer .grid-stack-item class list must stay constant across renders so that Preact never
       clobbers the classes gridstack adds there; dynamic classes go on the inner content element. */
    return (
        <div className="grid-stack-item" data-note-id={note.noteId}>
            <div className={clsx("grid-stack-item-content", "dashboard-widget", "no-tooltip-preview", note.getColorClass(), {
                "archived": note.isArchived
            })}>
                <div className="dashboard-widget-header">
                    <Icon className="note-icon" icon={note.getIcon()} />
                    <NoteLink className="note-book-title"
                        notePath={notePath}
                        noPreview
                        highlightedTokens={highlightedTokens} />
                    <ActionButton className="note-book-item-menu"
                        icon="bx bx-dots-vertical-rounded" text=""
                        onClick={(e: TargetedMouseEvent<HTMLElement>) => {
                            e.stopPropagation();
                            // The branch may not be in Froca yet (e.g. right after a clone, before the
                            // WebSocket update arrives); without it there's nothing to remove.
                            const branchId = note.parentToBranch[parentNote.noteId];
                            if (!branchId) return;
                            openWidgetContextMenu(notePath, branchId, e, {
                                onRefresh: canRefresh ? () => setRefreshKey((key) => key + 1) : undefined
                            });
                        }} />
                </div>
                <div className="dashboard-widget-content">
                    <NoteContent key={refreshKey}
                        note={note}
                        trim
                        interactive
                        highlightedTokens={highlightedTokens}
                        includeArchivedNotes={includeArchived}
                        showTextRepresentation={showTextRepresentation} />
                </div>
            </div>
        </div>
    );
}

/** Shown when the dashboard has no widgets: a few ghost tiles hint at the underlying grid, with a
 *  prompt to drag notes in. Purely decorative — pointer-events are disabled so drops still land on
 *  the scroll container behind it. The ghost grid mirrors the 12-column layout, which is meaningless
 *  once the grid collapses to a single column, so there we keep only the hint. */
function DashboardEmptyState({ collapsed }: { collapsed: boolean }) {
    return (
        <div className="dashboard-empty-state">
            {!collapsed && (
                <div className="dashboard-ghost-grid" aria-hidden="true">
                    {Array.from({ length: 5 }).map((_, index) => (
                        <div key={index} className="dashboard-ghost-widget" />
                    ))}
                </div>
            )}
            <div className="dashboard-empty-hint">
                <p>{t("dashboard_view.empty-hint")}</p>
            </div>
        </div>
    );
}
