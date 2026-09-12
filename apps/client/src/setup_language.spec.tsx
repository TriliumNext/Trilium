import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Loading a language bundle is deliberately not instant here: on mobile each one is a 160-290 KB
 * fetch that the service worker does not cache, so a tap is answered seconds later. `settle()`
 * releases one pending change at a time, and out of order, which is what a user tapping twice
 * before the first answer arrives produces.
 */
const i18nHarness = vi.hoisted(() => {
    const listeners = new Set<() => void>();
    const queue: { lng: string; apply: () => void }[] = [];
    let language = "en";

    return {
        get language() {
            return language;
        },
        changeLanguage: vi.fn((lng: string) => new Promise<void>((resolve) => {
            queue.push({
                lng,
                apply: () => {
                    language = lng;
                    for (const listener of listeners) listener();
                    resolve();
                }
            });
        })),
        subscribe(fn: () => void) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        /** Answers the pending change for `lng`, or the oldest one when not given. */
        settle(lng?: string) {
            const index = lng ? queue.findIndex((entry) => entry.lng === lng) : 0;
            if (index < 0) throw new Error(`No pending language change for ${lng}`);
            queue.splice(index, 1)[0].apply();
        },
        pending: () => queue.length,
        reset() {
            queue.length = 0;
            listeners.clear();
            language = "en";
        }
    };
});

vi.mock("./services/i18n", () => ({
    t: (key: string) => key,
    initLocale: vi.fn(),
    getCurrentLanguage: () => "en"
}));

// Stands in for react-i18next's own subscription: a language change redraws every consumer, which
// is what moves the screen's title independently of the list's selection state.
vi.mock("react-i18next", async () => {
    const { useEffect, useState } = await import("preact/hooks");
    return {
        useTranslation: () => {
            const [ , redraw ] = useState(0);
            useEffect(() => i18nHarness.subscribe(() => redraw((pass) => pass + 1)), []);
            return { t: (key: string) => key, i18n: i18nHarness };
        }
    };
});

vi.mock("./services/server", () => ({
    default: {
        get: vi.fn(async () => []),
        post: vi.fn(async () => ({}))
    }
}));

import { renderState } from "./setup";

let container: HTMLDivElement;

beforeEach(() => {
    vi.useFakeTimers();
    i18nHarness.reset();
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
});

const flushEffects = () => vi.advanceTimersByTimeAsync(50);

function item(name: string) {
    const found = [ ...container.querySelectorAll<HTMLElement>("li.dropdown-item") ]
        .find((element) => element.textContent?.trim() === name);
    if (!found) throw new Error(`No language row named ${name}`);
    return found;
}

/** The row the list is showing as chosen, by name; `null` when the list shows none at all. */
function selected() {
    const active = container.querySelector<HTMLElement>("li.dropdown-item.active");
    return active?.textContent?.trim() ?? null;
}

async function tap(name: string) {
    item(name).click();
    await flushEffects();
}

describe("choosing a language while the bundle is still loading", () => {
    beforeEach(async () => {
        render(renderState("selectLanguage", vi.fn()), container);
        await flushEffects();
    });

    it("shows the language it opened on", () => {
        expect(selected()).toBe("English (United States)");
    });

    it("moves the selection on the tap, not when the bundle finally lands", async () => {
        await tap("Gaeilge");

        // The bundle is still in flight — but the user has been told which row they hit, because
        // otherwise the tap reads as having done nothing and they tap again.
        expect(i18nHarness.pending()).toBe(1);
        expect(selected()).toBe("Gaeilge");

        i18nHarness.settle("ga");
        await flushEffects();
        expect(selected()).toBe("Gaeilge");
    });

    it("keeps the last tap when an earlier one answers after it", async () => {
        await tap("Italiano");
        await tap("Gaeilge");

        // Both are in flight; the first one answers last, as a smaller bundle behind a larger one.
        i18nHarness.settle("ga");
        await flushEffects();
        i18nHarness.settle("it");
        await flushEffects();

        expect(selected()).toBe("Gaeilge");
    });

    it("never shows no selection at all while changes are in flight", async () => {
        await tap("Italiano");
        expect(selected()).not.toBeNull();

        await tap("Română");
        expect(selected()).not.toBeNull();

        i18nHarness.settle("it");
        await flushEffects();
        expect(selected()).not.toBeNull();

        i18nHarness.settle("ro");
        await flushEffects();
        expect(selected()).not.toBeNull();
    });
});
