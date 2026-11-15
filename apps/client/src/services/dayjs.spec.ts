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

    it("finishes loading without waiting for the locale", async () => {
        // In the bundled client, a dayjs locale chunk imports the chunk that holds this module, so
        // it cannot evaluate before this module has.
        vi.resetModules();
        vi.doMock("@triliumnext/commons/src/lib/dayjs.js", async (importOriginal) => ({
            ...await importOriginal<typeof import("@triliumnext/commons/src/lib/dayjs.js")>(),
            setDayjsLocale: () => new Promise<void>(() => {})
        }));
        try {
            await i18next.init({ lng: "de", resources: {} });
            const loaded = import("./dayjs").then(() => "loaded");
            const pending = new Promise((resolve) => setTimeout(() => resolve("pending"), 1000));
            expect(await Promise.race([ loaded, pending ])).toBe("loaded");
        } finally {
            vi.doUnmock("@triliumnext/commons/src/lib/dayjs.js");
        }
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
