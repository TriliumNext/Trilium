import "./Spreadsheet.css";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import "@univerjs/preset-sheets-sort/lib/index.css";
import "@univerjs/preset-sheets-conditional-formatting/lib/index.css";
import "@univerjs/preset-sheets-find-replace/lib/index.css";
import "@univerjs/preset-sheets-note/lib/index.css";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "@univerjs/preset-sheets-hyper-link/lib/index.css";
import "@univerjs/preset-sheets-data-validation/lib/index.css";

import { DEFAULT_STYLES, type Plugin, type PluginCtor } from '@univerjs/core';
import { UniverSheetsConditionalFormattingMobileUIPlugin, UniverSheetsConditionalFormattingPreset, UniverSheetsConditionalFormattingUIPlugin } from '@univerjs/preset-sheets-conditional-formatting';
import { UniverMobileUIPlugin, UniverSheetsCorePreset, UniverSheetsMobileUIPlugin, UniverSheetsUIPlugin, UniverUIPlugin } from '@univerjs/preset-sheets-core';
import { UniverSheetsDataValidationMobileUIPlugin, UniverSheetsDataValidationPreset, UniverSheetsDataValidationUIPlugin } from '@univerjs/preset-sheets-data-validation';
import { UniverSheetsDrawingPreset } from '@univerjs/preset-sheets-drawing';
import { UniverSheetsFilterMobileUIPlugin, UniverSheetsFilterPreset, UniverSheetsFilterUIPlugin } from '@univerjs/preset-sheets-filter';
import { UniverSheetsFindReplacePreset } from '@univerjs/preset-sheets-find-replace';
import { UniverSheetsHyperLinkPreset } from '@univerjs/preset-sheets-hyper-link';
import { UniverSheetsNotePreset } from '@univerjs/preset-sheets-note';
import { UniverSheetsSortPreset } from '@univerjs/preset-sheets-sort';
import { createUniver, FUniver, mergeLocales } from '@univerjs/presets';
import { CalculationMode } from '@univerjs/sheets-formula';
import { IDialogService, IShortcutService, ISidebarService } from '@univerjs/ui';
import { MutableRef, useEffect, useRef, useState } from "preact/hooks";

import type NoteContext from "../../../components/note_context";
import { t } from "../../../services/i18n";
import { isMobile } from "../../../services/utils";
import { useColorScheme, useEffectiveReadOnly, useTriliumEvent, useTriliumEvents } from "../../react/hooks";
import { TypeWidgetProps } from "../type_widget";
import useSpreadsheetExport from "./export";
import { loadUniverLocale, UniverLocale } from "./locales";
import useClampEdgeNavigation from "./navigation";
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
    const locale = useUniverLocale();

    // Wait for the locale bundle before mounting the editor so Univer can be created synchronously
    // with the right language (the dependent hooks below rely on the API being ready immediately).
    if (!locale) {
        return <div className="spreadsheet" />;
    }

    // Use readOnly as key to force full remount (and data reload) when it changes.
    return <SpreadsheetEditor key={String(readOnly)} {...props} readOnly={readOnly} locale={locale} />;
}

/** Loads the Univer locale matching Trilium's UI language once, on mount. */
function useUniverLocale() {
    const [locale, setLocale] = useState<UniverLocale>();
    useEffect(() => {
        let cancelled = false;
        void loadUniverLocale().then((loaded) => {
            if (!cancelled) setLocale(loaded);
        });
        return () => {
            cancelled = true;
        };
    }, []);
    return locale;
}

function SpreadsheetEditor({ note, noteContext, readOnly, locale }: TypeWidgetProps & { readOnly: boolean; locale: UniverLocale }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<FUniver>();

    useInitializeSpreadsheet(containerRef, apiRef, readOnly, locale);
    useReleaseFillShortcuts(apiRef);
    useClampEdgeNavigation(apiRef);
    useDarkMode(apiRef);
    usePersistence(note, noteContext, apiRef, containerRef);
    useSpreadsheetExport(apiRef, note, noteContext);
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

// Univer binds Ctrl+R to fill-right and Ctrl+D to fill-down, which shadow the
// browser/Electron refresh (Ctrl+R) and bookmark (Ctrl+D) shortcuts.
const FILL_SHORTCUT_COMMAND_IDS = new Set([
    "sheet.command.copy-right", // Ctrl+R
    "sheet.command.copy-down"   // Ctrl+D
]);

interface ShortcutItemLike { id: string; }
interface ShortcutServiceLike {
    getAllShortcuts(): ShortcutItemLike[];
    registerShortcut(shortcut: ShortcutItemLike): { dispose(): void };
}

/**
 * Unregister Univer's fill-right (Ctrl+R) and fill-down (Ctrl+D) keyboard bindings so
 * the keystrokes fall through to the browser instead of silently copying the active
 * cell into its neighbour when a user presses Ctrl+R expecting a reload. The commands
 * remain available via the toolbar/context menu and the fill handle.
 */
function useReleaseFillShortcuts(apiRef: MutableRef<FUniver | undefined>) {
    useEffect(() => {
        const univerAPI = apiRef.current;
        if (!univerAPI) return;

        const releaseShortcuts = () => {
            try {
                const injector = (univerAPI as unknown as { _injector: { get(id: unknown): ShortcutServiceLike } })._injector;
                const shortcutService = injector.get(IShortcutService);
                for (const shortcut of shortcutService.getAllShortcuts()) {
                    if (FILL_SHORTCUT_COMMAND_IDS.has(shortcut.id)) {
                        // getAllShortcuts() hands back the exact item objects the service stores
                        // in its internal Sets, keyed by identity. registerShortcut(item) re-adds
                        // that same object (a Set no-op) and returns a disposer that deletes it —
                        // so disposing immediately removes the original binding, not a duplicate.
                        shortcutService.registerShortcut(shortcut).dispose();
                    }
                }
                // Guard the undocumented mechanic above against future Univer changes: if any
                // fill binding survived, the keystrokes are still captured and our refresh/bookmark
                // fix is silently broken.
                const stillBound = shortcutService.getAllShortcuts().some(s => FILL_SHORTCUT_COMMAND_IDS.has(s.id));
                if (stillBound) {
                    console.warn("Spreadsheet fill shortcuts could not be released; Ctrl+R/Ctrl+D may be captured.");
                }
            } catch (e) {
                console.error("Failed to release spreadsheet fill shortcuts", e);
            }
        };

        // Shortcuts are registered during plugin init. The Rendered stage may already have
        // been reached synchronously while the Univer instance was created (in which case the
        // event below never fires again), so release immediately and keep the listener as a
        // fallback for the asynchronous case.
        releaseShortcuts();
        const disposable = univerAPI.addEvent(univerAPI.Event.LifeCycleChanged, ({ stage }) => {
            if (stage === univerAPI.Enum.LifecycleStages.Rendered) {
                releaseShortcuts();
            }
        });
        return () => disposable.dispose();
    }, [ apiRef ]);
}

function useInitializeSpreadsheet(containerRef: MutableRef<HTMLDivElement | null>, apiRef: MutableRef<FUniver | undefined>, readOnly: boolean, locale: UniverLocale) {
    useEffect(() => {
        if (!containerRef.current) return;

        // Override Univer's hardcoded default font to match Trilium's UI font.
        const ff = getComputedStyle(document.body).getPropertyValue("--detail-font-family").trim();
        if (ff) {
            DEFAULT_STYLES.ff = ff;
        }

        const presets = [
                UniverSheetsCorePreset({
                    container: containerRef.current,
                    toolbar: !readOnly,
                    contextMenu: !readOnly,
                    formulaBar: !readOnly,
                    footer: readOnly ? false : undefined,
                    // Skip the formula recalculation Univer runs on workbook load. Our
                    // content is always Univer-saved (formulas already carry cached
                    // results), so the default WHEN_EMPTY mode only re-runs formulas that
                    // evaluate to 0/"" and writes identical results back — which the change
                    // listener persists as a spurious save on every open. NO_CALCULATION
                    // avoids that; edit-driven recalculation is unaffected.
                    formula: { initialFormulaComputing: CalculationMode.NO_CALCULATION },
                    menu: {
                        "sheet.contextMenu.permission": { hidden: true },
                        "sheet-permission.operation.openPanel": { hidden: true },
                        "sheet.command.add-range-protection-from-toolbar": { hidden: true },
                        "sheet.command.set-range-font-family": { hidden: true },
                    },
                }),
                // Floating images stored inline as base64 in the workbook's SHEET_DRAWING_PLUGIN
                // resource (Univer's default ImageIoService), so they persist through the normal
                // content save path. The insert-image toolbar button is hidden in read-only mode
                // (toolbar is disabled above); the preset stays registered so existing images render.
                UniverSheetsDrawingPreset(),
                UniverSheetsFindReplacePreset(),
                UniverSheetsNotePreset(),
                UniverSheetsFilterPreset(),
                UniverSheetsSortPreset(),
                UniverSheetsDataValidationPreset(),
                UniverSheetsConditionalFormattingPreset(),
                UniverSheetsHyperLinkPreset()
            ];

        const { univerAPI } = createUniver({
            // Inherit the spreadsheet language (and locale-dependent defaults such as the currency
            // symbol) from Trilium's UI language instead of hardcoding US English.
            locale: locale.type,
            locales: {
                [locale.type]: mergeLocales(
                    locale.data,
                    readOnly ? buildReadOnlyLocaleOverrides() : {},
                ),
            },
            // Univer ships no "mobile preset" — the presets above register the desktop UI shells.
            // On Trilium's mobile layout, swap those shells for their touch-optimised variants
            // (see toMobilePresets); the remaining feature plugins are platform-agnostic.
            presets: isMobile() ? toMobilePresets(presets) : presets,
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
    }, [ apiRef, containerRef, readOnly, locale ]);
}

type PluginEntry = PluginCtor<Plugin> | [PluginCtor<Plugin>, ConstructorParameters<PluginCtor<Plugin>>[0]];
interface UniverPreset { plugins: PluginEntry[]; }

// Desktop UI shell plugins (registered by the presets) mapped to their touch-optimised
// counterparts. Only these five Univer plugins ship a mobile variant; every other plugin
// the presets register is platform-agnostic and is left untouched.
const DESKTOP_TO_MOBILE_UI = new Map<PluginCtor<Plugin>, PluginCtor<Plugin>>([
    [UniverUIPlugin, UniverMobileUIPlugin],
    [UniverSheetsUIPlugin, UniverSheetsMobileUIPlugin],
    [UniverSheetsConditionalFormattingUIPlugin, UniverSheetsConditionalFormattingMobileUIPlugin],
    [UniverSheetsDataValidationUIPlugin, UniverSheetsDataValidationMobileUIPlugin],
    [UniverSheetsFilterUIPlugin, UniverSheetsFilterMobileUIPlugin],
]);

/**
 * Rewrite a list of Univer presets so their desktop UI shells are replaced by the mobile
 * equivalents, preserving each plugin's configuration. A preset is just a `{ plugins }` data
 * object whose entries are either a plugin constructor or a `[constructor, options]` tuple, so
 * we can swap the constructor in place without re-running the preset factories.
 */
function toMobilePresets(presets: UniverPreset[]): UniverPreset[] {
    return presets.map((preset) => ({
        ...preset,
        plugins: preset.plugins.map((entry) => {
            const [ctor, options] = Array.isArray(entry) ? entry : [entry, undefined];
            const mobileCtor = DESKTOP_TO_MOBILE_UI.get(ctor);
            if (!mobileCtor) return entry;
            return options === undefined ? mobileCtor : [mobileCtor, options];
        }),
    }));
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
