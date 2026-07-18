import { describe, expect, it, vi } from "vitest";

// i18next is not initialised here, so have t() echo the key and the interpolated count. That lets the
// tests assert exactly which unit was chosen and what count was computed — the real logic — while
// leaving the plural rendering itself to i18next.
vi.mock("../services/i18n", () => ({
    t: (key: string, opts?: { count?: number }) => `${key}|${opts?.count}`
}));

import options from "../services/options";
import { formatDateTime, formatDuration, normalizeLocale } from "./formatters";

describe("formatters", () => {
    it("tolerates incorrect locale", () => {
        options.set("formattingLocale", "cn_TW");

        expect(formatDateTime(new Date())).toBeTruthy();
        expect(formatDateTime(new Date(), "full", "none")).toBeTruthy();
        expect(formatDateTime(new Date(), "none", "full")).toBeTruthy();
    });

    it("falls back to the default locale when the configured locale is invalid", () => {
        // A syntactically invalid locale makes Intl throw, exercising the
        // catch fallback in each of the three formatting branches.
        options.set("formattingLocale", "!!!invalid!!!");

        expect(formatDateTime(new Date())).toBeTruthy();
        expect(formatDateTime(new Date(), "full", "none")).toBeTruthy();
        expect(formatDateTime(new Date(), "none", "full")).toBeTruthy();
    });

    it("normalizes locale", () => {
        expect(normalizeLocale("zh_CN")).toBe("zh-CN");
        expect(normalizeLocale("cn")).toBe("zh-CN");
        expect(normalizeLocale("tw")).toBe("zh-TW");
        // The default branch returns the (underscore-normalized) locale unchanged.
        expect(normalizeLocale("en_US")).toBe("en-US");
    });

    it("returns an empty string for falsy dates", () => {
        expect(formatDateTime(null)).toBe("");
        expect(formatDateTime(undefined)).toBe("");
        // 0 and "" are also falsy and short-circuit before parsing.
        expect(formatDateTime(0)).toBe("");
        expect(formatDateTime("")).toBe("");
    });

    it("parses string and number dates with a valid locale", () => {
        options.set("formattingLocale", "en-US");

        // Valid locale exercises the non-catch (success) Intl paths.
        expect(formatDateTime("2024-01-15T13:30:00Z")).toBeTruthy();
        expect(formatDateTime(Date.UTC(2024, 0, 15))).toBeTruthy();
        // Date-only and time-only success branches.
        expect(formatDateTime(new Date(), "full", "none")).toBeTruthy();
        expect(formatDateTime(new Date(), "none", "full")).toBeTruthy();
    });

    it("renders a date-only string as the same calendar day in any timezone", () => {
        // Regression for #8497: a "YYYY-MM-DD" string was parsed as UTC midnight by the
        // Date constructor, which rolls back to the previous day for negative UTC
        // offsets (e.g. the Recent Changes date headers showed yesterday for a UTC-8
        // user). It must be treated as a local calendar date instead.
        options.set("formattingLocale", "en-US");

        // The date header itself must match the local calendar day, not a UTC shift.
        expect(formatDateTime("2026-01-25", "full", "none")).toBe(new Date(2026, 0, 25).toLocaleDateString("en-US", { dateStyle: "full" }));

        // Timezone-independent guard: a correctly parsed date-only string is *local*
        // midnight in any timezone, so its time renders as 00:00. The buggy UTC parse
        // produced a non-midnight local time in every zone east/west of UTC.
        expect(formatDateTime("2026-01-25", "none", "short")).toBe("12:00 AM");
    });

    it("falls back to the locale option then navigator.language", () => {
        // Empty formattingLocale forces the `|| options.get("locale")` branch.
        options.set("formattingLocale", "");
        options.set("locale", "en-GB");
        expect(formatDateTime(new Date())).toBeTruthy();

        // Both empty forces the `|| navigator.language` branch.
        options.set("locale", "");
        expect(formatDateTime(new Date())).toBeTruthy();
    });

    it("throws a TypeError for an unsupported date type", () => {
        // Truthy but neither string/number nor Date instance.
        expect(() => formatDateTime({ not: "a date" } as unknown as Date)).toThrow(TypeError);
    });

    it("throws on the incorrect state when both styles are none", () => {
        // With both dateStyle and timeStyle "none", every formatting branch is
        // skipped and execution reaches the final guard.
        expect(() => formatDateTime(new Date(), "none", "none")).toThrow("Incorrect state.");
    });

    describe("formatDuration", () => {
        it("reports the value in the unit the user picked, for every time scale", () => {
            expect(formatDuration(30, 1)).toBe("time_interval.seconds|30");
            expect(formatDuration(300, 60)).toBe("time_interval.minutes|5");
            expect(formatDuration(43200, 3600)).toBe("time_interval.hours|12");
            // The shipped default: 604800s at a day scale.
            expect(formatDuration(604800, 86400)).toBe("time_interval.days|7");
        });

        it("passes the count through so i18next can pluralize (1 vs many)", () => {
            expect(formatDuration(86400, 86400)).toBe("time_interval.days|1");
            expect(formatDuration(172800, 86400)).toBe("time_interval.days|2");
        });

        it("keeps distinct windows distinguishable, unlike a fuzzy humanizer", () => {
            // dayjs humanize() renders both of these as "a month", which would misreport when a
            // note is actually destroyed. They must stay apart.
            expect(formatDuration(2592000, 86400)).toBe("time_interval.days|30");
            expect(formatDuration(3888000, 86400)).toBe("time_interval.days|45");
        });

        it("falls back to days when the scale is missing or unusable", () => {
            expect(formatDuration(604800, 0)).toBe("time_interval.days|7");
            expect(formatDuration(604800, -1)).toBe("time_interval.days|7");
            // useTriliumOptionInt yields NaN for an option that hasn't loaded; the scale still degrades
            // to days rather than producing a NaN count.
            expect(formatDuration(604800, NaN)).toBe("time_interval.days|7");
        });

        it("returns null when the duration itself is unknown, so callers omit the phrase", () => {
            // Options load asynchronously, so useTriliumOptionInt yields NaN until the fetch resolves.
            // Returning null keeps "NaN days" (or a gap mid-sentence) out of the UI.
            expect(formatDuration(NaN, 86400)).toBeNull();
            expect(formatDuration(undefined as unknown as number, 86400)).toBeNull();
            expect(formatDuration(Infinity, 86400)).toBeNull();
            expect(formatDuration(-1, 86400)).toBeNull();
        });

        it("reports an unrecognized scale in days derived from the raw seconds", () => {
            // 7 is not one of the offered scales, so the unit cannot be named from it.
            expect(formatDuration(604800, 7)).toBe("time_interval.days|7");
        });
    });
});
