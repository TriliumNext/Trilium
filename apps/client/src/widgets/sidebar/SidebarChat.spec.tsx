import type { ComponentChildren } from "preact";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderInto } from "../../test/render";

/** The chat notes on the server, most recently modified first. */
let serverChats: string[] = [];
let createdCount = 0;

vi.mock("../../services/date_notes.js", () => ({
    default: {
        getMostRecentLlmChat: vi.fn(async () => serverChats.length ? { noteId: serverChats[0] } : null),
        createLlmChat: vi.fn(async () => createChat()),
        getRecentLlmChats: vi.fn(async () => [])
    }
}));
vi.mock("../../services/server.js", () => ({
    default: {
        get: vi.fn(async () => ({ content: JSON.stringify({ version: 1, messages: [] }) })),
        put: vi.fn(async () => undefined),
        post: vi.fn(async () => ({})),
        remove: vi.fn(async (url: string) => {
            serverChats = serverChats.filter(noteId => !url.startsWith(`notes/${noteId}?`));
        })
    }
}));
vi.mock("../../services/dialog.js", () => ({ default: { confirm: vi.fn(async () => true), prompt: vi.fn() } }));
vi.mock("../../services/ws.js", () => ({ default: {} }));
vi.mock("../../components/app_context.js", () => ({ default: {} }));

const fakeChat = {
    messages: [],
    hasInputText: true,
    pendingAttachments: [],
    isStreaming: false,
    getInput: vi.fn(() => "Hello"),
    setInput: vi.fn(),
    getContent: vi.fn(() => ({ version: 1, messages: [] })),
    loadFromContent: vi.fn(),
    clearMessages: vi.fn(),
    setContextNoteId: vi.fn(),
    setChatNoteId: vi.fn((noteId: string | undefined) => { fakeChat.chatNoteId = noteId; }),
    chatNoteId: undefined as string | undefined,
    /** The chat note the message was sent to. */
    submittedTo: undefined as string | undefined,
    handleSubmit: vi.fn(async () => { fakeChat.submittedTo = fakeChat.chatNoteId; })
};

vi.mock("../type_widgets/llm_chat/useLlmChat.js", () => ({ useLlmChat: () => fakeChat }));
vi.mock("../type_widgets/llm_chat/chat_context_menu.js", () => ({ useChatContextMenu: vi.fn() }));
vi.mock("../type_widgets/llm_chat/chat_highlights.js", () => ({ useChatHighlights: () => ({ highlightMenuItems: [] }) }));
vi.mock("../type_widgets/llm_chat/ChatMessageList.js", () => ({ default: () => null }));
vi.mock("../type_widgets/llm_chat/ChatReadOnlyNotice.js", () => ({ default: () => null }));
vi.mock("../type_widgets/llm_chat/ChatInputBar.js", () => ({
    default: ({ onSubmit }: { onSubmit: (e: Event) => void }) => <form className="chat-input" onSubmit={onSubmit} />
}));
vi.mock("../react/hooks.js", () => ({
    useActiveNoteContext: () => ({ noteId: null, note: null }),
    useNote: () => null,
    useNoteProperty: () => undefined,
    useNoteLabelBoolean: () => [ false ],
    useSpacedUpdate: () => ({ scheduleUpdate: vi.fn(), updateNowIfNecessary: async () => undefined })
}));
vi.mock("../react/ActionButton.js", () => ({
    default: ({ icon, onClick }: { icon: string; onClick: (e: MouseEvent) => void }) => <button data-icon={icon} onClick={onClick} />
}));
vi.mock("../react/Dropdown.js", () => ({
    default: ({ children }: { children: ComponentChildren }) => <div>{children}</div>
}));
vi.mock("../react/FormList.js", () => ({
    FormListItem: ({ icon, onClick, children }: { icon?: string; onClick?: () => void; children: ComponentChildren }) =>
        <li data-icon={icon} onClick={onClick}>{children}</li>,
    FormDropdownDivider: () => null
}));
vi.mock("./RightPanelWidget.js", () => ({
    default: ({ buttons, children }: { buttons: ComponentChildren; children: ComponentChildren }) => <div>{buttons}{children}</div>
}));

import SidebarChat from "./SidebarChat";

describe("SidebarChat", () => {
    beforeEach(() => {
        serverChats = [ "chatOpen", "chatOlder" ];
        createdCount = 0;
        fakeChat.chatNoteId = undefined;
        fakeChat.submittedTo = undefined;
    });

    it("sends the first message after deleting the open chat to a new chat, not to an older one", async () => {
        const container = renderInto(<SidebarChat />);
        await vi.waitFor(() => expect(fakeChat.chatNoteId).toBe("chatOpen"));

        const deleteItem = container.querySelector<HTMLLIElement>("li[data-icon='bx bx-trash']");
        expect(deleteItem).not.toBeNull();
        deleteItem?.click();
        await vi.waitFor(() => expect(fakeChat.chatNoteId).toBeUndefined());
        expect(serverChats).toEqual([ "chatOlder" ]);

        const form = container.querySelector("form.chat-input");
        expect(form).not.toBeNull();
        form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(fakeChat.handleSubmit).toHaveBeenCalled());

        expect(fakeChat.submittedTo).toBe("chatNew1");
        expect(serverChats).toEqual([ "chatNew1", "chatOlder" ]);
    });
});

function createChat() {
    const noteId = `chatNew${++createdCount}`;
    serverChats.unshift(noteId);
    return { noteId };
}
