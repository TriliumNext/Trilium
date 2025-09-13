import { Dispatch, StateUpdater, useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ViewModeProps } from "../interface";
import "./index.css";
import { ColumnMap, getBoardData } from "./data";
import { useNoteLabelBoolean, useNoteLabelWithDefault, useTriliumEvent } from "../../react/hooks";
import Icon from "../../react/Icon";
import { t } from "../../../services/i18n";
import Api from "./api";
import FormTextBox from "../../react/FormTextBox";
import { createContext, JSX } from "preact";
import { onWheelHorizontalScroll } from "../../widget_utils";
import Column from "./column";
import BoardApi from "./api";
import FormTextArea from "../../react/FormTextArea";
import FNote from "../../../entities/fnote";

export interface BoardViewData {
    columns?: BoardColumnData[];
}

export interface BoardColumnData {
    value: string;
}

interface BoardViewContextData {
    api?: BoardApi;
    parentNote?: FNote;
    branchIdToEdit?: string;
    columnNameToEdit?: string;
    setColumnNameToEdit?: Dispatch<StateUpdater<string | undefined>>;
    setBranchIdToEdit?: Dispatch<StateUpdater<string | undefined>>;
    draggedColumn: { column: string, index: number } | null;
    setDraggedColumn: (column: { column: string, index: number } | null) => void;
    dropPosition: { column: string, index: number } | null;
    setDropPosition: (position: { column: string, index: number } | null) => void;
    setDropTarget: (target: string | null) => void,
    dropTarget: string | null;
    draggedCard: { noteId: string, branchId: string, fromColumn: string, index: number } | null;
    setDraggedCard: Dispatch<StateUpdater<{ noteId: string; branchId: string; fromColumn: string; index: number; } | null>>;
}

export const BoardViewContext = createContext<BoardViewContextData | undefined>(undefined);

export default function BoardView({ note: parentNote, noteIds, viewConfig, saveConfig }: ViewModeProps<BoardViewData>) {
    const [ statusAttribute ] = useNoteLabelWithDefault(parentNote, "board:groupBy", "status");
    const [ includeArchived ] = useNoteLabelBoolean(parentNote, "includeArchived");
    const [ byColumn, setByColumn ] = useState<ColumnMap>();
    const [ columns, setColumns ] = useState<string[]>();
    const [ draggedCard, setDraggedCard ] = useState<{ noteId: string, branchId: string, fromColumn: string, index: number } | null>(null);
    const [ dropTarget, setDropTarget ] = useState<string | null>(null);
    const [ dropPosition, setDropPosition ] = useState<{ column: string, index: number } | null>(null);
    const [ draggedColumn, setDraggedColumn ] = useState<{ column: string, index: number } | null>(null);
    const [ columnDropPosition, setColumnDropPosition ] = useState<number | null>(null);
    const [ columnHoverIndex, setColumnHoverIndex ] = useState<number | null>(null);
    const [ branchIdToEdit, setBranchIdToEdit ] = useState<string>();
    const [ columnNameToEdit, setColumnNameToEdit ] = useState<string>();
    const api = useMemo(() => {
        return new Api(byColumn, columns ?? [], parentNote, statusAttribute, viewConfig ?? {}, saveConfig, setBranchIdToEdit );
    }, [ byColumn, columns, parentNote, statusAttribute, viewConfig, saveConfig, setBranchIdToEdit ]);
    const boardViewContext = useMemo<BoardViewContextData>(() => ({
        api,
        parentNote,
        branchIdToEdit, setBranchIdToEdit,
        columnNameToEdit, setColumnNameToEdit,
        draggedColumn, setDraggedColumn,
        dropPosition, setDropPosition,
        draggedCard, setDraggedCard,
        dropTarget, setDropTarget
    }), [
        api,
        parentNote,
        branchIdToEdit, setBranchIdToEdit,
        columnNameToEdit, setColumnNameToEdit,
        draggedColumn, setDraggedColumn,
        dropPosition, setDropPosition,
        draggedCard, setDraggedCard,
        dropTarget, setDropTarget
    ]);

    function refresh() {
        getBoardData(parentNote, statusAttribute, viewConfig ?? {}, includeArchived).then(({ byColumn, newPersistedData }) => {
            setByColumn(byColumn);

            if (newPersistedData) {
                viewConfig = { ...newPersistedData };
                saveConfig(newPersistedData);
            }

            // Use the order from persistedData.columns, then add any new columns found
            const orderedColumns = viewConfig?.columns?.map(col => col.value) || [];
            const allColumns = Array.from(byColumn.keys());
            const newColumns = allColumns.filter(col => !orderedColumns.includes(col));
            setColumns([...orderedColumns, ...newColumns]);
        });
    }

    useEffect(refresh, [ parentNote, noteIds, viewConfig ]);

    const handleColumnDrop = useCallback((fromIndex: number, toIndex: number) => {
        const newColumns = api.reorderColumn(fromIndex, toIndex);
        if (newColumns) {
            setColumns(newColumns);
        }
        setDraggedColumn(null);
        setDraggedCard(null);
        setColumnDropPosition(null);
    }, [api]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        // Check if any changes affect our board
        const hasRelevantChanges =
            // React to changes in status attribute for notes in this board
            loadResults.getAttributeRows().some(attr => attr.name === statusAttribute && noteIds.includes(attr.noteId!)) ||
            // React to changes in note title
            loadResults.getNoteIds().some(noteId => noteIds.includes(noteId)) ||
            // React to changes in branches for subchildren (e.g., moved, added, or removed notes)
            loadResults.getBranchRows().some(branch => noteIds.includes(branch.noteId!)) ||
            // React to changes in note icon or color.
            loadResults.getAttributeRows().some(attr => [ "iconClass", "color" ].includes(attr.name ?? "") && noteIds.includes(attr.noteId ?? "")) ||
            // React to attachment change
            loadResults.getAttachmentRows().some(att => att.ownerId === parentNote.noteId && att.title === "board.json") ||
            // React to changes in "groupBy"
            loadResults.getAttributeRows().some(attr => attr.name === "board:groupBy" && attr.noteId === parentNote.noteId);

        if (hasRelevantChanges) {
            refresh();
        }
    });

    const handleColumnDragOver = useCallback((e: DragEvent) => {
        if (!draggedColumn) return;
        e.preventDefault();
    }, [draggedColumn]);

    const handleColumnHover = useCallback((index: number, mouseX: number, columnRect: DOMRect) => {
        if (!draggedColumn) return;

        const columnMiddle = columnRect.left + columnRect.width / 2;

        // Determine if we should insert before or after this column
        const insertBefore = mouseX < columnMiddle;

        // Calculate the target position
        let targetIndex = insertBefore ? index : index + 1;

        setColumnDropPosition(targetIndex);
    }, [draggedColumn]);

    const handleContainerDrop = useCallback((e: DragEvent) => {
        e.preventDefault();
        if (draggedColumn && columnDropPosition !== null) {
            handleColumnDrop(draggedColumn.index, columnDropPosition);
        }
        setColumnHoverIndex(null);
    }, [draggedColumn, columnDropPosition, handleColumnDrop]);

    return (
        <div
            className="board-view"
            onWheel={onWheelHorizontalScroll}
        >
            <BoardViewContext.Provider value={boardViewContext}>
                <div
                    className="board-view-container"
                    onDragOver={handleColumnDragOver}
                    onDrop={handleContainerDrop}
                >
                    {byColumn && columns?.map((column, index) => (
                        <>
                            {columnDropPosition === index && (
                                <div className="column-drop-placeholder show" />
                            )}
                            <Column
                                api={api}
                                column={column}
                                columnIndex={index}
                                columnItems={byColumn.get(column)}
                                isDraggingColumn={draggedColumn?.column === column}
                                onColumnHover={handleColumnHover}
                                isAnyColumnDragging={!!draggedColumn}
                            />
                        </>
                    ))}
                    {columnDropPosition === columns?.length && draggedColumn && (
                        <div className="column-drop-placeholder show" />
                    )}

                    <AddNewColumn api={api} />
                </div>
            </BoardViewContext.Provider>
        </div>
    )
}

function AddNewColumn({ api }: { api: BoardApi }) {
    const [ isCreatingNewColumn, setIsCreatingNewColumn ] = useState(false);

    const addColumnCallback = useCallback(() => {
        setIsCreatingNewColumn(true);
    }, []);

    return (
        <div className={`board-add-column ${isCreatingNewColumn ? "editing" : ""}`} onClick={addColumnCallback}>
            {!isCreatingNewColumn
            ? <>
                <Icon icon="bx bx-plus" />{" "}
                {t("board_view.add-column")}
            </>
            : (
                <TitleEditor
                    placeholder={t("board_view.add-column-placeholder")}
                    save={(columnName) => api.addNewColumn(columnName)}
                    dismiss={() => setIsCreatingNewColumn(false)}
                    isNewItem
                />
            )}
        </div>
    )
}

export function TitleEditor({ currentValue, placeholder, save, dismiss, multiline, isNewItem }: {
    currentValue?: string;
    placeholder?: string;
    save: (newValue: string) => void;
    dismiss: () => void;
    multiline?: boolean;
    isNewItem?: boolean;
}) {
    const inputRef = useRef<any>(null);
    const dismissOnNextRefreshRef = useRef(false);

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, [ inputRef ]);

    const Element = multiline ? FormTextArea : FormTextBox;

    useEffect(() => {
        if (dismissOnNextRefreshRef.current) {
            dismiss();
            dismissOnNextRefreshRef.current = false;
        }
    });

    return (
        <Element
            inputRef={inputRef}
            currentValue={currentValue ?? ""}
            placeholder={placeholder}
            autoComplete="trilium-title-entry" // forces the auto-fill off better than the "off" value.
            rows={multiline ? 4 : undefined}
            onKeyDown={(e: JSX.TargetedKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                if (e.key === "Enter") {
                    const newValue = e.currentTarget?.value;
                    if (newValue.trim() && (newValue !== currentValue || isNewItem)) {
                        save(newValue);
                        dismissOnNextRefreshRef.current = true;
                    }
                }

                if (e.key === "Escape") {
                    dismiss();
                }
            }}
            onBlur={(newValue) => {
                if (newValue.trim() && (newValue !== currentValue || isNewItem)) {
                    save(newValue);
                    dismissOnNextRefreshRef.current = true;
                } else {
                    dismiss();
                }
            }}
        />
    );
}
