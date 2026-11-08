import { createDateParser } from "./auto_sort_dates.js";
import { normalizeLocale } from "./i18n.js";

export type AutoSortKind = "time" | "date" | "number" | "text" | "empty";

export interface AutoSortOptions {
    /** A Trilium locale id or a BCP 47 tag. Defaults to the runtime's locale. */
    locale?: string;
    isDescending?: boolean;
    /** More date formats to recognize, in Day.js syntax. */
    dateFormats?: string[];
}

export interface AutoSortValue {
    kind: AutoSortKind;
    /** Seconds since midnight, milliseconds since the epoch, or the number; `0` otherwise. */
    key: number;
    /** The trimmed text. */
    text: string;
}

/**
 * Sorts strings whose type is not known in advance, such as table cells or lines. Each value is
 * detected as a time, a date, a number, text or empty. Ascending order is times, dates, numbers,
 * then text; descending order reverses it. Empty values are always last. Text ignores case, and
 * equal values keep their order. Typed data, such as attributes, has its own comparators instead.
 */
export function autoSort<T>(
    items: readonly T[],
    textOf: (item: T) => string,
    options: AutoSortOptions = {}
): T[] {
    const locale = resolveLocale(options.locale);
    const classify = createClassifier(locale, options.dateFormats ?? []);
    // Case-insensitive but accent-sensitive, as spreadsheets sort by default.
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "accent" });
    const direction = options.isDescending ? -1 : 1;

    return items
        .map((item) => ({ item, value: classify(textOf(item)) }))
        .sort((a, b) => compareValues(a.value, b.value, collator, direction))
        .map(({ item }) => item);
}

/** Detects the kind and the sort key of a single value. */
export function classifyAutoSortValue(text: string, options: AutoSortOptions = {}): AutoSortValue {
    return createClassifier(resolveLocale(options.locale), options.dateFormats ?? [])(text);
}

const KIND_RANKS: Record<AutoSortKind, number> = { time: 0, date: 1, number: 2, text: 3, empty: 4 };

// A sign and a currency symbol in either order, then digits with grouping and decimal marks. A
// space or an apostrophe is a separator only before exactly three digits.
const NUMBER_START =
    /^([-+−]?)(?:\p{Sc}\s*)?([-+−]?)(\d+(?:(?:[.,]|[\s'’](?=\d{3}(?!\d)))\d+)*)/u;

function resolveLocale(locale: string | undefined): string | undefined {
    if (!locale) {
        return undefined;
    }

    const tag = normalizeLocale(locale);
    for (const candidate of [tag, tag.split("-")[0]]) {
        try {
            return Intl.getCanonicalLocales(candidate)[0];
        } catch {
            // An invalid tag, such as `en-rtl`, falls back to its language.
        }
    }
    return undefined;
}

function createClassifier(locale: string | undefined, dateFormats: string[]) {
    const dates = createDateParser(locale, dateFormats);
    const decimalMark = getDecimalMark(locale);

    return (rawText: string): AutoSortValue => {
        const text = rawText.trim();
        if (!text) {
            return { kind: "empty", key: 0, text };
        }

        const time = dates.parseTime(text);
        if (time !== null) {
            return { kind: "time", key: time, text };
        }

        const date = dates.parseDate(text);
        if (date !== null) {
            return { kind: "date", key: date, text };
        }

        const number = parseNumber(text, decimalMark);
        if (number !== null) {
            return { kind: "number", key: number, text };
        }

        return { kind: "text", key: 0, text };
    };
}

function compareValues(
    a: AutoSortValue,
    b: AutoSortValue,
    collator: Intl.Collator,
    direction: number
) {
    const isEmptyA = a.kind === "empty";
    const isEmptyB = b.kind === "empty";
    if (isEmptyA || isEmptyB) {
        return Number(isEmptyA) - Number(isEmptyB);
    }

    // `||` also skips a `NaN` from two infinite keys.
    const order = KIND_RANKS[a.kind] - KIND_RANKS[b.kind]
        || a.key - b.key
        || collator.compare(a.text, b.text);
    return order * direction;
}

function getDecimalMark(locale: string | undefined): string {
    const parts = new Intl.NumberFormat(locale).formatToParts(1.5);
    return parts.some((part) => part.type === "decimal" && part.value === ",") ? "," : ".";
}

/** Reads the number `text` starts with, or returns `null` when it does not start with one. */
function parseNumber(text: string, decimalMark: string): number | null {
    const match = NUMBER_START.exec(text);
    if (!match) {
        return null;
    }

    const [, signBefore, signAfter, digits] = match;
    const value = parseDigits(digits, decimalMark);
    if (value === null || (signBefore && signAfter)) {
        return null;
    }

    const sign = signBefore || signAfter;
    return sign === "-" || sign === "−" ? -value : value;
}

/**
 * Reads digits with grouping and decimal marks. When both `.` and `,` appear, the last one is the
 * decimal mark. A single mark followed by other than three digits is a decimal mark. A single mark
 * followed by three digits follows the locale. Returns `null` for malformed runs such as `1.2.3`.
 */
function parseDigits(run: string, decimalMark: string): number | null {
    const groups = run.split(/\D/);
    const marks: string[] = run.match(/\D/g) ?? [];
    const last = marks.length - 1;
    const lastMark = marks[last];

    let decimalAt = -1;
    if (lastMark === "." || lastMark === ",") {
        const isUnique = marks.indexOf(lastMark) === last;
        const hasOtherMark = marks.includes(lastMark === "." ? "," : ".");
        if (hasOtherMark && !isUnique) {
            return null;
        }
        const isDecimalByDigits = groups[last + 1].length !== 3 || lastMark === decimalMark;
        if (hasOtherMark || (isUnique && isDecimalByDigits)) {
            decimalAt = last;
        }
    }

    for (const [index, group] of groups.slice(1).entries()) {
        if (index !== decimalAt && group.length !== 3) {
            return null;
        }
    }

    const integer = groups.slice(0, decimalAt === -1 ? undefined : decimalAt + 1).join("");
    const fraction = decimalAt === -1 ? "0" : groups[decimalAt + 1];
    return Number(`${integer}.${fraction}`);
}
