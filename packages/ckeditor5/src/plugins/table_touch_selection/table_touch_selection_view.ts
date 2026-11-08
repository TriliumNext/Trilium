import { type Locale, View } from "ckeditor5";

import { type ClientBox, isInsideBox } from "../viewport_geometry.js";

/** A corner of a box, by its physical sides. */
export interface Corner {
    x: "left" | "right";
    y: "top" | "bottom";
}

export const CORNERS: readonly Corner[] = [
    { x: "left", y: "top" },
    { x: "right", y: "top" },
    { x: "left", y: "bottom" },
    { x: "right", y: "bottom" }
];

/**
 * The overlay of `TableTouchSelection`: an outline around the cells and a handle at each corner
 * of the outline, clipped to the visible part of the table.
 */
export default class TableTouchSelectionView extends View<HTMLDivElement> {

    declare isVisible: boolean;
    declare isDragging: boolean;

    /** The handles, in the order of `CORNERS`. */
    readonly handles = CORNERS.map(() => createElement("ck-table-touch-selection__handle"));
    /** The visible part of the table, which clips the outline. */
    private readonly clip = createElement("ck-table-touch-selection__clip");
    private readonly outline = createElement("ck-table-touch-selection__outline");

    constructor(locale: Locale) {
        super(locale);

        const bind = this.bindTemplate;
        this.set({ isVisible: false, isDragging: false });
        this.clip.append(this.outline);

        this.setTemplate({
            tag: "div",
            attributes: {
                class: [
                    "ck",
                    "ck-table-touch-selection",
                    bind.if("isVisible", "ck-hidden", (isVisible) => !isVisible),
                    bind.if("isDragging", "ck-table-touch-selection_dragging")
                ],
                "aria-hidden": "true"
            },
            children: [this.clip, ...this.handles]
        });
    }

    /**
     * Draws the outline around `range` and the handles at its corners, in the viewport. Only the
     * part inside `visible` is drawn.
     */
    setRange(range: ClientBox, visible: ClientBox) {
        setBox(this.clip, visible);
        setBox(this.outline, {
            left: range.left - visible.left,
            top: range.top - visible.top,
            right: range.right - visible.left,
            bottom: range.bottom - visible.top
        });

        for (const [index, corner] of CORNERS.entries()) {
            const { x, y } = getCornerPoint(range, corner);
            const handle = this.handles[index];
            handle.classList.toggle("ck-hidden", !isInsideBox(x, y, visible));
            handle.style.left = `${x}px`;
            handle.style.top = `${y}px`;
        }
    }
}

/** The point of `box` at `corner`. */
export function getCornerPoint(box: ClientBox, corner: Corner) {
    return { x: box[corner.x], y: box[corner.y] };
}

function setBox(element: HTMLElement, box: ClientBox) {
    element.style.left = `${box.left}px`;
    element.style.top = `${box.top}px`;
    element.style.width = `${box.right - box.left}px`;
    element.style.height = `${box.bottom - box.top}px`;
}

function createElement(className: string) {
    const element = document.createElement("div");
    element.className = className;
    return element;
}
