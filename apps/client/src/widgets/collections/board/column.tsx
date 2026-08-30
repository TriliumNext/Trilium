import clsx from "clsx";
import { Fragment } from "preact";
import {
    useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState
} from "preact/hooks";
import { JSX } from "preact/jsx-runtime";

import FBranch from "../../../entities/fbranch";
import FNote from "../../../entities/fnote";
import { ContextMenuEvent } from "../../../menus/context_menu";
import branches from "../../../services/branches";
import { getHue, parseColor } from "../../../services/css_class_manager";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import { DragData, TREE_CLIPBOARD_TYPE } from "../../note_tree";
import ActionButton from "../../react/ActionButton";
import Icon from "../../react/Icon";
import { IconPickerButton } from "../../react/IconPicker";
import NoteLink from "../../react/NoteLink";
import { BoardActionsContext, BoardDragStateContext, TitleEditor } from ".";
import BoardApi from "./api";
import Card, { CARD_CLIPBOARD_TYPE, CardDragData } from "./card";
import { DEFAULT_COLUMN_ICON } from "./columns";
import { openColumnContextMenu } from "./context_menu";

interface DragContext {
    column: string;
    columnIndex: number,
    columnItems?: { note: FNote, branch: FBranch }[];
}

export default function Column({
    column,
    columnIndex,
    icon,
    color,
    archived,
    isDraggingColumn,
    columnItems,
    api,
    parentNote,
    onColumnHover,
    isAnyColumnDragging,
    isInRelationMode
}: {
    columnItems?: { note: FNote, branch: FBranch }[];
    /** The stored icon class, absent until one is picked. Unused in relation mode. */
    icon?: string,
    /** The stored CSS colour, absent until one is picked. */
    color?: string,
    /** Whether the column is archived. Only ever rendered while archived notes are shown. */
    archived?: boolean,
    isDraggingColumn: boolean,
    api: BoardApi,
    parentNote: FNote,
    onColumnHover?: (index: number, mouseX: number, rect: DOMRect) => void,
    isAnyColumnDragging?: boolean,
    isInRelationMode: boolean
} & DragContext) {
    const [ isVisible, setVisible ] = useState(true);
    const [ isCreatingNewItem, setIsCreatingNewItem ] = useState(false);
    const { setColumnNameToEdit } = useContext(BoardActionsContext);
    const { branchIdToEdit, columnNameToEdit, dropTarget, draggedCard, dropPosition } = useContext(BoardDragStateContext);
    const isEditing = (columnNameToEdit === column);
    const editorRef = useRef<HTMLInputElement>(null);
    const { handleColumnDragStart, handleColumnDragEnd, handleDragOver, handleDragLeave, handleDrop } = useDragging({
        column, columnIndex, columnItems, isEditing, api, parentNote
    });

    const openMenu = useCallback((e: ContextMenuEvent) => {
        openColumnContextMenu(api, e, {
            value: column,
            color,
            archived,
            onEditTitle: () => setColumnNameToEdit(column),
            onNewItem: () => setIsCreatingNewItem(true),
            onAddColumn: async (direction) => {
                setColumnNameToEdit(await api.insertColumn(column, direction));
            }
        });
    }, [ api, column, color, archived, setColumnNameToEdit ]);

    // A fully desaturated colour has no hue to tint with, and leaves the column plain.
    const hue = useMemo(() => {
        const parsed = color ? parseColor(color) : undefined;
        return parsed ? getHue(parsed) : undefined;
    }, [ color ]);

    const handleTitleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "F2") {
            setColumnNameToEdit(column);
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
            data-column={column}
            className={clsx("board-column", {
                "drag-over": dropTarget === column && draggedCard?.fromColumn !== column,
                // The class the themes key a hue off, worn here as anywhere else that carries one.
                "with-hue": hue !== undefined,
                "board-column-archived": archived
            })}
            onDragOver={isAnyColumnDragging ? handleColumnDragOver : handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
                display: !isVisible ? "none" : undefined,
                "--board-column-custom-hue": hue
            }}
        >
            <h3
                className={`${isEditing ? "editing" : ""}`}
                draggable
                onDragStart={handleColumnDragStart}
                onDragEnd={handleColumnDragEnd}
                onContextMenu={openMenu}
                onKeyDown={handleTitleKeyDown}
                tabIndex={300}
            >
                {/* In relation mode the column is a note, and NoteLink already shows that note's
                    own icon, which is not the board's to change. */}
                {!isInRelationMode && (
                    <IconPickerButton
                        className="column-icon"
                        icon={icon ?? DEFAULT_COLUMN_ICON}
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
                                : column}
                        </span>
                        <div className="spacer" />
                        <span className="counter-badge">{columnItems?.length ?? 0}</span>
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
                        currentValue={column}
                        save={newTitle => api.renameColumn(column, newTitle)}
                        dismiss={() => setColumnNameToEdit(undefined)}
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
                        <Fragment key={note.noteId}>
                            {showIndicatorBefore && (
                                <div className="board-drop-placeholder show" />
                            )}
                            <Card
                                api={api}
                                note={note}
                                branch={branch}
                                column={column}
                                index={index}
                                isDragging={draggedCard?.noteId === note.noteId}
                                isEditing={branch.branchId === branchIdToEdit}
                            />
                        </Fragment>
                    );
                })}
                {dropPosition?.column === column && dropPosition.index === (columnItems?.length ?? 0) && (
                    <div className="board-drop-placeholder show" />
                )}

                <AddNewItem
                    api={api}
                    column={column}
                    itemCount={columnItems?.length ?? 0}
                    isCreating={isCreatingNewItem}
                    setIsCreating={setIsCreatingNewItem}
                />
            </div>
        </div>
    );
}

/**
 * The editor a new card is named in, opened by the button below the column or by its menu. The
 * state is the column's rather than this component's, since the menu is raised from the header.
 */
function AddNewItem({ column, api, itemCount, isCreating, setIsCreating }: {
    column: string,
    api: BoardApi,
    /** How many cards stand above it, which is what moves it out of view as they come and go. */
    itemCount: number,
    isCreating: boolean,
    setIsCreating: (isCreating: boolean) => void
}) {
    const [ initialTitle, setInitialTitle ] = useState("");
    const slotRef = useRef<HTMLDivElement>(null);

    // Reaching the button means reaching the end of the column, so what is under it comes into view
    // with it. The browser scrolls only far enough to show the button itself.
    const scrollToEnd = useCallback(() => {
        const content = slotRef.current?.closest(".board-column-content");
        if (content) {
            content.scrollTop = content.scrollHeight;
        }
    }, []);

    // A card added lands above the button and pushes it out of sight, and the editor stands taller
    // than the button it replaces. Neither raises a focus event, so whatever is focused in here has
    // to be followed back into view.
    useLayoutEffect(() => {
        if (slotRef.current?.contains(document.activeElement)) {
            scrollToEnd();
        }
    }, [ itemCount, isCreating, scrollToEnd ]);

    const open = useCallback((title: string) => {
        setInitialTitle(title);
        setIsCreating(true);
    }, [ setIsCreating ]);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (isCreating) return;

        if (e.key === "Enter") {
            open("");
            return;
        }

        // Typing on the button starts the note off with what was typed, rather than asking for it
        // twice. A printable key is one whose name is the character itself, which no modified press
        // and none of the named keys are.
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            open(e.key);
        }
    }, [ isCreating, open ]);

    return (
        <div
            ref={slotRef}
            className={`board-new-item ${isCreating ? "editing" : ""}`}
            onClick={() => open("")}
            onKeyDown={handleKeyDown}
            onFocus={scrollToEnd}
            tabIndex={300}
        >
            {!isCreating ? (
                <>
                    <Icon icon="bx bx-plus" />{" "}
                    {t("board_view.new-item")}
                </>
            ) : (
                <TitleEditor
                    currentValue={initialTitle}
                    placeholder={t("board_view.new-item-placeholder")}
                    save={(title) => api.createNewItem(column, title)}
                    dismiss={() => setIsCreating(false)}
                    mode="multiline" isNewItem
                    selectOnFocus={false}
                />
            )}
        </div>
    );
}

function useDragging({ column, columnIndex, columnItems, isEditing, api, parentNote }: DragContext & { isEditing: boolean, api: BoardApi, parentNote: FNote }) {
    const { setDraggedColumn, setDropTarget, setDropPosition } = useContext(BoardActionsContext);
    const { draggedColumn, dropPosition } = useContext(BoardDragStateContext);
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
            const parentNoteId = parentNote.noteId;
            if (!dropPosition) return;

            const targetIndex = dropPosition.index - 1;
            const targetItems = columnItems || [];
            const targetBranch = targetIndex >= 0 ? targetItems[targetIndex].branch : null;

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
        } else if (draggedCard && dropPosition) {
            api.moveWithinBoard(draggedCard.noteId, draggedCard.branchId, draggedCard.index, dropPosition.index, draggedCard.fromColumn, column);
        }

    }, [ api, draggedColumn, dropPosition, columnItems, column, setDropTarget, setDropPosition ]);

    return { handleColumnDragStart, handleColumnDragEnd, handleDragOver, handleDragLeave, handleDrop };
}
