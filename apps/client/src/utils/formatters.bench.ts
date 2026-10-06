/**
 * Guards the formatter memoization in `formatters.ts` against regressing.
 *
 * These helpers used to build a fresh `Intl.DateTimeFormat` on every call, which is invisible when a
 * dialog formats one date and dominant when a collection view formats one per row: a 949-card board
 * redraw runs `formatDateTime` once per dated promoted label on every card, and cost 158ms doing it.
 * Memoizing the formatters took that to ~5ms.
 *
 * Each pair below measures a `formatters.ts` entry point against a bare cached `Intl.DateTimeFormat`
 * doing the same job -- the floor. While the memo holds, the two run within ~1.3x of each other; the
 * remainder is the locale lookup, date parsing and cache key that the floor skips. A pair blowing
 * out to a 20-30x gap again means a construction has crept back into that path.
 *
 * ```
 * pnpm --filter client exec vitest bench --run src/utils/formatters.bench.ts
 * ```
 */

// formatters.ts pulls in i18n at module scope; i18next is not initialised in a bench run, and the
// paths measured here never reach t() anyway.
vi.mock("../services/i18n", async () => {
    const { LOCALES } = await import("@triliumnext/commons");
    return {
        t: (key: string) => key,
        getLocaleById: (id: string | null | undefined) => LOCALES.find((l) => l.id === id) ?? null
    };
});

import { test, vi } from "vitest";

import options from "../services/options";
import { formatDateNumeric as importedFormatDateNumeric, formatDateTime as importedFormatDateTime } from "./formatters";

// Vitest serves an import through a module-export getter, so naming one inside a benchmark pays for
// a getter on every iteration while the floor, a local function, pays nothing — which lands on the
// side of the pair being measured. Bind them once so the comparison is about formatting.
const formatDateTime = importedFormatDateTime;
const formatDateNumeric = importedFormatDateNumeric;

const LOCALE = "en-GB";
const DATE = new Date("2026-02-11T14:23:45Z");

/** Cards on the board that surfaced this; each one formats at least one date per redraw. */
const BOARD_CARDS = 949;

options.set("formattingLocale", LOCALE);

const formatterCache = new Map<string, Intl.DateTimeFormat>();

test("formatDateTime — date and time", async ({ bench }) => {
    await bench.compare(
        bench("formatters.ts", () => {
            formatDateTime(DATE, "short", "short");
        }),
        bench("floor: bare cached Intl.DateTimeFormat", () => {
            cachedFormatter(`${LOCALE}|short|short`, { dateStyle: "short", timeStyle: "short" }).format(DATE);
        })
    );
});

test("formatDateTime — date only", async ({ bench }) => {
    await bench.compare(
        bench("formatters.ts", () => {
            formatDateTime(DATE, "short", "none");
        }),
        bench("floor: bare cached Intl.DateTimeFormat", () => {
            cachedFormatter(`${LOCALE}|short|none`, { dateStyle: "short" }).format(DATE);
        })
    );
});

test("formatDateNumeric — with time (also probes the locale's hour cycle)", async ({ bench }) => {
    await bench.compare(
        bench("formatters.ts", () => {
            formatDateNumeric(DATE, true);
        }),
        bench("floor: bare cached Intl.DateTimeFormat", () => {
            cachedFormatter(`${LOCALE}|numeric|withTime`, {
                year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
            }).format(DATE);
        })
    );
});

test(`board redraw — ${BOARD_CARDS} cards, one dated label each`, async ({ bench }) => {
    await bench.compare(
        bench("formatters.ts", () => {
            for (let i = 0; i < BOARD_CARDS; i++) {
                formatDateTime(DATE, "short", "short");
            }
        }),
        bench("floor: bare cached Intl.DateTimeFormat", () => {
            for (let i = 0; i < BOARD_CARDS; i++) {
                cachedFormatter(`${LOCALE}|short|short`, { dateStyle: "short", timeStyle: "short" }).format(DATE);
            }
        })
    );
});

/**
 * The floor to measure against: the same map-keyed-on-arguments caching `formatters.ts` now does,
 * with none of the locale resolution, date parsing or fallback handling around it.
 */
function cachedFormatter(key: string, formatOptions: Intl.DateTimeFormatOptions) {
    let formatter = formatterCache.get(key);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat(LOCALE, formatOptions);
        formatterCache.set(key, formatter);
    }

    return formatter;
}
