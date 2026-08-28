import { t } from "../services/i18n";

/** Whether distances are stated in miles or in kilometres (see `getMeasurementSystem`). */
export type MeasurementSystem = "metric" | "imperial";

const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.28084;

/**
 * A distance as it is read: metres up close and kilometres beyond, or miles throughout where that is
 * how distances are stated.
 *
 * The unit strings are keyed under `gpx_preview`, which is where they were first written. They name
 * nothing in particular — "{{value}} km" — and a renamed key drops what 38 locales have made of it.
 */
export function formatDistance(meters: number, system: MeasurementSystem): string {
    if (system === "imperial") {
        return t("gpx_preview.unit_mi", { value: round(meters / METERS_PER_MILE) });
    }
    if (meters < 1000) {
        return t("gpx_preview.unit_m", { value: Math.round(meters).toLocaleString() });
    }
    return t("gpx_preview.unit_km", { value: round(meters / 1000) });
}

export function formatElevation(meters: number, system: MeasurementSystem): string {
    if (system === "imperial") {
        return t("gpx_preview.unit_ft", { value: Math.round(meters * FEET_PER_METER).toLocaleString() });
    }
    return t("gpx_preview.unit_m", { value: Math.round(meters).toLocaleString() });
}

export function formatSpeed(kmh: number, system: MeasurementSystem): string {
    if (system === "imperial") {
        return t("gpx_preview.unit_mph", { value: round(kmh * 1000 / METERS_PER_MILE) });
    }
    return t("gpx_preview.unit_kmh", { value: round(kmh) });
}

/** Fewer decimals the larger the number, so a measurement reads at the precision it is worth. */
function round(value: number): string {
    const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}
