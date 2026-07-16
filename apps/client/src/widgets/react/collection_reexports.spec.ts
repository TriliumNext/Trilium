import { describe, expect, it } from "vitest";

// These modules exist only to re-export the generic collection wrappers from the reusable
// `widgets/react/` folder. Instantiating Tabulator / FullCalendar needs real layout (out of scope for
// happy-dom), so we verify the one thing these files are responsible for: that they forward the exact
// same component (and its props type) as the underlying implementation.
import Calendar from "./Calendar";
import CalendarImpl from "../collections/calendar/calendar";
import Table from "./Table";
import TableImpl from "../collections/table/tabulator";

describe("collection widget re-exports", () => {
    it("Table re-exports the Tabulator wrapper", () => {
        expect(Table).toBe(TableImpl);
    });

    it("Calendar re-exports the FullCalendar wrapper", () => {
        expect(Calendar).toBe(CalendarImpl);
    });
});
