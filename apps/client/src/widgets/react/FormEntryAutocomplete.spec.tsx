/**
 * The dropdown whose rows are objects: what a row is drawn as, what picking it reports, and when the
 * list stands down and comes back. The hosts are a geo map's search bar and the script module
 * dialog; what is held here is the part they share.
 */
import { useCallback, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderInto } from "../../test/render";
import FormEntryAutocomplete, { type AutocompleteEntry } from "./FormEntryAutocomplete";

/** A row that reports a pick, standing for a marker or a package. */
function choice(key: string, extra: Partial<AutocompleteEntry> = {}): AutocompleteEntry {
    return { key, label: key, ...extra };
}

let picked: { entry: AutocompleteEntry; offered: string[] }[] = [];

/**
 * Renders the field over a fixed set of rows, and reports what the query was asked for so a test can
 * tell a lookup that ran from one that was never made.
 */
function renderField(entries: AutocompleteEntry[], { minQueryLength = 1, openOnEnter = false } = {}) {
    picked = [];
    const asked: string[] = [];

    function Host() {
        const [ value, setValue ] = useState("");

        return (
            <FormEntryAutocomplete
                className="entries"
                currentValue={value}
                onChange={setValue}
                entries={useCallback(async (query: string) => { asked.push(query); return entries; }, [])}
                onPick={(entry, offered) => picked.push({ entry, offered: offered.map((row) => row.key) })}
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
    // Two acts: the field has to re-render as open before the effect that schedules the lookup runs.
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
    it("draws a row from what it carries, and names a heading without offering it", async () => {
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

    it("stands the list down once a row is taken, and puts it back when the query moves on", async () => {
        renderField([ choice("a") ]);
        await type("c");

        await click(0);
        expect(rows()).toEqual([]);

        await type("co");
        expect(rows()).toHaveLength(1);
    });

    it("leaves the list up for a row that starts something rather than settling it", async () => {
        renderField([ choice("search", { keepsListOpen: true }) ]);
        await type("c");

        await click(0);

        expect(picked).toHaveLength(1);
        expect(rows()).toHaveLength(1);
    });

    it("takes no pick from a row that only reports", async () => {
        renderField([ choice("status", { inert: true }) ]);
        await type("c");

        await click(0);

        expect(picked).toEqual([]);
        expect(rows()[0].querySelector(".form-autocomplete-entry-inert")).not.toBeNull();
    });

    it("puts the rows back when the field is come back to, and on Enter where Enter opens the list", async () => {
        renderField([ choice("a") ], { openOnEnter: true });
        await type("c");
        await click(0);

        await press("Enter");
        expect(rows()).toHaveLength(1);

        await click(0);
        expect(rows()).toEqual([]);

        // Coming back to the field is asking for what it was offering, no key being pressed.
        await act(async () => { field().blur(); });
        await act(async () => { field().focus(); });
        await settle();
        expect(rows()).toHaveLength(1);
    });

    it("leaves Enter alone where the list is not opened by it", async () => {
        renderField([ choice("a") ]);
        await type("c");
        await click(0);

        await press("Enter");

        expect(rows()).toEqual([]);
    });
});
