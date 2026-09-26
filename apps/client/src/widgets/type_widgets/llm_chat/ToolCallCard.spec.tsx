import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/i18n.js", () => ({
    t: (key: string, options?: { defaultValue?: string }) => (key.startsWith("llm.tools.") ? key.slice("llm.tools.".length) : options?.defaultValue ?? key)
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
});
