import { Dispatch, StateUpdater, useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ViewModeProps } from "../interface";
import "./index.css";
import { ColumnMap, getBoardData } from "./data";
import { useNoteLabelBoolean, useNoteLabelWithDefault, useTriliumEvent } from "../../react/hooks";
import Icon from "../../react/Icon";
import { t } from "../../../services/i18n";
import Api from "./api";
import FormTextBox from "../../react/FormTextBox";
import { createContext, TargetedKeyboardEvent } from "preact";
import { onWheelHorizontalScroll } from "../../widget_utils";
import Column from "./column";
import BoardApi from "./api";
import FormTextArea from "../../react/FormTextArea";
import FNote from "../../../entities/fnote";
import NoteAutocomplete from "../../react/NoteAutocomplete";
import toast from "../../../services/toast";

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
    const [ statusAttributeWithPrefix ] = useNoteLabelWithDefault(parentNote, "board:groupBy", "status");
    const [ includeArchived ] = useNoteLabelBoolean(parentNote, "includeArchived");
    const [ byColumn, setByColumn ] = useState<ColumnMap>();
    const [ columns, setColumns ] = useState<string[]>();
    const [ isInRelationMode, setIsRelationMode ] = useState(false);
    const [ draggedCard, setDraggedCard ] = useState<{ noteId: string, branchId: string, fromColumn: string, index: number } | null>(null);
    const [ dropTarget, setDropTarget ] = useState<string | null>(null);
    const [ dropPosition, setDropPosition ] = useState<{ column: string, index: number } | null>(null);
    const [ draggedColumn, setDraggedColumn ] = useState<{ column: string, index: number } | null>(null);
    const [ columnDropPosition, setColumnDropPosition ] = useState<number | null>(null);
    const [ columnHoverIndex, setColumnHoverIndex ] = useState<number | null>(null);
    const [ branchIdToEdit, setBranchIdToEdit ] = useState<string>();
    const [ columnNameToEdit, setColumnNameToEdit ] = useState<string>();
    const api = useMemo(() => {
        return new Api(byColumn, columns ?? [], parentNote, statusAttributeWithPrefix, viewConfig ?? {}, saveConfig, setBranchIdToEdit );
    }, [ byColumn, columns, parentNote, statusAttributeWithPrefix, viewConfig, saveConfig, setBranchIdToEdit ]);
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
        getBoardData(parentNote, statusAttributeWithPrefix, viewConfig ?? {}, includeArchived).then(({ byColumn, newPersistedData, isInRelationMode }) => {
            setByColumn(byColumn);
            setIsRelationMode(isInRelationMode);

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

    useEffect(refresh, [ parentNote, noteIds, viewConfig, statusAttributeWithPrefix ]);

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
            loadResults.getAttributeRows().some(attr => attr.name === api.statusAttribute && noteIds.includes(attr.noteId!)) ||
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
                {byColumn && columns && <div
                    className="board-view-container"
                    onDragOver={handleColumnDragOver}
                    onDrop={handleContainerDrop}
                >
                    {columns.map((column, index) => (
                        <>
                            {columnDropPosition === index && (
                                <div className="column-drop-placeholder show" />
                            )}
                            <Column
                                isInRelationMode={isInRelationMode}
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

                    <AddNewColumn api={api} isInRelationMode={isInRelationMode} />
                </div>}
            </BoardViewContext.Provider>
        </div>
    )
}

function AddNewColumn({ api, isInRelationMode }: { api: BoardApi, isInRelationMode: boolean }) {
    const [ isCreatingNewColumn, setIsCreatingNewColumn ] = useState(false);

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
                    save={async (columnName) => {
                        const created = await api.addNewColumn(columnName);
                        if (!created) {
                            toast.showMessage(t("board_view.column-already-exists"), undefined, "bx bx-duplicate");
                        }
                    }}
                    dismiss={() => setIsCreatingNewColumn(false)}
                    isNewItem
                    mode={isInRelationMode ? "relation" : "normal"}
                />
            )}
        </div>
    )
}

export function TitleEditor({ currentValue, placeholder, save, dismiss, mode, isNewItem }: {
    currentValue?: string;
    placeholder?: string;
    save: (newValue: string) => void | Promise<void>;
    dismiss: () => void;
    isNewItem?: boolean;
    mode?: "normal" | "multiline" | "relation";
}) {
    const inputRef = useRef<any>(null);
    const focusElRef = useRef<Element>(null);
    const dismissOnNextRefreshRef = useRef(false);
    const shouldDismiss = useRef(false);

    useEffect(() => {
        focusElRef.current = document.activeElement !== document.body ? document.activeElement : null;
        inputRef.current?.focus();
        inputRef.current?.select();
    }, [ inputRef ]);

    useEffect(() => {
        if (dismissOnNextRefreshRef.current) {
            dismiss();
            dismissOnNextRefreshRef.current = false;
        }
    });

    const onKeyDown = (e: TargetedKeyboardEvent<HTMLInputElement | HTMLTextAreaElement> | KeyboardEvent) => {
        if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (focusElRef.current instanceof HTMLElement) {
                shouldDismiss.current = (e.key === "Escape");
                focusElRef.current.focus();
            } else {
                dismiss();
            }
        }
    };

    const onBlur = (newValue: string) => {
        if (!shouldDismiss.current && newValue.trim() && (newValue !== currentValue || isNewItem)) {
            save(newValue);
            dismissOnNextRefreshRef.current = true;
        } else {
            dismiss();
        }
    };

    if (mode !== "relation") {
        const Element = mode === "multiline" ? FormTextArea : FormTextBox;

        return (
            <Element
                inputRef={inputRef}
                currentValue={currentValue ?? ""}
                placeholder={placeholder}
                autoComplete="trilium-title-entry" // forces the auto-fill off better than the "off" value.
                rows={mode === "multiline" ? 4 : undefined}
                onKeyDown={onKeyDown}
                onBlur={onBlur}
            />
        );
    } else {
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
}
