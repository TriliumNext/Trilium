/** The label a board groups by when `#board:groupBy` does not name one. */
export const DEFAULT_BOARD_GROUP_BY = "status";

/** The key a board's column list is stored under in `board.json`. */
export type BoardColumnsKey = "columns" | `${string}ViewColumns`;

/**
 * The grouping value without the `#` a label may be written with. A relation keeps its `~`, so a
 * relation and a label of the same name are two different groupings.
 */
export function normalizeBoardGroupBy(groupBy: string | undefined | null): string {
    const trimmed = (groupBy ?? "").trim();
    return trimmed.startsWith("#") ? trimmed.substring(1).trim() : trimmed;
}

/**
 * Where `board.json` keeps the columns for one grouping.
 *
 * A board holds a column list per attribute it can group by, so switching the grouping cannot mix
 * two lists. The default grouping uses `columns`, which is where every board wrote its columns
 * before the grouping could be switched.
 */
export function boardColumnsKey(groupBy: string | undefined | null): BoardColumnsKey {
    const name = normalizeBoardGroupBy(groupBy);
    return !name || name === DEFAULT_BOARD_GROUP_BY ? "columns" : `${name}ViewColumns`;
}

/** Whether a `board.json` key holds the columns of a non-default grouping. */
export function isBoardColumnsKey(key: string): boolean {
    return key.endsWith("ViewColumns") && key.length > "ViewColumns".length;
}

/**
 * Which grouping a `board.json` key holds the columns of, or nothing where it holds none.
 *
 * The reverse of {@link boardColumnsKey}, for reading a board's stored columns without knowing
 * which grouping they belong to: a column reference names a column alone, and the board has to
 * find which of its groupings owns it.
 */
export function boardGroupByFromColumnsKey(key: string): string | undefined {
    if (key === "columns") {
        return DEFAULT_BOARD_GROUP_BY;
    }

    return isBoardColumnsKey(key) ? key.slice(0, -"ViewColumns".length) : undefined;
}
