import "@univerjs/preset-sheets-core/lib/index.css";
import "./Spreadsheet.css";

import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import UniverPresetSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import { CommandType, createUniver, FUniver, IDisposable, IWorkbookData, LocaleType, mergeLocales } from '@univerjs/presets';
import { MutableRef, useEffect, useRef } from "preact/hooks";

import NoteContext from "../../components/note_context";
import FNote from "../../entities/fnote";
import { useColorScheme, useEditorSpacedUpdate } from "../react/hooks";
import { TypeWidgetProps } from "./type_widget";

interface PersistedData {
    version: number;
    workbook: Parameters<FUniver["createWorkbook"]>[0];
}

export default function Spreadsheet({ note, noteContext }: TypeWidgetProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<FUniver>();

    useInitializeSpreadsheet(containerRef, apiRef);
    useDarkMode(apiRef);
    usePersistence(note, noteContext, apiRef);

    return <div ref={containerRef} className="spreadsheet" />;
}

function useInitializeSpreadsheet(containerRef: MutableRef<HTMLDivElement | null>, apiRef: MutableRef<FUniver | undefined>) {
    useEffect(() => {
        if (!containerRef.current) return;

        const { univerAPI } = createUniver({
            locale: LocaleType.EN_US,
            locales: {
                [LocaleType.EN_US]: mergeLocales(
                    UniverPresetSheetsCoreEnUS
                ),
            },
            presets: [
                UniverSheetsCorePreset({
                    container: containerRef.current,
                })
            ]
        });
        apiRef.current = univerAPI;
        return () => univerAPI.dispose();
    }, [ apiRef, containerRef ]);
}

function useDarkMode(apiRef: MutableRef<FUniver | undefined>) {
    const colorScheme = useColorScheme();

    // React to dark mode.
    useEffect(() => {
        const univerAPI = apiRef.current;
        if (!univerAPI) return;
        univerAPI.toggleDarkMode(colorScheme === 'dark');
    }, [ colorScheme, apiRef ]);
}

function usePersistence(note: FNote, noteContext: NoteContext | null | undefined, apiRef: MutableRef<FUniver | undefined>) {
    const changeListener = useRef<IDisposable>(null);

    const spacedUpdate = useEditorSpacedUpdate({
        noteType: "spreadsheet",
        note,
        noteContext,
        getData() {
            const univerAPI = apiRef.current;
            if (!univerAPI) return undefined;
            const workbook = univerAPI.getActiveWorkbook();
            if (!workbook) return undefined;
            const content = {
                version: 1,
                workbook: workbook.save()
            };
            return {
                content: JSON.stringify(content)
            };
        },
        onContentChange(newContent) {
            const univerAPI = apiRef.current;
            if (!univerAPI) return undefined;

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
            if (changeListener.current) {
                changeListener.current.dispose();
            }
            changeListener.current = workbook.onCommandExecuted(command => {
                if (command.type !== CommandType.MUTATION) return;
                spacedUpdate.scheduleUpdate();
            });
        },
    });

    useEffect(() => {
        return () => {
            if (changeListener.current) {
                changeListener.current.dispose();
                changeListener.current = null;
            }
        };
    }, []);
}
