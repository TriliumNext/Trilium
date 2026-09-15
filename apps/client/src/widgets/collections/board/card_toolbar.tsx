import "./card_toolbar.css";

import clsx from "clsx";
import { type ComponentChildren, createContext } from "preact";
import { createPortal, useSyncExternalStore } from "preact/compat";
import { useCallback, useContext, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import OverlayControlGroup, { OverlayControlButton } from "../../react/OverlayControlGroup";

/**
 * How long the rail takes to slide off, which is how long whoever draws it keeps drawing it once it
 * is dismissed (see `useLingeringTrue`). Matches `--board-rail-exit-duration` in card_toolbar.css.
 */
export const RAIL_EXIT_MS = 400;

/**
 * Which rail stands on a board: one at a time, the latest to claim it. A rail arriving while
 * another stands takes over in place, neither sliding in over it nor waiting for it to slide off.
 * The one it replaces is hidden, and shown again once the newcomer has gone, unless it was on its
 * way off itself, in which case it is dropped for good (see {@link Rail}).
 */
export class RailStand {
    /** Every rail that stands, in the order they claimed the stand; the last one is shown. */
    private claimants: object[] = [];
    private listeners = new Set<() => void>();

    /** Whether any rail stands, one leaving included. */
    get isTaken() {
        return this.claimants.length > 0;
    }

    /** Whether a later rail stands over this one. */
    isSuperseded(token: object) {
        const index = this.claimants.indexOf(token);
        return index >= 0 && index < this.claimants.length - 1;
    }

    claim(token: object) {
        if (this.claimants.at(-1) === token) return;
        this.claimants = [ ...this.claimants.filter((other) => other !== token), token ];
        this.notify();
    }

    release(token: object) {
        if (!this.claimants.includes(token)) return;
        this.claimants = this.claimants.filter((other) => other !== token);
        this.notify();
    }

    subscribe(listener: () => void) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private notify() {
        for (const listener of [ ...this.listeners ]) {
            listener();
        }
    }
}

/** The board's stand, provided by the board so that two boards side by side keep their own. */
export const BoardRailContext = createContext(new RailStand());

interface CardToolbarProps {
    /** The board's element, which the toolbar floats over rather than the card it belongs to. */
    host: HTMLElement;
    /** Whether the rail is on its way off, sliding back over the edge it came from. */
    isLeaving: boolean;
    /** Whether the column places its cards itself, which leaves one place to insert at. */
    isSorted: boolean;
    /**
     * What taking the card away means: off the board, or the note deleted. A board with an inbox
     * keeps a card whose grouping value is cleared, so deleting the note is what takes it off.
     */
    removal: "board" | "note";
    onRename: () => void;
    onInsertAbove: () => void;
    onInsertBelow: () => void;
    /** Inserts at the foot of a sorted column, which places the card itself. */
    onInsertNew: () => void;
    onRemove: () => void;
    /** Opens the card's context menu, at the button. */
    onMore: (event: MouseEvent) => void;
    /** Reports focus leaving the toolbar, for the card to decide whether the toolbar stays. */
    onFocusOut: (event: FocusEvent) => void;
}

/**
 * What can be done with the focused card, on a rail flush with the board's trailing edge.
 *
 * Mobile only: a finger has no right button for the card's menu, and a tap opens the card. The rail
 * follows the focus, and is hidden while a card is carried (see card_toolbar.css).
 */
export default function CardToolbar({
    host, isLeaving, isSorted, removal, onRename, onInsertAbove, onInsertBelow, onInsertNew,
    onRemove, onMore, onFocusOut
}: CardToolbarProps) {
    return (
        <Rail host={host} isLeaving={isLeaving} onFocusOut={onFocusOut}>
            <OverlayControlButton
                title={t("board_view.edit-title")}
                icon="bx-rename"
                onClick={onRename}
            />
            {isSorted ? (
                <OverlayControlButton
                    title={t("board_view.insert-new")}
                    icon="bx-plus"
                    onClick={onInsertNew}
                />
            ) : (<>
                <OverlayControlButton
                    title={t("board_view.insert-above")}
                    icon="bx-list-plus"
                    // The list's plus sits at its foot, so the head is the glyph turned over.
                    className="bx-flip-vertical"
                    onClick={onInsertAbove}
                />
                <OverlayControlButton
                    title={t("board_view.insert-below")}
                    icon="bx-list-plus"
                    onClick={onInsertBelow}
                />
            </>)}
            {removal === "board" ? (
                <OverlayControlButton
                    title={t("board_view.remove-from-board")}
                    icon="bx-task-x"
                    className="board-remove-button"
                    onClick={onRemove}
                />
            ) : (
                <OverlayControlButton
                    title={t("board_view.delete-note")}
                    icon="bx-trash"
                    className="board-remove-button"
                    onClick={onRemove}
                />
            )}
            <OverlayControlButton
                title={t("board_view.more-actions")}
                icon="bx-dots-vertical-rounded"
                onClick={onMore}
            />
        </Rail>
    );
}

interface SelectionToolbarProps {
    host: HTMLElement;
    isLeaving: boolean;
    /** How many cards are picked out. With none, there is nothing to press. */
    count: number;
    onDelete: () => void;
    /** Opens the context menu for the selection, at the button. */
    onMore: (event: MouseEvent) => void;
}

/**
 * What can be done with the cards picked out in selection mode: deleting them, or opening the
 * menu for all of them. Stands in for the focused card's rail while the mode lasts.
 */
export function SelectionToolbar({
    host, isLeaving, count, onDelete, onMore
}: SelectionToolbarProps) {
    return (
        <Rail host={host} isLeaving={isLeaving}>
            <OverlayControlButton
                title={t("board_view.delete-note")}
                icon="bx-trash"
                className="board-remove-button"
                disabled={count === 0}
                onClick={onDelete}
            />
            <OverlayControlButton
                title={t("board_view.more-actions")}
                icon="bx-dots-vertical-rounded"
                disabled={count === 0}
                onClick={onMore}
            />
        </Rail>
    );
}

interface ColumnToolbarProps {
    host: HTMLElement;
    isLeaving: boolean;
    /** Whether the column is drawn as a strip, which offers nothing but to open it. */
    isCollapsed: boolean;
    onRename: () => void;
    onToggleCollapse: () => void;
    /** Opens the sort menu, which on mobile is a sheet at the foot of the screen. */
    onSort: (event: MouseEvent) => void;
    onFocusOut: (event: FocusEvent) => void;
}

/** What can be done with the focused column, on the same rail. The icons are the column menu's. */
export function ColumnToolbar({
    host, isLeaving, isCollapsed, onRename, onToggleCollapse, onSort, onFocusOut
}: ColumnToolbarProps) {
    return (
        <Rail host={host} isLeaving={isLeaving} onFocusOut={onFocusOut}>
            {!isCollapsed && (
                <OverlayControlButton
                    title={t("board_view.rename-column")}
                    icon="bx-edit-alt"
                    onClick={onRename}
                />
            )}
            <OverlayControlButton
                title={isCollapsed
                    ? t("board_view.expand-column")
                    : t("board_view.collapse-column")}
                icon={isCollapsed ? "bx-expand-horizontal" : "bx-collapse-horizontal"}
                onClick={onToggleCollapse}
            />
            {!isCollapsed && (
                <OverlayControlButton
                    title={t("board_view.sort")}
                    icon="bx-sort-alt-2"
                    onClick={onSort}
                />
            )}
        </Rail>
    );
}

interface RailProps {
    host: HTMLElement;
    isLeaving: boolean;
    onFocusOut?: (event: FocusEvent) => void;
    children: ComponentChildren;
}

/**
 * The rail itself, flush with the board's trailing edge; what stands on it is the caller's. It
 * slides in over that edge, and back out over it while `isLeaving` (see card_toolbar.css), unless
 * it takes over from another rail or another takes over from it (see {@link RailStand}).
 */
function Rail({ host, isLeaving, onFocusOut, children }: RailProps) {
    const stand = useContext(BoardRailContext);
    const token = useRef({}).current;
    // Decided as the rail arrives: whether it takes over in place rather than sliding in.
    const [ tookOver ] = useState(() => stand.isTaken);
    useEffect(() => {
        stand.claim(token);
        return () => stand.release(token);
    }, [ stand, token ]);
    const isSuperseded = useSyncExternalStore(
        useCallback((listener: () => void) => stand.subscribe(listener), [ stand ]),
        useCallback(() => stand.isSuperseded(token), [ stand, token ]));
    // A rail taken over from while on its way off has nothing to come back for: it gives the
    // stand up and stays gone, rather than reappearing to finish its slide once the newcomer goes.
    const isDropped = useRef(false);
    if (isLeaving && isSuperseded) {
        isDropped.current = true;
    }
    useEffect(() => {
        if (isDropped.current) {
            stand.release(token);
        }
    }, [ stand, token, isLeaving, isSuperseded ]);

    if (isDropped.current || isSuperseded) {
        return null;
    }

    return createPortal(
        <div
            className={clsx("board-card-toolbar", { leaving: isLeaving, "takes-over": tookOver })}
            // A press must not move the focus off the card, which would close the toolbar under
            // the finger, nor reach the board, which would take it for the start of a pan. Nor
            // the click: to the board, a click outside a card gives the selection up.
            onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            onFocusOut={onFocusOut}
        >
            <OverlayControlGroup placement="middle-end" vertical overCanvas>
                {children}
            </OverlayControlGroup>
        </div>,
        host
    );
}
