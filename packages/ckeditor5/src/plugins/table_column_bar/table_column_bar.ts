import "../../theme/table_column_bar.css";

import {
    _getElementWidthInPixels as getElementWidthInPixels,
    _getSelectionAffectedTable as getSelectionAffectedTable,
    _getTableColumnsWidths as getTableColumnsWidths,
    _TABLE_COLUMN_MIN_WIDTH_IN_PIXELS as MIN_COLUMN_WIDTH,
    _toPrecision as toPrecision,
    DomEmitterMixin,
    Plugin,
    Table,
    TableColumnResize,
    TableUtils,
    TableWalker
} from "ckeditor5";
import type { DropdownView, ModelElement, ToolbarView, ViewElement } from "ckeditor5";

import {
    distributeColumns,
    getSpannedColumns,
    getTableWidthBasis,
    measureColumnEdges
} from "../table_distribute_columns.js";
import TriliumTableScroll from "../table_scroll.js";
import {
    type ClientBox,
    findScroller,
    getAutoScrollStep,
    getClientBox,
    getViewportBottom
} from "../viewport_geometry.js";
import { trackPointer } from "./pointer_tracking.js";
import TableColumnBarView, {
    HANDLE_SELECTOR,
    RESIZABLE_DIVIDER_CLASS
} from "./table_column_bar_view.js";

const LONG_PRESS_MS = 500;
const DOUBLE_TAP_MS = 400;
const VIBRATION_MS = 10;
/** The distance from a snap point at which a dragged width takes it, in pixels. */
const SNAP_DISTANCE = 8;
const RESIZED_TABLE_CLASS = "ck-table-resized";
/** Set on the editable while touch is in use. Scrolling tables then end with a gap. */
const TOUCH_CLASS = "ck-table-column-bar-touch";

/**
 * A bar along the bottom of the editing area for the table at the selection, shown after a touch.
 * Each segment is a column: a tap selects it, a long press opens the column menu and a swipe
 * scrolls the table. Dragging the divider at the end of a column of the selected cells resizes
 * it, and the table grows or shrinks with it. A double tap on that divider evens out the two
 * columns beside it.
 */
export default class TableColumnBar extends Plugin {

    readonly view: TableColumnBarView;
    private isTouch = false;
    private target: BarTarget | null = null;
    /** The column boundaries of the target table, in pixels from its left edge. */
    private edges: number[] | null = null;
    private isMeasureNeeded = true;
    private frame = 0;
    /** The visible part of the table's horizontal scroller in the viewport, in pixels. */
    private trackBox = { left: 0, right: 0 };
    private bottomOffset = 0;
    private resizedColumn: number | null = null;
    private cancelGesture: (() => void) | null = null;
    private menu: DropdownView | null = null;
    private lastTap: Tap | null = null;
    private readonly domEmitter = new (DomEmitterMixin())();
    private readonly resizeObserver = new ResizeObserver(() => this.scheduleUpdate(true));

    static get pluginName() {
        return "TableColumnBar" as const;
    }

    static get requires() {
        return [Table, TableColumnResize, TriliumTableScroll] as const;
    }

    constructor(editor: Plugin["editor"]) {
        super(editor);
        this.view = new TableColumnBarView(editor.locale);
    }

    init() {
        const editor = this.editor;
        const view = this.view;
        editor.ui.view.body.add(view);

        this.domEmitter.listenTo(view.track, "pointerdown", (_evt, event: PointerEvent) => {
            this.onPointerDown(event);
        });
        this.domEmitter.listenTo(view.track, "contextmenu", (_evt, event: Event) => {
            event.preventDefault();
        });
        this.domEmitter.listenTo(document, "pointerdown", (_evt, event: PointerEvent) => {
            this.detectTouch(event);
        }, { useCapture: true });
        this.domEmitter.listenTo(document, "scroll", () => this.scheduleUpdate(false), {
            useCapture: true,
            usePassive: true
        });
        this.domEmitter.listenTo(window, "resize", () => this.scheduleUpdate(true));
        const viewport = window.visualViewport;
        /* v8 ignore next 3 -- defensive: supported browsers have a visual viewport */
        if (viewport) {
            this.domEmitter.listenTo(viewport, "resize", () => this.scheduleUpdate(false));
        }

        // The columns are measured again only when the content, the selection or the size of
        // the table changes.
        const update = () => this.scheduleUpdate(false);
        const measure = () => this.scheduleUpdate(true);
        this.listenTo(editor.ui, "update", update);
        this.listenTo(editor.ui.focusTracker, "change:isFocused", update);
        this.listenTo(editor, "change:isReadOnly", update);
        this.listenTo(editor.model.document, "change:data", measure);
        this.listenTo(editor.model.document.selection, "change:range", measure);
    }

    override destroy() {
        this.cancelGesture?.();
        cancelAnimationFrame(this.frame);
        this.domEmitter.stopListening();
        this.resizeObserver.disconnect();
        this.view.destroy();
        super.destroy();
    }

    /** Shows the bar for the table at the selection, or hides it. */
    update() {
        const view = this.view;
        const target = this.findTarget();
        if (target?.domTable !== this.target?.domTable) {
            this.cancelGesture?.();
            this.resizeObserver.disconnect();
            if (target) {
                this.resizeObserver.observe(target.domTable);
            }
            this.edges = null;
        }
        this.target = target;

        view.isVisible = !!target;
        const barTop = target ? this.layOut(target) : null;
        if (barTop === null) {
            view.isVisible = false;
            if (this.menu) {
                this.menu.isOpen = false;
            }
        }
        this.setBottomOffset(barTop === null ? 0 : Math.round(window.innerHeight - barTop));
    }

    private scheduleUpdate(isMeasureNeeded: boolean) {
        this.isMeasureNeeded ||= isMeasureNeeded;
        if (this.frame || (!this.isTouch && !this.view.isVisible)) {
            return;
        }

        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            this.update();
        });
    }

    /** Shows the bar after a touch and hides it after a press of a mouse or pen elsewhere. */
    private detectTouch(event: PointerEvent) {
        const isTouch = event.pointerType === "touch";
        const isOnBar = !!(event.target as Element).closest(".ck-table-column-bar");
        if (isTouch !== this.isTouch && !isOnBar) {
            this.isTouch = isTouch;
            this.setTouchClass(isTouch);
            this.scheduleUpdate(true);
        }
    }

    private setTouchClass(isTouch: boolean) {
        const view = this.editor.editing.view;
        view.change((writer) => {
            for (const root of view.document.roots) {
                if (isTouch) {
                    writer.addClass(TOUCH_CLASS, root);
                } else {
                    writer.removeClass(TOUCH_CLASS, root);
                }
            }
        });
    }

    private findTarget(): BarTarget | null {
        const editor = this.editor;
        if (!this.isTouch || editor.isReadOnly || !editor.ui.focusTracker.isFocused) {
            return null;
        }

        const selection = editor.model.document.selection;
        const table: ModelElement | null = getSelectionAffectedTable(selection);
        if (!table || !editor.model.canEditAt(table)) {
            return null;
        }

        const viewFigure = editor.editing.mapper.toViewElement(table);
        const domFigure = viewFigure && editor.editing.view.domConverter.mapViewToDom(viewFigure);
        const domTable = domFigure?.querySelector<HTMLElement>(":scope > table");
        const domContainer = domFigure?.parentElement;
        const domRoot = domTable?.closest<HTMLElement>(".ck-editor__editable");
        /* v8 ignore next 3 -- defensive: a table in the model is rendered in the editable */
        if (!(domFigure instanceof HTMLElement) || !domTable || !domContainer || !domRoot) {
            return null;
        }

        return { table, domFigure, domTable, domContainer, domRoot };
    }

    /** Whether `table` is centered in its container, read as `TableColumnResize` reads it. */
    private isCentered(table: ModelElement) {
        const alignment = table.getAttribute("tableAlignment")
            ?? this.editor.config.get("table.tableProperties.defaultProperties.alignment");
        return !alignment || alignment === "center";
    }

    /**
     * Places the bar and draws the columns of `target`. Returns the top of the bar in the
     * viewport, or `null` when no part of the table is visible above it.
     */
    private layOut(target: BarTarget): number | null {
        const view = this.view;
        const area = getBarArea(target.domRoot, this.getToolbarElement(), this.getBottomObstacle());
        const barTop = area.bottom - view.track.offsetHeight;
        const tableRect = target.domTable.getBoundingClientRect();
        const clip = getClientBox(findScroller(target.domTable, "overflowX"));
        const trackLeft = Math.max(clip.left, area.left);
        const trackRight = Math.min(clip.right, area.right);
        const left = Math.max(tableRect.left, trackLeft);
        const right = Math.min(tableRect.right, trackRight);
        const top = Math.max(tableRect.top, clip.top, area.top);
        const bottom = Math.min(tableRect.bottom, clip.bottom, barTop);
        if (right <= left || bottom <= top) {
            return null;
        }

        const edges = this.measure(target, tableRect);
        /* v8 ignore next 3 -- defensive: the bar shows a rendered table */
        if (!edges) {
            return null;
        }

        // The track spans the scroller, so the divider at the table's end shows in full and the
        // auto-scroll starts only near the edges of the scroller.
        // `position: fixed` places the bar against the layout viewport, which iOS shifts away
        // from the viewport that `getBoundingClientRect()` measures while the keyboard is up.
        view.set({ left: area.left, top: barTop, width: area.right - area.left });
        // Rendered as `init()` adds it to the body collection.
        const shift = getFixedShift(view.element as HTMLElement, view.left, view.top);
        view.set({ left: area.left - shift.x, top: barTop - shift.y });
        view.setTrack(trackLeft - area.left, trackRight - trackLeft, tableRect.left - trackLeft);
        this.trackBox = { left: trackLeft, right: trackRight };

        const column = this.resizedColumn;
        view.setActiveDivider(column);
        view.setEdge(column === null
            ? null
            : {
                left: tableRect.left + edges[column + 1] - shift.x,
                top: top - shift.y,
                height: bottom - top
            });
        return barTop;
    }

    /**
     * The column boundaries of the target table, measured again when its layout or the selection
     * can differ.
     */
    private measure(target: BarTarget, tableRect: DOMRect) {
        if (this.edges && !this.isMeasureNeeded) {
            return this.edges;
        }

        const editor = this.editor;
        const tableUtils = editor.plugins.get(TableUtils);
        const isRtl = editor.locale.contentLanguageDirection === "rtl";
        const columnCount = tableUtils.getColumns(target.table);
        const measured = measureColumnEdges(editor, target.table, columnCount);
        /* v8 ignore next 3 -- defensive: the bar shows a rendered table */
        if (!measured) {
            return null;
        }

        const edges = measured.map((edge) => (isRtl ? -edge : edge) - tableRect.left);
        const tableWidth = Math.abs(edges[columnCount] - edges[0]);
        const labels: string[] = [];
        for (let column = 0; column < columnCount; column++) {
            const width = Math.abs(edges[column + 1] - edges[column]);
            const share = Math.round(width / tableWidth * 100);
            labels.push(editor.t("Column %0 width: %1%", [column + 1, share]));
        }

        const cells = tableUtils.getSelectionAffectedTableCells(editor.model.document.selection);
        this.view.setColumns(edges, labels, getSpannedColumns(target.table, cells));
        this.edges = edges;
        this.isMeasureNeeded = false;
        return edges;
    }

    private getToolbarElement() {
        return (this.editor.ui.view as { toolbar?: ToolbarView }).toolbar?.element ?? null;
    }

    private getBottomObstacle() {
        const element = this.editor.config.get("tableColumnBar")?.bottomObstacle?.();
        return element?.isConnected ? element : null;
    }

    /** Keeps the balloons of the editor and the caret above the bar. */
    private setBottomOffset(offset: number) {
        if (offset === this.bottomOffset) {
            return;
        }

        const ui = this.editor.ui;
        const bottom = (ui.viewportOffset.bottom ?? 0) - this.bottomOffset + offset;
        ui.viewportOffset = { ...ui.viewportOffset, bottom };
        this.bottomOffset = offset;
        ui.update();
    }

    private onPointerDown(event: PointerEvent) {
        const target = this.target;
        const handle = (event.target as Element).closest<HTMLElement>(HANDLE_SELECTOR);
        if (!target || !handle || !event.isPrimary) {
            return;
        }

        event.preventDefault();
        if (this.menu) {
            this.menu.isOpen = false;
        }

        // A double tap is two taps on a divider with no other gesture on the bar between them.
        const previousTap = this.lastTap;
        this.lastTap = null;
        const column = Number(handle.dataset.column);
        if (handle.classList.contains(RESIZABLE_DIVIDER_CLASS)) {
            this.startResize(event, column, target, previousTap);
        } else {
            this.startPress(event, column, target);
        }
    }

    /** Selects the column on a tap, opens its menu on a long press and scrolls on a swipe. */
    private startPress(event: PointerEvent, column: number, { table, domTable }: BarTarget) {
        const scroller = findScroller(domTable, "overflowX");
        const startX = event.clientX;
        const startScroll = scroller.scrollLeft;
        let isLongPress = false;
        const timer = setTimeout(() => {
            isLongPress = true;
            vibrate();
            this.selectColumn(table, column);
            this.openMenu(column);
        }, LONG_PRESS_MS);
        const finish = () => {
            clearTimeout(timer);
            this.cancelGesture = null;
        };

        this.cancelGesture = trackPointer(event, this.view.track, {
            onMove: (clientX) => {
                clearTimeout(timer);
                if (!isLongPress) {
                    scroller.scrollLeft = startScroll - (clientX - startX);
                }
            },
            onEnd: (isMoved) => {
                finish();
                if (!isMoved && !isLongPress) {
                    this.selectColumn(table, column);
                }
            },
            onCancel: finish
        });
    }

    /**
     * Resizes `column` while the divider at its end is dragged. The table shows each width without
     * a change to the model, which takes the width at which the divider is released. A tap that
     * follows `previousTap` on the same divider evens out the two columns beside it.
     */
    private startResize(
        event: PointerEvent,
        column: number,
        target: BarTarget,
        previousTap: Tap | null
    ) {
        const editor = this.editor;
        const { table, domContainer, domTable } = target;
        const direction = editor.locale.contentLanguageDirection === "rtl" ? -1 : 1;
        const columnCount = editor.plugins.get(TableUtils).getColumns(table);
        const edges = measureColumnEdges(editor, table, columnCount);
        /* v8 ignore next 3 -- defensive: the bar shows a rendered table */
        if (!edges) {
            return;
        }

        const widths = edges.slice(1).map((edge, index) => edge - edges[index]);
        const startWidth = widths[column];
        const minWidth = Math.min(MIN_COLUMN_WIDTH, startWidth);
        const gap = this.isCentered(table)
            ? getElementWidthInPixels(domContainer) - sum(widths)
            : null;
        const snapPoints = [startWidth, widths[column - 1], widths[column + 1]]
            .filter((width) => width !== undefined);
        const startX = event.clientX;
        let clientX = startX;
        let scrolled = 0;
        let width = startWidth;
        let snapPoint: number | null = startWidth;
        let preview: ResizePreview | null = null;
        let frame = 0;

        const resize = () => {
            const distance = (clientX - startX) * direction + scrolled;
            const growth = gap === null ? distance : getCenteredGrowth(distance, gap);
            const freeWidth = Math.max(startWidth + growth, minWidth);
            const nextSnapPoint = findSnapPoint(freeWidth, snapPoints);
            if (nextSnapPoint !== null && nextSnapPoint !== snapPoint) {
                vibrate();
            }
            snapPoint = nextSnapPoint;
            width = snapPoint ?? freeWidth;
            preview ??= this.startPreview(table, domTable, widths.length);
            this.showPreview(preview, replaceAt(widths, column, width));
        };

        const scrollStep = () => {
            const step = getAutoScrollStep(clientX, this.trackBox.left, this.trackBox.right);
            if (step) {
                const scroller = findScroller(domTable, "overflowX");
                const scrollLeft = scroller.scrollLeft;
                scroller.scrollLeft += step;
                scrolled += (scroller.scrollLeft - scrollLeft) * direction;
                resize();
            }
            frame = requestAnimationFrame(scrollStep);
        };

        const finish = () => {
            cancelAnimationFrame(frame);
            this.cancelGesture = null;
            this.resizedColumn = null;
            if (preview) {
                this.endPreview(preview);
            }
            this.scheduleUpdate(true);
        };

        this.resizedColumn = column;
        this.cancelGesture = trackPointer(event, this.view.track, {
            onMove: (moveX) => {
                clientX = moveX;
                frame ||= requestAnimationFrame(scrollStep);
                resize();
            },
            onEnd: (isMoved) => {
                if (isMoved && width !== startWidth) {
                    this.commit(target, replaceAt(widths, column, width));
                }
                finish();
                if (isMoved) {
                    return;
                }

                const tap = { table, column, time: performance.now() };
                if (!isDoubleTap(previousTap, tap)) {
                    this.lastTap = tap;
                } else if (column + 1 < widths.length) {
                    distributeColumns(editor, table, { first: column, last: column + 1 });
                }
            },
            onCancel: finish
        });
        this.scheduleUpdate(false);
    }

    /** Adds a column group to the view of `table` if it has none, for the widths of a preview. */
    private startPreview(table: ModelElement, domTable: HTMLElement, columnCount: number) {
        const view = this.editor.editing.view;
        const viewTable = view.domConverter.mapDomToView(domTable) as ViewElement;

        return view.change((writer): ResizePreview => {
            const existing = findColgroup(viewTable);
            const colgroup = existing ?? writer.createContainerElement("colgroup", null,
                Array.from({ length: columnCount }, () => writer.createEmptyElement("col")));
            if (!existing) {
                writer.insert(writer.createPositionAt(viewTable, 0), colgroup);
            }
            const isClassAdded = !viewTable.hasClass(RESIZED_TABLE_CLASS);
            writer.addClass(RESIZED_TABLE_CLASS, viewTable);
            return { table, viewTable, colgroup, isColgroupAdded: !existing, isClassAdded };
        });
    }

    /** Shows `widths` on the columns of the table, in pixels, without a change to the model. */
    private showPreview(preview: ResizePreview, widths: number[]) {
        this.editor.editing.view.change((writer) => {
            for (const [index, col] of getCols(preview.colgroup).entries()) {
                writer.setStyle("width", `${toPrecision(widths[index])}px`, col);
            }
        });
        const tableWidth = `${toPrecision(sum(widths))}px`;
        this.tableScroll._updateTableScrollOverflowState(preview.table, tableWidth);
        this.scheduleUpdate(true);
    }

    /** Shows the widths of the model on the table again. */
    private endPreview(preview: ResizePreview) {
        const { table, viewTable, colgroup, isColgroupAdded, isClassAdded } = preview;
        const savedWidths = getTableColumnsWidths(table);
        this.editor.editing.view.change((writer) => {
            if (isColgroupAdded) {
                if (colgroup.isAttached()) {
                    writer.remove(colgroup);
                }
            } else {
                for (const [index, col] of getCols(colgroup).entries()) {
                    writer.setStyle("width", savedWidths[index], col);
                }
            }
            if (isClassAdded && !savedWidths.length) {
                writer.removeClass(RESIZED_TABLE_CLASS, viewTable);
            }
        });
        this.tableScroll._updateTableScrollOverflowState(table);
    }

    private get tableScroll() {
        return this.editor.plugins.get(TriliumTableScroll);
    }

    /**
     * Saves `widths`, in pixels, as the column widths of the target table, and their sum as its
     * width. A table sized in pixels keeps pixels, any other one gets percentages.
     */
    private commit({ table, domFigure }: BarTarget, widths: number[]) {
        const editor = this.editor;
        const tableWidth = sum(widths);
        const savedWidth = table.getAttribute("tableWidth");
        if (typeof savedWidth === "string" && savedWidth.trim().endsWith("px")) {
            editor.execute("resizeTableWidth", {
                table,
                tableWidth: `${toPrecision(tableWidth)}px`,
                columnWidths: widths.map((width) => `${toPrecision(width)}px`)
            });
            return;
        }

        const basis = getTableWidthBasis(editor, table, domFigure);
        /* v8 ignore next 3 -- defensive: the bar shows a table with a width */
        if (!basis) {
            return;
        }

        editor.execute("resizeTableWidth", {
            table,
            tableWidth: `${toPrecision(tableWidth / basis * 100)}%`,
            columnWidths: widths.map((width) => `${toPrecision(width / tableWidth * 100)}%`)
        });
    }

    private selectColumn(table: ModelElement, column: number) {
        const editor = this.editor;
        const [slot] = new TableWalker(table, { column, includeAllSlots: true });
        editor.model.change((writer) => writer.setSelection(slot.cell, 0));
        editor.execute("selectTableColumn");
    }

    private openMenu(column: number) {
        if (!this.menu) {
            this.menu = this.editor.ui.componentFactory.create("tableColumn") as DropdownView;
            this.view.menus.add(this.menu);
        }
        this.view.placeMenu(column);
        this.menu.isOpen = true;
    }
}

interface BarTarget {
    table: ModelElement;
    domFigure: HTMLElement;
    domTable: HTMLElement;
    /** The element that holds the figure of the table. */
    domContainer: HTMLElement;
    domRoot: HTMLElement;
}

interface ResizePreview {
    table: ModelElement;
    viewTable: ViewElement;
    colgroup: ViewElement;
    isColgroupAdded: boolean;
    isClassAdded: boolean;
}

/** A tap on the divider at the end of `column`, at `time` from `performance.now()`. */
interface Tap {
    table: ModelElement;
    column: number;
    time: number;
}

/**
 * The part of the viewport that the bar spans: the visible part of the scroll container of
 * `domRoot`, up to the top of a toolbar at its bottom, or of `obstacle` wherever it is.
 */
function getBarArea(
    domRoot: HTMLElement, toolbar: HTMLElement | null, obstacle: HTMLElement | null
): ClientBox {
    const area = getClientBox(findScroller(domRoot, "overflowY"));
    let bottom = Math.min(area.bottom, getViewportBottom());
    if (obstacle) {
        return { ...area, bottom: Math.min(bottom, obstacle.getBoundingClientRect().top) };
    }
    const toolbarRect = toolbar?.isConnected ? toolbar.getBoundingClientRect() : null;
    const isToolbarAtBottom = !!toolbarRect
        && toolbarRect.top < bottom && toolbarRect.bottom >= bottom - 1;
    if (isToolbarAtBottom) {
        bottom = toolbarRect.top;
    }
    return { ...area, bottom };
}

/**
 * How much a column of a centered table grows to move its end edge by `distance`. `gap` is the
 * width left in the container beside the table. The table stays centered while it fits, so the
 * edge moves half as far as the column grows, and once wider than its container it starts at the
 * container's start, so the edge moves as far as the column grows.
 */
export function getCenteredGrowth(distance: number, gap: number) {
    const room = Math.max(gap, 0);
    return distance >= gap - room / 2 ? distance + room / 2 : 2 * distance - gap + room;
}

/** The point of `points` closest to `width` within the snap distance, or `null`. */
export function findSnapPoint(width: number, points: readonly number[]): number | null {
    let closest: number | null = null;
    for (const point of points) {
        const distance = Math.abs(point - width);
        const isCloser = closest === null || distance < Math.abs(closest - width);
        if (distance <= SNAP_DISTANCE && isCloser) {
            closest = point;
        }
    }
    return closest;
}

/** Whether `tap` follows `previousTap` on the same divider closely enough. */
function isDoubleTap(previousTap: Tap | null, tap: Tap) {
    return previousTap?.table === tap.table && previousTap.column === tap.column
        && tap.time - previousTap.time < DOUBLE_TAP_MS;
}

function findColgroup(viewTable: ViewElement) {
    return Array.from(viewTable.getChildren())
        .find((child): child is ViewElement => child.is("element", "colgroup"));
}

function getCols(colgroup: ViewElement) {
    return Array.from(colgroup.getChildren())
        .filter((child): child is ViewElement => child.is("element", "col"));
}

function replaceAt(values: readonly number[], index: number, value: number) {
    const result = [...values];
    result[index] = value;
    return result;
}

function sum(values: readonly number[]) {
    return values.reduce((total, value) => total + value, 0);
}

function vibrate() {
    navigator.vibrate?.(VIBRATION_MS);
}

declare module "ckeditor5" {
    interface EditorConfig {
        tableColumnBar?: {
            /**
             * The element the bar stays above while it is on the page, such as a toolbar that
             * floats over the bottom of the editing area. Without one, the bar stays above the
             * editor's toolbar when that is at the bottom of the viewport.
             */
            bottomObstacle?: () => HTMLElement | null;
        };
    }

    interface PluginsMap {
        [TableColumnBar.pluginName]: TableColumnBar;
    }
}

/**
 * How far `position: fixed` places `element` from where its `left` and `top` put it in the
 * viewport, in pixels.
 */
function getFixedShift(element: HTMLElement, left: number, top: number) {
    const rect = element.getBoundingClientRect();
    return { x: rect.left - left, y: rect.top - top };
}
