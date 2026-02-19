/**
 * LLM Chat Panel Widget
 */
import BasicWidget from "../basic_widget.js";
import toastService from "../../services/toast.js";
import appContext from "../../components/app_context.js";
import server from "../../services/server.js";
import noteAutocompleteService from "../../services/note_autocomplete.js";

import { TPL, addMessageToChat, showSources, hideSources, showLoadingIndicator, hideLoadingIndicator } from "./ui.js";
import { escapeHtml, formatMarkdown } from "./utils.js";
import { createChatSession, checkSessionExists, setupStreamingResponse, getDirectResponse } from "./communication.js";
import { extractInChatToolSteps } from "./message_processor.js";
import { validateProviders } from "./validation.js";
import type { MessageData, ToolExecutionStep, ChatData } from "./types.js";
import { formatCodeBlocks } from "../../services/syntax_highlight.js";
import { ClassicEditor, type CKTextEditor, type MentionFeed } from "@triliumnext/ckeditor5";
import type { Suggestion } from "../../services/note_autocomplete.js";

import "../../stylesheets/llm_chat.css";

export default class LlmChatPanel extends BasicWidget {
    private noteContextChatMessages!: HTMLElement;
    private noteContextChatForm!: HTMLFormElement;
    private noteContextChatInput!: HTMLElement;
    private noteContextChatInputEditor!: CKTextEditor;
    private noteContextChatSendButton!: HTMLButtonElement;
    private chatContainer!: HTMLElement;
    private loadingIndicator!: HTMLElement;
    private sourcesList!: HTMLElement;
    private sourcesContainer!: HTMLElement;
    private sourcesCount!: HTMLElement;
    private useAdvancedContextCheckbox!: HTMLInputElement;
    private showThinkingCheckbox!: HTMLInputElement;
    private validationWarning!: HTMLElement;
    private thinkingContainer!: HTMLElement;
    private thinkingBubble!: HTMLElement;
    private thinkingText!: HTMLElement;
    private thinkingToggle!: HTMLElement;

    // Simplified to just use noteId - this represents the AI Chat note we're working with
    private noteId: string | null = null;
    private currentNoteId: string | null = null; // The note providing context (for regular notes)
    private _messageHandlerId: number | null = null;
    private _messageHandler: any = null;

    // Callbacks for data persistence
    private onSaveData: ((data: any) => Promise<void>) | null = null;
    private onGetData: (() => Promise<any>) | null = null;
    private messages: MessageData[] = [];
    private sources: Array<{noteId: string; title: string; similarity?: number; content?: string}> = [];
    private metadata: {
        model?: string;
        provider?: string;
        temperature?: number;
        maxTokens?: number;
        toolExecutions?: Array<{
            id: string;
            name: string;
            arguments: any;
            result: any;
            error?: string;
            timestamp: string;
        }>;
        lastUpdated?: string;
        usage?: {
            promptTokens?: number;
            completionTokens?: number;
            totalTokens?: number;
        };
    } = {
        temperature: 0.7,
        toolExecutions: []
    };

    // Public getters and setters for private properties
    public getCurrentNoteId(): string | null {
        return this.currentNoteId;
    }

    public setCurrentNoteId(noteId: string | null): void {
        this.currentNoteId = noteId;
    }

    public getMessages(): MessageData[] {
        return this.messages;
    }

    public setMessages(messages: MessageData[]): void {
        this.messages = messages;
    }

    public getNoteId(): string | null {
        return this.noteId;
    }

    public setNoteId(noteId: string | null): void {
        this.noteId = noteId;
    }

    // Deprecated - keeping for backward compatibility but mapping to noteId
    public getChatNoteId(): string | null {
        return this.noteId;
    }

    public setChatNoteId(noteId: string | null): void {
        this.noteId = noteId;
    }

    public getNoteContextChatMessages(): HTMLElement {
        return this.noteContextChatMessages;
    }

    public clearNoteContextChatMessages(): void {
        this.noteContextChatMessages.innerHTML = '';
    }

    doRender() {
        this.$widget = $(TPL);

        const element = this.$widget[0];
        this.noteContextChatMessages = element.querySelector('.note-context-chat-messages') as HTMLElement;
        this.noteContextChatForm = element.querySelector('.note-context-chat-form') as HTMLFormElement;
        this.noteContextChatInput = element.querySelector('.note-context-chat-input') as HTMLElement;
        this.noteContextChatSendButton = element.querySelector('.note-context-chat-send-button') as HTMLButtonElement;
        this.chatContainer = element.querySelector('.note-context-chat-container') as HTMLElement;
        this.loadingIndicator = element.querySelector('.loading-indicator') as HTMLElement;
        this.sourcesList = element.querySelector('.sources-list') as HTMLElement;
        this.sourcesContainer = element.querySelector('.sources-container') as HTMLElement;
        this.sourcesCount = element.querySelector('.sources-count') as HTMLElement;
        this.useAdvancedContextCheckbox = element.querySelector('.use-advanced-context-checkbox') as HTMLInputElement;
        this.showThinkingCheckbox = element.querySelector('.show-thinking-checkbox') as HTMLInputElement;
        this.validationWarning = element.querySelector('.provider-validation-warning') as HTMLElement;
        this.thinkingContainer = element.querySelector('.llm-thinking-container') as HTMLElement;
        this.thinkingBubble = element.querySelector('.thinking-bubble') as HTMLElement;
        this.thinkingText = element.querySelector('.thinking-text') as HTMLElement;
        this.thinkingToggle = element.querySelector('.thinking-toggle') as HTMLElement;

        // Set up event delegation for the settings link
        this.validationWarning.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains('settings-link') || target.closest('.settings-link')) {
                console.log('Settings link clicked, navigating to AI settings URL');
                window.location.href = '#root/_hidden/_options/_optionsAi';
            }
        });

        // Set up thinking toggle functionality
        this.setupThinkingToggle();

        // Initialize CKEditor with mention support (async)
        this.initializeCKEditor().then(() => {
            this.initializeEventListeners();
        }).catch(error => {
            console.error('Failed to initialize CKEditor, falling back to basic event listeners:', error);
            this.initializeBasicEventListeners();
        });

        return this.$widget;
    }

    private async initializeCKEditor() {
        const mentionSetup: MentionFeed[] = [
            {
                marker: "@",
                feed: (queryText: string) => noteAutocompleteService.autocompleteSourceForCKEditor(queryText),
                itemRenderer: (item) => {
                    const suggestion = item as Suggestion;
                    const itemElement = document.createElement("button");
                    itemElement.innerHTML = `${suggestion.highlightedNotePathTitle} `;
                    return itemElement;
                },
                minimumCharacters: 0
            }
        ];

        this.noteContextChatInputEditor = await ClassicEditor.create(this.noteContextChatInput, {
            toolbar: {
                items: [] // No toolbar for chat input
            },
            placeholder: this.noteContextChatInput.getAttribute('data-placeholder') || 'Enter your message...',
            mention: {
                feeds: mentionSetup
            },
            licenseKey: "GPL"
        });

        // Set minimal height
        const editorElement = this.noteContextChatInputEditor.ui.getEditableElement();
        if (editorElement) {
            editorElement.style.minHeight = '60px';
            editorElement.style.maxHeight = '200px';
            editorElement.style.overflowY = 'auto';
        }

        // Set up keybindings after editor is ready
        this.setupEditorKeyBindings();

        console.log('CKEditor initialized successfully for LLM chat input');
    }

    private initializeBasicEventListeners() {
        // Fallback event listeners for when CKEditor fails to initialize
        this.noteContextChatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            // In fallback mode, the noteContextChatInput should contain a textarea
            const textarea = this.noteContextChatInput.querySelector('textarea');
            if (textarea) {
                const content = textarea.value;
                this.sendMessage(content);
            }
        });
    }

    cleanup() {
        console.log(`LlmChatPanel cleanup called, removing any active WebSocket subscriptions`);
        this._messageHandler = null;
        this._messageHandlerId = null;

        // Clean up CKEditor instance
        if (this.noteContextChatInputEditor) {
            this.noteContextChatInputEditor.destroy().catch(error => {
                console.error('Error destroying CKEditor:', error);
            });
        }
    }

    /**
     * Set the callbacks for data persistence
     */
    setDataCallbacks(
        saveDataCallback: (data: any) => Promise<void>,
        getDataCallback: () => Promise<any>
    ) {
        this.onSaveData = saveDataCallback;
        this.onGetData = getDataCallback;
    }

    /**
     * Save current chat data to the note attribute
     */
    async saveCurrentData() {
        if (!this.onSaveData) {
            return;
        }

        try {
            // Extract current tool execution steps if any exist
            const toolSteps = extractInChatToolSteps(this.noteContextChatMessages);

            // Get tool executions from both UI and any cached executions in metadata
            let toolExecutions: Array<{
                id: string;
                name: string;
                arguments: any;
                result: any;
                error?: string;
                timestamp: string;
            }> = [];

            // First include any tool executions already in metadata (from streaming events)
            if (this.metadata?.toolExecutions && Array.isArray(this.metadata.toolExecutions)) {
                toolExecutions = [...this.metadata.toolExecutions];
                console.log(`Including ${toolExecutions.length} tool executions from metadata`);
            }

            // Also extract any visible tool steps from the UI
            const extractedExecutions = toolSteps.map(step => {
                // Parse tool execution information
                if (step.type === 'tool-execution') {
                    try {
                        const content = JSON.parse(step.content);
                        return {
                            id: content.toolCallId || `tool-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                            name: content.tool || 'unknown',
                            arguments: content.args || {},
                            result: content.result || {},
                            error: content.error,
                            timestamp: new Date().toISOString()
                        };
                    } catch (e) {
                        // If we can't parse it, create a basic record
                        return {
                            id: `tool-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                            name: 'unknown',
                            arguments: {},
                            result: step.content,
                            timestamp: new Date().toISOString()
                        };
                    }
                } else if (step.type === 'result' && step.name) {
                    // Handle result steps with a name
                    return {
                        id: `tool-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                        name: step.name,
                        arguments: {},
                        result: step.content,
                        timestamp: new Date().toISOString()
                    };
                }
                return {
                    id: `tool-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                    name: 'unknown',
                    arguments: {},
                    result: 'Unrecognized tool step',
                    timestamp: new Date().toISOString()
                };
            });

            // Merge the tool executions, keeping only unique IDs
            const existingIds = new Set(toolExecutions.map((t: {id: string}) => t.id));
            for (const exec of extractedExecutions) {
                if (!existingIds.has(exec.id)) {
                    toolExecutions.push(exec);
                    existingIds.add(exec.id);
                }
            }

            // Only save if we have a valid note ID
            if (!this.noteId) {
                console.warn('Cannot save chat data: no noteId available');
                return;
            }

            const dataToSave = {
                messages: this.messages,
                noteId: this.noteId,
                chatNoteId: this.noteId, // For backward compatibility
                toolSteps: toolSteps,
                // Add sources if we have them
                sources: this.sources || [],
                // Add metadata
                metadata: {
                    model: this.metadata?.model || undefined,
                    provider: this.metadata?.provider || undefined,
                    temperature: this.metadata?.temperature || 0.7,
                    lastUpdated: new Date().toISOString(),
                    // Add tool executions
                    toolExecutions: toolExecutions
                }
            };

            console.log(`Saving chat data with noteId: ${this.noteId}, ${toolSteps.length} tool steps, ${this.sources?.length || 0} sources, ${toolExecutions.length} tool executions`);

            // Save the data to the note attribute via the callback
            // This is the ONLY place we should save data, letting the container widget handle persistence
            await this.onSaveData(dataToSave);
        } catch (error) {
            console.error('Error saving chat data:', error);
        }
    }

    /**
     * Save current chat data to a specific note ID
     */
    async saveCurrentDataToSpecificNote(targetNoteId: string | null) {
        if (!this.onSaveData || !targetNoteId) {
            console.warn('Cannot save chat data: no saveData callback or no targetNoteId available');
            return;
        }

        try {
            // Extract current tool execution steps if any exist
            const toolSteps = extractInChatToolSteps(this.noteContextChatMessages);

            // Get tool executions from both UI and any cached executions in metadata
            let toolExecutions: Array<{
                id: string;
                name: string;
                arguments: any;
                result: any;
                error?: string;
                timestamp: string;
            }> = [];

            // First include any tool executions already in metadata (from streaming events)
            if (this.metadata?.toolExecutions && Array.isArray(this.metadata.toolExecutions)) {
                toolExecutions = [...this.metadata.toolExecutions];
                console.log(`Including ${toolExecutions.length} tool executions from metadata`);
            }

            // Also extract any visible tool steps from the UI
            const extractedExecutions = toolSteps.map(step => {
                // Parse tool execution information
                if (step.type === 'tool-execution') {
                    try {
                        const content = JSON.parse(step.content);
                        return {
                            id: content.toolCallId || `tool-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                            name: content.tool || 'unknown',
                            arguments: content.args || {},
                            result: content.result || {},
                            error: content.error,
                            timestamp: new Date().toISOString()
                        };
                    } catch (e) {
                        // If we can't parse it, create a basic record
                        return {
                            id: `tool-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                            name: 'unknown',
                            arguments: {},
                            result: step.content,
                            timestamp: new Date().toISOString()
                        };
                    }
                } else if (step.type === 'result' && step.name) {
                    // Handle result steps with a name
                    return {
                        id: `tool-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                        name: step.name,
                        arguments: {},
                        result: step.content,
                        timestamp: new Date().toISOString()
                    };
                }
                return {
                    id: `tool-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                    name: 'unknown',
                    arguments: {},
                    result: 'Unrecognized tool step',
                    timestamp: new Date().toISOString()
                };
            });

            // Merge the tool executions, keeping only unique IDs
            const existingIds = new Set(toolExecutions.map((t: {id: string}) => t.id));
            for (const exec of extractedExecutions) {
                if (!existingIds.has(exec.id)) {
                    toolExecutions.push(exec);
                    existingIds.add(exec.id);
                }
            }

            const dataToSave = {
                messages: this.messages,
                noteId: targetNoteId,
                chatNoteId: targetNoteId, // For backward compatibility
                toolSteps: toolSteps,
                // Add sources if we have them
                sources: this.sources || [],
                // Add metadata
                metadata: {
                    model: this.metadata?.model || undefined,
                    provider: this.metadata?.provider || undefined,
                    temperature: this.metadata?.temperature || 0.7,
                    lastUpdated: new Date().toISOString(),
                    // Add tool executions
                    toolExecutions: toolExecutions
                }
            };

            console.log(`Saving chat data to specific note ${targetNoteId}, ${toolSteps.length} tool steps, ${this.sources?.length || 0} sources, ${toolExecutions.length} tool executions`);

            // Save the data to the note attribute via the callback
            // This is the ONLY place we should save data, letting the container widget handle persistence
            await this.onSaveData(dataToSave);
        } catch (error) {
            console.error('Error saving chat data to specific note:', error);
        }
    }

    /**
     * Load saved chat data from the note attribute
     */
    async loadSavedData(): Promise<boolean> {
        if (!this.onGetData) {
            return false;
        }

        try {
            const savedData = await this.onGetData() as ChatData;

            if (savedData?.messages?.length > 0) {
                // Check if we actually have new content to avoid unnecessary UI rebuilds
                const currentMessageCount = this.messages.length;
                const savedMessageCount = savedData.messages.length;

                // If message counts are the same, check if content is different
                const hasNewContent = savedMessageCount > currentMessageCount ||
                    JSON.stringify(this.messages) !== JSON.stringify(savedData.messages);

                if (!hasNewContent) {
                    console.log("No new content detected, skipping UI rebuild");
                    return true;
                }

                console.log(`Loading saved data: ${currentMessageCount} -> ${savedMessageCount} messages`);

                // Store current scroll position if we need to preserve it
                const shouldPreserveScroll = savedMessageCount > currentMessageCount && currentMessageCount > 0;
                const currentScrollTop = shouldPreserveScroll ? this.chatContainer.scrollTop : 0;
                const currentScrollHeight = shouldPreserveScroll ? this.chatContainer.scrollHeight : 0;

                // Load messages
                const oldMessages = [...this.messages];
                this.messages = savedData.messages;

                // Only rebuild UI if we have significantly different content
                if (savedMessageCount > currentMessageCount) {
                    // We have new messages - just add the new ones instead of rebuilding everything
                    const newMessages = savedData.messages.slice(currentMessageCount);
                    console.log(`Adding ${newMessages.length} new messages to UI`);

                    newMessages.forEach(message => {
                        const role = message.role as 'user' | 'assistant';
                        this.addMessageToChat(role, message.content);
                    });
                } else {
                    // Content changed but count is same - need to rebuild
                    console.log("Message content changed, rebuilding UI");

                    // Clear and rebuild the chat UI
                    this.noteContextChatMessages.innerHTML = '';

                    this.messages.forEach(message => {
                        const role = message.role as 'user' | 'assistant';
                        this.addMessageToChat(role, message.content);
                    });
                }

                // Restore tool execution steps if they exist
                if (savedData.toolSteps && Array.isArray(savedData.toolSteps) && savedData.toolSteps.length > 0) {
                    console.log(`Restoring ${savedData.toolSteps.length} saved tool steps`);
                    this.restoreInChatToolSteps(savedData.toolSteps);
                }

                // Load sources if available
                if (savedData.sources && Array.isArray(savedData.sources)) {
                    this.sources = savedData.sources;
                    console.log(`Loaded ${this.sources.length} sources from saved data`);

                    // Show sources in the UI if they exist
                    if (this.sources.length > 0) {
                        this.showSources(this.sources);
                    }
                }

                // Load metadata if available
                if (savedData.metadata) {
                    this.metadata = {
                        ...this.metadata,
                        ...savedData.metadata
                    };

                    // Ensure tool executions are loaded
                    if (savedData.metadata.toolExecutions && Array.isArray(savedData.metadata.toolExecutions)) {
                        console.log(`Loaded ${savedData.metadata.toolExecutions.length} tool executions from saved data`);

                        if (!this.metadata.toolExecutions) {
                            this.metadata.toolExecutions = [];
                        }

                        // Make sure we don't lose any tool executions
                        this.metadata.toolExecutions = savedData.metadata.toolExecutions;
                    }

                    console.log(`Loaded metadata from saved data:`, this.metadata);
                }

                // Load Chat Note ID if available
                if (savedData.noteId) {
                    console.log(`Using noteId as Chat Note ID: ${savedData.noteId}`);
                    this.noteId = savedData.noteId;
                } else {
                    console.log(`No noteId found in saved data, cannot load chat session`);
                    return false;
                }

                // Restore scroll position if we were preserving it
                if (shouldPreserveScroll) {
                    // Calculate the new scroll position to maintain relative position
                    const newScrollHeight = this.chatContainer.scrollHeight;
                    const scrollDifference = newScrollHeight - currentScrollHeight;
                    const newScrollTop = currentScrollTop + scrollDifference;

                    // Only scroll down if we're near the bottom, otherwise preserve exact position
                    const wasNearBottom = (currentScrollTop + this.chatContainer.clientHeight) >= (currentScrollHeight - 50);

                    if (wasNearBottom) {
                        // User was at bottom, scroll to new bottom
                        this.chatContainer.scrollTop = newScrollHeight;
                        console.log("User was at bottom, scrolling to new bottom");
                    } else {
                        // User was not at bottom, try to preserve their position
                        this.chatContainer.scrollTop = newScrollTop;
                        console.log(`Preserving scroll position: ${currentScrollTop} -> ${newScrollTop}`);
                    }
                }

                return true;
            }
        } catch (error) {
            console.error('Failed to load saved chat data', error);
        }

        return false;
    }

    /**
     * Restore tool execution steps in the chat UI
     */
    private restoreInChatToolSteps(steps: ToolExecutionStep[]) {
        if (!steps || steps.length === 0) return;

        // Create the tool execution element
        const toolExecutionElement = document.createElement('div');
        toolExecutionElement.className = 'chat-tool-execution mb-3';

        // Insert before the assistant message if it exists
        const assistantMessage = this.noteContextChatMessages.querySelector('.assistant-message:last-child');
        if (assistantMessage) {
            this.noteContextChatMessages.insertBefore(toolExecutionElement, assistantMessage);
        } else {
            // Otherwise append to the end
            this.noteContextChatMessages.appendChild(toolExecutionElement);
        }

        // Fill with tool execution content
        toolExecutionElement.innerHTML = `
            <div class="tool-execution-header d-flex align-items-center p-2 rounded">
                <i class="bx bx-terminal me-2"></i>
                <span class="flex-grow-1 fw-bold">Tool Execution</span>
                <button type="button" class="btn btn-sm btn-link p-0 text-muted tool-execution-toggle" title="Toggle tool execution details">
                    <i class="bx bx-chevron-down"></i>
                </button>
            </div>
            <div class="tool-execution-container p-2 rounded mb-2">
                <div class="tool-execution-chat-steps">
                    ${this.renderToolStepsHtml(steps)}
                </div>
            </div>
        `;

        // Add event listener for the toggle button
        const toggleButton = toolExecutionElement.querySelector('.tool-execution-toggle');
        if (toggleButton) {
            toggleButton.addEventListener('click', () => {
                const stepsContainer = toolExecutionElement.querySelector('.tool-execution-container');
                const icon = toggleButton.querySelector('i');

                if (stepsContainer) {
                    if (stepsContainer.classList.contains('collapsed')) {
                        // Expand
                        stepsContainer.classList.remove('collapsed');
                        (stepsContainer as HTMLElement).style.display = 'block';
                        if (icon) {
                            icon.className = 'bx bx-chevron-down';
                        }
                    } else {
                        // Collapse
                        stepsContainer.classList.add('collapsed');
                        (stepsContainer as HTMLElement).style.display = 'none';
                        if (icon) {
                            icon.className = 'bx bx-chevron-right';
                        }
                    }
                }
            });
        }

        // Add click handler for the header to toggle expansion as well
        const header = toolExecutionElement.querySelector('.tool-execution-header');
        if (header) {
            header.addEventListener('click', (e) => {
                // Only toggle if the click isn't on the toggle button itself
                const target = e.target as HTMLElement;
                if (target && !target.closest('.tool-execution-toggle')) {
                    const toggleButton = toolExecutionElement.querySelector('.tool-execution-toggle');
                    toggleButton?.dispatchEvent(new Event('click'));
                }
            });
            (header as HTMLElement).style.cursor = 'pointer';
        }
    }

    /**
     * Render HTML for tool execution steps
     */
    private renderToolStepsHtml(steps: ToolExecutionStep[]): string {
        if (!steps || steps.length === 0) return '';

        return steps.map(step => {
            let icon = 'bx-info-circle';
            let className = 'info';
            let content = '';
            const safeContent = escapeHtml(step.content || '');
            const safeName = escapeHtml(step.name || 'unknown');

            if (step.type === 'executing') {
                icon = 'bx-code-block';
                className = 'executing';
                content = `<div>${safeContent || 'Executing tools...'}</div>`;
            } else if (step.type === 'result') {
                icon = 'bx-terminal';
                className = 'result';
                content = `
                    <div>Tool: <strong>${safeName}</strong></div>
                    <div class="mt-1 ps-3">${safeContent}</div>
                `;
            } else if (step.type === 'error') {
                icon = 'bx-error-circle';
                className = 'error';
                content = `
                    <div>Tool: <strong>${safeName}</strong></div>
                    <div class="mt-1 ps-3 text-danger">${safeContent || 'Error occurred'}</div>
                `;
            } else if (step.type === 'generating') {
                icon = 'bx-message-dots';
                className = 'generating';
                content = `<div>${safeContent || 'Generating response...'}</div>`;
            }

            return `
                <div class="tool-step ${className} p-2 mb-2 rounded">
                    <div class="d-flex align-items-center">
                        <i class="bx ${icon} me-2"></i>
                        ${content}
                    </div>
                </div>
            `;
        }).join('');
    }

    async refresh() {
        if (!this.isVisible()) {
            return;
        }

        // Check for any provider validation issues when refreshing
        await validateProviders(this.validationWarning);

        // Get current note context if needed
        const currentActiveNoteId = appContext.tabManager.getActiveContext()?.note?.noteId || null;

        // For AI Chat notes, the note itself IS the chat session
        // So currentNoteId and noteId should be the same
        if (this.noteId && currentActiveNoteId === this.noteId) {
            // We're in an AI Chat note - don't reset, just load saved data
            console.log(`Refreshing AI Chat note ${this.noteId} - loading saved data`);
            await this.loadSavedData();
            return;
        }

        // If we're switching to a different note, we need to reset
        if (this.currentNoteId !== currentActiveNoteId) {
            console.log(`Note ID changed from ${this.currentNoteId} to ${currentActiveNoteId}, resetting chat panel`);

            // Reset the UI and data
            this.noteContextChatMessages.innerHTML = '';
            this.messages = [];
            this.noteId = null; // Also reset the chat note ID
            this.hideSources(); // Hide any sources from previous note

            // Update our current noteId
            this.currentNoteId = currentActiveNoteId;
        }

        // Always try to load saved data for the current note
        const hasSavedData = await this.loadSavedData();

        // Only create a new session if we don't have a session or saved data
        if (!this.noteId || !hasSavedData) {
            // Create a new chat session
            await this.createChatSession();
        }
    }

    /**
     * Create a new chat session
     */
    private async createChatSession() {
        try {
            // If we already have a noteId (for AI Chat notes), use it
            const contextNoteId = this.noteId || this.currentNoteId;

            // Create a new chat session, passing the context note ID
            const noteId = await createChatSession(contextNoteId ? contextNoteId : undefined);

            if (noteId) {
                // Set the note ID for this chat
                this.noteId = noteId;
                console.log(`Created new chat session with noteId: ${this.noteId}`);
            } else {
                throw new Error("Failed to create chat session - no ID returned");
            }

            // Save the note ID as the session identifier
            await this.saveCurrentData();
        } catch (error) {
            console.error('Error creating chat session:', error);
            toastService.showError('Failed to create chat session');
        }
    }

    /**
     * Handle sending a user message to the LLM service
     */
    private async sendMessage(content: string) {
        if (!content.trim()) return;

        // Extract mentions from the content if using CKEditor
        let mentions: Array<{noteId: string; title: string; notePath: string}> = [];
        let plainTextContent = content;

        if (this.noteContextChatInputEditor) {
            const extracted = this.extractMentionsAndContent(content);
            mentions = extracted.mentions;
            plainTextContent = extracted.content;
        }

        // Add the user message to the UI and data model
        this.addMessageToChat('user', plainTextContent);
        this.messages.push({
            role: 'user',
            content: plainTextContent,
            mentions: mentions.length > 0 ? mentions : undefined
        });

        // Save the data immediately after a user message
        await this.saveCurrentData();

        // Clear input and show loading state
        if (this.noteContextChatInputEditor) {
            this.noteContextChatInputEditor.setData('');
        }
        showLoadingIndicator(this.loadingIndicator);
        this.hideSources();

        try {
            const useAdvancedContext = this.useAdvancedContextCheckbox.checked;
            const showThinking = this.showThinkingCheckbox.checked;

            // Add logging to verify parameters
            console.log(`Sending message with: useAdvancedContext=${useAdvancedContext}, showThinking=${showThinking}, noteId=${this.currentNoteId}, sessionId=${this.noteId}`);

            // Create the message parameters
            const messageParams = {
                content: plainTextContent,
                useAdvancedContext,
                showThinking,
                mentions: mentions.length > 0 ? mentions : undefined
            };

            // Try websocket streaming (preferred method)
            try {
                await this.setupStreamingResponse(messageParams);
            } catch (streamingError) {
                console.warn("WebSocket streaming failed, falling back to direct response:", streamingError);

                // If streaming fails, fall back to direct response
                const handled = await this.handleDirectResponse(messageParams);
                if (!handled) {
                    // If neither method works, show an error
                    throw new Error("Failed to get response from server");
                }
            }

            // Note: We don't need to save here since the streaming completion and direct response methods
            // both call saveCurrentData() when they're done
        } catch (error) {
            console.error('Error processing user message:', error);
            toastService.showError('Failed to process message');

            // Add a generic error message to the UI
            this.addMessageToChat('assistant', 'Sorry, I encountered an error processing your message. Please try again.');
            this.messages.push({
                role: 'assistant',
                content: 'Sorry, I encountered an error processing your message. Please try again.'
            });

            // Save the data even after error
            await this.saveCurrentData();
        }
    }

    /**
     * Process a new user message - add to UI and save
     */
    private async processUserMessage(content: string) {
        // Check for validation issues first
        await validateProviders(this.validationWarning);

        // Make sure we have a valid session
        if (!this.noteId) {
            // If no session ID, create a new session
            await this.createChatSession();

            if (!this.noteId) {
                // If still no session ID, show error and return
                console.error("Failed to create chat session");
                toastService.showError("Failed to create chat session");
                return;
            }
        }

        // Add user message to messages array if not already added
        if (!this.messages.some(msg => msg.role === 'user' && msg.content === content)) {
            this.messages.push({
                role: 'user',
                content: content
            });
        }

        // Clear input and show loading state
        if (this.noteContextChatInputEditor) {
            this.noteContextChatInputEditor.setData('');
        }
        showLoadingIndicator(this.loadingIndicator);
        this.hideSources();

        try {
            const useAdvancedContext = this.useAdvancedContextCheckbox.checked;
            const showThinking = this.showThinkingCheckbox.checked;

            // Save current state to the Chat Note before getting a response
            await this.saveCurrentData();

            // Add logging to verify parameters
            console.log(`Sending message with: useAdvancedContext=${useAdvancedContext}, showThinking=${showThinking}, noteId=${this.currentNoteId}, sessionId=${this.noteId}`);

            // Create the message parameters
            const messageParams = {
                content,
                useAdvancedContext,
                showThinking
            };

            // Try websocket streaming (preferred method)
            try {
                await this.setupStreamingResponse(messageParams);
            } catch (streamingError) {
                console.warn("WebSocket streaming failed, falling back to direct response:", streamingError);

                // If streaming fails, fall back to direct response
                const handled = await this.handleDirectResponse(messageParams);
                if (!handled) {
                    // If neither method works, show an error
                    throw new Error("Failed to get response from server");
                }
            }

            // Save final state after getting the response
            await this.saveCurrentData();
        } catch (error) {
            this.handleError(error as Error);
            // Make sure we save the current state even on error
            await this.saveCurrentData();
        }
    }

    /**
     * Try to get a direct response from the server
     */
    private async handleDirectResponse(messageParams: any): Promise<boolean> {
        try {
            if (!this.noteId) return false;

            console.log(`Getting direct response using sessionId: ${this.noteId} (noteId: ${this.noteId})`);

            // Get a direct response from the server
            const postResponse = await getDirectResponse(this.noteId, messageParams);

            // If the POST request returned content directly, display it
            if (postResponse && postResponse.content) {
                // Store metadata from the response
                if (postResponse.metadata) {
                    console.log("Received metadata from response:", postResponse.metadata);
                    this.metadata = {
                        ...this.metadata,
                        ...postResponse.metadata
                    };
                }

                // Store sources from the response
                if (postResponse.sources && postResponse.sources.length > 0) {
                    console.log(`Received ${postResponse.sources.length} sources from response`);
                    this.sources = postResponse.sources;
                    this.showSources(postResponse.sources);
                }

                // Process the assistant response with original chat note ID
                this.processAssistantResponse(postResponse.content, postResponse, this.noteId);

                hideLoadingIndicator(this.loadingIndicator);
                return true;
            }

            return false;
        } catch (error) {
            console.error("Error with direct response:", error);
            return false;
        }
    }

    /**
     * Process an assistant response - add to UI and save
     */
    private async processAssistantResponse(content: string, fullResponse?: any, originalChatNoteId?: string | null) {
        // Add the response to the chat UI
        this.addMessageToChat('assistant', content);

        // Add to our local message array too
        this.messages.push({
            role: 'assistant',
            content,
            timestamp: new Date()
        });

        // If we received tool execution information, add it to metadata
        if (fullResponse?.metadata?.toolExecutions) {
            console.log(`Storing ${fullResponse.metadata.toolExecutions.length} tool executions from response`);
            // Make sure our metadata has toolExecutions
            if (!this.metadata.toolExecutions) {
                this.metadata.toolExecutions = [];
            }

            // Add new tool executions
            this.metadata.toolExecutions = [
                ...this.metadata.toolExecutions,
                ...fullResponse.metadata.toolExecutions
            ];
        }

        // Save to note - use original chat note ID if provided
        this.saveCurrentDataToSpecificNote(originalChatNoteId || this.noteId).catch(err => {
            console.error("Failed to save assistant response to note:", err);
        });
    }

    /**
     * Set up streaming response via WebSocket
     */
    private async setupStreamingResponse(messageParams: any): Promise<void> {
        if (!this.noteId) {
            throw new Error("No session ID available");
        }

        console.log(`Setting up streaming response using sessionId: ${this.noteId} (noteId: ${this.noteId})`);

        // Store tool executions captured during streaming
        const toolExecutionsCache: Array<{
            id: string;
            name: string;
            arguments: any;
            result: any;
            error?: string;
            timestamp: string;
        }> = [];

        // Store the original chat note ID to ensure we save to the correct note even if user switches
        const originalChatNoteId = this.noteId;

        return setupStreamingResponse(
            this.noteId,
            messageParams,
            // Content update handler
            (content: string, isDone: boolean = false) => {
                this.updateStreamingUI(content, isDone, originalChatNoteId);

                // Update session data with additional metadata when streaming is complete
                if (isDone) {
                    // Update our metadata with info from the server
                    server.get<{
                        metadata?: {
                            model?: string;
                            provider?: string;
                            temperature?: number;
                            maxTokens?: number;
                            toolExecutions?: Array<{
                                id: string;
                                name: string;
                                arguments: any;
                                result: any;
                                error?: string;
                                timestamp: string;
                            }>;
                            lastUpdated?: string;
                            usage?: {
                                promptTokens?: number;
                                completionTokens?: number;
                                totalTokens?: number;
                            };
                        };
                        sources?: Array<{
                            noteId: string;
                            title: string;
                            similarity?: number;
                            content?: string;
                        }>;
                    }>(`llm/chat/${this.noteId}`)
                        .then((sessionData) => {
                            console.log("Got updated session data:", sessionData);

                            // Store metadata
                            if (sessionData.metadata) {
                                this.metadata = {
                                    ...this.metadata,
                                    ...sessionData.metadata
                                };
                            }

                            // Store sources
                            if (sessionData.sources && sessionData.sources.length > 0) {
                                this.sources = sessionData.sources;
                                this.showSources(sessionData.sources);
                            }

                            // Make sure we include the cached tool executions
                            if (toolExecutionsCache.length > 0) {
                                console.log(`Including ${toolExecutionsCache.length} cached tool executions in metadata`);
                                if (!this.metadata.toolExecutions) {
                                    this.metadata.toolExecutions = [];
                                }

                                // Add any tool executions from our cache that aren't already in metadata
                                const existingIds = new Set((this.metadata.toolExecutions || []).map((t: {id: string}) => t.id));
                                for (const toolExec of toolExecutionsCache) {
                                    if (!existingIds.has(toolExec.id)) {
                                        this.metadata.toolExecutions.push(toolExec);
                                        existingIds.add(toolExec.id);
                                    }
                                }
                            }

                            // DON'T save here - let the server handle saving the complete conversation
                            // to avoid race conditions between client and server saves
                            console.log("Updated metadata after streaming completion, server should save");
                        })
                        .catch(err => console.error("Error fetching session data after streaming:", err));
                }
            },
            // Thinking update handler
            (thinking: string) => {
                this.showThinkingState(thinking);
            },
            // Tool execution handler
            (toolData: any) => {
                this.showToolExecutionInfo(toolData);

                // Cache tools we see during streaming to include them in the final saved data
                if (toolData && toolData.action === 'result' && toolData.tool) {
                    // Create a tool execution record
                    const toolExec = {
                        id: toolData.toolCallId || `tool-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                        name: toolData.tool,
                        arguments: toolData.args || {},
                        result: toolData.result || {},
                        error: toolData.error,
                        timestamp: new Date().toISOString()
                    };

                    // Add to both our local cache for immediate saving and to metadata for later saving
                    toolExecutionsCache.push(toolExec);

                    // Initialize toolExecutions array if it doesn't exist
                    if (!this.metadata.toolExecutions) {
                        this.metadata.toolExecutions = [];
                    }

                    // Add tool execution to our metadata
                    this.metadata.toolExecutions.push(toolExec);

                    console.log(`Cached tool execution for ${toolData.tool} to be saved later`);

                    // DON'T save immediately during streaming - let the server handle saving
                    // to avoid race conditions between client and server saves
                    console.log(`Tool execution cached, will be saved by server`);
                }
            },
            // Complete handler
            () => {
                hideLoadingIndicator(this.loadingIndicator);
            },
            // Error handler
            (error: Error) => {
                this.handleError(error);
            }
        );
    }

    /**
     * Update the UI with streaming content
     */
    private updateStreamingUI(assistantResponse: string, isDone: boolean = false, originalChatNoteId?: string | null) {
        // Track if we have a streaming message in progress
        const hasStreamingMessage = !!this.noteContextChatMessages.querySelector('.assistant-message.streaming');

        // Create a new message element or use the existing streaming one
        let assistantMessageEl: HTMLElement;

        if (hasStreamingMessage) {
            // Use the existing streaming message
            assistantMessageEl = this.noteContextChatMessages.querySelector('.assistant-message.streaming')!;
        } else {
            // Create a new message element
            assistantMessageEl = document.createElement('div');
            assistantMessageEl.className = 'assistant-message message mb-3 streaming';
            this.noteContextChatMessages.appendChild(assistantMessageEl);

            // Add assistant profile icon
            const profileIcon = document.createElement('div');
            profileIcon.className = 'profile-icon';
            profileIcon.innerHTML = '<i class="bx bx-bot"></i>';
            assistantMessageEl.appendChild(profileIcon);

            // Add message content container
            const messageContent = document.createElement('div');
            messageContent.className = 'message-content';
            assistantMessageEl.appendChild(messageContent);
        }

        // Update the content with the current response
        const messageContent = assistantMessageEl.querySelector('.message-content') as HTMLElement;
        messageContent.innerHTML = formatMarkdown(assistantResponse);

        // When the response is complete
        if (isDone) {
            // Remove the streaming class to mark this message as complete
            assistantMessageEl.classList.remove('streaming');

            // Apply syntax highlighting
            formatCodeBlocks($(assistantMessageEl as HTMLElement));

            // Hide the thinking display when response is complete
            this.hideThinkingDisplay();

            // Always add a new message to the data model
            // This ensures we preserve all distinct assistant messages
            this.messages.push({
                role: 'assistant',
                content: assistantResponse,
                timestamp: new Date()
            });

            // Save the updated message list to the original chat note
            this.saveCurrentDataToSpecificNote(originalChatNoteId || this.noteId);
        }

        // Scroll to bottom
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    /**
     * Handle general errors in the send message flow
     */
    private handleError(error: Error) {
        hideLoadingIndicator(this.loadingIndicator);
        toastService.showError('Error sending message: ' + error.message);
    }

    private addMessageToChat(role: 'user' | 'assistant', content: string) {
        addMessageToChat(this.noteContextChatMessages, this.chatContainer, role, content);
    }

    private showSources(sources: Array<{noteId: string, title: string}>) {
        showSources(
            this.sourcesList,
            this.sourcesContainer,
            this.sourcesCount,
            sources,
            (noteId: string) => {
                // Open the note in a new tab but don't switch to it
                appContext.tabManager.openTabWithNoteWithHoisting(noteId, { activate: false });
            }
        );
    }

    private hideSources() {
        hideSources(this.sourcesContainer);
    }

    /**
     * Handle tool execution updates
     */
    private showToolExecutionInfo(toolExecutionData: any) {
        console.log(`Showing tool execution info: ${JSON.stringify(toolExecutionData)}`);

        // Enhanced debugging for tool execution
        if (!toolExecutionData) {
            console.error('Tool execution data is missing or undefined');
            return;
        }

        // Check for required properties
        const actionType = toolExecutionData.action || '';
        const toolName = toolExecutionData.tool || 'unknown';
        console.log(`Tool execution details: action=${actionType}, tool=${toolName}, hasResult=${!!toolExecutionData.result}`);

        // Force action to 'result' if missing but result is present
        if (!actionType && toolExecutionData.result) {
            console.log('Setting missing action to "result" since result is present');
            toolExecutionData.action = 'result';
        }

        // Create or get the tool execution container
        let toolExecutionElement = this.noteContextChatMessages.querySelector('.chat-tool-execution');
        if (!toolExecutionElement) {
            toolExecutionElement = document.createElement('div');
            toolExecutionElement.className = 'chat-tool-execution mb-3';

            // Create header with title and dropdown toggle
            const header = document.createElement('div');
            header.className = 'tool-execution-header d-flex align-items-center p-2 rounded';
            header.innerHTML = `
                <i class="bx bx-terminal me-2"></i>
                <span class="flex-grow-1">Tool Execution</span>
                <button type="button" class="btn btn-sm btn-link p-0 text-muted tool-execution-toggle" title="Toggle tool execution details">
                    <i class="bx bx-chevron-down"></i>
                </button>
            `;
            toolExecutionElement.appendChild(header);

            // Create container for tool steps
            const stepsContainer = document.createElement('div');
            stepsContainer.className = 'tool-execution-container p-2 rounded mb-2';
            toolExecutionElement.appendChild(stepsContainer);

            // Add to chat messages
            this.noteContextChatMessages.appendChild(toolExecutionElement);

            // Add click handler for toggle button
            const toggleButton = toolExecutionElement.querySelector('.tool-execution-toggle');
            if (toggleButton) {
                toggleButton.addEventListener('click', () => {
                    const stepsContainer = toolExecutionElement?.querySelector('.tool-execution-container');
                    const icon = toggleButton.querySelector('i');

                    if (stepsContainer) {
                        if (stepsContainer.classList.contains('collapsed')) {
                            // Expand
                            stepsContainer.classList.remove('collapsed');
                            (stepsContainer as HTMLElement).style.display = 'block';
                            if (icon) {
                                icon.className = 'bx bx-chevron-down';
                            }
                        } else {
                            // Collapse
                            stepsContainer.classList.add('collapsed');
                            (stepsContainer as HTMLElement).style.display = 'none';
                            if (icon) {
                                icon.className = 'bx bx-chevron-right';
                            }
                        }
                    }
                });
            }

            // Add click handler for the header to toggle expansion as well
            header.addEventListener('click', (e) => {
                // Only toggle if the click isn't on the toggle button itself
                const target = e.target as HTMLElement;
                if (target && !target.closest('.tool-execution-toggle')) {
                    const toggleButton = toolExecutionElement?.querySelector('.tool-execution-toggle');
                    toggleButton?.dispatchEvent(new Event('click'));
                }
            });
            (header as HTMLElement).style.cursor = 'pointer';
        }

        // Get the steps container
        const stepsContainer = toolExecutionElement.querySelector('.tool-execution-container');
        if (!stepsContainer) return;

        // Process based on action type
        const action = toolExecutionData.action || '';

        if (action === 'start' || action === 'executing') {
            // Tool execution started
            const step = document.createElement('div');
            step.className = 'tool-step executing p-2 mb-2 rounded';
            step.innerHTML = `
                <div class="d-flex align-items-center">
                    <i class="bx bx-code-block me-2"></i>
                    <span>Executing tool: <strong>${escapeHtml(toolExecutionData.tool || 'unknown')}</strong></span>
                </div>
                ${toolExecutionData.args ? `
                <div class="tool-args mt-1 ps-3">
                    <code>Args: ${escapeHtml(JSON.stringify(toolExecutionData.args || {}, null, 2))}</code>
                </div>` : ''}
            `;
            stepsContainer.appendChild(step);
        }
        else if (action === 'result' || action === 'complete') {
            // Tool execution completed with results
            const step = document.createElement('div');
            step.className = 'tool-step result p-2 mb-2 rounded';

            let resultDisplay = '';

            // Special handling for note search tools which have a specific structure
            if ((toolExecutionData.tool === 'search_notes' || toolExecutionData.tool === 'keyword_search_notes') &&
                typeof toolExecutionData.result === 'object' &&
                toolExecutionData.result.results) {

                const results = toolExecutionData.result.results;

                if (results.length === 0) {
                    resultDisplay = `<div class="text-muted">No notes found matching the search criteria.</div>`;
                } else {
                    resultDisplay = `
                        <div class="search-results">
                            <div class="mb-2">Found ${results.length} notes:</div>
                            <ul class="list-unstyled ps-1">
                                ${results.map((note: any) => `
                                    <li class="mb-1">
                                        <a href="#" class="note-link" data-note-id="${escapeHtml(note.noteId || '')}">${escapeHtml(note.title || '')}</a>
                                        ${note.similarity < 1 ? `<span class="text-muted small ms-1">(similarity: ${(note.similarity * 100).toFixed(0)}%)</span>` : ''}
                                    </li>
                                `).join('')}
                            </ul>
                        </div>
                    `;
                }
            }
            // Format the result based on type for other tools
            else if (typeof toolExecutionData.result === 'object') {
                // For objects, format as pretty JSON (escape HTML to prevent injection via JSON values)
                resultDisplay = `<pre class="mb-0"><code>${escapeHtml(JSON.stringify(toolExecutionData.result, null, 2))}</code></pre>`;
            } else {
                // For simple values, display as escaped text
                resultDisplay = `<div>${escapeHtml(String(toolExecutionData.result))}</div>`;
            }

            step.innerHTML = `
                <div class="d-flex align-items-center">
                    <i class="bx bx-terminal me-2"></i>
                    <span>Tool: <strong>${escapeHtml(toolExecutionData.tool || 'unknown')}</strong></span>
                </div>
                <div class="tool-result mt-1 ps-3">
                    ${resultDisplay}
                </div>
            `;
            stepsContainer.appendChild(step);

            // Add event listeners for note links if this is a note search result
            if (toolExecutionData.tool === 'search_notes' || toolExecutionData.tool === 'keyword_search_notes') {
                const noteLinks = step.querySelectorAll('.note-link');
                noteLinks.forEach(link => {
                    link.addEventListener('click', (e) => {
                        e.preventDefault();
                        const noteId = (e.currentTarget as HTMLElement).getAttribute('data-note-id');
                        if (noteId) {
                            // Open the note in a new tab but don't switch to it
                            appContext.tabManager.openTabWithNoteWithHoisting(noteId, { activate: false });
                        }
                    });
                });
            }
        }
        else if (action === 'error') {
            // Tool execution failed
            const step = document.createElement('div');
            step.className = 'tool-step error p-2 mb-2 rounded';
            step.innerHTML = `
                <div class="d-flex align-items-center">
                    <i class="bx bx-error-circle me-2"></i>
                    <span>Error in tool: <strong>${escapeHtml(toolExecutionData.tool || 'unknown')}</strong></span>
                </div>
                <div class="tool-error mt-1 ps-3 text-danger">
                    ${escapeHtml(toolExecutionData.error || 'Unknown error')}
                </div>
            `;
            stepsContainer.appendChild(step);
        }
        else if (action === 'generating') {
            // Generating final response with tool results
            const step = document.createElement('div');
            step.className = 'tool-step generating p-2 mb-2 rounded';
            step.innerHTML = `
                <div class="d-flex align-items-center">
                    <i class="bx bx-message-dots me-2"></i>
                    <span>Generating response with tool results...</span>
                </div>
            `;
            stepsContainer.appendChild(step);
        }

        // Make sure the loading indicator is shown during tool execution
        this.loadingIndicator.style.display = 'flex';

        // Scroll the chat container to show the tool execution
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    /**
     * Show thinking state in the UI
     */
    private showThinkingState(thinkingData: string) {
        // Parse the thinking content to extract text between <think> tags
        const thinkingContent = this.parseThinkingContent(thinkingData);

        if (thinkingContent) {
            this.showThinkingDisplay(thinkingContent);
        } else {
            // Fallback: show raw thinking data
            this.showThinkingDisplay(thinkingData);
        }

        // Show the loading indicator as well
        this.loadingIndicator.style.display = 'flex';
    }

    /**
     * Parse thinking content from LLM response
     */
    private parseThinkingContent(content: string): string | null {
        if (!content) return null;

        // Look for content between <think> and </think> tags
        const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
        const matches: string[] = [];
        let match: RegExpExecArray | null;

        while ((match = thinkRegex.exec(content)) !== null) {
            matches.push(match[1].trim());
        }

        if (matches.length > 0) {
            return matches.join('\n\n--- Next thought ---\n\n');
        }

        // Check for incomplete thinking blocks (streaming in progress)
        const incompleteThinkRegex = /<think>([\s\S]*?)$/i;
        const incompleteMatch = content.match(incompleteThinkRegex);

        if (incompleteMatch && incompleteMatch[1]) {
            return incompleteMatch[1].trim() + '\n\n[Thinking in progress...]';
        }

        // If no think tags found, check if the entire content might be thinking
        if (content.toLowerCase().includes('thinking') ||
            content.toLowerCase().includes('reasoning') ||
            content.toLowerCase().includes('let me think') ||
            content.toLowerCase().includes('i need to') ||
            content.toLowerCase().includes('first, ') ||
            content.toLowerCase().includes('step 1') ||
            content.toLowerCase().includes('analysis:')) {
            return content;
        }

        return null;
    }

    private initializeEventListeners() {
        this.noteContextChatForm.addEventListener('submit', (e) => {
            e.preventDefault();

            let content = '';

            if (this.noteContextChatInputEditor && this.noteContextChatInputEditor.getData) {
                // Use CKEditor content
                content = this.noteContextChatInputEditor.getData();
            } else {
                // Fallback: check if there's a textarea (fallback mode)
                const textarea = this.noteContextChatInput.querySelector('textarea');
                if (textarea) {
                    content = textarea.value;
                } else {
                    // Last resort: try to get text content from the div
                    content = this.noteContextChatInput.textContent || this.noteContextChatInput.innerText || '';
                }
            }

            if (content.trim()) {
                this.sendMessage(content);
            }
        });

        // Handle Enter key (send on Enter, new line on Shift+Enter) via CKEditor
        // We'll set this up after CKEditor is initialized
        this.setupEditorKeyBindings();
    }

    private setupEditorKeyBindings() {
        if (this.noteContextChatInputEditor && this.noteContextChatInputEditor.keystrokes) {
            try {
                this.noteContextChatInputEditor.keystrokes.set('Enter', (key, stop) => {
                    if (!key.shiftKey) {
                        stop();
                        this.noteContextChatForm.dispatchEvent(new Event('submit'));
                    }
                });
                console.log('CKEditor keybindings set up successfully');
            } catch (error) {
                console.warn('Failed to set up CKEditor keybindings:', error);
            }
        }
    }

    /**
     * Extract note mentions and content from CKEditor
     */
    private extractMentionsAndContent(editorData: string): { content: string; mentions: Array<{noteId: string; title: string; notePath: string}> } {
        const mentions: Array<{noteId: string; title: string; notePath: string}> = [];

        // Parse the HTML content to extract mentions
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = editorData;

        // Find all mention elements - CKEditor uses specific patterns for mentions
        // Look for elements with data-mention attribute or specific mention classes
        const mentionElements = tempDiv.querySelectorAll('[data-mention], .mention, span[data-id]');

        mentionElements.forEach(mentionEl => {
            try {
                // Try different ways to extract mention data based on CKEditor's format
                let mentionData: any = null;

                // Method 1: data-mention attribute (JSON format)
                if (mentionEl.hasAttribute('data-mention')) {
                    mentionData = JSON.parse(mentionEl.getAttribute('data-mention') || '{}');
                }
                // Method 2: data-id attribute (simple format)
                else if (mentionEl.hasAttribute('data-id')) {
                    const dataId = mentionEl.getAttribute('data-id');
                    const textContent = mentionEl.textContent || '';

                    // Parse the dataId to extract note information
                    if (dataId && dataId.startsWith('@')) {
                        const cleanId = dataId.substring(1); // Remove the @
                        mentionData = {
                            id: cleanId,
                            name: textContent,
                            notePath: cleanId // Assume the ID contains the path
                        };
                    }
                }
                // Method 3: Check if this is a reference link (href=#notePath)
                else if (mentionEl.tagName === 'A' && mentionEl.hasAttribute('href')) {
                    const href = mentionEl.getAttribute('href');
                    if (href && href.startsWith('#')) {
                        const notePath = href.substring(1);
                        mentionData = {
                            notePath: notePath,
                            noteTitle: mentionEl.textContent || 'Unknown Note'
                        };
                    }
                }

                if (mentionData && (mentionData.notePath || mentionData.link)) {
                    const notePath = mentionData.notePath || mentionData.link?.substring(1); // Remove # from link
                    const noteId = notePath ? notePath.split('/').pop() : null;
                    const title = mentionData.noteTitle || mentionData.name || mentionEl.textContent || 'Unknown Note';

                    if (noteId) {
                        mentions.push({
                            noteId: noteId,
                            title: title,
                            notePath: notePath
                        });
                        console.log(`Extracted mention: noteId=${noteId}, title=${title}, notePath=${notePath}`);
                    }
                }
            } catch (e) {
                console.warn('Failed to parse mention data:', e, mentionEl);
            }
        });

        // Convert to plain text for the LLM, but preserve the structure
        const content = tempDiv.textContent || tempDiv.innerText || '';

        console.log(`Extracted ${mentions.length} mentions from editor content`);
        return { content, mentions };
    }

    private setupThinkingToggle() {
        if (this.thinkingToggle) {
            this.thinkingToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleThinkingDetails();
            });
        }

        // Also make the entire header clickable
        const thinkingHeader = this.thinkingBubble?.querySelector('.thinking-header');
        if (thinkingHeader) {
            thinkingHeader.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                if (!target.closest('.thinking-toggle')) {
                    this.toggleThinkingDetails();
                }
            });
        }
    }

    private toggleThinkingDetails() {
        const content = this.thinkingBubble?.querySelector('.thinking-content') as HTMLElement;
        const toggle = this.thinkingToggle?.querySelector('i');

        if (content && toggle) {
            const isVisible = content.style.display !== 'none';

            if (isVisible) {
                content.style.display = 'none';
                toggle.className = 'bx bx-chevron-down';
                this.thinkingToggle.classList.remove('expanded');
            } else {
                content.style.display = 'block';
                toggle.className = 'bx bx-chevron-up';
                this.thinkingToggle.classList.add('expanded');
            }
        }
    }

    /**
     * Show the thinking display with optional initial content
     */
    private showThinkingDisplay(initialText: string = '') {
        if (this.thinkingContainer) {
            this.thinkingContainer.style.display = 'block';

            if (initialText && this.thinkingText) {
                this.updateThinkingText(initialText);
            }

            // Scroll to show the thinking display
            this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
        }
    }

    /**
     * Update the thinking text content
     */
    private updateThinkingText(text: string) {
        if (this.thinkingText) {
            // Format the thinking text for better readability
            const formattedText = this.formatThinkingText(text);
            this.thinkingText.textContent = formattedText;

            // Auto-scroll if content is expanded
            const content = this.thinkingBubble?.querySelector('.thinking-content') as HTMLElement;
            if (content && content.style.display !== 'none') {
                this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
            }
        }
    }

    /**
     * Format thinking text for better presentation
     */
    private formatThinkingText(text: string): string {
        if (!text) return text;

        // Clean up the text
        let formatted = text.trim();

        // Add some basic formatting
        formatted = formatted
            // Add spacing around section markers
            .replace(/(\d+\.\s)/g, '\n$1')
            // Clean up excessive whitespace
            .replace(/\n\s*\n\s*\n/g, '\n\n')
            // Trim again
            .trim();

        return formatted;
    }

    /**
     * Hide the thinking display
     */
    private hideThinkingDisplay() {
        if (this.thinkingContainer) {
            this.thinkingContainer.style.display = 'none';

            // Reset the toggle state
            const content = this.thinkingBubble?.querySelector('.thinking-content') as HTMLElement;
            const toggle = this.thinkingToggle?.querySelector('i');

            if (content && toggle) {
                content.style.display = 'none';
                toggle.className = 'bx bx-chevron-down';
                this.thinkingToggle?.classList.remove('expanded');
            }

            // Clear the text content
            if (this.thinkingText) {
                this.thinkingText.textContent = '';
            }
        }
    }

    /**
     * Append to existing thinking content (for streaming updates)
     */
    private appendThinkingText(additionalText: string) {
        if (this.thinkingText && additionalText) {
            const currentText = this.thinkingText.textContent || '';
            const newText = currentText + additionalText;
            this.updateThinkingText(newText);
        }
    }
}
