import log from '../../../log.js';
import toolRegistry from '../../tools/tool_registry.js';

export interface ToolInterface {
    execute: (args: Record<string, unknown>) => Promise<unknown>;
    [key: string]: unknown;
}

export const validateToolBeforeExecution: (tool: ToolInterface, toolName: string) => Promise<boolean> = async (tool, toolName) => {
    try {
        if (!tool) {
            log.error(`Tool '${toolName}' not found or failed validation`);
            return false;
        }

        if (!tool.execute || typeof tool.execute !== 'function') {
            log.error(`Tool '${toolName}' is missing execute method`);
            return false;
        }

        return true;
    } catch (error) {
        log.error(`Error validating tool '${toolName}': ${error}`);
        return false;
    }
};

export const generateToolGuidance: (toolName: string, errorMessage: string) => string = (toolName, errorMessage) => {
    const tools = toolRegistry.getAllTools();
    const availableTools = tools.map(tool => tool.definition?.function?.name).filter(Boolean) as string[];

    let guidance = `Tool execution failed: ${errorMessage}\n`;
    guidance += `Available tools are: ${availableTools.join(', ')}.\n`;
    guidance += `Please choose a valid tool and ensure parameters match the required schema.`;

    if (!availableTools.includes(toolName)) {
        guidance += `\nNote: "${toolName}" is not a valid tool name.`;
    }

    return guidance;
};

export const isEmptyToolResult: (result: unknown, toolName: string) => boolean = (result, toolName) => {
    if (result === null || result === undefined) {
        return true;
    }

    if (typeof result === 'string') {
        const trimmed = result.trim();
        if (trimmed.length === 0) {
            return true;
        }

        const emptyIndicators = [
            'no results',
            'not found',
            'empty',
            'no notes found',
            '0 results'
        ];

        return emptyIndicators.some(indicator => trimmed.toLowerCase().includes(indicator));
    }

    if (typeof result === 'object') {
        if (Array.isArray(result)) {
            return result.length === 0;
        }

        if ('results' in result && Array.isArray((result as { results: unknown[] }).results)) {
            return (result as { results: unknown[] }).results.length === 0;
        }

        if ('count' in result && typeof (result as { count: unknown }).count === 'number') {
            return (result as { count: number }).count === 0;
        }
    }

    if (toolName === 'search_notes' || toolName === 'keyword_search_notes') {
        if (typeof result === 'object' && result !== null) {
            if ('message' in result && typeof (result as { message: unknown }).message === 'string') {
                const message = (result as { message: string }).message.toLowerCase();
                if (message.includes('no notes found')) {
                    return true;
                }
            }
        }
    }

    return false;
};
