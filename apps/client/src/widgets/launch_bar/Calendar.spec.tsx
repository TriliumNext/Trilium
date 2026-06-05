import { OptionNames } from "@triliumnext/commons";
import { dayjs } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import options from "../../services/options";
import server from "../../services/server";
import { ParentComponent } from "../react/react_utils";
import Calendar, { CalendarArgs, getMonthInformation } from "./Calendar";

// --- Shared helpers -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let currentParent: Component | undefined;

/** Renders the Calendar inside the real ParentComponent provider (so the option hooks register). */
async function renderCalendar(args: CalendarArgs) {
    const localContainer = document.createElement("div");
    container = localContainer;
    document.body.appendChild(localContainer);
    const localParent = new Component();
    currentParent = localParent;
    await act(async () => {
        render(
            <ParentComponent.Provider value={localParent}>
                <Calendar {...args} />
            </ParentComponent.Provider>,
            localContainer
        );
    });
    // The month sub-components fetch notes-for-month in a useEffect; settle that microtask chain.
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return container;
}

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

function defaultArgs(overrides: Partial<CalendarArgs> = {}): CalendarArgs {
    return {
        date: dayjs("2026-02-01T12:00:00"),
        todaysDate: dayjs("2026-02-15T12:00:00"),
        activeDate: dayjs("2026-02-10T12:00:00"),
        onDateClicked: vi.fn(),
        weekNotes: [],
        ...overrides
    };
}

beforeEach(() => {
    setOptions({
        firstDayOfWeek: "1",
        firstWeekOfYear: "0",
        minDaysInFirstWeek: "4"
    });
    // The auto-mocked server only knows a few URLs; make notes-for-month return nothing by default.
    Object.assign(server, { get: vi.fn(async () => ({})) });
});

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    if (currentParent) {
        currentParent = undefined;
    }
    vi.restoreAllMocks();
});

// --- Rendering ------------------------------------------------------------------------------------

describe("Calendar", () => {
    it("renders the week header with a leading blank and 7 weekday cells", async () => {
        const el = await renderCalendar(defaultArgs());
        const header = el.querySelector(".calendar-week");
        expect(header).not.toBeNull();
        const spans = header?.querySelectorAll("span") ?? [];
        // 7 weekday labels + 1 leading blank (week-number column placeholder).
        expect(spans.length).toBe(8);
        // First cell is the empty placeholder.
        expect(spans[0]?.textContent).toBe("");
    });

    it("renders the calendar body with day cells covering the whole month", async () => {
        const el = await renderCalendar(defaultArgs());
        const body = el.querySelector(".calendar-body");
        expect(body?.getAttribute("data-calendar-area")).toBe("month");

        const days = el.querySelectorAll("a.calendar-date[data-calendar-date]");
        // February 2026 has 28 days; previous/next padding adds more, so at least 28.
        expect(days.length).toBeGreaterThanOrEqual(28);

        // Every day in the current month must be present.
        const renderedDates = Array.from(days).map((a) => a.getAttribute("data-calendar-date"));
        expect(renderedDates).toContain("2026-02-01");
        expect(renderedDates).toContain("2026-02-28");
    });

    it("marks today and the active date with the appropriate classes", async () => {
        const el = await renderCalendar(defaultArgs());
        const today = el.querySelector('[data-calendar-date="2026-02-15"]');
        const active = el.querySelector('[data-calendar-date="2026-02-10"]');
        expect(today?.className).toContain("calendar-date-today");
        expect(active?.className).toContain("calendar-date-active");
    });

    it("fires onDateClicked with the clicked date string", async () => {
        const onDateClicked = vi.fn();
        const el = await renderCalendar(defaultArgs({ onDateClicked }));
        const day = el.querySelector('[data-calendar-date="2026-02-10"]');
        expect(day).not.toBeNull();
        (day as HTMLAnchorElement).click();
        expect(onDateClicked).toHaveBeenCalledTimes(1);
        expect(onDateClicked.mock.calls[0]?.[0]).toBe("2026-02-10");
    });

    it("does not render previous-month padding when the month starts on the first day of week", async () => {
        // June 2025 starts on a Sunday. With firstDayOfWeek = Sunday (raw 0 -> ISO 7), no prev padding.
        setOptions({ firstDayOfWeek: "0", firstWeekOfYear: "0", minDaysInFirstWeek: "4" });
        const el = await renderCalendar(
            defaultArgs({
                date: dayjs("2025-06-01T12:00:00"),
                todaysDate: dayjs("2025-06-15T12:00:00"),
                activeDate: null
            })
        );
        expect(el.querySelector(".calendar-date-prev-month")).toBeNull();
    });

    it("renders previous- and next-month padding cells when the month does not align to the week", async () => {
        // February 2026 starts on a Sunday (ISO 7); with Monday-start there is leading padding.
        const el = await renderCalendar(defaultArgs());
        expect(el.querySelector(".calendar-date-prev-month")).not.toBeNull();
        expect(el.querySelector(".calendar-date-next-month")).not.toBeNull();
    });

    it("applies calendar-date-exists when the server reports a note for that day", async () => {
        // notes-for-month returns a note id keyed by the YYYY-MM-DD of a current-month day.
        Object.assign(server, {
            get: vi.fn(async (url: string) => {
                if (url === "special-notes/notes-for-month/2026-02") {
                    return { "2026-02-12": "abc123" };
                }
                return {};
            })
        });
        const el = await renderCalendar(defaultArgs());
        const day = el.querySelector('[data-calendar-date="2026-02-12"]');
        expect(day?.className).toContain("calendar-date-exists");
        expect(day?.getAttribute("data-href")).toBe("#root/abc123");
    });

    it("renders disabled week-number spans when onWeekClicked is not provided", async () => {
        const el = await renderCalendar(defaultArgs());
        const weekSpans = el.querySelectorAll("span.calendar-week-number-disabled");
        expect(weekSpans.length).toBeGreaterThan(0);
        // Without a week handler there must be no week-number anchors.
        expect(el.querySelector("a.calendar-week-number")).toBeNull();
    });

    it("renders clickable week-number anchors and fires onWeekClicked when handler given", async () => {
        const onWeekClicked = vi.fn();
        const el = await renderCalendar(
            defaultArgs({ onWeekClicked, weekNotes: [] })
        );
        const weekAnchor = el.querySelector("a.calendar-week-number");
        expect(weekAnchor).not.toBeNull();
        (weekAnchor as HTMLAnchorElement).click();
        expect(onWeekClicked).toHaveBeenCalledTimes(1);
        // The first argument is a YYYY-Www string.
        expect(onWeekClicked.mock.calls[0]?.[0]).toMatch(/^\d{4}-W\d{2}$/);
    });

    it("marks a week as existing when its week string is in weekNotes", async () => {
        const onWeekClicked = vi.fn();
        // Compute the week string of the first current-month week to pass it in weekNotes.
        const settings = { firstDayOfWeek: 1, firstWeekOfYear: 0, minDaysInFirstWeek: 4 };
        const { getWeekInfo } = await import("@triliumnext/commons");
        const { weekYear, weekNumber } = getWeekInfo(dayjs("2026-02-02T12:00:00"), settings);
        const weekString = `${weekYear}-W${String(weekNumber).padStart(2, "0")}`;

        const el = await renderCalendar(defaultArgs({ onWeekClicked, weekNotes: [weekString] }));
        const existing = el.querySelector("a.calendar-week-number.calendar-date-exists");
        expect(existing).not.toBeNull();
    });

    it("falls back to default week settings when option values are missing (NaN)", async () => {
        // Empty options -> parseInt -> NaN for firstWeekOfYear/minDaysInFirstWeek -> use ?? fallbacks.
        setOptions({ firstDayOfWeek: "1" });
        const el = await renderCalendar(
            defaultArgs({
                date: dayjs("2026-02-01T12:00:00"),
                activeDate: null
            })
        );
        // Still renders a full month.
        const days = el.querySelectorAll("a.calendar-date[data-calendar-date]");
        expect(days.length).toBeGreaterThanOrEqual(28);
    });
});

// --- Pure helper ----------------------------------------------------------------------------------

describe("getMonthInformation", () => {
    const settings = { firstDayOfWeek: 1, firstWeekOfYear: 0, minDaysInFirstWeek: 4 };

    it("computes leading previous-month days for a month not starting on the week start", () => {
        // February 2026: 1st is Sunday (ISO 7). With Monday start, 6 prev-month days lead in.
        const info = getMonthInformation(dayjs("2026-02-01T12:00:00"), 7, settings);
        expect(info.prevMonth.dates.length).toBe(6);
        expect(info.prevMonth.weekNumbers.length).toBe(1);
        expect(info.prevMonth.weekYears.length).toBe(1);
        // Trailing dates lead up to (but not including) the 1st.
        const last = info.prevMonth.dates[info.prevMonth.dates.length - 1];
        expect(last?.format("YYYY-MM-DD")).toBe("2026-01-31");
    });

    it("returns no previous-month days when the month already starts on the week start", () => {
        // June 2025 starts Sunday; with Sunday start (firstDayOfWeek 7), firstDayISO == firstDayOfWeek.
        const sundayStart = { firstDayOfWeek: 7, firstWeekOfYear: 0, minDaysInFirstWeek: 4 };
        const info = getMonthInformation(dayjs("2025-06-01T12:00:00"), 7, sundayStart);
        expect(info.prevMonth.dates.length).toBe(0);
    });

    it("computes trailing next-month days needed to complete the final week", () => {
        // February 2026 ends Saturday (ISO 6). With a Monday->Sunday week, Sunday Mar 1 is appended.
        const info = getMonthInformation(dayjs("2026-02-01T12:00:00"), 7, settings);
        expect(info.nextMonth.dates.length).toBe(1);
        expect(info.nextMonth.dates[0]?.format("YYYY-MM-DD")).toBe("2026-03-01");
    });

    it("returns no next-month days when the month ends exactly on the week end", () => {
        // Choose a month/week alignment where the last day is the last day of the user week.
        // January 2026 ends on Saturday (ISO 6); with Sunday-start weeks the user week ends Saturday.
        const sundayStart = { firstDayOfWeek: 7, firstWeekOfYear: 0, minDaysInFirstWeek: 4 };
        const info = getMonthInformation(dayjs("2026-01-01T12:00:00"), 4, sundayStart);
        expect(info.nextMonth.dates.length).toBe(0);
    });
});
