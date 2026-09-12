/**
 * Orders two sort values the way a search's `orderBy` and the tree sort both do: a missing value
 * counts as the largest, two missing or empty values tie so the next level decides, and values that
 * both read as dates or as numbers compare chronologically or numerically rather than as text.
 */

export type SortValue = string | number | null | undefined;

type StringComparator = (a: string, b: string) => number;

const compareStringsPlainly: StringComparator = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Returns a negative number when `a` sorts first ascending, positive when `b` does, 0 on a tie. */
export function compareSortValues(
    a: SortValue,
    b: SortValue,
    compareStrings = compareStringsPlainly
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
    if (typeof valA === "string" && typeof valB === "string") {
        if (isDate(valA) && isDate(valB)) {
            return compareNumbers(new Date(valA).getTime(), new Date(valB).getTime());
        }
        if (isNumber(valA) && isNumber(valB)) {
            return compareNumbers(parseFloat(valA), parseFloat(valB));
        }
        return valA === "" && valB === "" ? 0 : compareStrings(valA, valB);
    }
    if (typeof valA === "number" && typeof valB === "number") {
        return compareNumbers(valA, valB);
    }
    return valA < valB ? -1 : valA > valB ? 1 : 0;
}

function compareNumbers(a: number, b: number) {
    if (!a && !b) {
        return 0;
    }
    return a < b ? -1 : a > b ? 1 : 0;
}

export function isDate(date: number | string) {
    return !isNaN(new Date(date).getTime());
}

export function isNumber(x: number | string) {
    if (typeof x === "number") {
        return true;
    }
    // isNaN returns false for a blank string.
    return typeof x === "string" && x.trim() !== "" && !isNaN(parseInt(x, 10));
}
