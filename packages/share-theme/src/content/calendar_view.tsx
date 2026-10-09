import "fullcalendar/skeleton.css";
import "fullcalendar/themes/forma/theme.css";
import "@triliumnext/client/src/widgets/collections/calendar/palette.css";
import "./calendar_view.css";

import froca from "@triliumnext/client/src/services/froca.js";
import Calendar from "@triliumnext/client/src/widgets/collections/calendar/calendar.js";
import { buildEvents } from "@triliumnext/client/src/widgets/collections/calendar/event_builder.js";
import type { EventClickInfo, EventInput, PluginInput } from "fullcalendar";
import { render } from "preact";

type SubtreeResponse = Parameters<typeof froca.addResp>[0];

/** The notes of a calendar, as core's `buildFrocaPayload()` embeds them in the page. */
export interface FrocaPayload extends SubtreeResponse {
    links: Record<string, string>;
}

/**
 * Loads the notes of the calendar into froca, so that the app's `buildEvents()` reads them as it
 * does in the app, and draws the app's calendar from its events. A click on an event opens the
 * note's shared page.
 */
export default async function mountCalendar(container: HTMLElement, payload: FrocaPayload) {
    froca.addResp(payload);
    const noteId = container.dataset.noteId ?? "";
    const childNoteIds = froca.getNoteFromCache(noteId)?.getChildNoteIds() ?? [];
    const [ events, plugins ] = await Promise.all([ buildEvents(childNoteIds), loadPlugins() ]);

    render(<ShareCalendar events={events} plugins={plugins} links={payload.links} />, container);
}

interface ShareCalendarProps {
    events: EventInput[];
    plugins: PluginInput[];
    links: Record<string, string>;
}

function ShareCalendar({ events, plugins, links }: ShareCalendarProps) {
    const onEventClick = (info: EventClickInfo) => {
        info.jsEvent.preventDefault();
        const link = links[String(info.event.extendedProps.noteId)];
        if (link) {
            window.location.href = link;
        }
    };

    return (
        <Calendar
            events={events}
            plugins={plugins}
            initialView="dayGridMonth"
            headerToolbar={{ start: "title", end: "today prev,next" }}
            height="auto"
            editable={false}
            eventClick={onEventClick}
        />
    );
}

/** The read-only subset of the plugins the app's calendar loads. */
async function loadPlugins(): Promise<PluginInput[]> {
    const modules = await Promise.all([
        import("fullcalendar/themes/forma"),
        import("fullcalendar/daygrid"),
        import("@fullcalendar/rrule")
    ]);
    return modules.map((module) => module.default);
}
