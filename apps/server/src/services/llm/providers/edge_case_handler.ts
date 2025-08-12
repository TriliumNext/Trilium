/**
 * Provider Edge Case Handler
 * 
 * Handles provider-specific edge cases and quirks for OpenAI, Anthropic, and Ollama,
 * including special character fixes, object flattening, and context limit handling.
 */

import log from '../../log.js';
import type { Tool, ToolParameter } from '../tools/tool_interfaces.js';

/**
 * Edge case fix result
 */
export interface EdgeCaseFixResult {
    fixed: boolean;
    tool?: Tool;
    warnings: string[];
    modifications: string[];
}

/**
 * Provider-specific configuration
 */
interface ProviderConfig {
    maxFunctionNameLength: number;
    maxDescriptionLength: number;
    maxDepth: number;
    maxProperties: number;
    allowSpecialChars: boolean;
    requireArrays: boolean;
    supportsComplexTypes: boolean;
}

/**
 * Provider configurations
 */
const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
    openai: {
        maxFunctionNameLength: 64,
        maxDescriptionLength: 1024,
        maxDepth: 5,
        maxProperties: 50,
        allowSpecialChars: false,
        requireArrays: false,
        supportsComplexTypes: true
    },
    anthropic: {
        maxFunctionNameLength: 64,
        maxDescriptionLength: 1024,
        maxDepth: 4,
        maxProperties: 30,
        allowSpecialChars: true,
        requireArrays: true,
        supportsComplexTypes: true
    },
    ollama: {
        maxFunctionNameLength: 50,
        maxDescriptionLength: 500,
        maxDepth: 3,
        maxProperties: 20,
        allowSpecialChars: false,
        requireArrays: false,
        supportsComplexTypes: false
    }
};

/**
 * Edge case handler class
 */
export class EdgeCaseHandler {
    /**
     * Fix tool for provider-specific edge cases
     */
    fixToolForProvider(tool: Tool, provider: string): EdgeCaseFixResult {
        const config = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.openai;
        const warnings: string[] = [];
        const modifications: string[] = [];
        
        // Deep clone the tool
        let fixedTool = JSON.parse(JSON.stringify(tool)) as Tool;
        let wasFixed = false;
        
        // Apply provider-specific fixes
        switch (provider) {
            case 'openai':
                const openaiResult = this.fixOpenAIEdgeCases(fixedTool, config);
                fixedTool = openaiResult.tool;
                warnings.push(...openaiResult.warnings);
                modifications.push(...openaiResult.modifications);
                wasFixed = openaiResult.fixed;
                break;
                
            case 'anthropic':
                const anthropicResult = this.fixAnthropicEdgeCases(fixedTool, config);
                fixedTool = anthropicResult.tool;
                warnings.push(...anthropicResult.warnings);
                modifications.push(...anthropicResult.modifications);
                wasFixed = anthropicResult.fixed;
                break;
                
            case 'ollama':
                const ollamaResult = this.fixOllamaEdgeCases(fixedTool, config);
                fixedTool = ollamaResult.tool;
                warnings.push(...ollamaResult.warnings);
                modifications.push(...ollamaResult.modifications);
                wasFixed = ollamaResult.fixed;
                break;
                
            default:
                // Apply generic fixes
                const genericResult = this.applyGenericFixes(fixedTool, config);
                fixedTool = genericResult.tool;
                warnings.push(...genericResult.warnings);
                modifications.push(...genericResult.modifications);
                wasFixed = genericResult.fixed;
        }
        
        return {
            fixed: wasFixed,
            tool: wasFixed ? fixedTool : undefined,
            warnings,
            modifications
        };
    }

    /**
     * Fix OpenAI-specific edge cases
     */
    private fixOpenAIEdgeCases(
        tool: Tool,
        config: ProviderConfig
    ): { tool: Tool; fixed: boolean; warnings: string[]; modifications: string[] } {
        const warnings: string[] = [];
        const modifications: string[] = [];
        let fixed = false;
        
        // Fix special characters in function name
        if (!config.allowSpecialChars && /[^a-zA-Z0-9_]/.test(tool.function.name)) {
            const oldName = tool.function.name;
            tool.function.name = tool.function.name.replace(/[^a-zA-Z0-9_]/g, '_');
            modifications.push(`Replaced special characters in function name: ${oldName} → ${tool.function.name}`);
            fixed = true;
        }
        
        // Fix hyphens (OpenAI prefers underscores)
        if (tool.function.name.includes('-')) {
            const oldName = tool.function.name;
            tool.function.name = tool.function.name.replace(/-/g, '_');
            modifications.push(`Replaced hyphens with underscores: ${oldName} → ${tool.function.name}`);
            fixed = true;
        }
        
        // Flatten deep objects if necessary
        if (tool.function.parameters.properties) {
            const flattenResult = this.flattenDeepObjects(
                tool.function.parameters.properties,
                config.maxDepth
            );
            if (flattenResult.flattened) {
                tool.function.parameters.properties = flattenResult.properties;
                modifications.push('Flattened deep nested objects');
                warnings.push('Some nested properties were flattened for OpenAI compatibility');
                fixed = true;
            }
        }
        
        // Handle overly complex parameter structures
        const paramCount = Object.keys(tool.function.parameters.properties || {}).length;
        if (paramCount > config.maxProperties) {
            warnings.push(`Tool has ${paramCount} properties, exceeding OpenAI recommended limit of ${config.maxProperties}`);
            
            // Group related parameters if possible
            const grouped = this.groupRelatedParameters(tool.function.parameters.properties);
            if (grouped.grouped) {
                tool.function.parameters.properties = grouped.properties;
                modifications.push('Grouped related parameters to reduce complexity');
                fixed = true;
            }
        }
        
        // Fix enum values with special characters
        this.fixEnumValues(tool.function.parameters.properties);
        
        return { tool, fixed, warnings, modifications };
    }

    /**
     * Fix Anthropic-specific edge cases
     */
    private fixAnthropicEdgeCases(
        tool: Tool,
        config: ProviderConfig
    ): { tool: Tool; fixed: boolean; warnings: string[]; modifications: string[] } {
        const warnings: string[] = [];
        const modifications: string[] = [];
        let fixed = false;
        
        // Ensure required array is not empty
        if (!tool.function.parameters.required || tool.function.parameters.required.length === 0) {
            const properties = Object.keys(tool.function.parameters.properties || {});
            if (properties.length > 0) {
                // Add at least one property to required
                tool.function.parameters.required = [properties[0]];
                modifications.push(`Added '${properties[0]}' to required array for Anthropic compatibility`);
                fixed = true;
            } else {
                // Add a dummy optional parameter if no properties exist
                tool.function.parameters.properties = {
                    _placeholder: {
                        type: 'string',
                        description: 'Optional placeholder parameter',
                        default: ''
                    }
                };
                tool.function.parameters.required = [];
                modifications.push('Added placeholder parameter for Anthropic compatibility');
                fixed = true;
            }
        }
        
        // Truncate overly long descriptions
        if (tool.function.description.length > config.maxDescriptionLength) {
            tool.function.description = tool.function.description.substring(0, config.maxDescriptionLength - 3) + '...';
            modifications.push('Truncated description to meet Anthropic length limits');
            fixed = true;
        }
        
        // Ensure all parameters have descriptions
        for (const [key, param] of Object.entries(tool.function.parameters.properties || {})) {
            if (!param.description) {
                param.description = `Parameter ${key}`;
                modifications.push(`Added missing description for parameter '${key}'`);
                fixed = true;
            }
        }
        
        // Handle complex nested structures
        const complexity = this.calculateComplexity(tool.function.parameters);
        if (complexity > 15) {
            warnings.push('Tool parameters are very complex for Anthropic, consider simplifying');
        }
        
        return { tool, fixed, warnings, modifications };
    }

    /**
     * Fix Ollama-specific edge cases
     */
    private fixOllamaEdgeCases(
        tool: Tool,
        config: ProviderConfig
    ): { tool: Tool; fixed: boolean; warnings: string[]; modifications: string[] } {
        const warnings: string[] = [];
        const modifications: string[] = [];
        let fixed = false;
        
        // Limit parameter count for local models
        const properties = tool.function.parameters.properties || {};
        const paramCount = Object.keys(properties).length;
        
        if (paramCount > config.maxProperties) {
            // Keep only the most important parameters
            const required = tool.function.parameters.required || [];
            const important = new Set(required);
            const kept: Record<string, ToolParameter> = {};
            
            // Keep required parameters first
            for (const key of required) {
                if (properties[key]) {
                    kept[key] = properties[key];
                }
            }
            
            // Add optional parameters up to limit
            for (const [key, param] of Object.entries(properties)) {
                if (!important.has(key) && Object.keys(kept).length < config.maxProperties) {
                    kept[key] = param;
                }
            }
            
            tool.function.parameters.properties = kept;
            modifications.push(`Reduced parameters from ${paramCount} to ${Object.keys(kept).length} for Ollama`);
            warnings.push('Some optional parameters were removed for local model compatibility');
            fixed = true;
        }
        
        // Simplify complex types
        if (!config.supportsComplexTypes) {
            const simplified = this.simplifyComplexTypes(tool.function.parameters.properties);
            if (simplified.simplified) {
                tool.function.parameters.properties = simplified.properties;
                modifications.push('Simplified complex types for local model compatibility');
                fixed = true;
            }
        }
        
        // Shorten descriptions for context limits
        for (const [key, param] of Object.entries(tool.function.parameters.properties || {})) {
            if (param.description && param.description.length > 100) {
                param.description = param.description.substring(0, 97) + '...';
                modifications.push(`Shortened description for parameter '${key}'`);
                fixed = true;
            }
        }
        
        // Remove deeply nested structures
        if (config.maxDepth < 4) {
            const flattened = this.flattenDeepObjects(
                tool.function.parameters.properties,
                config.maxDepth
            );
            if (flattened.flattened) {
                tool.function.parameters.properties = flattened.properties;
                modifications.push('Flattened nested structures for local model');
                warnings.push('Nested objects were flattened for better local model performance');
                fixed = true;
            }
        }
        
        return { tool, fixed, warnings, modifications };
    }

    /**
     * Apply generic fixes for any provider
     */
    private applyGenericFixes(
        tool: Tool,
        config: ProviderConfig
    ): { tool: Tool; fixed: boolean; warnings: string[]; modifications: string[] } {
        const warnings: string[] = [];
        const modifications: string[] = [];
        let fixed = false;
        
        // Ensure function name length
        if (tool.function.name.length > config.maxFunctionNameLength) {
            tool.function.name = tool.function.name.substring(0, config.maxFunctionNameLength);
            modifications.push('Truncated function name to meet length limits');
            fixed = true;
        }
        
        // Ensure description exists
        if (!tool.function.description) {
            tool.function.description = `Execute ${tool.function.name}`;
            modifications.push('Added missing function description');
            fixed = true;
        }
        
        // Ensure parameters object structure
        if (!tool.function.parameters.type) {
            tool.function.parameters.type = 'object';
            modifications.push('Added missing parameters type');
            fixed = true;
        }
        
        if (!tool.function.parameters.properties) {
            tool.function.parameters.properties = {};
            modifications.push('Added missing parameters properties');
            fixed = true;
        }
        
        return { tool, fixed, warnings, modifications };
    }

    /**
     * Flatten deep objects
     */
    private flattenDeepObjects(
        properties: Record<string, ToolParameter>,
        maxDepth: number,
        currentDepth: number = 0
    ): { properties: Record<string, ToolParameter>; flattened: boolean } {
        let flattened = false;
        const result: Record<string, ToolParameter> = {};
        
        for (const [key, param] of Object.entries(properties)) {
            if (param.type === 'object' && param.properties && currentDepth >= maxDepth - 1) {
                // Flatten this object
                const prefix = key + '_';
                for (const [subKey, subParam] of Object.entries(param.properties)) {
                    result[prefix + subKey] = subParam;
                }
                flattened = true;
            } else if (param.type === 'object' && param.properties) {
                // Recurse deeper
                const subResult = this.flattenDeepObjects(
                    param.properties,
                    maxDepth,
                    currentDepth + 1
                );
                result[key] = {
                    ...param,
                    properties: subResult.properties
                };
                flattened = flattened || subResult.flattened;
            } else {
                result[key] = param;
            }
        }
        
        return { properties: result, flattened };
    }

    /**
     * Group related parameters
     */
    private groupRelatedParameters(
        properties: Record<string, ToolParameter>
    ): { properties: Record<string, ToolParameter>; grouped: boolean } {
        const groups = new Map<string, Record<string, ToolParameter>>();
        const ungrouped: Record<string, ToolParameter> = {};
        let grouped = false;
        
        // Identify common prefixes
        for (const [key, param] of Object.entries(properties)) {
            const prefix = key.split('_')[0];
            if (prefix && prefix.length > 2) {
                if (!groups.has(prefix)) {
                    groups.set(prefix, {});
                }
                groups.get(prefix)![key] = param;
            } else {
                ungrouped[key] = param;
            }
        }
        
        // Create grouped structure if beneficial
        const result: Record<string, ToolParameter> = {};
        
        for (const [prefix, groupProps] of groups) {
            if (Object.keys(groupProps).length > 2) {
                // Group these properties
                result[prefix] = {
                    type: 'object',
                    description: `${prefix} properties`,
                    properties: groupProps
                };
                grouped = true;
            } else {
                // Keep ungrouped
                Object.assign(result, groupProps);
            }
        }
        
        // Add ungrouped properties
        Object.assign(result, ungrouped);
        
        return { properties: result, grouped };
    }

    /**
     * Simplify complex types for local models
     */
    private simplifyComplexTypes(
        properties: Record<string, ToolParameter>
    ): { properties: Record<string, ToolParameter>; simplified: boolean } {
        let simplified = false;
        const result: Record<string, ToolParameter> = {};
        
        for (const [key, param] of Object.entries(properties)) {
            if (param.type === 'array' && param.items && typeof param.items === 'object' && 'properties' in param.items) {
                // Complex array of objects - simplify to array of strings
                result[key] = {
                    type: 'array',
                    description: param.description || `List of ${key}`,
                    items: { type: 'string' }
                };
                simplified = true;
            } else if (param.type === 'object' && param.properties) {
                // Nested object - check if can be simplified
                const propCount = Object.keys(param.properties).length;
                if (propCount > 5) {
                    // Too complex - convert to string
                    result[key] = {
                        type: 'string',
                        description: param.description || `JSON string for ${key}`
                    };
                    simplified = true;
                } else {
                    result[key] = param;
                }
            } else {
                result[key] = param;
            }
        }
        
        return { properties: result, simplified };
    }

    /**
     * Fix enum values
     */
    private fixEnumValues(properties: Record<string, ToolParameter>): void {
        for (const param of Object.values(properties)) {
            if (param.enum) {
                // Ensure all enum values are strings
                param.enum = param.enum.map(v => String(v));
                
                // Remove any special characters
                param.enum = param.enum.map(v => v.replace(/[^\w\s-]/g, '_'));
            }
            
            // Recurse for nested properties
            if (param.properties) {
                this.fixEnumValues(param.properties);
            }
        }
    }

    /**
     * Calculate parameter complexity
     */
    private calculateComplexity(parameters: any, depth: number = 0): number {
        let complexity = depth;
        
        if (parameters.properties) {
            for (const param of Object.values(parameters.properties) as ToolParameter[]) {
                complexity += 1;
                
                if (param.type === 'object' && param.properties) {
                    complexity += this.calculateComplexity(param, depth + 1);
                }
                
                if (param.type === 'array') {
                    complexity += 2; // Arrays add more complexity
                    if (param.items && typeof param.items === 'object' && 'properties' in param.items) {
                        complexity += 3; // Array of objects is very complex
                    }
                }
            }
        }
        
        return complexity;
    }

    /**
     * Batch fix tools for a provider
     */
    fixToolsForProvider(tools: Tool[], provider: string): Tool[] {
        const fixed: Tool[] = [];
        
        for (const tool of tools) {
            const result = this.fixToolForProvider(tool, provider);
            
            if (result.fixed && result.tool) {
                fixed.push(result.tool);
                
                if (result.warnings.length > 0) {
                    log.info(`Warnings for ${tool.function.name}: ${JSON.stringify(result.warnings)}`);
                }
                if (result.modifications.length > 0) {
                    log.info(`Modifications for ${tool.function.name}: ${JSON.stringify(result.modifications)}`);
                }
            } else {
                fixed.push(tool);
            }
        }
        
        return fixed;
    }
}

// Export singleton instance
export const edgeCaseHandler = new EdgeCaseHandler();