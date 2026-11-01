import { useCallback, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderInto } from "../../test/render";
import FormEntryAutocomplete, { type AutocompleteEntry } from "./FormEntryAutocomplete";

/** A pickable row. */
function choice(key: string, extra: Partial<AutocompleteEntry> = {}): AutocompleteEntry {
    return { key, label: key, ...extra };
}

let picked: { entry: AutocompleteEntry; offered: string[] }[] = [];

/**
 * Renders the field over `entries` and returns `asked`, the queries `entries` was called with, so
 * a test can tell whether a lookup ran.
 */
function renderField(
    entries: AutocompleteEntry[] | ((query: string) => Promise<AutocompleteEntry[]>),
    { minQueryLength = 1, openOnEnter = false } = {}
) {
    picked = [];
    const asked: string[] = [];

    function Host() {
        const [ value, setValue ] = useState("");

        return (
            <FormEntryAutocomplete
                className="entries"
                currentValue={value}
                onChange={setValue}
                entries={useCallback(async (query: string) => {
                    asked.push(query);
                    return typeof entries === "function" ? entries(query) : entries;
                }, [])}
                onPick={(entry, offered) => {
                    picked.push({ entry, offered: offered.map((row) => row.key) });
                }}
                minQueryLength={minQueryLength}
                openOnEnter={openOnEnter}
                openOnFocus
            />
        );
    }

    act(() => { renderInto(<Host />); });

    return { asked };
}

/** Lets the debounced lookup run. */
async function settle() {
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

function field() {
    const input = document.querySelector<HTMLInputElement>("input.entries");
    if (!input) throw new Error("the field was not rendered");
    return input;
}

async function type(text: string) {
    const input = field();
    // Two acts: the field re-renders as open before the effect that schedules the lookup runs.
    await act(async () => {
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
}

async function press(key: string) {
    await act(async () => {
        field().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
    await settle();
}

function rows() {
    return [ ...document.querySelectorAll<HTMLElement>(".form-autocomplete-dropdown li") ];
}

async function click(index: number) {
    await act(async () => { rows()[index].click(); });
    await settle();
}

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("FormEntryAutocomplete", () => {
    it("renders a row's fields, and a heading row", async () => {
        renderField([
            { key: "heading", label: "Nearby", heading: true },
            choice("a", { label: "Corfu", icon: "bx bx-map", detail: "Greece", trailing: "2 km" })
        ]);

        await type("corfu");

        const [ heading, entry ] = rows();
        expect(heading.className).toContain("form-autocomplete-heading");
        expect(heading.textContent).toBe("Nearby");
        expect(entry.querySelector(".form-autocomplete-entry-name")?.textContent).toBe("Corfu");
        expect(entry.querySelector(".form-autocomplete-entry-detail")?.textContent).toBe("Greece");
        expect(entry.querySelector(".form-autocomplete-entry-trailing")?.textContent).toBe("2 km");
        expect(entry.querySelector(".bx-map")).not.toBeNull();
    });

    it("asks for rows only once the query is long enough", async () => {
        const { asked } = renderField([ choice("a") ], { minQueryLength: 3 });

        await type("co");
        expect(rows()).toEqual([]);
        expect(asked).toEqual([]);

        await type("corfu");
        expect(asked).toEqual([ "corfu" ]);
    });

    it("reports a picked row whole, along with everything the list was offering", async () => {
        renderField([ choice("a"), choice("b") ]);

        await type("c");
        await click(1);

        expect(picked).toEqual([ { entry: { key: "b", label: "b" }, offered: [ "a", "b" ] } ]);
    });

    it("empties the list after a pick and lists rows again when the query changes", async () => {
        renderField([ choice("a") ]);
        await type("c");

        await click(0);
        expect(rows()).toEqual([]);

        await type("co");
        expect(rows()).toHaveLength(1);
    });

    it("keeps the list open after picking a keepsListOpen row", async () => {
        renderField([ choice("search", { keepsListOpen: true }) ]);
        await type("c");

        await click(0);

        expect(picked).toHaveLength(1);
        expect(rows()).toHaveLength(1);
    });

    it("ignores a pick of an inert row", async () => {
        renderField([ choice("status", { inert: true }) ]);
        await type("c");

        await click(0);

        expect(picked).toEqual([]);
        expect(rows()[0].querySelector(".form-autocomplete-entry-inert")).not.toBeNull();
    });

    it("lists the rows again on focus, and on Enter with openOnEnter", async () => {
        renderField([ choice("a") ], { openOnEnter: true });
        await type("c");
        await click(0);

        await press("Enter");
        expect(rows()).toHaveLength(1);

        await click(0);
        expect(rows()).toEqual([]);

        // Focus alone lists the rows again.
        await act(async () => { field().blur(); });
        await act(async () => { field().focus(); });
        await settle();
        expect(rows()).toHaveLength(1);
    });

    it("picks from the rows on display when an older lookup resolves last", async () => {
        const pending = new Map<string, (rows: AutocompleteEntry[]) => void>();
        renderField((query) => new Promise((resolve) => pending.set(query, resolve)));

        await type("a");
        await type("ab");
        await act(async () => { pending.get("ab")?.([ choice("ab-row") ]); });
        await settle();
        await act(async () => { pending.get("a")?.([ choice("a-row") ]); });
        await settle();

        expect(rows().map((row) => row.textContent)).toEqual([ "ab-row" ]);
        await click(0);
        expect(picked).toEqual([
            { entry: { key: "ab-row", label: "ab-row" }, offered: [ "ab-row" ] }
        ]);
    });

    it("leaves Enter to the form without openOnEnter", async () => {
        renderField([ choice("a") ]);
        await type("c");
        await click(0);

        await press("Enter");

        expect(rows()).toEqual([]);
    });
});
