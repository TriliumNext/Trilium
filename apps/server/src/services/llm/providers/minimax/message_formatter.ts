import type { Message } from '../../ai_interface.js';

export function formatMiniMaxMessages(messages: Message[]): Array<Record<string, unknown>> {
    const formatted: Array<Record<string, unknown>> = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            continue;
        }

        const formattedMsg: Record<string, unknown> = {
            role: msg.role === 'tool' ? 'assistant' : msg.role,
            content: msg.content
        };

        if (msg.tool_calls && msg.tool_calls.length > 0) {
            const toolBlocks = msg.tool_calls.map(toolCall => {
                let input: Record<string, unknown> = {};
                const rawArgs = toolCall.function.arguments;
                if (typeof rawArgs === 'string') {
                    try {
                        input = JSON.parse(rawArgs) as Record<string, unknown>;
                    } catch {
                        input = {};
                    }
                } else if (rawArgs && typeof rawArgs === 'object') {
                    input = rawArgs;
                }

                return {
                    type: 'tool_use',
                    id: toolCall.id,
                    name: toolCall.function.name,
                    input
                };
            });

            formattedMsg.content = [
                { type: 'text', text: msg.content },
                ...toolBlocks
            ];
        }

        if (msg.role === 'tool') {
            formattedMsg.role = 'user';
            formattedMsg.content = [
                { type: 'tool_result', tool_use_id: msg.tool_call_id, content: msg.content }
            ];
        }

        formatted.push(formattedMsg);
    }

    return formatted;
}
