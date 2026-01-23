import type { Message } from '../ai_interface.js';
import type { ToolCall } from '../tools/tool_interfaces.js';

export type FallbackToolName = 'list_notes' | 'search_notes' | 'keyword_search_notes';

export interface FallbackToolDecision {
    name: FallbackToolName;
    reason: string;
}

export const getFallbackToolForQuery: (query: string) => FallbackToolDecision | null = (query) => {
    const trimmed = query.trim();
    if (!trimmed) {
        return null;
    }

    const normalized = trimmed.toLowerCase();
    const listHints = ['list', 'show', 'what notes', 'all notes', 'catalog', 'index'];
    const keywordHints = ['#', 'attribute', 'label', 'relation', '='];

    if (listHints.some(hint => normalized.includes(hint))) {
        return { name: 'list_notes', reason: 'list query' };
    }

    if (keywordHints.some(hint => normalized.includes(hint))) {
        return { name: 'keyword_search_notes', reason: 'keyword query' };
    }

    return { name: 'search_notes', reason: 'general query' };
};

export const buildForcedToolCallInstruction: (toolName: FallbackToolName, query: string) => string = (toolName, query) => {
    const trimmed = query.trim();
    if (!trimmed) {
        return `You must call the ${toolName} tool now. Respond only with a tool call.`;
    }

    return `You must call the ${toolName} tool now to gather note data for: "${trimmed}". Respond only with a tool call.`;
};

export const buildSyntheticToolCalls: (toolName: FallbackToolName, query: string) => ToolCall[] = (toolName, query) => {
    const trimmed = query.trim();
    const args: Record<string, unknown> = {};

    if (toolName === 'search_notes' || toolName === 'keyword_search_notes') {
        if (trimmed) {
            args.query = trimmed;
        }
    }

    return [
        {
            id: `forced-${Date.now()}`,
            type: 'function',
            function: {
                name: toolName,
                arguments: JSON.stringify(args)
            }
        }
    ];
};

export const buildFallbackResponseFromToolResults: (messages: Message[]) => string = (messages) => {
    const toolMessages = messages.filter(message => message.role === 'tool').slice(-3);

    if (toolMessages.length === 0) {
        return 'Tool execution completed, but no final response was generated. Please retry or adjust the request.';
    }

    const resultLines = toolMessages.map(toolMessage => {
        const toolName = toolMessage.name || 'tool';
        const content = typeof toolMessage.content === 'string' ? toolMessage.content : String(toolMessage.content);
        const preview = content.length > 500 ? `${content.slice(0, 500)}...` : content;
        return `- ${toolName}: ${preview}`;
    });

    return [
        'Tool execution completed, but the model returned no final text.',
        'Latest tool results:',
        ...resultLines
    ].join('\n');
};

export const getToolNameFromToolCallId: (messages: Message[], toolCallId: string) => string = (messages, toolCallId) => {
    if (!toolCallId) {
        return 'unknown';
    }

    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message.role === 'assistant' && message.tool_calls) {
            const toolCall = message.tool_calls.find(tc => tc.id === toolCallId);
            if (toolCall && toolCall.function && toolCall.function.name) {
                return toolCall.function.name;
            }
        }
    }

    return 'unknown';
};

export const validateToolMessages: (messages: Message[]) => void = (messages) => {
    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];

        if (message.role === 'tool') {
            if (!message.tool_call_id) {
                message.tool_call_id = `tool_${i}`;
            }

            if (typeof message.content !== 'string') {
                try {
                    message.content = JSON.stringify(message.content);
                } catch (error) {
                    message.content = String(message.content);
                }
            }
        }
    }
};
