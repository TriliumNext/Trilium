import type { LlmCitation, LlmMessage, LlmModelInfo, LlmUsage } from "@triliumnext/commons";
import { RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { getAvailableModels, streamChatCompletion } from "../../../services/llm_chat.js";
import { randomString } from "../../../services/utils.js";
import type { ContentBlock, LlmChatContent, StoredMessage } from "./llm_chat_types.js";

export interface ModelOption extends LlmModelInfo {
    costDescription?: string;
}

export interface LlmChatOptions {
    /** Default value for enableNoteTools */
    defaultEnableNoteTools?: boolean;
    /** Whether extended thinking is supported */
    supportsExtendedThinking?: boolean;
    /** Initial context note ID (the note the user is viewing) */
    contextNoteId?: string;
    /** The chat note ID (used for auto-renaming on first message) */
    chatNoteId?: string;
}

export interface UseLlmChatReturn {
    // State
    messages: StoredMessage[];
    input: string;
    isStreaming: boolean;
    streamingContent: string;
    streamingBlocks: ContentBlock[];
    streamingThinking: string;
    pendingCitations: LlmCitation[];
    availableModels: ModelOption[];
    selectedModel: string;
    enableWebSearch: boolean;
    enableNoteTools: boolean;
    enableExtendedThinking: boolean;
    contextNoteId: string | undefined;
    lastPromptTokens: number;
    messagesEndRef: RefObject<HTMLDivElement>;
    textareaRef: RefObject<HTMLTextAreaElement>;
    /** Whether a provider is configured and available */
    hasProvider: boolean;
    /** Whether we're still checking for providers */
    isCheckingProvider: boolean;

    // Setters
    setInput: (value: string) => void;
    setMessages: (messages: StoredMessage[]) => void;
    setSelectedModel: (model: string) => void;
    setEnableWebSearch: (value: boolean) => void;
    setEnableNoteTools: (value: boolean) => void;
    setEnableExtendedThinking: (value: boolean) => void;
    setContextNoteId: (noteId: string | undefined) => void;
    setChatNoteId: (noteId: string | undefined) => void;

    // Actions
    handleSubmit: (e: Event) => Promise<void>;
    handleKeyDown: (e: KeyboardEvent) => void;
    loadFromContent: (content: LlmChatContent) => void;
    getContent: () => LlmChatContent;
    clearMessages: () => void;
    /** Refresh the provider/models list */
    refreshModels: () => void;
    /** Stop the current generation */
    stopStreaming: () => void;
}

export function useLlmChat(
    onMessagesChange?: (messages: StoredMessage[]) => void,
    options: LlmChatOptions = {}
): UseLlmChatReturn {
    const { defaultEnableNoteTools = false, supportsExtendedThinking = false, contextNoteId: initialContextNoteId, chatNoteId: initialChatNoteId } = options;

    const [messages, setMessagesInternal] = useState<StoredMessage[]>([]);
    const [input, setInput] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingContent, setStreamingContent] = useState("");
    const [streamingBlocks, setStreamingBlocks] = useState<ContentBlock[]>([]);
    const [streamingThinking, setStreamingThinking] = useState("");
    const [pendingCitations, setPendingCitations] = useState<LlmCitation[]>([]);
    const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>("");
    const [enableWebSearch, setEnableWebSearch] = useState(true);
    const [enableNoteTools, setEnableNoteTools] = useState(defaultEnableNoteTools);
    const [enableExtendedThinking, setEnableExtendedThinking] = useState(false);
    const [contextNoteId, setContextNoteId] = useState<string | undefined>(initialContextNoteId);
    const [chatNoteId, setChatNoteIdState] = useState<string | undefined>(initialChatNoteId);
    const [lastPromptTokens, setLastPromptTokens] = useState<number>(0);
    const [hasProvider, setHasProvider] = useState<boolean>(true); // Assume true initially
    const [isCheckingProvider, setIsCheckingProvider] = useState<boolean>(true);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Refs to get fresh values in getContent (avoids stale closures)
    const messagesRef = useRef(messages);
    messagesRef.current = messages;
    const selectedModelRef = useRef(selectedModel);
    selectedModelRef.current = selectedModel;
    const enableWebSearchRef = useRef(enableWebSearch);
    enableWebSearchRef.current = enableWebSearch;
    const enableNoteToolsRef = useRef(enableNoteTools);
    enableNoteToolsRef.current = enableNoteTools;
    const enableExtendedThinkingRef = useRef(enableExtendedThinking);
    enableExtendedThinkingRef.current = enableExtendedThinking;
    const chatNoteIdRef = useRef(chatNoteId);
    chatNoteIdRef.current = chatNoteId;
    const setChatNoteId = useCallback((noteId: string | undefined) => {
        chatNoteIdRef.current = noteId;
        setChatNoteIdState(noteId);
    }, []);
    const contextNoteIdRef = useRef(contextNoteId);
    contextNoteIdRef.current = contextNoteId;

    // Wrapper to call onMessagesChange when messages update
    const setMessages = useCallback((newMessages: StoredMessage[]) => {
        setMessagesInternal(newMessages);
        onMessagesChange?.(newMessages);
    }, [onMessagesChange]);

    // Fetch available models on mount
    const refreshModels = useCallback(() => {
        setIsCheckingProvider(true);
        getAvailableModels().then(models => {
            const modelsWithDescription = models.map(m => ({
                ...m,
                costDescription: m.costMultiplier ? `${m.costMultiplier}x` : undefined
            }));
            setAvailableModels(modelsWithDescription);
            setHasProvider(models.length > 0);
            setIsCheckingProvider(false);
            if (!selectedModel) {
                const defaultModel = models.find(m => m.isDefault) || models[0];
                if (defaultModel) {
                    setSelectedModel(defaultModel.id);
                }
            }
        }).catch(err => {
            console.error("Failed to fetch available models:", err);
            setHasProvider(false);
            setIsCheckingProvider(false);
        });
    }, [selectedModel]);

    useEffect(() => {
        refreshModels();
    }, []);

    // Scroll to bottom when content changes
    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, streamingContent, streamingThinking, scrollToBottom]);

    // Load state from content object
    const loadFromContent = useCallback((content: LlmChatContent) => {
        setMessagesInternal(content.messages || []);
        if (content.selectedModel) {
            setSelectedModel(content.selectedModel);
        }
        if (typeof content.enableWebSearch === "boolean") {
            setEnableWebSearch(content.enableWebSearch);
        }
        if (typeof content.enableNoteTools === "boolean") {
            setEnableNoteTools(content.enableNoteTools);
        }
        if (supportsExtendedThinking && typeof content.enableExtendedThinking === "boolean") {
            setEnableExtendedThinking(content.enableExtendedThinking);
        }
        // Restore last prompt tokens from the most recent message with usage
        const lastUsage = [...(content.messages || [])].reverse().find(m => m.usage)?.usage;
        setLastPromptTokens(lastUsage?.promptTokens ?? 0);
    }, [supportsExtendedThinking]);

    // Get current state as content object (uses refs to avoid stale closures)
    const getContent = useCallback((): LlmChatContent => {
        const content: LlmChatContent = {
            version: 1,
            messages: messagesRef.current,
            selectedModel: selectedModelRef.current || undefined,
            enableWebSearch: enableWebSearchRef.current,
            enableNoteTools: enableNoteToolsRef.current
        };
        if (supportsExtendedThinking) {
            content.enableExtendedThinking = enableExtendedThinkingRef.current;
        }
        return content;
    }, [supportsExtendedThinking]);

    const clearMessages = useCallback(() => {
        setMessages([]);
        setLastPromptTokens(0);
    }, [setMessages]);

    const handleSubmit = useCallback(async (e: Event) => {
        e.preventDefault();
        if (!input.trim() || isStreaming) return;

        setPendingCitations([]);

        const userMessage: StoredMessage = {
            id: randomString(),
            role: "user",
            content: input.trim(),
            createdAt: new Date().toISOString()
        };

        const newMessages = [...messages, userMessage];
        setMessagesInternal(newMessages);
        setInput("");
        setIsStreaming(true);
        setStreamingContent("");
        setStreamingBlocks([]);
        setStreamingThinking("");

        let thinkingContent = "";
        const contentBlocks: ContentBlock[] = [];
        const citations: LlmCitation[] = [];
        let usage: LlmUsage | undefined;

        /** Get or create the last text block to append streaming text to. */
        function lastTextBlock(): ContentBlock & { type: "text" } {
            const last = contentBlocks[contentBlocks.length - 1];
            if (last?.type === "text") {
                return last;
            }
            const block: ContentBlock = { type: "text", content: "" };
            contentBlocks.push(block);
            return block as ContentBlock & { type: "text" };
        }

        const apiMessages: LlmMessage[] = newMessages.map(m => ({
            role: m.role,
            content: typeof m.content === "string" ? m.content : m.content
                .filter((b): b is ContentBlock & { type: "text" } => b.type === "text")
                .map(b => b.content)
                .join("")
        }));

        const selectedModelProvider = availableModels.find(m => m.id === selectedModel)?.provider;
        const streamOptions: Parameters<typeof streamChatCompletion>[1] = {
            model: selectedModel || undefined,
            provider: selectedModelProvider,
            enableWebSearch,
            enableNoteTools,
            contextNoteId,
            chatNoteId: chatNoteIdRef.current
        };
        if (supportsExtendedThinking) {
            streamOptions.enableExtendedThinking = enableExtendedThinking;
        }

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        /** Shared cleanup: finalize collected content and reset streaming state. */
        function finalizeStream() {
            // Mark any in-progress tool calls as stopped so they don't show infinite spinners
            for (const [i, block] of contentBlocks.entries()) {
                if (block.type === "tool_call" && !block.toolCall.result) {
                    contentBlocks[i] = {
                        type: "tool_call",
                        toolCall: { ...block.toolCall, result: "[Stopped]", isError: true }
                    };
                }
            }

            const finalNewMessages: StoredMessage[] = [];

            if (thinkingContent) {
                finalNewMessages.push({
                    id: randomString(),
                    role: "assistant",
                    content: thinkingContent,
                    createdAt: new Date().toISOString(),
                    type: "thinking"
                });
            }

            if (contentBlocks.length > 0) {
                finalNewMessages.push({
                    id: randomString(),
                    role: "assistant",
                    content: contentBlocks,
                    createdAt: new Date().toISOString(),
                    citations: citations.length > 0 ? citations : undefined,
                    usage
                });
            }

            if (finalNewMessages.length > 0) {
                setMessages([...newMessages, ...finalNewMessages]);
            }

            setStreamingContent("");
            setStreamingBlocks([]);
            setStreamingThinking("");
            setPendingCitations([]);
            setIsStreaming(false);
            abortControllerRef.current = null;
        }

        await streamChatCompletion(
            apiMessages,
            streamOptions,
            {
                onChunk: (text) => {
                    lastTextBlock().content += text;
                    setStreamingContent(contentBlocks
                        .filter((b): b is ContentBlock & { type: "text" } => b.type === "text")
                        .map(b => b.content)
                        .join(""));
                    setStreamingBlocks([...contentBlocks]);
                },
                onThinking: (text) => {
                    thinkingContent += text;
                    setStreamingThinking(thinkingContent);
                },
                onToolUse: (toolName, toolInput) => {
                    contentBlocks.push({
                        type: "tool_call",
                        toolCall: {
                            id: randomString(),
                            toolName,
                            input: toolInput
                        }
                    });
                    setStreamingBlocks([...contentBlocks]);
                },
                onToolResult: (toolName, result, isError) => {
                    // Replace the matching block with a new object so Preact sees the change.
                    for (let i = contentBlocks.length - 1; i >= 0; i--) {
                        const block = contentBlocks[i];
                        if (block.type === "tool_call" && block.toolCall.toolName === toolName && !block.toolCall.result) {
                            contentBlocks[i] = {
                                type: "tool_call",
                                toolCall: { ...block.toolCall, result, isError }
                            };
                            break;
                        }
                    }
                    setStreamingBlocks([...contentBlocks]);
                },
                onCitation: (citation) => {
                    // Deduplicate by URL
                    if (!citation.url || !citations.some(c => c.url === citation.url)) {
                        citations.push(citation);
                        setPendingCitations([...citations]);
                    }
                },
                onUsage: (u) => {
                    usage = u;
                    setLastPromptTokens(u.promptTokens);
                },
                onError: (errorMsg) => {
                    console.error("Chat error:", errorMsg);
                    const errorMessage: StoredMessage = {
                        id: randomString(),
                        role: "assistant",
                        content: errorMsg,
                        createdAt: new Date().toISOString(),
                        type: "error"
                    };
                    const finalMessages = [...newMessages, errorMessage];
                    setMessages(finalMessages);
                    setStreamingContent("");
                    setStreamingBlocks([]);
                    setStreamingThinking("");
                    setIsStreaming(false);
                },
                onDone: () => {
                    finalizeStream();
                }
            },
            abortController.signal
        ).catch((e) => {
            // AbortError is expected when user stops generation
            if (e instanceof DOMException && e.name === "AbortError") {
                finalizeStream();
            } else {
                // Re-throw other errors so they are not swallowed
                throw e;
            }
        });
    }, [input, isStreaming, messages, selectedModel, enableWebSearch, enableNoteTools, enableExtendedThinking, contextNoteId, supportsExtendedThinking, setMessages]);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    }, [handleSubmit]);

    /** Stop the current generation by aborting the SSE connection. */
    const stopStreaming = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
    }, []);

    return {
        // State
        messages,
        input,
        isStreaming,
        streamingContent,
        streamingBlocks,
        streamingThinking,
        pendingCitations,
        availableModels,
        selectedModel,
        enableWebSearch,
        enableNoteTools,
        enableExtendedThinking,
        contextNoteId,
        lastPromptTokens,
        messagesEndRef,
        textareaRef,
        hasProvider,
        isCheckingProvider,

        // Setters
        setInput,
        setMessages,
        setSelectedModel,
        setEnableWebSearch,
        setEnableNoteTools,
        setEnableExtendedThinking,
        setContextNoteId,
        setChatNoteId,

        // Actions
        handleSubmit,
        handleKeyDown,
        loadFromContent,
        getContent,
        clearMessages,
        refreshModels,
        stopStreaming
    };
}
