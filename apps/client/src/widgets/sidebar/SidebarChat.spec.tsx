import { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderComponent, resetFroca } from "../../test/render";

// --- Hoisted shared state -------------------------------------------------------------------------
// Everything referenced inside a vi.mock factory must be created via vi.hoisted,
// because the factories are hoisted above ordinary module-level declarations.

const h = vi.hoisted(() => {
    return {
        // A controllable fake of the LLM chat hook. Tests mutate these fields and
        // assert on the spies to verify the component's wiring.
        chatState: {
            input: "",
            isStreaming: false,
            messages: [] as unknown[],
            handleSubmit: vi.fn(async () => undefined),
            setContextNoteId: vi.fn(),
            setChatNoteId: vi.fn(),
            loadFromContent: vi.fn(),
            clearMessages: vi.fn(),
            getContent: vi.fn(() => ({ version: 1, messages: [] as unknown[] }))
        },
        dateNotesMock: {
            getMostRecentLlmChat: vi.fn(async () => null as { noteId: string } | null),
            getOrCreateLlmChat: vi.fn(async () => null as { noteId: string } | null),
            createLlmChat: vi.fn(async () => null as { noteId: string } | null),
            getRecentLlmChats: vi.fn(async () => [] as { noteId: string; title: string; dateModified: string }[])
        },
        tabManagerMock: {
            getActiveContext: vi.fn(() => null as unknown),
            openInNewTab: vi.fn()
        },
        dropdownHideSpyTarget: { hide: vi.fn() },
        // Capture slots populated by the stub components when they render.
        capture: {
            lastOnMessagesChange: undefined as (() => void) | undefined,
            lastMessageListProps: undefined as Record<string, unknown> | undefined,
            lastInputBarProps: undefined as { onSubmit: (e: Event) => void; activeNoteId?: string; activeNoteTitle?: string } | undefined
        }
    };
});

const chatState = h.chatState;
const dateNotesMock = h.dateNotesMock;
const tabManagerMock = h.tabManagerMock;
const dropdownHideSpyTarget = h.dropdownHideSpyTarget;

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("../type_widgets/llm_chat/useLlmChat.js", () => ({
    useLlmChat: (onMessagesChange?: () => void) => {
        // Expose the onMessagesChange callback so a test can trigger a save.
        h.capture.lastOnMessagesChange = onMessagesChange;
        return h.chatState;
    }
}));

// Lightweight stub for ChatMessageList — just record the props it received.
vi.mock("../type_widgets/llm_chat/ChatMessageList.js", () => ({
    default: (props: Record<string, unknown>) => {
        h.capture.lastMessageListProps = props;
        return <div className="stub-message-list" />;
    }
}));

// Stub ChatInputBar exposing an onSubmit trigger button.
vi.mock("../type_widgets/llm_chat/ChatInputBar.js", () => ({
    default: (props: { onSubmit: (e: Event) => void; activeNoteId?: string; activeNoteTitle?: string }) => {
        h.capture.lastInputBarProps = props;
        return (
            <button
                className="stub-input-submit"
                onClick={(e) => props.onSubmit(e as unknown as Event)}
            />
        );
    }
}));

// Stub RightPanelWidget — render title, buttons and children flat so tests can reach them.
vi.mock("./RightPanelWidget.js", () => ({
    default: ({ title, buttons, children }: { title: string; buttons: ComponentChildren; children: ComponentChildren }) => (
        <div className="stub-right-panel">
            <div className="stub-title">{title}</div>
            <div className="stub-buttons">{buttons}</div>
            <div className="stub-children">{children}</div>
        </div>
    )
}));

// Stub ActionButton as a plain button preserving onClick / disabled and a data-icon attribute.
vi.mock("../react/ActionButton.js", () => ({
    default: ({ icon, onClick, disabled }: { icon: string; onClick?: () => void; disabled?: boolean }) => (
        <button className="stub-action" data-icon={icon} disabled={disabled} onClick={onClick} />
    )
}));

// Stub Dropdown — render children, expose onShown via a trigger, and populate dropdownRef.
vi.mock("../react/Dropdown.js", () => ({
    default: (props: {
        children: ComponentChildren;
        onShown?: () => void;
        dropdownRef?: { current: unknown };
    }) => {
        if (props.dropdownRef) {
            props.dropdownRef.current = dropdownHideSpyTarget;
        }
        return (
            <div className="stub-dropdown">
                <button className="stub-dropdown-trigger" onClick={() => props.onShown?.()} />
                {props.children}
            </div>
        );
    }
}));

// Stub FormList items so list rendering is trivial DOM.
vi.mock("../react/FormList.js", () => ({
    FormListItem: ({ children, onClick, className, disabled }: { children: ComponentChildren; onClick?: () => void; className?: string; disabled?: boolean }) => (
        <div className={`stub-list-item ${className ?? ""} ${disabled ? "disabled" : ""}`} onClick={onClick}>
            {children}
        </div>
    ),
    FormDropdownDivider: () => <div className="stub-divider" />
}));

// date_notes service — controllable per test (hoisted mock object).
vi.mock("../../services/date_notes.js", () => ({ default: h.dateNotesMock }));

// app_context — fake tabManager (hoisted mock object).
vi.mock("../../components/app_context.js", () => ({ default: { tabManager: h.tabManagerMock } }));

import appContext from "../../components/app_context";
import server from "../../services/server";
import { buildNote } from "../../test/easy-froca";
import SidebarChat from "./SidebarChat";

// --- Render helper --------------------------------------------------------------------------------

async function renderSidebar() {
    const { container } = renderComponent(<SidebarChat />);
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
    });
    return container;
}

beforeEach(() => {
    vi.clearAllMocks();
    // Wipe froca between tests so the chat-note lookups below never leak.
    resetFroca();

    // setup.ts mocks server.get/post with fixed behaviour; replace get/post with
    // controllable spies (put is already an inert vi.fn from setup.ts, cleared each test).
    Object.assign(server, {
        get: vi.fn(async () => undefined),
        post: vi.fn(async () => undefined)
    });

    // Reset chat state to defaults.
    chatState.input = "";
    chatState.isStreaming = false;
    chatState.messages = [];

    // Default date_notes behaviour: no existing chat.
    dateNotesMock.getMostRecentLlmChat.mockResolvedValue(null);
    dateNotesMock.getOrCreateLlmChat.mockResolvedValue(null);
    dateNotesMock.createLlmChat.mockResolvedValue(null);
    dateNotesMock.getRecentLlmChats.mockResolvedValue([]);

    tabManagerMock.getActiveContext.mockReturnValue(null);
});

/**
 * Registers an "existing chat" note id so that `useNote(chatNoteId)` resolves
 * synchronously from froca (never hitting the throwing mock server) and the
 * blob fetch returns the given parsed content.
 */
function setupExistingChat(noteId: string, content: unknown = { version: 1, messages: [] }) {
    buildNote({ id: noteId, title: `Chat ${noteId}`, type: "text" });
    dateNotesMock.getMostRecentLlmChat.mockResolvedValue({ noteId });
    (server.get as ReturnType<typeof vi.fn>).mockResolvedValue({ content: JSON.stringify(content) });
}

// --- Tests ----------------------------------------------------------------------------------------

describe("SidebarChat", () => {
    it("renders the title fallback, buttons and child components on a fresh mount", async () => {
        const root = await renderSidebar();

        // Title element is present (the fallback i18n string may be empty in tests).
        expect(root.querySelector(".stub-title")).toBeTruthy();

        // Three action-ish buttons in the header: new chat, history dropdown, save.
        const icons = Array.from(root.querySelectorAll(".stub-action")).map(b => b.getAttribute("data-icon"));
        expect(icons).toContain("bx bx-plus");
        expect(icons).toContain("bx bx-save");

        // Save button disabled when there are no messages.
        const saveBtn = root.querySelector(".stub-action[data-icon='bx bx-save']");
        expect(saveBtn?.hasAttribute("disabled")).toBe(true);

        // Child message list + input bar are rendered.
        expect(root.querySelector(".stub-message-list")).toBeTruthy();
        expect(root.querySelector(".stub-input-submit")).toBeTruthy();

        // Initial effects: context note id synced (undefined when no active note), chat note id synced.
        expect(chatState.setContextNoteId).toHaveBeenCalled();
        expect(chatState.setChatNoteId).toHaveBeenCalled();
    });

    it("loads the most recent chat with content on mount", async () => {
        setupExistingChat("chat1");

        await renderSidebar();

        expect(dateNotesMock.getMostRecentLlmChat).toHaveBeenCalled();
        expect(server.get).toHaveBeenCalledWith("notes/chat1/blob");
        expect(chatState.loadFromContent).toHaveBeenCalledWith({ version: 1, messages: [] });
    });

    it("clears messages on mount when there is no existing chat", async () => {
        dateNotesMock.getMostRecentLlmChat.mockResolvedValue(null);

        await renderSidebar();

        expect(chatState.clearMessages).toHaveBeenCalled();
    });

    it("swallows blob-load errors during mount", async () => {
        buildNote({ id: "chatErr", title: "Chat Err", type: "text" });
        dateNotesMock.getMostRecentLlmChat.mockResolvedValue({ noteId: "chatErr" });
        (server.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await renderSidebar();

        // The chat note id was still set even though blob load failed.
        expect(server.get).toHaveBeenCalledWith("notes/chatErr/blob");
        expect(errSpy).toHaveBeenCalled();
    });

    it("swallows a top-level getMostRecentLlmChat rejection on mount", async () => {
        dateNotesMock.getMostRecentLlmChat.mockRejectedValue(new Error("offline"));
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await renderSidebar();

        expect(errSpy).toHaveBeenCalled();
    });

    it("creates a new chat via the plus button (handleNewChat)", async () => {
        buildNote({ id: "new1", title: "New Chat", type: "text" });
        dateNotesMock.createLlmChat.mockResolvedValue({ noteId: "new1" });
        const root = await renderSidebar();

        const newBtn = root.querySelector(".stub-action[data-icon='bx bx-plus']");
        await act(async () => {
            (newBtn as HTMLButtonElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        expect(dateNotesMock.createLlmChat).toHaveBeenCalled();
        expect(chatState.clearMessages).toHaveBeenCalled();
    });

    it("logs an error when creating a new chat fails", async () => {
        dateNotesMock.createLlmChat.mockRejectedValue(new Error("fail-new"));
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const root = await renderSidebar();

        const newBtn = root.querySelector(".stub-action[data-icon='bx bx-plus']");
        await act(async () => {
            (newBtn as HTMLButtonElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        expect(errSpy).toHaveBeenCalled();
    });

    it("saves the current chat to a permanent location and starts a fresh one", async () => {
        // Need messages so the save button is enabled and an existing chat note id.
        chatState.messages = [{ id: "m1" }];
        setupExistingChat("chatToPersist");
        buildNote({ id: "afterSave", title: "After Save", type: "text" });
        dateNotesMock.createLlmChat.mockResolvedValue({ noteId: "afterSave" });
        const root = await renderSidebar();

        const saveBtn = root.querySelector(".stub-action[data-icon='bx bx-save']");
        expect(saveBtn?.hasAttribute("disabled")).toBe(false);

        await act(async () => {
            (saveBtn as HTMLButtonElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        expect(server.post).toHaveBeenCalledWith("special-notes/save-llm-chat", { llmChatNoteId: expect.anything() });
    });

    it("does nothing in handleSaveChat when there is no chat note", async () => {
        // No existing chat note id (getMostRecentLlmChat -> null), messages present to enable button.
        chatState.messages = [{ id: "m1" }];
        const root = await renderSidebar();

        const saveBtn = root.querySelector(".stub-action[data-icon='bx bx-save']");
        await act(async () => {
            (saveBtn as HTMLButtonElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        expect(server.post).not.toHaveBeenCalledWith("special-notes/save-llm-chat", expect.anything());
    });

    it("logs an error when saving the chat fails", async () => {
        setupExistingChat("chatToSave");
        (server.post as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("save-fail"));
        chatState.messages = [{ id: "m1" }];
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const root = await renderSidebar();

        const saveBtn = root.querySelector(".stub-action[data-icon='bx bx-save']");
        await act(async () => {
            (saveBtn as HTMLButtonElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        expect(errSpy).toHaveBeenCalled();
    });

    it("submits a message, lazily creating a chat note (handleSubmit)", async () => {
        chatState.input = "hello";
        chatState.isStreaming = false;
        buildNote({ id: "lazy1", title: "Lazy", type: "text" });
        dateNotesMock.getOrCreateLlmChat.mockResolvedValue({ noteId: "lazy1" });
        const root = await renderSidebar();

        const submit = root.querySelector(".stub-input-submit");
        await act(async () => {
            (submit as HTMLButtonElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        expect(dateNotesMock.getOrCreateLlmChat).toHaveBeenCalled();
        expect(chatState.setChatNoteId).toHaveBeenCalledWith("lazy1");
        expect(chatState.handleSubmit).toHaveBeenCalled();
    });

    it("does not submit when input is empty or streaming", async () => {
        chatState.input = "   "; // whitespace -> trimmed empty
        const root = await renderSidebar();

        const submit = root.querySelector(".stub-input-submit");
        await act(async () => {
            (submit as HTMLButtonElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        expect(chatState.handleSubmit).not.toHaveBeenCalled();
        expect(dateNotesMock.getOrCreateLlmChat).not.toHaveBeenCalled();
    });

    it("aborts submit and logs when lazy chat creation throws", async () => {
        chatState.input = "hi";
        dateNotesMock.getOrCreateLlmChat.mockRejectedValue(new Error("create-fail"));
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const root = await renderSidebar();

        const submit = root.querySelector(".stub-input-submit");
        await act(async () => {
            (submit as HTMLButtonElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        expect(errSpy).toHaveBeenCalled();
        expect(chatState.handleSubmit).not.toHaveBeenCalled();
    });

    it("aborts submit when getOrCreateLlmChat resolves to no note", async () => {
        chatState.input = "hi";
        dateNotesMock.getOrCreateLlmChat.mockResolvedValue(null);
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const root = await renderSidebar();

        const submit = root.querySelector(".stub-input-submit");
        await act(async () => {
            (submit as HTMLButtonElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        // "Cannot send message" path: handleSubmit not delegated.
        expect(chatState.handleSubmit).not.toHaveBeenCalled();
        expect(errSpy).toHaveBeenCalled();
    });

    it("submits directly when a chat note already exists (skips lazy creation)", async () => {
        setupExistingChat("existing1");
        chatState.input = "yo";
        const root = await renderSidebar();

        const submit = root.querySelector(".stub-input-submit");
        await act(async () => {
            (submit as HTMLButtonElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        expect(dateNotesMock.getOrCreateLlmChat).not.toHaveBeenCalled();
        expect(chatState.setChatNoteId).toHaveBeenCalledWith("existing1");
        expect(chatState.handleSubmit).toHaveBeenCalled();
    });

    it("opens the history dropdown which loads recent chats and renders the empty state", async () => {
        dateNotesMock.getRecentLlmChats.mockResolvedValue([]);
        const root = await renderSidebar();

        const trigger = root.querySelector(".stub-dropdown-trigger");
        await act(async () => {
            (trigger as HTMLButtonElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        expect(dateNotesMock.getRecentLlmChats).toHaveBeenCalledWith(10);
        // The "no chats" placeholder list item is present, plus the "view all" item.
        expect(root.querySelectorAll(".stub-list-item").length).toBeGreaterThanOrEqual(1);
    });

    it("logs an error when loading recent chats fails", async () => {
        dateNotesMock.getRecentLlmChats.mockRejectedValue(new Error("recents-fail"));
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const root = await renderSidebar();

        const trigger = root.querySelector(".stub-dropdown-trigger");
        await act(async () => {
            (trigger as HTMLButtonElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        expect(errSpy).toHaveBeenCalled();
    });

    it("renders the recent chats list with active highlighting and selects another chat", async () => {
        setupExistingChat("active-chat");
        buildNote({ id: "other-chat", title: "Other Note", type: "text" });
        dateNotesMock.getRecentLlmChats.mockResolvedValue([
            { noteId: "active-chat", title: "Active", dateModified: new Date().toISOString() },
            { noteId: "other-chat", title: "Other", dateModified: new Date().toISOString() }
        ]);
        const root = await renderSidebar();

        const trigger = root.querySelector(".stub-dropdown-trigger");
        await act(async () => {
            (trigger as HTMLButtonElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        // One active item (matches current chat note id).
        expect(root.querySelector(".stub-list-item.active")).toBeTruthy();
        // strong tag for the active item title, span for the inactive one.
        expect(root.querySelector(".stub-list-item.active strong")?.textContent).toBe("Active");

        // Clear earlier loadFromContent calls, then select the other (non-active) chat.
        chatState.loadFromContent.mockClear();
        (server.get as ReturnType<typeof vi.fn>).mockResolvedValue({ content: JSON.stringify({ version: 1, messages: [{ id: "x" }] }) });

        const items = Array.from(root.querySelectorAll(".stub-list-item"));
        const otherItem = items.find(i => i.textContent?.includes("Other"));
        await act(async () => {
            (otherItem as HTMLElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        expect(server.get).toHaveBeenCalledWith("notes/other-chat/blob");
        expect(chatState.loadFromContent).toHaveBeenCalled();
        expect(dropdownHideSpyTarget.hide).toHaveBeenCalled();
    });

    it("ignores selecting the chat that is already active", async () => {
        setupExistingChat("same-chat");
        dateNotesMock.getRecentLlmChats.mockResolvedValue([
            { noteId: "same-chat", title: "Same", dateModified: new Date().toISOString() }
        ]);
        const root = await renderSidebar();

        const trigger = root.querySelector(".stub-dropdown-trigger");
        await act(async () => {
            (trigger as HTMLButtonElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        (server.get as ReturnType<typeof vi.fn>).mockClear();
        const activeItem = root.querySelector(".stub-list-item.active");
        await act(async () => {
            (activeItem as HTMLElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        // No blob fetch for the already-active chat.
        expect(server.get).not.toHaveBeenCalledWith("notes/same-chat/blob");
        // Dropdown still hidden though.
        expect(dropdownHideSpyTarget.hide).toHaveBeenCalled();
    });

    it("logs an error when selecting a chat fails to load", async () => {
        dateNotesMock.getRecentLlmChats.mockResolvedValue([
            { noteId: "broken-chat", title: "Broken", dateModified: new Date().toISOString() }
        ]);
        const root = await renderSidebar();

        const trigger = root.querySelector(".stub-dropdown-trigger");
        await act(async () => {
            (trigger as HTMLButtonElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        (server.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("blob-fail"));
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

        const item = root.querySelector(".stub-list-item:not(.disabled)");
        await act(async () => {
            (item as HTMLElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        expect(errSpy).toHaveBeenCalled();
    });

    it("opens all chats in a new tab via the view-all item", async () => {
        dateNotesMock.getRecentLlmChats.mockResolvedValue([]);
        const root = await renderSidebar();

        const trigger = root.querySelector(".stub-dropdown-trigger");
        await act(async () => {
            (trigger as HTMLButtonElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        // The last list item is the "view all chats" entry.
        const items = Array.from(root.querySelectorAll(".stub-list-item"));
        const viewAll = items[items.length - 1];
        await act(async () => {
            (viewAll as HTMLElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        expect(appContext.tabManager.openInNewTab).toHaveBeenCalledWith("_llmChat", "_llmChat", true);
        expect(dropdownHideSpyTarget.hide).toHaveBeenCalled();
    });

    it("triggers a save via the onMessagesChange callback (spaced update -> server.put)", async () => {
        setupExistingChat("save-target");
        buildNote({ id: "after-save", title: "After", type: "text" });
        dateNotesMock.createLlmChat.mockResolvedValue({ noteId: "after-save" });
        chatState.getContent.mockReturnValue({ version: 1, messages: [{ id: "m" }] });
        const root = await renderSidebar();

        // Fire the change callback the component passed into useLlmChat — this
        // marks the spaced-update dirty (scheduleUpdate).
        await act(async () => {
            h.capture.lastOnMessagesChange?.();
        });

        // Clicking "New chat" calls spacedUpdate.updateNowIfNecessary(), which
        // synchronously flushes the pending save (server.put) before switching.
        const newBtn = root.querySelector(".stub-action[data-icon='bx bx-plus']");
        await act(async () => {
            (newBtn as HTMLButtonElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        expect(server.put).toHaveBeenCalledWith(
            "notes/save-target/data",
            expect.objectContaining({ content: expect.any(String) })
        );
    });

    it("logs an error when the spaced-update save (server.put) fails", async () => {
        setupExistingChat("put-fail-target");
        buildNote({ id: "after-put-fail", title: "After", type: "text" });
        dateNotesMock.createLlmChat.mockResolvedValue({ noteId: "after-put-fail" });
        chatState.getContent.mockReturnValue({ version: 1, messages: [{ id: "m" }] });
        (server.put as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("put-fail"));
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const root = await renderSidebar();

        await act(async () => {
            h.capture.lastOnMessagesChange?.();
        });

        const newBtn = root.querySelector(".stub-action[data-icon='bx bx-plus']");
        await act(async () => {
            (newBtn as HTMLButtonElement).click();
            await new Promise(r => setTimeout(r, 0));
        });

        // The save callback caught and logged the server.put rejection.
        expect(server.put).toHaveBeenCalled();
        expect(errSpy).toHaveBeenCalled();
    });

    it("forwards the active note id and title to the message list and input bar", async () => {
        const fakeNote = { noteId: "activeN", title: "Active Note" };
        tabManagerMock.getActiveContext.mockReturnValue({
            ntxId: "ntx1",
            note: fakeNote,
            notePath: "root/activeN",
            hoistedNoteId: "root",
            viewScope: { viewMode: "default" }
        });
        await renderSidebar();

        expect(h.capture.lastInputBarProps?.activeNoteId).toBe("activeN");
        expect(h.capture.lastInputBarProps?.activeNoteTitle).toBe("Active Note");
        expect(chatState.setContextNoteId).toHaveBeenCalledWith("activeN");
        expect(h.capture.lastMessageListProps).toBeTruthy();
    });
});
