import { useCallback, useContext, useEffect, useRef, useState } from "preact/hooks";
import FBranch from "../../../entities/fbranch";
import FNote from "../../../entities/fnote";
import BoardApi from "./api";
import { BoardViewContext, TitleEditor } from ".";
import { ContextMenuEvent } from "../../../menus/context_menu";
import { openNoteContextMenu } from "./context_menu";
import { t } from "../../../services/i18n";

export const CARD_CLIPBOARD_TYPE = "trilium/board-card";

export interface CardDragData {
    noteId: string;
    branchId: string;
    index: number;
    fromColumn: string;
}

export default function Card({
    api,
    note,
    branch,
    column,
    index,
    isDragging
}: {
    api: BoardApi,
    note: FNote,
    branch: FBranch,
    column: string,
    index: number,
    isDragging: boolean
}) {
    const { branchIdToEdit, setBranchIdToEdit, setDraggedCard } = useContext(BoardViewContext);
    const isEditing = branch.branchId === branchIdToEdit;
    const colorClass = note.getColorClass() || '';
    const editorRef = useRef<HTMLInputElement>(null);
    const isArchived = note.isArchived;
    const [ isVisible, setVisible ] = useState(true);
    const [ title, setTitle ] = useState(note.title);

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

    const handleOpen = useCallback(() => {
        api.openNote(note.noteId);
    }, [ api, note ]);

    const handleEdit = useCallback((e: MouseEvent) => {
        e.stopPropagation(); // don't also open the note
        setBranchIdToEdit?.(branch.branchId);
    }, [ setBranchIdToEdit, branch ]);

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
            draggable="true"
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onContextMenu={handleContextMenu}
            onClick={!isEditing ? handleOpen : undefined}
            style={{
                display: !isVisible ? "none" : undefined
            }}
        >
            {!isEditing ? (
                <>
                    <span className="title">
                        <span class={`icon ${note.getIcon()}`} />
                        {title}
                    </span>
                    <span
                        className="edit-icon icon bx bx-edit"
                        title={t("board_view.edit-note-title")}
                        onClick={handleEdit}
                    />
                </>
            ) : (
                <TitleEditor
                    currentValue={note.title}
                    save={newTitle => {
                        api.renameCard(note.noteId, newTitle);
                        setTitle(newTitle);
                    }}
                    dismiss={() => api.dismissEditingTitle()}
                    multiline
                />
            )}
        </div>
    )
}
