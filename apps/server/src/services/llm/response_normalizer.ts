import type { ChatResponse, NormalizedChatResponse } from './ai_interface.js';
import type { ToolCall } from './tools/tool_interfaces.js';

interface NormalizedToolCall {
    id: string;
    type?: string;
    function: {
        name: string;
        arguments: Record<string, unknown> | string;
    };
}

function normalizeToolCall(toolCall: ToolCall, index: number): NormalizedToolCall | null {
    if (!toolCall || !toolCall.function || typeof toolCall.function.name !== 'string') {
        return null;
    }

    const name = toolCall.function.name.trim();
    if (!name) {
        return null;
    }

    const rawArgs = toolCall.function.arguments;
    const normalizedArgs = rawArgs === undefined || rawArgs === null ? {} : rawArgs;

    return {
        id: toolCall.id || `call_${index}`,
        type: toolCall.type,
        function: {
            name,
            arguments: normalizedArgs
        }
    };
}

export function normalizeChatResponse(response: ChatResponse): NormalizedChatResponse {
    const toolCalls = Array.isArray(response.tool_calls)
        ? response.tool_calls
        : [];

    const normalizedToolCalls = toolCalls
        .map((toolCall, index) => normalizeToolCall(toolCall, index))
        .filter((toolCall): toolCall is NormalizedToolCall => toolCall !== null);

    const normalizedText = typeof response.text === 'string' ? response.text : '';

    return {
        ...response,
        text: normalizedText,
        tool_calls: normalizedToolCalls
    };
}
