import "./index.css";

import clsx from "clsx";

import { ComponentChildren, createContext, Fragment, TargetedKeyboardEvent } from "preact";
import { JSX } from "preact/jsx-runtime";
import { createPortal, RefObject } from "preact/compat";
import {
    Dispatch, StateUpdater, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState
} from "preact/hooks";

import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import type LoadResults from "../../../services/load_results";
import { ContextMenuEvent } from "../../../menus/context_menu";
import { isIMEComposing } from "../../../services/shortcuts";
import type { ShortcutHintDefinition } from "../../../services/shortcut_hints";
import toast from "../../../services/toast";
import { escapeHtml, isMobile } from "../../../services/utils";
import { type NoteTypeOption, resolveNoteTypeOptions } from "../../../services/note_types";
import type { PromotedAttributeSetting } from "../promoted_attributes";
import CollectionProperties from "../../note_bars/CollectionProperties";
import FormTextArea from "../../react/FormTextArea";
import FormTextBox from "../../react/FormTextBox";
import {
    useContextualShortcutHints, useNoteContext, useNoteLabelBoolean, useNoteLabelWithDefault,
    useNoteTypeOptions, useTrackedElement, useTriliumEvent
} from "../../react/hooks";
import Icon from "../../react/Icon";
import NoteAutocomplete from "../../react/NoteAutocomplete";
import ShortcutHintButton from "../../shortcut_hints/shortcut_hint_button";
import { onWheelHorizontalScroll } from "../../widget_utils";
import ActionButton from "../../react/ActionButton";
import { IconPickerButton } from "../../react/IconPicker";
import { useDragPan } from "../../react/drag_pan";
import { FLIP_SETTLE_MS, useFlip } from "../../react/flip";
import { ViewModeProps } from "../interface";
import Api, { getPendingWrites, PendingColumnWrites, settleColumn } from "./api";
import { useBoardDrag } from "./board_drag";
import { movesColumn } from "./drag_geometry";
import BoardApi from "./api";
import { DEFAULT_COLUMN_ICON, DEFAULT_GROUP_BY, getStatusDefinition, INBOX_COLUMN } from "./columns";
import Column from "./column";
import { currentCardTemplate, DEFAULT_CARD_TEMPLATES } from "./card_templates";
import ColumnLimitDialog from "./column_limit";
import BoardProperties from "./properties";
import { openBoardContextMenu, openCreateColumnMenu } from "./context_menu";
import { applyCardMove, ColumnMap, getBoardData } from "./data";
import { useBoardKeyboard } from "./keyboard";

/**
 * What a control standing inside an editor's field calls as it opens and closes.
 *
 * Losing focus is what closes an editor, and a menu takes focus with it: a control that opens one
 * says so, and the editor stays where it is until the menu is done with.
 */
export interface HoldOpen {
    onOpened: () => void;
    onClosed: () => void;
}

export interface BoardViewData {
    columns?: BoardColumnData[];
    /**
     * What a new card can be made from, as {@link NoteTypeOption} ids. Absent until the reader picks
     * for the board, which is what `DEFAULT_CARD_TEMPLATES` stands in for.
     */
    templates?: string[];
    /** The one last used, which the next card is made from. */
    template?: string;
    /**
     * Which promoted attributes the cards show, and in what order. An attribute the list does not
     * name is shown after the ones it does; see {@link resolvePromotedAttributes}.
     */
    promotedAttributes?: PromotedAttributeSetting[];
}

export interface BoardColumnData {
    value: string;
    /** The icon class shown before the title, absent until one is picked. */
    icon?: string;
    /** The CSS colour the column is tinted with, absent until one is picked. */
    color?: string;
    /** Whether the column is archived, absent while it is not. */
    archived?: boolean;
    /**
     * Whether the column is drawn as a strip, with its cards left out. Selecting the column opens
     * it again until another one is selected, which does not change this.
     */
    collapsed?: boolean;
    /**
     * Whether the column collapses again after being opened. Without it, opening a collapsed
     * column by hand clears `collapsed`; a column opened to take a dragged card is unaffected
     * either way.
     */
    keepCollapsed?: boolean;
    /**
     * Whether the inbox column also collects notes below the board's direct children. Has no
     * meaning on any other column, which is defined by a grouping value instead.
     */
    nested?: boolean;
    /**
     * The column's display name, used only by columns that are not identified by a grouping
     * value. Renaming any other column writes the value itself, so it needs none.
     */
    displayName?: string;
    /** The note limit, absent if disabled. */
    limit?: number;
}

interface CardDrag {
    noteId: string;
    branchId: string;
    fromColumn: string;
    index: number;
    /** How tall the card stands, absent for a drag from the note tree, which carries no card. */
    height?: number;
}

interface ColumnDrag {
    column: string;
    index: number;
    /** What the column measures, so the gap held open for it is the size it will land in. */
    size?: { width: number, height: number };
}

/**
 * The board's setters, which `useState` gives a fixed identity, so this context never changes value
 * at all.
 *
 * Kept apart from the drag state below because Preact re-renders every consumer of a context whose
 * value changed, memo boundaries included. Merged into one value, as they used to be, a card could
 * not be kept off the render path at all: it needs two of these setters, so it would subscribe to a
 * value that changes several times per drag and re-render each time, all 949 of them.
 *
 * The board's `api` deliberately stays out. Every component that used to read it from here is also
 * passed it as a prop, so having it in both places was duplication -- and being un-defaultable, it
 * was the only reason this context had to be nullable.
 */
interface BoardActions {
    setBranchIdToEdit: Dispatch<StateUpdater<string | undefined>>;
    setColumnNameToEdit: Dispatch<StateUpdater<string | undefined>>;
    setColumnLimitToEdit: Dispatch<StateUpdater<string | undefined>>;
    /**
     * Names the column the reader is working in. A collapsed column is drawn open while it holds
     * this, so selecting another one is the only thing that closes it again.
     */
    setActiveColumn: Dispatch<StateUpdater<string | undefined>>;
    setDraggedCard: Dispatch<StateUpdater<CardDrag | null>>;
    setDraggedColumn: (column: ColumnDrag | null) => void;
    setDropPosition: (position: ColumnDrag | null) => void;
    setDropTarget: (target: string | null) => void;
}

/** The half that changes repeatedly while a card or column is dragged, or a title is being edited. */
interface BoardDragState {
    branchIdToEdit?: string;
    columnNameToEdit?: string;
    draggedCard: CardDrag | null;
    draggedColumn: ColumnDrag | null;
    dropPosition: ColumnDrag | null;
    dropTarget: string | null;
}

// Both defaults are the honest identity value rather than a stand-in, which is what lets consumers
// read these with a plain useContext(): no non-null assertion, and no guard for a provider that is
// structurally always there. Nothing is being dragged, and the setters have nothing to set.
/* v8 ignore next 10 -- the board always provides these, so nothing but a consumer mounted outside
   it would ever call one; they exist so that consumers need no guard. */
export const BoardActionsContext = createContext<BoardActions>({
    setBranchIdToEdit: () => undefined,
    setColumnNameToEdit: () => undefined,
    setColumnLimitToEdit: () => undefined,
    setActiveColumn: () => undefined,
    setDraggedCard: () => undefined,
    setDraggedColumn: () => undefined,
    setDropPosition: () => undefined,
    setDropTarget: () => undefined
});

/**
 * Which promoted attributes a card draws, in order.
 *
 * A context rather than a prop: a card is memoized, so this is what reaches one when the reader
 * arranges the attributes and nothing about the card itself has changed.
 */
export const BoardPromotedAttributesContext = createContext<string[] | undefined>(undefined);

export const BoardDragStateContext = createContext<BoardDragState>({
    draggedCard: null,
    draggedColumn: null,
    dropPosition: null,
    dropTarget: null
});

/**
 * What the board answers with when asked for contextual keyboard help. Every entry is a key the
 * board handles itself (see `keyboard.ts` and the card and column handlers), none of them
 * rebindable, so each is listed literally rather than through a registered action.
 */
/** How long a finger stays on the create button before it offers where to put the card. */
const HOLD_TO_PLACE_MS = 500;

/** How far the pointer can move during that and still count as a hold rather than a scroll. */
const HOLD_SLACK_PX = 10;

const BOARD_HINTS: ShortcutHintDefinition = [
    {
        titleKey: "board_view.hints.navigation",
        hints: [
            { keys: [ "Up", "Down" ], labelKey: "board_view.hints.navigate_items" },
            { keys: [ "Left", "Right" ], labelKey: "board_view.hints.navigate_columns" },
            { keys: [ "Home", "End" ], labelKey: "board_view.hints.first_last_item" }
        ]
    },
    {
        titleKey: "board_view.hints.editing",
        hints: [
            { keys: [ "Enter", "Shift+Enter" ], labelKey: "board_view.hints.insert_item" },
            {
                keys: [ "Ctrl+Enter", "Ctrl+Shift+Enter" ],
                labelKey: "board_view.hints.insert_column"
            },
            { keys: [ "Space" ], labelKey: "board_view.hints.open_item" },
            { keys: [ "F2" ], labelKey: "board_view.hints.rename" },
            { keys: [ "Delete" ], labelKey: "board_view.hints.remove_item" },
            { keys: [ "Shift+Delete" ], labelKey: "board_view.hints.delete_item" },
            { keys: [ "Delete" ], labelKey: "board_view.hints.remove_column" }
        ]
    },
    {
        titleKey: "board_view.hints.moving",
        hints: [
            { keys: [ "Ctrl+Up", "Ctrl+Down" ], labelKey: "board_view.hints.move_item" },
            { keys: [ "Ctrl+Home", "Ctrl+End" ], labelKey: "board_view.hints.move_within" },
            { keys: [ "Ctrl+Left", "Ctrl+Right" ], labelKey: "board_view.hints.move_across" },
            {
                keys: [ "Ctrl+Shift+Left", "Ctrl+Shift+Right" ],
                labelKey: "board_view.hints.move_to_end_column"
            },
            {
                keys: [ "Ctrl+Alt+Left", "Ctrl+Alt+Right" ],
                labelKey: "board_view.hints.move_column"
            },
            {
                keys: [ "Ctrl+Alt+Home", "Ctrl+Alt+End" ],
                labelKey: "board_view.hints.move_column_to_edge"
            }
        ]
    }
];

export default function BoardView({ note: parentNote, noteIds, viewConfig, saveConfig }: ViewModeProps<BoardViewData>) {
    const { noteContext } = useNoteContext();
    const [ statusAttributeWithPrefix ] = useNoteLabelWithDefault(parentNote, "board:groupBy", DEFAULT_GROUP_BY);
    const [ includeArchived ] = useNoteLabelBoolean(parentNote, "includeArchived");
    const [ inboxEnabled ] = useNoteLabelBoolean(parentNote, "enableInboxColumn");
    const [ byColumn, setByColumn ] = useState<ColumnMap>();
    const [ columns, setColumns ] = useState<string[]>();
    const [ isInRelationMode, setIsRelationMode ] = useState(false);
    const [ draggedCard, setDraggedCard ] = useState<CardDrag | null>(null);
    /** The column just added, which is revealed once the board has drawn it. */
    const [ createdColumn, setCreatedColumn ] = useState<string>();
    const [ dropTarget, setDropTarget ] = useState<string | null>(null);
    const [ dropPosition, setDropPosition ] = useState<{ column: string, index: number } | null>(null);
    const [ draggedColumn, setDraggedColumn ] = useState<ColumnDrag | null>(null);
    const [ columnDropPosition, setColumnDropPosition ] = useState<number | null>(null);
    const [ branchIdToEdit, setBranchIdToEdit ] = useState<string>();
    const [ columnNameToEdit, setColumnNameToEdit ] = useState<string>();
    const [ columnLimitToEdit, setColumnLimitToEdit ] = useState<string>();
    const [ activeColumn, setActiveColumn ] = useState<string>();
    /**
     * Whether every collapsed column is open at once, which "Expand all columns" asks for.
     *
     * Held apart from `activeColumn`, which names one column: a column drawn open by this is not
     * the column the reader is working in, and is closed by the same signal a single peek is, which
     * is a column being selected or focused.
     */
    const [ isPeekingAll, setIsPeekingAll ] = useState(false);
    /** Whether the editor a column is named in is open, which the board's own menu also opens. */
    const [ isCreatingColumn, setIsCreatingColumn ] = useState(false);
    /** Everything a card could be made from: the note types and every template. */
    const availableTemplates = useNoteTypeOptions();
    const [ isEditingProperties, setIsEditingProperties ] = useState(false);
    const selectColumn = useCallback<Dispatch<StateUpdater<string | undefined>>>((column) => {
        setIsPeekingAll(false);
        setActiveColumn(column);
    }, []);
    // How many card moves are still being written. The board is drawn as they will leave it, so a
    // redraw from the first of a move's two writes would take that back.
    const movesInFlight = useRef(0);
    /** Bumped when the definition changes, since it is read off the note rather than held in state. */
    const [ definitionRevision, setDefinitionRevision ] = useState(0);
    // A ref rather than state: `api` is rebuilt on every refresh, and the map has to outlive those
    // instances to cover a rename (see BoardApi#retireColumn). Mutating it must not re-render.
    const pendingRenamesRef = useRef<{ board: string, writes: PendingColumnWrites }>({
        board: "",
        writes: { renames: new Map(), claims: new Map(), inFlight: 0 }
    });
    /** Names each refresh, so one the board has moved on from is discarded rather than applied. */
    const refreshSeqRef = useRef(0);

    // A pending rename belongs to the board and the grouping it was made on, and `NoteList` renders
    // the view unkeyed, so moving to another board reuses this instance. Looked up rather than made
    // here, so that another view of the same board reads the same record; moving to another board
    // takes up that board's own, leaving a write still in flight to undo into the one it recorded
    // itself in. Done while rendering, so the `api` below is handed the map the refresh reads.
    useContextualShortcutHints(BOARD_HINTS);
    const boardIdentity = `${parentNote.noteId}|${statusAttributeWithPrefix}`;
    if (pendingRenamesRef.current.board !== boardIdentity) {
        pendingRenamesRef.current = {
            board: boardIdentity,
            writes: getPendingWrites(boardIdentity)
        };
        refreshSeqRef.current++;
    }
    // The inbox is resolved from the config alone, so its icon, colour and position survive the
    // toggle being off. The toggle only decides whether the board shows and offers it: dropping it
    // during resolution would rewrite the attachment without it and lose those settings.
    const usableColumns = useMemo(
        () => (columns ?? []).filter(column => column !== INBOX_COLUMN || inboxEnabled),
        [ columns, inboxEnabled ]);
    const statusDefinition = useMemo(
        () => getStatusDefinition(parentNote, statusAttributeWithPrefix),
        [ parentNote, statusAttributeWithPrefix, definitionRevision ]);
    // One api for as long as the board is shown, pointed at each refresh's data rather than built
    // again: a new object would be a new prop on every card, and `memo` would then redraw all of
    // them for a move that touched one. Another board takes a new one, since this instance is
    // reused across boards and the api holds that board's record of the writes in flight.
    const apiRef = useRef<{ board: string, api: Api }>();
    if (!apiRef.current || apiRef.current.board !== boardIdentity) {
        apiRef.current = {
            board: boardIdentity,
            api: new Api(
                byColumn, usableColumns, parentNote, statusAttributeWithPrefix, viewConfig,
                saveConfig, setBranchIdToEdit, pendingRenamesRef.current.writes, statusDefinition)
        };
    } else {
        apiRef.current.api.update(
            byColumn, usableColumns, parentNote, statusAttributeWithPrefix, viewConfig,
            saveConfig, setBranchIdToEdit, statusDefinition);
    }
    const api = apiRef.current.api;
    // Every member is one of useState's own setters, so this value is built once and never changes
    // identity -- a drag cannot reach anything that reads only this.
    const openBoardMenu = useCallback((event: ContextMenuEvent) => {
        // Only the ground the columns stand on. A column and a card answer for their own presses,
        // and what they leave alone, such as the button that makes a card, is left alone here too.
        if ((event.target as HTMLElement)?.closest(".board-column, .board-add-column")) {
            return;
        }

        openBoardContextMenu(event, {
            archivedShown: includeArchived,
            onAddColumn: () => setIsCreatingColumn(true),
            onShowArchived: (shown) => api.setArchivedShown(shown),
            onOpenProperties: () => setIsEditingProperties(true),
            onCollapseAll: () => {
                // The open column is closed with the rest: it holds the peek that would otherwise
                // keep it open against what is being written for it.
                selectColumn(undefined);
                api.setAllColumnsCollapsed(true);
            },
            onExpandAll: () => {
                // Opened for good where the column is not kept collapsed, and peeked where it is.
                setIsPeekingAll(true);
                api.setAllColumnsCollapsed(false);
            }
        });
    }, [ api, selectColumn, inboxEnabled, includeArchived ]);

    // Read from the api rather than from the prop, since a pick moves the api's own copy ahead of
    // the board's; keyed on the prop so that a change from anywhere else is followed too.
    const offeredTemplates = useMemo(
        () => resolveNoteTypeOptions(api.getCardTemplateIds(), availableTemplates),
        [ api, viewConfig, availableTemplates ]);
    // Handed to the api as well, for the cards made from somewhere other than the editor: an
    // insert beside another card reaches for the same template without being given one.
    useEffect(
        () => api.setAvailableCardTemplates(availableTemplates), [ api, availableTemplates ]);

    const cardTemplates = useMemo(() => ({
        offered: offeredTemplates,
        current: currentCardTemplate(offeredTemplates, api.getLastCardTemplateId()),
        onSelect: (template: NoteTypeOption) => api.setLastCardTemplateId(template.id),
        onMore: () => setIsEditingProperties(true)
    }), [ api, viewConfig, offeredTemplates ]);

    // Held while the names are the same, since a new array would redraw every card on every render.
    const shownAttributesRef = useRef<string[]>([]);
    const resolvedAttributes = api.getVisiblePromotedAttributeNames();
    if (resolvedAttributes.join(",") !== shownAttributesRef.current.join(",")) {
        shownAttributesRef.current = resolvedAttributes;
    }
    const shownAttributes = shownAttributesRef.current;

    const boardActions = useMemo<BoardActions>(() => ({
        setBranchIdToEdit,
        setColumnNameToEdit,
        setColumnLimitToEdit,
        setActiveColumn: selectColumn,
        setDraggedCard,
        setDraggedColumn,
        setDropPosition,
        setDropTarget
    }), [
        setBranchIdToEdit, setColumnNameToEdit, setColumnLimitToEdit, selectColumn,
        setDraggedCard, setDraggedColumn, setDropPosition, setDropTarget
    ]);

    // Read off the config rather than off `columns`, which the resolver hands back as names alone.
    const storedColumns = useMemo(
        () => new Map((viewConfig?.columns ?? []).map(stored => [ stored.value, stored ])),
        [ viewConfig ]);

    // Filtered here rather than in the resolution, which is what gets written back: dropped there,
    // an archived column would be erased from the config and the definition instead of kept out of
    // sight. `columnDropPosition` indexes this list, so a drag places columns as they are shown.
    const shownColumns = useMemo(
        () => usableColumns.filter(column =>
            includeArchived || !storedColumns.get(column)?.archived),
        [ usableColumns, storedColumns, includeArchived ]);

    const containerRef = useRef<HTMLDivElement>(null);
    /** Until when a column move can still be settling, which is when `useFlip` slides columns. */
    const columnMovedUntil = useRef(0);

    const boardDragState = useMemo<BoardDragState>(() => ({
        branchIdToEdit,
        columnNameToEdit,
        draggedCard,
        draggedColumn,
        dropPosition,
        dropTarget
    }), [ branchIdToEdit, columnNameToEdit, draggedCard, draggedColumn, dropPosition, dropTarget ]);

    function refresh() {
        // A move under way has already been drawn where it will land. Held here rather than at each
        // caller, since a card crossing columns changes both the note and the board's children, and
        // either of those reaches this by a path of its own.
        if (movesInFlight.current) {
            return;
        }

        // A board in a tab the reader is not looking at draws for nobody, and every mounted board
        // hears every change: a card renamed once redraws each of them, whichever is on screen. The
        // change is remembered instead, and drawn once the tab is looked at again. Asked of the
        // context rather than of the box, which is empty for a board that has not drawn yet.
        // Only once it has drawn: a board opened straight into a background tab has to draw at
        // least once, or there is no container to notice the tab being shown and it stays empty.
        if (byColumn && noteContext && !noteContext.isActive()) {
            isStale.current = true;
            return;
        }

        // `getBoardData` reads notes, so refreshes can resolve out of order and one issued for the
        // board the user has left can arrive after the next board's. What it has to say is about
        // sources no longer on screen, the pending renames it reports as settled included.
        const refreshId = ++refreshSeqRef.current;

        getBoardData(
            parentNote, statusAttributeWithPrefix, viewConfig ?? {}, includeArchived,
            statusDefinition?.options ?? [], pendingRenamesRef.current.writes.renames, inboxEnabled)
            .then(({ byColumn, columns, newPersistedData, isInRelationMode, settledRenames }) => {
                if (refreshId !== refreshSeqRef.current) {
                    return;
                }

                for (const settled of settledRenames) {
                    settleColumn(pendingRenamesRef.current.writes, settled);
                }

                setByColumn(byColumn);
                setIsRelationMode(isInRelationMode);
                setColumns(columns);

                // A column a write is carrying has already been taken out of `columns`, and the
                // two writes below would put that answer on disk before the notes have given it.
                // Only while the write runs: its record can outlast it, and the board still has to
                // bring the definition into line afterwards.
                if (pendingRenamesRef.current.writes.inFlight) {
                    return;
                }

                // Only to give a board that keeps no column list one to begin with. Written on
                // every refresh instead, this is what a client reads the board with while another
                // is changing it: it resolves a name the change has already taken away from
                // whichever source it has not heard about yet, and writes it back as a column.
                // What this board itself changes is written where it is changed.
                if (newPersistedData && !viewConfig?.columns?.length) {
                    viewConfig = { ...newPersistedData };
                    saveConfig(newPersistedData);
                }

                // The columns the board settled on are the options its definition should offer,
                // which is what gives a board created after migration 0240 ran a definition at all.
                // Only a board without one of its own: a client reading the board while another is
                // changing it resolves a name the change has already taken away, and writing that
                // into the definition puts the column back for everyone. What this board changes
                // itself is written where it is changed.
                // Reported rather than surfaced: nothing the user did is failing, and a board that
                // cannot write it re-tries on the next render, which would toast on each one.
                // Only a board that has no definition of its own. One that has is kept in step by
                // whatever writes its columns: the server for a rename, `storeColumns` for
                // everything the board itself changes. Writing it from here as well means a client
                // reading the board while another changes it puts its own view of the columns on
                // disk, which is how a renamed column loses its place or comes back under its old
                // name.
                if (statusDefinition?.isOwned) {
                    return;
                }

                api.syncColumnsToDefinition(columns)
                    .catch((e) => console.error("Failed to sync the board columns to the attribute definition:", e));
            });
    }

    // The gesture drives the same state a drag from the note tree does, so the placeholders and the
    // card's own dimming are drawn from one place whichever brought the card here.
    const { isDragging: isDraggingItem, remeasure } = useBoardDrag(containerRef, {
        onCardStart: (card) => setDraggedCard({
            noteId: card.noteId,
            branchId: byColumn?.get(card.fromColumn)?.[card.index]?.branch.branchId ?? "",
            fromColumn: card.fromColumn,
            index: card.index,
            height: card.height
        }),
        onCardMove: (position, inside) => {
            setDropTarget(position?.column ?? null);
            setDropPosition(position);
            // Answers for what a `dragover` did, for a collapsed column the card is actually over:
            // one merely passed near keeps to itself, and one already opened stays open, since
            // closing it under a drag would move every column after it.
            if (position && inside && storedColumns.get(position.column)?.collapsed) {
                selectColumn(position.column);
            }
        },
        onCardEnd: (card, position) => {
            const branchId = byColumn?.get(card.fromColumn)?.[card.index]?.branch.branchId;
            if (position && branchId && byColumn) {
                // Drawn where it landed at once, and held there until both writes are in: each of
                // them lands a redraw, and the first would show the card at the top of the column.
                setByColumn(applyCardMove(
                    byColumn, card.noteId, card.fromColumn, position.column, position.index));
                movesInFlight.current++;
                // Any refresh already on its way is about the board as it stood before the drop,
                // and would put the card back where it came from as it resolves.
                refreshSeqRef.current++;
                api.moveWithinBoard(
                    card.noteId, branchId, card.index, position.index,
                    card.fromColumn, position.column)
                    // Nothing is asked for once the writes are in: `froca` learns of the branch
                    // move from the server a moment later, so a refresh here reads the new column
                    // with the old order and puts the card at the top of it. The change reaches the
                    // board as an entity reload, which settles it once there is something to read.
                    .finally(() => { movesInFlight.current--; });
            }
            setDraggedCard(null);
            setDropTarget(null);
            setDropPosition(null);
            // Asked for by name: the card is drawn again where it landed, and a card that crossed
            // columns is drawn as a new element, so the one that was focused is gone.
            focusCard(card.noteId);
            if (position) {
                revealColumn(position.column);
            }
        },
        onColumnStart: (column, index, size) => setDraggedColumn({ column, index, size }),
        onColumnMove: setColumnDropPosition,
        onColumnEnd: (from, to) => {
            if (to !== null && movesColumn(from, to)) {
                handleColumnDrop(from, to);
            }
            setDraggedColumn(null);
            setColumnDropPosition(null);
        }
    });

    // A column opened to take the card moves every column after it, which the measurement predates.
    // Only for a card: a carried column is measured among the columns as they stood when it was
    // picked up, which is the list the place it would take is counted against, and measuring again
    // with it out of the flow would count one place fewer than the board has.
    useLayoutEffect(() => {
        if (isDraggingItem && !draggedColumn) {
            remeasure();
        }
    }, [ isDraggingItem, draggedColumn, remeasure, activeColumn, shownColumns ]);

    // Only the board's own background, so a press on a column, a card or the button that adds one
    // is left to whatever it belongs to. Suppressed while a card is carried: the gesture owns the
    // pointer, and the board must not slide under it.
    const { isPannable, isPanning } = useDragPan(containerRef, { disabled: isDraggingItem });
    // Columns slide to follow the gap a carried column opens. The selector excludes the drag
    // preview, whose transform `useBoardDrag` writes every frame; `AddNewColumn` is outside the
    // container, and is moved by the scroll that keeps it in view instead.
    //
    // No `grow`: a column is its grouping value, so a rename mounts a new element and is
    // indistinguishable from an arrival. The column just added is shown by `board-item-appear` and
    // by the scroll to the board's end.
    useFlip(containerRef, {
        selector: ".board-column:not(.board-drag-preview)",
        axis: "horizontal",
        // Only for a move the reader made, tracked by `columnMovedUntil`. A value change redraws
        // the columns, and the order churns while the cards, the definition and the stored config
        // catch up with one another; sliding for that animates a rename as a move.
        disabled: !draggedColumn && Date.now() > columnMovedUntil.current
    });

    /**
     * Brings a column to the middle of the screen, for a board that scrolls one column at a time.
     *
     * Snapping is off while something is carried, so letting go leaves the board wherever the
     * gesture took it and the reader looking at two half-columns. Asked for on the next frame: the
     * board is drawn again around the card that landed, and the column moves with it.
     */
    const revealColumn = useCallback((column: string) => {
        if (!isMobile()) return;

        requestAnimationFrame(() => {
            const columns = containerRef.current?.querySelectorAll<HTMLElement>(".board-column");
            for (const element of columns ?? []) {
                if (element.dataset.column === column) {
                    element.scrollIntoView({ inline: "center", block: "nearest" });
                    return;
                }
            }
        });
    }, []);

    // Whether a change arrived while the board was in a background tab.
    const isStale = useRef(false);
    const latestRefresh = useRef(refresh);
    latestRefresh.current = refresh;

    // Caught up when the board is given a size again, which is what showing its tab does. Keyed on
    // that rather than on the context becoming active: the board is drawn from what the tab switch
    // lays out, and a size is the one signal that is certainly in by then.
    const boardElement = useTrackedElement(containerRef);
    useEffect(() => {
        if (!boardElement) return;

        const observer = new ResizeObserver(() => {
            if (isStale.current && boardElement.getBoundingClientRect().width > 0) {
                isStale.current = false;
                latestRefresh.current();
            }
        });
        observer.observe(boardElement);
        return () => observer.disconnect();
    }, [ boardElement ]);

    // The board is not drawn afresh for another note, so the column opened on one would otherwise
    // still be open on the next, over whatever that board stores for a column of the same name.
    useEffect(() => selectColumn(undefined), [ parentNote, selectColumn ]);

    useEffect(refresh, [
        parentNote, noteIds, viewConfig, statusAttributeWithPrefix, statusDefinition, inboxEnabled
    ]);

    // The drag reports where the column landed among the ones on screen, which is not where it
    // landed among them all once some are archived and hidden. Translated here so a reorder leaves
    // every hidden column where it was rather than herding them to the end.
    const handleColumnDrop = useCallback((fromIndex: number, toIndex: number) => {
        columnMovedUntil.current = Date.now() + FLIP_SETTLE_MS;
        // The list the api holds, which is also the one it reorders. A column the board is not
        // showing is in neither, so indexing into `columns` would be off by one.
        const allColumns = api.columns;
        const dropBefore = shownColumns[toIndex];
        const newColumns = api.reorderColumn(
            allColumns.indexOf(shownColumns[fromIndex]),
            dropBefore === undefined ? allColumns.length : allColumns.indexOf(dropBefore));

        if (newColumns) {
            setColumns(newColumns);
        }
        setDraggedColumn(null);
        setDraggedCard(null);
        setColumnDropPosition(null);
    }, [ api, shownColumns ]);

    const { onKeyDown: handleKeyDown, focusColumn, focusCard } = useBoardKeyboard({
        containerRef,
        setActiveColumn,
        columns: shownColumns,
        byColumn,
        api,
        moveColumn: handleColumnDrop,
        insertColumn: useCallback(async (relativeTo: string, direction: "before" | "after") => {
            setColumnNameToEdit(await api.insertColumn(relativeTo, direction));
        }, [ api ])
    });

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        // The column list is read off the definition, which may be edited from the attribute panel,
        // another split, or a synced instance. Re-reading it re-runs the refresh through the effect.
        if (loadResults.getAttributeRows().some(attr => attr.name === `label:${api.statusAttribute}`)) {
            setDefinitionRevision(revision => revision + 1);
        }

        if (findRefreshReason(loadResults, api.statusAttribute, noteIds, parentNote.noteId)) {
            refresh();
        }
    });

    // Measured rather than styled: a collapsed column is a strip, and the placeholder stands in
    // for whichever column is being dragged.
    const placeholderSize = draggedColumn?.size?.width
        ? { width: `${draggedColumn.size.width}px`, height: `${draggedColumn.size.height}px` }
        : undefined;

    return (
        <div className="board-view">
            <CollectionProperties note={parentNote} />
            <BoardActionsContext.Provider value={boardActions}>
                <BoardPromotedAttributesContext.Provider value={shownAttributes}>
                <BoardDragStateContext.Provider value={boardDragState}>
                    {byColumn && columns && <div
                        ref={containerRef}
                        className={clsx("board-view-container", {
                            pannable: isPannable,
                            panning: isPanning
                        })}
                        onKeyDown={handleKeyDown}
                        onContextMenu={openBoardMenu}
                        onWheel={onWheelHorizontalScroll}
                    >
                        {/* The columns are keyed by value, so a reorder moves each column's
                            element with it rather than repurposing elements in place, which would
                            carry the `collapsed` class from one column to another and run its width
                            transition on a column that never collapsed.

                            They are wrapped because a moved element is placed before its next
                            sibling, and the last ones have none: in a parent that also holds the
                            button, the layer and the overlays, Preact appends them past all three.
                            The wrapper lays nothing out, so the columns are still the board's own
                            flex items. */}
                        <div className="board-columns">
                        {shownColumns.map((column, index) => (
                            <Fragment key={column}>
                                {columnDropPosition === index && (
                                    <div
                                        className="column-drop-placeholder show"
                                        style={placeholderSize}
                                    />
                                )}
                                <Column
                                    isInRelationMode={isInRelationMode}
                                    api={api}
                                    parentNote={parentNote}
                                    column={column}
                                    icon={storedColumns.get(column)?.icon}
                                    color={storedColumns.get(column)?.color}
                                    archived={storedColumns.get(column)?.archived}
                                    collapsed={storedColumns.get(column)?.collapsed}
                                    keepCollapsed={storedColumns.get(column)?.keepCollapsed}
                                    isActive={activeColumn === column}
                                    isPeeked={isPeekingAll}
                                    cardTemplates={cardTemplates}
                                    nested={storedColumns.get(column)?.nested}
                                    limit={storedColumns.get(column)?.limit}
                                    columnIndex={index}
                                    columns={shownColumns}
                                    onMoveColumn={handleColumnDrop}
                                    onFocusColumn={focusColumn}
                                    onFocusCard={focusCard}
                                    columnItems={byColumn.get(column)}
                                    isNew={column === createdColumn}
                                />
                            </Fragment>
                        ))}
                        {columnDropPosition === shownColumns.length && draggedColumn && (
                            <div className="column-drop-placeholder show" style={placeholderSize} />
                        )}
                        </div>

                        <AddNewColumn
                            api={api}
                            isInRelationMode={isInRelationMode}
                            columnCount={shownColumns.length}
                            onCreated={setCreatedColumn}
                            isCreating={isCreatingColumn}
                            setIsCreating={setIsCreatingColumn}
                        />
                        {/* Where what is being carried is put. Preact draws the layer and never
                            its contents, so the copy is not among the children it places. */}
                        <div className="board-drag-layer" />
                        {/* Out of the board and onto the page: a dialog is positioned against the
                            window, and Bootstrap puts its backdrop on the body, so a stacking
                            context above the board would trap it underneath. */}
                        {createPortal(
                            <>
                                <ColumnLimitDialog
                                    api={api}
                                    column={columnLimitToEdit}
                                    onClose={() => setColumnLimitToEdit(undefined)}
                                />
                                <BoardProperties
                                    api={api}
                                    note={parentNote}
                                    shown={isEditingProperties}
                                    onClose={() => setIsEditingProperties(false)}
                                />
                            </>,
                            document.body
                        )}
                        {!isMobile() && (
                            <ShortcutHintButton
                                className="board-shortcut-hint-button"
                                placement="bottom-end"
                            />
                        )}
                    </div>}
                </BoardDragStateContext.Provider>
                </BoardPromotedAttributesContext.Provider>
            </BoardActionsContext.Provider>
        </div>
    );
}

/**
 * Names the first change in `loadResults` that the board has to redraw for, or null if none does.
 *
 * A plain note-row change is deliberately not one of them. `getNoteIds()` reports every note in the
 * change set whatever changed about it, so it cannot distinguish a card's title from its content,
 * which no card displays. Cards keep their own title and icon in step instead, and nothing else the
 * board derives comes off the note row: membership is branches, grouping is the status attribute,
 * and `#archived` is a label.
 *
 * Naming the winning check, rather than returning a boolean, is what lets the profiler attribute a
 * redraw to a cause.
 */
export function findRefreshReason(loadResults: LoadResults, statusAttribute: string, noteIds: string[], parentNoteId: string): string | null {
    // A card moved between columns.
    if (loadResults.getAttributeRows().some(attr => attr.name === statusAttribute && noteIds.includes(attr.noteId ?? ""))) {
        return "status-attribute";
    }

    // Subchildren moved, added or removed.
    if (loadResults.getBranchRows().some(branch => noteIds.includes(branch.noteId ?? ""))) {
        return "branch";
    }

    if (loadResults.getAttributeRows().some(attr => [ "iconClass", "color" ].includes(attr.name ?? "") && noteIds.includes(attr.noteId ?? ""))) {
        return "icon-or-color";
    }

    // External changes to the board.json attachment arrive via the viewConfig prop
    // (see useViewModeConfig), which re-triggers the refresh effect.
    if (loadResults.getAttributeRows().some(attr => attr.name === "board:groupBy" && attr.noteId === parentNoteId)) {
        return "group-by";
    }

    return null;
}

function AddNewColumn({
    api, isInRelationMode, columnCount, onCreated, isCreating, setIsCreating
}: {
    api: BoardApi,
    isInRelationMode: boolean,
    /** How many columns stand before this, which is what carries it past the board's edge. */
    columnCount: number,
    /** Names the column just made, which the board reveals as it draws it. */
    onCreated: (column: string) => void,
    /** Whether the editor is open. The board's own menu opens the same one this slot opens. */
    isCreating: boolean,
    setIsCreating: (isCreating: boolean) => void
}) {
    const isCreatingNewColumn = isCreating;
    const setIsCreatingNewColumn = setIsCreating;
    // Kept between columns, as the card editor keeps its own: a run of columns is often a run of
    // the same kind of column.
    const [ icon, setIcon ] = useState(DEFAULT_COLUMN_ICON);
    const slotRef = useRef<HTMLDivElement>(null);

    // Keyed on the count rather than done when the write returns: the column it makes room for is
    // drawn by a refresh that has yet to run at that point, so the board is not yet as wide as it
    // is about to be.
    useLayoutEffect(() => {
        if (!isCreatingNewColumn) {
            return;
        }

        const board = slotRef.current?.closest<HTMLElement>(".board-view-container");
        if (!board) {
            return;
        }

        board.scrollLeft = board.scrollWidth;
    }, [ columnCount, isCreatingNewColumn ]);

    const addColumnCallback = useCallback(() => {
        setIsCreatingNewColumn(true);
    }, []);

    const keydownCallback = useCallback((e: KeyboardEvent) => {
        if (e.key === "Enter") {
            setIsCreatingNewColumn(true);
        }
    }, []);

    return (
        <div
            ref={slotRef}
            className={`board-add-column ${isCreatingNewColumn ? "editing" : ""}`}
            onClick={addColumnCallback}
            onKeyDown={keydownCallback}
            tabIndex={300}
        >
            {!isCreatingNewColumn
                ? <>
                    <Icon icon="bx bx-plus" />{" "}
                    {t("board_view.add-column")}
                </>
                : (
                    <TitleEditor
                        placeholder={t("board_view.add-column-placeholder")}
                        save={async (columnName, atStart) => {
                            const created = await api.addNewColumn(columnName, atStart,
                                icon !== DEFAULT_COLUMN_ICON ? icon : undefined);
                            if (created) {
                                onCreated(columnName);
                            } else {
                                toast.showMessage(t("board_view.column-already-exists"), undefined, "bx bx-duplicate");
                            }
                        }}
                        dismiss={() => setIsCreatingNewColumn(false)}
                        isNewItem
                        // Columns are added in runs as a board is set up, so the editor is left
                        // standing with an empty field. A column named by a note answers for
                        // itself, since picking one is what closes that editor.
                        saveAndContinue={!isInRelationMode}
                        submitTitle={t("board_view.create-new-column")}
                        openPlacements={openCreateColumnMenu}
                        // The same picker the column's own heading carries, so a column is given
                        // its icon as it is named rather than after it stands there.
                        icon={{
                            current: icon,
                            onSelect: setIcon,
                            onReset: icon !== DEFAULT_COLUMN_ICON
                                ? () => setIcon(DEFAULT_COLUMN_ICON)
                                : undefined
                        }}
                        mode={isInRelationMode ? "relation" : "normal"}
                    />
                )}
        </div>
    );
}

export function TitleEditor({
    currentValue, placeholder, save, dismiss, mode, isNewItem, selectOnFocus = true,
    saveAndContinue = false, handsOver = false, returnFocusTo, abandon, whenEmpty, submitTitle,
    openPlacements, icon, footer
}: {
    currentValue?: string;
    placeholder?: string;
    save: (newValue: string, atStart?: boolean) => void | Promise<void>;
    dismiss: () => void;
    isNewItem?: boolean;
    mode?: "normal" | "multiline" | "relation";
    /**
     * Whether Enter saves and clears the editor rather than closing it, so a run of cards can be
     * typed one after another. Enter is then the only thing that saves: Escape and losing focus
     * discard what was typed and close the editor. An editor left standing between cards is walked
     * away from often enough that saving on the way out would create cards nobody asked for.
     */
    saveAndContinue?: boolean;
    /**
     * Whether the field keeps what was typed once it has saved, and saves only once.
     *
     * For an editor the caller takes down as what it made takes its place: emptied instead, the
     * field would stand where the new thing is about to be drawn without holding what it says.
     */
    handsOver?: boolean;
    /** Reports what was typed and not saved, so reopening the editor can restore it. */
    abandon?: (typed: string) => void;
    /**
     * What the button does while the field is empty, drawn as `bx bx-folder-open`. Without it no
     * button is drawn at all until something is typed.
     */
    whenEmpty?: { title: string, onClick?: () => void };
    /** Names what the button creates, shown in its tooltip. */
    submitTitle?: string;
    /**
     * What stands at the foot of the field, inside its own box: the pill naming what a new card
     * will be made from. The field is given room for it.
     */
    footer?: (hold: HoldOpen) => ComponentChildren;
    /**
     * The icon shown inside the field, at the leading edge, which opens the picker when pressed.
     * The caller answers for what a pick does: a card carries it as `iconClass`, and the editor a
     * card is made in keeps it for the next card.
     */
    icon?: { current: string, onSelect: (icon: string) => void, onReset?: () => void };
    /**
     * Opens the menu naming which end to create at, for a `save` that reads `atStart`. Passing it
     * is what gives the button both ends: a right click or a hold opens the menu, Shift+Enter
     * saves at the start.
     */
    openPlacements?: (x: number, y: number, place: (atStart: boolean) => void) => void;
    /**
     * Where focus goes when the editor closes, instead of back to whatever held it before. A card
     * whose editor was opened by an insert passes its own element, so closing does not focus the
     * card the insert was made from.
     */
    returnFocusTo?: RefObject<HTMLElement>;
    /**
     * Whether opening the editor selects the text already in it, which is what a rename wants. An
     * editor opened part-typed puts the caret after the text instead, so the next key continues it.
     */
    selectOnFocus?: boolean;
}) {
    const inputRef = useRef<any>(null);
    /**
     * What the field holds. Kept in state because `FormTextBox` takes its value as a prop: any
     * other render, the button changing icon included, would write a stale prop back over it.
     */
    const [ typed, setTyped ] = useState(currentValue ?? "");
    const isEmpty = !typed.trim();
    const focusElRef = useRef<Element>(null);
    const dismissOnNextRefreshRef = useRef(false);
    const shouldDismiss = useRef(false);
    /**
     * Whether something the field carries is open, during which the editor stays where it is.
     *
     * A menu takes focus with it, and losing focus is what closes this editor: it would take the
     * menu down with itself, which is what the icon picker and the pill naming what a card is made
     * from both do. Held in a ref rather than in state because the blur arrives before the render
     * a state change would schedule; focus goes back to the field as the menu closes, the blur
     * that would have ended the edit being spent.
     */
    const isHoldingOpen = useRef(false);
    const holdOpen = useMemo<HoldOpen>(() => ({
        onOpened: () => { isHoldingOpen.current = true; },
        onClosed: () => {
            isHoldingOpen.current = false;
            inputRef.current?.focus();
        }
    }), []);
    /** Whether the field has already saved, for one that keeps what it saved standing. */
    const hasHandedOver = useRef(false);
    const held = useRef<number>();
    /** Where on the screen the finger went down, against which a scroll is told from a hold. */
    const heldFrom = useRef<{ x: number, y: number }>();
    /** Whether the menu was opened by a hold, whose press ends in a click the menu must survive. */
    const openedByHold = useRef(false);

    useEffect(() => () => window.clearTimeout(held.current), []);

    // Laid out rather than deferred: with the open drawn synchronously, this puts focus on the
    // editor inside the press that asked for it, which is what opens a phone's keyboard.
    useLayoutEffect(() => {
        focusElRef.current = document.activeElement !== document.body ? document.activeElement : null;
        inputRef.current?.focus();

        if (selectOnFocus) {
            inputRef.current?.select();
        } else {
            const end = inputRef.current?.value.length ?? 0;
            inputRef.current?.setSelectionRange(end, end);
        }
    }, [ inputRef ]);

    useEffect(() => {
        if (dismissOnNextRefreshRef.current) {
            dismiss();
            dismissOnNextRefreshRef.current = false;
        }
    });

    const onKeyDown = (e: TargetedKeyboardEvent<HTMLInputElement | HTMLTextAreaElement> | KeyboardEvent) => {
        // Skip processing during IME composition so the Enter that commits a
        // CJK conversion does not also save the title with unconfirmed text.
        if (isIMEComposing(e)) {
            return;
        }

        if (e.key === "Enter" && saveAndContinue) {
            e.preventDefault();
            e.stopPropagation();
            submit(!!openPlacements && e.shiftKey);
            return;
        }

        if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            const target = returnFocusTo?.current ?? focusElRef.current;
            if (target instanceof HTMLElement) {
                shouldDismiss.current = (e.key === "Escape");
                target.focus();
                return;
            }

            // Nothing to hand focus back to, and it is the blur of handing it back that saves. An
            // editor opened by a press on the thing it edits, rather than from something focused,
            // has nowhere to send it, so Enter says here what that blur would have said.
            const typed = inputRef.current?.value ?? "";
            if (e.key === "Enter" && typed.trim() && (typed !== currentValue || isNewItem)) {
                commit(typed);
            }

            dismiss();
        }
    };

    /**
     * Saves what is in the editor and empties it, leaving it open for whatever comes next.
     *
     * @param atStart whether to save at the near end, for an editor that offers both.
     * @param typed what to save, for a menu that read the field when it opened rather than now.
     */
    function submit(atStart?: boolean, typed?: string) {
        const input = inputRef.current;
        const value = typed ?? input?.value ?? "";

        if (value.trim()) {
            if (hasHandedOver.current) {
                return;
            }

            commit(value, atStart);

            if (handsOver) {
                hasHandedOver.current = true;
                input?.focus();
                return;
            }

            if (input) {
                input.value = "";
            }
        }

        input?.focus();
        setTyped("");
    }

    /** Offers both ends, saving what the field held when the menu was opened. */
    function openPlacementMenu(e: JSX.TargetedMouseEvent<HTMLElement>) {
        e.preventDefault();
        e.stopPropagation();
        cancelHold();

        const typed = inputRef.current?.value ?? "";
        openPlacements?.(e.pageX, e.pageY, (atStart) => submit(atStart, typed));
    }

    /** Opens the same menu for a finger, which has no second button to open it with. */
    function holdToPlace(e: JSX.TargetedPointerEvent<HTMLElement>) {
        if (e.pointerType === "mouse") {
            return;
        }

        const { pageX, pageY, clientX, clientY } = e;
        cancelHold();
        heldFrom.current = { x: clientX, y: clientY };
        held.current = window.setTimeout(() => {
            openedByHold.current = true;
            const typed = inputRef.current?.value ?? "";
            openPlacements?.(pageX, pageY, (atStart) => submit(atStart, typed));
        }, HOLD_TO_PLACE_MS);
    }

    function cancelHold() {
        window.clearTimeout(held.current);
        heldFrom.current = undefined;
    }

    /** Gives up on a hold the finger has walked away from, which is a scroll and not a press. */
    function holdMoved(e: JSX.TargetedPointerEvent<HTMLElement>) {
        const from = heldFrom.current;
        if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > HOLD_SLACK_PX) {
            cancelHold();
        }
    }

    function pressed(e: JSX.TargetedMouseEvent<HTMLElement>) {
        cancelHold();

        // A hold ends in a click, which would reach the page and close the menu it just opened.
        if (openedByHold.current) {
            openedByHold.current = false;
            e.stopPropagation();
            return;
        }

        submit(false);
    }

    const onBlur = (newValue: string) => {
        if (isHoldingOpen.current) {
            return;
        }

        if (saveAndContinue) {
            abandon?.(newValue);
            dismiss();
            return;
        }

        if (!shouldDismiss.current && newValue.trim() && (newValue !== currentValue || isNewItem)) {
            commit(newValue);
            dismissOnNextRefreshRef.current = true;
        } else {
            dismiss();
        }
    };

    // The editor is closing either way, and what a save writes has already been put back by
    // whatever could not write it; all that is left is to say so rather than to reject unhandled,
    // which is what a save reaching nobody used to do.
    function commit(newValue: string, atStart?: boolean) {
        Promise.resolve(save(newValue, atStart)).catch((e) => {
            console.error("Failed to save what the board editor was given:", e);
            toast.showError(t("board_view.save-error"));
        });
    }

    if (mode !== "relation") {
        const Element = mode === "multiline" ? FormTextArea : FormTextBox;
        const field = (
            <Element
                inputRef={inputRef}
                currentValue={typed}
                placeholder={placeholder}
                autoComplete="trilium-title-entry" // forces the auto-fill off better than the "off" value.
                rows={mode === "multiline" ? 4 : undefined}
                onKeyDown={onKeyDown}
                onBlur={onBlur}
                onInput={(e) => setTyped(e.currentTarget.value)}
            />
        );

        if (!saveAndContinue && !icon && !footer) {
            return field;
        }

        // A placement applies only to the button that creates. With nothing typed there is nothing
        // to create, so the button stands for whatever the caller offers instead, or for nothing.
        // An editor that saves once, a card being renamed above all, makes nothing and offers none.
        const offersPlacement = !!openPlacements && !isEmpty;
        const madeBy = submitTitle ?? t("board_view.add-new-item");
        const offered = isEmpty
            ? whenEmpty && {
                icon: "bx bx-folder-open", title: whenEmpty.title, onClick: whenEmpty.onClick
            }
            : saveAndContinue && {
                icon: "bx bx-plus-circle",
                title: offersPlacement
                    ? `<span class="action">${escapeHtml(madeBy)}</span>`
                        + `<span class="hint">${escapeHtml(t("board_view.create-hold-hint"))}</span>`
                    : madeBy,
                onClick: pressed
            };

        return (
            <div className={clsx("title-editor-field", {
                "with-submit": saveAndContinue,
                "with-footer": !!footer
            })}>
                {/* The press that opens the picker must not take focus out of the field: the
                    blur arrives before the picker reports itself open, and losing focus is what
                    closes the editor. */}
                {icon && (
                    <span onMouseDown={(e) => e.preventDefault()}>
                        <IconPickerButton
                            className="title-editor-icon"
                            icon={icon.current}
                            title={t("board_view.change-note-icon")}
                            onSelect={icon.onSelect}
                            onReset={icon.onReset}
                            // A grid of a thousand icons and a search field is a task of its own,
                            // so the board behind it is dimmed rather than left looking pressable.
                            backdrop
                            {...holdOpen}
                        />
                    </span>
                )}
                {field}
                {/* The press must not take focus out of the field first: losing it is what closes
                    the editor, and it would be gone before the click arrived. */}
                {offered && (
                    <span
                        onMouseDown={(e) => e.preventDefault()}
                        onPointerDown={offersPlacement ? holdToPlace : undefined}
                        onPointerUp={cancelHold}
                        onPointerMove={holdMoved}
                        onPointerCancel={cancelHold}
                        onContextMenu={offersPlacement ? openPlacementMenu : undefined}
                    >
                        <ActionButton
                            className="title-editor-submit"
                            icon={offered.icon}
                            text={offered.title}
                            tooltipHtml={offersPlacement}
                            tooltipClass={
                                offersPlacement ? "title-editor-submit-tooltip" : undefined}
                            onClick={offered.onClick}
                        />
                    </span>
                )}
                {/* Inside the field's own box, in the room made for it below the text. The press
                    must not take focus out of the field, which is what closes the editor. */}
                {footer && (
                    <span
                        className="title-editor-footer"
                        onMouseDown={(e) => e.preventDefault()}
                    >{footer(holdOpen)}</span>
                )}
            </div>
        );
    }
    return (
        <NoteAutocomplete
            inputRef={inputRef}
            noteId={currentValue ?? ""}
            opts={{
                hideAllButtons: true,
                allowCreatingNotes: true
            }}
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    dismiss();
                }
            }}
            onBlur={() => dismiss()}
            noteIdChanged={(newValue) => {
                save(newValue);
                dismiss();
            }}
        />
    );

}
