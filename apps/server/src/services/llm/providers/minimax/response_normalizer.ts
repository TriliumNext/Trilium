import type { ChatResponse } from '../../ai_interface.js';
import type { ToolCall } from '../../tools/tool_interfaces.js';
import log from '../../../log.js';

export function parseMiniMaxResponse(response: any, providerName: string): ChatResponse {
    const textContent = response.content
        ?.filter((block: any) => block.type === 'text')
        ?.map((block: any) => block.text)
        ?.join('') || '';

    let toolCalls: ToolCall[] | null = null;
    if (response.content) {
        const toolBlocks = response.content.filter((block: any) =>
            block.type === 'tool_use'
        );

        if (toolBlocks.length > 0) {
            log.info(`Found ${toolBlocks.length} tool_use blocks in MiniMax response`);

            toolCalls = toolBlocks.map((block: any) => ({
                id: block.id,
                type: 'function',
                function: {
                    name: block.name,
                    arguments: JSON.stringify(block.input || {})
                }
            }));

            log.info(`Extracted ${toolCalls?.length ?? 0} tool calls from MiniMax response`);
        }
    }

    return {
        text: textContent,
        model: response.model,
        provider: providerName,
        tool_calls: toolCalls,
        usage: {
            promptTokens: response.usage?.input_tokens,
            completionTokens: response.usage?.output_tokens,
            totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
        }
    };
}
