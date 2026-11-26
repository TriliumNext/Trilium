/**
 * @module
 *
 * Records that a device keeps for its security records card, in device options that no route
 * writes: the options a start repaired, the sign-in attempts, and the marks of stored times that a
 * clock running ahead can have written.
 */
import type { DeviceRecordEntry } from "@triliumnext/commons";

import optionService from "./options.js";
import dateUtils from "./utils/date.js";

export type DeviceRecordOption = "startupRepairRecord" | "signInAttemptRecord";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A record is empty once its last entry is older than this. */
const RECORD_LAPSE_MS = 90 * DAY_MS;

/** Reads the entries of a record, or none once its last entry is older than 90 days. */
export function readDeviceRecord(
    option: DeviceRecordOption,
    now = Date.now()
): DeviceRecordEntry[] {
    const entries = parseJson(optionService.getOptionOrNull(option));
    if (!Array.isArray(entries)) {
        return [];
    }

    const lastAt = Math.max(...entries.map((entry: DeviceRecordEntry) => Date.parse(entry.lastAt)));
    return now - lastAt > RECORD_LAPSE_MS ? [] : entries;
}

/** Counts each name once more in a record, dated now. */
export function addDeviceRecordEntries(option: DeviceRecordOption, names: string[]) {
    if (names.length === 0) {
        return;
    }

    const entries = readDeviceRecord(option);
    const lastAt = dateUtils.utcNowDateTime();
    for (const name of names) {
        const entry = entries.find((existing) => existing.name === name);
        if (entry) {
            entry.count++;
            entry.lastAt = lastAt;
        } else {
            entries.push({ name, count: 1, lastAt });
        }
    }

    optionService.setOption(option, JSON.stringify(entries));
}

/**
 * Checks a stored time that a clock running ahead can have written. The first reader that finds it
 * later than now marks the time of that finding, and a reader that finds it no longer ahead clears
 * the mark. A mark later than now counts as now.
 *
 * @returns `true` once the time has stayed ahead for a day by this clock, when the caller resets
 *          and records it.
 */
export function isTimeAheadForADay(name: string, storedTime: number, now = Date.now()): boolean {
    const marks = readClockAheadMarks();
    const mark = marks[name];

    if (storedTime <= now) {
        if (mark !== undefined) {
            delete marks[name];
            writeClockAheadMarks(marks);
        }
        return false;
    }

    const markedAt = Math.min(mark === undefined ? now : Date.parse(mark), now);
    if (now - markedAt >= DAY_MS) {
        delete marks[name];
        writeClockAheadMarks(marks);
        return true;
    }

    const markValue = dateUtils.utcDateTimeStr(new Date(markedAt));
    if (mark !== markValue) {
        marks[name] = markValue;
        writeClockAheadMarks(marks);
    }
    return false;
}

function readClockAheadMarks(): Record<string, string> {
    const marks = parseJson(optionService.getOptionOrNull("clockAheadMarks"));
    return marks && typeof marks === "object" && !Array.isArray(marks) ? marks : {};
}

function writeClockAheadMarks(marks: Record<string, string>) {
    optionService.setOption("clockAheadMarks", JSON.stringify(marks));
}

function parseJson(value: string | null) {
    try {
        return JSON.parse(value || "null");
    } catch {
        return null;
    }
}
