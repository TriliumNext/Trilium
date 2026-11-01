import { boardColumnsKey, isBoardColumnsKey } from "@triliumnext/commons";

import type { BoardColumnData, BoardViewData } from ".";

/** The columns stored for one grouping, or nothing where the board has none for it yet. */
export function readColumns(
    config: BoardViewData | undefined,
    groupBy: string
): BoardColumnData[] | undefined {
    return config?.[boardColumnsKey(groupBy)];
}

/** Stores the columns of one grouping, leaving every other grouping's list as it stands. */
export function writeColumns(
    config: BoardViewData | undefined,
    groupBy: string,
    columns: BoardColumnData[]
): BoardViewData {
    return { ...config, [boardColumnsKey(groupBy)]: columns };
}

/**
 * The config with a pre-switching `columns` list moved under the grouping it belongs to, or nothing
 * where there is none to move.
 *
 * Before the grouping could be switched every board wrote its columns to `columns`, whichever
 * attribute it grouped by. That list is the current grouping's, so it is moved there and `columns`
 * is cleared: left in place, it would be read as the default grouping's columns the moment the
 * board is switched to it. A board carrying any keyed list has been switched already, and its
 * `columns` means the default grouping alone.
 */
export function adoptLegacyColumns(
    config: BoardViewData | undefined,
    groupBy: string
): BoardViewData | undefined {
    const key = boardColumnsKey(groupBy);
    if (key === "columns" || !config?.columns?.length
            || Object.keys(config).some(isBoardColumnsKey)) {
        return undefined;
    }

    const adopted: BoardViewData = { ...config, [key]: config.columns };
    delete adopted.columns;
    return adopted;
}
