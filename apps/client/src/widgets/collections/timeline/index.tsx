import "fullcalendar/skeleton.css";
import "fullcalendar/themes/forma/theme.css";
import "../calendar/palette.css";
import "../calendar/index.css";
import "./index.css";

import { Calendar as FullCalendar, DateSelectInfo, EventChangeInfo, EventClickInfo, EventDisplayInfo, EventInput, MountInfo, PluginInput } from "fullcalendar";
import type { ResourceCellInfo } from "fullcalendar-scheduler";
import { RefObject } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import note_tooltip from "../../../services/note_tooltip";
import CollectionProperties from "../../note_bars/CollectionProperties";
import ActionButton from "../../react/ActionButton";
import Button, { ButtonGroup } from "../../react/Button";
import { useNoteLabel, useSpacedUpdate, useTriliumEvent, useTriliumOptionInt } from "../../react/hooks";
import { ParentComponent } from "../../react/react_utils";
import { useLocale, useOnDatesSet } from "../calendar";
import { changeEvent } from "../calendar/api";
import Calendar from "../calendar/calendar";
import { buildEvents } from "../calendar/event_builder";
import EventPopover from "../calendar/EventPopover";
import { isAttributeChangeAffecting, parseStartEndDateFromEvent, parseStartEndTimeFromEvent } from "../calendar/utils";
import { ViewModeProps } from "../interface";
import { buildResources } from "./resources";

const TIMELINE_VIEWS = [
    { type: "resourceTimelineWeek", name: t("calendar.week") },
    { type: "resourceTimelineMonth", name: t("calendar.month") },
    { type: "resourceTimelineYear", name: t("calendar.year") }
];

const DEFAULT_VIEW = "resourceTimelineMonth";

const VIEW_OPTIONS = {
    resourceTimelineWeek: { slotDuration: { days: 1 } },
    resourceTimelineMonth: { slotDuration: { days: 1 } },
    resourceTimelineYear: { slotDuration: { months: 1 }, snapDuration: { days: 1 } }
};

/** FullCalendar Premium is used under its AGPLv3 license, the same as Trilium's. */
const SCHEDULER_LICENSE_KEY = "AGPL-My-Frontend-And-Backend-Are-Open-Source";

export default function TimelineView({ note, noteIds }: ViewModeProps<object>) {
    const parentComponent = useContext(ParentComponent);
    const componentId = parentComponent?.componentId;
    const containerRef = useRef<HTMLDivElement>(null);
    const calendarRef = useRef<FullCalendar>(null);
    const [ selection, setSelection ] = useState<{ noteId: string, anchor: { x: number, y: number } | null } | null>(null);

    const [ firstDayOfWeek ] = useTriliumOptionInt("firstDayOfWeek");
    const [ timelineView, setTimelineView ] = useNoteLabel(note, "timeline:view");
    const initialView = useRef(timelineView);
    const viewSpacedUpdate = useSpacedUpdate(() => setTimelineView(initialView.current));

    const plugins = usePlugins();
    const locale = useLocale();

    const resources = useMemo(() => async () => {
        await froca.getNotes([ note.noteId, ...noteIds ]);
        return buildResources(note.noteId, noteIds, (noteId) => froca.getNoteFromCache(noteId));
    }, [ note, noteIds ]);

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

    // A range selected on a row schedules that row's note, dated or not.
    const onSelect = useCallback(async (e: DateSelectInfo) => {
        calendarRef.current?.unselect();
        const rowNote = e.resource && await froca.getNote(e.resource.id);
        const { startDate, endDate } = parseStartEndDateFromEvent(e);
        if (!rowNote || !startDate) return;

        await changeEvent(rowNote, { startDate, endDate, startTime: null, endTime: null, componentId });
    }, [ componentId ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const api = calendarRef.current;
        if (!api) return;

        const isTitleChanged = loadResults.getNoteIds().some(noteId => noteIds.includes(noteId));
        if (isTitleChanged || isAttributeChangeAffecting(loadResults.getAttributeRows(componentId), noteIds)) {
            // Deferred so that froca holds the new data when the builders run.
            setTimeout(() => {
                api.refetchResources();
                api.refetchEvents();
            }, 0);
        }
    });

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
                resourceColumnHeaderContent={t("timeline.title_column")}
                resourceCellContent={(info: ResourceCellInfo) => info.resource && (
                    <span
                        className="timeline-row-title"
                        onClick={(e) => info.resource && setSelection({ noteId: info.resource.id, anchor: { x: e.clientX, y: e.clientY } })}
                    >
                        <span className={`calendar-event-icon ${info.resource.extendedProps.iconClass}`} />
                        {info.resource.title}
                    </span>
                )}
                events={events}
                editable
                eventResourceEditable={false}
                selectable
                select={onSelect}
                eventChange={onEventChange}
                eventClick={onEventClick}
                eventClass={(arg: EventDisplayInfo) => (selection?.noteId === arg.event.extendedProps.noteId
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
            {selection && (
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
