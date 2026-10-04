import type { Injector, ITextStyle, ObjectMatrix } from "@univerjs/core";
import type { FUniver } from "@univerjs/presets";
import { type ICellDataWithSpanInfo, ISheetClipboardService } from "@univerjs/sheets-ui";
import { type MutableRef, useEffect } from "preact/hooks";

const STRIP_FONT_FAMILY_HOOK_ID = "trilium.strip-pasted-font-family";

/**
 * Drops the font family from cells pasted from outside Univer, since the font picker is hidden
 * and Excel and other sources put a `font-family` on every cell. A copy within Univer carries a
 * `copyId` and keeps its fonts, which an imported .xlsx file can set.
 *
 * `SheetClipboardService` sorts hooks by ascending `priority` and hands every hook the same
 * cell matrix, so this hook runs first and edits the matrix before the default paste hook
 * turns it into mutations.
 */
export default function useStripPastedFontFamily(apiRef: MutableRef<FUniver | undefined>) {
    useEffect(() => {
        const univerAPI = apiRef.current;
        if (!univerAPI) return;

        let hook: { dispose(): void } | undefined;
        const register = () => {
            if (hook) return;
            const injector = (univerAPI as unknown as { _injector: Injector })._injector;
            hook = injector.get(ISheetClipboardService).addClipboardHook({
                id: STRIP_FONT_FAMILY_HOOK_ID,
                priority: Number.MIN_SAFE_INTEGER,
                onPasteCells(_pasteFrom, _pasteTo, data, payload) {
                    if (!payload.copyId) {
                        stripPastedFontFamilies(data);
                    }
                    return { undos: [], redos: [] };
                }
            });
        };

        // `UniverSheetsUIPlugin` registers `ISheetClipboardService` once the first workbook
        // starts the lifecycle, which can happen before or after this effect runs.
        if (univerAPI.getCurrentLifecycleStage() >= univerAPI.Enum.LifecycleStages.Ready) {
            register();
        }
        const lifecycle = univerAPI.addEvent(univerAPI.Event.LifeCycleChanged, ({ stage }) => {
            if (stage >= univerAPI.Enum.LifecycleStages.Ready) {
                register();
            }
        });
        return () => {
            lifecycle.dispose();
            hook?.dispose();
        };
    }, [ apiRef ]);
}

export function stripPastedFontFamilies(matrix: ObjectMatrix<ICellDataWithSpanInfo>) {
    matrix.forValue((_row, _col, cell) => {
        if (cell.s && typeof cell.s === "object") {
            delete cell.s.ff;
        }
        deleteFontFamily(cell.p?.documentStyle?.textStyle);
        for (const run of cell.p?.body?.textRuns ?? []) {
            deleteFontFamily(run.ts);
        }
    });
}

function deleteFontFamily(style: ITextStyle | undefined) {
    if (style) {
        delete style.ff;
    }
}
