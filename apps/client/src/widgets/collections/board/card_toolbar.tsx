import "./card_toolbar.css";

import { t } from "../../../services/i18n";
import { OverlayControlButton } from "../../react/OverlayControlGroup";
import OverlayRail from "../../react/OverlayRail";

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
        <OverlayRail
            className="board-card-toolbar"
            host={host}
            isLeaving={isLeaving}
            onFocusOut={onFocusOut}
        >
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
                    className="tn-overlay-rail-destructive"
                    onClick={onRemove}
                />
            ) : (
                <OverlayControlButton
                    title={t("board_view.delete-note")}
                    icon="bx-trash"
                    className="tn-overlay-rail-destructive"
                    onClick={onRemove}
                />
            )}
            <OverlayControlButton
                title={t("board_view.more-actions")}
                icon="bx-dots-vertical-rounded"
                onClick={onMore}
            />
        </OverlayRail>
    );
}

interface SelectionToolbarProps {
    host: HTMLElement;
    isLeaving: boolean;
    /** How many cards are picked out. With none, there is nothing to press. */
    count: number;
    /** Deletes the cards picked out, which a read-only board does not offer. */
    onDelete?: () => void;
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
        <OverlayRail className="board-card-toolbar" host={host} isLeaving={isLeaving}>
            {onDelete && <OverlayControlButton
                title={t("board_view.delete-note")}
                icon="bx-trash"
                className="tn-overlay-rail-destructive"
                disabled={count === 0}
                onClick={onDelete}
            />}
            <OverlayControlButton
                title={t("board_view.more-actions")}
                icon="bx-dots-vertical-rounded"
                disabled={count === 0}
                onClick={onMore}
            />
        </OverlayRail>
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
        <OverlayRail
            className="board-card-toolbar"
            host={host}
            isLeaving={isLeaving}
            onFocusOut={onFocusOut}
        >
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
        </OverlayRail>
    );
}
