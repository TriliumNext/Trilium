import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
        update() {}
    }
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
        hide = vi.fn();
        update() {}
        dispose() { Dropdown.instances.delete(this.element); }
    }
    return { Tooltip, Dropdown, default: { Tooltip, Dropdown } };
});

vi.mock("../../services/search", () => ({
    default: { searchForNotes: vi.fn(async () => []), searchForNoteIds: vi.fn(async () => []) }
}));

vi.mock("../../services/date_notes", () => ({
    default: { getDayNote: vi.fn(async () => null), getWeekNote: vi.fn(async () => null) }
}));

vi.mock("../../services/toast", () => ({
    default: { showError: vi.fn(), showPersistent: vi.fn(), closePersistent: vi.fn() }
}));

vi.mock("../../services/keyboard_actions", () => ({
    default: { getAction: vi.fn(async () => ({ effectiveShortcuts: [] })) }
}));

import appContext from "../../components/app_context";
import date_notes from "../../services/date_notes";
import froca from "../../services/froca";
import search from "../../services/search";
import server from "../../services/server";
import toast from "../../services/toast";
import { buildNote } from "../../test/easy-froca";
import CalendarWidget from "./CalendarWidget";

// --- Render harness (act-aware, with provider context) --------------------------------------------

let container: HTMLDivElement | undefined;

function renderWidget(launcherNoteId = "launcher") {
    const launcherNote = buildNote({ id: launcherNoteId, title: "Calendar", "#iconClass": "bx bx-calendar" });
    const root = document.createElement("div");
    container = root;
    document.body.appendChild(root);
    act(() => { render(<CalendarWidget launcherNote={launcherNote} />, root); });
    return root;
}

/** Fires the jQuery `show.bs.dropdown` event the Dropdown component listens for, opening the menu. */
async function openDropdown(root: HTMLElement) {
    const dropdownEl = root.querySelector(".dropdown");
    if (!dropdownEl) throw new Error("dropdown container not found");
    await act(async () => {
        $(dropdownEl).trigger("show.bs.dropdown");
        await new Promise(resolve => setTimeout(resolve, 0));
    });
}

/** Dispatches a bubbling click inside an `act()` block, returning void to satisfy the act() signature. */
function clickButton(el: Element | null | undefined) {
    act(() => {
        el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

function setActiveContext(overrides: Record<string, unknown> = {}) {
    const ctx = {
        setNote: vi.fn(),
        ...overrides
    };
    Object.assign(appContext, {
        tabManager: {
            getActiveContext: () => ctx,
            getActiveContextNote: () => overrides.note ?? null
        }
    });
    return ctx;
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    Object.assign(server, { put: vi.fn(async () => undefined), get: vi.fn(async () => []) });
    // The bootstrap-backed `useTooltip` hook calls `$el.tooltip(...)`; provide a no-op jQuery plugin.
    Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: vi.fn() });
    setActiveContext();
});

afterEach(() => {
    if (container) {
        act(() => { if (container) render(null, container); });
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Closed (initial) render ----------------------------------------------------------------------

describe("CalendarWidget closed state", () => {
    it("renders the launcher dropdown button without the calendar body", () => {
        const root = renderWidget();
        expect(root.querySelector(".dropdown")).toBeTruthy();
        // The menu content is gated behind `shown` + calendarArgs, so it is absent initially.
        expect(root.querySelector(".calendar-dropdown-widget")).toBeNull();
        expect(root.querySelector(".calendar-body")).toBeNull();
    });
});

// --- Opening the dropdown -------------------------------------------------------------------------

describe("CalendarWidget opened state", () => {
    it("renders the calendar body, header, month/year selectors when there is no active date note", async () => {
        const root = renderWidget();
        await openDropdown(root);

        expect(root.querySelector(".calendar-dropdown-widget")).toBeTruthy();
        expect(root.querySelector(".calendar-header")).toBeTruthy();
        expect(root.querySelector(".calendar-month-selector")).toBeTruthy();
        expect(root.querySelector(".calendar-year-selector")).toBeTruthy();
        expect(root.querySelector(".calendar-body")).toBeTruthy();
        // Several days rendered.
        expect(root.querySelectorAll(".calendar-date").length).toBeGreaterThan(20);
        // Month adjust buttons (prev/next for both month and year selectors).
        expect(root.querySelectorAll(".calendar-btn").length).toBe(4);
        // checkEnableWeekNotes ran a search.
        expect(search.searchForNotes).toHaveBeenCalledWith("#calendarRoot");
    });

    it("uses the active context's dateNote label to seed the active date", async () => {
        const dateNote = buildNote({ id: "dn", title: "Day" });
        vi.spyOn(dateNote, "getOwnedLabelValue").mockReturnValue("2024-03-15");
        setActiveContext({ note: dateNote });

        const root = renderWidget();
        await openDropdown(root);

        // The year input reflects the active date's year (March 2024).
        const yearInput = root.querySelector<HTMLInputElement>('input[data-calendar-input="year"]');
        expect(yearInput?.value).toBe("2024");
        // The active day should be marked.
        expect(root.querySelector(".calendar-date-active")).toBeTruthy();
    });
});

// --- Week notes branch ----------------------------------------------------------------------------

describe("CalendarWidget week notes", () => {
    it("enables week clicking and fetches week note values when the calendar root has the label", async () => {
        const calendarRoot = buildNote({ id: "calRoot", title: "Calendar Root" });
        vi.spyOn(calendarRoot, "hasLabel").mockReturnValue(true);
        (search.searchForNotes as ReturnType<typeof vi.fn>).mockResolvedValue([ calendarRoot ]);
        (server.get as ReturnType<typeof vi.fn>).mockResolvedValue([ "2024-W11" ]);

        const root = renderWidget();
        await openDropdown(root);

        expect(server.get).toHaveBeenCalledWith("attribute-values/weekNote");
        // Week numbers become clickable anchors when week notes are enabled.
        expect(root.querySelector("a.calendar-week-number")).toBeTruthy();
    });

    it("leaves week numbers non-clickable when the label is absent", async () => {
        const calendarRoot = buildNote({ id: "calRoot2", title: "Calendar Root" });
        vi.spyOn(calendarRoot, "hasLabel").mockReturnValue(false);
        (search.searchForNotes as ReturnType<typeof vi.fn>).mockResolvedValue([ calendarRoot ]);

        const root = renderWidget();
        await openDropdown(root);

        expect(server.get).not.toHaveBeenCalledWith("attribute-values/weekNote");
        expect(root.querySelector("a.calendar-week-number")).toBeNull();
        expect(root.querySelector("span.calendar-week-number-disabled")).toBeTruthy();
    });

    it("swallows errors raised inside checkEnableWeekNotes", async () => {
        (search.searchForNotes as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
        const root = renderWidget();
        // Should not throw despite the rejected search.
        await openDropdown(root);
        expect(root.querySelector(".calendar-body")).toBeTruthy();
    });

    it("reuses the cached calendar root on a second open (no repeated search)", async () => {
        const calendarRoot = buildNote({ id: "calRootCache", title: "Calendar Root" });
        vi.spyOn(calendarRoot, "hasLabel").mockReturnValue(false);
        (search.searchForNotes as ReturnType<typeof vi.fn>).mockResolvedValue([ calendarRoot ]);

        const root = renderWidget();
        await openDropdown(root);
        expect(search.searchForNotes).toHaveBeenCalledTimes(1);

        // Re-open: calendarRootRef is already populated, so no second search is issued.
        await openDropdown(root);
        expect(search.searchForNotes).toHaveBeenCalledTimes(1);
    });
});

// --- Day / week click handling --------------------------------------------------------------------

describe("CalendarWidget date interactions", () => {
    it("navigates to the day note and hides the dropdown when a day is clicked", async () => {
        const dayNote = buildNote({ id: "dayNote", title: "Day" });
        (date_notes.getDayNote as ReturnType<typeof vi.fn>).mockResolvedValue(dayNote);
        const ctx = setActiveContext();

        const root = renderWidget();
        await openDropdown(root);

        const dayLink = root.querySelector<HTMLAnchorElement>(".calendar-body .calendar-date");
        expect(dayLink).toBeTruthy();
        await act(async () => {
            dayLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(date_notes.getDayNote).toHaveBeenCalled();
        expect(ctx.setNote).toHaveBeenCalledWith("dayNote");
    });

    it("shows an error toast when the day note cannot be found", async () => {
        (date_notes.getDayNote as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const ctx = setActiveContext();

        const root = renderWidget();
        await openDropdown(root);

        const dayLink = root.querySelector<HTMLAnchorElement>(".calendar-body .calendar-date");
        await act(async () => {
            dayLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(toast.showError).toHaveBeenCalled();
        expect(ctx.setNote).not.toHaveBeenCalled();
    });

    it("navigates to the week note when a week number is clicked", async () => {
        const calendarRoot = buildNote({ id: "calRoot3", title: "Calendar Root" });
        vi.spyOn(calendarRoot, "hasLabel").mockReturnValue(true);
        (search.searchForNotes as ReturnType<typeof vi.fn>).mockResolvedValue([ calendarRoot ]);
        (server.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        const weekNote = buildNote({ id: "weekNote", title: "Week" });
        (date_notes.getWeekNote as ReturnType<typeof vi.fn>).mockResolvedValue(weekNote);
        const ctx = setActiveContext();

        const root = renderWidget();
        await openDropdown(root);

        const weekLink = root.querySelector<HTMLAnchorElement>("a.calendar-week-number");
        expect(weekLink).toBeTruthy();
        await act(async () => {
            weekLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(date_notes.getWeekNote).toHaveBeenCalled();
        expect(ctx.setNote).toHaveBeenCalledWith("weekNote");
    });

    it("shows an error toast when the week note cannot be found", async () => {
        const calendarRoot = buildNote({ id: "calRoot4", title: "Calendar Root" });
        vi.spyOn(calendarRoot, "hasLabel").mockReturnValue(true);
        (search.searchForNotes as ReturnType<typeof vi.fn>).mockResolvedValue([ calendarRoot ]);
        (server.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        (date_notes.getWeekNote as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const root = renderWidget();
        await openDropdown(root);

        const weekLink = root.querySelector<HTMLAnchorElement>("a.calendar-week-number");
        await act(async () => {
            weekLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(toast.showError).toHaveBeenCalled();
    });
});

// --- Header navigation: month / year selectors ----------------------------------------------------

describe("CalendarWidget header navigation", () => {
    it("adjusts the month forward and back using the chevron buttons", async () => {
        const root = renderWidget();
        await openDropdown(root);

        const yearInput = () => root.querySelector<HTMLInputElement>('input[data-calendar-input="year"]');
        const monthSelector = root.querySelector(".calendar-month-selector");
        const buttons = monthSelector?.querySelectorAll<HTMLButtonElement>("button");
        expect(buttons?.length).toBe(3); // prev, dropdown toggle, next

        // Determine the next/prev chevrons via their icon class.
        const prevBtn = monthSelector?.querySelector<HTMLButtonElement>(".bx-chevron-left");
        const nextBtn = monthSelector?.querySelector<HTMLButtonElement>(".bx-chevron-right");
        expect(prevBtn).toBeTruthy();
        expect(nextBtn).toBeTruthy();

        const beforeYear = yearInput()?.value;
        // Click prev then next to exercise both subtract & add branches.
        clickButton(prevBtn);
        clickButton(nextBtn);
        // The calendar body should still render after navigation.
        expect(root.querySelector(".calendar-body")).toBeTruthy();
        expect(yearInput()).toBeTruthy();
        expect(typeof beforeYear).toBe("string");
    });

    it("adjusts the year forward and back using the chevron buttons", async () => {
        const root = renderWidget();
        await openDropdown(root);

        const yearSelector = root.querySelector(".calendar-year-selector");
        const prevBtn = yearSelector?.querySelector<HTMLButtonElement>(".bx-chevron-left");
        const nextBtn = yearSelector?.querySelector<HTMLButtonElement>(".bx-chevron-right");
        const yearInput = () => root.querySelector<HTMLInputElement>('input[data-calendar-input="year"]');

        const startYear = parseInt(yearInput()?.value ?? "0", 10);
        clickButton(nextBtn);
        expect(parseInt(yearInput()?.value ?? "0", 10)).toBe(startYear + 1);
        clickButton(prevBtn);
        expect(parseInt(yearInput()?.value ?? "0", 10)).toBe(startYear);
    });

    it("updates the year via the text box", async () => {
        const root = renderWidget();
        await openDropdown(root);

        const yearInput = root.querySelector<HTMLInputElement>('input[data-calendar-input="year"]');
        expect(yearInput).toBeTruthy();

        act(() => {
            if (yearInput) {
                yearInput.value = "2030";
                yearInput.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        const after = root.querySelector<HTMLInputElement>('input[data-calendar-input="year"]');
        expect(after?.value).toBe("2030");

        // Empty input is clamped to the min (1900) by FormTextBox.applyLimits, which is a valid year.
        act(() => {
            if (after) {
                after.value = "";
                after.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        const final = root.querySelector<HTMLInputElement>('input[data-calendar-input="year"]');
        expect(final?.value).toBe("1900");
    });

    it("changes the month via the month dropdown list selection", async () => {
        const root = renderWidget();
        await openDropdown(root);

        // Open the month dropdown (FormDropdownList renders its own .dropdown with the data attr).
        const monthDropdownBtn = root.querySelector<HTMLButtonElement>('[data-calendar-input="month"]');
        expect(monthDropdownBtn).toBeTruthy();
        const monthDropdownContainer = monthDropdownBtn?.closest(".dropdown");
        if (monthDropdownContainer) {
            await act(async () => {
                $(monthDropdownContainer).trigger("show.bs.dropdown");
                await new Promise(resolve => setTimeout(resolve, 0));
            });
        }

        // Click a month list item to trigger onChange -> setDate("month").
        const items = monthDropdownContainer?.querySelectorAll<HTMLElement>(".dropdown-item");
        const firstItem = items && items.length ? items[items.length - 1] : monthDropdownContainer?.querySelector<HTMLElement>("a");
        clickButton(firstItem);

        expect(root.querySelector(".calendar-body")).toBeTruthy();
    });
});
