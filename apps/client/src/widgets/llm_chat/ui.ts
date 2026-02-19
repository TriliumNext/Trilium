/**
 * UI-related functions for LLM Chat
 */
import { t } from "../../services/i18n.js";
import type { ToolExecutionStep } from "./types.js";
import { escapeHtml, formatMarkdown, applyHighlighting } from "./utils.js";
import DOMPurify from "dompurify";

// Template for the chat widget
export const TPL = `
<div class="note-context-chat h-100 w-100 d-flex flex-column">
    <!-- Move validation warning outside the card with better styling -->
    <div class="provider-validation-warning alert alert-warning m-2 border-inline-start border-warning" style="display: none; padding-inline-start: 15px; border-inline-start: 4px solid #ffc107; background-color: rgba(255, 248, 230, 0.9); font-size: 0.9rem; box-shadow: 0 2px 5px rgba(0,0,0,0.05);"></div>

    <div class="note-context-chat-container flex-grow-1 overflow-auto p-3">
        <div class="note-context-chat-messages"></div>

        <!-- Thinking display area -->
        <div class="llm-thinking-container" style="display: none;">
            <div class="thinking-bubble">
                <div class="thinking-header d-flex align-items-center">
                    <div class="thinking-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                    <span class="thinking-label ms-2 text-muted small">AI is thinking...</span>
                    <button type="button" class="btn btn-sm btn-link p-0 ms-auto thinking-toggle" title="Toggle thinking details">
                        <i class="bx bx-chevron-down"></i>
                    </button>
                </div>
                <div class="thinking-content" style="display: none;">
                    <div class="thinking-text"></div>
                </div>
            </div>
        </div>

        <div class="loading-indicator" style="display: none;">
            <div class="spinner-border spinner-border-sm text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <span class="ms-2">${t('ai_llm.agent.processing')}</span>
        </div>
    </div>

    <div class="sources-container p-2 border-top" style="display: none;">
        <h6 class="m-0 p-1 d-flex align-items-center">
            <i class="bx bx-link-alt me-1"></i> ${t('ai_llm.sources')}
            <span class="badge bg-primary rounded-pill ms-2 sources-count"></span>
        </h6>
        <div class="sources-list mt-2"></div>
    </div>

    <form class="note-context-chat-form d-flex flex-column border-top p-2">
        <div class="d-flex chat-input-container mb-2">
            <div
                class="form-control note-context-chat-input flex-grow-1"
                style="min-height: 60px; max-height: 200px; overflow-y: auto;"
                data-placeholder="${t('ai_llm.enter_message')}"
            ></div>
            <button type="submit" class="btn btn-primary note-context-chat-send-button ms-2 d-flex align-items-center justify-content-center">
                <i class="bx bx-send"></i>
            </button>
        </div>
        <div class="d-flex align-items-center context-option-container mt-1 justify-content-end">
            <small class="text-muted me-auto fst-italic">Options:</small>
            <div class="form-check form-switch me-3 small">
                <input class="form-check-input use-advanced-context-checkbox" type="checkbox" id="useEnhancedContext" checked>
                <label class="form-check-label small" for="useEnhancedContext" title="${t('ai.enhanced_context_description')}">
                    ${t('ai_llm.use_enhanced_context')}
                    <i class="bx bx-info-circle small text-muted"></i>
                </label>
            </div>
            <div class="form-check form-switch small">
                <input class="form-check-input show-thinking-checkbox" type="checkbox" id="showThinking">
                <label class="form-check-label small" for="showThinking" title="${t('ai.show_thinking_description')}">
                    ${t('ai_llm.show_thinking')}
                    <i class="bx bx-info-circle small text-muted"></i>
                </label>
            </div>
        </div>
    </form>
</div>
`;

/**
 * Add a message to the chat UI
 */
export function addMessageToChat(messagesContainer: HTMLElement, chatContainer: HTMLElement, role: 'user' | 'assistant', content: string) {
    const messageElement = document.createElement('div');
    messageElement.className = `chat-message ${role}-message mb-3 d-flex`;

    const avatarElement = document.createElement('div');
    avatarElement.className = 'message-avatar d-flex align-items-center justify-content-center me-2';

    if (role === 'user') {
        avatarElement.innerHTML = '<i class="bx bx-user"></i>';
        avatarElement.classList.add('user-avatar');
    } else {
        avatarElement.innerHTML = '<i class="bx bx-bot"></i>';
        avatarElement.classList.add('assistant-avatar');
    }

    const contentElement = document.createElement('div');
    contentElement.className = 'message-content p-3 rounded flex-grow-1';

    if (role === 'user') {
        contentElement.classList.add('user-content', 'bg-light');
    } else {
        contentElement.classList.add('assistant-content');
    }

    // Format the content with markdown and sanitize to prevent XSS
    contentElement.innerHTML = DOMPurify.sanitize(formatMarkdown(content));

    messageElement.appendChild(avatarElement);
    messageElement.appendChild(contentElement);

    messagesContainer.appendChild(messageElement);

    // Apply syntax highlighting to any code blocks in the message
    applyHighlighting(contentElement);

    // Scroll to bottom
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

/**
 * Show sources in the UI
 */
export function showSources(
    sourcesList: HTMLElement,
    sourcesContainer: HTMLElement,
    sourcesCount: HTMLElement,
    sources: Array<{noteId: string, title: string}>,
    onSourceClick: (noteId: string) => void
) {
    sourcesList.innerHTML = '';
    sourcesCount.textContent = sources.length.toString();

    sources.forEach(source => {
        const sourceElement = document.createElement('div');
        sourceElement.className = 'source-item p-2 mb-1 border rounded d-flex align-items-center';

        // Build the link safely using DOM APIs to prevent XSS via note titles
        const wrapper = document.createElement('div');
        wrapper.className = 'd-flex align-items-center w-100';

        const link = document.createElement('a');
        link.href = `#root/${source.noteId}`;
        link.setAttribute('data-note-id', source.noteId);
        link.className = 'source-link text-truncate d-flex align-items-center';
        link.title = `Open note: ${source.title}`;

        const icon = document.createElement('i');
        icon.className = 'bx bx-file-blank me-1';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'source-title';
        titleSpan.textContent = source.title;

        link.appendChild(icon);
        link.appendChild(titleSpan);
        wrapper.appendChild(link);
        sourceElement.appendChild(wrapper);

        // Add click handler
        link.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onSourceClick(source.noteId);
            return false;
        });

        sourcesList.appendChild(sourceElement);
    });

    sourcesContainer.style.display = 'block';
}

/**
 * Hide sources in the UI
 */
export function hideSources(sourcesContainer: HTMLElement) {
    sourcesContainer.style.display = 'none';
}

/**
 * Show loading indicator
 */
export function showLoadingIndicator(loadingIndicator: HTMLElement) {
    const logId = `ui-${Date.now()}`;
    console.log(`[${logId}] Showing loading indicator`);

    try {
        loadingIndicator.style.display = 'flex';
        const forceUpdate = loadingIndicator.offsetHeight;
        console.log(`[${logId}] Loading indicator initialized`);
    } catch (err) {
        console.error(`[${logId}] Error showing loading indicator:`, err);
    }
}

/**
 * Hide loading indicator
 */
export function hideLoadingIndicator(loadingIndicator: HTMLElement) {
    const logId = `ui-${Date.now()}`;
    console.log(`[${logId}] Hiding loading indicator`);

    try {
        loadingIndicator.style.display = 'none';
        const forceUpdate = loadingIndicator.offsetHeight;
        console.log(`[${logId}] Loading indicator hidden`);
    } catch (err) {
        console.error(`[${logId}] Error hiding loading indicator:`, err);
    }
}

/**
 * Render tool steps as HTML for display in chat
 */
export function renderToolStepsHtml(steps: ToolExecutionStep[]): string {
    if (!steps || steps.length === 0) return '';

    let html = '';

    steps.forEach(step => {
        let icon, labelClass, content;
        const safeContent = escapeHtml(step.content || '');
        const safeName = escapeHtml(step.name || 'unknown');

        switch (step.type) {
            case 'executing':
                icon = 'bx-code-block text-primary';
                labelClass = '';
                content = `<div class="d-flex align-items-center">
                    <i class="bx ${icon} me-1"></i>
                    <span>${safeContent}</span>
                </div>`;
                break;

            case 'result':
                icon = 'bx-terminal text-success';
                labelClass = 'fw-bold';
                content = `<div class="d-flex align-items-center">
                    <i class="bx ${icon} me-1"></i>
                    <span class="${labelClass}">Tool: ${safeName}</span>
                </div>
                <div class="mt-1 ps-3">${safeContent}</div>`;
                break;

            case 'error':
                icon = 'bx-error-circle text-danger';
                labelClass = 'fw-bold text-danger';
                content = `<div class="d-flex align-items-center">
                    <i class="bx ${icon} me-1"></i>
                    <span class="${labelClass}">Tool: ${safeName}</span>
                </div>
                <div class="mt-1 ps-3 text-danger">${safeContent}</div>`;
                break;

            case 'generating':
                icon = 'bx-message-dots text-info';
                labelClass = '';
                content = `<div class="d-flex align-items-center">
                    <i class="bx ${icon} me-1"></i>
                    <span>${safeContent}</span>
                </div>`;
                break;

            default:
                icon = 'bx-info-circle text-muted';
                labelClass = '';
                content = `<div class="d-flex align-items-center">
                    <i class="bx ${icon} me-1"></i>
                    <span>${safeContent}</span>
                </div>`;
        }

        html += `<div class="tool-step my-1">${content}</div>`;
    });

    return html;
}
