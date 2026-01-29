import type { ToolChoice, ToolData } from '../../ai_interface.js';
import log from '../../../log.js';

export interface NormalizedToolChoice {
    type: 'auto' | 'any' | 'none' | 'tool';
    name?: string;
    disable_parallel_tool_use?: boolean;
}

export function normalizeMiniMaxToolChoice(toolChoice: ToolChoice | NormalizedToolChoice | unknown): NormalizedToolChoice | null {
    if (!toolChoice) {
        return null;
    }

    if (typeof toolChoice === 'string') {
        switch (toolChoice) {
            case 'auto':
                return { type: 'auto' };
            case 'any':
                return { type: 'any' };
            case 'none':
                return { type: 'none' };
            default:
                return { type: 'tool', name: toolChoice };
        }
    }

    if (typeof toolChoice !== 'object') {
        return null;
    }

    const choice = toolChoice as Record<string, unknown>;
    const disableParallel = typeof choice.disable_parallel_tool_use === 'boolean'
        ? choice.disable_parallel_tool_use
        : undefined;

    const functionChoice = choice.function;
    if (functionChoice && typeof functionChoice === 'object') {
        const functionData = functionChoice as Record<string, unknown>;
        if (typeof functionData.name === 'string' && functionData.name.trim() !== '') {
            const normalized: NormalizedToolChoice = {
                type: 'tool',
                name: functionData.name
            };
            if (disableParallel !== undefined) {
                normalized.disable_parallel_tool_use = disableParallel;
            }
            return normalized;
        }
    }

    const typeValue = typeof choice.type === 'string' ? choice.type : null;
    if (typeValue === 'auto' || typeValue === 'any' || typeValue === 'none') {
        const normalized: NormalizedToolChoice = { type: typeValue };
        if (disableParallel !== undefined) {
            normalized.disable_parallel_tool_use = disableParallel;
        }
        return normalized;
    }

    if (typeValue === 'tool') {
        const nameValue = typeof choice.name === 'string' ? choice.name : null;
        if (nameValue && nameValue.trim() !== '') {
            const normalized: NormalizedToolChoice = {
                type: 'tool',
                name: nameValue
            };
            if (disableParallel !== undefined) {
                normalized.disable_parallel_tool_use = disableParallel;
            }
            return normalized;
        }
    }

    return null;
}

interface MiniMaxTool {
    name: string;
    description: string;
    input_schema: unknown;
}

export function convertToolsToMiniMaxFormat(tools: ToolData[] | Array<Record<string, unknown>>): MiniMaxTool[] {
    if (!tools || tools.length === 0) {
        return [];
    }

    log.info(`[TOOL DEBUG] Converting ${tools.length} tools to MiniMax format`);

    return tools.map(tool => {
        if ('type' in tool && tool.type === 'function' && 'function' in tool && tool.function) {
            const functionData = tool.function as ToolData['function'];
            log.info(`[TOOL DEBUG] Converting function tool: ${functionData.name}`);

            return {
                name: functionData.name,
                description: functionData.description || '',
                input_schema: functionData.parameters || {}
            };
        }

        if ('name' in tool && ('input_schema' in tool || 'parameters' in tool)) {
            return {
                name: String(tool.name),
                description: typeof tool.description === 'string' ? tool.description : '',
                input_schema: (tool as Record<string, unknown>).input_schema || (tool as Record<string, unknown>).parameters
            };
        }

        log.info(`[TOOL DEBUG] Unhandled tool format: ${JSON.stringify(tool)}`);
        return null;
    }).filter((tool): tool is MiniMaxTool => tool !== null);
}
