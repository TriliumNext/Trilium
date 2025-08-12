/**
 * Tool Format Adapter
 * 
 * This module provides standardized conversion between different LLM provider tool formats.
 * It ensures consistent tool handling across OpenAI, Anthropic, Ollama, and other providers.
 */

import log from '../../log.js';
import type { Tool, ToolCall, ToolParameter } from './tool_interfaces.js';
import { providerToolValidator } from './provider_tool_validator.js';
import { edgeCaseHandler } from '../providers/edge_case_handler.js';
import { parameterCoercer } from './parameter_coercer.js';

/**
 * Anthropic tool format
 */
export interface AnthropicTool {
    name: string;
    description: string;
    input_schema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}

/**
 * OpenAI tool format (already matches our standard Tool interface)
 */
export type OpenAITool = Tool;

/**
 * Ollama tool format
 */
export interface OllamaTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

/**
 * Provider types
 */
export type ProviderType = 'openai' | 'anthropic' | 'ollama' | 'unknown';

/**
 * Tool format adapter for converting between different provider formats
 */
export class ToolFormatAdapter {
    /**
     * Convert tools from standard format to provider-specific format
     */
    static convertToProviderFormat(tools: Tool[], provider: ProviderType): unknown[] {
        // First validate and fix tools for the provider
        const validatedTools = providerToolValidator.autoFixTools(tools, provider);
        
        // Apply edge case fixes
        const fixedTools = edgeCaseHandler.fixToolsForProvider(validatedTools, provider);
        
        switch (provider) {
            case 'anthropic':
                return this.convertToAnthropicFormat(fixedTools);
            case 'ollama':
                return this.convertToOllamaFormat(fixedTools);
            case 'openai':
                // OpenAI format matches our standard format
                return fixedTools;
            default:
                log.info(`Warning: Unknown provider ${provider}, returning tools in standard format`);
                return fixedTools;
        }
    }

    /**
     * Convert tools to Anthropic format
     */
    static convertToAnthropicFormat(tools: Tool[]): AnthropicTool[] {
        const converted: AnthropicTool[] = [];

        for (const tool of tools) {
            if (!this.validateTool(tool)) {
                log.error(`Invalid tool skipped: ${JSON.stringify(tool)}`);
                continue;
            }

            try {
                const anthropicTool: AnthropicTool = {
                    name: tool.function.name,
                    description: tool.function.description || '',
                    input_schema: {
                        type: 'object',
                        properties: tool.function.parameters.properties || {},
                        required: tool.function.parameters.required || []
                    }
                };

                // Validate the converted tool
                if (this.validateAnthropicTool(anthropicTool)) {
                    converted.push(anthropicTool);
                    log.info(`Successfully converted tool ${tool.function.name} to Anthropic format`);
                } else {
                    log.error(`Failed to validate converted Anthropic tool: ${tool.function.name}`);
                }
            } catch (error) {
                log.error(`Error converting tool ${tool.function.name} to Anthropic format: ${error}`);
            }
        }

        return converted;
    }

    /**
     * Convert tools to Ollama format
     */
    static convertToOllamaFormat(tools: Tool[]): OllamaTool[] {
        const converted: OllamaTool[] = [];

        for (const tool of tools) {
            if (!this.validateTool(tool)) {
                log.error(`Invalid tool skipped: ${JSON.stringify(tool)}`);
                continue;
            }

            try {
                const ollamaTool: OllamaTool = {
                    type: 'function',
                    function: {
                        name: tool.function.name,
                        description: tool.function.description || '',
                        parameters: tool.function.parameters || {}
                    }
                };

                converted.push(ollamaTool);
                log.info(`Successfully converted tool ${tool.function.name} to Ollama format`);
            } catch (error) {
                log.error(`Error converting tool ${tool.function.name} to Ollama format: ${error}`);
            }
        }

        return converted;
    }

    /**
     * Convert tool calls from provider format to standard format
     */
    static convertToolCallsFromProvider(toolCalls: unknown[], provider: ProviderType): ToolCall[] {
        switch (provider) {
            case 'anthropic':
                return this.convertAnthropicToolCalls(toolCalls);
            case 'ollama':
                return this.convertOllamaToolCalls(toolCalls);
            case 'openai':
                // OpenAI format matches our standard format
                return toolCalls as ToolCall[];
            default:
                log.info(`Warning: Unknown provider ${provider}, attempting standard conversion`);
                return toolCalls as ToolCall[];
        }
    }

    /**
     * Convert Anthropic tool calls to standard format
     */
    private static convertAnthropicToolCalls(toolCalls: unknown[]): ToolCall[] {
        const converted: ToolCall[] = [];

        for (const call of toolCalls) {
            if (typeof call === 'object' && call !== null) {
                const anthropicCall = call as any;
                
                // Handle tool_use blocks from Anthropic
                if (anthropicCall.type === 'tool_use') {
                    converted.push({
                        id: anthropicCall.id,
                        type: 'function',
                        function: {
                            name: anthropicCall.name,
                            arguments: typeof anthropicCall.input === 'string' 
                                ? anthropicCall.input 
                                : JSON.stringify(anthropicCall.input || {})
                        }
                    });
                } 
                // Handle already converted format
                else if (anthropicCall.function) {
                    converted.push(anthropicCall as ToolCall);
                }
            }
        }

        return converted;
    }

    /**
     * Convert Ollama tool calls to standard format
     */
    private static convertOllamaToolCalls(toolCalls: unknown[]): ToolCall[] {
        // Ollama typically uses a format similar to OpenAI
        return toolCalls as ToolCall[];
    }

    /**
     * Validate a standard tool definition
     */
    static validateTool(tool: unknown): tool is Tool {
        if (!tool || typeof tool !== 'object') {
            return false;
        }

        const t = tool as any;
        
        // Check required fields
        if (t.type !== 'function') {
            log.error(`Tool validation failed: type must be 'function', got '${t.type}'`);
            return false;
        }

        if (!t.function || typeof t.function !== 'object') {
            log.error('Tool validation failed: missing or invalid function object');
            return false;
        }

        if (!t.function.name || typeof t.function.name !== 'string') {
            log.error('Tool validation failed: missing or invalid function name');
            return false;
        }

        if (!t.function.parameters || typeof t.function.parameters !== 'object') {
            log.error(`Tool validation failed for ${t.function.name}: missing or invalid parameters`);
            return false;
        }

        if (t.function.parameters.type !== 'object') {
            log.error(`Tool validation failed for ${t.function.name}: parameters.type must be 'object'`);
            return false;
        }

        // Validate required array if present
        if (t.function.parameters.required && !Array.isArray(t.function.parameters.required)) {
            log.error(`Tool validation failed for ${t.function.name}: parameters.required must be an array`);
            return false;
        }

        return true;
    }

    /**
     * Validate an Anthropic tool definition
     */
    private static validateAnthropicTool(tool: AnthropicTool): boolean {
        if (!tool.name || typeof tool.name !== 'string') {
            log.error('Anthropic tool validation failed: missing or invalid name');
            return false;
        }

        if (!tool.input_schema || typeof tool.input_schema !== 'object') {
            log.error(`Anthropic tool validation failed for ${tool.name}: missing or invalid input_schema`);
            return false;
        }

        if (tool.input_schema.type !== 'object') {
            log.error(`Anthropic tool validation failed for ${tool.name}: input_schema.type must be 'object'`);
            return false;
        }

        if (!tool.input_schema.properties || typeof tool.input_schema.properties !== 'object') {
            log.error(`Anthropic tool validation failed for ${tool.name}: missing or invalid properties`);
            return false;
        }

        // Warn if required array is missing or empty (Anthropic may send empty inputs)
        if (!tool.input_schema.required || tool.input_schema.required.length === 0) {
            log.info(`Warning: Anthropic tool ${tool.name} has no required parameters - may receive empty inputs`);
        }

        return true;
    }

    /**
     * Create a standardized error response for tool execution failures
     */
    static createToolErrorResponse(toolName: string, error: unknown): string {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return JSON.stringify({
            error: true,
            tool: toolName,
            message: `Tool execution failed: ${errorMessage}`,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Create a standardized success response for tool execution
     */
    static createToolSuccessResponse(toolName: string, result: unknown): string {
        if (typeof result === 'string') {
            return result;
        }
        return JSON.stringify({
            success: true,
            tool: toolName,
            result: result,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Parse tool arguments safely with coercion
     */
    static parseToolArguments(
        args: string | Record<string, unknown>,
        tool?: Tool,
        provider?: string
    ): Record<string, unknown> {
        let parsedArgs: Record<string, unknown>;
        
        if (typeof args === 'string') {
            try {
                parsedArgs = JSON.parse(args);
            } catch (error) {
                log.error(`Failed to parse tool arguments as JSON: ${error}`);
                return {};
            }
        } else {
            parsedArgs = args || {};
        }
        
        // Apply parameter coercion if tool definition is provided
        if (tool) {
            const coercionResult = parameterCoercer.coerceToolArguments(
                parsedArgs,
                tool,
                { provider }
            );
            
            if (coercionResult.warnings.length > 0) {
                log.info(`Parameter coercion warnings: ${coercionResult.warnings.join(', ')}`);
            }
            
            return coercionResult.value;
        }
        
        return parsedArgs;
    }

    /**
     * Detect provider type from tool format
     */
    static detectProviderFromToolFormat(tool: unknown): ProviderType {
        if (!tool || typeof tool !== 'object') {
            return 'unknown';
        }

        const t = tool as any;

        // Check for Anthropic format
        if (t.name && t.input_schema) {
            return 'anthropic';
        }

        // Check for OpenAI/standard format
        if (t.type === 'function' && t.function) {
            return 'openai';
        }

        return 'unknown';
    }
}

export default ToolFormatAdapter;