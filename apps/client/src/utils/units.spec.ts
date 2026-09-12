/**
 * How a measurement is read out, in either of the systems Trilium states distances in.
 *
 * The unit strings resolve to nothing under test — i18next is never initialized — so what is checked
 * is which unit was reached for and what was handed to it: the number, and how far it was rounded.
 */
import { describe, expect, it, vi } from "vitest";

import { formatDistance, formatElevation, formatSpeed } from "./units";

vi.mock("../services/i18n", () => ({
    t: (key: string, vars?: Record<string, unknown>) => `${key}|${Object.values(vars ?? {}).join()}`
}));

describe("formatDistance", () => {
    it("reads in metres up close and kilometres beyond, where distances are stated in metric", () => {
        expect(formatDistance(0, "metric")).toBe("gpx_preview.unit_m|0");
        expect(formatDistance(850.4, "metric")).toBe("gpx_preview.unit_m|850");
        // The last metre before it turns over, and the first kilometre after.
        expect(formatDistance(999, "metric")).toBe("gpx_preview.unit_m|999");
        expect(formatDistance(1000, "metric")).toBe("gpx_preview.unit_km|1");
    });

    it("reads in miles throughout, where that is how distances are stated", () => {
        // Under a mile is still stated in miles: nobody gives a distance in feet.
        expect(formatDistance(804.672, "imperial")).toBe("gpx_preview.unit_mi|0.5");
        expect(formatDistance(1609.344, "imperial")).toBe("gpx_preview.unit_mi|1");
    });

    it("keeps fewer decimals the larger the number, a distance being read at what it is worth", () => {
        expect(formatDistance(1234, "metric")).toBe("gpx_preview.unit_km|1.23");
        expect(formatDistance(12_340, "metric")).toBe("gpx_preview.unit_km|12.3");
        expect(formatDistance(1_234_000, "metric")).toBe("gpx_preview.unit_km|1,234");
    });
});

describe("formatElevation", () => {
    it("reads in metres or in feet, whole either way — a hill is not measured to the centimetre", () => {
        expect(formatElevation(1234.6, "metric")).toBe("gpx_preview.unit_m|1,235");
        expect(formatElevation(1000, "imperial")).toBe("gpx_preview.unit_ft|3,281");
    });
});

describe("formatSpeed", () => {
    it("reads in kilometres or miles an hour, from the kilometres an hour it is given", () => {
        expect(formatSpeed(12.34, "metric")).toBe("gpx_preview.unit_kmh|12.3");
        expect(formatSpeed(160.9344, "imperial")).toBe("gpx_preview.unit_mph|100");
    });
});
