import "fullcalendar/skeleton.css";
import "fullcalendar/themes/forma/theme.css";
import "../calendar/palette.css";
import "../calendar/index.css";
import "./index.css";

import { Calendar as FullCalendar, DateSelectInfo, EventChangeInfo, EventClickInfo, EventDisplayInfo, EventInput, MountInfo, PluginInput } from "fullcalendar";
import type { ColSpec, ResourceCellInfo } from "fullcalendar-scheduler";
import { RefObject } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import note_create from "../../../services/note_create";
import note_tooltip from "../../../services/note_tooltip";
import CollectionProperties from "../../note_bars/CollectionProperties";
import ActionButton from "../../react/ActionButton";
import Button, { ButtonGroup } from "../../react/Button";
import { useNoteLabel, useSpacedUpdate, useTriliumEvent, useTriliumOptionInt } from "../../react/hooks";
import { ParentComponent } from "../../react/react_utils";
import { useLocale, useOnDatesSet } from "../calendar";
import { changeEvent, newEvent } from "../calendar/api";
import Calendar from "../calendar/calendar";
import { buildEvents } from "../calendar/event_builder";
import EventPopover from "../calendar/EventPopover";
import GhostPopover from "../calendar/GhostPopover";
import { CalendarSelection } from "../calendar/selection";
import { isAttributeChangeAffecting, parseStartEndDateFromEvent, parseStartEndTimeFromEvent } from "../calendar/utils";
import { ViewModeProps } from "../interface";
import getAttributeDefinitionInformation from "../table/rows";
import AttributeCell from "./attribute_cell";
import { buildResources, getColumnValues } from "./resources";

const TIMELINE_VIEWS = [
    { type: "resourceTimelineWeek", name: t("calendar.week") },
    { type: "resourceTimelineMonth", name: t("calendar.month") },
    { type: "resourceTimelineYear", name: t("calendar.year") }
];

const DEFAULT_VIEW = "resourceTimelineMonth";

const VIEW_OPTIONS = {
    resourceTimelineWeek: { slotDuration: { days: 1 } },
    resourceTimelineMonth: { slotDuration: { days: 1 } },
    // A snap must divide the slot evenly, which days do not do to a month, so the year is laid out
    // in weeks to keep dragging to the day.
    resourceTimelineYear: { slotDuration: { weeks: 1 }, snapDuration: { days: 1 } }
};

/** The row at the bottom that stands for a note yet to be created; dragging across it creates one. */
const NEW_ROW_ID = "_timeline_new";

/** FullCalendar Premium is used under its AGPLv3 license, the same as Trilium's. */
const SCHEDULER_LICENSE_KEY = "AGPL-My-Frontend-And-Backend-Are-Open-Source";

export default function TimelineView({ note, noteIds }: ViewModeProps<object>) {
    const parentComponent = useContext(ParentComponent);
    const componentId = parentComponent?.componentId;
    const containerRef = useRef<HTMLDivElement>(null);
    const calendarRef = useRef<FullCalendar>(null);
    const [ selection, setSelection ] = useState<CalendarSelection | null>(null);

    const [ firstDayOfWeek ] = useTriliumOptionInt("firstDayOfWeek");
    const [ timelineView, setTimelineView ] = useNoteLabel(note, "timeline:view");
    const initialView = useRef(timelineView);
    const viewSpacedUpdate = useSpacedUpdate(() => setTimelineView(initialView.current));

    const plugins = usePlugins();
    const locale = useLocale();

    // The collection's promoted attribute definitions, the same columns the table view shows.
    const [ columns, setColumns ] = useState(() => getAttributeDefinitionInformation(note));
    useEffect(() => setColumns(getAttributeDefinitionInformation(note)), [ note ]);

    const resources = useMemo(() => async () => {
        await froca.getNotes([ note.noteId, ...noteIds ]);
        const rows = buildResources(note.noteId, noteIds, (noteId) => froca.getNoteFromCache(noteId));

        const relationColumns = columns.filter(column => column.type === "relation");
        const rowNotes = rows.map(row => froca.getNoteFromCache(row.id));
        await froca.getNotes(rowNotes.flatMap(rowNote => relationColumns.flatMap(column =>
            rowNote?.getRelations(column.name).map(relation => relation.value) ?? [])), true);

        for (const [ index, row ] of rows.entries()) {
            const rowNote = rowNotes[index];
            row.values = Object.fromEntries(columns.map(column => [ column.name, rowNote
                ? getColumnValues(rowNote, column, (noteId) => froca.getNoteFromCache(noteId)?.title)
                : [] ]));
        }

        return [ ...rows, { id: NEW_ROW_ID, title: t("timeline.new_row"), order: Number.MAX_SAFE_INTEGER } ];
    }, [ note, noteIds, columns ]);

    const events = useMemo(() => async () => {
        const events = await buildEvents(noteIds) as EventInput[];
        return events.map(event => ({ ...event, resourceId: String(event.noteId) }));
    }, [ noteIds ]);

    const onEventClick = useCallback((e: EventClickInfo) => {
        // The bar is a link to the note's popup, which the document-level link handler would open.
        e.jsEvent.preventDefault();
        e.jsEvent.stopPropagation();
        note_tooltip.dismissAllTooltips();

        const noteId = e.event.extendedProps.noteId;
        if (noteId) {
            setSelection({ noteId, anchor: { x: e.jsEvent.clientX, y: e.jsEvent.clientY } });
        }
    }, []);

    const onEventChange = useCallback(async (e: EventChangeInfo) => {
        const eventNote = await froca.getNote(e.event.extendedProps.noteId);
        const { startDate, endDate } = parseStartEndDateFromEvent(e.event);
        if (!eventNote || !startDate) return;

        const { startTime, endTime } = parseStartEndTimeFromEvent(e.event);
        await changeEvent(eventNote, { startDate, endDate, startTime, endTime, componentId });
    }, [ componentId ]);

    // A range selected on a row schedules that row's note, dated or not. No `componentId` is passed:
    // unlike a dragged bar, the new bar is not drawn yet, and the reload below is what draws it.
    const onSelect = useCallback(async (e: DateSelectInfo) => {
        const { startDate, endDate } = parseStartEndDateFromEvent(e);
        if (!startDate) return;

        // On the new-note row the range stays selected, since the ghost is anchored to it.
        if (e.resource?.id === NEW_ROW_ID) {
            setSelection({
                draft: { startDate, endDate },
                anchor: e.jsEvent ? { x: e.jsEvent.clientX, y: e.jsEvent.clientY } : null
            });
            return;
        }

        calendarRef.current?.unselect();
        const rowNote = e.resource && await froca.getNote(e.resource.id);
        if (!rowNote) return;

        await changeEvent(rowNote, { startDate, endDate, startTime: null, endTime: null });
    }, []);

    const commitDraft = useCallback(async (title: string) => {
        if (!selection || !("draft" in selection)) return;

        await newEvent(note, { title: title.trim() || undefined, ...selection.draft });
        calendarRef.current?.unselect();
        setSelection(null);
    }, [ selection, note ]);

    const cancelDraft = useCallback(() => {
        calendarRef.current?.unselect();
        setSelection(null);
    }, []);

    const addNote = useCallback(async (parentNoteId: string, e: MouseEvent) => {
        e.stopPropagation();
        const anchor = { x: e.clientX, y: e.clientY };
        const parentNote = await froca.getNote(parentNoteId);
        const { note: createdNote } = await note_create.createNote(parentNoteId, {
            content: "",
            type: "text",
            isProtected: parentNote?.isProtected,
            activate: false
        });
        if (createdNote) {
            setSelection({ noteId: createdNote.noteId, anchor });
        }
    }, []);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const api = calendarRef.current;
        if (!api) return;

        const isDefinitionChanged = loadResults.getAttributeRows().some(attr => attr.type === "label"
            && (attr.name?.startsWith("label:") || attr.name?.startsWith("relation:"))
            && attributes.isAffecting(attr, note));
        if (isDefinitionChanged) {
            setTimeout(() => setColumns(getAttributeDefinitionInformation(note)), 0);
        }

        const isTitleChanged = loadResults.getNoteIds().some(noteId => noteIds.includes(noteId));
        if (isTitleChanged || isAttributeChangeAffecting(loadResults.getAttributeRows(componentId), noteIds)) {
            // Deferred so that froca holds the new data when the builders run.
            setTimeout(() => {
                api.refetchResources();
                api.refetchEvents();
            }, 0);
        }
    });

    const titleColumn: ColSpec = {
        headerContent: () => (
            <div className="timeline-row">
                <span className="timeline-row-title">{t("timeline.title_column")}</span>
                <ActionButton icon="bx bx-plus" text={t("timeline.add_note")} onClick={(e) => addNote(note.noteId, e)} />
            </div>
        ),
        cellContent: ({ resource }: ResourceCellInfo) => resource?.id === NEW_ROW_ID ? (
            <div className="timeline-row timeline-new-row">
                <span className="timeline-row-title" onClick={(e) => addNote(note.noteId, e)}>
                    <span className="calendar-event-icon bx bx-plus" />
                    {resource.title}
                </span>
            </div>
        ) : resource && (
            <div className="timeline-row">
                <span
                    className="timeline-row-title"
                    onClick={(e) => setSelection({ noteId: resource.id, anchor: { x: e.clientX, y: e.clientY } })}
                >
                    <span className={`calendar-event-icon ${resource.extendedProps.iconClass}`} />
                    {resource.title}
                </span>
                <ActionButton
                    className="timeline-row-add"
                    icon="bx bx-plus"
                    text={t("timeline.add_child_note")}
                    onClick={(e) => addNote(resource.id, e)}
                />
            </div>
        )
    };

    return (plugins &&
        <div className="calendar-view timeline-view" ref={containerRef}>
            <TimelineCollectionProperties note={note} calendarRef={calendarRef} />
            <Calendar
                calendarRef={calendarRef}
                plugins={plugins}
                schedulerLicenseKey={SCHEDULER_LICENSE_KEY}
                initialView={TIMELINE_VIEWS.some(v => v.type === initialView.current) ? initialView.current ?? DEFAULT_VIEW : DEFAULT_VIEW}
                views={VIEW_OPTIONS}
                headerToolbar={false}
                height="100%"
                borderless
                nowIndicator
                locale={locale}
                firstDay={firstDayOfWeek ?? 0}
                resources={resources}
                resourceOrder="order"
                resourcesInitiallyExpanded
                resourceColumns={[ titleColumn, ...columns.map((column): ColSpec => ({
                    headerContent: column.title ?? column.name,
                    width: 120,
                    cellContent: ({ resource }: ResourceCellInfo) => resource && resource.id !== NEW_ROW_ID && (
                        <AttributeCell noteId={resource.id} column={column} values={resource.extendedProps.values?.[column.name] ?? []} />
                    )
                })) ]}
                events={events}
                editable
                eventResourceEditable={false}
                selectable
                select={onSelect}
                highlightClass="calendar-highlight"
                unselectCancel=".calendar-ghost-popover, .calendar-ghost-sheet"
                eventChange={onEventChange}
                eventClick={onEventClick}
                eventClass={(arg: EventDisplayInfo) => (selection && "noteId" in selection
                    && selection.noteId === arg.event.extendedProps.noteId
                    ? "calendar-event calendar-event-selected no-tooltip-preview"
                    : "calendar-event")}
                eventContent={(e: EventDisplayInfo) => (
                    <div className={e.titleClass}>
                        {e.event.extendedProps.iconClass && <span className={`calendar-event-icon ${e.event.extendedProps.iconClass}`} />}
                        {e.event.title}
                    </div>
                )}
                eventDidMount={(e: MountInfo<EventDisplayInfo>) => {
                    // EventPopover finds the bar to stand beside by this attribute.
                    e.el.dataset.eventNoteId = String(e.event.extendedProps.noteId);
                }}
                viewDidMount={({ view }) => {
                    if (initialView.current !== view.type) {
                        initialView.current = view.type;
                        viewSpacedUpdate.scheduleUpdate();
                    }
                }}
            />
            {selection && "noteId" in selection && (
                <EventPopover
                    noteId={selection.noteId}
                    anchor={selection.anchor}
                    container={containerRef.current}
                    parentNote={note}
                    isEditable
                    onClose={() => setSelection(null)}
                    onFollowLink={() => false}
                />
            )}
            {selection && "draft" in selection && (
                <GhostPopover
                    draft={selection.draft}
                    anchor={selection.anchor}
                    container={containerRef.current}
                    onCommit={commitDraft}
                    onCancel={cancelDraft}
                    onDismiss={() => setSelection(null)}
                />
            )}
        </div>
    );
}

function TimelineCollectionProperties({ note, calendarRef }: {
    note: FNote;
    calendarRef: RefObject<FullCalendar>;
}) {
    const { title, viewType } = useOnDatesSet(calendarRef);

    return (
        <CollectionProperties
            note={note}
            centerChildren={<>
                <ActionButton icon="bx bx-chevron-left" text={t("timeline.previous")} onClick={() => calendarRef.current?.prev()} />
                <span className="title">{title}</span>
                <ActionButton icon="bx bx-chevron-right" text={t("timeline.next")} onClick={() => calendarRef.current?.next()} />
                <Button text={t("calendar.today")} onClick={() => calendarRef.current?.today()} />
            </>}
            rightChildren={
                <ButtonGroup>
                    {TIMELINE_VIEWS.map(view => (
                        <Button
                            key={view.type}
                            text={view.name}
                            className={viewType === view.type ? "active" : ""}
                            onClick={() => calendarRef.current?.changeView(view.type)}
                        />
                    ))}
                </ButtonGroup>
            }
        />
    );
}

function usePlugins() {
    const [ plugins, setPlugins ] = useState<PluginInput[]>();

    useEffect(() => {
        Promise.all([
            import("fullcalendar/themes/forma"),
            import("fullcalendar-scheduler/resource-timeline"),
            import("fullcalendar/interaction"),
            import("@fullcalendar/rrule")
        ]).then(modules => setPlugins(modules.map(m => m.default)));
    }, []);

    return plugins;
}
