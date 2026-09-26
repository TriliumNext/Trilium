import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/i18n.js", () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
        if (key.startsWith("llm.tools.")) return key.slice("llm.tools.".length);
        return options?.defaultValue ?? (options ? `${key}${JSON.stringify(options)}` : key);
    }
}));
vi.mock("react-i18next", () => ({
    Trans: ({ i18nKey, components }: { i18nKey: string; components: Record<string, preact.ComponentChildren> }) =>
        <>{i18nKey}{Object.values(components)}</>
}));
const mocks = vi.hoisted(() => ({ triggerEvent: vi.fn() }));
vi.mock("../../../components/app_context.js", () => ({ default: { triggerEvent: mocks.triggerEvent } }));
vi.mock("../../react/NoteLink.js", () => ({
    NewNoteLink: ({ notePath }: { notePath: string }) => <a className="note-link-stub">{notePath}</a>
}));

import ToolCallCard from "./ToolCallCard.js";
import type { ToolCall } from "./llm_chat_types.js";

let host: HTMLElement | undefined;

afterEach(() => {
    mocks.triggerEvent.mockClear();
    if (host) {
        render(null, host);
        host.remove();
        host = undefined;
    }
});

function renderCard(toolCalls: ToolCall[]) {
    host = document.body.appendChild(document.createElement("div"));
    const target = host;
    act(() => render(<ToolCallCard toolCalls={toolCalls} />, target));
    return target;
}

describe("ToolCallCard", () => {
    it("shows what a call looked for: the name, the query, or the page it read", () => {
        const card = renderCard([
            { id: "1", toolName: "search_icons", input: { query: "rocket" }, result: "[]" },
            { id: "2", toolName: "web_search", input: { query: "weather Sibiu" }, result: "Sunny" },
            { id: "3", toolName: "read_web_page", input: { url: "https://triliumnotes.org" }, result: "Fetched" }
        ]);
        expect([ ...card.querySelectorAll(".llm-chat-tool-call-detail") ].map(detail => detail.textContent))
            .toEqual([ "rocket", "weather Sibiu", "https://triliumnotes.org" ]);
    });

    it("lists the calls as bare lines, folding only those with something to show inline", () => {
        const target = renderCard([
            { id: "1", toolName: "get_note", input: { noteId: "a" }, result: "{}" },
            { id: "2", toolName: "get_note", input: { noteId: "b" }, result: "{}" },
            { id: "3", toolName: "web_search", input: { query: "rocket" }, result: "Sunny" }
        ]);
        expect(target.querySelector(".expandable-card")).toBeNull();
        const lines = [ ...(target.querySelector(".llm-chat-tool-calls")?.children ?? []) ];
        expect(lines.map(line => line.classList.contains("llm-chat-tool-call"))).toEqual([ true, true ]);
        expect(lines.map(line => line instanceof HTMLDetailsElement)).toEqual([ true, false ]);
        const grouped = lines[0]?.querySelectorAll(".expandable-section-body > .llm-chat-tool-call");
        expect([ ...(grouped ?? []) ].map(line => line instanceof HTMLDetailsElement)).toEqual([ false, false ]);
        expect(target.textContent).not.toContain("Sunny");
    });

    it("opens the input and result of a call in a dialog", () => {
        const call: ToolCall = { id: "1", toolName: "web_search", input: { query: "rocket" }, result: "Sunny" };
        const target = renderCard([ call ]);
        const button = target.querySelector<HTMLButtonElement>(".llm-chat-tool-call-debug");
        expect(button).not.toBeNull();
        act(() => button?.click());
        expect(mocks.triggerEvent).toHaveBeenCalledExactlyOnceWith("showToolCallDetails", { toolCall: call });
    });

    it("shows why a call failed inline, and opening the dialog leaves the line folded", () => {
        const target = renderCard([ {
            id: "1",
            toolName: "get_note",
            input: { noteId: "a" },
            result: JSON.stringify({ error: "Note not found" }),
            isError: true
        } ]);
        const line = target.querySelector("details.llm-chat-tool-call");
        expect(line?.querySelector(".llm-chat-tool-call-error-message")?.textContent).toBe("Note not found");

        act(() => line?.querySelector<HTMLButtonElement>(".llm-chat-tool-call-debug")?.click());
        expect(mocks.triggerEvent).toHaveBeenCalledOnce();
        expect((line as HTMLDetailsElement | null)?.open).toBe(false);
    });

    it("lists the notes a search found, with their parents and a plain preview", () => {
        const target = renderCard([ {
            id: "1",
            toolName: "search_notes",
            input: { query: "rocket", limit: 2 },
            result: JSON.stringify({
                totalResults: 42,
                results: [
                    { noteId: "a", title: "Apollo", type: "text", parentTitle: "Space", contentPreview: "## Launch\n\nThe **Saturn V** [rocket](https://x.org)" },
                    { noteId: "b", title: "Big", type: "text", parentTitle: null, contentPreview: "[12KB - use get_note_content for full text]" }
                ]
            })
        } ]);
        const line = target.querySelector("details.llm-chat-tool-call");
        expect(line?.querySelector(".llm-chat-tool-call-result-count")?.textContent).toBe("llm_chat.search_notes_count{\"count\":42}");

        const rows = [ ...(line?.querySelectorAll(".llm-chat-note-result") ?? []) ];
        expect(rows.map(row => ({
            note: row.querySelector(".note-link-stub")?.textContent,
            parent: row.querySelector(".llm-chat-note-result-parent")?.textContent ?? null,
            preview: row.querySelector(".llm-chat-note-result-preview")?.textContent ?? null
        }))).toEqual([
            { note: "a", parent: "Space", preview: "Launch The Saturn V rocket" },
            { note: "b", parent: null, preview: null }
        ]);
        expect(line?.querySelector(".llm-chat-note-results-scope")).toBeNull();
        expect(line?.querySelector(".llm-chat-note-results-more")?.textContent)
            .toBe("llm_chat.search_notes_limited{\"count\":42,\"limit\":2}");
    });

    it("names the subtree a search was confined to, even when it found nothing there", () => {
        const target = renderCard([
            {
                id: "1",
                toolName: "search_notes",
                input: { query: "a", ancestorNoteId: "scope" },
                result: JSON.stringify({ totalResults: 12, results: [ { noteId: "a" } ] })
            },
            {
                id: "2",
                toolName: "search_notes",
                input: { query: "b", ancestorNoteId: "scope" },
                result: JSON.stringify({ totalResults: 0, results: [] })
            }
        ]);
        const lines = [ ...(target.querySelector(".llm-chat-tool-calls")?.children ?? []) ];
        expect(lines.map(line => line instanceof HTMLDetailsElement)).toEqual([ true ]);
        const groupedLines = [ ...(lines[0]?.querySelectorAll(".expandable-section-body > .llm-chat-tool-call") ?? []) ];
        expect(groupedLines.map(line => line instanceof HTMLDetailsElement)).toEqual([ true, true ]);
        expect(groupedLines.map(line => line.querySelector(".llm-chat-note-results-scope .note-link-stub")?.textContent))
            .toEqual([ "scope", "scope" ]);
        expect(groupedLines[0]?.querySelector(".llm-chat-note-results-more")?.textContent)
            .toBe("llm_chat.search_notes_limited{\"count\":12,\"limit\":1}");
    });

    it("keeps a search that found nothing, or returned something unexpected, to a plain line", () => {
        const target = renderCard([
            { id: "1", toolName: "search_notes", input: { query: "a", ancestorNoteId: "root" }, result: JSON.stringify({ totalResults: 0, results: [] }) },
            { id: "2", toolName: "get_note", input: { noteId: "x" }, result: "{}" },
            { id: "3", toolName: "search_notes", input: { query: "b" }, result: "not json" }
        ]);
        const lines = [ ...(target.querySelector(".llm-chat-tool-calls")?.children ?? []) ];
        expect(lines.map(line => line instanceof HTMLDetailsElement)).toEqual([ false, false, false ]);
        expect(lines[0]?.querySelector(".llm-chat-tool-call-result-count")?.textContent).toBe("llm_chat.search_notes_count{\"count\":0}");
        expect(target.querySelector(".llm-chat-note-result")).toBeNull();
    });
});
