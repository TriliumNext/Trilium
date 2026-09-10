import clsx from "clsx";
import { memo } from "preact/compat";
import {
    useCallback, useContext, useEffect, useLayoutEffect, useRef, useState
} from "preact/hooks";

import FBranch from "../../../entities/fbranch";
import FNote from "../../../entities/fnote";
import BoardApi, { CARD_REDIRECT_RELATION } from "./api";
import {
    BoardActionsContext, BoardHighlightTokensContext, BoardKeptCardsContext,
    BoardPromotedAttributesContext, TitleEditor
} from ".";
import { ContextMenuEvent } from "../../../menus/context_menu";
import { cardFollows } from "./columns";
import { openNoteContextMenu } from "./context_menu";
import { t } from "../../../services/i18n";
import UserAttributesDisplay from "../../attribute_widgets/UserAttributesList";
import { parseNavigationStateFromUrl } from "../../../services/link";
import { FLIP_SETTLE_MS } from "../../react/flip";
import {
    useNoteColorClass, useNoteIcon, useNoteLabel, useNoteLabelBoolean, useNoteRelation,
    useTriliumEvent
} from "../../react/hooks";
import { TooltipIcon } from "../../react/Icon";
import { HighlightedText } from "../../react/RawHtml";
import { useIsSelected, useSelection } from "../../react/selection";
import { type DragData, TREE_CLIPBOARD_TYPE } from "../../note_tree";

function Card({
    api,
    note,
    branch,
    column,
    index,
    statusAttribute,
    isNew,
    focusOnArrival,
    isDragging,
    isEditing,
    onFocusCard,
    onInsert,
    onNewItem
}: {
    api: BoardApi,
    note: FNote,
    branch: FBranch,
    column: string,
    index: number,
    /**
     * The label the board groups by, so that a card is not left reading it off `api`. The api keeps
     * one identity for the life of the board, which a `memo` comparison cannot see through.
     */
    statusAttribute: string,
    /** Whether this is the card just made, which is revealed on arrival. */
    isNew: boolean,
    /** Whether the card just made is also left focused, which one made among the others is. */
    focusOnArrival: boolean,
    isDragging: boolean,
    /**
     * Passed down rather than derived here from the drag state's `branchIdToEdit`, so that a card
     * subscribes only to the board's stable context and a drag leaves it off the render path.
     */
    isEditing: boolean,
    /** Puts focus back on this card once a change of column has drawn it under another one. */
    onFocusCard: (noteId: string) => void,
    /**
     * Opens the field a new card is named in at a place in the column, which is what makes the
     * card. The index is where the field stands among the cards.
     */
    onInsert: (index: number) => void,
    /** Opens the field at the foot of the column, for a card whose column sorts itself. */
    onNewItem: () => void
}) {
    const { setBranchIdToEdit } = useContext(BoardActionsContext);
    const shownAttributes = useContext(BoardPromotedAttributesContext);
    const highlightedTokens = useContext(BoardHighlightTokensContext);
    const isOutsideFilter = useContext(BoardKeptCardsContext).has(note.noteId);
    // Tracks the `color` label, which the board does not redraw a card for.
    const colorClass = useNoteColorClass(note) || "";
    const editorRef = useRef<HTMLInputElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const [ isArchived ] = useNoteLabelBoolean(note, "archived");
    const [ iconClass, setIconClass ] = useNoteLabel(note, "iconClass");
    // Only whether the card redirects, which is what draws its title as a link. Where it goes is
    // read when the card is opened.
    const [ redirectTo ] = useNoteRelation(note, CARD_REDIRECT_RELATION);
    // The card stays the one just made until another is, so what has already been shown is
    // remembered here rather than played again by every redraw of the column.
    const [ isRevealed, setIsRevealed ] = useState(false);
    const [ title, setTitle ] = useState(note.title);
    // Tracks the `iconClass` label, which an attribute change carries and the note row never does.
    const icon = useNoteIcon(note);
    // Read from the store rather than through the board's state, so picking one card redraws that
    // card and no other. The store keeps one identity for the life of the board, so holding it
    // here leaves the memo below intact.
    const selection = useSelection();
    const isSelected = useIsSelected(note.noteId);

    // A card owns its own title: the board does not redraw for a note-row change. Setting the value
    // already held is a no-op, so a save that left the title alone re-renders nothing.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const row = loadResults.getEntityRow("notes", note.noteId);
        if (row) {
            setTitle(row.title);
        }
    });

    const handleContextMenu = useCallback((e: ContextMenuEvent) => {
        // A card outside the selection is acted on alone, and the selection it was not part of is
        // dropped, so the menu never writes to cards the reader has stopped looking at.
        if (!selection.has(note.noteId)) {
            selection.clear();
        }

        const cards = api.getCards(selection.keys);
        openNoteContextMenu(api, e, {
            note,
            branchId: branch.branchId,
            column,
            index,
            notes: cards.length ? cards.map((card) => card.note) : [ note ],
            branchIds: cards.length
                ? cards.map((card) => card.branch.branchId)
                : [ branch.branchId ],
            onFocusCard,
            onInsert,
            onNewItem
        });
    }, [ api, note, branch, column, index, selection, onFocusCard, onInsert, onNewItem ]);

    const handleClick = useCallback((e: MouseEvent) => {
        // A double click is one gesture, and its second click would open the note over itself: the
        // popup already standing is taken as the one to stack on, and closing that leaves neither.
        if (e.detail > 1) return;

        // A link to a note, such as a relation's target, opens in the popup. Cancelled here so that
        // `goToLink` does not open a tab for it as well; a link naming no note is left alone.
        // Checked before the modifiers below, so Ctrl on a link still means what it means anywhere.
        const link = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[href]");
        if (link) {
            const { notePath } = parseNavigationStateFromUrl(link.getAttribute("href") ?? undefined);
            if (!notePath) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            api.openNote(notePath);
            return;
        }

        // Ctrl picks this card out on its own, keeping whatever else is picked. Neither modifier
        // opens the note.
        if (e.ctrlKey || e.metaKey) {
            selection.toggle(note.noteId);
            return;
        }

        // Shift takes everything between the card the selection started from and this one. Only
        // this column is offered, so a range never reaches into another.
        if (e.shiftKey) {
            selection.selectRange(api.getColumnNoteIds(column), note.noteId);
            return;
        }

        selection.clear();
        api.openCard(note);
    }, [ api, note, column, selection ]);

    /**
     * Fills the drag with what the note tree reads, for the native drag a Ctrl press arms in
     * `board_drag.ts`. Carries the whole selection where this card is part of one.
     *
     * The same two entries the tree writes, so a card reaches everything a note dragged from the
     * tree does: `TREE_CLIPBOARD_TYPE` says the drag holds notes, `text` says which.
     */
    const handleDragStart = useCallback((e: DragEvent) => {
        const carried = isSelected
            ? api.getCards(selection.keys)
            : [ { note, branch } ];
        const dragged: DragData[] = carried.map((item) => ({
            noteId: item.note.noteId,
            branchId: item.branch.branchId,
            title: item.note.title
        }));

        e.dataTransfer?.setData(TREE_CLIPBOARD_TYPE, "");
        e.dataTransfer?.setData("text", JSON.stringify(dragged));
    }, [ api, note, branch, isSelected, selection ]);

    const handleEdit = useCallback((e: MouseEvent) => {
        e.stopPropagation(); // don't also open the note
        setBranchIdToEdit(branch.branchId);
    }, [ setBranchIdToEdit, branch ]);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "Enter" && !e.ctrlKey) {
            // Enter adds a card the way it adds a row in a spreadsheet, and Space is what opens
            // one. Shift adds it above instead of below.
            e.preventDefault();
            onInsert(e.shiftKey ? index : index + 1);
        } else if (e.key === "F2") {
            setBranchIdToEdit(branch.branchId);
        }
    }, [ branch, index, setBranchIdToEdit, onInsert ]);

    useEffect(() => {
        editorRef.current?.focus();
    }, [ isEditing ]);

    // The field a card is named in closes as the card is made, so the card takes focus as it is
    // drawn and the arrow keys carry on from there.
    useEffect(() => {
        if (focusOnArrival && !isEditing) {
            cardRef.current?.focus();
        }
    }, [ focusOnArrival, isEditing ]);

    useEffect(() => {
        setTitle(note.title);
    }, [ note ]);

    // A new card can be out of sight on a full column. A card at either end scrolls its column to
    // that end, clear of the fade `useScrollFade` draws over the edges; one between others is only
    // scrolled into view.
    useLayoutEffect(() => {
        if (!isNew) {
            return;
        }

        const card = cardRef.current;
        const content = card?.closest(".board-column-content");
        if (!card || !content) {
            return;
        }

        const bring = () => {
            if (!cardFollows(card)) {
                content.scrollTop = content.scrollHeight;
            } else if (!card.previousElementSibling) {
                content.scrollTop = 0;
            } else {
                card.scrollIntoView?.({ block: "nearest" });
            }
        };

        bring();
        // Again once the growth has finished: a card scrolled to while `useFlip` is still opening
        // it out is measured against a shorter column, and ends up past the edge.
        const settled = window.setTimeout(bring, FLIP_SETTLE_MS);

        return () => window.clearTimeout(settled);
    }, [ isNew ]);

    return (
        <div
            ref={cardRef}
            className={clsx("board-note", colorClass, {
                shortcut: !!redirectTo,
                dragging: isDragging,
                editing: isEditing,
                archived: isArchived,
                selected: isSelected,
                appearing: isNew && !isRevealed
            })}
            onAnimationEnd={(e) => {
                if (e.animationName === "board-item-appear") {
                    setIsRevealed(true);
                }
            }}
            data-note-id={note.noteId}
            data-index={index}
            onContextMenu={handleContextMenu}
            onDragStart={handleDragStart}
            onClick={!isEditing ? handleClick : undefined}
            onKeyDown={handleKeyDown}
            tabIndex={300}
        >
            {!isEditing ? (
                <>
                    <span className="title">
                        <span class={`icon ${icon}`} />
                        <HighlightedText
                            className="text" text={title} highlightedTokens={highlightedTokens} />
                    </span>
                    <span
                        className="edit-icon icon bx bx-edit"
                        title={t("board_view.edit-note-title")}
                        onClick={handleEdit}
                    />
                </>
            ) : (
                <TitleEditor
                    returnFocusTo={cardRef}
                    currentValue={note.title}
                    save={newTitle => {
                        api.renameCard(note.noteId, newTitle);
                        setTitle(newTitle);
                    }}
                    dismiss={() => api.dismissEditingTitle()}
                    mode="multiline"
                    icon={{
                        current: icon ?? "",
                        onSelect: setIconClass,
                        onReset: iconClass ? () => setIconClass(null) : undefined
                    }}
                />
            )}
            {/* Drawn while the title is being edited as well, so a card keeps what it shows and
                stands the same height either way. */}
            <UserAttributesDisplay
                note={note}
                ignoredAttributes={[statusAttribute]}
                shownAttributes={shownAttributes}
                badges={isOutsideFilter && <OutsideFilterBadge />}
            />
        </div>
    )
}

/**
 * Marks a card the filter does not match, drawn because it was just made here.
 * `role="img"` is what lets `aria-label` name it: a span on its own cannot be named.
 */
export function OutsideFilterBadge() {
    return (
        <TooltipIcon
            className="board-note-outside-filter"
            icon="bx bx-time-five"
            tooltip={t("board_view.card-outside-filter")}
            tooltipPosition="bottom"
            role="img"
            aria-label={t("board_view.card-outside-filter")}
        />
    );
}

/**
 * Memoized because a board holds hundreds of these and most redraws change none of them: a drag
 * moves one card, and the rest receive the same props they already had.
 *
 * This only works because a card reads nothing from the board's drag-state context -- Preact
 * re-renders a context consumer whatever its memo boundary says, so subscribing there would make
 * the comparison below unreachable. `isEditing` and `isDragging` arrive as props for that reason.
 *
 * `api` keeps one identity for as long as the board is mounted, so a refresh reaches only the cards
 * whose own props changed. Anything a card reads off the api while rendering has to arrive as a prop
 * instead, which is why `statusAttribute` is one.
 */
export default memo(Card);
