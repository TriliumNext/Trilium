import { memo } from "preact/compat";
import { useCallback, useContext, useEffect, useRef, useState } from "preact/hooks";
import FBranch from "../../../entities/fbranch";
import FNote from "../../../entities/fnote";
import BoardApi from "./api";
import { BoardActionsContext, TitleEditor } from ".";
import { ContextMenuEvent } from "../../../menus/context_menu";
import { openNoteContextMenu } from "./context_menu";
import { t } from "../../../services/i18n";
import UserAttributesDisplay from "../../attribute_widgets/UserAttributesList";
import { useNoteIcon, useNoteLabelBoolean, useTriliumEvent } from "../../react/hooks";

export const CARD_CLIPBOARD_TYPE = "trilium/board-card";

export interface CardDragData {
    noteId: string;
    branchId: string;
    index: number;
    fromColumn: string;
}

function Card({
    api,
    note,
    branch,
    column,
    index,
    isDragging,
    isEditing
}: {
    api: BoardApi,
    note: FNote,
    branch: FBranch,
    column: string,
    index: number,
    isDragging: boolean,
    /**
     * Passed down rather than derived here from the drag state's `branchIdToEdit`, so that a card
     * subscribes only to the board's stable context and a drag leaves it off the render path.
     */
    isEditing: boolean
}) {
    const { setBranchIdToEdit, setDraggedCard } = useContext(BoardActionsContext);
    const colorClass = note.getColorClass() || '';
    const editorRef = useRef<HTMLInputElement>(null);
    const [ isArchived ] = useNoteLabelBoolean(note, "archived");
    const [ isVisible, setVisible ] = useState(true);
    const [ title, setTitle ] = useState(note.title);
    // Tracks the `iconClass` label, which an attribute change carries and the note row never does.
    const icon = useNoteIcon(note);

    // A card owns its own title: the board does not redraw for a note-row change. Setting the value
    // already held is a no-op, so a save that left the title alone re-renders nothing.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const row = loadResults.getEntityRow("notes", note.noteId);
        if (row) {
            setTitle(row.title);
        }
    });

    const handleDragStart = useCallback((e: DragEvent) => {
        e.dataTransfer!.effectAllowed = 'move';
        const data: CardDragData = { noteId: note.noteId, branchId: branch.branchId, fromColumn: column, index };
        setDraggedCard(data);
        e.dataTransfer!.setData(CARD_CLIPBOARD_TYPE, JSON.stringify(data));
    }, [note.noteId, branch.branchId, column, index]);

    const handleDragEnd = useCallback((e: DragEvent) => {
        setDraggedCard(null);
    }, [setDraggedCard]);

    const handleContextMenu = useCallback((e: ContextMenuEvent) => {
        openNoteContextMenu(api, e, note, branch.branchId, column);
    }, [ api, note, branch, column ]);

    const handleOpen = useCallback((e: MouseEvent) => {
        // A double click is one gesture, and its second click would open the note over itself: the
        // popup already standing is taken as the one to stack on, and closing that leaves neither.
        if (e.detail > 1) return;

        api.openNote(note.noteId);
    }, [ api, note ]);

    const handleEdit = useCallback((e: MouseEvent) => {
        e.stopPropagation(); // don't also open the note
        setBranchIdToEdit(branch.branchId);
    }, [ setBranchIdToEdit, branch ]);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "Enter") {
            api.openNote(note.noteId);
        } else if (e.key === "F2") {
            setBranchIdToEdit(branch.branchId);
        }
    }, [ setBranchIdToEdit, note ]);

    useEffect(() => {
        editorRef.current?.focus();
    }, [ isEditing ]);

    useEffect(() => {
        setTitle(note.title);
    }, [ note ]);

    useEffect(() => {
        setVisible(!isDragging);
    }, [ isDragging ]);

    return (
        <div
            className={`board-note ${colorClass} ${isDragging ? 'dragging' : ''} ${isEditing ? "editing" : ""} ${isArchived ? "archived" : ""}`}
            data-note-id={note.noteId}
            draggable
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onContextMenu={handleContextMenu}
            onClick={!isEditing ? handleOpen : undefined}
            onKeyDown={handleKeyDown}
            style={{
                display: !isVisible ? "none" : undefined
            }}
            tabIndex={300}
        >
            {!isEditing ? (
                <>
                    <span className="title">
                        <span class={`icon ${icon}`} />
                        {title}
                    </span>
                    <span
                        className="edit-icon icon bx bx-edit"
                        title={t("board_view.edit-note-title")}
                        onClick={handleEdit}
                    />
                    <UserAttributesDisplay note={note} ignoredAttributes={[api.statusAttribute]} />
                </>
            ) : (
                <TitleEditor
                    currentValue={note.title}
                    save={newTitle => {
                        api.renameCard(note.noteId, newTitle);
                        setTitle(newTitle);
                    }}
                    dismiss={() => api.dismissEditingTitle()}
                    mode="multiline"
                />
            )}
        </div>
    )
}

/**
 * Memoized because a board holds hundreds of these and most redraws change none of them: a drag
 * moves one card, and the rest receive the same props they already had.
 *
 * This only works because a card reads nothing from the board's drag-state context -- Preact
 * re-renders a context consumer whatever its memo boundary says, so subscribing there would make
 * the comparison below unreachable. `isEditing` and `isDragging` arrive as props for that reason.
 *
 * Note that `api` is rebuilt whenever the board's data is, so a refresh still re-renders every card
 * regardless. This bails out on the drag and edit redraws, not on those.
 */
export default memo(Card);
