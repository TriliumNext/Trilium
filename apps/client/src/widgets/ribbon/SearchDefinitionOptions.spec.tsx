import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the imports) -----------------------------------------------------

// NOTE: the shared `bootstrapMock` only exposes getInstance/show/hide/dispose/toggle. This spec's
// help-dropdown relies on `Dropdown.getOrCreateInstance` and `Dropdown.update`, so we keep the local
// mock unchanged.
vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    class Dropdown {
        static instances = new Map<Element, Dropdown>();
        static getOrCreateInstance(el: Element) {
            let inst = Dropdown.instances.get(el);
            if (!inst) { inst = new Dropdown(el); Dropdown.instances.set(el, inst); }
            return inst;
        }
        static getInstance(el: Element) { return Dropdown.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; }
        show() {}
        hide() {}
        update() {}
        dispose() { Dropdown.instances.delete(this.element); }
    }
    return { Tooltip, Dropdown, default: { Tooltip, Dropdown } };
});

// Stub the autocomplete component so we don't pull in jQuery autocomplete plugins / top-level awaits.
vi.mock("../react/NoteAutocomplete", () => ({
    default: (props: { noteId?: string; placeholder?: string; noteIdChanged?: (id: string) => void }) => (
        <div
            className="mock-note-autocomplete"
            data-note-id={props.noteId ?? ""}
            data-placeholder={props.placeholder ?? ""}
            onClick={() => props.noteIdChanged?.("targetNote")}
        />
    )
}));

vi.mock("../../services/attributes", () => ({
    removeOwnedAttributesByNameOrType: vi.fn(async () => undefined),
    default: {
        setLabel: vi.fn(async () => undefined),
        setAttribute: vi.fn(async () => undefined),
        setBooleanWithInheritance: vi.fn(async () => undefined),
        removeOwnedLabelByName: vi.fn(async () => undefined),
        isAffecting: vi.fn(() => true)
    }
}));

vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    openInAppHelpFromUrl: vi.fn()
}));

import attributes, { removeOwnedAttributesByNameOrType } from "../../services/attributes";
import { t } from "../../services/i18n";
import server from "../../services/server";
import { openInAppHelpFromUrl } from "../../services/utils";
import { buildNote } from "../../test/easy-froca";
import { flush, renderComponent, resetFroca } from "../../test/render";
import { SEARCH_OPTIONS, SearchOption } from "./SearchDefinitionOptions";

// --- Render helper --------------------------------------------------------------------------------

function findOption(attributeName: string): SearchOption {
    const option = SEARCH_OPTIONS.find((o) => o.attributeName === attributeName);
    if (!option) throw new Error(`Missing option ${attributeName}`);
    return option;
}

function renderOption(attributeName: string, props: {
    note: ReturnType<typeof buildNote>;
    refreshResults?: () => void;
    error?: { message: string };
}) {
    const option = findOption(attributeName);
    const OptionComponent = option.component;

    // The option components return <tr> rows, so host them inside a real table for valid DOM.
    const { container } = renderComponent(
        <table>
            <tbody>
                <OptionComponent
                    note={props.note}
                    refreshResults={props.refreshResults ?? (() => {})}
                    attributeName={option.attributeName}
                    attributeType={option.attributeType}
                    additionalAttributesToDelete={option.additionalAttributesToDelete}
                    defaultValue={option.defaultValue}
                    error={props.error}
                />
            </tbody>
        </table>
    );
    const tbody = container.querySelector("tbody");
    if (!tbody) throw new Error("Failed to render option tbody");
    return tbody;
}

let previousTooltipPlugin: unknown;

beforeEach(() => {
    resetFroca();
    vi.clearAllMocks();
    // ActionButton/Dropdown static tooltips call $el.tooltip(); provide a no-op jQuery plugin.
    const fn = $.fn as unknown as Record<string, unknown>;
    previousTooltipPlugin = fn.tooltip;
    fn.tooltip = function () { return this; };
});

afterEach(() => {
    const fn = $.fn as unknown as Record<string, unknown>;
    fn.tooltip = previousTooltipPlugin;
});

// --- The exported metadata ------------------------------------------------------------------------

describe("SEARCH_OPTIONS metadata", () => {
    it("contains all expected options with the right attribute types and icons", () => {
        const names = SEARCH_OPTIONS.map((o) => o.attributeName);
        expect(names).toEqual([
            "searchString", "searchScript", "ancestor", "fastSearch",
            "includeArchivedNotes", "orderBy", "limit", "debug"
        ]);
        for (const option of SEARCH_OPTIONS) {
            expect(typeof option.component).toBe("function");
            expect(option.icon).toMatch(/^bx /);
            expect([ "label", "relation" ]).toContain(option.attributeType);
        }
        expect(findOption("ancestor").additionalAttributesToDelete)
            .toEqual([ { type: "label", name: "ancestorDepth" } ]);
        expect(findOption("orderBy").additionalAttributesToDelete)
            .toEqual([ { type: "label", name: "orderDirection" } ]);
    });
});

// --- SearchStringOption ---------------------------------------------------------------------------

describe("SearchStringOption", () => {
    it("renders the textarea with the current value and the help link", () => {
        const note = buildNote({ id: "ss1", title: "Plain title", "#searchString": "#abc" });
        const tbody = renderOption("searchString", { note });

        const textarea = tbody.querySelector("textarea.search-string");
        expect(textarea).toBeTruthy();
        expect((textarea as HTMLTextAreaElement).value).toBe("#abc");

        // The help content (with the "complete help" anchor) is only rendered once the dropdown opens.
        const helpDropdown = tbody.querySelector(".help-dropdown") as HTMLElement;
        expect(helpDropdown).toBeTruthy();
        act(() => { $(helpDropdown).trigger("show.bs.dropdown"); });

        const helpLink = tbody.querySelector("a[href='#']");
        expect(helpLink).toBeTruthy();
        helpLink?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        expect(openInAppHelpFromUrl).toHaveBeenCalledWith("eIg8jdvaoNNd");
    });

    it("renders an error admonition and the has-error class when an error is given", () => {
        const note = buildNote({ id: "ss2", title: "T" });
        const tbody = renderOption("searchString", { note, error: { message: "boom" } });

        expect(tbody.querySelector("tr.has-error")).toBeTruthy();
        expect(tbody.textContent).toContain("boom");
    });

    it("schedules an update on input and triggers refresh on Enter", async () => {
        vi.useFakeTimers();
        try {
            const refreshResults = vi.fn();
            const note = buildNote({ id: "ss3", title: "T" });
            const tbody = renderOption("searchString", { note, refreshResults });
            const textarea = tbody.querySelector("textarea.search-string") as HTMLTextAreaElement;

            textarea.value = "hello world";
            act(() => { textarea.dispatchEvent(new Event("input", { bubbles: true })); });

            // A non-Enter key is ignored (does not refresh).
            textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
            expect(refreshResults).not.toHaveBeenCalled();

            // Enter triggers updateNowIfNecessary + refreshResults.
            const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
            textarea.dispatchEvent(enter);
            await vi.runAllTimersAsync();
            expect(refreshResults).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it("updates the note title via server when title carries the search prefix (long value truncated)", async () => {
        vi.useFakeTimers();
        try {
            // The component checks note.title.startsWith(search prefix); build the title from the same i18n key.
            const prefix = t("search_string.search_prefix");
            const note = buildNote({ id: "ss4", title: `${prefix} foo` });
            const tbody = renderOption("searchString", { note });
            const textarea = tbody.querySelector("textarea.search-string") as HTMLTextAreaElement;

            const longValue = "x".repeat(50);
            textarea.value = longValue;
            act(() => { textarea.dispatchEvent(new Event("input", { bubbles: true })); });
            await vi.advanceTimersByTimeAsync(1100);

            expect(server.put).toHaveBeenCalled();
            const call = (server.put as ReturnType<typeof vi.fn>).mock.calls[0];
            expect(call[0]).toBe(`notes/${note.noteId}/title`);
            // Long value is truncated to 30 chars + ellipsis.
            const body = call[1] as { title: string };
            expect(body.title).toContain("…");
        } finally {
            vi.useRealTimers();
        }
    });

    it("updates the note title with a short value when title carries the search prefix", async () => {
        vi.useFakeTimers();
        try {
            const prefix = t("search_string.search_prefix");
            const note = buildNote({ id: "ss5", title: `${prefix} foo` });
            const tbody = renderOption("searchString", { note });
            const textarea = tbody.querySelector("textarea.search-string") as HTMLTextAreaElement;

            textarea.value = "short";
            act(() => { textarea.dispatchEvent(new Event("input", { bubbles: true })); });
            await vi.advanceTimersByTimeAsync(1100);

            const call = (server.put as ReturnType<typeof vi.fn>).mock.calls[0];
            const body = call[1] as { title: string };
            expect(body.title).toContain("short");
            expect(body.title).not.toContain("…");
        } finally {
            vi.useRealTimers();
        }
    });
});

// --- SearchScriptOption ---------------------------------------------------------------------------

describe("SearchScriptOption", () => {
    it("hides the default 'root' relation value and writes 'root' when cleared", () => {
        buildNote({ id: "targetNote", title: "Target" });
        const note = buildNote({ id: "scriptRoot", title: "T", "~searchScript": "root" });
        const tbody = renderOption("searchScript", { note });

        const autocomplete = tbody.querySelector(".mock-note-autocomplete");
        expect(autocomplete).toBeTruthy();
        // value "root" is mapped to undefined so the autocomplete shows nothing.
        expect(autocomplete?.getAttribute("data-note-id")).toBe("");

        // Selecting a note writes it through setAttribute.
        act(() => { autocomplete?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        expect(attributes.setAttribute).toHaveBeenCalledWith(note, "relation", "searchScript", "targetNote");
    });

    it("passes a non-root relation value to the autocomplete", () => {
        buildNote({ id: "myScript", title: "Script" });
        const note = buildNote({ id: "scriptSet", title: "T", "~searchScript": "myScript" });
        const tbody = renderOption("searchScript", { note });
        expect(tbody.querySelector(".mock-note-autocomplete")?.getAttribute("data-note-id")).toBe("myScript");
    });
});

// --- AncestorOption -------------------------------------------------------------------------------

describe("AncestorOption", () => {
    it("renders the depth select with the full option set and the ancestor autocomplete", () => {
        const note = buildNote({ id: "anc1", title: "T", "~ancestor": "root", "#ancestorDepth": "eq3" });
        const tbody = renderOption("ancestor", { note });

        const select = tbody.querySelector("select") as HTMLSelectElement;
        expect(select).toBeTruthy();
        // 1 (matter) + 1 (eq1) + 8 (eq2..9) + 10 (gt0..9) + 8 (lt2..9) = 28 options.
        expect(select.querySelectorAll("option").length).toBe(28);
        // The current depth label is read and offered as an option.
        expect(note.getLabelValue("ancestorDepth")).toBe("eq3");
        expect(select.querySelector("option[value='eq3']")).toBeTruthy();

        // root → hidden in the autocomplete.
        expect(tbody.querySelector(".mock-note-autocomplete")?.getAttribute("data-note-id")).toBe("");
    });

    it("writes depth via setLabel and removes it when emptied", () => {
        const note = buildNote({ id: "anc2", title: "T", "~ancestor": "myAnc", "#ancestorDepth": "eq2" });
        const tbody = renderOption("ancestor", { note });
        const select = tbody.querySelector("select") as HTMLSelectElement;

        select.value = "gt5";
        act(() => { select.dispatchEvent(new Event("change", { bubbles: true })); });
        expect(attributes.setLabel).toHaveBeenCalledWith("anc2", "ancestorDepth", "gt5");

        select.value = "";
        act(() => { select.dispatchEvent(new Event("change", { bubbles: true })); });
        expect(attributes.removeOwnedLabelByName).toHaveBeenCalledWith(note, "ancestorDepth");

        // non-root ancestor passes through.
        expect(tbody.querySelector(".mock-note-autocomplete")?.getAttribute("data-note-id")).toBe("myAnc");

        // Selecting a note in the autocomplete writes the ancestor relation.
        const autocomplete = tbody.querySelector(".mock-note-autocomplete");
        act(() => { autocomplete?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        expect(attributes.setAttribute).toHaveBeenCalledWith(note, "relation", "ancestor", "targetNote");
    });
});

// --- FastSearch / Debug / IncludeArchived (simple title rows) -------------------------------------

describe("simple title-only options", () => {
    it("renders FastSearchOption with its icon and remove button", () => {
        const note = buildNote({ id: "fs1", title: "T" });
        const tbody = renderOption("fastSearch", { note });
        expect(tbody.querySelector("tr.fastSearch")).toBeTruthy();
        expect(tbody.querySelector(".bx-run")).toBeTruthy();
        expect(tbody.querySelector(".search-option-del")).toBeTruthy();
    });

    it("renders IncludeArchivedNotesOption with the archive icon", () => {
        const note = buildNote({ id: "ia1", title: "T" });
        const tbody = renderOption("includeArchivedNotes", { note });
        expect(tbody.querySelector("tr.includeArchivedNotes")).toBeTruthy();
        expect(tbody.querySelector(".bx-archive")).toBeTruthy();
    });

    it("renders DebugOption with the bug icon", () => {
        const note = buildNote({ id: "dbg1", title: "T" });
        const tbody = renderOption("debug", { note });
        expect(tbody.querySelector("tr.debug")).toBeTruthy();
        expect(tbody.querySelector(".bx-bug")).toBeTruthy();
    });
});

// --- OrderByOption --------------------------------------------------------------------------------

describe("OrderByOption", () => {
    it("renders two selects with the current order and direction", () => {
        const note = buildNote({ id: "ob1", title: "T", "#orderBy": "title", "#orderDirection": "desc" });
        const tbody = renderOption("orderBy", { note });
        const selects = tbody.querySelectorAll("select");
        expect(selects.length).toBe(2);
        expect((selects[0].querySelector("option[value='title']") as HTMLOptionElement).selected).toBe(true);
        expect((selects[1].querySelector("option[value='desc']") as HTMLOptionElement).selected).toBe(true);
        // 14 sort criteria.
        expect((selects[0] as HTMLSelectElement).querySelectorAll("option").length).toBe(14);
    });

    it("defaults to relevancy / asc when no labels are set and writes via setLabel", () => {
        const note = buildNote({ id: "ob2", title: "T" });
        const tbody = renderOption("orderBy", { note });
        const selects = tbody.querySelectorAll("select");
        expect((selects[0].querySelector("option[value='relevancy']") as HTMLOptionElement).selected).toBe(true);
        expect((selects[1].querySelector("option[value='asc']") as HTMLOptionElement).selected).toBe(true);

        (selects[0] as HTMLSelectElement).value = "dateCreated";
        act(() => { selects[0].dispatchEvent(new Event("change", { bubbles: true })); });
        expect(attributes.setLabel).toHaveBeenCalledWith("ob2", "orderBy", "dateCreated");

        (selects[1] as HTMLSelectElement).value = "desc";
        act(() => { selects[1].dispatchEvent(new Event("change", { bubbles: true })); });
        expect(attributes.setLabel).toHaveBeenCalledWith("ob2", "orderDirection", "desc");
    });
});

// --- LimitOption ----------------------------------------------------------------------------------

describe("LimitOption", () => {
    it("renders a number input with the current value and writes via setLabel", () => {
        const note = buildNote({ id: "lim1", title: "T", "#limit": "25" });
        const tbody = renderOption("limit", { note });
        const input = tbody.querySelector("input[type='number']") as HTMLInputElement;
        expect(input).toBeTruthy();
        expect(input.value).toBe("25");

        input.value = "50";
        act(() => { input.dispatchEvent(new Event("input", { bubbles: true })); });
        expect(attributes.setLabel).toHaveBeenCalledWith("lim1", "limit", "50");
    });

    it("falls back to the default value when no label is set", () => {
        const note = buildNote({ id: "lim2", title: "T" });
        const tbody = renderOption("limit", { note });
        const input = tbody.querySelector("input[type='number']") as HTMLInputElement;
        expect(input.value).toBe("10");
    });
});

// --- SearchOption remove behaviour ----------------------------------------------------------------

describe("SearchOption remove button", () => {
    it("removes the owned attribute (and additional attributes) when clicked", async () => {
        const note = buildNote({ id: "rm1", title: "T", "~ancestor": "root", "#ancestorDepth": "eq2" });
        const tbody = renderOption("ancestor", { note });

        const removeBtn = tbody.querySelector(".search-option-del") as HTMLElement;
        expect(removeBtn).toBeTruthy();
        act(() => { removeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
        await flush();

        expect(removeOwnedAttributesByNameOrType).toHaveBeenCalledWith(note, "relation", "ancestor");
        // additionalAttributesToDelete → ancestorDepth label is also removed.
        expect(removeOwnedAttributesByNameOrType).toHaveBeenCalledWith(note, "label", "ancestorDepth");
    });

    it("removes only the primary attribute when there are no additional ones", async () => {
        const note = buildNote({ id: "rm2", title: "T", "#limit": "10" });
        const tbody = renderOption("limit", { note });

        const removeBtn = tbody.querySelector(".search-option-del") as HTMLElement;
        act(() => { removeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
        await flush();

        expect(removeOwnedAttributesByNameOrType).toHaveBeenCalledWith(note, "label", "limit");
        expect(removeOwnedAttributesByNameOrType).toHaveBeenCalledTimes(1);
    });
});
