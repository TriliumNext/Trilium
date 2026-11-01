import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import options from "../../services/options";
import server from "../../services/server";
import DatePicker, { type DatePickerProps } from "./DatePicker";
import Menu from "./Menu";

// i18next is never initialised under test, so `t` echoes the key it is given.
vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));

const host = document.createElement("div");
document.body.append(host);

beforeEach(() => {
    // A Wednesday.
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(2026, 9, 21, 12));
    options.load({ firstDayOfWeek: 1 } as Parameters<typeof options.load>[0]);
});

afterEach(() => {
    act(() => render(null, host));
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("DatePicker", () => {
    it("writes today, tomorrow and the first day of next week", () => {
        const { onChange } = renderPicker({ value: undefined });

        act(() => preset("date_picker.today")?.click());
        act(() => preset("date_picker.tomorrow")?.click());
        act(() => preset("date_picker.next-week")?.click());
        expect(onChange.mock.calls).toEqual([ [ "2026-10-21" ], [ "2026-10-22" ], [ "2026-10-26" ] ]);
        expect(preset("date_picker.clear")).toBeUndefined();
    });

    it("starts next week on the configured first day", () => {
        options.load({ firstDayOfWeek: 0 } as Parameters<typeof options.load>[0]);
        const { onChange } = renderPicker({ value: undefined });

        act(() => preset("date_picker.next-week")?.click());
        expect(onChange).toHaveBeenCalledWith("2026-10-25");
    });

    it("marks the preset the value matches", () => {
        renderPicker({ value: "2026-10-22" });

        expect(preset("date_picker.tomorrow")?.getAttribute("aria-pressed")).toBe("true");
        expect(preset("date_picker.today")?.getAttribute("aria-pressed")).toBe("false");
    });

    it("offers Clear only when told how to clear", () => {
        const onClear = vi.fn();
        renderPicker({ value: "2026-10-22", onClear });

        act(() => preset("date_picker.clear")?.click());
        expect(onClear).toHaveBeenCalled();
    });

    it("opens on the value's month with that day marked, and writes the day clicked", () => {
        const { onChange } = renderPicker({ value: "2026-03-14" });

        expect(day("2026-03-14")?.classList.contains("calendar-date-active")).toBe(true);
        expect(document.querySelector(".calendar-date-today")).toBeNull();

        act(() => day("2026-03-20")?.click());
        expect(onChange).toHaveBeenCalledWith("2026-03-20");
    });

    it("opens on this month without a value, and the arrows change the month", () => {
        renderPicker({ value: undefined });
        expect(day("2026-10-21")?.classList.contains("calendar-date-today")).toBe(true);
        expect(document.querySelector(".calendar-date-active")).toBeNull();

        const [ previous, next ] = document.querySelectorAll<HTMLButtonElement>(".calendar-btn");
        act(() => next?.click());
        expect(title()).toContain("2026");
        expect(day("2026-11-20")).toBeTruthy();
        act(() => previous?.click());
        act(() => previous?.click());
        expect(day("2026-09-20")).toBeTruthy();
    });

    it("reads no day notes", () => {
        const get = vi.spyOn(server, "get");
        renderPicker({ value: undefined });

        expect(get).not.toHaveBeenCalled();
    });

    it("puts low-profile buttons below the grid", () => {
        renderPicker({ value: undefined });

        expect(document.querySelector(".date-picker-grid ~ .date-picker-presets")).toBeTruthy();
        const today = preset("date_picker.today");
        expect(today?.classList.contains("tn-low-profile")).toBe(true);
        // The Next theme draws every `.btn-sm` as a command button, 120px wide.
        expect(today?.classList.contains("btn-sm")).toBe(false);
    });

    describe("from the keyboard", () => {
        it("moves across the buttons, and up into the grid on the value's day", () => {
            renderPicker({ value: "2026-10-14" });
            const today = preset("date_picker.today");
            expect(today?.tabIndex).toBe(0);
            today?.focus();

            press("ArrowRight");
            expect(document.activeElement).toBe(preset("date_picker.tomorrow"));
            expect(preset("date_picker.today")?.tabIndex).toBe(-1);

            press("ArrowUp");
            expect(document.activeElement).toBe(day("2026-10-14"));
        });

        it("moves by day, week and month, and down from the last week to the buttons", () => {
            renderPicker({ value: "2026-10-14" });
            preset("date_picker.today")?.focus();
            press("ArrowUp");

            press("ArrowRight");
            expect(document.activeElement).toBe(day("2026-10-15"));
            press("ArrowUp");
            expect(document.activeElement).toBe(day("2026-10-08"));
            press("PageDown");
            expect(document.activeElement).toBe(day("2026-11-08"));
            press("PageUp");
            press("PageUp");
            expect(document.activeElement).toBe(day("2026-09-08"));
            press("ArrowUp");
            press("ArrowUp");
            expect(document.activeElement).toBe(day("2026-08-25"));
            press("End");
            expect(document.activeElement).toBe(day("2026-08-30"));
            press("Home");
            expect(document.activeElement).toBe(day("2026-08-24"));

            // The grid of October 2026 ends on Sunday 1 November.
            press("PageDown");
            press("PageDown");
            press("ArrowDown");
            expect(document.activeElement).toBe(day("2026-10-31"));
            press("ArrowDown");
            expect(document.activeElement).toBe(preset("date_picker.today"));
        });

        it("writes the focused day on Enter", () => {
            const { onChange } = renderPicker({ value: "2026-10-14" });
            preset("date_picker.today")?.focus();
            press("ArrowUp");
            press("ArrowLeft");

            press("Enter");
            expect(onChange).toHaveBeenCalledWith("2026-10-13");
        });
    });

    describe("in a menu", () => {
        function renderInMenu() {
            const onChange = vi.fn();
            const onClose = vi.fn();
            act(() => render(
                <Menu
                    anchor={{ x: 0, y: 0 }}
                    items={[ {
                        kind: "custom",
                        componentFn: () => <DatePicker value="2026-10-14" onChange={onChange} />
                    } ]}
                    onClose={onClose}
                />, host));
            return { onChange, onClose };
        }

        it("closes the menu on a preset or a day, and keeps it open on the arrows", () => {
            const { onChange, onClose } = renderInMenu();

            act(() => document.querySelectorAll<HTMLButtonElement>(".calendar-btn")[1]?.click());
            expect(onClose).not.toHaveBeenCalled();

            act(() => day("2026-11-03")?.click());
            expect(onChange).toHaveBeenCalledWith("2026-11-03");
            expect(onClose).toHaveBeenCalledTimes(1);

            act(() => preset("date_picker.today")?.click());
            expect(onClose).toHaveBeenCalledTimes(2);
        });

        it("keeps Up and Down inside the grid, and closes the menu on Enter", () => {
            const { onChange, onClose } = renderInMenu();
            preset("date_picker.today")?.focus();

            press("ArrowUp");
            expect(document.activeElement).toBe(day("2026-10-14"));
            press("ArrowDown");
            expect(document.activeElement).toBe(day("2026-10-21"));
            press("ArrowUp");
            expect(document.activeElement).toBe(day("2026-10-14"));

            press("Enter");
            expect(onChange).toHaveBeenCalledWith("2026-10-14");
            expect(onClose).toHaveBeenCalled();
        });
    });
});

function renderPicker(props: Partial<DatePickerProps>) {
    const onChange = vi.fn();
    act(() => render(<DatePicker value={undefined} onChange={onChange} {...props} />, host));
    return { onChange };
}

/** Dispatches a key at the focused element, as a keypress would. */
function press(key: string) {
    const target = document.activeElement ?? document.body;
    act(() => {
        target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
}

function preset(title: string) {
    return [ ...document.querySelectorAll<HTMLButtonElement>(".date-picker-presets button") ]
        .find((button) => button.textContent?.trim() === title);
}

function day(date: string) {
    return document.querySelector<HTMLElement>(`[data-calendar-date="${date}"]`);
}

function title() {
    return document.querySelector(".date-picker-title")?.textContent ?? "";
}
