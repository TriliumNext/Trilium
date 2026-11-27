import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as cls from "./context.js";
import { addDeviceRecordEntries, isTimeAheadForADay, readDeviceRecord } from "./device_records.js";
import optionService from "./options.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-26T12:00:00.000Z");

function setRaw(name: "startupRepairRecord" | "clockAheadMarks", value: string) {
    cls.init(() => optionService.setOption(name, value));
}

describe("device records", () => {
    // The start of the fixture can have recorded repaired options.
    beforeEach(() => setRaw("startupRepairRecord", ""));

    afterEach(() => {
        setRaw("startupRepairRecord", "");
        setRaw("clockAheadMarks", "");
    });

    it("reads no entries from an empty, unreadable or lapsed record", () => {
        expect(readDeviceRecord("startupRepairRecord")).toEqual([]);

        setRaw("startupRepairRecord", "{not json");
        expect(readDeviceRecord("startupRepairRecord")).toEqual([]);

        setRaw("startupRepairRecord", JSON.stringify({ name: "x" }));
        expect(readDeviceRecord("startupRepairRecord")).toEqual([]);

        const entries = [ { name: "mfaMethod", count: 1, lastAt: "2026-08-01 12:00:00.000Z" } ];
        setRaw("startupRepairRecord", JSON.stringify(entries));
        expect(readDeviceRecord("startupRepairRecord", Date.parse("2026-10-01T12:00:00.000Z")))
            .toEqual(entries);
        expect(readDeviceRecord("startupRepairRecord", Date.parse("2026-11-01T12:00:00.000Z")))
            .toEqual([]);
    });

    it("counts a name once more, dated now, and writes nothing for no names", () => {
        cls.init(() => addDeviceRecordEntries("startupRepairRecord", []));
        expect(optionService.getOption("startupRepairRecord")).toBe("");

        cls.init(() => addDeviceRecordEntries(
            "startupRepairRecord", [ "mfaMethod", "syncServerHost" ]));
        cls.init(() => addDeviceRecordEntries("startupRepairRecord", [ "mfaMethod" ]));

        const record = readDeviceRecord("startupRepairRecord");
        expect(record.map(({ name, count }) => ({ name, count })))
            .toEqual([ { name: "mfaMethod", count: 2 }, { name: "syncServerHost", count: 1 } ]);
        expect(Date.now() - Date.parse(record[0].lastAt)).toBeLessThan(60 * 1000);
    });
});

describe("isTimeAheadForADay", () => {
    afterEach(() => setRaw("clockAheadMarks", ""));

    const judge = (storedTime: number, now: number) =>
        cls.init(() => isTimeAheadForADay("lastDailyBackupDate", storedTime, now));
    const marks = () => JSON.parse(optionService.getOption("clockAheadMarks") || "{}");

    it("marks a time first found ahead, and calls it wrong once it stays ahead for a day", () => {
        const ahead = NOW + 365 * DAY;

        expect(judge(ahead, NOW)).toBe(false);
        expect(marks()).toEqual({ lastDailyBackupDate: "2026-11-26 12:00:00.000Z" });

        expect(judge(ahead, NOW + DAY - 1)).toBe(false);
        expect(judge(ahead, NOW + DAY)).toBe(true);
        expect(marks()).toEqual({});
    });

    it("clears the mark once the time is no longer ahead, and writes nothing if unmarked", () => {
        expect(judge(NOW - DAY, NOW)).toBe(false);
        expect(optionService.getOption("clockAheadMarks")).toBe("");

        expect(judge(NOW + 60 * 1000, NOW)).toBe(false);
        expect(judge(NOW + 60 * 1000, NOW + 2 * 60 * 1000)).toBe(false);
        expect(marks()).toEqual({});
    });

    it("counts a mark a clock ahead wrote as now, and an unreadable set of marks as none", () => {
        setRaw("clockAheadMarks",
            JSON.stringify({ lastDailyBackupDate: "2027-11-26 12:00:00.000Z" }));
        expect(judge(NOW + 400 * DAY, NOW)).toBe(false);
        expect(marks()).toEqual({ lastDailyBackupDate: "2026-11-26 12:00:00.000Z" });

        setRaw("clockAheadMarks", "[]");
        expect(judge(NOW + 400 * DAY, NOW)).toBe(false);
        expect(marks()).toEqual({ lastDailyBackupDate: "2026-11-26 12:00:00.000Z" });
    });

    it("takes a time that cannot be read as not ahead, and clears its mark", () => {
        expect([ judge(Number.NaN, NOW), optionService.getOption("clockAheadMarks") ])
            .toEqual([ false, "" ]);

        setRaw("clockAheadMarks",
            JSON.stringify({ lastDailyBackupDate: "2026-11-25 12:00:00.000Z" }));
        expect([ judge(Number.NaN, NOW), marks() ]).toEqual([ false, {} ]);
    });
});
