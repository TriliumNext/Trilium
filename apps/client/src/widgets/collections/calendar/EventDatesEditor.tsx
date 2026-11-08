import { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import LabelValueInput from "../../attribute_widgets/label_value_input";
import { EventDuration, EventRow, EventTimeRow } from "./EventField";
import { useEventLabel } from "./hooks";
import { EventDraft, normalizeEventDates, withAllDay, withStart } from "./selection";

/**
 * Edits the date and time labels of an existing event, including labels renamed through
 * `#calendar:startDate` and similar (see `useEventLabel()`). Writes only the labels an edit changes.
 */
export default function EventDatesEditor({ note, repeats }: {
    note: FNote;
    /** The repeats field, shown on a row of its own below the hours. */
    repeats?: ComponentChildren;
}) {
    const [ startDate, setStartDate ] = useEventLabel(note, "startDate");
    const [ endDate, setEndDate ] = useEventLabel(note, "endDate");
    const [ startTime, setStartTime ] = useEventLabel(note, "startTime");
    const [ endTime, setEndTime ] = useEventLabel(note, "endTime");

    // The labels change only when the server echoes a write, so the last edit is kept here and the
    // next edit is compared against it. Another note, a label change from the server or a failed
    // write replaces it with the stored labels.
    const stored: EventDraft = { startDate: startDate ?? "", endDate, startTime, endTime };
    const storedRef = useRef(stored);
    storedRef.current = stored;
    const [ value, setValue ] = useState(stored);
    useEffect(() => setValue(stored), [ note, startDate, endDate, startTime, endTime ]);

    const onChange = (next: EventDraft) => {
        setValue(next);
        const writes: Promise<unknown>[] = [];
        if (next.startDate !== value.startDate) writes.push(setStartDate(next.startDate));
        if ((next.endDate ?? null) !== (value.endDate ?? null)) writes.push(setEndDate(next.endDate ?? null));
        if ((next.startTime ?? null) !== (value.startTime ?? null)) writes.push(setStartTime(next.startTime ?? null));
        if ((next.endTime ?? null) !== (value.endTime ?? null)) writes.push(setEndTime(next.endTime ?? null));
        Promise.all(writes).catch(() => setValue(storedRef.current));
    };

    return (
        <>
            <EventDatesFields value={value} onChange={onChange} />

            {repeats && (
                <EventRow icon="bx-repeat" title={t("calendar.recurrence.repeats")}>
                    {repeats}
                </EventRow>
            )}
        </>
    );
}

/**
 * The date and time rows of an event, used by `EventPopover` and `GhostPopover`. Each field commits
 * on blur and passes the whole edited event to `onChange`.
 */
export function EventDatesFields({ value, onChange }: {
    value: EventDraft;
    onChange(next: EventDraft): void;
}) {
    const event = normalizeEventDates(value);
    const { startDate, endDate, startTime, endTime } = event;
    const change = (next: EventDraft) => onChange(normalizeEventDates(next));

    return (
        <>
            <EventRow icon="bx-calendar" title={t("calendar.dates.date")}>
                <LabelValueInput
                    labelType="date"
                    value={startDate}
                    commitOn="blur"
                    // An empty start date is ignored, since a note without one is not an event.
                    onCommit={(date) => date && change(withStart(event, { startDate: date }))}
                    inputProps={{ className: "form-control", "aria-label": t("calendar.dates.start_date") }}
                />
                <span className="calendar-event-row-separator" aria-hidden="true">–</span>
                <LabelValueInput
                    labelType="date"
                    value={endDate ?? ""}
                    commitOn="blur"
                    // An empty end date removes the label, which makes it a single-day event.
                    onCommit={(date) => change({ ...event, endDate: date || null })}
                    inputProps={{ className: "form-control", "aria-label": t("calendar.dates.end_date") }}
                />
            </EventRow>

            <EventTimeRow
                hasTime={!!startTime}
                onAdd={() => change(withAllDay(event, false))}
                onRemove={() => change(withAllDay(event, true))}
            >
                <LabelValueInput
                    labelType="time"
                    value={startTime ?? ""}
                    commitOn="blur"
                    // An empty start time is ignored; `EventTimeRow`'s remove button makes it all-day.
                    onCommit={(time) => time && change(withStart(event, { startTime: time }))}
                    inputProps={{ className: "form-control", "aria-label": t("calendar.dates.start_time") }}
                />
                <span className="calendar-event-row-separator" aria-hidden="true">–</span>
                <LabelValueInput
                    labelType="time"
                    value={endTime ?? ""}
                    commitOn="blur"
                    onCommit={(time) => time && change({ ...event, endTime: time })}
                    inputProps={{ className: "form-control", "aria-label": t("calendar.dates.end_time") }}
                />
                {startDate && <EventDuration event={event} />}
            </EventTimeRow>
        </>
    );
}
