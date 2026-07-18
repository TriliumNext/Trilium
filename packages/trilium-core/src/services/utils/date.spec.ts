import { describe, expect, it } from "vitest";

import * as cls from "../context.js";
import date from "./date.js";

describe("date utils", () => {
    describe("constants", () => {
        it("exposes the local and UTC date-time formats", () => {
            expect(date.LOCAL_DATETIME_FORMAT).toBe("YYYY-MM-DD HH:mm:ss.SSSZZ");
            expect(date.UTC_DATETIME_FORMAT).toBe("YYYY-MM-DD HH:mm:ssZ");
        });
    });

    describe("utcDateStr", () => {
        it("returns only the date portion of an ISO string", () => {
            const d = new Date("2023-08-21T23:38:51.110Z");
            expect(date.utcDateStr(d)).toBe("2023-08-21");
        });
    });

    describe("utcDateTimeStr", () => {
        it("replaces the ISO 'T' separator with a space", () => {
            const d = new Date("2023-08-21T23:38:51.110Z");
            expect(date.utcDateTimeStr(d)).toBe("2023-08-21 23:38:51.110Z");
        });
    });

    describe("utcNowDateTime", () => {
        it("produces a space-separated UTC string ending in Z", () => {
            const result = date.utcNowDateTime();
            expect(result).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/);
            // it should describe roughly the current moment
            expect(Math.abs(Date.parse(result.replace(" ", "T")) - Date.now())).toBeLessThan(5000);
        });
    });

    describe("parseDateTime", () => {
        it("round-trips a value produced by utcDateTimeStr", () => {
            const original = new Date("2023-08-21T23:38:51.110Z");
            const parsed = date.parseDateTime(date.utcDateTimeStr(original));
            expect(parsed.getTime()).toBe(original.getTime());
        });

        it("parses a plain ISO string treating it as GMT", () => {
            const parsed = date.parseDateTime("2020-01-02T03:04:05.000Z");
            expect(parsed.toISOString()).toBe("2020-01-02T03:04:05.000Z");
        });

        it("throws for an unparseable string", () => {
            // Date.parse() returns NaN (it does not throw), so parseDateTime detects
            // the NaN explicitly and raises a descriptive error.
            expect(() => date.parseDateTime("not-a-date")).toThrow("Can't parse date from 'not-a-date'");
        });
    });

    describe("parseLocalDate", () => {
        it("uses only the first 10 chars and anchors at local noon", () => {
            const parsed = date.parseLocalDate("2023-08-21 23:38:51.110+0200");
            expect(parsed.getFullYear()).toBe(2023);
            expect(parsed.getMonth()).toBe(7); // August (0-indexed)
            expect(parsed.getDate()).toBe(21);
            // parsed without a timezone => local time, anchored at 12:00:00
            expect(parsed.getHours()).toBe(12);
            expect(parsed.getMinutes()).toBe(0);
            expect(parsed.getSeconds()).toBe(0);
        });

        it("ignores the time component of the input entirely", () => {
            const a = date.parseLocalDate("2023-08-21 00:00:00.000+0000");
            const b = date.parseLocalDate("2023-08-21 23:59:59.999+0000");
            expect(a.getTime()).toBe(b.getTime());
        });
    });

    describe("getDateTimeForFile", () => {
        it("returns a colon-free 15-char timestamp suitable for filenames", () => {
            const result = date.getDateTimeForFile();
            expect(result).not.toContain(":");
            // YYYY-MM-DDTHHMMSS
            expect(result).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}$/);
        });
    });

    describe("validateLocalDateTime", () => {
        it("returns undefined for empty / nullish input", () => {
            expect(date.validateLocalDateTime("")).toBeUndefined();
            expect(date.validateLocalDateTime(null)).toBeUndefined();
            expect(date.validateLocalDateTime(undefined)).toBeUndefined();
        });

        it("returns undefined for a well-formed local date time", () => {
            expect(date.validateLocalDateTime("2023-08-21 23:38:51.110+0200")).toBeUndefined();
            expect(date.validateLocalDateTime("2023-08-21 23:38:51.110-0500")).toBeUndefined();
        });

        it("returns a format error message for malformed input", () => {
            // UTC "Z" form is not valid local form
            const utcForm = date.validateLocalDateTime("2023-08-21 23:38:51.110Z");
            expect(utcForm).toContain("Invalid local date time format");

            // missing milliseconds
            expect(date.validateLocalDateTime("2023-08-21 23:38:51+0200")).toContain(
                "Invalid local date time format"
            );

            // missing the offset sign/digits
            expect(date.validateLocalDateTime("2023-08-21 23:38:51.110")).toContain(
                "Invalid local date time format"
            );

            // entirely wrong shape
            expect(date.validateLocalDateTime("not a date")).toContain(
                "Invalid local date time format"
            );
        });

        it("rejects a value that matches the format but is not a real date", () => {
            // Passes the regex (right shape) but month 13 / impossible time => unparseable.
            expect(date.validateLocalDateTime("2023-13-45 99:99:99.999+0200")).toContain(
                "cannot be parsed"
            );
        });
    });

    describe("validateUtcDateTime", () => {
        it("returns undefined for empty / undefined input", () => {
            expect(date.validateUtcDateTime("")).toBeUndefined();
            expect(date.validateUtcDateTime(undefined)).toBeUndefined();
        });

        it("returns undefined for a well-formed UTC date time", () => {
            expect(date.validateUtcDateTime("2023-08-21 23:38:51.110Z")).toBeUndefined();
        });

        it("returns a format error message for malformed input", () => {
            // local offset form is not valid UTC form
            expect(date.validateUtcDateTime("2023-08-21 23:38:51.110+0200")).toContain(
                "Invalid UTC date time format"
            );

            // missing milliseconds
            expect(date.validateUtcDateTime("2023-08-21 23:38:51Z")).toContain(
                "Invalid UTC date time format"
            );

            // entirely wrong shape
            expect(date.validateUtcDateTime("garbage")).toContain("Invalid UTC date time format");
        });

        it("rejects a value that matches the format but is not a real date", () => {
            // Passes the regex (right shape) but month 13 / impossible time => unparseable.
            expect(date.validateUtcDateTime("2023-13-45 99:99:99.999Z")).toContain("cannot be parsed");
        });
    });

    describe("localNowDateTime", () => {
        it("falls back to the current local time when no CLS value is set", () => {
            // Run inside a fresh context that does NOT set "localNowDateTime" so the fallback
            // path runs deterministically. Relying on the absence of any active context is fragile:
            // the standalone provider defers context cleanup ~1s, so a value set by a preceding
            // test would otherwise leak in and be returned verbatim instead of the live fallback.
            const result = cls.init(() => date.localNowDateTime());
            expect(result).toMatch(
                /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}[+-][0-9]{4}$/
            );
        });

        it("returns the CLS-provided value verbatim when present", () => {
            const stored = "2023-08-21 23:38:51.110+0200";
            const result = cls.init(() => {
                cls.set("localNowDateTime", stored);
                return date.localNowDateTime();
            });
            expect(result).toBe(stored);
        });
    });

    describe("localNowDate", () => {
        it("derives today's date in YYYY-MM-DD form when no CLS value is set", () => {
            // Run inside a fresh context that does NOT set "localNowDateTime" so the fallback
            // path runs deterministically. Relying on the absence of any active context is fragile:
            // the standalone provider defers context cleanup ~1s, so a value set by a preceding
            // test would otherwise leak in and yield a stale date instead of today's date.
            const result = cls.init(() => date.localNowDate());
            expect(result).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);

            const now = new Date();
            const expected = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
            expect(result).toBe(expected);
        });

        it("extracts the date portion from the CLS value when present", () => {
            const result = cls.init(() => {
                cls.set("localNowDateTime", "2023-08-21 23:38:51.110+0200");
                return date.localNowDate();
            });
            expect(result).toBe("2023-08-21");
        });
    });
});
