import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OptionNames } from "@triliumnext/commons";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Capture the latest props handed to the (mocked) inner Calendar component so tests can drive its
// callbacks without instantiating the heavy FullCalendar engine.
const calendarState: { props: Record<string, any> | undefined; api: any } = { props: undefined, api: undefined };

vi.mock("./calendar", () => {
    function makeApi() {
        const listeners: Record<string, (() => void)[]> = {};
        return {
            view: { title: "June 2026", type: "dayGridMonth" },
            prev: vi.fn(),
            next: vi.fn(),
            today: vi.fn(),
            changeView: vi.fn(),
            updateSize: vi.fn(),
            refetchEvents: vi.fn(),
            getEventById: vi.fn(),
            on: vi.fn((name: string, cb: () => void) => { (listeners[name] ??= []).push(cb); }),
            off: vi.fn((name: string, cb: () => void) => {
                listeners[name] = (listeners[name] ?? []).filter((c) => c !== cb);
            }),
            emit: (name: string) => (listeners[name] ?? []).forEach((c) => c())
        };
    }

    return {
        default: function CalendarMock(props: Record<string, any>) {
            calendarState.props = props;
            if (props.calendarRef && !props.calendarRef.current) {
                props.calendarRef.current = makeApi();
                calendarState.api = props.calendarRef.current;
            }
            return <div className="calendar-container-mock" />;
        }
    };
});

// The component dynamically imports the heavy FullCalendar plugin packages inside usePlugins().
// Stub them with trivial default exports so plugin loading resolves instantly under the test env.
vi.mock("@fullcalendar/daygrid", () => ({ default: { name: "daygrid" } }));
vi.mock("@fullcalendar/timegrid", () => ({ default: { name: "timegrid" } }));
vi.mock("@fullcalendar/list", () => ({ default: { name: "list" } }));
vi.mock("@fullcalendar/multimonth", () => ({ default: { name: "multimonth" } }));
vi.mock("@fullcalendar/rrule", () => ({ default: { name: "rrule" } }));
vi.mock("@fullcalendar/interaction", () => ({ default: { name: "interaction" } }));

vi.mock("./api", () => ({
    newEvent: vi.fn(),
    changeEvent: vi.fn()
}));

vi.mock("./context_menu", () => ({
    openCalendarContextMenu: vi.fn()
}));

vi.mock("./event_builder", () => ({
    buildEvents: vi.fn(async () => []),
    buildEventsForCalendar: vi.fn(async () => [])
}));

// Render a thin pass-through so the calendar's collection-properties children actually mount,
// without dragging in the book/search-only gating of the real component.
vi.mock("../../note_bars/CollectionProperties", () => ({
    default: ({ centerChildren, rightChildren }: { centerChildren?: import("preact").ComponentChildren; rightChildren?: import("preact").ComponentChildren }) => (
        <div className="collection-properties-mock">
            <div className="center">{centerChildren}</div>
            <div className="right">{rightChildren}</div>
        </div>
    )
}));

vi.mock("../../../services/dialog", () => ({
    default: { prompt: vi.fn(async () => "New title") }
}));

vi.mock("../../../services/date_notes", () => ({
    default: { getDayNote: vi.fn(async () => null) }
}));

const mobileHolder = vi.hoisted(() => ({ value: false }));
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    isMobile: () => mobileHolder.value
}));

vi.mock("bootstrap", () => {
    class Dropdown {
        static instances = new Map<Element, Dropdown>();
        static getOrCreateInstance(el: Element) {
            let inst = Dropdown.instances.get(el);
            if (!inst) { inst = new Dropdown(el); Dropdown.instances.set(el, inst); }
            return inst;
        }
        element: Element;
        constructor(el: Element) { this.element = el; }
        show() {}
        hide() {}
        update() {}
        dispose() { Dropdown.instances.delete(this.element); }
    }
    class Tooltip {
        static getInstance() { return null; }
        dispose() {}
        show() {}
        hide() {}
    }
    return { Dropdown, Tooltip, default: { Dropdown, Tooltip } };
});

import appContext from "../../../components/app_context";
import date_notes from "../../../services/date_notes";
import dialog from "../../../services/dialog";
import froca from "../../../services/froca";
import options from "../../../services/options";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import { flush, renderComponent, resetFroca } from "../../../test/render";
import Component from "../../../components/component";
import type { ViewModeProps } from "../interface";
import { changeEvent, newEvent } from "./api";
import { openCalendarContextMenu } from "./context_menu";
import { buildEvents, buildEventsForCalendar } from "./event_builder";
import CalendarView, { LOCALE_MAPPINGS } from "./index";

// --- Harness --------------------------------------------------------------------------------------

const parent = new Component();

async function renderCalendar(props: Partial<ViewModeProps<any>> & { note: ReturnType<typeof buildNote> }) {
    const fullProps: ViewModeProps<any> = {
        notePath: "root/" + props.note.noteId,
        noteIds: [],
        highlightedTokens: null,
        viewConfig: undefined,
        saveConfig: vi.fn(),
        media: "screen",
        onReady: vi.fn(),
        ...props
    };
    const { container } = renderComponent(<CalendarView {...fullProps} />, { parent });
    // Let usePlugins / useLocale async effects settle, then the resulting re-render.
    await flush();
    return container;
}

function fireTrilium(name: string, data: unknown) {
    act(() => {
        (parent.handleEventInChildren as unknown as (n: string, d: unknown) => void)(name, data);
    });
}

/**
 * A fully-shaped duck-typed `LoadResults`. `entitiesReloaded` is consumed by several hooks at once
 * (options, labels, the calendar handler), so every accessor they may call must be present.
 */
function loadResults(opts: { attributeRows?: Array<{ noteId?: string }>; noteIds?: string[] } = {}) {
    return {
        getAttributeRows: () => opts.attributeRows ?? [],
        getBranchRows: () => [],
        getOptionNames: () => [],
        getNoteIds: () => opts.noteIds ?? [],
        isNoteReloaded: () => false,
        isNoteContentReloaded: () => false,
        getEntityRow: () => undefined
    };
}

beforeEach(() => {
    vi.useRealTimers();
    mobileHolder.value = false;
    calendarState.props = undefined;
    calendarState.api = undefined;
    resetFroca();
    options.load({ locale: "en", formattingLocale: "en", firstDayOfWeek: "1" } as Record<OptionNames, string>);
    vi.clearAllMocks();
    Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: vi.fn() });
});

// --- Tests ----------------------------------------------------------------------------------------

describe("CalendarView", () => {
    it("renders the calendar shell, loads plugins, and wires an editable event builder for a regular note", async () => {
        const note = buildNote({ id: "regular", title: "Regular" });
        const root = await renderCalendar({ note, noteIds: [ "a", "b" ] });

        expect(root.querySelector(".calendar-view")).toBeTruthy();
        expect(root.querySelector(".calendar-container-mock")).toBeTruthy();

        const props = calendarState.props;
        expect(props).toBeDefined();
        // Editable note → interaction plugin is included.
        expect(props?.editable).toBe(true);
        expect(props?.selectable).toBe(true);
        expect(props?.dateClick).toBeUndefined();
        // firstDayOfWeek option propagates.
        expect(props?.firstDay).toBe(1);
        // Plugin list resolved (daygrid/timegrid/list/multimonth/rrule + interaction).
        expect(Array.isArray(props?.plugins)).toBe(true);
        expect(props?.plugins.length).toBe(6);

        // The event builder uses the noteIds path for non-root calendars.
        await props?.events();
        expect(buildEvents).toHaveBeenCalledWith([ "a", "b" ]);
        expect(buildEventsForCalendar).not.toHaveBeenCalled();
    });

    it("treats a calendarRoot note as non-editable and builds events from the note", async () => {
        const note = buildNote({ id: "rootCal", title: "Root", "#calendarRoot": "true" });
        await renderCalendar({ note, noteIds: [] });

        const props = calendarState.props;
        expect(props?.editable).toBe(false);
        expect(props?.selectable).toBe(false);
        // dateClick is wired only for calendar roots.
        expect(typeof props?.dateClick).toBe("function");
        // Calendar-root path builds events from the note, not from noteIds.
        await props?.events({ startStr: "2026-01-01", endStr: "2026-02-01" });
        expect(buildEventsForCalendar).toHaveBeenCalled();
        expect(buildEvents).not.toHaveBeenCalled();
    });

    it("honors hideWeekends / weekNumbers / initialDate labels and a supported initial view", async () => {
        const note = buildNote({
            id: "labeled",
            title: "Labeled",
            "#calendar:hideWeekends": "true",
            "#calendar:weekNumbers": "true",
            "#calendar:initialDate": "2026-03-15",
            "#calendar:view": "timeGridWeek"
        });
        await renderCalendar({ note });

        const props = calendarState.props;
        expect(props?.weekends).toBe(false);
        expect(props?.weekNumbers).toBe(true);
        expect(props?.initialDate).toBe("2026-03-15");
        expect(props?.initialView).toBe("timeGridWeek");
    });

    it("falls back to dayGridMonth when the saved view is not supported", async () => {
        const note = buildNote({ id: "badview", title: "Bad", "#calendar:view": "totallyUnknown" });
        await renderCalendar({ note });
        expect(calendarState.props?.initialView).toBe("dayGridMonth");
    });
});

describe("CalendarView - entitiesReloaded reactions", () => {
    it("refetches events when a subnote attribute changes", async () => {
        const note = buildNote({ id: "evRoot", title: "Root" });
        await renderCalendar({ note, noteIds: [ "child1" ] });
        const api = calendarState.api;
        expect(api).toBeDefined();

        fireTrilium("entitiesReloaded", { loadResults: loadResults({ attributeRows: [ { noteId: "child1" } ] }) });
        // The refetch is deferred via setTimeout(0); let it run.
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(api.refetchEvents).toHaveBeenCalled();
    });

    it("updates an event title when the underlying note title changed", async () => {
        const note = buildNote({ id: "titleRoot", title: "Root" });
        const child = buildNote({ id: "evtNote", title: "Updated Title" });
        await renderCalendar({ note, noteIds: [ "evtNote" ] });
        const api = calendarState.api;
        const setProp = vi.fn();
        api.getEventById.mockReturnValue({ title: "Old Title", setProp });

        fireTrilium("entitiesReloaded", { loadResults: loadResults({ noteIds: [ "evtNote" ] }) });
        expect(setProp).toHaveBeenCalledWith("title", "Updated Title");
        expect(child.title).toBe("Updated Title");
    });

    it("does not update the title when it is unchanged or the event/note is missing", async () => {
        const note = buildNote({ id: "noopRoot", title: "Root" });
        buildNote({ id: "sameNote", title: "Same" });
        await renderCalendar({ note, noteIds: [ "sameNote", "missingEvent", "unknownNote" ] });
        const api = calendarState.api;
        const setProp = vi.fn();
        api.getEventById.mockImplementation((id: string) => {
            if (id === "sameNote") return { title: "Same", setProp };
            return null; // missing event for the others
        });

        fireTrilium("entitiesReloaded", { loadResults: loadResults({ noteIds: [ "sameNote", "missingEvent", "unknownNote" ] }) });
        expect(setProp).not.toHaveBeenCalled();
    });

    it("ignores entitiesReloaded entirely when the calendar API is not ready", async () => {
        const note = buildNote({ id: "noApiRoot", title: "Root" });
        await renderCalendar({ note, noteIds: [ "x" ] });
        // Force the ref to be empty as if the calendar never mounted.
        if (calendarState.props?.calendarRef) {
            calendarState.props.calendarRef.current = null;
        }
        expect(() => fireTrilium("entitiesReloaded", { loadResults: loadResults({ attributeRows: [ { noteId: "x" } ], noteIds: [ "x" ] }) })).not.toThrow();
    });
});

describe("CalendarView - editing callbacks", () => {
    function dateSelectArg() {
        const start = new Date("2026-05-01T00:00:00Z");
        const end = new Date("2026-05-03T00:00:00Z");
        return { start, end, allDay: true } as any;
    }

    it("creates a new event when a selection is confirmed with a title", async () => {
        const note = buildNote({ id: "selNote", title: "Sel" });
        await renderCalendar({ note });
        await act(async () => { await calendarState.props?.select(dateSelectArg()); });
        expect(dialog.prompt).toHaveBeenCalled();
        expect(newEvent).toHaveBeenCalledTimes(1);
        const [ passedNote, opts ] = (newEvent as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(passedNote).toBe(note);
        expect(opts.title).toBe("New title");
        expect(opts.startDate).toBe("2026-05-01");
    });

    it("aborts event creation when the title prompt is empty/cancelled", async () => {
        (dialog.prompt as ReturnType<typeof vi.fn>).mockResolvedValueOnce("   ");
        const note = buildNote({ id: "emptyTitle", title: "E" });
        await renderCalendar({ note });
        await act(async () => { await calendarState.props?.select(dateSelectArg()); });
        expect(newEvent).not.toHaveBeenCalled();
    });

    it("aborts selection when there is no resolvable start date", async () => {
        const note = buildNote({ id: "noStart", title: "N" });
        await renderCalendar({ note });
        await act(async () => {
            await calendarState.props?.select({ start: null, end: null, allDay: true } as any);
        });
        expect(dialog.prompt).not.toHaveBeenCalled();
        expect(newEvent).not.toHaveBeenCalled();
    });

    it("persists date changes via changeEvent when an event is moved", async () => {
        const moved = buildNote({ id: "movedNote", title: "Moved" });
        const note = buildNote({ id: "ecRoot", title: "Root" });
        await renderCalendar({ note });
        const event = {
            start: new Date("2026-06-10T00:00:00Z"),
            end: new Date("2026-06-12T00:00:00Z"),
            allDay: true,
            extendedProps: { noteId: "movedNote" }
        };
        const oldEvent = {
            start: new Date("2026-06-01T00:00:00Z"),
            end: new Date("2026-06-03T00:00:00Z"),
            allDay: true
        };
        await act(async () => {
            await calendarState.props?.eventChange({ event, oldEvent } as any);
        });
        expect(changeEvent).toHaveBeenCalledTimes(1);
        expect((changeEvent as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(moved);
    });

    it("skips changeEvent when no dates actually changed", async () => {
        const note = buildNote({ id: "ncRoot", title: "Root" });
        await renderCalendar({ note });
        const same = {
            start: new Date("2026-06-10T00:00:00Z"),
            end: new Date("2026-06-12T00:00:00Z"),
            allDay: true,
            extendedProps: { noteId: "anything" }
        };
        await act(async () => {
            await calendarState.props?.eventChange({ event: same, oldEvent: { ...same } } as any);
        });
        expect(changeEvent).not.toHaveBeenCalled();
    });

    it("persists when only the all-day flag changed (same start/end)", async () => {
        const moved = buildNote({ id: "allDayNote", title: "AllDay" });
        const note = buildNote({ id: "adRoot", title: "Root" });
        await renderCalendar({ note });
        const start = new Date("2026-09-01T00:00:00Z");
        const end = new Date("2026-09-02T00:00:00Z");
        const event = { start, end, allDay: false, extendedProps: { noteId: "allDayNote" } };
        const oldEvent = { start, end, allDay: true };
        await act(async () => { await calendarState.props?.eventChange({ event, oldEvent } as any); });
        expect(changeEvent).toHaveBeenCalledTimes(1);
        expect((changeEvent as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(moved);
    });

    it("skips changeEvent when the moved event's note cannot be resolved", async () => {
        const note = buildNote({ id: "mcRoot", title: "Root" });
        await renderCalendar({ note });
        vi.spyOn(froca, "getNote").mockResolvedValue(undefined as never);
        const event = {
            start: new Date("2026-07-10T00:00:00Z"),
            end: new Date("2026-07-12T00:00:00Z"),
            allDay: true,
            extendedProps: { noteId: "ghost" }
        };
        const oldEvent = { start: new Date("2026-07-01T00:00:00Z"), end: new Date("2026-07-03T00:00:00Z"), allDay: true };
        await act(async () => { await calendarState.props?.eventChange({ event, oldEvent } as any); });
        expect(changeEvent).not.toHaveBeenCalled();
    });

    it("opens a day note in a popup on dateClick for a calendar root", async () => {
        const dayNote = buildNote({ id: "dayNote", title: "Day" });
        (date_notes.getDayNote as ReturnType<typeof vi.fn>).mockResolvedValue(dayNote);
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockImplementation(() => undefined as never);
        const note = buildNote({ id: "dcRoot", title: "Root", "#calendarRoot": "true" });
        await renderCalendar({ note });
        await act(async () => { await calendarState.props?.dateClick({ dateStr: "2026-08-01" } as any); });
        expect(date_notes.getDayNote).toHaveBeenCalledWith("2026-08-01", "dcRoot");
        expect(triggerCommand).toHaveBeenCalledWith("openInPopup", { noteIdOrPath: "dayNote" });
    });

    it("does nothing on dateClick when no day note is returned", async () => {
        (date_notes.getDayNote as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockImplementation(() => undefined as never);
        const note = buildNote({ id: "dcEmpty", title: "Root", "#calendarRoot": "true" });
        await renderCalendar({ note });
        await act(async () => { await calendarState.props?.dateClick({ dateStr: "2026-08-02" } as any); });
        expect(triggerCommand).not.toHaveBeenCalled();
    });
});

describe("CalendarView - viewDidMount / spaced view persistence", () => {
    it("schedules a save of the active view when it differs from the initial view", async () => {
        const note = buildNote({ id: "vdmNote", title: "V" });
        await renderCalendar({ note });
        await act(async () => {
            calendarState.props?.viewDidMount({ view: { type: "timeGridWeek" } });
            // allow the spaced update (default delay) to flush
            await new Promise((r) => setTimeout(r, 1100));
        });
        expect(server.put).toHaveBeenCalled();
    });

    it("does not schedule a save when the mounted view equals the initial view", async () => {
        const note = buildNote({ id: "vdmSame", title: "V", "#calendar:view": "dayGridMonth" });
        await renderCalendar({ note });
        await act(async () => {
            calendarState.props?.viewDidMount({ view: { type: "dayGridMonth" } });
            await new Promise((r) => setTimeout(r, 50));
        });
        expect(server.put).not.toHaveBeenCalled();
    });
});

describe("CalendarView - event display customization (eventDidMount)", () => {
    beforeEach(() => {
        // The mounted-event handler resolves froca.getNote(noteId) on click/contextmenu.
        buildNote({ id: "emNote", title: "Event" });
    });

    function eventMountArg(viewType: string, opts: { iconClass?: string; promoted?: [string, string][] } = {}) {
        const el = document.createElement("div");
        // Provide containers the code queries for, per view type.
        el.innerHTML = `
            <div class="fc-event-main">
                <div class="fc-event-title"></div>
            </div>
            <div class="fc-list-event-title"><a></a></div>`;
        return {
            el,
            view: { type: viewType },
            event: { extendedProps: { iconClass: opts.iconClass, promotedAttributes: opts.promoted, noteId: "emNote" } }
        } as any;
    }

    it("prepends the icon and appends promoted attributes for month view", async () => {
        const note = buildNote({ id: "emParent", title: "P" });
        await renderCalendar({ note });
        const arg = eventMountArg("dayGridMonth", {
            iconClass: "bx bx-star",
            promoted: [ [ "Priority", "High" ] ]
        });
        act(() => calendarState.props?.eventDidMount(arg));

        const title = arg.el.querySelector(".fc-event-title");
        expect(title?.querySelector("span.bx.bx-star")).toBeTruthy();
        expect(arg.el.dataset.noContextMenu).toBe("true");
        expect(arg.el.querySelector(".promoted-attribute-name")?.textContent).toBe("Priority");
        expect(arg.el.querySelector(".promoted-attribute-value")?.textContent).toBe("High");
    });

    it("targets the list-event containers for list view", async () => {
        const note = buildNote({ id: "emList", title: "P" });
        await renderCalendar({ note });
        const arg = eventMountArg("listMonth", {
            iconClass: "bx bx-flag",
            promoted: [ [ "Tag", "x" ] ]
        });
        act(() => calendarState.props?.eventDidMount(arg));
        expect(arg.el.querySelector(".fc-list-event-title a span.bx.bx-flag")).toBeTruthy();
        expect(arg.el.querySelector(".promoted-attribute")).toBeTruthy();
    });

    it("handles year view (no title container) and events without icon/attributes", async () => {
        const note = buildNote({ id: "emYear", title: "P" });
        await renderCalendar({ note });
        const arg = eventMountArg("multiMonthYear", { iconClass: "bx bx-cog", promoted: [ [ "A", "B" ] ] });
        act(() => calendarState.props?.eventDidMount(arg));
        // No fc-event-title/list container is selected for year view → no icon span inserted there.
        expect(arg.el.querySelector(".fc-event-title span.bx")).toBeNull();
        expect(arg.el.dataset.noContextMenu).toBe("true");

        const plain = eventMountArg("dayGridMonth");
        act(() => calendarState.props?.eventDidMount(plain));
        expect(plain.el.dataset.noContextMenu).toBe("true");
    });

    it("registers a contextmenu handler on desktop that opens the calendar context menu", async () => {
        const note = buildNote({ id: "cmDesktopParent", title: "P" });
        buildNote({ id: "emNote", title: "Event" });
        await renderCalendar({ note });
        const arg = eventMountArg("dayGridMonth");
        act(() => calendarState.props?.eventDidMount(arg));

        await act(async () => {
            arg.el.dispatchEvent(new Event("contextmenu", { bubbles: true }));
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(openCalendarContextMenu).toHaveBeenCalledTimes(1);
    });

    it("registers a click handler on mobile that opens the calendar context menu", async () => {
        mobileHolder.value = true;
        const note = buildNote({ id: "cmMobileParent", title: "P" });
        await renderCalendar({ note });
        const arg = eventMountArg("dayGridMonth");
        act(() => calendarState.props?.eventDidMount(arg));

        await act(async () => {
            arg.el.dispatchEvent(new Event("click", { bubbles: true }));
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(openCalendarContextMenu).toHaveBeenCalledTimes(1);
    });

    it("does not open the menu when the event's note cannot be resolved", async () => {
        const note = buildNote({ id: "cmMissingParent", title: "P" });
        await renderCalendar({ note });
        const arg = eventMountArg("dayGridMonth");
        // Point the handler at a note that is not in froca.
        arg.event.extendedProps.noteId = "ghostNote";
        vi.spyOn(froca, "getNote").mockResolvedValue(undefined as never);
        act(() => calendarState.props?.eventDidMount(arg));

        await act(async () => {
            arg.el.dispatchEvent(new Event("contextmenu", { bubbles: true }));
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(openCalendarContextMenu).not.toHaveBeenCalled();
    });
});

describe("CalendarView - collection properties & view switchers", () => {
    it("renders navigation buttons and the desktop view switcher on desktop", async () => {
        const note = buildNote({ id: "cpDesktop", title: "Root" });
        const root = await renderCalendar({ note });

        const btnGroup = root.querySelector(".btn-group");
        expect(btnGroup).toBeTruthy();
        // One button per supported calendar view.
        const switcherButtons = btnGroup?.querySelectorAll("button") ?? [];
        expect(switcherButtons.length).toBe(4);

        // Clicking prev/next/today drives the calendar API.
        const api = calendarState.api;
        const center = root.querySelector(".collection-properties-mock .center");
        const navButtons = Array.from(center?.querySelectorAll("button") ?? []);
        // Center holds: prev (ActionButton), next (ActionButton), today (Button).
        navButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        navButtons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        navButtons[2]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(api.prev).toHaveBeenCalled();
        expect(api.next).toHaveBeenCalled();
        expect(api.today).toHaveBeenCalled();

        // Active view button reflects the current view type (dayGridMonth from the fake api).
        const activeButton = Array.from(switcherButtons).find((b) => b.className.includes("active"));
        expect(activeButton).toBeTruthy();
    });

    it("changes the view when a desktop switcher button is clicked", async () => {
        const note = buildNote({ id: "cpChange", title: "Root" });
        const root = await renderCalendar({ note });
        const api = calendarState.api;
        const switcherButtons = root.querySelectorAll(".btn-group button");
        const weekButton = Array.from(switcherButtons).find((b) => !b.className.includes("active"));
        weekButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(api.changeView).toHaveBeenCalled();
    });

    it("renders the mobile dropdown switcher (no desktop button group) on mobile and changes view on item click", async () => {
        mobileHolder.value = true;
        const note = buildNote({ id: "cpMobile", title: "Root" });
        const root = await renderCalendar({ note });
        const api = calendarState.api;
        expect(root.querySelector(".btn-group")).toBeNull();
        // The mobile switcher uses a Dropdown (which renders a dropdown container).
        const dropdown = root.querySelector(".dropdown");
        expect(dropdown).toBeTruthy();

        // Open the dropdown so its FormListItems render (Bootstrap toggles via show.bs.dropdown).
        act(() => { $(dropdown as Element).trigger("show.bs.dropdown"); });
        const items = root.querySelectorAll(".dropdown-item");
        expect(items.length).toBe(4);
        // Click a non-selected item to drive changeView.
        const target = Array.from(items).find((i) => !i.className.includes("selected")) ?? items[0];
        target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(api.changeView).toHaveBeenCalled();
    });

    it("reflects the calendar title and reacts to datesSet emissions", async () => {
        const note = buildNote({ id: "titleSet", title: "Root" });
        const root = await renderCalendar({ note });
        const api = calendarState.api;
        const titleEl = root.querySelector(".collection-properties-mock .title");
        expect(titleEl?.textContent).toBe("June 2026");

        act(() => {
            api.view.title = "July 2026";
            api.view.type = "timeGridWeek";
            api.emit("datesSet");
        });
        expect(root.querySelector(".collection-properties-mock .title")?.textContent).toBe("July 2026");
    });
});

describe("CalendarView - locale handling", () => {
    it("exposes a static locale mapping table with the expected keys", () => {
        expect(LOCALE_MAPPINGS.en).toBeNull();
        expect(LOCALE_MAPPINGS.ga).toBeNull();
        expect(LOCALE_MAPPINGS.en_rtl).toBeNull();
        expect(typeof LOCALE_MAPPINGS.de).toBe("function");
        expect(typeof LOCALE_MAPPINGS.ro).toBe("function");
    });

    it("each non-null locale mapping resolves to a loadable locale module", async () => {
        const loaders = Object.values(LOCALE_MAPPINGS).filter((fn) => fn !== null);
        const modules = await Promise.all(loaders.map((fn) => fn()));
        for (const mod of modules) {
            expect(mod.default).toBeDefined();
        }
    });

    it("loads a non-English formatting locale and passes it to the calendar", async () => {
        options.load({ locale: "en", formattingLocale: "de", firstDayOfWeek: "0" } as Record<OptionNames, string>);
        const note = buildNote({ id: "localeNote", title: "L" });
        await renderCalendar({ note });
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        // The German locale module resolves to an object that is handed to the calendar.
        expect(calendarState.props?.locale).toBeDefined();
    });

    it("leaves the locale undefined when both option locales have no mapping", async () => {
        options.load({ locale: "en", formattingLocale: "en", firstDayOfWeek: "0" } as Record<OptionNames, string>);
        const note = buildNote({ id: "enLocale", title: "L" });
        await renderCalendar({ note });
        expect(calendarState.props?.locale).toBeUndefined();
    });
});
