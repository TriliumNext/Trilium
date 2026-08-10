import { dayjs } from "@triliumnext/commons";
import clsx from "clsx";
import { EventInput, EventSourceFuncInfo, EventSourceInput } from "fullcalendar";
import * as rruleLib from 'rrule';

import FAttribute from "../../../entities/fattribute";
import FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import server from "../../../services/server";
import toastService from "../../../services/toast";
import { getCustomisableLabel, getMonthsInDateRange } from "./utils";

interface Event {
    startDate: string,
    endDate?: string | null,
    startTime?: string | null,
    endTime?: string | null,
    isArchived?: boolean,
    recurrence?: string | null;
}

export async function buildEvents(noteIds: string[]) {
    const notes = await froca.getNotes(noteIds);
    const events: EventSourceInput = [];

    for (const note of notes) {
        const startDate = getCustomisableLabel(note, "startDate", "calendar:startDate");

        if (!startDate) {
            continue;
        }

        const endDate = getCustomisableLabel(note, "endDate", "calendar:endDate");
        const startTime = getCustomisableLabel(note, "startTime", "calendar:startTime");
        const endTime = getCustomisableLabel(note, "endTime", "calendar:endTime");
        const recurrence = getCustomisableLabel(note, "recurrence", "calendar:recurrence");
        const isArchived = note.hasLabel("archived");
        try {
            events.push(await buildEvent(note, { startDate, endDate, startTime, endTime, recurrence, isArchived }));
        } catch (error) {
            if (error instanceof Error) {
                const errorMessage = error.message;
                toastService.showError(errorMessage);
                console.error(errorMessage);
            }
        }
    }

    return events.flat();
}

export async function buildEventsForCalendar(note: FNote, e: EventSourceFuncInfo) {
    const events: EventInput[] = [];

    // Gather all the required date note IDs.
    const dateRange = getMonthsInDateRange(e.startStr, e.endStr);
    let allDateNoteIds: string[] = [];
    for (const month of dateRange) {
        // TODO: Deduplicate get type.
        const dateNotesForMonth = await server.get<Record<string, string>>(`special-notes/notes-for-month/${month}?calendarRoot=${note.noteId}`);
        const dateNoteIds = Object.values(dateNotesForMonth);
        allDateNoteIds = [...allDateNoteIds, ...dateNoteIds];
    }

    // Request all the date notes.
    const dateNotes = await froca.getNotes(allDateNoteIds);
    const childNoteToDateMapping: Record<string, string> = {};
    for (const dateNote of dateNotes) {
        const startDate = dateNote.getLabelValue("dateNote");
        if (!startDate) {
            continue;
        }

        events.push(await buildEvent(dateNote, { startDate }));


        if (dateNote.hasChildren()) {
            const childNoteIds = dateNote.getChildNoteIds();
            for (const childNoteId of childNoteIds) {
                childNoteToDateMapping[childNoteId] = startDate;
            }
        }
    }

    // Request all child notes of date notes in a single run.
    const childNoteIds = Object.keys(childNoteToDateMapping);
    const childNotes = await froca.getNotes(childNoteIds);
    for (const childNote of childNotes) {
        const startDate = childNoteToDateMapping[childNote.noteId];
        const event = await buildEvent(childNote, { startDate });
        events.push(event);
    }

    return events.flat();
}

export async function buildEvent(note: FNote, { startDate, endDate, startTime, endTime, recurrence, isArchived }: Event) {
    const customTitleAttributeName = note.getLabelValue("calendar:title");
    const titles = await parseCustomTitle(customTitleAttributeName, note);
    const colorClass = note.getColorClass();
    const events: EventInput[] = [];

    const calendarDisplayedAttributes = note.getLabelValue("calendar:displayedAttributes")?.split(",");
    let displayedAttributesData: Array<[string, string]> | null = null;
    if (calendarDisplayedAttributes) {
        displayedAttributesData = await buildDisplayedAttributes(note, calendarDisplayedAttributes);
    }

    // An event with no start time takes the whole day, which is how the editor writes one too (see
    // EventDatesEditor). When the event repeats this has to be said outright rather than left to
    // FullCalendar's rrule plugin to infer from the rule: the plugin reads the whole of the rule
    // looking for a time, so an `UNTIL=…T235959Z` — which the recurrence editor writes for an end
    // date (see recurrence.ts) — makes it take the event for a timed one whatever its DTSTART says.
    const allDay = !startTime;

    // When the event happens is the same whatever the note is called, so it is worked out once for
    // all the titles rather than inside the loop, which used to append the time to the dates again
    // for every title past the first.
    if (startTime && endTime && !endDate) {
        endDate = startDate;
    }

    startDate = (startTime ? `${startDate}T${startTime}:00` : startDate);
    if (!startTime) {
        if (endDate) {
            endDate = dayjs(endDate).add(1, "day").format("YYYY-MM-DD");
        } else if (startDate) {
            endDate = dayjs(startDate).add(1, "day").format("YYYY-MM-DD");
        }
    }

    endDate = (endTime ? `${endDate}T${endTime}:00` : endDate);
    // If the end date is now before the start date, bump it a day forward to account for times spanning the day boundary
    if (endDate && endTime && dayjs(endDate).isBefore(dayjs(startDate))) {
        endDate = dayjs(endDate).add(1, "day").format("YYYY-MM-DDTHH:mm:ss");
    }

    for (const title of titles) {
        const eventData: EventInput = {
            id: note.noteId,
            title,
            start: startDate,
            allDay,
            url: `#${note.noteId}?popup`,
            noteId: note.noteId,
            iconClass: note.getLabelValue("iconClass"),
            promotedAttributes: displayedAttributesData,
            className: clsx({archived: isArchived}, colorClass)
        };
        if (endDate) {
            eventData.end = endDate;
        }

        if (recurrence) {
            // Generate rrule string. A whole day is written as the bare date it is, no midnight
            // invented for hours the event does not have. `DTSTART;VALUE=DATE:` — the way iCalendar
            // spells the same thing — is not an option: the rrule library drops a DTSTART written
            // that way without a word and starts the series from today instead.
            const rruleString = `DTSTART:${dayjs(startDate).format(allDay ? "YYYYMMDD" : "YYYYMMDD[T]HHmmss")}\n${recurrence}`;

            // Validate rrule string
            let rruleValid = true;
            try {
                rruleLib.rrulestr(rruleString, { forceset: true }) as rruleLib.RRuleSet;
            } catch {
                rruleValid = false;
            }

            if (rruleValid) {
                delete eventData.end;
                eventData.rrule = rruleString;
                if (endDate){
                    eventData.duration = buildOccurrenceDuration(startDate, endDate);
                }
            } else {
                throw new Error(`Note "${note.noteId} ${note.title}" has an invalid #recurrence string ${recurrence}. Excluding...`);
            }
        }
        events.push(eventData);
    }
    return events;
}

/**
 * How long one occurrence of a recurring event lasts, as the duration object FullCalendar builds
 * its own from rather than as an `HH:mm` string. A string of hours and minutes has nowhere to put
 * days: a whole-day occurrence came out of it as `"00:00"` — no length at all — and a span of days
 * kept only the hours left over past the last of them.
 */
function buildOccurrenceDuration(startDate: string, endDate: string) {
    const minutes = dayjs(endDate).diff(dayjs(startDate), "minute");

    return {
        days: Math.floor(minutes / (24 * 60)),
        hours: Math.floor((minutes % (24 * 60)) / 60),
        minutes: minutes % 60
    };
}

async function parseCustomTitle(customTitlettributeName: string | null, note: FNote, allowRelations = true): Promise<string[]> {
    if (customTitlettributeName) {
        const labelValue = note.getAttributeValue("label", customTitlettributeName);
        if (labelValue) return [labelValue];

        if (allowRelations) {
            const relations = note.getRelations(customTitlettributeName);
            if (relations.length > 0) {
                const noteIds = relations.map((r) => r.targetNoteId);
                const notesFromRelation = await froca.getNotes(noteIds);
                const titles: string[][] = [];

                for (const targetNote of notesFromRelation) {
                    const targetCustomTitleValue = targetNote.getAttributeValue("label", "calendar:title");
                    const targetTitles = await parseCustomTitle(targetCustomTitleValue, targetNote, false);
                    titles.push(targetTitles.flat());
                }

                return titles.flat();
            }
        }
    }

    return [note.title];
}

async function buildDisplayedAttributes(note: FNote, calendarDisplayedAttributes: string[]) {
    const filteredDisplayedAttributes = note.getAttributes().filter((attr): boolean => calendarDisplayedAttributes.includes(attr.name));
    const result: Array<[string, string]> = [];

    for (const attribute of filteredDisplayedAttributes) {
        const name = displayedAttributeName(note, attribute);
        if (attribute.type === "label") result.push([name, attribute.value]);
        else result.push([name, (await attribute.getTargetNote())?.title || ""]);
    }

    return result;
}

/**
 * What a field is called on the chip: the alias its definition gives it, and the attribute's own
 * name where no definition gives one.
 *
 * Both halves are needed. The alias is the name the reader chose — the promoted field in the note
 * itself is labelled by it, and a chip saying something else is the same value under two names. The
 * fallback is what lets the calendar go on showing an attribute that was never promoted, which is
 * the whole point of `#calendar:displayedAttributes` naming attributes rather than definitions.
 */
function displayedAttributeName(note: FNote, attribute: FAttribute) {
    const definition = note.getAttribute("label", `${attribute.type}:${attribute.name}`);
    return definition?.getDefinition().promotedAlias || attribute.name;
}
