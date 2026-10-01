import { createContext } from "preact";
import { useContext } from "preact/hooks";

import { handleRightToLeftPlacement } from "../../services/utils";

/*
 * What a `Menu` shares with its rows, apart from the menu itself so the rows `FormList` draws can
 * join one without `FormList` and `Menu` importing each other.
 */

/** A submenu standing open, and the row it opened from. */
export interface OpenSubmenu {
    /** The id of the row it opened from. */
    id: string;
    anchor: HTMLElement;
    /**
     * Shows the layer without the stylesheet's opening delay and fade: it replaces a submenu that
     * was open, or a key or a press chose it, so it is not a pointer passing over its row.
     */
    immediate: boolean;
}

/** A row as it registers with its menu, for the keys to find and act on. */
export interface RowEntry {
    level: number;
    element: HTMLElement;
    /** A custom row takes focus in itself instead of running anything. */
    custom: boolean;
    disabled: boolean;
    hasSubmenu: boolean;
    /** Runs the row, as a press or Enter does, once its submenu, if it has one, is open. */
    select(e: MouseEvent | KeyboardEvent): void;
}

/** The row the keyboard acts on, and the level it stands at. */
export interface ActiveRow {
    level: number;
    id: string;
}

/** What every row of a menu shares, at every level. */
export interface MenuContextValue {
    /** The submenu standing open at each level, the top level's first. */
    open: OpenSubmenu[];
    /**
     * Opens the submenu of the row `id` at `level`, closing whatever stood open at that level and
     * deeper, or without a row only closes them.
     */
    openSubmenu(level: number, id?: string, anchor?: HTMLElement, chosen?: boolean): void;
    active?: ActiveRow;
    setActive(level: number, id: string): void;
    /** The rows by id, as they registered. */
    rows: Map<string, RowEntry>;
    /** Registers a row as it mounts, and with `undefined` takes it back as it unmounts. */
    registerRow(id: string, row: RowEntry | undefined): void;
    /** Whether the keys moved the menu since the pointer last did. */
    keyboardDriven: boolean;
    /**
     * Whether the submenus of each level's rows open towards the start, indexed by level. The rows
     * of a level that does carry `.dropstart`, which points their arrow that way.
     */
    dropStart: boolean[];
    /** Records the side the submenus of `level`'s rows open on. */
    setDropStart(level: number, dropStart: boolean): void;
    close(): void;
    /**
     * Where a row renders its submenu's layer: the top level's element, so the rules scoped to the
     * menu apply, but outside its scroller and any other layer, as a fixed layer escapes a
     * scrolling menu only while no ancestor carries a filter.
     */
    layerHost: HTMLElement | null;
}

export const MenuContext = createContext<MenuContextValue | null>(null);
/** How deep the rows rendered here stand: 0 at the top level, 1 in its submenus, and so on. */
export const MenuLevelContext = createContext(0);

/** The menu a row stands in, for a row that works only inside one. */
export function useMenu() {
    const menu = useContext(MenuContext);
    if (!menu) throw new Error("A menu row must be rendered inside a Menu.");
    return menu;
}

/**
 * Whether the submenus of a level's rows open towards the start, given `frame`, the level's menu
 * or layer. They open towards the side `preferStart` names, which is where the level itself opened,
 * unless that side has less room than `frame` is wide and the other side has more.
 */
export function shouldDropStart(frame: Pick<DOMRect, "left" | "right" | "width">, viewportWidth: number, rtl: boolean, preferStart: boolean) {
    const roomAtEnd = rtl ? frame.left : viewportWidth - frame.right;
    const roomAtStart = rtl ? viewportWidth - frame.right : frame.left;
    const [ preferred, other ] = preferStart ? [ roomAtStart, roomAtEnd ] : [ roomAtEnd, roomAtStart ];
    return preferred < frame.width && other > preferred ? !preferStart : preferStart;
}

/** Whether the page is right to left, which makes a menu's end side its left. */
export function isRightToLeft() {
    return handleRightToLeftPlacement("right") !== "right";
}

/**
 * Whether the pointer really moved. A menu appearing under a pointer at rest has the browser enter
 * the row there, and Chromium follow with a `pointermove` that goes nowhere; neither is the user
 * turning to the pointer.
 */
export function pointerMoved(e: PointerEvent) {
    return e.movementX !== 0 || e.movementY !== 0;
}
