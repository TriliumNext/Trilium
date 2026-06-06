import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../test/render";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Make i18n keys passthrough so we assert on structure/ids, never translated English strings.
vi.mock("../../../services/i18n.js", () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key
}));

// Stub <Trans> so the interpolated Note/Parent components are rendered without pulling in i18next.
vi.mock("react-i18next", () => ({
    Trans: ({ i18nKey, components }: { i18nKey: string; components?: Record<string, unknown> }) => (
        <span class="trans-stub" data-i18n-key={i18nKey}>
            {components?.Note as never}
            {components?.Parent as never}
        </span>
    )
}));

// Replace the froca-backed note link with a plain anchor exposing its notePath so we never hit
// the (throwing) mock server while still exercising the note-ref rendering branch.
vi.mock("../../react/NoteLink.js", () => ({
    NewNoteLink: ({ notePath, showNoteIcon, noPreview }: { notePath: string; showNoteIcon?: boolean; noPreview?: boolean }) => (
        <a
            class="note-link-stub"
            data-note-path={notePath}
            data-show-icon={showNoteIcon ? "true" : "false"}
            data-no-preview={noPreview ? "true" : "false"}
        >{notePath}</a>
    )
}));

import type { ToolCall } from "./llm_chat_types.js";
import ToolCallCard from "./ToolCallCard.js";

// --- Render helper --------------------------------------------------------------------------------

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
    return {
        id: "tc1",
        toolName: "read_note",
        input: {},
        ...overrides
    };
}

// --- Card shell + grouping ------------------------------------------------------------------------

describe("ToolCallCard grouping", () => {
    it("renders a card with one section per singleton tool call", () => {
        const card = renderInto(<ToolCallCard toolCalls={[
            makeToolCall({ id: "a", toolName: "read_note", result: "{}" }),
            makeToolCall({ id: "b", toolName: "create_note", result: "{}" })
        ]} />);

        expect(card.querySelector(".expandable-card")).not.toBeNull();
        // Two distinct tool names → two singleton sections, no group wrapper.
        expect(card.querySelectorAll(".expandable-section").length).toBe(2);
        expect(card.querySelector(".llm-chat-tool-call-group")).toBeNull();
    });

    it("folds consecutive same-named calls into a group with a count", () => {
        const card = renderInto(<ToolCallCard toolCalls={[
            makeToolCall({ id: "a", toolName: "search_notes", result: "{}" }),
            makeToolCall({ id: "b", toolName: "search_notes", result: "{}" }),
            makeToolCall({ id: "c", toolName: "search_notes", result: "{}" })
        ]} />);

        const group = card.querySelector(".llm-chat-tool-call-group");
        expect(group).not.toBeNull();
        expect(card.querySelector(".llm-chat-tool-call-count")?.textContent).toBe("×3");
        // The group header plus three inner sections.
        expect(card.querySelectorAll(".expandable-section").length).toBe(4);
    });

    it("groups runs separately when interrupted by a different tool name", () => {
        const card = renderInto(<ToolCallCard toolCalls={[
            makeToolCall({ id: "a", toolName: "search_notes", result: "{}" }),
            makeToolCall({ id: "b", toolName: "search_notes", result: "{}" }),
            makeToolCall({ id: "c", toolName: "read_note", result: "{}" }),
            makeToolCall({ id: "d", toolName: "search_notes", result: "{}" }),
            makeToolCall({ id: "e", toolName: "search_notes", result: "{}" })
        ]} />);

        // Two separate groups (search,search) (search,search) plus one singleton read_note.
        expect(card.querySelectorAll(".llm-chat-tool-call-group").length).toBe(2);
        const counts = Array.from(card.querySelectorAll(".llm-chat-tool-call-count")).map(el => el.textContent);
        expect(counts).toEqual([ "×2", "×2" ]);
    });

    it("falls back to the index key for an id-less singleton section", () => {
        // A lone call with no id exercises the `group.id ?? idx` fallback in the card map.
        const card = renderInto(<ToolCallCard toolCalls={[
            { toolName: "read_note", input: {}, result: "{}" } as ToolCall
        ]} />);
        expect(card.querySelectorAll(".expandable-section").length).toBe(1);
        expect(card.querySelector(".llm-chat-tool-call-group")).toBeNull();
    });

    it("falls back to the index key when a grouped call has no id", () => {
        // Two same-named calls with no id exercise the `tc.id ?? idx` fallback in the group.
        const card = renderInto(<ToolCallCard toolCalls={[
            { toolName: "search_notes", input: {}, result: "{}" } as ToolCall,
            { toolName: "search_notes", input: {}, result: "{}" } as ToolCall
        ]} />);
        expect(card.querySelector(".llm-chat-tool-call-count")?.textContent).toBe("×2");
    });
});

// --- Icons (toolNameIcon / toolCallIcon) ----------------------------------------------------------

describe("ToolCallCard icons", () => {
    function iconOf(toolCall: ToolCall): string {
        const card = renderInto(<ToolCallCard toolCalls={[ toolCall ]} />);
        const summary = card.querySelector(".expandable-section-summary");
        const iconSpan = summary?.querySelector("span");
        return iconSpan?.className ?? "";
    }

    it("shows a spinner while pending and an error icon on error", () => {
        expect(iconOf(makeToolCall({ result: undefined }))).toBe("bx bx-loader-alt bx-spin");
        expect(iconOf(makeToolCall({ result: "{}", isError: true }))).toBe("bx bx-error-circle");
    });

    it("maps tool names to their type-specific icons", () => {
        expect(iconOf(makeToolCall({ toolName: "search_notes", result: "{}" }))).toBe("bx bx-search");
        expect(iconOf(makeToolCall({ toolName: "set_note_content", result: "{}" }))).toBe("bx bx-sync");
        expect(iconOf(makeToolCall({ toolName: "update_note_content", result: "{}" }))).toBe("bx bx-sync");
        expect(iconOf(makeToolCall({ toolName: "edit_note_content", result: "{}", input: { foo: 1 } }))).toBe("bx bx-pencil");
        expect(iconOf(makeToolCall({ toolName: "read_note", result: "{}" }))).toBe("bx bx-note");
        expect(iconOf(makeToolCall({ toolName: "set_attribute", result: "{}" }))).toBe("bx bx-purchase-tag");
        expect(iconOf(makeToolCall({ toolName: "get_attachment", result: "{}" }))).toBe("bx bx-paperclip");
        expect(iconOf(makeToolCall({ toolName: "load_skill", result: "{}" }))).toBe("bx bx-book-open");
        // "web_search" contains "search", so the search check wins over the web check.
        expect(iconOf(makeToolCall({ toolName: "web_search", result: "{}" }))).toBe("bx bx-search");
        // A tool name containing "web" but not "search" gets the globe icon.
        expect(iconOf(makeToolCall({ toolName: "fetch_webpage", result: "{}" }))).toBe("bx bx-globe");
        expect(iconOf(makeToolCall({ toolName: "do_something", result: "{}" }))).toBe("bx bx-wrench");
    });

    it("shows a spinner on a group while any member is pending, otherwise the type icon", () => {
        const pending = renderInto(<ToolCallCard toolCalls={[
            makeToolCall({ id: "a", toolName: "search_notes", result: "{}" }),
            makeToolCall({ id: "b", toolName: "search_notes", result: undefined })
        ]} />);
        const groupSummaryIcon = pending.querySelector(".llm-chat-tool-call-group > .expandable-section-summary span");
        expect(groupSummaryIcon?.className).toBe("bx bx-loader-alt bx-spin");

        const done = renderInto(<ToolCallCard toolCalls={[
            makeToolCall({ id: "a", toolName: "search_notes", result: "{}" }),
            makeToolCall({ id: "b", toolName: "search_notes", result: "{}" })
        ]} />);
        const doneIcon = done.querySelector(".llm-chat-tool-call-group > .expandable-section-summary span");
        expect(doneIcon?.className).toBe("bx bx-search");
    });

    it("flags an error badge on a group when any member errored", () => {
        const card = renderInto(<ToolCallCard toolCalls={[
            makeToolCall({ id: "a", toolName: "search_notes", result: "{}" }),
            makeToolCall({ id: "b", toolName: "search_notes", result: "{}", isError: true })
        ]} />);
        expect(card.querySelector(".llm-chat-tool-call-group .llm-chat-tool-call-error-badge")).not.toBeNull();
    });
});

// --- Label context (getToolCallContext) -----------------------------------------------------------

describe("ToolCallCard label context", () => {
    it("renders the created note inside its parent for a creation tool", () => {
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "create_note",
            input: { parentNoteId: "parent1" },
            result: JSON.stringify({ noteId: "created1" })
        }) ]} />);

        const trans = card.querySelector(".trans-stub");
        expect(trans?.getAttribute("data-i18n-key")).toBe("llm.tools.note_in_parent");
        const links = Array.from(card.querySelectorAll(".note-link-stub")).map(el => el.getAttribute("data-note-path"));
        expect(links).toEqual([ "created1", "parent1" ]);
    });

    it("renders a single note ref from input.noteId (no Trans wrapper)", () => {
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "read_note",
            input: { noteId: "n42" },
            result: "{}"
        }) ]} />);

        expect(card.querySelector(".trans-stub")).toBeNull();
        const link = card.querySelector(".note-link-stub");
        expect(link?.getAttribute("data-note-path")).toBe("n42");
        expect(link?.getAttribute("data-show-icon")).toBe("true");
        expect(link?.getAttribute("data-no-preview")).toBe("true");
    });

    it("falls back to a noteId parsed from the result when there is no parent", () => {
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "read_note",
            input: {},
            result: JSON.stringify({ noteId: "fromResult" })
        }) ]} />);
        expect(card.querySelector(".note-link-stub")?.getAttribute("data-note-path")).toBe("fromResult");
    });

    it("uses input.parentNoteId as the note ref when the result has no noteId", () => {
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "create_note",
            input: { parentNoteId: "parentOnly" },
            result: JSON.stringify({ ok: true })
        }) ]} />);
        // No created noteId in result → single ref pointing at the parent, no Trans wrapper.
        expect(card.querySelector(".trans-stub")).toBeNull();
        expect(card.querySelector(".note-link-stub")?.getAttribute("data-note-path")).toBe("parentOnly");
    });

    it("shows plain detail text from input.name when no note ref is available", () => {
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "load_skill",
            input: { name: "my-skill" },
            result: "{}"
        }) ]} />);
        expect(card.querySelector(".llm-chat-tool-call-detail")?.textContent).toBe("my-skill");
        expect(card.querySelector(".note-link-stub")).toBeNull();
    });

    it("shows detail text from input.query when name is absent", () => {
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "search_notes",
            input: { query: "hello world" },
            result: "{}"
        }) ]} />);
        expect(card.querySelector(".llm-chat-tool-call-detail")?.textContent).toBe("hello world");
    });

    it("renders no detail and no ref when input is empty and result has no noteId", () => {
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "do_thing",
            input: {},
            result: JSON.stringify({ ok: 1 })
        }) ]} />);
        expect(card.querySelector(".llm-chat-tool-call-detail")).toBeNull();
        expect(card.querySelector(".note-link-stub")).toBeNull();
    });

    it("shows an error badge on a singleton section that errored", () => {
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "read_note",
            input: {},
            result: "{}",
            isError: true
        }) ]} />);
        expect(card.querySelector(".llm-chat-tool-call-error-badge")).not.toBeNull();
        expect(card.querySelector(".expandable-section.llm-chat-tool-call-error")).not.toBeNull();
    });
});

// --- parseResultNoteId edge cases -----------------------------------------------------------------

describe("ToolCallCard result-id parsing", () => {
    it("parses a noteId from an already-parsed (object) result", () => {
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "read_note",
            input: {},
            result: ({ noteId: "objId" } as unknown) as string
        }) ]} />);
        expect(card.querySelector(".note-link-stub")?.getAttribute("data-note-path")).toBe("objId");
    });

    it("ignores an unparseable result string and shows no note ref", () => {
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "read_note",
            input: {},
            result: "not json {{{"
        }) ]} />);
        expect(card.querySelector(".note-link-stub")).toBeNull();
    });
});

// --- Section body: input / streaming / result -----------------------------------------------------

describe("ToolCallCard section body", () => {
    it("renders an input key-value table and a result table for a completed call", () => {
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "search_notes",
            input: { query: "abc", limit: 5 },
            result: JSON.stringify({ count: 2 })
        }) ]} />);

        expect(card.querySelector(".llm-chat-tool-call-input")).not.toBeNull();
        expect(card.querySelector(".llm-chat-tool-call-result")).not.toBeNull();
        // Input table contains keys from the input object.
        const keys = Array.from(card.querySelectorAll(".llm-chat-tool-call-input .llm-chat-tool-call-table-key")).map(el => el.textContent);
        expect(keys).toEqual([ "query", "limit" ]);
    });

    it("renders the streaming placeholder and raw buffer while input streams", () => {
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "read_note",
            input: {},
            inputStreaming: "{\"partial\":"
        }) ]} />);

        const streaming = card.querySelector(".llm-chat-tool-call-input-streaming");
        expect(streaming).not.toBeNull();
        expect(streaming?.querySelector("pre")?.textContent).toBe("{\"partial\":");
        // No result block while still streaming.
        expect(card.querySelector(".llm-chat-tool-call-result")).toBeNull();
        // A streaming section is open by default.
        expect(card.querySelector("details.expandable-section")?.hasAttribute("open")).toBe(true);
    });

    it("marks the result block as an error when the call failed", () => {
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "read_note",
            input: { noteId: "n1" },
            result: JSON.stringify({ message: "boom" }),
            isError: true
        }) ]} />);
        expect(card.querySelector(".llm-chat-tool-call-result.llm-chat-tool-call-result-error")).not.toBeNull();
    });
});

// --- edit_note_content diff path ------------------------------------------------------------------

describe("ToolCallCard edit_note_content diff", () => {
    it("renders a unified diff instead of the input table for a small edit and opens it", () => {
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "edit_note_content",
            input: { edits: [ { oldText: "hello", newText: "world" } ] },
            result: JSON.stringify({ ok: true })
        }) ]} />);

        // Diff is rendered, the raw input table is not.
        expect(card.querySelector(".llm-diff")).not.toBeNull();
        expect(card.querySelector(".llm-chat-tool-call-input .llm-chat-tool-call-table")).toBeNull();
        // No result block for a successful (non-error) diff edit.
        expect(card.querySelector(".llm-chat-tool-call-result")).toBeNull();
        // Small edit → section open by default.
        expect(card.querySelector("details.expandable-section")?.hasAttribute("open")).toBe(true);
    });

    it("still shows the result block when an edit diff call errored", () => {
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "edit_note_content",
            input: { edits: [ { oldText: "a", newText: "b" } ] },
            result: JSON.stringify({ message: "failed" }),
            isError: true
        }) ]} />);
        expect(card.querySelector(".llm-diff")).not.toBeNull();
        expect(card.querySelector(".llm-chat-tool-call-result")).not.toBeNull();
    });

    it("leaves a large edit collapsed by default", () => {
        // 12 changed lines exceeds the small-edit limit (10).
        const oldText = Array.from({ length: 12 }, (_, i) => `old${i}`).join("\n");
        const newText = Array.from({ length: 12 }, (_, i) => `new${i}`).join("\n");
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "edit_note_content",
            input: { edits: [ { oldText, newText } ] },
            result: JSON.stringify({ ok: true })
        }) ]} />);
        expect(card.querySelector(".llm-diff")).not.toBeNull();
        expect(card.querySelector("details.expandable-section")?.hasAttribute("open")).toBe(false);
    });

    it("falls back to the input table when edit_note_content has invalid edits", () => {
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "edit_note_content",
            input: { edits: "not-an-array" },
            result: "{}"
        }) ]} />);
        // parseNoteContentEdits returns null → raw input table, no diff.
        expect(card.querySelector(".llm-diff")).toBeNull();
        expect(card.querySelector(".llm-chat-tool-call-input .llm-chat-tool-call-table")).not.toBeNull();
    });

    it("suppresses the diff while edit_note_content input is still streaming", () => {
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "edit_note_content",
            input: {},
            inputStreaming: "{\"edits\":["
        }) ]} />);
        expect(card.querySelector(".llm-diff")).toBeNull();
        expect(card.querySelector(".llm-chat-tool-call-input-streaming")).not.toBeNull();
    });
});

// --- KeyValueTable / ValueCell recursion ----------------------------------------------------------

describe("ToolCallCard value rendering", () => {
    function inputTable(input: Record<string, unknown>): HTMLElement {
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({ toolName: "x", input, result: "{}" }) ]} />);
        const table = card.querySelector<HTMLElement>(".llm-chat-tool-call-input .llm-chat-tool-call-table");
        if (!table) throw new Error("expected input table");
        return table;
    }

    it("renders primitives, null, nested objects and arrays of objects", () => {
        const table = inputTable({
            str: "text",
            num: 7,
            nothing: null,
            nested: { inner: "deep" },
            objArray: [ { a: 1 }, { a: 2 } ]
        });

        // Primitive value.
        const valueCells = table.querySelectorAll(":scope > tbody > tr > .llm-chat-tool-call-table-value");
        expect(valueCells.length).toBe(5);
        // Null → empty <pre/>.
        const nullCell = Array.from(table.querySelectorAll(":scope > tbody > tr")).find(tr => tr.querySelector(".llm-chat-tool-call-table-key")?.textContent === "nothing");
        expect(nullCell?.querySelector("pre")?.textContent).toBe("");
        // Nested object → nested table.
        const nestedTr = Array.from(table.querySelectorAll(":scope > tbody > tr")).find(tr => tr.querySelector(".llm-chat-tool-call-table-key")?.textContent === "nested");
        expect(nestedTr?.querySelector(".llm-chat-tool-call-table")).not.toBeNull();
        // Array of objects → table-array wrapper with two nested tables.
        const arrayWrapper = table.querySelector(".llm-chat-tool-call-table-array");
        expect(arrayWrapper?.querySelectorAll(".llm-chat-tool-call-table").length).toBe(2);
    });

    it("renders an empty array and an array of primitives", () => {
        const table = inputTable({ empty: [], prims: [ 1, "two", 3 ] });
        const cells = Array.from(table.querySelectorAll(":scope > tbody > tr"));
        const emptyTr = cells.find(tr => tr.querySelector(".llm-chat-tool-call-table-key")?.textContent === "empty");
        expect(emptyTr?.querySelector("pre")?.textContent).toBe("[]");
        const primsTr = cells.find(tr => tr.querySelector(".llm-chat-tool-call-table-key")?.textContent === "prims");
        expect(primsTr?.querySelector("pre")?.textContent).toBe("1, two, 3");
    });

    it("falls back to JSON beyond the max table depth", () => {
        // depth 0 (table) -> value at depth 1 (nested table) -> value at depth 2 hits the limit.
        const table = inputTable({ a: { b: { c: { d: 1 } } } });
        // The deepest object should be rendered as a JSON <pre> rather than a fourth nested table.
        const pres = Array.from(table.querySelectorAll("pre")).map(p => p.textContent);
        expect(pres.some(text => text?.includes("\"c\""))).toBe(true);
    });

    it("renders a primitive beyond max depth as a string", () => {
        // a (depth1 table) -> b (depth2 value) -> primitive string at the depth limit.
        const table = inputTable({ a: { b: { deep: "leaf" } } });
        const pres = Array.from(table.querySelectorAll("pre")).map(p => p.textContent);
        expect(pres.some(text => text?.includes("leaf"))).toBe(true);
    });

    it("renders a non-object result string as the raw input", () => {
        // A JSON string that parses to a primitive → KeyValueTable's non-object branch keeps the
        // original string (with its quotes), since `data` is still a string.
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "x",
            input: { val: 1 },
            result: "\"just a string\""
        }) ]} />);
        const resultPre = card.querySelector(".llm-chat-tool-call-result pre");
        expect(resultPre?.textContent).toBe("\"just a string\"");
    });

    it("renders a non-string, non-object result by JSON-stringifying it", () => {
        // Result is an array (already-parsed) → not a plain object → raw branch with JSON.stringify.
        const card = renderInto(<ToolCallCard toolCalls={[ makeToolCall({
            toolName: "x",
            input: { val: 1 },
            result: ([ 1, 2, 3 ] as unknown) as string
        }) ]} />);
        const resultPre = card.querySelector(".llm-chat-tool-call-result pre");
        expect(resultPre?.textContent).toContain("1");
        expect(resultPre?.textContent).toContain("3");
    });
});
