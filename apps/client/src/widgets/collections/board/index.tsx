import "./index.css";

import clsx from "clsx";

import { ComponentChildren, createContext, Fragment, TargetedKeyboardEvent } from "preact";
import { JSX } from "preact/jsx-runtime";
import { createPortal, RefObject } from "preact/compat";
import {
    Dispatch, StateUpdater, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState
} from "preact/hooks";

import { type HighlightedTokenInfo, normalizeBoardGroupBy } from "@triliumnext/commons";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import { getCreationDate, loadCreationDates } from "../../../services/note_dates";
import type LoadResults from "../../../services/load_results";
import { ContextMenuEvent } from "../../../menus/context_menu";
import { isIMEComposing } from "../../../services/shortcuts";
import type { ShortcutHintDefinition } from "../../../services/shortcut_hints";
import toast from "../../../services/toast";
import ws from "../../../services/ws";
import { escapeHtml, isMobile } from "../../../services/utils";
import { type NoteTypeOption, resolveNoteTypeOptions } from "../../../services/note_types";
import { type PromotedAttributeSetting, resolvePromotedAttributes } from "../promoted_attributes";
import type { SortContext } from "../sorting";
import CollectionProperties from "../../note_bars/CollectionProperties";
import FormTextArea from "../../react/FormTextArea";
import FormTextBox from "../../react/FormTextBox";
import {
    useContextualShortcutHints, useNoteContext, useNoteLabel, useNoteLabelBoolean,
    useNoteLabelWithDefault, useNoteTypeOptions, useSetContextData, useTrackedElement, useTriliumEvent
} from "../../react/hooks";
import Icon from "../../react/Icon";
import NoteAutocomplete from "../../react/NoteAutocomplete";
import ShortcutHintButton from "../../shortcut_hints/shortcut_hint_button";
import { onWheelHorizontalScroll } from "../../widget_utils";
import ActionButton from "../../react/ActionButton";
import { IconPickerButton } from "../../react/IconPicker";
import { useDragPan } from "../../react/drag_pan";
import { FLIP_SETTLE_MS, useFlip } from "../../react/flip";
import { SelectionContext, SelectionStore } from "../../react/selection";
import { CollectionFilterInput, useCollectionFilter } from "../collection_filter";
import { ViewModeProps } from "../interface";
import Api, { getPendingWrites, PendingColumnWrites, settleColumn } from "./api";
import { useBoardDrag } from "./board_drag";
import { columnGapStandsAside, columnStandsAside, movesColumn } from "./drag_geometry";
import { forgetCardHeights } from "./drag_measure";
import { forgetWindowHeights } from "./windowing";
import { BoardDropStateContext, DropStateStore } from "./drop_state";
import BoardApi from "./api";
import { adoptLegacyColumns, readColumns } from "./column_storage";
import {
    COLUMN_WIDTH_LABEL, columnWidthClass, DEFAULT_COLUMN_ICON, DEFAULT_GROUP_BY,
    getStatusDefinition, INBOX_COLUMN
} from "./columns";
import Column, { EXPAND_MS, placeCard, settleCards } from "./column";
import { currentCardTemplate, DEFAULT_CARD_TEMPLATES } from "./card_templates";
import ColumnLimitDialog from "./column_limit";
import BoardGroupBy, { groupingOptions } from "./group_by";
import BoardProperties from "./properties";
import { openBoardContextMenu, openCreateColumnMenu } from "./context_menu";
import { useBoardSort } from "./sort";
import {
    affectsSortOrder, applyCardMoves, ColumnMap, filterColumnMap, getBoardData, resolveColumnSorts,
    resolveSortWatch, sortColumnMap, unfilteredCardIndex
} from "./data";
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
    /**
     * The columns of the default grouping. Every other grouping keeps its own list under
     * `<attribute>ViewColumns`, so switching the grouping cannot mix two of them.
     */
    columns?: BoardColumnData[];
    /** @see BoardViewData.columns */
    [key: `${string}ViewColumns`]: BoardColumnData[] | undefined;
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
    /** The search query the board is narrowed to, absent while no filter is active. */
    filterQuery?: string;
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
    /**
     * How the column orders its cards, as `SortKey` in `collections/sorting` spells it. Absent for
     * the manual order, which is the order of the board's children.
     */
    orderBy?: string;
    /** Whether that order runs backwards. Absent while it runs forwards. */
    descendingOrder?: boolean;
}

interface CardDrag {
    noteId: string;
    /**
     * Every card on the move, this one among them. One entry unless the card was taken hold of as
     * part of a selection; absent for a drag from the note tree, which carries no card.
     */
    noteIds?: string[];
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
    /** How much room it takes out of the row, its width and the gap after it. */
    stride?: number;
    /** Where each column stood before it was taken out, and where one added at the end would. */
    lefts?: number[];
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
    /**
     * Reports whether a column holds an open insert field, which the board reads to raise the
     * backdrop. Held here rather than matched with `:has()` in the stylesheet: a `:has()` naming a
     * descendant makes every card insertion invalidate the whole board, which on a column of
     * thousands is hundreds of milliseconds of style recalculation per card added.
     */
    setInsertingColumn: (column: string, isOpen: boolean) => void;
}

/**
 * The half that changes when a card or column is taken hold of and let go of, or a title is edited.
 *
 * Where the gap stands is not here: it changes on every step of a drag, and a context does that to
 * every column at once. It is held in a {@link DropStateStore} instead, which each column asks
 * about itself.
 */
interface BoardDragState {
    branchIdToEdit?: string;
    columnNameToEdit?: string;
    draggedCard: CardDrag | null;
    draggedColumn: ColumnDrag | null;
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
    setDropTarget: () => undefined,
    setInsertingColumn: () => undefined
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
    draggedColumn: null
});

/**
 * The tokens the active filter matched by, which the cards highlight in their titles. A context
 * rather than a prop, so a memoized card is not redrawn for it during a drag.
 */
export const BoardHighlightTokensContext = createContext<HighlightedTokenInfo[] | null>(null);

/** The cards drawn although the filter does not match them, which say as much on their face. */
export const BoardKeptCardsContext = createContext<Set<string>>(new Set());

/**
 * What the board answers with when asked for contextual keyboard help. Every entry is a key the
 * board handles itself (see `keyboard.ts` and the card and column handlers), none of them
 * rebindable, so each is listed literally rather than through a registered action.
 */
/** Shared empty set for a board with no insert field open, so no render allocates one. */
const NO_COLUMNS: ReadonlySet<string> = new Set();

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
    },
    {
        titleKey: "board_view.hints.selection",
        hints: [
            { keys: [ "Ctrl+A" ], labelKey: "board_view.hints.select_column" },
            { keys: [ "Escape" ], labelKey: "board_view.hints.clear_selection" }
        ]
    }
];

export default function BoardView({
    note: parentNote, noteIds, viewConfig: storedConfig, saveConfig
}: ViewModeProps<BoardViewData>) {
    const { noteContext } = useNoteContext();
    const [ requestedGroupBy, setRequestedGroupBy ] =
        useNoteLabelWithDefault(parentNote, "board:groupBy", DEFAULT_GROUP_BY);
    /**
     * The grouping the board draws and writes for.
     *
     * It follows `#board:groupBy` only once the columns of the grouping it names are resolved, so
     * no write can put one grouping's columns under another's key. A different board takes its
     * label at once: it has no previous grouping of its own to keep in step.
     */
    const [ committed, setCommitted ] = useState({ note: parentNote, groupBy: requestedGroupBy });
    const groupBy = committed.note === parentNote ? committed.groupBy : requestedGroupBy;
    // A board that has never had its grouping switched keeps its columns under `columns`. They
    // belong to the grouping it opened on, and are moved under that grouping's own key before
    // anything reads them. Read from the label the board opened with rather than from the grouping
    // in force: switching to another one must not carry the columns of the one being left.
    const openedOn = useRef({ note: parentNote, groupBy: requestedGroupBy });
    if (openedOn.current.note !== parentNote) {
        openedOn.current = { note: parentNote, groupBy: requestedGroupBy };
    }
    const openedOnGroupBy = openedOn.current.groupBy;
    const adoptedConfig = useMemo(
        () => adoptLegacyColumns(storedConfig, openedOnGroupBy), [ storedConfig, openedOnGroupBy ]);
    let viewConfig = adoptedConfig ?? storedConfig;
    const [ includeArchived ] = useNoteLabelBoolean(parentNote, "includeArchived");
    const [ inboxEnabled ] = useNoteLabelBoolean(parentNote, "enableInboxColumn");
    // Read undefaulted: a board naming no width wears no class, so `--board-column-width` keeps
    // whatever it inherits.
    const [ storedColumnWidth ] = useNoteLabel(parentNote, COLUMN_WIDTH_LABEL);
    /** Every card the board holds, which an active filter narrows before the cards are drawn. */
    const [ allByColumn, setAllByColumn ] = useState<ColumnMap>();
    const [ columns, setColumns ] = useState<string[]>();
    const [ isInRelationMode, setIsRelationMode ] = useState(false);
    const [ draggedCard, setDraggedCard ] = useState<CardDrag | null>(null);
    /** The column just added, which is revealed once the board has drawn it. */
    const [ createdColumn, setCreatedColumn ] = useState<string>();
    /**
     * The card just dropped on a sorted column, drawn with the same reveal a new card gets.
     *
     * `sortColumnMap` can put it anywhere among the cards, so the reveal is how the user finds it.
     */
    const [ landedNoteId, setLandedNoteId ] = useState<string>();
    /**
     * Where the gap stands, kept out of the board's state so that a step of a drag draws no column
     * the gap is not near.
     */
    const dropState = useMemo(() => new DropStateStore(), []);
    /**
     * Which cards are picked out, kept out of the board's state for the same reason: selecting one
     * card must wake that card and no other.
     */
    const selection = useMemo(() => new SelectionStore(), []);
    const setDropPosition = useCallback((position: ColumnDrag | null) => {
        dropState.set({ ...dropState.get(), position });
    }, [ dropState ]);
    const setDropTarget = useCallback((target: string | null) => {
        dropState.set({ ...dropState.get(), target });
    }, [ dropState ]);
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
    /** Adds `frozen`, which takes `pointer-events` off the cards. Set once the backdrop has faded in. */
    const [ isFrozen, setIsFrozen ] = useState(false);
    /** The columns holding an open insert field, which each column reports for itself. */
    const [ insertingColumns, setInsertingColumns ] = useState<ReadonlySet<string>>(NO_COLUMNS);
    const setInsertingColumn = useCallback((column: string, isOpen: boolean) => {
        setInsertingColumns((current) => {
            if (current.has(column) === isOpen) {
                return current;
            }

            const next = new Set(current);
            if (isOpen) {
                next.add(column);
            } else {
                next.delete(column);
            }

            return next;
        });
    }, []);
    const selectColumn = useCallback<Dispatch<StateUpdater<string | undefined>>>((column) => {
        setIsPeekingAll(false);
        setActiveColumn(column);
    }, []);
    // How many card moves are still being written. The board is drawn as they will leave it, so a
    // redraw from the first of a move's two writes would take that back.
    const movesInFlight = useRef(0);
    /** Bumped when the definition changes, since it is read off the note rather than held in state. */
    const [ definitionRevision, setDefinitionRevision ] = useState(0);
    /** Bumped when the titles or dates a sort reads change, since neither is held in state. */
    const [ sortRevision, setSortRevision ] = useState(0);
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
    const boardIdentity = `${parentNote.noteId}|${groupBy}`;
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
        () => getStatusDefinition(parentNote, groupBy),
        [ parentNote, groupBy, definitionRevision ]);
    // One api for as long as the board is shown, pointed at each refresh's data rather than built
    // again: a new object would be a new prop on every card, and `memo` would then redraw all of
    // them for a move that touched one. Another board takes a new one, since this instance is
    // reused across boards and the api holds that board's record of the writes in flight.
    const apiRef = useRef<{ board: string, api: Api }>();
    const persistFilterQuery = useCallback(
        (query: string) => apiRef.current?.api.setFilterQuery(query), []);
    const filter = useCollectionFilter(parentNote, {
        persistedQuery: viewConfig?.filterQuery,
        onQueryChanged: persistFilterQuery,
        collectionNoteIds: noteIds
    });
    const statusAttribute = groupBy.replace(/^[~#]/, "");
    // Every promoted attribute the board defines, hidden ones included: a column can sort by a
    // field its cards do not draw.
    const promotedAttributes = useMemo(
        () => resolvePromotedAttributes(
            parentNote, viewConfig?.promotedAttributes, [ statusAttribute ]),
        [ parentNote, viewConfig, statusAttribute, definitionRevision ]);
    // Keyed on the label rather than on the committed grouping, so the button names what the reader
    // just picked while the columns below are still being read.
    const groupingChoices = useMemo(
        () => groupingOptions(parentNote, viewConfig?.promotedAttributes, requestedGroupBy),
        [ parentNote, viewConfig, requestedGroupBy, definitionRevision ]);
    const currentGrouping = normalizeBoardGroupBy(requestedGroupBy) || DEFAULT_GROUP_BY;
    const defaultSort = useBoardSort(parentNote);
    const columnSorts = useMemo(
        () => resolveColumnSorts(readColumns(viewConfig, groupBy), defaultSort, usableColumns),
        [ viewConfig, groupBy, defaultSort, usableColumns ]);
    const sortContext = useMemo<SortContext>(() => ({
        definitions: new Map(promotedAttributes.map(attribute => [ attribute.name, attribute ])),
        creationDate: getCreationDate,
        noteTitle: (noteId) => froca.getNoteFromCache(noteId)?.title
    }), [ promotedAttributes ]);
    // Sorted before the filter: `filterColumnMap` keeps the order it is given, so a card the
    // filter hides cannot change where the others stand. `sortRevision` is a dependency because
    // the dates and titles `sortContext` reads live outside the render.
    const sortedByColumn = useMemo(
        () => (allByColumn ? sortColumnMap(allByColumn, columnSorts, sortContext) : undefined),
        [ allByColumn, columnSorts, sortContext, sortRevision ]);
    // The cards as drawn. Derived rather than held, so what is shown cannot fall behind what the
    // filter matches, and withheld until a query stored in `board.json` has said what it matches.
    const byColumn = useMemo(
        () => (sortedByColumn && !filter.isResolvingStoredQuery
            ? filterColumnMap(sortedByColumn, filter.shownNoteIds)
            : undefined),
        [ sortedByColumn, filter.shownNoteIds, filter.isResolvingStoredQuery ]);
    const sortWatch = useMemo(
        () => resolveSortWatch(allByColumn, columnSorts, sortContext.definitions),
        [ allByColumn, columnSorts, sortContext ]);

    // A card the board has stopped drawing, because it was deleted, archived out of view or moved
    // off the board, leaves the selection with it. A command would otherwise write to a note the
    // reader can no longer see.
    useEffect(() => {
        if (byColumn) {
            selection.retain(new Set([ ...byColumn.values() ]
                .flatMap((items) => items.map((item) => item.note.noteId))));
        }
    }, [ byColumn, selection ]);

    if (!apiRef.current || apiRef.current.board !== boardIdentity) {
        apiRef.current = {
            board: boardIdentity,
            api: new Api(
                byColumn, usableColumns, parentNote, groupBy, viewConfig,
                saveConfig, setBranchIdToEdit, pendingRenamesRef.current.writes, statusDefinition,
                allByColumn, filter.keepNote)
        };
    } else {
        apiRef.current.api.update(
            byColumn, usableColumns, parentNote, groupBy, viewConfig,
            saveConfig, setBranchIdToEdit, statusDefinition, allByColumn, filter.keepNote);
    }
    const api = apiRef.current.api;
    // Set here rather than passed in: the api outlives a refresh, and the board can be drawn in a
    // pane other than the focused one.
    api.noteContext = noteContext;
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
        setDropTarget,
        setInsertingColumn
    }), [
        setBranchIdToEdit, setColumnNameToEdit, setColumnLimitToEdit, selectColumn,
        setDraggedCard, setDraggedColumn, setDropPosition, setDropTarget, setInsertingColumn
    ]);

    // Read off the config rather than off `columns`, which the resolver hands back as names alone.
    const storedColumns = useMemo(
        () => new Map((readColumns(viewConfig, groupBy) ?? []).map(
            stored => [ stored.value, stored ])),
        [ viewConfig, groupBy ]);

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

    // What the right pane lists the board as, and what a press on one of its entries does.
    //
    // Held still between renders: the pane redraws its list whenever this changes identity, and a
    // board renders on every step of a drag. `storedColumns` is among what it is held against
    // because the api reads the config in place, so nothing else here changes when it does.
    const outline = useMemo(() => ({
        columns: api.getColumnOutline(shownColumns),
        scrollToColumn: (column: string) => {
            const element = columnElement(containerRef.current, column);
            element?.scrollIntoView({ inline: "start", block: "nearest", behavior: "smooth" });
            // The heading takes the focus, so the board's own keys carry on from the column the
            // reader picked. Scrolled first, and without moving anything itself: focus landing on
            // its own would jump the board to the column the scroll is already easing towards.
            element?.querySelector<HTMLElement>("h3")?.focus({ preventScroll: true });
        }
    }), [ api, shownColumns, byColumn, storedColumns, isInRelationMode ]);
    useSetContextData(noteContext, "boardColumns", outline);

    // Neither the creation dates the tie-break needs nor the targets of a sorted relation come
    // with the board. Both are fetched here, and `sortRevision` redraws it once they land.
    useEffect(() => {
        if (!sortWatch.noteIds.size) {
            return;
        }

        let isCancelled = false;
        const settle = (isLoaded: boolean) => {
            if (isLoaded && !isCancelled) {
                setSortRevision(revision => revision + 1);
            }
        };

        loadCreationDates(sortWatch.noteIds)
            .then(settle)
            .catch((error) => console.error("Failed to load the card creation dates:", error));

        const missingTargets = [ ...sortWatch.targetNoteIds ]
            .filter(noteId => !froca.getNoteFromCache(noteId));
        if (missingTargets.length) {
            froca.getNotes(missingTargets, true)
                .then(() => settle(true))
                .catch((error) => console.error("Failed to load the sorted relations:", error));
        }

        return () => { isCancelled = true; };
    }, [ sortWatch ]);

    // What a card measures is kept between drags, which holds while a column is the width it was
    // measured at. A phone gives a column a share of the window, so a window that changes size
    // takes the heights with it.
    useEffect(() => {
        const forget = () => {
            forgetCardHeights();
            forgetWindowHeights();
        };

        window.addEventListener("resize", forget);
        return () => window.removeEventListener("resize", forget);
    }, []);

    // Which columns stand narrow, as a line, so that one opening or closing is read off a single
    // comparison. A column changing width hides or shows its own cards and moves no card inside
    // any other, so there is nothing for any column to measure while it is happening.
    const columnResizingUntil = useRef(0);
    const columnWidths = useRef<string>();
    const widths = shownColumns
        .map(column => storedColumns.get(column)?.collapsed
            && column !== activeColumn && !isPeekingAll ? "1" : "0")
        .join("");
    if (columnWidths.current !== undefined && columnWidths.current !== widths) {
        columnResizingUntil.current = Date.now() + EXPAND_MS;
    }
    columnWidths.current = widths;
    const isResizingColumns = Date.now() < columnResizingUntil.current;

    const boardDragState = useMemo<BoardDragState>(() => ({
        branchIdToEdit,
        columnNameToEdit,
        draggedCard,
        draggedColumn
    }), [ branchIdToEdit, columnNameToEdit, draggedCard, draggedColumn ]);

    /**
     * Reads the board and draws it.
     *
     * @param target the grouping to read, which defaults to what `#board:groupBy` names. Where that
     *               is one the board has not moved to yet, the refresh only reads: it hands the new
     *               grouping's cards and columns over and commits the switch, and the refresh that
     *               commit triggers is what stores anything, with the api on the grouping it stores
     *               for.
     */
    function refresh(target = requestedGroupBy) {
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
        // Compared by main context, not `noteContext.isActive()`: that names one pane across the
        // whole app, so a board in a split the reader is not focused on is on screen but would
        // never redraw, the `ResizeObserver` above having no size change to report.
        // Only once it has drawn: a board opened straight into a background tab has to draw at
        // least once, or there is no container to notice the tab being shown and it stays empty.
        // Nothing is deferred where the active tab cannot be read, so an answer that has yet to
        // arrive leaves the board drawn rather than blank.
        const shownTab = appContext.tabManager?.getActiveMainContext();
        if (byColumn && noteContext && shownTab && shownTab !== noteContext.getMainContext()) {
            isStale.current = true;
            return;
        }

        // `getBoardData` reads notes, so refreshes can resolve out of order and one issued for the
        // board the user has left can arrive after the next board's. What it has to say is about
        // sources no longer on screen, the pending renames it reports as settled included.
        const refreshId = ++refreshSeqRef.current;
        const isSwitching = target !== groupBy;
        // Read for the grouping being drawn. The renames belong to the grouping the board is on,
        // and its columns are not the ones being resolved here.
        const definition = isSwitching ? getStatusDefinition(parentNote, target) : statusDefinition;
        const renames = isSwitching
            ? new Map<string, string | undefined>()
            : pendingRenamesRef.current.writes.renames;

        getBoardData(
            parentNote, target, viewConfig ?? {}, includeArchived,
            definition?.options ?? [], renames, inboxEnabled)
            .then(({
                byColumn: allCards, columns, newPersistedData, isInRelationMode, settledRenames
            }) => {
                if (refreshId !== refreshSeqRef.current) {
                    return;
                }

                if (!isSwitching) {
                    for (const settled of settledRenames) {
                        settleColumn(pendingRenamesRef.current.writes, settled);
                    }
                }

                setAllByColumn(allCards);
                setIsRelationMode(isInRelationMode);
                setColumns(columns);

                // The cards, the columns and the api that writes for them move to the new grouping
                // together. Nothing is stored from here: the api still writes for the grouping the
                // board is leaving.
                if (isSwitching) {
                    setCommitted({ note: parentNote, groupBy: target });
                    return;
                }

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
                if (newPersistedData && !readColumns(viewConfig, groupBy)?.length) {
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

                api.syncColumnsToDefinition(columns, groupBy)
                    .catch((e) => console.error("Failed to sync the board columns to the attribute definition:", e));
            });
    }

    // The gesture drives the same state a drag from the note tree does, so the placeholders and the
    // card's own dimming are drawn from one place whichever brought the card here.
    const { isDragging: isDraggingItem, remeasure } = useBoardDrag(containerRef, {
        carriedWith: (noteId) => (selection.has(noteId)
            ? api.getCards(selection.keys).map((card) => card.note.noteId)
            : [ noteId ]),
        onCardStart: (card) => {
            // The card leaves the flow and the gap opens in its place, which eased would read as
            // the column closing up and sliding back open.
            holdStill();
            // A card taken hold of from outside the selection travels alone, and what was picked
            // out is given up: those cards stay where they are, and would still read as selected.
            if (!selection.has(card.noteId)) {
                selection.clear();
            }
            setDraggedCard({
                noteId: card.noteId,
                noteIds: card.noteIds,
                branchId: byColumn?.get(card.fromColumn)?.[card.index]?.branch.branchId ?? "",
                fromColumn: card.fromColumn,
                index: card.index,
                height: card.height
            });
        },
        onCardMove: (position, inside) => {
            // Written together: two writes would wake every column watching the gap twice over.
            dropState.set({ position, target: position?.column ?? null });
            // Answers for what a `dragover` did, for a collapsed column the card is actually over:
            // one merely passed near keeps to itself, and one already opened stays open, since
            // closing it under a drag would move every column after it.
            if (position && inside && storedColumns.get(position.column)?.collapsed) {
                selectColumn(position.column);
            }
        },
        onCardEnd: (card, position) => {
            // The reorder gives the cards below the gap the layout their `translateY` was
            // standing in for, so clearing it under a transition would slide them up.
            holdStill();
            // Put back here rather than left to the columns to draw: the board is about to move a
            // card, hide the gap and close the room it took, and if those reach the screen in
            // separate frames the reader sees a gap open where nothing is being carried any more.
            closeGaps(containerRef.current);
            // Every card on the move, in the order the board draws them, with the branches they
            // are moved by. One entry unless the card was carried as part of a selection.
            const carried = api.getCards(new Set(card.noteIds));
            const isSortedTarget = !!position && columnSorts.has(position.column);
            // A drop inside a sorted column changes nothing: `sortColumnMap` already placed the
            // cards. Only while every card carried is already there; one from another column still
            // has to be filed under this one.
            const allInTarget = !!position && carried.every((item) =>
                api.getCardColumn(item.note.noteId) === position.column);
            if (isSortedTarget && allInTarget) {
                setDraggedCard(null);
                dropState.set({ position: null, target: null });
                focusCard(card.noteId);
                return;
            }

            if (position && carried.length && byColumn && allByColumn) {
                // Drawn at once, into `allByColumn` since that is what `byColumn` derives from, at
                // the index `unfilteredCardIndex` translates rather than the visible drop index.
                // The index does not matter for a sorted column: `sortColumnMap` reorders the
                // map afterwards.
                setAllByColumn(applyCardMoves(
                    allByColumn, carried.map((item) => item.note.noteId), position.column,
                    unfilteredCardIndex(
                        byColumn.get(position.column) ?? [],
                        allByColumn.get(position.column) ?? [],
                        position.index)));
                if (isSortedTarget) {
                    setLandedNoteId(card.noteId);
                }
                movesInFlight.current++;
                // As `holdMove` does for a move made by the keyboard, and for the same reason: the
                // board is held where the drop has drawn it until `froca` has the changes.
                refreshSeqRef.current++;
                api.moveWithinBoard(
                    carried.map((item) => ({
                        noteId: item.note.noteId,
                        branchId: item.branch.branchId
                    })),
                    position.column, position.index)
                    .then(settled)
                    .finally(() => { movesInFlight.current--; });
            }
            setDraggedCard(null);
            dropState.set({ position: null, target: null });
            // Asked for by name: the card is drawn again where it landed, and a card that crossed
            // columns is drawn as a new element, so the one that was focused is gone.
            focusCard(card.noteId);
            if (position) {
                revealColumn(position.column);
            }
        },
        onColumnStart: (column, index, size, row) => setDraggedColumn({
            column, index, size, stride: row.stride, lefts: row.lefts
        }),
        onColumnMove: setColumnDropPosition,
        onColumnEnd: (from, to) => {
            // The row is drawn again as the gesture lets go, and the columns land where their
            // transforms already had them. No card moves inside a column for that, so the same
            // window that covers a column changing width covers this too.
            columnResizingUntil.current = Date.now() + EXPAND_MS;
            if (to !== null && movesColumn(from, to)) {
                // The transforms come off in the same frame the row is drawn in its new order,
                // where each column already stands where that order puts it. Eased to zero they
                // would carry it a column's width from a place it never stood in, so the frame
                // that takes them off runs without a transition.
                holdStill();
                // Not animated either: the row puts the columns exactly where they already are.
                handleColumnDrop(from, to, false);
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
        // catch up with one another; sliding for that animates a rename as a move. A carried
        // column is left out as well: the columns beside it are moved by their own transforms,
        // which this would measure and then slide back from.
        disabled: !!draggedColumn || Date.now() > columnMovedUntil.current
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
            columnElement(containerRef.current, column)
                ?.scrollIntoView({ inline: "center", block: "nearest" });
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
    // The same holds across a grouping, whose columns are a different set entirely.
    useEffect(() => selectColumn(undefined), [ parentNote, groupBy, selectColumn ]);

    // Stored once, and only for a board still carrying a pre-switching column list.
    useEffect(() => {
        if (adoptedConfig) {
            saveConfig(adoptedConfig);
        }
    }, [ adoptedConfig, saveConfig ]);

    // `groupBy` is a dependency as well as `requestedGroupBy`: committing a switch is what asks for
    // the refresh that stores the new grouping's columns.
    useEffect(refresh, [
        parentNote, noteIds, viewConfig, requestedGroupBy, groupBy, statusDefinition, inboxEnabled
    ]);

    // The drag reports where the column landed among the ones on screen, which is not where it
    // landed among them all once some are archived and hidden. Translated here so a reorder leaves
    // every hidden column where it was rather than herding them to the end.
    /**
     * Draws the next frame without transitions, for the lift and the drop, where every element is
     * already standing where it is about to be drawn.
     *
     * Let go a frame later than the one that draws it, a frame's callbacks running before the
     * styles it paints are worked out.
     */
    const stillFor = useRef<number>();
    const holdStill = useCallback(() => {
        const container = containerRef.current;
        container?.classList.add("board-still");
        // Started afresh on every call: a lift and the drop that follows it a frame later would
        // otherwise be let go on the first one's schedule, before the drop has been drawn.
        if (stillFor.current !== undefined) {
            cancelAnimationFrame(stillFor.current);
        }

        stillFor.current = requestAnimationFrame(() => {
            stillFor.current = requestAnimationFrame(() => {
                stillFor.current = undefined;
                container?.classList.remove("board-still");
            });
        });
    }, []);

    // A board taken off the page leaves nothing of a gesture behind it to run in a later frame.
    // The container is held from the mount: a ref is empty again by the time this is called.
    useEffect(() => {
        const container = containerRef.current;
        return () => {
            if (stillFor.current !== undefined) {
                cancelAnimationFrame(stillFor.current);
            }

            settleCards(container);
        };
    }, []);

    const handleColumnDrop = useCallback((fromIndex: number, toIndex: number, animate = true) => {
        if (animate) {
            columnMovedUntil.current = Date.now() + FLIP_SETTLE_MS;
        }
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

    /**
     * Draws a move where it will leave the cards and holds the board there until the writes are in.
     *
     * A move is a write per card that changes column and one per branch being placed, and each
     * lands a redraw of its own. Drawn as they arrive, the cards are seen to shuffle into place one
     * after another: under their new column in the order their old branches give them, then each
     * into the position the next write settles. The board is drawn where the move ends instead.
     */
    const holdMove = useCallback((
        cards: { noteId: string, branchId: string }[],
        targetColumn: string,
        targetIndex: number,
        done: Promise<unknown>
    ) => {
        if (allByColumn) {
            setAllByColumn(applyCardMoves(
                allByColumn, cards.map((card) => card.noteId), targetColumn, targetIndex));
        }

        movesInFlight.current++;
        // Any refresh already on its way is about the board as it stood before the move, and would
        // put the cards back where they came from as it resolves.
        refreshSeqRef.current++;

        // Held until `froca` has the changes, not merely until the server has answered for them:
        // the answers come back over HTTP and the changes over the websocket, so a refresh let
        // through in between reads a board with some of the cards moved and the rest still where
        // they were, and draws that.
        return done
            .then(settled)
            .finally(() => { movesInFlight.current--; });
    }, [ allByColumn ]);

    /** Sends cards to the end of another column, which is where the keyboard puts them. */
    const sendCardsToColumn = useCallback((
        cards: { noteId: string, branchId: string }[], targetColumn: string
    ) => holdMove(
        // The end of the column itself, not of what a filter leaves showing of it: the move is
        // drawn into `allByColumn`, so a place counted among the shown cards would put the card
        // partway up the column and leave it to jump to the end as the write lands.
        cards, targetColumn, allByColumn?.get(targetColumn)?.length ?? 0,
        api.moveToColumnEnd(cards, targetColumn)),
    [ api, holdMove, allByColumn ]);

    /** Moves cards to a place among the ones already in a column. */
    const moveCardsWithin = useCallback((
        cards: { noteId: string, branchId: string }[], column: string, index: number
    ) => holdMove(
        cards, column,
        unfilteredCardIndex(byColumn?.get(column) ?? [], allByColumn?.get(column) ?? [], index),
        api.moveWithinBoard(cards, column, index)),
    [ api, holdMove, byColumn, allByColumn ]);

    const clearSelectionOutsideCards = useCallback((e: MouseEvent) => {
        if (!(e.target as HTMLElement | null)?.closest(".board-note")) {
            selection.clear();
        }
    }, [ selection ]);

    const { onKeyDown: handleBoardKeys, focusColumn, focusCard } = useBoardKeyboard({
        containerRef,
        setActiveColumn,
        columns: shownColumns,
        byColumn,
        api,
        moveColumn: handleColumnDrop,
        selection,
        sendCardsToColumn,
        moveCardsWithin,
        insertColumn: useCallback(async (relativeTo: string, direction: "before" | "after") => {
            setColumnNameToEdit(await api.insertColumn(relativeTo, direction));
        }, [ api ])
    });

    // Escape gives the selection up, before the board's own keys are offered the press: nothing
    // else on the board answers for Escape, and a reader who has picked cards out expects it to
    // undo that first.
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "Escape" && selection.size) {
            e.stopPropagation();
            selection.clear();
            return;
        }

        handleBoardKeys(e);
    }, [ selection, handleBoardKeys ]);

    // The note actions menu offers the properties dialog, which lives here rather than in the menu.
    useTriliumEvent("showBoardProperties", ({ ntxId }) => {
        if (ntxId === noteContext?.ntxId) {
            setIsEditingProperties(true);
        }
    });

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        // The column list is read off the definition, which may be edited from the attribute panel,
        // another split, or a synced instance. Re-reading it re-runs the refresh through the effect.
        // Any definition the board carries, not only the grouping's: the others are what it offers
        // to group by instead.
        if (loadResults.getAttributeRows().some(attr =>
                attr.name?.startsWith("label:") && attributes.isAffecting(attr, parentNote))) {
            setDefinitionRevision(revision => revision + 1);
        }

        // `findRefreshReason` ignores a note row, since a card keeps its own title in step. A
        // column sorting by title still has to reorder, and this does it without a refresh.
        if (affectsSortOrder(loadResults, sortWatch)) {
            setSortRevision(revision => revision + 1);
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
        <div className={clsx("board-view", columnWidthClass(storedColumnWidth), {
            frozen: isFrozen,
            "editing-open": branchIdToEdit !== undefined || insertingColumns.size > 0
        })}>
            {/* Dims the board while a title is being typed, with the edited card lifted above it.
                Always rendered so that it can fade in.

                `frozen` waits for the fade to finish: setting it restyles every card, which in the
                same frame drops the fade's frames. */}
            <div
                className="board-edit-backdrop"
                onTransitionEnd={(e) => setIsFrozen(
                    getComputedStyle(e.currentTarget as HTMLElement).opacity === "1")}
            />
            <CollectionProperties
                note={parentNote}
                rightChildren={<>
                    <BoardGroupBy
                        note={parentNote}
                        options={groupingChoices}
                        current={currentGrouping}
                        onSelect={setRequestedGroupBy}
                    />
                    <CollectionFilterInput
                        filter={filter}
                        placeholder={t("board_view.filter-placeholder")}
                    />
                </>}
            />
            <BoardActionsContext.Provider value={boardActions}>
                <BoardPromotedAttributesContext.Provider value={shownAttributes}>
                <BoardHighlightTokensContext.Provider value={filter.highlightedTokens}>
                <BoardKeptCardsContext.Provider value={filter.keptNoteIds}>
                <BoardDropStateContext.Provider value={dropState}>
                <BoardDragStateContext.Provider value={boardDragState}>
                <SelectionContext.Provider value={selection}>
                    {byColumn && columns && <div
                        ref={containerRef}
                        className={clsx("board-view-container", {
                            pannable: isPannable,
                            panning: isPanning
                        })}
                        onKeyDown={handleKeyDown}
                        onClick={clearSelectionOutsideCards}
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
                                {draggedColumn?.index === index && (
                                    <div
                                        className="column-drop-placeholder show"
                                        style={{
                                            ...placeholderSize,
                                            transform: `translateX(${columnGapStandsAside(
                                                draggedColumn.index, columnDropPosition,
                                                draggedColumn.lefts ?? [],
                                                draggedColumn.stride ?? 0)}px)`
                                        }}
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
                                    isResizing={isResizingColumns}
                                    standsAside={draggedColumn
                                        ? columnStandsAside(index, draggedColumn.index,
                                            columnDropPosition, draggedColumn.stride ?? 0)
                                        : 0}
                                    cardTemplates={cardTemplates}
                                    nested={storedColumns.get(column)?.nested}
                                    limit={storedColumns.get(column)?.limit}
                                    columnIndex={index}
                                    columns={shownColumns}
                                    onMoveColumn={handleColumnDrop}
                                    onFocusColumn={focusColumn}
                                    onFocusCard={focusCard}
                                    columnItems={byColumn.get(column)}
                                    totalCount={allByColumn?.get(column)?.length}
                                    sort={columnSorts.get(column)}
                                    landedNoteId={landedNoteId}
                                    isNew={column === createdColumn}
                                />
                            </Fragment>
                        ))}

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
                </SelectionContext.Provider>
                </BoardDragStateContext.Provider>
                </BoardDropStateContext.Provider>
                </BoardKeptCardsContext.Provider>
                </BoardHighlightTokensContext.Provider>
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
/** How long the board waits for a move's changes before drawing again regardless. */
const SETTLE_TIMEOUT_MS = 10000;

/**
 * Waits for `froca` to hold what a move has written.
 *
 * `waitForMaxKnownEntityChangeId` never settles while the websocket delivers nothing, and the board
 * holds its refreshes until this resolves: unlimited, a connection gone quiet would stop the board
 * redrawing for the rest of the session.
 */
function settled() {
    return Promise.race([
        ws.waitForMaxKnownEntityChangeId(),
        new Promise<void>((resolve) => { window.setTimeout(resolve, SETTLE_TIMEOUT_MS); })
    ]);
}

/**
 * Puts every card back where the column draws it, closes every gap and gives back the room they
 * took.
 *
 * The columns do this for themselves as they are drawn, but a drop is three changes at once and
 * the reader sees a gap standing open if they reach the screen in separate frames.
 */
function closeGaps(container: HTMLElement | null) {
    if (!container) {
        return;
    }

    for (const card of container.querySelectorAll<HTMLElement>(".board-note")) {
        if (card.style.transform) {
            placeCard(card, null, true);
        }
    }

    for (const gap of container.querySelectorAll(".board-drop-placeholder")) {
        gap.classList.remove("show");
    }

    for (const room of container.querySelectorAll<HTMLElement>(".board-drop-room")) {
        room.style.height = "0px";
    }
}

/** The element a column is drawn in, for the two things that scroll the board to one. */
function columnElement(container: HTMLElement | null, column: string) {
    for (const element of container?.querySelectorAll<HTMLElement>(".board-column") ?? []) {
        if (element.dataset.column === column) {
            return element;
        }
    }
}

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
    /**
     * Writes what was typed. Returns `false` to refuse it, which keeps the editor open on what it
     * holds so the reader can correct it.
     */
    save: (newValue: string, atStart?: boolean) => false | void | Promise<void>;
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
            if (e.key === "Enter" && typed.trim() && (typed !== currentValue || isNewItem)
                    && !commit(typed)) {
                return;
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

            if (!commit(value, atStart)) {
                input?.focus();
                return;
            }

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
            if (!commit(newValue)) {
                // The field stays open, so the focus this blur took off it has to come back.
                inputRef.current?.focus();
                return;
            }

            dismissOnNextRefreshRef.current = true;
        } else {
            dismiss();
        }
    };

    /**
     * Saves what was typed and reports whether `save` accepted it.
     *
     * A refusal is reported by `save` itself, which is what knows why it refused. A save that
     * fails later is reported here instead of rejecting unhandled: the editor has closed by then,
     * and whatever could not be written has already been put back.
     */
    function commit(newValue: string, atStart?: boolean) {
        const outcome = save(newValue, atStart);
        if (outcome === false) {
            return false;
        }

        Promise.resolve(outcome).catch((e) => {
            console.error("Failed to save what the board editor was given:", e);
            toast.showError(t("board_view.save-error"));
        });
        return true;
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
                if (newValue && !commit(newValue)) {
                    return;
                }

                dismiss();
            }}
        />
    );

}
