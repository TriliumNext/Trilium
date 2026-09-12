import { useMemo } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import { useNoteLabel, useNoteLabelBoolean } from "../../react/hooks";
import { parseSortKey } from "../sorting";
import type { ColumnSort } from "./data";

/** The labels the board keeps the order its columns take by default. */
export const SORT_LABEL = "sortColumns";
export const SORT_DESCENDING_LABEL = "sortColumnsDescending";

/**
 * Reads the order the board stores in its labels, absent when it stores no key.
 *
 * Memoised on the label values, so the columns that sort by it read one object rather than parsing
 * the labels each.
 */
export function useBoardSort(note: FNote): ColumnSort | undefined {
    const [ stored ] = useNoteLabel(note, SORT_LABEL);
    const [ isDescending ] = useNoteLabelBoolean(note, SORT_DESCENDING_LABEL);

    return useMemo(() => {
        const orderBy = parseSortKey(stored);
        return orderBy ? { orderBy, isDescending } : undefined;
    }, [ stored, isDescending ]);
}
