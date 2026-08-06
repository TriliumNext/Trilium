import "./RecurrenceEditor.css";

import clsx from "clsx";
import { useCallback, useEffect, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import LabelValueInput from "../../attribute_widgets/label_value_input";
import Dropdown from "../../react/Dropdown";
import FormSelect from "../../react/FormSelect";
import FormTextBox, { FormTextBoxWithUnit } from "../../react/FormTextBox";
import { useUniqueName } from "../../react/hooks";
import SegmentedChoice from "../../react/SegmentedChoice";
import { EventField, EventFieldControls, EventFieldList } from "./EventField";
import { useEventLabel } from "./hooks";
import {
    FREQUENCIES,
    Frequency,
    ParsedRecurrence,
    parseRecurrence,
    RecurrenceEnd,
    serializeRecurrence,
    SimpleRecurrence,
    WEEKDAY_CODES,
    WeekdayCode
} from "./recurrence";

/**
 * Edits how the event repeats, through the note's `#recurrence` label — or whatever label a
 * `#calendar:recurrence` renaming points at instead (see useEventLabel) — structured fields for
 * the everyday rules, the raw RRULE string for one saying more than they can (see recurrence.ts
 * for where that line runs). Rendered as {@link EventField} rows, so it stands in the event
 * popover's field column beside the start and end dates when those grow editors of their own.
 */
export default function RecurrenceEditor({ note }: { note: FNote }) {
    const [ storedValue, setStoredValue ] = useEventLabel(note, "recurrence");
    const [ model, setModel ] = useState<ParsedRecurrence>(() => parseRecurrence(storedValue));

    // Follows the label wherever it changes from — another client, the attribute editor, an undo —
    // but not where the label already says what the fields say: that is the editor's own write
    // echoing back, and re-parsing it would flatten a state the string spells more loosely than the
    // fields hold it — an "until" whose date is still being picked is stored as never ending (see
    // recurrence.ts), and must not snap back to "never" under the user mid-pick.
    useEffect(() => {
        setModel((current) =>
            serializeRecurrence(current) === (storedValue?.trim() || null)
                ? current
                : parseRecurrence(storedValue));
    }, [ storedValue ]);

    const commit = useCallback((next: ParsedRecurrence) => {
        setModel(next);
        setStoredValue(serializeRecurrence(next));
    }, [ setStoredValue ]);

    // One row in the popover, the whole rule behind it: the button says what the rule amounts to,
    // and opening it lays the rule out to edit. Kept open through the edits (`autoClose: "outside"`)
    // — a rule is several choices, and the menu going down after the first would make it three
    // trips. Portaled to the body because the popover clips what overflows it (see EventPopover.css).
    return (
        <EventField name={t("calendar.recurrence.repeats")}>
            <Dropdown
                className="calendar-recurrence-dropdown"
                text={modelTitle(model)}
                noDropdownListStyle
                portalToBody
                dropdownOptions={{ autoClose: "outside" }}
            >
                <EventFieldList>
                    <FrequencyField model={model} commit={commit} />
                    {model.kind === "simple" && <SimpleRuleFields rule={model.rule} commit={commit} />}
                    {model.kind === "custom" && <CustomRuleField value={model.value} commit={commit} />}
                </EventFieldList>
            </Dropdown>
        </EventField>
    );
}

/** What the closed row says the rule amounts to: the same wording the frequency choice wears. */
function modelTitle(model: ParsedRecurrence): string {
    switch (model.kind) {
        case "none":
            return t("calendar.recurrence.does_not_repeat");
        case "custom":
            return t("calendar.recurrence.custom");
        case "simple":
            return FREQUENCY_TITLES[model.rule.frequency]();
    }
}

/** What the frequency choice offers beside the frequencies themselves. */
const NO_REPEAT = "none";
const CUSTOM = "custom";

/**
 * The rule's headline: how often, or not at all. Segmented buttons rather than a select — a select
 * inside the already-open menu is a menu within a menu — and every choice on show at once. A rule
 * beyond the structured fields shows as "Custom", a segment that exists only while it is the
 * answer, since there is no such thing as asking for a custom rule with nothing to say in it.
 */
function FrequencyField({ model, commit }: {
    model: ParsedRecurrence;
    commit(next: ParsedRecurrence): void;
}) {
    const current = model.kind === "simple" ? model.rule.frequency
        : model.kind === "custom" ? CUSTOM : NO_REPEAT;

    const choices = [
        // "None" rather than the closed row's "Does not repeat": a segment is a word, not a sentence.
        { value: NO_REPEAT, label: t("calendar.recurrence.none") },
        ...FREQUENCIES.map((frequency) => ({ value: frequency, label: FREQUENCY_TITLES[frequency]() })),
        ...(model.kind === "custom" ? [ { value: CUSTOM, label: t("calendar.recurrence.custom") } ] : [])
    ];

    const onChange = (value: string) => {
        if (value === current) return;

        if (value === NO_REPEAT) {
            commit({ kind: "none" });
            return;
        }

        const frequency = FREQUENCIES.find((f) => f === value);
        if (!frequency) return;

        // What the old rule already said — how often within its period, and when it stops — is
        // carried over; the days belong to a weekly rule alone.
        const rule = model.kind === "simple" ? model.rule : undefined;
        commit({
            kind: "simple",
            rule: {
                frequency,
                interval: rule?.interval ?? 1,
                weekdays: frequency === "WEEKLY" ? (rule?.weekdays ?? []) : [],
                ends: rule?.ends ?? { type: "never" }
            }
        });
    };

    return (
        <EventField name={t("calendar.recurrence.frequency")}>
            <SegmentedChoice options={choices} currentValue={current} onChange={onChange} />
        </EventField>
    );
}

const FREQUENCY_TITLES: Record<Frequency, () => string> = {
    DAILY: () => t("calendar.recurrence.daily"),
    WEEKLY: () => t("calendar.recurrence.weekly"),
    MONTHLY: () => t("calendar.recurrence.monthly"),
    YEARLY: () => t("calendar.recurrence.yearly")
};

/** The fields a structured rule is spelt out in, once a frequency has been picked. */
function SimpleRuleFields({ rule, commit }: {
    rule: SimpleRecurrence;
    commit(next: ParsedRecurrence): void;
}) {
    const commitRule = (changes: Partial<SimpleRecurrence>) =>
        commit({ kind: "simple", rule: { ...rule, ...changes } });

    return (
        <>
            <EventField name={t("calendar.recurrence.repeat_every")}>
                <EventFieldControls>
                    <FormTextBoxWithUnit
                        type="number"
                        min={1}
                        currentValue={String(rule.interval)}
                        onBlur={(value) => commitRule({ interval: parseInt(value, 10) || 1 })}
                        unit={INTERVAL_UNITS[rule.frequency]()}
                    />
                </EventFieldControls>
            </EventField>

            {rule.frequency === "WEEKLY" && (
                <EventField name={t("calendar.recurrence.on_days")}>
                    <WeekdayToggles
                        weekdays={rule.weekdays}
                        onChange={(weekdays) => commitRule({ weekdays })}
                    />
                </EventField>
            )}

            <EndsField ends={rule.ends} onChange={(ends) => commitRule({ ends })} />
        </>
    );
}

const INTERVAL_UNITS: Record<Frequency, () => string> = {
    DAILY: () => t("calendar.recurrence.unit_days"),
    WEEKLY: () => t("calendar.recurrence.unit_weeks"),
    MONTHLY: () => t("calendar.recurrence.unit_months"),
    YEARLY: () => t("calendar.recurrence.unit_years")
};

/** The days of a weekly rule, a pill per day. None pressed, the start date's own day carries it. */
function WeekdayToggles({ weekdays, onChange }: {
    weekdays: WeekdayCode[];
    onChange(weekdays: WeekdayCode[]): void;
}) {
    const toggle = (code: WeekdayCode) => {
        onChange(weekdays.includes(code)
            ? weekdays.filter((day) => day !== code)
            : [ ...weekdays, code ]);
    };

    return (
        <div className="calendar-recurrence-weekdays">
            {WEEKDAY_CODES.map((code) => (
                <button
                    key={code}
                    type="button"
                    className={clsx("calendar-recurrence-weekday", weekdays.includes(code) && "active")}
                    aria-pressed={weekdays.includes(code)}
                    onClick={() => toggle(code)}
                >
                    {WEEKDAY_TITLES[code]()}
                </button>
            ))}
        </div>
    );
}

const WEEKDAY_TITLES: Record<WeekdayCode, () => string> = {
    MO: () => t("calendar.mon"),
    TU: () => t("calendar.tue"),
    WE: () => t("calendar.wed"),
    TH: () => t("calendar.thu"),
    FR: () => t("calendar.fri"),
    SA: () => t("calendar.sat"),
    SU: () => t("calendar.sun")
};

/** A count an "after N times" ending starts from — a foothold to edit, not a recommendation. */
const DEFAULT_COUNT = 10;

/** When the repetition stops: never, on a day, or after so many times. */
function EndsField({ ends, onChange }: {
    ends: RecurrenceEnd;
    onChange(ends: RecurrenceEnd): void;
}) {
    const selectId = useUniqueName("recurrence-ends");

    const choices = [
        { key: "never", title: t("calendar.recurrence.never") },
        { key: "until", title: t("calendar.recurrence.until") },
        { key: "count", title: t("calendar.recurrence.count") }
    ];

    const onPick = (key: string) => {
        if (key === ends.type) return;

        if (key === "until") {
            // The date comes second: the rule stays unbounded until one is picked (see recurrence.ts).
            onChange({ type: "until", date: "" });
        } else if (key === "count") {
            onChange({ type: "count", count: DEFAULT_COUNT });
        } else {
            onChange({ type: "never" });
        }
    };

    return (
        <EventField name={t("calendar.recurrence.ends")} htmlFor={selectId}>
            <EventFieldControls>
                <FormSelect
                    id={selectId}
                    values={choices}
                    keyProperty="key"
                    titleProperty="title"
                    currentValue={ends.type}
                    onChange={onPick}
                />

                {ends.type === "until" && (
                    <LabelValueInput
                        labelType="date"
                        value={ends.date}
                        onCommit={(date) => onChange({ type: "until", date })}
                        inputProps={{ className: "form-control" }}
                    />
                )}

                {ends.type === "count" && (
                    <FormTextBoxWithUnit
                        type="number"
                        min={1}
                        currentValue={String(ends.count)}
                        onBlur={(value) => onChange({ type: "count", count: parseInt(value, 10) || 1 })}
                        unit={t("calendar.recurrence.times")}
                    />
                )}
            </EventFieldControls>
        </EventField>
    );
}

/** The raw RRULE string, for a rule the structured fields cannot say (see recurrence.ts). */
function CustomRuleField({ value, commit }: {
    value: string;
    commit(next: ParsedRecurrence): void;
}) {
    const inputId = useUniqueName("recurrence-custom");

    return (
        <EventField name={t("calendar.recurrence.custom_rule")} htmlFor={inputId}>
            <FormTextBox
                id={inputId}
                currentValue={value}
                spellcheck={false}
                placeholder="RRULE:FREQ=WEEKLY;BYDAY=MO,FR"
                // On blur, and parsed afresh rather than kept custom: an edit may well have brought
                // the rule back within what the structured fields can say, and then they should say it.
                onBlur={(newValue) => commit(parseRecurrence(newValue))}
            />
            <p className="calendar-recurrence-hint">{t("calendar.recurrence.custom_hint")}</p>
        </EventField>
    );
}
