import { describe, expect, it } from "vitest";

import options from "../services/options";
import { formatDateTime, normalizeLocale } from "./formatters";

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
});
