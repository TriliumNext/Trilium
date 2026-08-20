import "./index.css";

import { createContext, TargetedKeyboardEvent } from "preact";
import { Dispatch, StateUpdater, useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import type LoadResults from "../../../services/load_results";
import { isIMEComposing } from "../../../services/shortcuts";
import toast from "../../../services/toast";
import CollectionProperties from "../../note_bars/CollectionProperties";
import FormTextArea from "../../react/FormTextArea";
import FormTextBox from "../../react/FormTextBox";
import { useNoteLabelBoolean, useNoteLabelWithDefault, useTriliumEvent } from "../../react/hooks";
import Icon from "../../react/Icon";
import NoteAutocomplete from "../../react/NoteAutocomplete";
import { onWheelHorizontalScroll } from "../../widget_utils";
import { ViewModeProps } from "../interface";
import Api from "./api";
import BoardApi from "./api";
import { DEFAULT_GROUP_BY, getStatusDefinition } from "./columns";
import Column from "./column";
import { ColumnMap, getBoardData } from "./data";

export interface BoardViewData {
    columns?: BoardColumnData[];
}

export interface BoardColumnData {
    value: string;
}

interface CardDrag {
    noteId: string;
    branchId: string;
    fromColumn: string;
    index: number;
}

interface ColumnDrag {
    column: string;
    index: number;
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
export const BoardActionsContext = createContext<BoardActions>({
    setBranchIdToEdit: () => undefined,
    setColumnNameToEdit: () => undefined,
    setDraggedCard: () => undefined,
    setDraggedColumn: () => undefined,
    setDropPosition: () => undefined,
    setDropTarget: () => undefined
});

export const BoardDragStateContext = createContext<BoardDragState>({
    draggedCard: null,
    draggedColumn: null,
    dropPosition: null,
    dropTarget: null
});

export default function BoardView({ note: parentNote, noteIds, viewConfig, saveConfig }: ViewModeProps<BoardViewData>) {
    const [ statusAttributeWithPrefix ] = useNoteLabelWithDefault(parentNote, "board:groupBy", DEFAULT_GROUP_BY);
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
    /** Bumped when the definition changes, since it is read off the note rather than held in state. */
    const [ definitionRevision, setDefinitionRevision ] = useState(0);
    const statusDefinition = useMemo(
        () => getStatusDefinition(parentNote, statusAttributeWithPrefix),
        [ parentNote, statusAttributeWithPrefix, definitionRevision ]);
    const api = useMemo(() => {
        return new Api(byColumn, columns ?? [], parentNote, statusAttributeWithPrefix, viewConfig ?? {}, saveConfig, setBranchIdToEdit, statusDefinition );
    }, [ byColumn, columns, parentNote, statusAttributeWithPrefix, viewConfig, saveConfig, setBranchIdToEdit, statusDefinition ]);
    // Every member is one of useState's own setters, so this value is built once and never changes
    // identity -- a drag cannot reach anything that reads only this.
    const boardActions = useMemo<BoardActions>(() => ({
        setBranchIdToEdit,
        setColumnNameToEdit,
        setDraggedCard,
        setDraggedColumn,
        setDropPosition,
        setDropTarget
    }), [
        setBranchIdToEdit, setColumnNameToEdit, setDraggedCard,
        setDraggedColumn, setDropPosition, setDropTarget
    ]);

    const boardDragState = useMemo<BoardDragState>(() => ({
        branchIdToEdit,
        columnNameToEdit,
        draggedCard,
        draggedColumn,
        dropPosition,
        dropTarget
    }), [ branchIdToEdit, columnNameToEdit, draggedCard, draggedColumn, dropPosition, dropTarget ]);

    function refresh() {
        // A definition the board owns is written only by the board's own column sync, so the
        // persisted list mirrors it; one it merely inherits still leads the attachment alone.
        getBoardData(parentNote, statusAttributeWithPrefix, viewConfig ?? {}, includeArchived, statusDefinition?.options ?? [], statusDefinition?.isOwned === true)
            .then(({ byColumn, columns, newPersistedData, isInRelationMode }) => {
                setByColumn(byColumn);
                setIsRelationMode(isInRelationMode);
                setColumns(columns);

                if (newPersistedData) {
                    viewConfig = { ...newPersistedData };
                    saveConfig(newPersistedData);
                }

                // The columns the board settled on are the options its definition should offer. This
                // is what gives a board created after migration 0240 ran a definition at all, and what
                // keeps one that gained a column from outside the board's own UI up to date. It writes
                // only when the two actually differ, so the re-render its own write causes stops here.
                // Reported rather than surfaced: nothing the user did is failing, and a board that
                // cannot write it re-tries on the next render, which would toast on each one.
                api.syncColumnsToDefinition(columns)
                    .catch((e) => console.error("Failed to sync the board columns to the attribute definition:", e));
            });
    }

    useEffect(refresh, [ parentNote, noteIds, viewConfig, statusAttributeWithPrefix, statusDefinition ]);

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
        // The column list is read off the definition, which may be edited from the attribute panel,
        // another split, or a synced instance. Re-reading it re-runs the refresh through the effect.
        if (loadResults.getAttributeRows().some(attr => attr.name === `label:${api.statusAttribute}`)) {
            setDefinitionRevision(revision => revision + 1);
        }

        if (findRefreshReason(loadResults, api.statusAttribute, noteIds, parentNote.noteId)) {
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
        const targetIndex = insertBefore ? index : index + 1;

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
        <div className="board-view">
            <CollectionProperties note={parentNote} />
            <BoardActionsContext.Provider value={boardActions}>
                <BoardDragStateContext.Provider value={boardDragState}>
                    {byColumn && columns && <div
                        className="board-view-container"
                        onDragOver={handleColumnDragOver}
                        onDrop={handleContainerDrop}
                        onWheel={onWheelHorizontalScroll}
                    >
                        {columns.map((column, index) => (
                            <>
                                {columnDropPosition === index && (
                                    <div className="column-drop-placeholder show" />
                                )}
                                <Column
                                    isInRelationMode={isInRelationMode}
                                    api={api}
                                    parentNote={parentNote}
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
                </BoardDragStateContext.Provider>
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
    );
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
        // Skip processing during IME composition so the Enter that commits a
        // CJK conversion does not also save the title with unconfirmed text.
        if (isIMEComposing(e)) {
            return;
        }

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
