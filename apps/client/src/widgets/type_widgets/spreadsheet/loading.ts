import { FUniver, IWorkbookData, LocaleType } from "@univerjs/presets";
import { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";

import type NoteContext from "../../../components/note_context";
import type FNote from "../../../entities/fnote";
import server from "../../../services/server";
import { randomString } from "../../../services/utils";
import { useNoteBlob } from "../../react/hooks";

type FWorkbook = ReturnType<FUniver["createWorkbook"]>;

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

export interface WorkbookDisplayHooks {
    /** Called with the parsed workbook data before Univer creates the workbook from it. */
    prepare?(workbookData: Partial<IWorkbookData>): void;
    /** Called with the workbook once it is created and shown. */
    loaded?(workbook: FWorkbook): void;
}

/**
 * Shows the workbook JSON a spreadsheet note stores in the Univer instance of `apiRef`, keeping
 * the active sheet, the cursor and the scroll position across a reload. Content that arrives
 * while the container is hidden waits until it has a size, since Univer cannot lay out a
 * workbook in a zero-sized container.
 */
export function useWorkbookDisplay(apiRef: RefObject<FUniver | undefined>, containerRef: RefObject<HTMLDivElement | null>, hooks: WorkbookDisplayHooks = {}) {
    const pendingContent = useRef<string | null>(null);
    const hooksRef = useRef(hooks);
    hooksRef.current = hooks;

    function isContainerVisible() {
        const el = containerRef.current;
        if (!el) return false;
        return el.offsetWidth > 0 && el.offsetHeight > 0;
    }

    function applyContent(univerAPI: FUniver, newContent: string) {
        const viewState = saveViewState(univerAPI);
        const existingWorkbook = univerAPI.getActiveWorkbook();

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

        hooksRef.current.prepare?.(workbookData);

        // Always assign a fresh unit id. The persisted id is reused verbatim, but the
        // new workbook is created below BEFORE the old one is disposed, so a stale or
        // shared id (e.g. a duplicated/cloned note, or this note's content being
        // re-applied) would collide in Univer's unit registry and throw. The id is
        // ephemeral — view state keys off the sheet id, not the workbook id.
        workbookData.id = randomString();

        // Pin the workbook locale to the only locale bundle the editor registers (see
        // Spreadsheet.tsx). Univer's workbook model otherwise defaults a missing locale
        // to "zhCN", which mismatches the English UI; pinning it here keeps new and
        // loaded workbooks consistent and lets the persisted value be dropped on save.
        workbookData.locale = LocaleType.EN_US;

        // Create the new workbook BEFORE disposing the old one so the formula
        // engine transitions cleanly without a gap where stale state could leak.
        const workbook = univerAPI.createWorkbook(workbookData);

        if (existingWorkbook) {
            univerAPI.disposeUnit(existingWorkbook.getId());
        }

        restoreViewState(workbook, viewState);
        hooksRef.current.loaded?.(workbook);
    }

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

    return {
        /** Shows `content`, the JSON a spreadsheet note stores, now or once the container shows. */
        show(content: string) {
            const univerAPI = apiRef.current;
            if (!univerAPI) return;

            if (!isContainerVisible()) {
                pendingContent.current = content;
                return;
            }

            pendingContent.current = null;
            applyContent(univerAPI, content);
        }
    };
}

/**
 * Shows the workbook of an XLSX file note, which the server parses into the JSON a spreadsheet
 * note stores. Calls `onError` when the file cannot be read as a workbook.
 */
export function useWorkbookFile(note: FNote, noteContext: NoteContext | null | undefined, componentId: string | undefined,
    apiRef: RefObject<FUniver | undefined>, containerRef: RefObject<HTMLDivElement | null>, onError: () => void) {
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;
    const display = useWorkbookDisplay(apiRef, containerRef);
    const workbook = useNoteBlob<{ content: string; failed?: boolean }>(note, componentId, {
        reportLoadStateTo: noteContext,
        // A file that is no workbook is answered by the caller's fallback, not by the note
        // detail's load error, so the failure resolves as a loaded result.
        load: async (loadedNote) => {
            try {
                const content = await server.getWithSilentErrors<string>(
                    `notes/${loadedNote.noteId}/spreadsheet-workbook`, undefined, true);
                return { content };
            } catch {
                return { content: "", failed: true };
            }
        }
    });

    useEffect(() => {
        if (workbook?.failed) {
            onErrorRef.current();
        } else if (workbook) {
            display.show(workbook.content);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `display` holds refs only
    }, [ workbook ]);
}

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

function restoreViewState(workbook: FWorkbook, state: SpreadsheetViewState) {
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
