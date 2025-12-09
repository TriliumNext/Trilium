import { EventInput, EventSourceFuncArg, EventSourceInput } from "@fullcalendar/core/index.js";
import froca from "../../../services/froca";
import { formatDateToLocalISO, getCustomisableLabel, getMonthsInDateRange, offsetDate } from "./utils";
import FNote from "../../../entities/fnote";
import server from "../../../services/server";
import clsx from "clsx";

interface Event {
    startDate: string,
    endDate?: string | null,
    startTime?: string | null,
    endTime?: string | null,
    isArchived?: boolean;
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
        const isArchived = note.hasLabel("archived");
        events.push(await buildEvent(note, { startDate, endDate, startTime, endTime, isArchived }));
    }

    return events.flat();
}

export async function buildEventsForCalendar(note: FNote, e: EventSourceFuncArg) {
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
            const childNoteIds = await dateNote.getSubtreeNoteIds();
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

export async function buildEvent(note: FNote, { startDate, endDate, startTime, endTime, isArchived }: Event) {
    const customTitleAttributeName = note.getLabelValue("calendar:title");
    const titles = await parseCustomTitle(customTitleAttributeName, note);
    const colorClass = note.getColorClass();
    const events: EventInput[] = [];

    const calendarDisplayedAttributes = note.getLabelValue("calendar:displayedAttributes")?.split(",");
    let displayedAttributesData: Array<[string, string]> | null = null;
    if (calendarDisplayedAttributes) {
        displayedAttributesData = await buildDisplayedAttributes(note, calendarDisplayedAttributes);
    }

    for (const title of titles) {
        if (startTime && endTime && !endDate) {
            endDate = startDate;
        }

        startDate = (startTime ? `${startDate}T${startTime}:00` : startDate);
        if (!startTime) {
            const endDateOffset = offsetDate(endDate ?? startDate, 1);
            if (endDateOffset) {
                endDate = formatDateToLocalISO(endDateOffset);
            }
        }

        endDate = (endTime ? `${endDate}T${endTime}:00` : endDate);
        const eventData: EventInput = {
            title: title,
            start: startDate,
            url: `#${note.noteId}?popup`,
            noteId: note.noteId,
            iconClass: note.getLabelValue("iconClass"),
            promotedAttributes: displayedAttributesData,
            className: clsx({archived: isArchived}, colorClass)
        };
        if (endDate) {
            eventData.end = endDate;
        }
        events.push(eventData);
    }
    return events;
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
    const filteredDisplayedAttributes = note.getAttributes().filter((attr): boolean => calendarDisplayedAttributes.includes(attr.name))
    const result: Array<[string, string]> = [];

    for (const attribute of filteredDisplayedAttributes) {
        if (attribute.type === "label") result.push([attribute.name, attribute.value]);
        else result.push([attribute.name, (await attribute.getTargetNote())?.title || ""])
    }

    return result;
}
