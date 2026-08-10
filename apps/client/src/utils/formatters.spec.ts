import { describe, expect, it, vi } from "vitest";

// i18next is not initialised here, so have t() echo the key and the interpolated count. That lets the
// tests assert exactly which unit was chosen and what count was computed — the real logic — while
// leaving the plural rendering itself to i18next.
// `getLocaleById` is the real lookup rather than a stub — it is a find over the shared catalog, so
// mocking it would only risk disagreeing with the locales the assertions name.
vi.mock("../services/i18n", async () => {
    const { LOCALES } = await import("@triliumnext/commons");
    return {
        t: (key: string, opts?: { count?: number }) => `${key}|${opts?.count}`,
        getLocaleById: (id: string | null | undefined) => LOCALES.find((l) => l.id === id) ?? null
    };
});

import { LOCALES } from "@triliumnext/commons";

import options from "../services/options";
import { formatDateNumeric, formatDateTime, formatDuration, getMeasurementSystem, isContentRightToLeft, normalizeLocale, resolveContentLanguage } from "./formatters";

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

    describe("formatDateNumeric", () => {
        // Every locale the user can actually pick as a formatting locale, which is the set that
        // declares an electronLocale (see the options page).
        const FORMATTING_LOCALES = LOCALES.filter((locale) => locale.electronLocale);

        it("renders an all-numeric, four-digit-year date in every selectable formatting locale", () => {
            expect(FORMATTING_LOCALES.length).toBeGreaterThan(0);

            for (const locale of FORMATTING_LOCALES) {
                options.set("formattingLocale", locale.id);
                const formatted = formatDateNumeric("2026-01-31");

                // The two things a dateStyle preset could not guarantee across locales: "short"
                // yields a two-digit year in some ("31.01.26" in German), and "medium" spells the
                // month out in others ("Jan 31, 2026" in US English).
                expect(formatted, locale.id).toContain("2026");
                expect(formatted, locale.id).not.toMatch(/\p{L}/u);
            }
        });

        it("formats the reported German case as DD.MM.YYYY", () => {
            options.set("formattingLocale", "de");

            expect(formatDateNumeric("2026-01-31")).toBe("31.01.2026");
            expect(formatDateNumeric("2026-01-31T14:05", true)).toBe("31.01.2026, 14:05");
        });

        it("pads a single-digit hour in 24-hour locales but not in 12-hour ones", () => {
            // A fixed hour option gets one of these wrong: "numeric" renders German as "2:05",
            // "2-digit" renders US English as "02:05 AM".
            options.set("formattingLocale", "de");
            expect(formatDateNumeric("2026-01-31T02:05", true)).toBe("31.01.2026, 02:05");
            expect(formatDateNumeric("2026-01-31T14:05", true)).toBe("31.01.2026, 14:05");

            options.set("formattingLocale", "ja");
            expect(formatDateNumeric("2026-01-31T02:05", true)).toBe("2026/01/31 02:05");

            options.set("formattingLocale", "en");
            // Normalized because ICU 72+ separates the day period with U+202F rather than a space.
            expect(formatDateNumeric("2026-01-31T02:05", true).replace(/\s/g, " ")).toBe("01/31/2026, 2:05 AM");
            expect(formatDateNumeric("2026-01-31T14:05", true).replace(/\s/g, " ")).toBe("01/31/2026, 2:05 PM");
        });

        it("falls back to the default locale when the configured one is unusable", () => {
            // The dev-only "en_rtl" normalizes to "en-rtl", which Intl rejects outright.
            options.set("formattingLocale", "en_rtl");

            expect(formatDateNumeric("2026-01-31")).toContain("2026");
        });

        it("returns an empty string for falsy dates", () => {
            expect(formatDateNumeric(null)).toBe("");
            expect(formatDateNumeric(undefined)).toBe("");
            expect(formatDateNumeric("")).toBe("");
        });
    });

    describe("getMeasurementSystem", () => {
        it("picks miles only for the regions that state road distances in them", () => {
            // Trilium lists plain "en" as "English (United States)", so maximizing it yields US;
            // "en-GB" is a separate, equally imperial entry.
            for (const locale of [ "en", "en-GB", "en_US" ]) {
                options.set("formattingLocale", locale);
                expect(getMeasurementSystem(), locale).toBe("imperial");
            }

            // Including the region-less and the underscore/alias forms the options page offers.
            for (const locale of [ "de", "fr", "ro", "es", "cn", "tw", "pt_br", "ja" ]) {
                options.set("formattingLocale", locale);
                expect(getMeasurementSystem(), locale).toBe("metric");
            }
        });

        it("prefers the browser locale over the UI language when set to auto-detect", () => {
            // "Auto" formatting locale plus an English UI: an Australian reads kilometres, so the
            // UI language must not be what decides it.
            options.set("formattingLocale", "");
            options.set("locale", "en");

            withBrowserLocale("en-AU", () => expect(getMeasurementSystem()).toBe("metric"));
            withBrowserLocale("en-US", () => expect(getMeasurementSystem()).toBe("imperial"));

            // An explicitly chosen formatting locale still wins over the browser.
            options.set("formattingLocale", "de");
            withBrowserLocale("en-US", () => expect(getMeasurementSystem()).toBe("metric"));
        });

        it("falls back to the browser locale when the configured one is unusable", () => {
            // The dev-only "en_rtl" normalizes to "en-rtl", which Intl rejects outright.
            options.set("formattingLocale", "en_rtl");

            withBrowserLocale("en-US", () => expect(getMeasurementSystem()).toBe("imperial"));
            withBrowserLocale("fr-FR", () => expect(getMeasurementSystem()).toBe("metric"));
            // No usable locale anywhere, so nothing suggests miles.
            options.set("locale", "!!!invalid!!!");
            withBrowserLocale("!!!invalid!!!", () => expect(getMeasurementSystem()).toBe("metric"));
            options.set("locale", "en");
        });

        function withBrowserLocale(language: string, assert: () => void) {
            const original = Object.getOwnPropertyDescriptor(navigator, "language");
            try {
                Object.defineProperty(navigator, "language", { value: language, configurable: true });
                assert();
            } finally {
                // Absent descriptor means the getter lives on the prototype, so drop the own
                // property added above and let it shine through again.
                if (original) {
                    Object.defineProperty(navigator, "language", original);
                } else {
                    Reflect.deleteProperty(navigator, "language");
                }
            }
        }
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

describe("resolveContentLanguage", () => {
    it("prefers the note's own language over the configured default", () => {
        options.set("defaultContentLanguage", "fr");
        options.set("locale", "ru");

        expect(resolveContentLanguage("de")).toBe("de");
    });

    it("falls back to the default content language, then to the application's language", () => {
        options.set("defaultContentLanguage", "fr");
        options.set("locale", "ru");

        expect(resolveContentLanguage(null)).toBe("fr");
        expect(resolveContentLanguage(undefined)).toBe("fr");
        expect(resolveContentLanguage("")).toBe("fr");

        // An empty default is the "auto" entry, meaning follow the application's language rather
        // than meaning no language at all.
        options.set("defaultContentLanguage", "");
        expect(resolveContentLanguage(null)).toBe("ru");
    });
});

describe("isContentRightToLeft", () => {
    it("follows the note's own language", () => {
        expect(isContentRightToLeft("he")).toBe(true);
        expect(isContentRightToLeft("de")).toBe(false);
    });

    it("applies the default to a note that has no language of its own", () => {
        options.set("defaultContentLanguage", "ar");
        expect(isContentRightToLeft(null)).toBe(true);

        // ...and a note that does have one is not dragged along by it.
        expect(isContentRightToLeft("de")).toBe(false);
    });

    it("treats an unrecognized language as left-to-right", () => {
        options.set("defaultContentLanguage", "not-a-locale");
        expect(isContentRightToLeft(null)).toBe(false);
        expect(isContentRightToLeft("also-not-a-locale")).toBe(false);
    });
});
