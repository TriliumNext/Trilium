import { CommandType, FUniver, IDisposable, IWorkbookData } from "@univerjs/presets";
import { MutableRef, useEffect, useRef } from "preact/hooks";

import NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import { SavedData, useEditorSpacedUpdate } from "../../react/hooks";

interface PersistedData {
    version: number;
    workbook: Parameters<FUniver["createWorkbook"]>[0];
}

interface SpreadsheetViewState {
    activeSheetId?: string;
    cursorRow?: number;
    cursorCol?: number;
    scrollRow?: number;
    scrollCol?: number;
}

export default function usePersistence(note: FNote, noteContext: NoteContext | null | undefined, apiRef: MutableRef<FUniver | undefined>, containerRef: MutableRef<HTMLDivElement | null>, readOnly: boolean) {
    const changeListener = useRef<IDisposable>(null);
    const pendingContent = useRef<string | null>(null);

    function saveViewState(univerAPI: FUniver): SpreadsheetViewState {
        const state: SpreadsheetViewState = {};
        try {
            const workbook = univerAPI.getActiveWorkbook();
            if (!workbook) return state;

            const activeSheet = workbook.getActiveSheet();
            state.activeSheetId = activeSheet?.getSheetId();

            const currentCell = activeSheet?.getSelection()?.getCurrentCell();
            if (currentCell) {
                state.cursorRow = currentCell.actualRow;
                state.cursorCol = currentCell.actualColumn;
            }

            const scrollState = activeSheet?.getScrollState?.();
            if (scrollState) {
                state.scrollRow = scrollState.sheetViewStartRow;
                state.scrollCol = scrollState.sheetViewStartColumn;
            }
        } catch {
            // Ignore errors when reading state from a workbook being disposed.
        }
        return state;
    }

    function restoreViewState(workbook: ReturnType<FUniver["createWorkbook"]>, state: SpreadsheetViewState) {
        try {
            if (state.activeSheetId) {
                const targetSheet = workbook.getSheetBySheetId(state.activeSheetId);
                if (targetSheet) {
                    workbook.setActiveSheet(targetSheet);
                }
            }
            if (state.cursorRow !== undefined && state.cursorCol !== undefined) {
                workbook.getActiveSheet().getRange(state.cursorRow, state.cursorCol).activate();
            }
            if (state.scrollRow !== undefined && state.scrollCol !== undefined) {
                workbook.getActiveSheet().scrollToCell(state.scrollRow, state.scrollCol);
            }
        } catch {
            // Ignore errors when restoring state (e.g. sheet no longer exists).
        }
    }

    function applyContent(univerAPI: FUniver, newContent: string) {
        const viewState = saveViewState(univerAPI);

        // Dispose the existing workbook.
        const existingWorkbook = univerAPI.getActiveWorkbook();
        if (existingWorkbook) {
            univerAPI.disposeUnit(existingWorkbook.getId());
        }

        let workbookData: Partial<IWorkbookData> = {};
        if (newContent) {
            try {
                const parsedContent = JSON.parse(newContent) as unknown;
                if (parsedContent && typeof parsedContent === "object" && "workbook" in parsedContent) {
                    const persistedData = parsedContent as PersistedData;
                    workbookData = persistedData.workbook;
                }
            } catch (e) {
                console.error("Failed to parse spreadsheet content", e);
            }
        }

        const workbook = univerAPI.createWorkbook(workbookData);
        if (readOnly) {
            workbook.disableSelection();
            const permission = workbook.getPermission();
            permission.setWorkbookEditPermission(workbook.getId(), false);
            permission.setPermissionDialogVisible(false);
        }

        restoreViewState(workbook, viewState);

        if (changeListener.current) {
            changeListener.current.dispose();
        }
        changeListener.current = workbook.onCommandExecuted(command => {
            if (command.type !== CommandType.MUTATION) return;
            spacedUpdate.scheduleUpdate();
        });
    }

    function isContainerVisible() {
        const el = containerRef.current;
        if (!el) return false;
        return el.offsetWidth > 0 && el.offsetHeight > 0;
    }

    const spacedUpdate = useEditorSpacedUpdate({
        noteType: "spreadsheet",
        note,
        noteContext,
        async getData() {
            const univerAPI = apiRef.current;
            if (!univerAPI) return undefined;
            const workbook = univerAPI.getActiveWorkbook();
            if (!workbook) return undefined;
            const content = {
                version: 1,
                workbook: workbook.save()
            };

            const attachments: SavedData["attachments"] = [];
            const canvasEl = containerRef.current?.querySelector<HTMLCanvasElement>("canvas[id]");
            if (canvasEl) {
                const dataUrl = canvasEl.toDataURL("image/png");
                const base64 = dataUrl.split(",")[1];
                attachments.push({
                    role: "image",
                    title: "spreadsheet-export.png",
                    mime: "image/png",
                    content: base64,
                    position: 0,
                    encoding: "base64"
                });
            }

            return {
                content: JSON.stringify(content),
                attachments
            };
        },
        onContentChange(newContent) {
            const univerAPI = apiRef.current;
            if (!univerAPI) return undefined;

            // Defer content application if the container is hidden (zero size),
            // since the spreadsheet library cannot calculate layout in that state.
            if (!isContainerVisible()) {
                pendingContent.current = newContent;
                return;
            }

            pendingContent.current = null;
            applyContent(univerAPI, newContent);
        },
    });

    // Apply pending content once the container becomes visible (non-zero size).
    useEffect(() => {
        if (!containerRef.current) return;

        const observer = new ResizeObserver(() => {
            if (pendingContent.current === null || !isContainerVisible()) return;

            const univerAPI = apiRef.current;
            if (!univerAPI) return;

            const content = pendingContent.current;
            pendingContent.current = null;
            applyContent(univerAPI, content);
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally stable: applyContent/isContainerVisible use refs
    }, [ containerRef ]);

    useEffect(() => {
        return () => {
            if (changeListener.current) {
                changeListener.current.dispose();
                changeListener.current = null;
            }
        };
    }, []);
}
