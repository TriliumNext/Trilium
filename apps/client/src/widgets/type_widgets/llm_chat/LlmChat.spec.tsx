import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Stub the chat hook so the component's own logic (chatNoteId sync, getData, onContentChange,
// triggerSave) is exercised in isolation from the real streaming hook.
const chatStub = {
    setChatNoteId: vi.fn(),
    getContent: vi.fn((): LlmChatContent => ({ version: 1, messages: [] })),
    clearMessages: vi.fn(),
    loadFromContent: vi.fn()
};
vi.mock("./useLlmChat.js", () => ({
    useLlmChat: vi.fn(() => chatStub)
}));

// Replace the heavy child widgets (CKEditor / ChatMessage trees) with lightweight stubs that
// surface the props the parent wires up.
vi.mock("./ChatMessageList.js", () => ({
    default: ({ className, emptyStateText }: { className?: string; emptyStateText?: string }) => (
        <div className={`stub-message-list ${className ?? ""}`} data-empty={emptyStateText} />
    )
}));
vi.mock("./ChatInputBar.js", () => ({
    default: ({ onWebSearchChange, onNoteToolsChange, onExtendedThinkingChange, onModelChange }: {
        onWebSearchChange?: () => void;
        onNoteToolsChange?: () => void;
        onExtendedThinkingChange?: () => void;
        onModelChange?: (model: string) => void;
    }) => (
        <div className="stub-input-bar">
            <button className="trigger-web" onClick={() => onWebSearchChange?.()} />
            <button className="trigger-note" onClick={() => onNoteToolsChange?.()} />
            <button className="trigger-think" onClick={() => onExtendedThinkingChange?.()} />
            <button className="trigger-model" onClick={() => onModelChange?.("m")} />
        </div>
    )
}));
vi.mock("../../../services/i18n.js", () => ({ t: (key: string) => key }));

import Component from "../../../components/component.js";
import type NoteContext from "../../../components/note_context.js";
import type FNote from "../../../entities/fnote.js";
import froca from "../../../services/froca.js";
import server from "../../../services/server.js";
import { buildNote } from "../../../test/easy-froca.js";
import { flush } from "../../../test/render-hook.js";
import { NoteContextContext, ParentComponent } from "../../react/react_utils.js";
import type { TypeWidgetProps } from "../type_widget.js";
import LlmChat from "./LlmChat.js";
import type { LlmChatContent } from "./llm_chat_types.js";

// --- Render harness -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;

function renderChat(props: Partial<TypeWidgetProps>, noteContext: NoteContext | null = null) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    container = host;
    const parent = new Component();
    const draw = (p: Partial<TypeWidgetProps>) => act(() => {
        render(
            <ParentComponent.Provider value={parent}>
                <NoteContextContext.Provider value={noteContext}>
                    <LlmChat {...(p as TypeWidgetProps)} />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>,
            host
        );
    });
    draw(props);
    return { container: host, parent, rerender: draw };
}

function fakeNoteContext(overrides: Record<string, unknown> = {}): NoteContext {
    return {
        ntxId: "ntx1",
        setContextData: vi.fn(),
        getContextData: vi.fn(),
        ...overrides
    } as unknown as NoteContext;
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    chatStub.getContent.mockReturnValue({ version: 1, messages: [] });
    Object.assign(server, { put: vi.fn(async () => undefined) });
});

afterEach(async () => {
    await act(async () => {});
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("LlmChat", () => {
    it("renders the container with the message list and input bar stubs", () => {
        const note = buildNote({ id: "chat1", title: "Chat", type: "text", content: "" }) as unknown as FNote;
        const { container } = renderChat({ note, ntxId: "ntx1", noteContext: undefined });

        const root = container.querySelector(".llm-chat-container");
        expect(root).not.toBeNull();
        expect(container.querySelector(".stub-message-list")).not.toBeNull();
        expect(container.querySelector(".stub-input-bar")).not.toBeNull();
        // emptyStateText prop is forwarded (key passes through the mocked t()).
        expect(container.querySelector(".stub-message-list")?.getAttribute("data-empty")).toBe("llm_chat.empty_state");
    });

    it("syncs the chat note id on mount and again when the note changes", () => {
        const noteA = buildNote({ id: "noteA", title: "A", content: "" }) as unknown as FNote;
        const { rerender } = renderChat({ note: noteA, ntxId: "ntx1", noteContext: undefined });
        // mount effect: setChatNoteId(note.noteId)
        expect(chatStub.setChatNoteId).toHaveBeenCalledWith("noteA");

        chatStub.setChatNoteId.mockClear();
        const noteB = buildNote({ id: "noteB", title: "B", content: "" }) as unknown as FNote;
        // Re-render the SAME mount with a different note to trigger the [note?.noteId] effect.
        rerender({ note: noteB, ntxId: "ntx1", noteContext: undefined });
        expect(chatStub.setChatNoteId).toHaveBeenCalledWith("noteB");
    });

    it("loads parsed content from a non-empty blob via onContentChange", async () => {
        const stored = {
            version: 1,
            messages: [ { id: "m1", role: "user", content: "hello", createdAt: "2026-01-01" } ],
            selectedModel: "gpt"
        };
        const note = buildNote({ id: "withContent", title: "C", content: JSON.stringify(stored) }) as unknown as FNote;
        renderChat({ note, ntxId: "ntx1", noteContext: undefined });
        await flush();

        expect(chatStub.loadFromContent).toHaveBeenCalledTimes(1);
        expect(chatStub.loadFromContent).toHaveBeenCalledWith(expect.objectContaining({ selectedModel: "gpt" }));
        expect(chatStub.clearMessages).not.toHaveBeenCalled();
    });

    it("clears messages when the blob content is empty", async () => {
        const note = buildNote({ id: "empty", title: "E", content: "" }) as unknown as FNote;
        renderChat({ note, ntxId: "ntx1", noteContext: undefined });
        await flush();

        expect(chatStub.clearMessages).toHaveBeenCalledTimes(1);
        expect(chatStub.loadFromContent).not.toHaveBeenCalled();
    });

    it("clears messages and logs when the blob content is invalid JSON", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const note = buildNote({ id: "bad", title: "B", content: "{not valid json" }) as unknown as FNote;
        renderChat({ note, ntxId: "ntx1", noteContext: undefined });
        await flush();

        expect(chatStub.loadFromContent).not.toHaveBeenCalled();
        expect(chatStub.clearMessages).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalled();
    });

    it("getData (passed to the spaced update) serializes chat.getContent into the saved payload", async () => {
        const note = buildNote({ id: "save1", title: "S", type: "llmChat", content: "" }) as unknown as FNote;
        chatStub.getContent.mockReturnValue({ version: 1, messages: [], selectedModel: "claude" });
        const ctx = fakeNoteContext({ ntxId: "ntx1" });
        const { container, parent } = renderChat({ note, ntxId: "ntx1", noteContext: ctx }, ctx);
        await flush();

        const put = server.put as ReturnType<typeof vi.fn>;
        put.mockClear();

        // Schedule a change via triggerSave, then force an immediate flush through a tab-switch
        // event. updateNowIfNecessary() calls getData() -> server.put with the serialized content.
        const trigger = container.querySelector<HTMLButtonElement>(".trigger-model");
        act(() => trigger?.click());
        await act(async () => {
            await (parent.handleEventInChildren as unknown as (n: string, d: unknown) => Promise<void>)(
                "beforeNoteSwitch",
                { noteContext: { ntxId: "ntx1" } }
            );
        });

        const dataSaveCall = put.mock.calls.find(([url]) => String(url).startsWith("notes/save1/data"));
        expect(dataSaveCall).toBeDefined();
        if (dataSaveCall) {
            const payload = dataSaveCall[1] as { content: string };
            expect(JSON.parse(payload.content)).toMatchObject({ selectedModel: "claude" });
        }
    });

    it("triggerSave wired into the input-bar callbacks schedules an update (server.put)", async () => {
        const note = buildNote({ id: "trig", title: "T", type: "llmChat", content: "" }) as unknown as FNote;
        chatStub.getContent.mockReturnValue({ version: 1, messages: [], enableWebSearch: false });
        const ctx = fakeNoteContext({ ntxId: "ntx1" });
        const { container } = renderChat({ note, ntxId: "ntx1", noteContext: ctx }, ctx);
        await flush();

        const put = server.put as ReturnType<typeof vi.fn>;
        put.mockClear();

        // Each input-bar callback funnels into triggerSave -> spacedUpdate.scheduleUpdate.
        for (const cls of [ ".trigger-web", ".trigger-note", ".trigger-think", ".trigger-model" ]) {
            const btn = container.querySelector<HTMLButtonElement>(cls);
            expect(btn).not.toBeNull();
            act(() => btn?.click());
        }
        // Let the spaced update's debounce flush.
        await act(async () => { await new Promise(r => setTimeout(r, 1100)); });

        const saved = put.mock.calls.some(([url]) => String(url).startsWith("notes/trig/data"));
        expect(saved).toBe(true);
    });
});
