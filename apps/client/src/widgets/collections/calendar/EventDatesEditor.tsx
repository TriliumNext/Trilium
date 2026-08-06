import "./EventDatesEditor.css";

import { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import LabelValueInput from "../../attribute_widgets/label_value_input";
import FormToggle from "../../react/FormToggle";
import { useUniqueName } from "../../react/hooks";
import { EventField, EventFieldControls, EventFieldRow } from "./EventField";
import { useEventLabel } from "./hooks";

/**
 * Edits when the event happens, through the date and time labels the calendar draws it by (see
 * event_builder.ts) — under whatever names the note draws them by, a `#calendar:startDate`
 * renaming included (see useEventLabel). Two shapes, told apart by the all-day switch: a whole-day
 * event is a span of days — a start date and, where it runs longer, an end date — while a timed
 * one is a single day and the hours within it. Rendered as {@link EventField} rows, standing in
 * the event popover's field column beside the recurrence.
 */
export default function EventDatesEditor({ note, repeats }: {
    note: FNote;
    /** The repeats field, handed in to stand beside the all-day switch: how the event repeats
     *  belongs to the recurrence editor, but the room next to the switch is this editor's to give. */
    repeats?: ComponentChildren;
}) {
    const [ startDate, setStartDate ] = useEventLabel(note, "startDate");
    const [ endDate, setEndDate ] = useEventLabel(note, "endDate");
    const [ startTime, setStartTime ] = useEventLabel(note, "startTime");
    const [ endTime, setEndTime ] = useEventLabel(note, "endTime");
    const startDateId = useUniqueName("event-start-date");
    const allDayId = useUniqueName("event-all-day");

    // All day is the absence of a start time, which is how the event builder reads it too. Held
    // locally so the switch answers the press at once — the labels the press writes come back only
    // with the server's echo — and follows the note's own state wherever it changes from.
    const storedAllDay = !startTime;
    const [ allDay, setAllDay ] = useState(storedAllDay);
    useEffect(() => setAllDay(storedAllDay), [ storedAllDay ]);

    const toggleAllDay = (on: boolean) => {
        setAllDay(on);
        if (on) {
            // A whole day has no hours; the dates stay as they were.
            setStartTime(null);
            setEndTime(null);
        } else {
            // A timed event is said within one day, so a span of days is let go rather than kept
            // where the fields no longer show it. The hours are a foothold to edit, not a guess.
            setStartTime(DEFAULT_START_TIME);
            setEndTime(endTime ?? DEFAULT_END_TIME);
            setEndDate(null);
        }
    };

    return (
        <>
            {/* The two shape-of-the-event switches share the first line: whether it takes the whole
                day, and whether it comes back. The app's own toggle (see the revisions dialog),
                nameless because the field's name speaks for it — a switch rather than a checkbox,
                as it reads as the mode flip it is. */}
            <EventFieldRow>
                <EventField name={t("calendar.dates.all_day")} htmlFor={allDayId} compact>
                    <div className="calendar-all-day-switch">
                        <FormToggle
                            id={allDayId}
                            currentValue={allDay}
                            onChange={toggleAllDay}
                        />
                    </div>
                </EventField>
                {repeats}
            </EventFieldRow>

            {/* One line whichever the shape: the day, or the days it spans. */}
            <EventField name={t("calendar.dates.date")} htmlFor={startDateId}>
                <EventFieldControls className="calendar-event-range">
                    <LabelValueInput
                        labelType="date"
                        value={startDate ?? ""}
                        commitOn="blur"
                        // Never emptied: without a start date the note stops being an event at all,
                        // and the dock is no place to do that by accident. The field snaps back.
                        onCommit={(value) => value && setStartDate(value)}
                        inputProps={{ id: startDateId, className: "form-control", "aria-label": t("calendar.dates.start_date") }}
                    />
                    {allDay && <>
                        <span className="calendar-event-range-separator" aria-hidden="true">–</span>
                        <LabelValueInput
                            labelType="date"
                            value={endDate ?? ""}
                            commitOn="blur"
                            // Emptied, the event is a single day: the label goes rather than
                            // staying blank, which is how the builder reads a day-long event.
                            onCommit={(value) => setEndDate(value || null)}
                            inputProps={{ className: "form-control", "aria-label": t("calendar.dates.end_date") }}
                        />
                    </>}
                </EventFieldControls>
            </EventField>

            {!allDay && (
                <EventField name={t("calendar.dates.time")}>
                    <EventFieldControls className="calendar-event-range">
                        <LabelValueInput
                            labelType="time"
                            value={startTime ?? ""}
                            commitOn="blur"
                            // Never emptied either: a timed event without a start time is the
                            // all-day shape, and the switch above is the way to say that.
                            onCommit={(value) => value && setStartTime(value)}
                            inputProps={{ className: "form-control", "aria-label": t("calendar.dates.start_time") }}
                        />
                        <span className="calendar-event-range-separator" aria-hidden="true">–</span>
                        <LabelValueInput
                            labelType="time"
                            value={endTime ?? ""}
                            commitOn="blur"
                            onCommit={(value) => value && setEndTime(value)}
                            inputProps={{ className: "form-control", "aria-label": t("calendar.dates.end_time") }}
                        />
                    </EventFieldControls>
                </EventField>
            )}
        </>
    );
}

/** The hours a day gets when it stops being whole: a meeting-sized block in mid-morning, put there
 *  to be edited rather than kept. An end time the note already had (a half-said timed event) is
 *  honoured instead. */
const DEFAULT_START_TIME = "09:00";
const DEFAULT_END_TIME = "10:00";
