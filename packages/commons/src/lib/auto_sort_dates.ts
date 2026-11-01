/** Parses dates and times strictly, against Day.js-style formats and the locale's own patterns. */
export interface DateParser {
    /** Seconds since midnight, or `null` when `text` is not a time of day. */
    parseTime(text: string): number | null;
    /** Milliseconds since the epoch, or `null` when `text` is not a date. */
    parseDate(text: string): number | null;
}

/**
 * @param locale a BCP 47 tag for month, weekday and AM/PM names; English names always match.
 * @param extraFormats more date formats, in Day.js syntax. A format with unsupported tokens is
 * skipped.
 */
export function createDateParser(locale: string | undefined, extraFormats: string[]): DateParser {
    const data = getLocaleData(locale);
    const extraDateFormats = withTimes(tokenizeAll(extraFormats), data.timeTokens)
        .map((tokens) => compile(tokens, data));
    const dateFormats = [...data.dateFormats, ...extraDateFormats];

    return {
        parseTime: (text) => firstMatch(text, data.timeFormats, data, timeOfDay),
        parseDate: (text) => firstMatch(text, dateFormats, data, toEpoch)
    };
}

type NumericKind = "year" | "shortYear" | "month" | "day" | "hour" | "hour12" | "minute" | "second"
    | "millisecond";

type TokenKind = NumericKind | "monthName" | "weekday" | "meridiem" | "offset" | "optionalOffset"
    | "timeJoiner";

type Token = TokenKind | { literal: string };

interface FormatPart {
    kind?: TokenKind;
    regex: RegExp;
}

interface DateFields {
    year?: number;
    month?: number;
    day?: number;
    hour?: number;
    hour12?: number;
    isPm?: boolean;
    minute?: number;
    second?: number;
    millisecond?: number;
    offset?: number;
}

interface LocaleNames {
    months: Map<string, number>;
    monthPattern: string;
    weekdayPattern: string;
    meridiems: Map<string, boolean>;
    meridiemPattern: string;
}

interface LocaleData extends LocaleNames {
    timeTokens: Token[][];
    timeFormats: FormatPart[][];
    dateFormats: FormatPart[][];
}

const TIME_FORMATS = ["H:mm", "H:mm:ss", "H:mm:ss.SSS", "h:mm A", "h:mm:ss A", "h:mmA", "h:mm:ssA"];

const DATE_FORMATS = [
    "YYYY-MM-DD",
    "D.M.YYYY",
    "D MMMM YYYY",
    "dddd, D MMMM YYYY",
    "MMMM D, YYYY",
    "dddd, MMMM D, YYYY"
];

const INTL_DATE_OPTIONS: Intl.DateTimeFormatOptions[] = [
    { year: "numeric", month: "numeric", day: "numeric" },
    { dateStyle: "medium" },
    { dateStyle: "long" },
    { dateStyle: "full" }
];

const TOKEN_KINDS: Record<string, TokenKind> = {
    YYYY: "year",
    YY: "shortYear",
    MMMM: "monthName",
    MMM: "monthName",
    MM: "month",
    M: "month",
    DD: "day",
    D: "day",
    dddd: "weekday",
    ddd: "weekday",
    dd: "weekday",
    HH: "hour",
    H: "hour",
    hh: "hour12",
    h: "hour12",
    mm: "minute",
    m: "minute",
    ss: "second",
    s: "second",
    SSS: "millisecond",
    A: "meridiem",
    a: "meridiem",
    ZZ: "offset",
    Z: "offset"
};

// Alternatives are tried in order, so longer tokens are listed before their prefixes.
const TOKEN_REGEX = new RegExp(
    `\\[([^\\]]*)\\]|(${Object.keys(TOKEN_KINDS).join("|")})|([A-Za-z]+)|([^A-Za-z])`, "g");

const NUMBER_PATTERNS: Record<NumericKind, string> = {
    year: "\\d{4}",
    shortYear: "\\d{2}",
    month: "\\d{1,2}",
    day: "\\d{1,2}",
    hour: "\\d{1,2}",
    hour12: "\\d{1,2}",
    minute: "\\d{2}",
    second: "\\d{2}",
    millisecond: "\\d{3}"
};

const OFFSET_PATTERN = "\\s*(?:Z|[+-]\\d{2}(?::?\\d{2})?)";
const TIME_JOINER_PATTERN = "T|,?\\s+";
const SAMPLE_DATE = Date.UTC(2026, 8, 30);

const localeCache = new Map<string, LocaleData>();

function getLocaleData(locale: string | undefined): LocaleData {
    const cacheKey = locale ?? "";
    const cached = localeCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const names = buildNames(locale);
    const timeTokens = tokenizeAll(TIME_FORMATS);
    const dateTokens = [...tokenizeAll(DATE_FORMATS), ...intlDateTokens(locale)];
    const data: LocaleData = {
        ...names,
        timeTokens,
        timeFormats: timeTokens.map((tokens) => compile(tokens, names)),
        dateFormats: withTimes(dateTokens, timeTokens).map((tokens) => compile(tokens, names))
    };
    localeCache.set(cacheKey, data);
    return data;
}

function firstMatch(
    text: string,
    formats: FormatPart[][],
    names: LocaleNames,
    read: (fields: DateFields) => number | null
): number | null {
    for (const format of formats) {
        const fields = matchFormat(text, format, names);
        const value = fields ? read(fields) : null;
        if (value !== null) {
            return value;
        }
    }
    return null;
}

/** Each date format alone, then followed by each time format and an optional UTC offset. */
function withTimes(dateTokens: Token[][], timeTokens: Token[][]): Token[][] {
    const formats = [...dateTokens];
    for (const date of dateTokens) {
        for (const time of timeTokens) {
            formats.push([...date, "timeJoiner", ...time, "optionalOffset"]);
        }
    }
    return formats;
}

function tokenizeAll(formats: string[]): Token[][] {
    return formats.map(tokenize).filter((tokens) => tokens !== null);
}

/** Splits a Day.js format into tokens, or returns `null` when it uses an unsupported token. */
function tokenize(format: string): Token[] | null {
    const tokens: Token[] = [];
    for (const [, escaped, known, unsupported, character] of format.matchAll(TOKEN_REGEX)) {
        if (unsupported) {
            return null;
        }
        if (known) {
            tokens.push(TOKEN_KINDS[known]);
            continue;
        }

        const literal = escaped ?? character;
        const last = tokens.at(-1);
        if (typeof last === "object") {
            last.literal += literal;
        } else {
            tokens.push({ literal });
        }
    }
    return tokens.length > 0 ? tokens : null;
}

/** The locale's numeric and written date patterns, read from `Intl`. */
function intlDateTokens(locale: string | undefined): Token[][] {
    const formats: Token[][] = [];
    for (const options of INTL_DATE_OPTIONS) {
        const formatter = new Intl.DateTimeFormat(locale, {
            ...options,
            calendar: "gregory",
            numberingSystem: "latn",
            timeZone: "UTC"
        });
        const tokens = formatter.formatToParts(SAMPLE_DATE).map(intlPartToken);
        if (tokens.every((token) => token !== null)) {
            formats.push(tokens);
        }
    }
    return formats;
}

function intlPartToken({ type, value }: Intl.DateTimeFormatPart): Token | null {
    switch (type) {
        case "year": return "year";
        case "month": return /^\d+$/.test(value) ? "month" : "monthName";
        case "day": return "day";
        case "weekday": return "weekday";
        // Typed text has no right-to-left marks, which Arabic dates contain.
        case "literal": return { literal: value.replace(/[‎‏؜]/g, "") };
        default: return null;
    }
}

function compile(tokens: Token[], names: LocaleNames): FormatPart[] {
    return tokens.map((token) => typeof token === "string"
        ? { kind: token, regex: sticky(tokenPattern(token, names)) }
        : { regex: sticky(literalPattern(token.literal)) });
}

function tokenPattern(kind: TokenKind, names: LocaleNames): string {
    switch (kind) {
        case "monthName": return names.monthPattern;
        case "weekday": return names.weekdayPattern;
        case "meridiem": return names.meridiemPattern;
        case "offset": return OFFSET_PATTERN;
        case "optionalOffset": return `(?:${OFFSET_PATTERN})?`;
        case "timeJoiner": return TIME_JOINER_PATTERN;
        default: return NUMBER_PATTERNS[kind];
    }
}

function literalPattern(literal: string): string {
    return literal
        .split(/(\s+)/)
        .map((piece) => /^\s+$/.test(piece) ? "\\s+" : escapeRegExp(piece))
        .join("");
}

function sticky(pattern: string) {
    return new RegExp(`(?:${pattern})`, "iuy");
}

/** Reads the fields of `text` when the whole of it matches `format`. */
function matchFormat(text: string, format: FormatPart[], names: LocaleNames): DateFields | null {
    const fields: DateFields = {};
    let position = 0;
    for (const part of format) {
        part.regex.lastIndex = position;
        const match = part.regex.exec(text);
        if (!match) {
            return null;
        }
        if (part.kind) {
            readField(part.kind, match[0], fields, names);
        }
        position = part.regex.lastIndex;
    }
    return position === text.length ? fields : null;
}

function readField(kind: TokenKind, value: string, fields: DateFields, names: LocaleNames) {
    switch (kind) {
        case "shortYear": {
            const year = Number(value);
            fields.year = year > 68 ? 1900 + year : 2000 + year;
            break;
        }
        case "monthName":
            fields.month = names.months.get(nameKey(value));
            break;
        case "meridiem":
            fields.isPm = names.meridiems.get(nameKey(value));
            break;
        case "offset":
        case "optionalOffset":
            if (value) {
                fields.offset = parseOffset(value.trim());
            }
            break;
        case "weekday":
        case "timeJoiner":
            break;
        default:
            fields[kind] = Number(value);
    }
}

/** Minutes east of UTC, from `Z`, `+03`, `+0300` or `+03:00`. */
function parseOffset(value: string): number {
    if (value.toUpperCase() === "Z") {
        return 0;
    }
    const digits = value.slice(1).replace(":", "");
    const minutes = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2) || 0);
    return value.startsWith("-") ? -minutes : minutes;
}

function timeOfDay(fields: DateFields): number | null {
    let hour = fields.hour ?? 0;
    if (fields.hour12 !== undefined) {
        if (fields.hour12 < 1 || fields.hour12 > 12) {
            return null;
        }
        hour = fields.isPm === undefined
            ? fields.hour12
            : (fields.hour12 % 12) + (fields.isPm ? 12 : 0);
    }

    const minute = fields.minute ?? 0;
    const second = fields.second ?? 0;
    if (hour > 23 || minute > 59 || second > 59) {
        return null;
    }
    return hour * 3600 + minute * 60 + second + (fields.millisecond ?? 0) / 1000;
}

/** A date without an offset is read as UTC, so the result does not depend on the machine. */
function toEpoch(fields: DateFields): number | null {
    const { year, month, day } = fields;
    if (year === undefined || month === undefined || day === undefined) {
        return null;
    }

    const seconds = timeOfDay(fields);
    // `setUTCFullYear` keeps years 0 to 99 as written, unlike `Date.UTC`.
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    if (seconds === null || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return null;
    }
    return date.getTime() + seconds * 1000 - (fields.offset ?? 0) * 60_000;
}

function buildNames(locale: string | undefined): LocaleNames {
    const months = new Map<string, number>();
    const weekdays = new Map<string, number>();
    const meridiems = new Map<string, boolean>([["am", false], ["pm", true]]);

    for (const current of [locale, "en"]) {
        for (const style of ["long", "short"] as const) {
            const standalone = new Intl.DateTimeFormat(current, { month: style, timeZone: "UTC" });
            // Some languages decline the month name inside a date ("30 сентября").
            const inDate = new Intl.DateTimeFormat(current,
                { day: "numeric", month: style, timeZone: "UTC" });
            for (let month = 0; month < 12; month++) {
                const date = Date.UTC(2000, month, 15);
                addName(months, standalone.format(date), month + 1);
                for (const name of partValues(inDate, date, "month")) {
                    addName(months, name, month + 1);
                }
            }

            const weekday = new Intl.DateTimeFormat(current, { weekday: style, timeZone: "UTC" });
            for (let day = 0; day < 7; day++) {
                addName(weekdays, weekday.format(Date.UTC(2000, 0, 2 + day)), day);
            }
        }

        const hours = new Intl.DateTimeFormat(current,
            { hour: "numeric", hourCycle: "h12", timeZone: "UTC" });
        for (const [hour, isPm] of [[1, false], [13, true]] as const) {
            for (const name of partValues(hours, Date.UTC(2000, 0, 1, hour), "dayPeriod")) {
                addName(meridiems, name, isPm);
            }
        }
    }

    return {
        months,
        monthPattern: namesPattern(months),
        weekdayPattern: namesPattern(weekdays),
        meridiems,
        meridiemPattern: namesPattern(meridiems)
    };
}

function partValues(
    formatter: Intl.DateTimeFormat,
    date: number,
    type: Intl.DateTimeFormatPartTypes
) {
    return formatter.formatToParts(date)
        .filter((part) => part.type === type)
        .map((part) => part.value);
}

/** Names match ignoring case, spaces and dots: "Sept." matches "sept", "a. m." matches "AM". */
function nameKey(name: string) {
    return name.toLowerCase().replace(/[\s.]/g, "");
}

function addName<T>(names: Map<string, T>, name: string, value: T) {
    const key = nameKey(name);
    if (!names.has(key)) {
        names.set(key, value);
    }
}

function namesPattern(names: Map<string, unknown>): string {
    return [...names.keys()]
        .sort((a, b) => b.length - a.length)
        .map((key) => `${[...key].map(escapeRegExp).join("[\\s.]*")}\\.?`)
        .join("|");
}

function escapeRegExp(text: string) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
