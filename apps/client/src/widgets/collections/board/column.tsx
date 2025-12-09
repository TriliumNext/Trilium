import { useCallback, useContext, useEffect, useRef, useState } from "preact/hooks";
import FBranch from "../../../entities/fbranch";
import FNote from "../../../entities/fnote";
import { BoardViewContext, TitleEditor } from ".";
import branches from "../../../services/branches";
import { openColumnContextMenu } from "./context_menu";
import { ContextMenuEvent } from "../../../menus/context_menu";
import Icon from "../../react/Icon";
import { t } from "../../../services/i18n";
import BoardApi from "./api";
import Card, { CARD_CLIPBOARD_TYPE, CardDragData } from "./card";
import { JSX } from "preact/jsx-runtime";
import froca from "../../../services/froca";
import { DragData, TREE_CLIPBOARD_TYPE } from "../../note_tree";
import NoteLink from "../../react/NoteLink";

interface DragContext {
    column: string;
    columnIndex: number,
    columnItems?: { note: FNote, branch: FBranch }[];
}

export default function Column({
    column,
    columnIndex,
    isDraggingColumn,
    columnItems,
    api,
    onColumnHover,
    isAnyColumnDragging,
    isInRelationMode
}: {
    columnItems?: { note: FNote, branch: FBranch }[];
    isDraggingColumn: boolean,
    api: BoardApi,
    onColumnHover?: (index: number, mouseX: number, rect: DOMRect) => void,
    isAnyColumnDragging?: boolean,
    isInRelationMode: boolean
} & DragContext) {
    const [ isVisible, setVisible ] = useState(true);
    const { columnNameToEdit, setColumnNameToEdit, dropTarget, draggedCard, dropPosition } = useContext(BoardViewContext)!;
    const isEditing = (columnNameToEdit === column);
    const editorRef = useRef<HTMLInputElement>(null);
    const { handleColumnDragStart, handleColumnDragEnd, handleDragOver, handleDragLeave, handleDrop } = useDragging({
        column, columnIndex, columnItems, isEditing
    });

    const handleEdit = useCallback(() => {
        setColumnNameToEdit?.(column);
    }, [column]);

    const handleContextMenu = useCallback((e: ContextMenuEvent) => {
        openColumnContextMenu(api, e, column);
    }, [ api, column ]);

    const handleTitleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "F2") {
            setColumnNameToEdit?.(column);
        }
    }, [ column ]);

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
        editorRef.current?.focus();
    }, [ isEditing ]);

    useEffect(() => {
        setVisible(!isDraggingColumn);
    }, [ isDraggingColumn ]);

    const handleColumnDragOver = useCallback((e: DragEvent) => {
        if (!isAnyColumnDragging || !onColumnHover) return;
        e.preventDefault();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        onColumnHover(columnIndex, e.clientX, rect);
    }, [isAnyColumnDragging, onColumnHover, columnIndex]);

    return (
        <div
            className={`board-column ${dropTarget === column && draggedCard?.fromColumn !== column ? 'drag-over' : ''}`}
            onDragOver={isAnyColumnDragging ? handleColumnDragOver : handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
                display: !isVisible ? "none" : undefined
            }}
        >
            <h3
                className={`${isEditing ? "editing" : ""}`}
                draggable
                onDragStart={handleColumnDragStart}
                onDragEnd={handleColumnDragEnd}
                onContextMenu={handleContextMenu}
                onKeyDown={handleTitleKeyDown}
                tabIndex={300}
            >
                {!isEditing ? (
                    <>
                        <span className="title">
                            {isInRelationMode
                            ? <NoteLink notePath={column} showNoteIcon />
                            : column}
                        </span>
                        <span className="counter-badge">{columnItems?.length ?? 0}</span>
                        <div className="spacer" />
                        <span
                            className="edit-icon icon bx bx-edit-alt"
                            title={t("board_view.edit-column-title")}
                            onClick={handleEdit}
                        />
                    </>
                ) : (
                    <TitleEditor
                        currentValue={column}
                        save={newTitle => api.renameColumn(column, newTitle)}
                        dismiss={() => setColumnNameToEdit?.(undefined)}
                        mode={isInRelationMode ? "relation" : "normal"}
                    />
                )}
            </h3>

            <div className="board-column-content" onWheel={handleScroll}>
                {(columnItems ?? []).map(({ note, branch }, index) => {
                    const showIndicatorBefore = dropPosition?.column === column &&
                                            dropPosition.index === index &&
                                            draggedCard?.noteId !== note.noteId;

                    return (
                        <>
                            {showIndicatorBefore && (
                                <div className="board-drop-placeholder show" />
                            )}
                            <Card
                                key={note.noteId}
                                api={api}
                                note={note}
                                branch={branch}
                                column={column}
                                index={index}
                                isDragging={draggedCard?.noteId === note.noteId}
                            />
                        </>
                    );
                })}
                {dropPosition?.column === column && dropPosition.index === (columnItems?.length ?? 0) && (
                    <div className="board-drop-placeholder show" />
                )}

                <AddNewItem api={api} column={column} />
            </div>
        </div>
    )
}

function AddNewItem({ column, api }: { column: string, api: BoardApi }) {
    const [ isCreatingNewItem, setIsCreatingNewItem ] = useState(false);
    const addItemCallback = useCallback(() => setIsCreatingNewItem(true), []);
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (!isCreatingNewItem && e.key === "Enter") {
            setIsCreatingNewItem(true);
        }
    }, []);

    return (
        <div
            className={`board-new-item ${isCreatingNewItem ? "editing" : ""}`}
            onClick={addItemCallback}
            onKeyDown={handleKeyDown}
            tabIndex={300}
        >
            {!isCreatingNewItem ? (
                <>
                    <Icon icon="bx bx-plus" />{" "}
                    {t("board_view.new-item")}
                </>
            ) : (
                <TitleEditor
                    placeholder={t("board_view.new-item-placeholder")}
                    save={(title) => api.createNewItem(column, title)}
                    dismiss={() => setIsCreatingNewItem(false)}
                    mode="multiline" isNewItem
                />
            )}
        </div>
    );
}

function useDragging({ column, columnIndex, columnItems, isEditing }: DragContext & { isEditing: boolean }) {
    const { api, parentNote, draggedColumn, setDraggedColumn, setDropTarget, setDropPosition, dropPosition } = useContext(BoardViewContext)!;
    /** Needed to track if current column is dragged in real-time, since {@link draggedColumn} is populated one render cycle later.  */
    const isDraggingRef = useRef(false);

    const handleColumnDragStart = useCallback((e: DragEvent) => {
        if (isEditing) return;

        isDraggingRef.current = true;
        e.dataTransfer!.effectAllowed = 'move';
        e.dataTransfer!.setData('text/plain', column);
        setDraggedColumn({ column, index: columnIndex });
        e.stopPropagation(); // Prevent card drag from interfering
    }, [column, columnIndex, setDraggedColumn, isEditing]);

    const handleColumnDragEnd = useCallback(() => {
        isDraggingRef.current = false;
        setDraggedColumn(null);
    }, [setDraggedColumn]);

    const handleDragOver = useCallback((e: DragEvent) => {
        if (isEditing || draggedColumn || isDraggingRef.current) return; // Don't handle card drops when dragging columns
        if (!e.dataTransfer?.types.includes(CARD_CLIPBOARD_TYPE) && !e.dataTransfer?.types.includes(TREE_CLIPBOARD_TYPE)) return;

        e.preventDefault();
        setDropTarget(column);

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

        if (!(dropPosition?.column === column && dropPosition.index === newIndex)) {
            setDropPosition({ column, index: newIndex });
        }
    }, [column, setDropTarget, dropPosition, setDropPosition, isEditing]);

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
        setDropTarget(null);
        setDropPosition(null);

        const data = e.dataTransfer?.getData(CARD_CLIPBOARD_TYPE) || e.dataTransfer?.getData("text");
        if (!data) return;

        let draggedCard: CardDragData | DragData[];
        try {
            draggedCard = JSON.parse(data);
        } catch (e) {
            return;
        }

        if (Array.isArray(draggedCard)) {
            // From note tree.
            const { noteId, branchId } = draggedCard[0];
            const targetNote = await froca.getNote(noteId, true);
            const parentNoteId = parentNote?.noteId;
            if (!parentNoteId || !dropPosition) return;

            const targetIndex = dropPosition.index - 1;
            const targetItems = columnItems || [];
            const targetBranch = targetIndex >= 0 ? targetItems[targetIndex].branch : null;

            await api?.changeColumn(noteId, column);

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
        } else if (draggedCard && dropPosition) {
            api?.moveWithinBoard(draggedCard.noteId, draggedCard.branchId, draggedCard.index, dropPosition.index, draggedCard.fromColumn, column);
        }

    }, [ api, draggedColumn, dropPosition, columnItems, column, setDropTarget, setDropPosition ]);

    return { handleColumnDragStart, handleColumnDragEnd, handleDragOver, handleDragLeave, handleDrop };
}
