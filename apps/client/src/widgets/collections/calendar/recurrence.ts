/**
 * The recurrence of an event as the editor understands it, translated to and from the RRULE string
 * the `#recurrence` label stores (see event_builder.ts, which hands that string to FullCalendar).
 *
 * The editor models the everyday rules — "every day", "every 2 weeks on Mon and Fri, 10 times" —
 * and steps aside for everything else: a rule using any RRULE feature beyond them (BYMONTHDAY,
 * BYSETPOS, nth-weekday BYDAY, EXDATE lines, …) parses as {@link CustomRecurrence}, shown and
 * edited as the raw string, so a hand-written rule is never silently rewritten into less than it
 * said.
 */

/** Weekday codes as RRULE spells them, Monday first as the calendar draws its weeks. */
export const WEEKDAY_CODES = [ "MO", "TU", "WE", "TH", "FR", "SA", "SU" ] as const;

export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

export const FREQUENCIES = [ "DAILY", "WEEKLY", "MONTHLY", "YEARLY" ] as const;

export type Frequency = (typeof FREQUENCIES)[number];

/** A rule the structured fields can say in full. */
export interface SimpleRecurrence {
    frequency: Frequency;
    /** Every how many days/weeks/months/years; `1` for every one. */
    interval: number;
    /** Weekly only: the days the event falls on. Empty, the day of the start date carries it. */
    weekdays: WeekdayCode[];
    ends: RecurrenceEnd;
}

/**
 * When the repetition stops. An `until` whose date has not been picked yet is the empty string:
 * the choice of ending is made before the date naming it, and until the date arrives the rule is
 * stored as never ending.
 */
export type RecurrenceEnd =
    | { type: "never" }
    | { type: "until"; date: string }
    | { type: "count"; count: number };

/** A rule beyond the structured fields, kept as the string the label holds. */
export interface CustomRecurrence {
    kind: "custom";
    value: string;
}

export type ParsedRecurrence =
    | { kind: "none" }
    | { kind: "simple"; rule: SimpleRecurrence }
    | CustomRecurrence;

/**
 * Reads the `#recurrence` label into what the editor can edit. Never throws: whatever cannot be
 * carried by the structured fields — including a string that is not an RRULE at all — comes back
 * as custom, leaving the raw field to show exactly what the note holds.
 */
export function parseRecurrence(value: string | null | undefined): ParsedRecurrence {
    const trimmed = value?.trim();
    if (!trimmed) {
        return { kind: "none" };
    }

    const rule = parseSimpleRule(trimmed);
    return rule ? { kind: "simple", rule } : { kind: "custom", value: trimmed };
}

/**
 * Writes the editor's state back to what the label should hold: an RRULE string, or `null` for a
 * value the label should not exist for — no repetition, or a custom field emptied out.
 */
export function serializeRecurrence(parsed: ParsedRecurrence): string | null {
    switch (parsed.kind) {
        case "none":
            return null;
        case "custom":
            return parsed.value.trim() || null;
        case "simple":
            return serializeSimpleRule(parsed.rule);
    }
}

/** The one RRULE line of a simple rule, spelling out only what differs from the defaults. */
function serializeSimpleRule({ frequency, interval, weekdays, ends }: SimpleRecurrence): string {
    const parts = [ `FREQ=${frequency}` ];

    if (interval > 1) {
        parts.push(`INTERVAL=${interval}`);
    }

    if (frequency === "WEEKLY" && weekdays.length > 0) {
        // In the week's own order, however the days were picked.
        const ordered = WEEKDAY_CODES.filter((code) => weekdays.includes(code));
        parts.push(`BYDAY=${ordered.join(",")}`);
    }

    if (ends.type === "until" && ends.date) {
        // The end of the picked day rather than its midnight, so "until June 5th" keeps June 5th:
        // the builder's DTSTART is written floating (see event_builder.ts), which the rrule library
        // reads as UTC, and a bare date would cut off before the day's own occurrence.
        parts.push(`UNTIL=${ends.date.replaceAll("-", "")}T235959Z`);
    } else if (ends.type === "count") {
        parts.push(`COUNT=${ends.count}`);
    }

    return `RRULE:${parts.join(";")}`;
}

/** What of an RRULE line the structured fields can hold, or `null` for anything they cannot. */
function parseSimpleRule(value: string): SimpleRecurrence | null {
    // More than one line is a rule set (EXDATE, RDATE, a second RRULE) — custom by definition.
    if (value.includes("\n") || !/^RRULE:/i.test(value)) {
        return null;
    }

    const params = new Map<string, string>();
    for (const part of value.substring("RRULE:".length).split(";")) {
        const eq = part.indexOf("=");
        if (eq <= 0) {
            return null;
        }

        const key = part.substring(0, eq).toUpperCase();
        // A key repeated is a rule saying two things at once; better shown raw than half-read.
        if (params.has(key)) {
            return null;
        }
        params.set(key, part.substring(eq + 1));
    }

    const frequency = FREQUENCIES.find((f) => f === params.get("FREQ")?.toUpperCase());
    if (!frequency) {
        return null;
    }
    params.delete("FREQ");

    const interval = params.has("INTERVAL") ? parsePositiveInt(params.get("INTERVAL")) : 1;
    if (interval === null) {
        return null;
    }
    params.delete("INTERVAL");

    let weekdays: WeekdayCode[] = [];
    if (params.has("BYDAY")) {
        // Plain weekday codes on a weekly rule only: on a monthly or yearly one — or carrying a
        // position like `2TU` — BYDAY means "the nth such day", which the fields cannot say.
        if (frequency !== "WEEKLY") {
            return null;
        }

        weekdays = [];
        for (const day of (params.get("BYDAY") ?? "").toUpperCase().split(",")) {
            const code = WEEKDAY_CODES.find((c) => c === day);
            if (!code) {
                return null;
            }
            weekdays.push(code);
        }
        params.delete("BYDAY");
    }

    let ends: RecurrenceEnd = { type: "never" };
    if (params.has("UNTIL") && params.has("COUNT")) {
        return null;
    } else if (params.has("UNTIL")) {
        // Only the day matters to the editor; the time — ours or anyone else's — is let go, and
        // written back as the end of that day (see serialization above).
        const match = (params.get("UNTIL") ?? "").match(/^(\d{4})(\d{2})(\d{2})(T\d{6}Z?)?$/);
        if (!match) {
            return null;
        }
        ends = { type: "until", date: `${match[1]}-${match[2]}-${match[3]}` };
        params.delete("UNTIL");
    } else if (params.has("COUNT")) {
        const count = parsePositiveInt(params.get("COUNT"));
        if (count === null) {
            return null;
        }
        ends = { type: "count", count };
        params.delete("COUNT");
    }

    // Whatever remains — WKST, BYMONTHDAY, BYSETPOS, anything — the fields cannot carry.
    if (params.size > 0) {
        return null;
    }

    return { frequency, interval, weekdays, ends };
}

function parsePositiveInt(value: string | undefined): number | null {
    if (!value || !/^\d+$/.test(value)) {
        return null;
    }

    const parsed = parseInt(value, 10);
    return parsed >= 1 ? parsed : null;
}
