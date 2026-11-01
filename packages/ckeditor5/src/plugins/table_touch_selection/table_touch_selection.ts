import "../../theme/table_touch_selection.css";

import {
    DomEmitterMixin,
    Plugin,
    Table,
    TableSelection,
    TableUtils,
    TouchObserver
} from "ckeditor5";
import type {
    ModelElement,
    ViewDocumentTouchEndEvent,
    ViewDocumentTouchMoveEvent,
    ViewDocumentTouchStartEvent
} from "ckeditor5";

import { getStuckHeaderBottom } from "../table_sticky_header_read_only.js";
import {
    type ClientBox,
    findScroller,
    getAutoScrollStep,
    getClientBox,
    getViewportBottom,
    intersectBoxes,
    isEmptyBox,
    isInsideBox
} from "../viewport_geometry.js";
import TableTouchSelectionView, {
    type Corner,
    CORNERS,
    getCornerPoint
} from "./table_touch_selection_view.js";

/** The distance from a handle within which a touch drags it, in pixels. */
const HANDLE_REACH = 24;
/** The time after the last scroll at which the overlay shows again, in milliseconds. */
const SCROLL_SETTLE_MS = 150;

/**
 * Handles at the corners of the selected table cells, or of the cell with the caret, shown after a
 * touch. Dragging a handle selects the cells from the opposite corner to the cell under the
 * handle, so the selection grows or shrinks as the finger moves.
 */
export default class TableTouchSelection extends Plugin {

    readonly view: TableTouchSelectionView;
    private isTouch = false;
    private target: SelectionTarget | null = null;
    private layout: SelectionLayout | null = null;
    private gesture: Gesture | null = null;
    private frame = 0;
    private isScrolling = false;
    private scrollTimer: ReturnType<typeof setTimeout> | undefined;
    private readonly domEmitter = new (DomEmitterMixin())();
    private readonly resizeObserver = new ResizeObserver(() => this.scheduleUpdate());

    static get pluginName() {
        return "TableTouchSelection" as const;
    }

    static get requires() {
        return [Table, TableSelection, TableUtils] as const;
    }

    constructor(editor: Plugin["editor"]) {
        super(editor);
        this.view = new TableTouchSelectionView(editor.locale);
    }

    init() {
        const editor = this.editor;
        const viewDocument = editor.editing.view.document;
        editor.ui.view.body.add(this.view);

        // `TouchObserver` listens without `passive`, so `onTouchMove()` can cancel the scroll.
        editor.editing.view.addObserver(TouchObserver);
        this.listenTo<ViewDocumentTouchStartEvent>(viewDocument, "touchstart", (_evt, data) => {
            this.onTouchStart(data.domEvent);
        });
        this.listenTo<ViewDocumentTouchMoveEvent>(viewDocument, "touchmove", (_evt, data) => {
            this.onTouchMove(data.domEvent);
        });
        this.listenTo<ViewDocumentTouchEndEvent>(viewDocument, "touchend", (_evt, data) => {
            this.onTouchEnd(data.domEvent);
        });
        this.domEmitter.listenTo(document, "touchcancel", (_evt, event: TouchEvent) => {
            this.onTouchEnd(event);
        }, { usePassive: true });

        this.domEmitter.listenTo(document, "pointerdown", (_evt, event: PointerEvent) => {
            this.detectTouch(event);
        }, { useCapture: true });
        this.domEmitter.listenTo(document, "scroll", (_evt, event: Event) => this.onScroll(event), {
            useCapture: true,
            usePassive: true
        });
        this.domEmitter.listenTo(window, "resize", () => this.scheduleUpdate());
        const viewport = window.visualViewport;
        /* v8 ignore next 3 -- defensive: supported browsers have a visual viewport */
        if (viewport) {
            this.domEmitter.listenTo(viewport, "resize", () => this.scheduleUpdate());
        }

        // A change of the selection or the content renders the view, and a render fires `update`.
        this.listenTo(editor.ui, "update", () => this.scheduleUpdate());
        this.listenTo(editor.ui.focusTracker, "change:isFocused", () => this.scheduleUpdate());
        this.listenTo(editor.plugins.get(TableSelection), "change:isEnabled", () => {
            this.scheduleUpdate();
        });
    }

    override destroy() {
        this.endGesture();
        cancelAnimationFrame(this.frame);
        clearTimeout(this.scrollTimer);
        this.domEmitter.stopListening();
        this.resizeObserver.disconnect();
        this.view.destroy();
        super.destroy();
    }

    /** Draws the outline and the handles around the cells at the selection, or hides them. */
    update() {
        const target = this.findTarget();
        if (target?.domTable !== this.target?.domTable) {
            this.endGesture();
            this.resizeObserver.disconnect();
            // A centered table moves without a resize when the editable resizes.
            if (target) {
                this.resizeObserver.observe(target.domTable);
                this.resizeObserver.observe(target.domRoot);
            }
        }

        this.target = target;
        this.layout = target && !this.isScrolling ? this.layOut(target) : null;
        this.view.isVisible = !!this.layout;
        if (!this.layout) {
            this.endGesture();
        }
    }

    private scheduleUpdate() {
        if (this.frame || (!this.isTouch && !this.view.isVisible)) {
            return;
        }

        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            this.update();
        });
    }

    /**
     * Hides the overlay while an element around the table scrolls, and shows it again once the
     * scroll settles. The auto-scroll of a drag keeps the overlay shown.
     */
    private onScroll(event: Event) {
        const domTable = this.target?.domTable;
        if (!domTable || !isScrolledAround(event.target, domTable)) {
            return;
        }

        if (this.gesture?.isDragging) {
            this.scheduleUpdate();
            return;
        }

        clearTimeout(this.scrollTimer);
        this.scrollTimer = setTimeout(() => {
            this.isScrolling = false;
            this.scheduleUpdate();
        }, SCROLL_SETTLE_MS);
        if (!this.isScrolling) {
            this.isScrolling = true;
            this.update();
        }
    }

    /** Shows the handles after a touch and hides them after a press of a mouse or pen. */
    private detectTouch(event: PointerEvent) {
        const isTouch = event.pointerType === "touch";
        if (isTouch !== this.isTouch) {
            this.isTouch = isTouch;
            this.scheduleUpdate();
        }
    }

    private findTarget(): SelectionTarget | null {
        const editor = this.editor;
        const isEnabled = editor.plugins.get(TableSelection).isEnabled;
        if (!this.isTouch || !isEnabled || !editor.ui.focusTracker.isFocused) {
            return null;
        }

        const cells = this.getCells();
        const table = cells[0]?.findAncestor("table");
        if (!table) {
            return null;
        }

        const domTable = this.getDomElement(table)?.querySelector<HTMLElement>(":scope > table");
        const domRoot = editor.editing.view.getDomRoot();
        /* v8 ignore next 3 -- defensive: a table in the model is rendered in the editable */
        if (!domTable || !domRoot) {
            return null;
        }

        return { table, cells, domTable, domRoot };
    }

    /** The selected cells, or the cell with the caret. */
    private getCells() {
        const tableUtils = this.editor.plugins.get(TableUtils);
        const selection = this.editor.model.document.selection;
        const selectedCells = tableUtils.getSelectedTableCells(selection);
        if (selectedCells.length || !selection.isCollapsed) {
            return selectedCells;
        }
        return tableUtils.getTableCellsContainingSelection(selection);
    }

    /**
     * Places the outline and the handles around the cells of `target`. Returns `null` when no part
     * of the cells is visible.
     */
    private layOut({ cells, domTable, domRoot }: SelectionTarget): SelectionLayout | null {
        const domCells: HTMLElement[] = [];
        for (const cell of cells) {
            const domCell = this.getDomElement(cell);
            /* v8 ignore next 3 -- defensive: a cell in the model is rendered in its table */
            if (!domCell) {
                return null;
            }
            domCells.push(domCell);
        }

        const cellBoxes: ClientBox[] = domCells.map((domCell) => domCell.getBoundingClientRect());

        const range = cellBoxes.reduce<ClientBox>((union, box) => ({
            left: Math.min(union.left, box.left),
            top: Math.min(union.top, box.top),
            right: Math.max(union.right, box.right),
            bottom: Math.max(union.bottom, box.bottom)
        }), cellBoxes[0]);
        const visible = this.getVisibleArea(domTable, domRoot, domCells);
        if (isEmptyBox(intersectBoxes(range, visible))) {
            return null;
        }

        this.view.setRange(range, visible);
        return { range, visible, cellBoxes };
    }

    /**
     * The part of the viewport where `domCells` of the table can be seen: inside the element that
     * clips the table horizontally, the scroll container of the editable and the viewport offset
     * of the editor, and below the stuck header rows unless `domCells` includes one of them.
     */
    private getVisibleArea(
        domTable: HTMLElement,
        domRoot: HTMLElement,
        domCells: readonly HTMLElement[]
    ): ClientBox {
        const offset = this.editor.ui.viewportOffset;
        const headerBottom = domCells.some(isHeaderCell) ? null : getStuckHeaderBottom(domTable);
        const viewport = {
            left: offset.left ?? 0,
            top: Math.max(offset.top ?? 0, headerBottom ?? -Infinity),
            right: document.documentElement.clientWidth - (offset.right ?? 0),
            bottom: Math.min(getViewportBottom(), window.innerHeight - (offset.bottom ?? 0))
        };
        return intersectBoxes(
            getClientBox(findScroller(domTable, "overflowX")),
            getClientBox(findScroller(domRoot, "overflowY")),
            viewport
        );
    }

    private getDomElement(element: ModelElement) {
        const editing = this.editor.editing;
        const viewElement = editing.mapper.toViewElement(element);
        /* v8 ignore next -- defensive: an element in the model is rendered */
        return viewElement ? editing.view.domConverter.mapViewToDom(viewElement) : undefined;
    }

    /** Starts to follow a touch that lands close to a handle. A second finger ends the drag. */
    private onTouchStart(event: TouchEvent) {
        if (event.touches.length > 1) {
            this.endGesture();
            return;
        }

        const { target, layout } = this;
        const touch = event.changedTouches[0];
        const corner = layout && findCorner(layout, touch.clientX, touch.clientY);
        if (!target || !layout || !corner) {
            return;
        }

        const point = getCornerPoint(layout.range, corner);
        const oppositePoint = getCornerPoint(layout.range, getOppositeCorner(corner));
        this.gesture = {
            touchId: touch.identifier,
            offsetX: point.x - touch.clientX,
            offsetY: point.y - touch.clientY,
            x: point.x,
            y: point.y,
            anchor: findClosestCell(target.cells, layout.cellBoxes, oppositePoint),
            focus: findClosestCell(target.cells, layout.cellBoxes, point),
            isDragging: false,
            frame: 0
        };
    }

    /**
     * Drags the handle with the touch. If the browser already scrolls on the first move, the drag
     * ends. Otherwise the drag stops the scroll until the touch ends.
     */
    private onTouchMove(event: TouchEvent) {
        const gesture = this.gesture;
        const touch = gesture && findTouch(event.changedTouches, gesture.touchId);
        if (!gesture || !touch) {
            return;
        }

        if (!event.cancelable) {
            this.endGesture();
            return;
        }

        event.preventDefault();
        if (!gesture.isDragging) {
            gesture.isDragging = true;
            gesture.frame = requestAnimationFrame(this.autoScroll);
            this.view.isDragging = true;
        }

        gesture.x = touch.clientX + gesture.offsetX;
        gesture.y = touch.clientY + gesture.offsetY;
        this.selectTo(gesture);
    }

    private onTouchEnd(event: TouchEvent) {
        const gesture = this.gesture;
        if (gesture && findTouch(event.changedTouches, gesture.touchId)) {
            this.endGesture();
        }
    }

    private endGesture() {
        if (this.gesture) {
            cancelAnimationFrame(this.gesture.frame);
            this.gesture = null;
            this.view.isDragging = false;
        }
    }

    /** Selects the cells from the anchor of `gesture` to the cell under its handle. */
    private selectTo(gesture: Gesture) {
        const cell = this.findCellAt(gesture.x, gesture.y);
        if (cell && cell !== gesture.focus) {
            gesture.focus = cell;
            this.editor.plugins.get(TableSelection).setCellSelection(gesture.anchor, cell);
        }
    }

    /**
     * The cell of the target table at `x`, `y`, or `null` when no cell of the table is there. The
     * point is moved into the visible part of the table first.
     */
    private findCellAt(x: number, y: number) {
        const { target, layout } = this;
        /* v8 ignore next 3 -- defensive: a drag runs while the handles are drawn */
        if (!target || !layout) {
            return null;
        }

        const box = intersectBoxes(target.domTable.getBoundingClientRect(), layout.visible);
        const pointX = Math.min(Math.max(x, box.left + 1), box.right - 1);
        const pointY = Math.min(Math.max(y, box.top + 1), box.bottom - 1);
        for (const element of document.elementsFromPoint(pointX, pointY)) {
            const cell = element instanceof HTMLTableCellElement
                ? this.getModelCell(element)
                : null;
            if (cell?.parent?.parent === target.table) {
                return cell;
            }
        }
        return null;
    }

    private getModelCell(domCell: HTMLTableCellElement) {
        const editing = this.editor.editing;
        const viewCell = editing.view.domConverter.mapDomToView(domCell);
        const cell = viewCell?.is("element") ? editing.mapper.toModelElement(viewCell) : undefined;
        return cell?.is("element", "tableCell") ? cell : null;
    }

    /** Scrolls while the handle is close to an edge of the visible area, once per frame. */
    private readonly autoScroll = () => {
        const { gesture, target, layout } = this;
        /* v8 ignore next 3 -- defensive: the frame is cancelled with the drag */
        if (!gesture || !target || !layout) {
            return;
        }

        const { visible } = layout;
        const stepX = getAutoScrollStep(gesture.x, visible.left, visible.right);
        const stepY = getAutoScrollStep(gesture.y, visible.top, visible.bottom);
        if (stepX) {
            findScroller(target.domTable, "overflowX").scrollLeft += stepX;
        }
        if (stepY) {
            findScroller(target.domRoot, "overflowY").scrollTop += stepY;
        }
        if (stepX || stepY) {
            this.update();
            this.selectTo(gesture);
        }
        gesture.frame = requestAnimationFrame(this.autoScroll);
    };
}

interface SelectionTarget {
    table: ModelElement;
    /** The selected cells, or the cell with the caret. */
    cells: ModelElement[];
    domTable: HTMLElement;
    domRoot: HTMLElement;
}

interface SelectionLayout {
    /** The box around the cells, in the viewport. */
    range: ClientBox;
    /** The part of the viewport where the table can be seen. */
    visible: ClientBox;
    /** The boxes of the cells, in the order of `SelectionTarget.cells`. */
    cellBoxes: ClientBox[];
}

/** A handle dragged by a touch. */
interface Gesture {
    touchId: number;
    /** The position of the handle from the touch point when the touch started, in pixels. */
    offsetX: number;
    offsetY: number;
    /** The position of the handle in the viewport. */
    x: number;
    y: number;
    /** The cell at the opposite corner, which stays selected. */
    anchor: ModelElement;
    /** The cell that the handle selected last. */
    focus: ModelElement;
    /** Whether the touch has moved, so that it drags the handle instead of scrolling. */
    isDragging: boolean;
    /** The animation frame of the auto-scroll. */
    frame: number;
}

/** The corner whose visible handle is the closest to `x`, `y` within reach, or `null`. */
function findCorner({ range, visible }: SelectionLayout, x: number, y: number): Corner | null {
    let closest: Corner | null = null;
    let closestDistance = Infinity;
    for (const corner of CORNERS) {
        const point = getCornerPoint(range, corner);
        const distance = Math.hypot(point.x - x, point.y - y);
        const isReachable = distance <= HANDLE_REACH && isInsideBox(point.x, point.y, visible);
        if (isReachable && distance < closestDistance) {
            closest = corner;
            closestDistance = distance;
        }
    }
    return closest;
}

/** Whether `domCell` is in the header rows of its table. */
function isHeaderCell(domCell: HTMLElement) {
    return domCell.parentElement?.parentElement?.localName === "thead";
}

/** Whether a scroll of `scrolled`, an element or the document, moves `element`. */
function isScrolledAround(scrolled: EventTarget | null, element: Element) {
    return scrolled === document || (scrolled instanceof Node && scrolled.contains(element));
}

function getOppositeCorner({ x, y }: Corner): Corner {
    return { x: x === "left" ? "right" : "left", y: y === "top" ? "bottom" : "top" };
}

/** The cell of `cells` whose box, from `boxes`, is the closest to `point`. */
function findClosestCell(
    cells: readonly ModelElement[],
    boxes: readonly ClientBox[],
    point: { x: number; y: number }
) {
    let closest = cells[0];
    let closestDistance = Infinity;
    for (const [index, box] of boxes.entries()) {
        const dx = point.x - Math.min(Math.max(point.x, box.left), box.right);
        const dy = point.y - Math.min(Math.max(point.y, box.top), box.bottom);
        const distance = Math.hypot(dx, dy);
        if (distance < closestDistance) {
            closest = cells[index];
            closestDistance = distance;
        }
    }
    return closest;
}

function findTouch(touches: TouchList, identifier: number) {
    return Array.from(touches).find((touch) => touch.identifier === identifier) ?? null;
}

declare module "ckeditor5" {
    interface PluginsMap {
        [TableTouchSelection.pluginName]: TableTouchSelection;
    }
}
