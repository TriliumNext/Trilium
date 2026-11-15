import i18next from "i18next";
import { describe, expect, it, vi } from "vitest";

import { dayjs, formatCustomDateTime } from "./dayjs";

describe("dayjs", () => {
    it("speaks the language of the app, and follows it when it changes", async () => {
        await i18next.init({ lng: "de", resources: {} });
        await vi.waitFor(() => expect(dayjs.locale()).toBe("de"));

        await i18next.changeLanguage("fr");
        await vi.waitFor(() => expect(dayjs.locale()).toBe("fr"));
    });
});

describe("formatCustomDateTime", () => {
    it("uses the format the user supplied", () => {
        expect(formatCustomDateTime(new Date(2024, 0, 5, 9, 7), "YYYY")).toBe("2024");
    });

    it("falls back to the ISO date and time for a missing or blank format", () => {
        expect(formatCustomDateTime(new Date(2024, 0, 5, 9, 7), undefined)).toBe("2024-01-05 09:07");
        expect(formatCustomDateTime(new Date(2024, 11, 31, 23, 59), "   ")).toBe("2024-12-31 23:59");
    });
});
