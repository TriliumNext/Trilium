import clsx from "clsx";
import { Fragment } from "preact";
import { flushSync } from "preact/compat";
import {
    useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState
} from "preact/hooks";
import { JSX } from "preact/jsx-runtime";

import FBranch from "../../../entities/fbranch";
import FNote from "../../../entities/fnote";
import { ContextMenuEvent } from "../../../menus/context_menu";
import branches from "../../../services/branches";
import dialog from "../../../services/dialog";
import { getHue, parseColor } from "../../../services/css_class_manager";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import { DragData, TREE_CLIPBOARD_TYPE } from "../../note_tree";
import ActionButton from "../../react/ActionButton";
import Icon from "../../react/Icon";
import { IconPickerButton } from "../../react/IconPicker";
import { useStaticTooltip } from "../../react/hooks";
import { useFlip } from "../../react/flip";
import { useScrollFade } from "../../react/scroll_fade";

/** How long a field waits for the card it made, after which it is taken down regardless. */
const HAND_OVER_MS = 2000;

/** What a gap stands at when nothing carried says otherwise. Matches `.board-drop-placeholder`. */
const STOCK_GAP_HEIGHT = 40;

/**
 * The least a card can stand, which is one line of its title with the padding and gap around it.
 *
 * Says how many cards a column can show at once, which is how many below the gap have to move.
 */
const MIN_CARD_HEIGHT = 32;

/** How long an open takes. Matches `--board-expand-duration` in the board's own rules. */
export const EXPAND_MS = 200;
import NoteLink from "../../react/NoteLink";
import { BoardActionsContext, BoardDragStateContext, TitleEditor } from ".";
import BoardApi from "./api";
import Card from "./card";
import CardTemplatePill from "./card_template_pill";
import { type CardTemplates } from "./card_templates";
import { DEFAULT_CARD_ICON, DEFAULT_COLUMN_ICON, INBOX_COLUMN } from "./columns";
import { openColumnContextMenu, openColumnSortMenu, openCreateCardMenu } from "./context_menu";
import type { ColumnSort } from "./data";
import { cardSpacing } from "./drag_measure";
import {
    REVEAL_CARD, type RevealCardDetail, useColumnWindow, WINDOW_THRESHOLD
} from "./windowing";
import { BoardDropStateContext, useDropIndex, useIsDropTarget } from "./drop_state";

interface DragContext {
    column: string;
    columnIndex: number,
    columnItems?: { note: FNote, branch: FBranch }[];
    /** Whether this is the column just added, which is revealed on arrival. */
    isNew?: boolean;
}

export default function Column({
    column,
    columnIndex,
    columns,
    onMoveColumn,
    onFocusColumn,
    onFocusCard,
    icon,
    color,
    archived,
    collapsed,
    keepCollapsed,
    isActive,
    isPeeked,
    isResizing,
    standsAside,
    nested,
    limit,
    columnItems,
    totalCount,
    isNew,
    cardTemplates,
    sort,
    landedNoteId,
    api,
    parentNote,
    isInRelationMode
}: {
    columnItems?: { note: FNote, branch: FBranch }[];
    /** The stored icon class, absent until one is picked. Unused in relation mode. */
    icon?: string,
    /** The stored CSS colour, absent until one is picked. */
    color?: string,
    /** Whether the column is archived. Only ever rendered while archived notes are shown. */
    archived?: boolean,
    /** Whether the column is stored as collapsed. A drag opening it does not clear this. */
    collapsed?: boolean,
    /** Whether the column collapses again once opened, which keeps `collapsed` through an open. */
    keepCollapsed?: boolean,
    /** Whether this is the column the reader is working in, which opens it while it is collapsed. */
    isActive?: boolean,
    /** Whether the board is showing every collapsed column at once, which opens this one too. */
    isPeeked?: boolean,
    /** Whether a column is still taking its new width, during which no column's cards move. */
    isResizing?: boolean,
    /**
     * How far the column stands aside for one being carried, in pixels.
     *
     * The row keeps its order for the length of the gesture, so a step costs a transform per
     * column rather than a fresh layout of every card on the board.
     */
    standsAside?: number,
    /** What a new card is made from, and how the reader picks something else. */
    cardTemplates: CardTemplates,
    /** Whether the inbox also collects notes deeper than the board's direct children. */
    nested?: boolean,
    /** The note limit, absent if disabled. */
    limit?: number,
    /**
     * How the column orders its cards, absent for the manual order. A sorted column opens no drop
     * gap and offers no control that puts a card at a chosen index.
     */
    sort?: ColumnSort,
    /** The card just dropped here, drawn with the `appearing` reveal. */
    landedNoteId?: string,
    /**
     * How many cards the column really holds, when an active filter leaves `columnItems` with
     * fewer. The badge counts what is shown; the limit is about the real column.
     */
    totalCount?: number,
    api: BoardApi,
    parentNote: FNote,
    isInRelationMode: boolean,
    /** The columns as drawn, which is what the menu offers to place this one among. */
    columns: string[],
    /** Moves a column to sit before the given position, as a drag onto that position would. */
    onMoveColumn: (fromIndex: number, toIndex: number) => void,
    onFocusColumn: (column: string) => void,
    onFocusCard: (noteId: string) => void
} & DragContext) {
    const isSorted = !!sort;
    const [ isCreatingNewItem, setIsCreatingNewItem ] = useState(false);
    /**
     * The card a field standing among the cards makes its own above, absent while no such field is
     * open and empty for one standing below the last card.
     *
     * The card below the field rather than the one above it, so the field keeps its place as it
     * makes cards: each one is drawn above the field, and a run of them stands in the order it was
     * typed. Named by the card above instead, the field would be carried down past every card it
     * made, and moving the element it is typed in takes focus out of it.
     */
    const [ insertBefore, setInsertBefore ] = useState<{ branchId?: string }>();
    /**
     * The cards as last drawn, for the callback that opens a field among them. Read through a ref
     * so that callback keeps one identity: rebuilt per refresh, it would be a new prop on every
     * card and no card could be left undrawn.
     */
    const itemsRef = useRef(columnItems);
    itemsRef.current = columnItems;
    // A ref for the same reason: `beginInsert` below keeps one identity.
    const isSortedRef = useRef(isSorted);
    isSortedRef.current = isSorted;
    /** Opens the field at a place among the cards, which is the index the card it makes takes. */
    const beginInsert = useCallback((index: number) => {
        // A sorted column has no index to insert at.
        if (isSortedRef.current) {
            return;
        }

        setInsertBefore({ branchId: itemsRef.current?.[index]?.branch.branchId });
    }, []);
    /** Opens the field at the foot of the column, which its button and its menu also open. */
    const beginNewItem = useCallback(() => setIsCreatingNewItem(true), []);
    /** The card the footer just made, which is revealed and scrolled to as it is drawn. */
    const [ createdNoteId, setCreatedNoteId ] = useState<string>();
    /**
     * The card a field standing among the others just made, which takes the field's place.
     *
     * The field stands where the card goes until the board has drawn it, so the card fades in
     * where the field was rather than opening out of a gap the column has to make for it.
     */
    const [ insertedNoteId, setInsertedNoteId ] = useState<string>();
    const cardInserted = useCallback((noteId: string | undefined) => {
        setInsertedNoteId(noteId);
        setCreatedNoteId(noteId);
    }, []);
    // `isNew` stays true until another column is added, so the reveal is recorded here rather than
    // replayed on every redraw of the board.
    const [ isRevealed, setIsRevealed ] = useState(false);
    const { setColumnNameToEdit, setColumnLimitToEdit, setActiveColumn, setInsertingColumn } =
        useContext(BoardActionsContext);
    const { branchIdToEdit, columnNameToEdit, draggedCard, draggedColumn } =
        useContext(BoardDragStateContext);
    // Every card on the move. The one under the pointer is taken out of the flow by the gesture
    // itself; the rest of a carried selection stay where they are drawn and are dimmed instead.
    const carriedNoteIds = draggedCard
        ? new Set(draggedCard.noteIds ?? [ draggedCard.noteId ])
        : null;
    // Asked about this column alone: where the gap stands changes on every step of a drag, and a
    // column that the answer does not concern is left as it is rather than drawn again.
    const standingDropIndex = useDropIndex(column);
    // A sorted column draws only its border, since `sortColumnMap` decides where the card lands.
    // The source column keeps the gap at the lifted card's own index, or the cards below close up
    // for the length of the gesture. A gap stands before the card it indexes, hence the `+ 1`.
    const dropIndex = !isSorted
        ? standingDropIndex
        : (draggedCard?.fromColumn === column ? draggedCard.index + 1 : null);
    const isDropTarget = useIsDropTarget(column);
    const isEditing = (columnNameToEdit === column);
    const editorRef = useRef<HTMLInputElement>(null);
    const headerRef = useRef<HTMLHeadingElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const scrollFade = useScrollFade(contentRef);
    const noteIds = useMemo(
        () => (columnItems ?? []).map(({ note }) => note.noteId), [ columnItems ]);
    // A column of thousands draws only what the reader can see. Left off below the threshold, so
    // an ordinary board keeps the code path it has always had.
    const isWindowed = noteIds.length > WINDOW_THRESHOLD;
    const { bounds, windowChanged, scrollToCard } = useColumnWindow(contentRef, noteIds, isWindowed);
    const shownItems = isWindowed
        ? (columnItems ?? []).slice(bounds.from, bounds.until)
        : (columnItems ?? []);
    // Cards slide to follow the drop gap opening and closing. Measured only when the column's own
    // cards have changed: reading one position costs a layout of the whole board, and anything
    // else that redraws it would have every column read one per card.
    const measured = useRef<unknown>();
    const cardsChanged = measured.current !== columnItems;
    measured.current = columnItems;
    useFlip(contentRef, {
        selector: ".board-note",
        // Paused where nothing has moved the cards, so the places it knows are still good.
        paused: !cardsChanged,
        // Off for the length of a gesture, so the commit that ends one records where the cards
        // landed rather than sliding them there. A window that has just swapped its cards is the
        // same case: the places recorded before it name cards that are no longer drawn, and
        // sliding from them would animate a scroll as though the column had been reordered.
        disabled: !!draggedCard || !!draggedColumn || !!isResizing || windowChanged
    });

    const windowFrom = isWindowed ? bounds.from : 0;
    // The gap is a standing element that slides, and the cards beside it are transformed: putting
    // one among the cards, or taking one out, restyles every element the board holds.
    const gapRef = useRef<HTMLDivElement>(null);
    const roomRef = useRef<HTMLDivElement>(null);
    /** Whether a card was being carried at the previous commit. */
    const carried = useRef(false);
    /** Which cards were last told to stand aside, so only what changed is written. */
    const aside = useRef({ from: 0, until: 0, room: 0 });
    useLayoutEffect(() => {
        // The commits a drag opens and closes on, where a card is already standing where it is
        // being drawn. Every commit in between moves the cards for real and eases as usual.
        const atOnce = carried.current !== !!draggedCard;
        carried.current = !!draggedCard;

        const area = contentRef.current;
        const gap = gapRef.current;
        if (!area || !gap) return;

        const cards = area.querySelectorAll<HTMLElement>(".board-note");
        const height = draggedCard?.height ?? STOCK_GAP_HEIGHT;
        const room = dropIndex === null ? 0 : height + cardSpacing();
        // Read with the places below, before anything is written: every card the column can show
        // moves, and the ones past its foot are left alone whatever it holds.
        const reach = Math.ceil(area.clientHeight / MIN_CARD_HEIGHT) + 1;

        // A windowed column draws a slice of its cards, so a place in the column has to be read
        // as a place among the ones drawn before it can name an element.
        const placeOf = (index: number) => index - windowFrom;

        // Read before anything is written, and `offsetTop` is no business of a transform anyway.
        if (dropIndex !== null) {
            const standing = cards[placeOf(dropIndex)];
            // `lift()` sets `display: none` on the carried card, so a gap past the last one
            // measures against the last card still laid out.
            const drawn = [ ...cards ].filter(card => card.style.display !== "none");
            const last = drawn[drawn.length - 1];
            const top = standing
                ? standing.offsetTop
                // Above the window, place the gap at the first rendered card; below it, after
                // the last.
                : (placeOf(dropIndex) < 0
                    ? (cards[0]?.offsetTop ?? 0)
                    : (last ? last.offsetTop + last.offsetHeight + cardSpacing() : 0));
            gap.style.transform = `translateY(${top}px)`;
            gap.style.height = `${height}px`;
        }
        gap.classList.toggle("show", dropIndex !== null);
        roomRef.current?.style.setProperty("height", `${room}px`);

        // Once the gap is gone, every card is put back, whichever ones they now are: a drop
        // reorders the column, so the places that stood aside no longer name the same cards.
        if (dropIndex === null) {
            for (const card of cards) {
                if (card.style.transform) {
                    placeCard(card, null, atOnce);
                }
            }
            aside.current = { from: 0, until: 0, room: 0 };
            return;
        }

        const from = Math.max(0, placeOf(dropIndex));
        const until = Math.min(cards.length, from + reach);
        const last = aside.current;
        // A step of a drag moves the gap by a card, so only the few cards it passed change what
        // they are told; the rest of the window is already standing where it should.
        const afresh = last.room !== room;
        for (let index = last.from; index < last.until; index++) {
            if (afresh || index < from || index >= until) {
                const card = cards[index];
                if (card) {
                    placeCard(card, null, atOnce);
                }
            }
        }
        for (let index = from; index < until; index++) {
            if (afresh || index < last.from || index >= last.until) {
                placeCard(cards[index], `translateY(${room}px)`, atOnce);
            }
        }
        aside.current = { from, until, room };
    }, [ dropIndex, draggedCard, columnItems, windowFrom ]);
    const { handleDragOver, handleDragLeave, handleDrop } = useDragging({
        column, columnIndex, columnItems, isEditing, api, parentNote, onLanded: setCreatedNoteId
    });

    // Read here rather than in the badge: the column body shows an outline as well.
    const isOverLimit = limit !== undefined && (totalCount ?? columnItems?.length ?? 0) > limit;
    const isCollapsed = !!collapsed && !isActive && !isPeeked;
    // A column opened to take a dragged card takes its width at once, and its cards with it.
    const opensAtOnce = !!draggedCard || isDropTarget;

    /**
     * Whether the column is still widening, during which its cards are left unpainted.
     *
     * They are laid out again on every frame of the widening, their titles rewrapping as the
     * column grows, which is what the reader would otherwise watch. Read during the render that
     * opens the column, so there is no frame where they are painted into a narrow one.
     *
     * Unpainted rather than undrawn: the board focuses the card a keyboard open steps onto, and a
     * card that is not there yet is one it cannot hand focus to.
     */
    /**
     * Whether the cards have been drawn, which they stay once they have been.
     *
     * A column collapsed when the board opens draws none of them; past the first open they are
     * hidden rather than taken out, which is what makes closing one cheap.
     */
    const [ isDrawn, setIsDrawn ] = useState(!isCollapsed);
    if (!isDrawn && !isCollapsed) {
        setIsDrawn(true);
    }

    const [ isExpanding, setIsExpanding ] = useState(false);
    const [ wasCollapsed, setWasCollapsed ] = useState(isCollapsed);
    if (wasCollapsed !== isCollapsed) {
        setWasCollapsed(isCollapsed);
        setIsExpanding(!isCollapsed && !opensAtOnce);
    }

    useEffect(() => {
        if (!isExpanding) {
            return;
        }

        const timer = window.setTimeout(() => setIsExpanding(false), EXPAND_MS);
        return () => window.clearTimeout(timer);
    }, [ isExpanding ]);

    // Only while the column is open: the strip's own press opens it, which is what it says
    // instead. Memoised because `useStaticTooltip` rebuilds the tooltip on a new config.
    const headerTooltip = useMemo(
        () => ({ title: isCollapsed ? "" : t("board_view.collapse-hint") }), [ isCollapsed ]);
    useStaticTooltip(headerRef, headerTooltip);

    // Reported on the way in only. A column opened by being selected closes when another one is
    // selected, so nothing here watches for focus leaving: the menu, the icon picker and the limit
    // dialog all render outside the column, and each would otherwise close it as it opened.
    const select = useCallback(() => {
        setActiveColumn(column);

        // Opening the strip by hand opens the column for good, unless `keepCollapsed` says it
        // closes again. A column opened by a card dragged over it goes through `setActiveColumn`
        // instead, so it keeps the flag.
        if (isCollapsed && !keepCollapsed) {
            api.setColumnCollapsed(column, false);
        }
    }, [ api, column, isCollapsed, keepCollapsed, setActiveColumn ]);

    /**
     * Whether the collapse now being drawn is one the reader asked for, which runs faster than a
     * peek closing: only the peek closes behind the pointer, with the board shifting under it.
     */
    const [ isCollapsingByHand, setIsCollapsingByHand ] = useState(false);

    /** Collapses the column, closing the open one so that the change is drawn straight away. */
    const collapse = useCallback(() => {
        setIsCollapsingByHand(true);
        api.setColumnCollapsed(column, true);
        setActiveColumn(undefined);
    }, [ api, column, setActiveColumn ]);

    /**
     * Whether the header was a strip when the press began.
     *
     * The first click of a double click on a strip already opens the column, so by the time
     * `dblclick` arrives the header is a heading and collapsing it again would undo the open. Only
     * the press that starts a sequence is recorded, which `detail` counts.
     */
    const wasCollapsedOnPress = useRef(false);

    // Focus reaching a column closes whichever one was open, and opens nothing: a collapsed column
    // is walked onto without being disturbed, and is opened by a click or by Space instead.
    const handleFocusIn = useCallback(() => {
        if (isActive) {
            return;
        }

        // While the whole board is peeked, focus arriving settles the peek on this column rather
        // than closing every column: the reader has just gone to work in this one, and a press on
        // one of its cards is focus arriving before it is a click.
        setActiveColumn(isPeeked ? column : undefined);
    }, [ column, isActive, isPeeked, setActiveColumn ]);

    // Only for a sorted column. The arrow shows which way the order runs.
    const sortButton = sort && (
        <ActionButton
            className="column-sort"
            icon={sort.isDescending ? "bx bx-sort-down" : "bx bx-sort-up"}
            text={t("board_view.sort")}
            // Disabled on a strip: the menu would open over the space the column is about to
            // take as it widens.
            disabled={isCollapsed}
            onClick={(e) => {
                // The heading is the column's drag handle and opens its own menu on a right
                // click; neither should also fire from the button.
                e.stopPropagation();
                openColumnSortMenu(api, ...menuOrigin(e), column);
            }}
        />
    );

    const openMenu = useCallback((e: ContextMenuEvent) => {
        openColumnContextMenu(api, e, {
            value: column,
            columns,
            index: columnIndex,
            color,
            archived,
            collapsed,
            canRename: !isCollapsed,
            isCollapsed,
            keepCollapsed,
            nested,
            onEditTitle: () => setColumnNameToEdit(column),
            onNewItem: beginNewItem,
            onAddColumn: async (direction) => {
                setColumnNameToEdit(await api.insertColumn(column, direction));
            },
            onSetLimit: () => setColumnLimitToEdit(column),
            onCollapse: collapse,
            onKeepCollapsed: (keep) => {
                setIsCollapsingByHand(keep);
                api.setColumnKeepCollapsed(column, keep, !isCollapsed);
                // Turning it on collapses the column as well, so the open one is closed here for
                // the same reason `collapse` closes it.
                if (keep) {
                    setActiveColumn(undefined);
                }
            },
            onMoveColumn: (toIndex) => {
                onMoveColumn(columnIndex, toIndex);
                // Asked for by name: the move draws the board again, and the heading the menu was
                // opened from is the one left standing over another column afterwards.
                onFocusColumn(column);
            }
        });
    }, [
        api, column, color, archived, collapsed, keepCollapsed, collapse, isCollapsed, nested,
        columns, columnIndex, setColumnNameToEdit, setColumnLimitToEdit, setActiveColumn,
        onMoveColumn, onFocusColumn
    ]);

    // A fully desaturated colour has no hue to tint with, and leaves the column plain.
    const hue = useMemo(() => {
        const parsed = color ? parseColor(color) : undefined;
        return parsed ? getHue(parsed) : undefined;
    }, [ color ]);

    const handleTitleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "F2" && !isCollapsed) {
            setColumnNameToEdit(column);
        }
    }, [ column, isCollapsed ]);

    /** Allow using mouse wheel to scroll inside card, while also maintaining column horizontal scrolling. */
    const handleScroll = useCallback((event: JSX.TargetedWheelEvent<HTMLDivElement>) => {
        const el = event.currentTarget;
        if (!el) return;

        const needsScroll = el.scrollHeight > el.clientHeight;
        if (needsScroll) {
            event.stopPropagation();
        }
    }, []);

    useEffect(() => {
        if (!isCollapsed) {
            setIsCollapsingByHand(false);
        }
    }, [ isCollapsed ]);

    useEffect(() => {
        editorRef.current?.focus();
    }, [ isEditing ]);

    // The field is taken down only once the card it made stands in its place, so the column does
    // not close the gap the field held and open it again for the card.
    useEffect(() => {
        if (!insertedNoteId) {
            return;
        }

        const close = () => {
            setInsertBefore(undefined);
            setInsertedNoteId(undefined);
        };

        if (columnItems?.some(({ note }) => note.noteId === insertedNoteId)) {
            close();
            return;
        }

        // A card can be drawn in another column, which one made from a template carrying a value
        // of its own is, so the field is not left standing for a card that never arrives here.
        const timer = window.setTimeout(close, HAND_OVER_MS);
        return () => window.clearTimeout(timer);
    }, [ insertedNoteId, columnItems ]);

    // A card created at the foot of a long column falls outside the window, so the card's own
    // scroll effect never runs. Scroll to it here, which renders it.
    const arrived = createdNoteId ?? landedNoteId;
    useEffect(() => {
        if (!isWindowed || !arrived) return;

        const index = noteIds.indexOf(arrived);
        if (index >= 0 && (index < bounds.from || index >= bounds.until)) {
            scrollToCard(index);
        }
    }, [ arrived, isWindowed, noteIds, bounds.from, bounds.until, scrollToCard ]);

    // The keyboard can walk onto a card the window leaves undrawn, which cannot be focused until
    // it is in the page.
    useEffect(() => {
        const board = contentRef.current?.closest<HTMLElement>(".board-view-container");
        if (!board || !isWindowed) return;

        const reveal = (event: Event) => {
            const { detail } = event as CustomEvent<RevealCardDetail>;
            if (detail.column === column) {
                scrollToCard(detail.index, detail.immediate);
            }
        };

        board.addEventListener(REVEAL_CARD, reveal);
        return () => board.removeEventListener(REVEAL_CARD, reveal);
    }, [ column, isWindowed, scrollToCard ]);

    // The board raises its backdrop for any open field, and each column holds its own.
    useEffect(() => {
        setInsertingColumn(column, !!insertBefore);
        return () => setInsertingColumn(column, false);
    }, [ column, insertBefore, setInsertingColumn ]);

    // Whether the title being edited is one of this column's, which lifts the mask below.
    const hasEditedCard = !!branchIdToEdit
        && !!columnItems?.some(({ branch }) => branch.branchId === branchIdToEdit);

    // The field a card is inserted in, drawn where the reader asked for the card. The same field
    // as the one below the column, so a card is made the same way wherever it goes.
    const insertField = insertBefore && (
        <AddNewItem
            api={api}
            cardTemplates={cardTemplates}
            column={column}
            insert={{
                before: insertBefore.branchId,
                close: () => setInsertBefore(undefined)
            }}
            onCreated={cardInserted}
        />
    );

    return (
        <div
            data-column={column}
            // Read by the drag, which offers neither end of a column that places its own cards.
            data-sorted={isSorted ? "true" : undefined}
            // Also read by the drag, for placing a card at the column's foot. On the column rather
            // than on the card area below, which a collapsed column does not draw at all.
            data-count={noteIds.length}
            className={clsx("board-column", {
                "drag-over": isDropTarget && (isSorted || draggedCard?.fromColumn !== column),
                // The class the themes key a hue off, worn here as anywhere else that carries one.
                "with-hue": hue !== undefined,
                "board-column-archived": archived,
                "editing-open": hasEditedCard || !!insertBefore,
                windowed: isWindowed,
                "over-limit": isOverLimit,
                collapsed: isCollapsed,
                "quick-collapse": isCollapsingByHand,
                // Opening is drawn for the reader who asked for it. A column opened to take a
                // dragged card takes its width at once, since the drop is measured as it opens.
                "quick-expand": !isCollapsed && !opensAtOnce,
                expanding: isExpanding,
                appearing: isNew && !isRevealed
            })}
            onAnimationEnd={(e) => {
                if (e.animationName === "board-item-appear") {
                    setIsRevealed(true);
                }
            }}
            onFocusIn={handleFocusIn}
            // A click and not a press: a press may be the start of a drag, which must leave the
            // column as it is, and a drag produces no click.
            onClick={select}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
                "--board-column-custom-hue": hue,
                transform: standsAside ? `translateX(${standsAside}px)` : undefined
            }}
        >
            <h3
                ref={headerRef}
                className={`${isEditing ? "editing" : ""}`}
                // While collapsed the header is what opens the column, so it says so and answers
                // for the keys a button answers for. Open, it is a heading again and Space does
                // nothing, so neither is claimed.
                role={isCollapsed ? "button" : undefined}
                aria-expanded={isCollapsed ? false : undefined}
                onContextMenu={openMenu}
                onMouseDown={(e) => {
                    if (e.detail <= 1) {
                        wasCollapsedOnPress.current = isCollapsed;
                    }
                }}
                onDblClick={() => {
                    if (!wasCollapsedOnPress.current) {
                        collapse();
                    }
                }}
                onKeyDown={handleTitleKeyDown}
                tabIndex={300}
            >
                {isCollapsed ? (
                    <>
                        <ActionButton
                            className="column-menu"
                            icon="bx bx-dots-vertical-rounded"
                            text={t("board_view.column-menu")}
                            onClick={(e) => {
                                e.stopPropagation();
                                openMenu(e);
                            }}
                        />
                        <CountBadge items={columnItems} limit={limit} isOver={isOverLimit} />
                        {sortButton}
                        <span className="title">
                            {isInRelationMode
                                ? <NoteLink notePath={column} />
                                : api.getColumnTitle(column)}
                        </span>
                        <Icon
                            className="column-icon"
                            icon={api.getColumnIcon(column) ?? DEFAULT_COLUMN_ICON}
                        />
                    </>
                ) : (<>
                {/* In relation mode the column is a note, and NoteLink already shows that note's
                    own icon, which is not the board's to change. */}
                {!isInRelationMode && (
                    <IconPickerButton
                        className="column-icon"
                        icon={api.getColumnIcon(column) ?? DEFAULT_COLUMN_ICON}
                        title={t("board_view.change-column-icon")}
                        onSelect={(picked) => api.setColumnIcon(column, picked)}
                        onReset={icon ? () => api.setColumnIcon(column, undefined) : undefined}
                    />
                )}

                {!isEditing ? (
                    <>
                        <span className="title">
                            {isInRelationMode
                                ? <NoteLink notePath={column} showNoteIcon />
                                : api.getColumnTitle(column)}
                        </span>
                        <div className="spacer" />
                        {sortButton}
                        <CountBadge items={columnItems} limit={limit} isOver={isOverLimit} />
                        <ActionButton
                            className="column-menu"
                            icon="bx bx-dots-vertical-rounded"
                            text={t("board_view.column-menu")}
                            onClick={(e) => {
                                // The header is the column's drag handle and opens this same menu
                                // on a right click; neither should also fire from the button.
                                e.stopPropagation();
                                openMenu(e);
                            }}
                        />
                    </>
                ) : (
                    <TitleEditor
                        currentValue={api.getColumnTitle(column)}
                        save={newTitle => api.setColumnTitle(column, newTitle)}
                        dismiss={() => setColumnNameToEdit(undefined)}
                        // The inbox is renamed as text even on a relation board, where every
                        // other column is renamed by picking a note.
                        mode={isInRelationMode && column !== INBOX_COLUMN ? "relation" : "normal"}
                    />
                )}
                </>)}
            </h3>

            {isDrawn && <div
                ref={contentRef}
                className={clsx("board-column-content", scrollFade.className)}
                style={scrollFade.style}
                onWheel={handleScroll}
                data-window-from={isWindowed ? windowFrom : undefined}
                data-window-count={isWindowed ? noteIds.length : undefined}
            >
                <div className="board-window-spacer" style={{ height: `${bounds.above}px` }} />
                {shownItems.map(({ note, branch }, offset) => (
                    <Fragment key={note.noteId}>
                        {insertBefore?.branchId === branch.branchId && insertField}
                        <Card
                            api={api}
                            note={note}
                            branch={branch}
                            column={column}
                            index={bounds.from + offset}
                            statusAttribute={api.statusAttribute}
                            isNew={note.noteId === createdNoteId
                                || note.noteId === landedNoteId}
                            focusOnArrival={note.noteId === insertedNoteId}
                            isDragging={!!carriedNoteIds?.has(note.noteId)}
                            isEditing={branch.branchId === branchIdToEdit}
                            onFocusCard={onFocusCard}
                            onInsert={beginInsert}
                            onNewItem={beginNewItem}
                        />
                    </Fragment>
                ))}
                <div className="board-window-spacer" style={{ height: `${bounds.below}px` }} />
                {insertBefore && !insertBefore.branchId && insertField}
                {/* Both stand here for the length of the board's life: an element appearing
                    among the cards, or leaving them, is what a drag cannot afford. */}
                <div ref={gapRef} className="board-drop-placeholder">
                    {/* The gap is the one the lifted card left, and it does not follow the
                        pointer. */}
                    {isSorted && (
                        <span className="sorted-no-reorder">
                            {t("board_view.sorted-no-reorder")}
                        </span>
                    )}
                </div>
                <div ref={roomRef} className="board-drop-room" />
            </div>}

            {!isCollapsed && <AddNewItem
                api={api}
                cardTemplates={cardTemplates}
                column={column}
                isSorted={isSorted}
                isCreating={isCreatingNewItem}
                setIsCreating={setIsCreatingNewItem}
                onCreated={setCreatedNoteId}
            />}
        </div>
    );
}

/**
 * Puts a card where a transform says, easing it there unless the board is drawing a still frame.
 *
 * Suppressed on the card rather than by a rule under the board's own class, which would match
 * every card on it.
 *
 * @param transform what to write, or `null` to put the card back where the column draws it.
 * @param atOnce whether the card is already standing where it is being put, as at a lift or a drop.
 */
/**
 * Where a menu opened from a button stands: at the pointer for a press, and below the button for a
 * keyboard, which reports no position of its own.
 */
function menuOrigin(e: JSX.TargetedMouseEvent<HTMLElement>): [ number, number ] {
    if (e.detail) {
        return [ e.pageX, e.pageY ];
    }

    const box = e.currentTarget.getBoundingClientRect();
    return [ box.right + window.scrollX, box.bottom + window.scrollY ];
}

export function placeCard(card: HTMLElement, transform: string | null, atOnce: boolean) {
    if (atOnce) {
        card.style.transition = "none";
        settling.add(card);
    }

    if (transform === null) {
        card.style.removeProperty("transform");
    } else {
        card.style.transform = transform;
    }

    if (!atOnce) {
        return;
    }

    // Started afresh on every call: a lift and the drop that follows it a frame later would
    // otherwise be put back on the first one's schedule, before the drop has been drawn.
    if (restoring !== undefined) {
        cancelAnimationFrame(restoring);
    }

    // Put back a frame later than the one that draws them, since a frame's callbacks run before
    // the styles it paints are worked out.
    restoring = requestAnimationFrame(() => {
        restoring = requestAnimationFrame(() => {
            restoring = undefined;
            for (const held of settling) {
                held.style.removeProperty("transition");
            }
            settling.clear();
        });
    });
}

/**
 * Puts back at once the suppressed transitions of the cards one board holds, for a board leaving
 * the page.
 *
 * Its own cards alone, and whatever has already left the page: another board can be part-way
 * through a gesture, and the frame that would put its cards back is the same one.
 */
export function settleCards(container: HTMLElement | null) {
    for (const held of settling) {
        if (held.isConnected && !container?.contains(held)) {
            continue;
        }

        held.style.removeProperty("transition");
        settling.delete(held);
    }

    if (!settling.size && restoring !== undefined) {
        cancelAnimationFrame(restoring);
        restoring = undefined;
    }
}

/** The cards whose transition is suppressed, waiting for the frame that puts it back. */
const settling = new Set<HTMLElement>();
let restoring: number | undefined;

/**
 * The editor a new card is named in, standing below the column or between two of its cards.
 *
 * Below the column it is opened by the button it replaces or by the column's menu, so that state
 * is the column's rather than this component's: the menu is raised from the header. Between two
 * cards it is opened by a card's own menu, and `insert` says where it stands.
 */
function AddNewItem({
    column, api, cardTemplates, isCreating, setIsCreating, onCreated, insert, isSorted
}: {
    column: string,
    api: BoardApi,
    cardTemplates: CardTemplates,
    /** Whether the column orders its own cards, which leaves the reader no end to pick. */
    isSorted?: boolean,
    isCreating?: boolean,
    setIsCreating?: (isCreating: boolean) => void,
    /** Names the card just made, which the column shows once the board has drawn it. */
    onCreated: (noteId: string | undefined) => void,
    /**
     * Where a field standing among the cards puts what it makes: above the card it is given, or
     * at the end of the column where it is given none. Absent for the field below the column.
     */
    insert?: { before?: string, close: () => void }
}) {
    // A field standing among the cards is nothing else: there is no button for it to replace, and
    // it is taken down rather than closed.
    const isEditing = !!insert || !!isCreating;
    const close = useCallback(
        () => insert ? insert.close() : setIsCreating?.(false),
        [ insert, setIsCreating ]);
    // What the editor opens with: empty to begin with, then whatever was typed into it and left
    // unsaved, so that reaching for something else and coming back does not cost the title.
    const [ initialTitle, setInitialTitle ] = useState("");
    // Kept between cards, unlike the title: a run of cards is often a run of the same kind of card.
    const [ icon, setIcon ] = useState(DEFAULT_CARD_ICON);

    const open = useCallback((title: string) => {
        setInitialTitle(title);
        setIsCreating?.(true);
    }, [ setIsCreating ]);

    /** Puts a note that already exists into this column, for a field with nothing typed into it. */
    const addExistingItem = useCallback(async () => {
        const noteId = await dialog.chooseNote({
            title: t("board_view.add-existing-item-title"),
            okLabel: t("board_view.add-existing-item-ok")
        });

        if (noteId) {
            await api.addExistingItem(column, noteId, insert?.before);
        }
    }, [ api, column, insert ]);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (isCreating) return;

        if (e.key === "Enter" && !e.ctrlKey) {
            setIsCreating?.(true);
            return;
        }

        // Typing on the button starts the note off with what was typed, rather than asking for it
        // twice. A printable key is one whose name is the character itself, which no modified press
        // and none of the named keys are.
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            open(e.key);
        }
    }, [ isCreating, open, setIsCreating ]);

    /** Makes the card, where the field stands or at the end of the column. */
    const create = useCallback(async (title: string, atStart?: boolean) => {
        const cardIcon = icon !== DEFAULT_CARD_ICON ? icon : undefined;

        if (insert) {
            // Left standing until the column has drawn the card, which takes the field's place.
            const noteId = await api.createNewItemBefore(
                column, insert.before, title, cardIcon, cardTemplates.current);
            if (noteId) {
                onCreated(noteId);
            } else {
                insert.close();
            }
            return;
        }

        onCreated(await api.createNewItem(
            column, title, atStart ? "top" : "bottom", cardIcon, cardTemplates.current));
    }, [ api, cardTemplates, column, icon, insert, onCreated ]);

    return (
        <div
            className={clsx("board-new-item", { editing: isEditing, inserting: !!insert })}
            onClick={!insert ? () => flushSync(() => setIsCreating?.(true)) : undefined}
            onKeyDown={!insert ? handleKeyDown : undefined}
            tabIndex={!insert ? 300 : undefined}
        >
            {!isEditing ? (
                <>
                    <Icon icon="bx bx-plus" />{" "}
                    {t("board_view.new-item")}
                </>
            ) : (
                <TitleEditor
                    currentValue={initialTitle}
                    placeholder={t("board_view.new-item-placeholder")}
                    save={create}
                    dismiss={close}
                    mode="multiline" isNewItem
                    selectOnFocus={false}
                    saveAndContinue
                    handsOver={!!insert}
                    abandon={setInitialTitle}
                    whenEmpty={{
                        title: t("board_view.add-existing-item"),
                        onClick: addExistingItem
                    }}
                    submitTitle={t("board_view.create-new-note")}
                    // Only the field below the column offers both ends. One standing among the
                    // cards is already at the end the reader asked for, and a sorted column places
                    // the card itself.
                    openPlacements={!insert && !isSorted ? openCreateCardMenu : undefined}
                    footer={(hold) => <CardTemplatePill {...cardTemplates} {...hold} />}
                    icon={{
                        current: icon,
                        onSelect: setIcon,
                        onReset: icon !== DEFAULT_CARD_ICON
                            ? () => setIcon(DEFAULT_CARD_ICON)
                            : undefined
                    }}
                />
            )}
        </div>
    );
}

/**
 * How many cards a column holds, with a breakdown on hover.
 *
 * Archived cards are only included while the board is showing archived notes. Otherwise there are
 * none to count and the badge reports the total alone.
 */
function CountBadge({ items, limit, isOver }: {
    items?: { note: FNote }[],
    limit?: number,
    /** Whether the column is over its limit. The column body is outlined as well. */
    isOver?: boolean
}) {
    const badgeRef = useRef<HTMLSpanElement>(null);
    const archived = items?.filter(({ note }) => note.isArchived).length ?? 0;
    const total = items?.length ?? 0;

    const counts = archived
        ? t("board_view.card-count-with-archived", { count: total - archived, archived })
        : t("board_view.card-count", { count: total });
    const warning = t("board_view.card-count-over-limit");

    // The tooltip gets its own markup, since a title attribute cannot show a bold line. The
    // attribute keeps a plain version as a fallback. Memoised because `useStaticTooltip`
    // rebuilds the tooltip whenever the config changes identity.
    const tooltip = useMemo(() => ({
        html: true,
        title: isOver ? `${counts}<br><strong>${warning}</strong>` : counts
    }), [ counts, warning, isOver ]);
    useStaticTooltip(badgeRef, tooltip);

    return (
        <span
            ref={badgeRef}
            className={clsx("counter-badge", { "over-limit": isOver })}
            title={isOver ? `${counts}
${warning}` : counts}
        >
            {limit === undefined ? total : `${total}/${limit}`}
        </span>
    );
}

function useDragging({
    column, columnIndex, columnItems, isEditing, api, parentNote, onLanded
}: DragContext & {
    isEditing: boolean,
    api: BoardApi,
    parentNote: FNote,
    /** Reports a card a sorted column placed, for the `appearing` reveal. */
    onLanded: (noteId: string) => void
}) {
    const { setDraggedColumn, setDropTarget, setDropPosition, setActiveColumn } =
        useContext(BoardActionsContext);
    const { draggedColumn } = useContext(BoardDragStateContext);
    // Read when a drop happens rather than watched: these callbacks answer for a drag from the
    // note tree, and where the gap stands is of no interest to the column until one lands.
    const dropState = useContext(BoardDropStateContext);
    /** Needed to track if current column is dragged in real-time, since {@link draggedColumn} is populated one render cycle later.  */
    const isDraggingRef = useRef(false);

    const handleColumnDragStart = useCallback((e: DragEvent) => {
        if (isEditing) return;

        isDraggingRef.current = true;
        e.dataTransfer!.effectAllowed = 'move';
        e.dataTransfer!.setData('text/plain', column);

        const element = (e.currentTarget as HTMLElement).closest<HTMLElement>(".board-column");
        setDraggedColumn({
            column,
            index: columnIndex,
            size: element
                ? { width: element.offsetWidth, height: element.offsetHeight }
                : undefined
        });
        e.stopPropagation(); // Prevent card drag from interfering
    }, [column, columnIndex, setDraggedColumn, isEditing]);

    const handleColumnDragEnd = useCallback(() => {
        isDraggingRef.current = false;
        setDraggedColumn(null);
    }, [setDraggedColumn]);

    const handleDragOver = useCallback((e: DragEvent) => {
        if (isEditing || draggedColumn || isDraggingRef.current) return; // Don't handle card drops when dragging columns
        // Cards are carried by pointer now; what still arrives this way comes from the note tree.
        if (!e.dataTransfer?.types.includes(TREE_CLIPBOARD_TYPE)) return;

        e.preventDefault();
        setDropTarget(column);
        // A collapsed column opens to take the card and stays open afterwards, so the card can be
        // placed among the ones already there.
        setActiveColumn(column);

        // Calculate drop position based on mouse position
        const cards = Array.from((e.currentTarget as HTMLElement)?.querySelectorAll('.board-note'));
        const mouseY = e.clientY;

        let newIndex = cards.length;
        for (let i = 0; i < cards.length; i++) {
            const card = cards[i] as HTMLElement;
            const rect = card.getBoundingClientRect();
            const cardMiddle = rect.top + rect.height / 2;

            if (mouseY < cardMiddle) {
                newIndex = i;
                break;
            }
        }

        const standing = dropState.get().position;
        if (!(standing?.column === column && standing.index === newIndex)) {
            setDropPosition({ column, index: newIndex });
        }
    }, [column, setDropTarget, setActiveColumn, dropState, setDropPosition, isEditing]);

    const handleDragLeave = useCallback((e: DragEvent) => {
        const relatedTarget = e.relatedTarget as HTMLElement;
        const currentTarget = e.currentTarget as HTMLElement;

        if (!currentTarget.contains(relatedTarget)) {
            setDropTarget(null);
            setDropPosition(null);
        }
    }, [setDropTarget, setDropPosition]);

    const handleDrop = useCallback(async (e: DragEvent) => {
        if (draggedColumn) return; // Don't handle card drops when dragging columns
        e.preventDefault();
        // Taken before the gap is closed, which is what says where the note goes.
        const standing = dropState.get().position;
        setDropTarget(null);
        setDropPosition(null);

        const data = e.dataTransfer?.getData("text");
        if (!data) return;

        let dropped: DragData[];
        try {
            dropped = JSON.parse(data);
        } catch (e) {
            return;
        }

        if (Array.isArray(dropped)) {
            const { noteId, branchId } = dropped[0];
            const targetNote = await froca.getNote(noteId, true);
            const parentNoteId = parentNote.noteId;
            if (!standing) return;

            // A sorted column places the card itself, so the note is added at the end of the
            // board's children and nothing is written against the card it was dropped over.
            const isSorted = api.isColumnSorted(column);
            const targetIndex = standing.index - 1;
            const targetItems = columnItems || [];
            const targetBranch = !isSorted && targetIndex >= 0
                ? targetItems[targetIndex].branch
                : null;

            await api.changeColumn(noteId, column);

            const parents = targetNote?.getParentNoteIds();
            if (!parents?.includes(parentNoteId)) {
                if (!targetBranch) {
                    // First.
                    await branches.cloneNoteToParentNote(noteId, parentNoteId);
                } else {
                    await branches.cloneNoteAfter(noteId, targetBranch.branchId);
                }
            } else if (targetBranch) {
                await branches.moveAfterBranch([ branchId ], targetBranch.branchId);
            }

            // The drop named a column, not an index, so the reveal shows where it landed.
            if (isSorted) {
                onLanded(noteId);
            }
        }
    }, [
        api, draggedColumn, dropState, columnItems, column, setDropTarget, setDropPosition,
        onLanded
    ]);

    return { handleColumnDragStart, handleColumnDragEnd, handleDragOver, handleDragLeave, handleDrop };
}
