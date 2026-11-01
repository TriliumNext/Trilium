import { useCallback, useEffect, useRef } from "preact/hooks";

import type NoteContext from "../../../components/note_context.js";
import contextMenu, { type MenuItem } from "../../../menus/context_menu.js";
import dialog from "../../../services/dialog.js";
import { t } from "../../../services/i18n.js";
import toast from "../../../services/toast.js";
import { canCopyMessage, copyMessageToClipboard } from "./chat_copy.js";
import { canDeleteMessage, removeMessage } from "./chat_delete.js";
import { buildQuoteMarkdown } from "./chat_quote.js";
import { canRegenerate } from "./chat_regenerate.js";
import { canSaveAsNote, canSaveToSubNote, saveMessageAsInboxNote, saveMessageToSubNote } from "./chat_save.js";
import { getMessageText } from "./llm_chat_types.js";
import type { UseLlmChatReturn } from "./useLlmChat.js";

/** The right-clicked message and its surrounding state, passed to command contributors. */
export interface ChatMessageMenuContext {
    /** Id of the message the click landed on. */
    messageId: string;
    /** The message's rendered content root (`.llm-chat-message-content`). */
    root: HTMLElement;
    /** The non-empty selection within `root`, or null. */
    selectionRange: Range | null;
    /** Whether a reply is currently streaming. */
    streaming: boolean;
    clientX: number;
    clientY: number;
}

/** Builds extra context-menu items for the right-clicked message (e.g. highlight add/remove). */
export type ChatContextMenuItemsProvider = (ctx: ChatMessageMenuContext) => MenuItem<unknown>[];

/** Options for {@link useChatContextMenu}. An object so new fields can be added without changing callers. */
export interface ChatContextMenuOptions {
    chat: UseLlmChatReturn;
    /** The chat's note context (note chats); undefined for the right-pane sidebar chat. */
    noteContext: NoteContext | undefined;
    /** Builds extra items to add to the message's context menu (e.g. highlight add/remove). */
    contextMenuItems: ChatContextMenuItemsProvider;
    /** When the chat is read-only (`#readOnly`), the mutating commands are suppressed. */
    readOnly: boolean;
}

/**
 * The right-click menu over an AI chat's message timeline. Owns the single `contextmenu` listener and
 * builds the menu for the message under the cursor: with a text selection — Copy and Quote; with none
 * — Copy message, Save to a sub-note (note chats only), Regenerate (last reply only) and Delete.
 * `contextMenuItems` lets another
 * concern (currently highlights) inject its own items next to the selection commands. Bails to the
 * native menu when nothing applies.
 *
 * Preventing the default menu drops the browser's own Copy, so we provide a rich Copy here. Copy stays
 * available while a reply streams; the message-mutating commands (highlight add/remove, delete) are
 * suppressed then. On a read-only chat every mutating command (highlight add/remove, quote, regenerate,
 * delete) is suppressed for the whole conversation — only Copy and Save-to-sub-note remain.
 */
export function useChatContextMenu({ chat, noteContext, contextMenuItems, readOnly }: ChatContextMenuOptions) {
    const { scrollContainerRef } = chat;

    // Latest values for the imperative event handler, so it never reads stale state.
    const messagesRef = useRef(chat.messages);
    messagesRef.current = chat.messages;
    const isStreamingRef = useRef(chat.isStreaming);
    isStreamingRef.current = chat.isStreaming;
    const readOnlyRef = useRef(readOnly);
    readOnlyRef.current = readOnly;
    const setMessagesRef = useRef(chat.setMessages);
    setMessagesRef.current = chat.setMessages;
    const appendToInputRef = useRef(chat.appendToInput);
    appendToInputRef.current = chat.appendToInput;
    const regenerateLastReplyRef = useRef(chat.regenerateLastReply);
    regenerateLastReplyRef.current = chat.regenerateLastReply;
    // Present for note chats (a real note in a tab), undefined for the right-pane sidebar chat —
    // gates "Save to sub-note" (note chats only) and is the new note's parent.
    const noteContextRef = useRef(noteContext);
    noteContextRef.current = noteContext;

    const confirmAndDeleteMessage = useCallback(async (messageId: string) => {
        if (await dialog.confirm(t("llm_chat.delete_message_confirm"))) {
            setMessagesRef.current(removeMessage(messagesRef.current, messageId));
        }
    }, []);

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const onContextMenu = (e: MouseEvent) => {
            const wrapper = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-message-id]");
            const messageId = wrapper?.dataset.messageId;
            const root = wrapper?.querySelector<HTMLElement>(".llm-chat-message-content");
            if (!messageId || !root) return; // thinking/error messages carry no id → nothing to offer

            const streaming = isStreamingRef.current;
            // A read-only chat (`#readOnly`) is immutable: every command that would change the
            // conversation is suppressed, leaving only Copy and Save-to-sub-note.
            const readOnly = readOnlyRef.current;
            const selectionRange = selectionRangeWithin(container.ownerDocument.getSelection(), root);
            const hasSelection = !!selectionRange?.toString().trim();
            const message = messagesRef.current.find(m => m.id === messageId);
            const messageMarkdown = message ? getMessageText(message.content) : "";
            const parentNotePath = noteContextRef.current?.notePath;

            const items: MenuItem<unknown>[] = [];

            // Copy the live selection as rich text: execCommand serializes the selected DOM to both
            // text/html and text/plain (what the native menu we suppressed would have done).
            if (hasSelection) {
                items.push({ title: t("llm_chat.copy"), uiIcon: "bx bx-copy", handler: copySelection });
            }

            // Injected commands (highlight add/remove) sit next to the selection commands. They
            // mutate the stored conversation, so they're dropped on a read-only chat.
            if (!readOnly) {
                items.push(...contextMenuItems({ messageId, root, selectionRange, streaming, clientX: e.clientX, clientY: e.clientY }));
            }

            // Quote the selection into the reply input. Suppressed while streaming — the input is
            // read-only then. Text is captured now (the menu can clear the live selection before the
            // handler runs).
            const quotedText = !streaming && !readOnly ? selectionRange?.toString() : undefined;
            if (quotedText?.trim()) {
                items.push({
                    title: t("llm_chat.quote_selection"),
                    uiIcon: "bx bxs-quote-alt-left",
                    handler: () => appendToInputRef.current(buildQuoteMarkdown(quotedText, messageId, t("llm_chat.quoted_from")))
                });
            }

            // Whole-message commands, offered when there's no selection (a selection means the
            // selection commands above apply). Rendered from the message's markdown source so math,
            // mermaid, and code survive intact.
            if (canCopyMessage(hasSelection, messageMarkdown)) {
                items.push({
                    title: t("llm_chat.copy_message"),
                    uiIcon: "bx bx-copy",
                    handler: () => copyMessageToClipboard(messageMarkdown)
                });
            }
            if (parentNotePath && canSaveToSubNote(parentNotePath, hasSelection, messageMarkdown)) {
                items.push({
                    title: t("llm_chat.save_to_subnote"),
                    uiIcon: "bx bx-save",
                    handler: () => void saveMessageToSubNote(parentNotePath, messageMarkdown)
                });
            }
            // Sidebar chat has no parent note to save under, so offer saving the message to the inbox
            // as its own note instead. Create-only, so it stays available on a read-only chat.
            if (!noteContextRef.current && canSaveAsNote(hasSelection, messageMarkdown)) {
                items.push({
                    title: t("llm_chat.save_as_note"),
                    uiIcon: "bx bx-save",
                    handler: () => void saveMessageAsInboxNote(messageMarkdown)
                });
            }
            if (!readOnly && canRegenerate(hasSelection, message, messagesRef.current, streaming)) {
                items.push({
                    title: t("llm_chat.regenerate"),
                    uiIcon: "bx bx-revision",
                    handler: () => void regenerateLastReplyRef.current()
                });
            }
            if (!readOnly && canDeleteMessage(hasSelection, message, streaming)) {
                items.push({
                    title: t("llm_chat.delete_message"),
                    uiIcon: "bx bx-trash",
                    handler: () => void confirmAndDeleteMessage(messageId)
                });
            }

            if (items.length === 0) return; // nothing to do → leave the native menu
            e.preventDefault();
            showMenu(e, items);
        };

        container.addEventListener("contextmenu", onContextMenu);
        return () => container.removeEventListener("contextmenu", onContextMenu);
    }, [scrollContainerRef, contextMenuItems, confirmAndDeleteMessage]);
}

/** The selection's range if it is non-empty and fully contained within `root`, else null. */
function selectionRangeWithin(selection: Selection | null, root: HTMLElement): Range | null {
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    return range;
}

function showMenu(e: MouseEvent, items: MenuItem<unknown>[]) {
    void contextMenu.show({ x: e.pageX, y: e.pageY, items, selectMenuItemHandler: () => {} });
}

/** Copy the current selection as rich text. The menu opens on mousedown, so the selection is still live. */
function copySelection() {
    const ok = document.execCommand("copy");
    if (ok) {
        toast.showMessage(t("clipboard.copy_success"));
    } else {
        toast.showError(t("clipboard.copy_failed"));
    }
}
