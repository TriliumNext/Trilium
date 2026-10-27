import { type DropdownView, type Locale, toUnit, View, type ViewCollection } from "ckeditor5";

import type { IndexRange } from "../table_move/table_move_groups.js";

const SEGMENT_CLASS = "ck-table-column-bar__segment";
const DIVIDER_CLASS = "ck-table-column-bar__divider";
const ACTIVE_DIVIDER_CLASS = "ck-table-column-bar__divider_active";
export const RESIZABLE_DIVIDER_CLASS = "ck-table-column-bar__divider_resizable";
/** The elements of the bar that start a gesture. */
export const HANDLE_SELECTOR = `.${SEGMENT_CLASS}, .${RESIZABLE_DIVIDER_CLASS}`;

/** The place of the edge line in the viewport, in pixels. */
export interface EdgeBox {
    left: number;
    top: number;
    height: number;
}

/**
 * The bar of `TableColumnBar`: a segment for each column of a table and a divider at the end of
 * each segment, clipped to the visible part of the table.
 */
export default class TableColumnBarView extends View<HTMLDivElement> {

    declare isVisible: boolean;
    declare left: number;
    declare top: number;
    declare width: number;
    declare menuLeft: number;

    /** The visible part of the table's horizontal scroller, where the gestures start. */
    readonly track = createElement("ck-table-column-bar__track");
    readonly menus: ViewCollection<DropdownView>;
    /** The segments and dividers, positioned from the left edge of the table. */
    private readonly strip = createElement("ck-table-column-bar__strip");
    /** The line over the table at the edge being dragged. */
    private readonly edge = createElement("ck-table-column-bar__edge");

    constructor(locale: Locale) {
        super(locale);

        const bind = this.bindTemplate;
        const toPx = toUnit("px");
        this.set({ isVisible: false, left: 0, top: 0, width: 0, menuLeft: 0 });
        this.menus = this.createCollection();
        this.track.append(this.strip);
        this.edge.classList.add("ck-hidden");

        this.setTemplate({
            tag: "div",
            attributes: {
                class: [
                    "ck",
                    "ck-table-column-bar",
                    bind.if("isVisible", "ck-hidden", (isVisible) => !isVisible)
                ],
                role: "group",
                "aria-label": locale.t("Table columns"),
                style: {
                    left: bind.to("left", toPx),
                    top: bind.to("top", toPx),
                    width: bind.to("width", toPx)
                }
            },
            children: [
                this.track,
                this.edge,
                {
                    tag: "div",
                    attributes: {
                        class: "ck-table-column-bar__menu",
                        style: { left: bind.to("menuLeft", toPx) }
                    },
                    children: this.menus
                }
            ]
        });
    }

    /**
     * Shows the columns from `left` to `left + width` of the bar. `offset` is the position of the
     * table's left edge in that part.
     */
    setTrack(left: number, width: number, offset: number) {
        this.track.style.left = `${left}px`;
        this.track.style.width = `${width}px`;
        this.strip.style.transform = `translateX(${offset}px)`;
    }

    /**
     * Draws a segment between each two of `edges`, in pixels from the table's left edge, and a
     * divider labeled from `labels` at the end of each segment. Only the dividers of the
     * `resizable` columns take a drag.
     */
    setColumns(edges: readonly number[], labels: readonly string[], resizable: IndexRange) {
        if (this.strip.childElementCount !== labels.length * 2) {
            this.strip.replaceChildren();
            for (const column of labels.keys()) {
                const segment = createElement(SEGMENT_CLASS);
                const divider = createElement(DIVIDER_CLASS);
                segment.dataset.column = String(column);
                divider.dataset.column = String(column);
                divider.setAttribute("role", "separator");
                divider.setAttribute("aria-orientation", "vertical");
                this.strip.append(segment, divider);
            }
        }

        for (const [column, label] of labels.entries()) {
            const start = edges[column];
            const end = edges[column + 1];
            const segment = this.strip.children[column * 2] as HTMLElement;
            const divider = this.strip.children[column * 2 + 1] as HTMLElement;
            segment.style.left = `${Math.min(start, end)}px`;
            segment.style.width = `${Math.abs(end - start)}px`;
            divider.style.left = `${end}px`;
            divider.setAttribute("aria-label", label);
            const isResizable = column >= resizable.first && column <= resizable.last;
            divider.classList.toggle(RESIZABLE_DIVIDER_CLASS, isResizable);
        }
    }

    /** Highlights the divider of `column`, or none. */
    setActiveDivider(column: number | null) {
        for (const divider of this.strip.querySelectorAll<HTMLElement>(`.${DIVIDER_CLASS}`)) {
            const isActive = Number(divider.dataset.column) === column;
            divider.classList.toggle(ACTIVE_DIVIDER_CLASS, isActive);
        }
    }

    /** Shows the line over the table at `box`, or hides it. */
    setEdge(box: EdgeBox | null) {
        this.edge.classList.toggle("ck-hidden", !box);
        if (box) {
            this.edge.style.left = `${box.left}px`;
            this.edge.style.top = `${box.top}px`;
            this.edge.style.height = `${box.height}px`;
        }
    }

    /** Places the column menu over the middle of the visible part of the segment of `column`. */
    placeMenu(column: number) {
        const segmentRect = this.strip.children[column * 2].getBoundingClientRect();
        const trackRect = this.track.getBoundingClientRect();
        const left = Math.max(segmentRect.left, trackRect.left);
        const right = Math.min(segmentRect.right, trackRect.right);
        this.menuLeft = (left + right) / 2 - trackRect.left + this.track.offsetLeft;
    }
}

function createElement(className: string) {
    const element = document.createElement("div");
    element.className = className;
    return element;
}
