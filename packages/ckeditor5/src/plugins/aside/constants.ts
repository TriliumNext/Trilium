import type { PositionValue } from "../positioned_widgets.js";

/** Model element names of the aside. `aside` is the admonition's. */
export const ELEMENTS = {
    aside: "asideBlock",
    content: "asideContent"
} as const;

export const COMMANDS = {
    insert: "insertAside",
    remove: "removeAside",
    position: "asidePosition",
    color: "asideColor"
} as const;

/** Model attribute of the background color of an aside, saved as `background-color`. */
export const COLOR_ATTRIBUTE = "backgroundColor";
/** The background color of a new aside: Dim grey of the text editor palette. */
export const DEFAULT_COLOR = "#555555";

/** Editing-view class of the nested editable that holds the blocks of an aside. */
export const CONTENT_CLASS = "aside-content";
/** Custom property that marks the editing-view widget element of an aside. */
export const ASIDE_WIDGET_PROPERTY = "asideWidget";

/** The prefix of the custom property that saves the width of an aside, `--aside-width`. */
export const WIDTH_PROPERTY_PREFIX = "--aside";
/** The smallest width of an aside, in `em`. */
export const MIN_WIDTH = 8;
/** Where a new aside goes: at the right, with the text wrapped around it. */
export const DEFAULT_POSITION: PositionValue = "wrap-right";
