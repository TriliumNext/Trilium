/**
 * Links to one column or one card of a board.
 *
 * A reference is a note path plus a `?column=` or `?card=` parameter. `link.ts` carries both in the
 * pane's view scope, as it carries `?bookmark=`, and {@link useBoardReference} reads the parameter
 * once and reveals what it names. A column reference also carries the column's title, icon and
 * colour, which `link.ts` renders the link from when the reference is pasted into a note.
 *
 * A card uses its note id. A column uses an id stored in `board.json`, because renaming a column
 * rewrites the value its cards carry.
 */

import { boardColumnsKey, boardGroupByFromColumnsKey } from "@triliumnext/commons";
import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";

import type NoteContext from "../../../components/note_context";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import toast from "../../../services/toast";
import { randomString } from "../../../services/utils";
import type { BoardColumnData, BoardViewData } from ".";
import type BoardApi from "./api";
import { askForCard } from "./windowing";

/** Length of a column id, matching a note id so that the two read alike. */
export const COLUMN_ID_LENGTH = 12;

/** How many frames the reveal waits for the board to draw what a reference names. */
const REVEAL_TRIES = 30;

/**
 * A reference read off the view scope, and the board it was read for.
 *
 * `NoteList` renders `BoardView` unkeyed, so moving to another board reuses the instance. A
 * reference still waiting for its column must not be applied to the board that follows.
 */
type BoardReferenceTarget = { board: string } & (
    | { kind: "column"; id: string }
    | { kind: "card"; noteId: string }
);

export interface BoardReferenceOptions {
    /** The board the reference is settled against. */
    noteId: string;
    /** The pane the board is drawn in, whose view scope carries the reference. */
    noteContext: NoteContext | null | undefined;
    api: BoardApi;
    /** The board's stored configuration, which every grouping's columns are read from. */
    viewConfig: BoardViewData | undefined;
    /** The grouping the board draws for. */
    groupBy: string;
    /** Switches the board to another grouping, by writing `#board:groupBy`. */
    setGroupBy: (groupBy: string) => void;
    /** The columns the board draws, absent until they are resolved. */
    columns: string[] | undefined;
    /** Whether the board draws archived columns and cards. */
    includeArchived: boolean;
    /** Draws a collapsed column open, without storing it as open. */
    selectColumn: (column: string) => void;
    /** The board's own element, which what is revealed is looked for in. */
    containerRef: RefObject<HTMLElement>;
}

/**
 * Reveals the column or card a reference names, once the board has drawn it.
 *
 * Clears the parameter from the view scope as soon as it is read. A pane stores its view scope in
 * the tab's state, so a parameter left in place would jump the board again on every tab restore.
 *
 * The target is then polled for rather than looked up once: the board resolves its columns a tick
 * after it mounts, a grouping switch takes another round, and a long column draws only a slice of
 * its cards.
 */
export function useBoardReference({
    noteId, noteContext, api, viewConfig, groupBy, setGroupBy, columns, includeArchived,
    selectColumn, containerRef
}: BoardReferenceOptions) {
    const target = useRef<BoardReferenceTarget | null>(null);
    /** The grouping a column reference has already asked for, so the switch is requested once. */
    const switchedTo = useRef<string | null>(null);
    /** The board being drawn now, which a reveal already running checks it still belongs to. */
    const drawn = useRef(noteId);
    const isUnmounted = useRef(false);

    useEffect(() => () => { isUnmounted.current = true; }, []);

    // No dependency list: every render is another chance that the target is now drawn.
    useEffect(() => {
        drawn.current = noteId;

        const viewScope = noteContext?.viewScope;
        if (viewScope?.column || viewScope?.card) {
            target.current = viewScope.column
                ? { board: noteId, kind: "column", id: viewScope.column }
                : { board: noteId, kind: "card", noteId: viewScope.card ?? "" };
            switchedTo.current = null;
            viewScope.column = undefined;
            viewScope.columnTitle = undefined;
            viewScope.columnIcon = undefined;
            viewScope.columnColor = undefined;
            viewScope.card = undefined;
        }

        const pending = target.current;
        if (pending && pending.board !== noteId) {
            target.current = null;
            return;
        }

        if (!pending || !columns || !containerRef.current) {
            return;
        }

        const settled = pending.kind === "column"
            ? settleColumn(pending.id)
            : settleCard(pending.noteId);
        if (settled) {
            target.current = null;
        }
    });

    /** @returns whether the reference is done with, a report of its own counting as done. */
    function settleColumn(id: string) {
        const found = findColumnById(viewConfig, id);
        if (!found) {
            toast.showMessage(t("board_view.reference-column-missing"), undefined, "bx bx-columns");
            return true;
        }

        // Switches the board to the grouping that owns the column, and settles on a later render.
        // Requested once, because `#board:groupBy` takes a round trip through froca to come back.
        if (found.groupBy !== groupBy) {
            if (switchedTo.current !== found.groupBy) {
                switchedTo.current = found.groupBy;
                setGroupBy(found.groupBy);
            }
            return false;
        }

        if (!columns?.includes(found.value)) {
            reportMissing(api.isColumnArchived(found.value), "bx bx-columns");
            return true;
        }

        revealColumn(found.value);
        return true;
    }

    /** @returns whether the reference is done with. */
    function settleCard(noteId: string) {
        const column = api.getCardColumn(noteId);
        if (column === undefined) {
            const note = froca.getNoteFromCache(noteId);
            reportMissing(!!note?.isArchived, "bx bx-card");
            return true;
        }

        // A collapsed column renders its cards without showing them, so the card can take focus
        // while invisible. `selectColumn` opens the column without writing `collapsed`, so the
        // board's stored layout is unchanged.
        if (api.isColumnCollapsed(column)) {
            selectColumn(column);
        }

        const index = api.getColumnNoteIds(column).indexOf(noteId);
        revealCard(noteId, column, Math.max(index, 0));
        return true;
    }

    /** Says why what a reference names is not on the board, which is usually that it is archived. */
    function reportMissing(isArchived: boolean, icon: string) {
        toast.showMessage(
            isArchived && !includeArchived
                ? t("board_view.reference-archived")
                : t("board_view.reference-missing"),
            undefined,
            icon);
    }

    function revealColumn(value: string) {
        if (api.isColumnCollapsed(value)) {
            selectColumn(value);
        }

        waitFor(() => {
            const column = containerRef.current?.querySelector<HTMLElement>(
                `.board-column[data-column="${quoteForSelector(value)}"]`);
            // Waits for the column to open. `Column#handleFocusIn` clears `activeColumn` when
            // focus arrives on a column that is not yet active, undoing the peek above.
            if (!column || column.classList.contains("collapsed")) {
                return null;
            }

            return column.querySelector<HTMLElement>("h3");
        }, reveal, abandonedBy(noteId));
    }

    function revealCard(cardNoteId: string, column: string, index: number) {
        waitFor(() => {
            const container = containerRef.current;
            const card = findCardElement(container, cardNoteId);
            if (!card && container) {
                // A long column draws only a slice of its cards, so `askForCard` makes it draw
                // this one.
                askForCard(container, column, index);
            }

            return card;
        }, reveal, abandonedBy(noteId));
    }

    /**
     * Whether a reveal started for `board` must stop.
     *
     * A reveal polls over several frames, and `BoardView` is reused when the pane moves to another
     * board. Two boards often use the same column names, so a reveal left running can focus the
     * wrong board's column.
     */
    function abandonedBy(board: string) {
        return () => isUnmounted.current || drawn.current !== board;
    }
}

/** A new column id. Uses `randomString`; `crypto.randomUUID` needs a secure context. */
export function newColumnId() {
    return randomString(COLUMN_ID_LENGTH);
}

/** What a column reference resolves to: the grouping that owns the column, and the column. */
export interface ColumnReferenceTarget {
    /** The grouping the column belongs to, as `#board:groupBy` writes it. */
    groupBy: string;
    /** The value the column's cards carry, which is what the board draws it by. */
    value: string;
}

/**
 * Finds the column an id names, searching every grouping's column list.
 *
 * Each grouping stores its own columns, so an id can belong to a grouping other than the one the
 * board shows. The board switches to the grouping returned here instead of reporting the column
 * missing.
 */
export function findColumnById(
    config: BoardViewData | undefined, id: string
): ColumnReferenceTarget | undefined {
    if (!config || !id) {
        return undefined;
    }

    for (const [ key, value ] of Object.entries(config)) {
        const groupBy = boardGroupByFromColumnsKey(key);
        if (!groupBy || !Array.isArray(value)) {
            continue;
        }

        const column = (value as BoardColumnData[]).find(candidate => candidate?.id === id);
        if (column) {
            return { groupBy, value: column.value };
        }
    }

    return undefined;
}

/** The stored id of a column of one grouping, or nothing where it has none yet. */
export function readColumnId(
    config: BoardViewData | undefined, groupBy: string, value: string
): string | undefined {
    const columns = config?.[boardColumnsKey(groupBy)] as BoardColumnData[] | undefined;
    return columns?.find(column => column.value === value)?.id;
}

/** The column's title, icon and colour, carried in the link for display only. */
export interface ColumnReferenceLabel {
    title: string;
    icon: string;
    color?: string;
}

/**
 * The link that opens a board on one of its columns.
 *
 * `label` is written into the link because `board.json`, which holds it, is loaded by the board
 * alone. `columnId` is what the board resolves, so a rename leaves the link working and only its
 * label out of date.
 */
export function columnReference(notePath: string, columnId: string, label: ColumnReferenceLabel) {
    const params: [ string, string ][] = [
        [ "column", columnId ],
        [ "columnTitle", label.title ],
        [ "columnIcon", label.icon ]
    ];
    if (label.color) {
        params.push([ "columnColor", label.color ]);
    }

    const query = params.map(([ name, value ]) => `${name}=${encodeURIComponent(value)}`).join("&");
    return `#${notePath}?${query}`;
}

/** The link that opens a board on one of its cards. */
export function cardReference(notePath: string, noteId: string) {
    return `#${notePath}?card=${encodeURIComponent(noteId)}`;
}

/** Scrolls the target into view and focuses it, which is how the reference points it out. */
function reveal(element: HTMLElement) {
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
}

/**
 * Calls `find` each frame until it returns an element, for at most {@link REVEAL_TRIES} frames, then
 * passes that element to `then`.
 *
 * The board draws its columns a tick after it mounts, and a windowed column draws a card a frame
 * after `askForCard`, so the first call rarely finds anything. `isAbandoned` stops the polling
 * early.
 */
export function waitFor(
    find: () => HTMLElement | null,
    then: (element: HTMLElement) => void,
    isAbandoned: () => boolean,
    tries = REVEAL_TRIES
) {
    if (isAbandoned()) {
        return;
    }

    const found = find();
    if (found) {
        then(found);
        return;
    }

    if (tries > 0) {
        requestAnimationFrame(() => waitFor(find, then, isAbandoned, tries - 1));
    }
}

/** Finds a card by its note id, the same way the keyboard navigation does. */
function findCardElement(container: HTMLElement | null, noteId: string) {
    return container?.querySelector<HTMLElement>(`.board-note[data-note-id="${noteId}"]`) ?? null;
}

/**
 * Escapes a column value for a quoted attribute selector. Column values are user text, and a quote
 * or a backslash would end the selector's string rather than fail to match.
 */
function quoteForSelector(value: string) {
    return value.replace(/[\\"]/g, "\\$&");
}
