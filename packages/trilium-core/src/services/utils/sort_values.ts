/**
 * Orders two sort values the way a search's `orderBy` and the tree sort both do: a value one note
 * lacks counts as the largest, and two missing values tie so the next level decides. Each caller
 * passes how its own present values compare.
 */

/** Compares two values that are both present. */
export type ValueComparator<T extends string | number> = (a: T, b: T) => number;

/** Returns a negative number when `a` sorts first ascending, positive when `b` does, 0 on a tie. */
export function compareSortValues<T extends string | number>(
    a: T | null | undefined,
    b: T | null | undefined,
    compareValues: ValueComparator<T>
) {
    const valA = a ?? null;
    const valB = b ?? null;

    if (valA === null && valB === null) {
        return 0;
    }
    if (valB === null) {
        return -1;
    }
    if (valA === null) {
        return 1;
    }

    return compareValues(valA, valB);
}
