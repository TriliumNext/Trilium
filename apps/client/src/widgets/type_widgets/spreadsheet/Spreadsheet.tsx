import "./Spreadsheet.css";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-sort/lib/index.css";
import "@univerjs/preset-sheets-conditional-formatting/lib/index.css";
import "@univerjs/preset-sheets-find-replace/lib/index.css";
import "@univerjs/preset-sheets-note/lib/index.css";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "@univerjs/preset-sheets-hyper-link/lib/index.css";
import "@univerjs/preset-sheets-data-validation/lib/index.css";

import { DEFAULT_STYLES } from '@univerjs/core';
import { UniverSheetsConditionalFormattingPreset } from '@univerjs/preset-sheets-conditional-formatting';
import UniverPresetSheetsConditionalFormattingEnUS from '@univerjs/preset-sheets-conditional-formatting/locales/en-US';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import sheetsCoreEnUS  from '@univerjs/preset-sheets-core/locales/en-US';
import { UniverSheetsDataValidationPreset } from '@univerjs/preset-sheets-data-validation';
import UniverPresetSheetsDataValidationEnUS from '@univerjs/preset-sheets-data-validation/locales/en-US';
import { UniverSheetsFilterPreset } from '@univerjs/preset-sheets-filter';
import UniverPresetSheetsFilterEnUS from '@univerjs/preset-sheets-filter/locales/en-US';
import { UniverSheetsFindReplacePreset } from '@univerjs/preset-sheets-find-replace';
import sheetsFindReplaceEnUS from '@univerjs/preset-sheets-find-replace/locales/en-US';
import { UniverSheetsHyperLinkPreset } from '@univerjs/preset-sheets-hyper-link';
import UniverPresetSheetsHyperLinkEnUS from '@univerjs/preset-sheets-hyper-link/locales/en-US';
import { UniverSheetsNotePreset } from '@univerjs/preset-sheets-note';
import sheetsNoteEnUS from '@univerjs/preset-sheets-note/locales/en-US';
import { UniverSheetsSortPreset } from '@univerjs/preset-sheets-sort';
import UniverPresetSheetsSortEnUS from '@univerjs/preset-sheets-sort/locales/en-US';
import { createUniver, FUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { IDialogService, ISidebarService } from '@univerjs/ui';
import { MutableRef, useEffect, useRef } from "preact/hooks";

import type NoteContext from "../../../components/note_context";
import { t } from "../../../services/i18n";
import { useColorScheme, useEffectiveReadOnly, useTriliumEvent, useTriliumEvents } from "../../react/hooks";
import { TypeWidgetProps } from "../type_widget";
import usePersistence from "./persistence";

function buildReadOnlyLocaleOverrides() {
    const msg = t("spreadsheet.read-only");
    return {
        permission: {
            dialog: {
                editErr: msg,
                commonErr: msg,
                pasteErr: msg,
                setStyleErr: msg,
                copyErr: msg,
                setRowColStyleErr: msg,
                moveRowColErr: msg,
                moveRangeErr: msg,
                autoFillErr: msg,
                filterErr: msg,
                operatorSheetErr: msg,
                formulaErr: msg,
                hyperLinkErr: msg,
                commentErr: msg,
            }
        }
    };
}

export default function Spreadsheet(props: TypeWidgetProps) {
    const readOnly = useEffectiveReadOnly(props.note, props.noteContext);

    // Use readOnly as key to force full remount (and data reload) when it changes.
    return <SpreadsheetEditor key={String(readOnly)} {...props} readOnly={readOnly} />;
}

function SpreadsheetEditor({ note, noteContext, readOnly }: TypeWidgetProps & { readOnly: boolean }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<FUniver>();

    useInitializeSpreadsheet(containerRef, apiRef, readOnly);
    useDarkMode(apiRef);
    usePersistence(note, noteContext, apiRef, containerRef);
    useSearchIntegration(apiRef, noteContext);
    useDismissDialogsOnNoteSwitch(apiRef);
    useFixRadixPortals();

    // Focus the spreadsheet when the note is focused.
    useTriliumEvent("focusOnDetail", () => {
        const focusable = containerRef.current?.querySelector('[data-u-comp="editor"]');
        if (focusable instanceof HTMLElement) {
            focusable.focus();
        }
    });

    return <div ref={containerRef} className="spreadsheet" />;
}

/**
 * Univer's design system uses Radix UI primitives whose DismissableLayer detects
 * "outside" clicks/focus via document-level pointerdown/focusin listeners combined
 * with a React capture-phase flag. In React, portal events bubble through the
 * component tree so onPointerDownCapture fires on the DismissableLayer, setting an
 * internal flag that suppresses the "outside" detection. With preact/compat, portal
 * events don't bubble through the React tree, so the flag never gets set and Radix
 * immediately dismisses popups.
 *
 * Radix dispatches cancelable custom events ("dismissableLayer.pointerDownOutside"
 * and "dismissableLayer.focusOutside") on the original event target before calling
 * onDismiss. The dismiss is skipped if defaultPrevented is true. This hook intercepts
 * those custom events in the capture phase and prevents default when the target is
 * inside a Radix portal, restoring the expected behavior.
 */
function useFixRadixPortals() {
    useEffect(() => {
        function preventDismiss(e: Event) {
            if (e.target instanceof HTMLElement && e.target.closest("[id^='radix-']")) {
                e.preventDefault();
            }
        }

        document.addEventListener("dismissableLayer.pointerDownOutside", preventDismiss, true);
        document.addEventListener("dismissableLayer.focusOutside", preventDismiss, true);
        return () => {
            document.removeEventListener("dismissableLayer.pointerDownOutside", preventDismiss, true);
            document.removeEventListener("dismissableLayer.focusOutside", preventDismiss, true);
        };
    }, []);
}

function useInitializeSpreadsheet(containerRef: MutableRef<HTMLDivElement | null>, apiRef: MutableRef<FUniver | undefined>, readOnly: boolean) {
    useEffect(() => {
        if (!containerRef.current) return;

        // Override Univer's hardcoded default font to match Trilium's UI font.
        const ff = getComputedStyle(document.body).getPropertyValue("--detail-font-family").trim();
        if (ff) {
            DEFAULT_STYLES.ff = ff;
        }

        const { univerAPI } = createUniver({
            locale: LocaleType.EN_US,
            locales: {
                [LocaleType.EN_US]: mergeLocales(
                    sheetsCoreEnUS,
                    sheetsFindReplaceEnUS,
                    sheetsNoteEnUS,
                    UniverPresetSheetsFilterEnUS,
                    UniverPresetSheetsSortEnUS,
                    UniverPresetSheetsDataValidationEnUS,
                    UniverPresetSheetsConditionalFormattingEnUS,
                    UniverPresetSheetsHyperLinkEnUS,
                    readOnly ? buildReadOnlyLocaleOverrides() : {},
                ),
            },
            presets: [
                UniverSheetsCorePreset({
                    container: containerRef.current,
                    toolbar: !readOnly,
                    contextMenu: !readOnly,
                    formulaBar: !readOnly,
                    footer: readOnly ? false : undefined,
                    menu: {
                        "sheet.contextMenu.permission": { hidden: true },
                        "sheet-permission.operation.openPanel": { hidden: true },
                        "sheet.command.add-range-protection-from-toolbar": { hidden: true },
                        "sheet.command.set-range-font-family": { hidden: true },
                    },
                }),
                UniverSheetsFindReplacePreset(),
                UniverSheetsNotePreset(),
                UniverSheetsFilterPreset(),
                UniverSheetsSortPreset(),
                UniverSheetsDataValidationPreset(),
                UniverSheetsConditionalFormattingPreset(),
                UniverSheetsHyperLinkPreset()
            ]
        });
        if (readOnly) {
            univerAPI.addEvent(univerAPI.Event.LifeCycleChanged, ({ stage }) => {
                if (stage === univerAPI.Enum.LifecycleStages.Rendered) {
                    const workbook = univerAPI.getActiveWorkbook();
                    if (!workbook) return;

                    workbook.disableSelection();
                    workbook.getWorkbookPermission().setReadOnly();
                }
            });
        }

        apiRef.current = univerAPI;
        return () => univerAPI.dispose();
    }, [ apiRef, containerRef, readOnly ]);
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

function useSearchIntegration(apiRef: MutableRef<FUniver | undefined>, noteContext: NoteContext | undefined) {
    useTriliumEvent("findInText", () => {
        if (!noteContext?.isActive()) return;

        const univerAPI = apiRef.current;
        if (!univerAPI) return;

        // Open find/replace panel and populate the search term.
        univerAPI.executeCommand("ui.operation.open-find-dialog");
    });
}

function useDismissDialogsOnNoteSwitch(apiRef: MutableRef<FUniver | undefined>) {
    useTriliumEvents(["beforeNoteSwitch", "noteTypeMimeChanged"], () => {
        const univerAPI = apiRef.current;
        if (!univerAPI) return;

        const injector = (univerAPI as unknown as { _injector: { get(id: unknown): { closeAll(): void; close(): void } } })._injector;
        injector.get(IDialogService).closeAll();
        injector.get(ISidebarService).close();
    });
}
