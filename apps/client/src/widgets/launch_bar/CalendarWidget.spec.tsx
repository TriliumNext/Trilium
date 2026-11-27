import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import CalendarWidget from "./CalendarWidget";

const mocks = vi.hoisted(() => ({ dropdownLoaded: false, shownCounts: [] as number[] }));

vi.mock("./CalendarDropdown", () => {
    mocks.dropdownLoaded = true;
    return {
        default: ({ shownCount }: { shownCount: number }) => {
            mocks.shownCounts.push(shownCount);
            return <div className="calendar-dropdown-stub" />;
        }
    };
});

describe("CalendarWidget", () => {
    it("loads the calendar once its dropdown is first shown, and tells it of every opening", async () => {
        const launcherNote = buildNote({ id: "_lbCalendar", title: "Calendar", type: "launcher" });
        const container = renderInto(<CalendarWidget launcherNote={launcherNote} />);
        const toggle = container.querySelector<HTMLElement>(".right-dropdown-button");
        expect(toggle).not.toBeNull();
        await act(async () => { await new Promise((resolve) => setTimeout(resolve)); });
        expect(mocks.dropdownLoaded).toBe(false);

        const open = async () => {
            await act(async () => {
                toggle?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
                toggle?.click();
                await Promise.resolve();
            });
        };
        await open();
        await vi.waitFor(() => expect(document.querySelector(".calendar-dropdown-stub")).not.toBeNull());
        expect(mocks.dropdownLoaded).toBe(true);
        expect(mocks.shownCounts.at(-1)).toBe(1);

        // Closing and opening again tells the calendar to go back to the active note's month.
        await open();
        await vi.waitFor(() => expect(document.querySelector(".calendar-dropdown-stub")).toBeNull());
        await open();
        await vi.waitFor(() => expect(mocks.shownCounts.at(-1)).toBe(2));
    });
});
