/**
 * Provider Tool Validator
 * 
 * Validates and auto-fixes tool definitions based on provider-specific requirements
 * for OpenAI, Anthropic, and Ollama.
 */

import log from '../../log.js';
import type { Tool, ToolParameter } from './tool_interfaces.js';
import type { ProviderType } from '../providers/provider_factory.js';

/**
 * Validation result for a tool
 */
export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    fixedTool?: Tool;
}

/**
 * Validation error
 */
export interface ValidationError {
    field: string;
    message: string;
    severity: 'error' | 'critical';
}

/**
 * Validation warning
 */
export interface ValidationWarning {
    field: string;
    message: string;
    suggestion?: string;
}

/**
 * Provider-specific validation rules
 */
interface ProviderRules {
    maxFunctionNameLength: number;
    maxDescriptionLength: number;
    maxParameterDepth: number;
    maxParameterCount: number;
    allowEmptyRequired: boolean;
    requireDescriptions: boolean;
    functionNamePattern: RegExp;
    supportedTypes: Set<string>;
}

/**
 * Default validation rules per provider
 */
const PROVIDER_RULES: Record<string, ProviderRules> = {
    openai: {
        maxFunctionNameLength: 64,
        maxDescriptionLength: 1024,
        maxParameterDepth: 5,
        maxParameterCount: 20,
        allowEmptyRequired: true,
        requireDescriptions: true,
        functionNamePattern: /^[a-zA-Z0-9_-]+$/,
        supportedTypes: new Set(['string', 'number', 'boolean', 'object', 'array', 'integer'])
    },
    anthropic: {
        maxFunctionNameLength: 64,
        maxDescriptionLength: 1024,
        maxParameterDepth: 4,
        maxParameterCount: 15,
        allowEmptyRequired: false, // Anthropic requires non-empty required arrays
        requireDescriptions: true,
        functionNamePattern: /^[a-zA-Z0-9_-]+$/,
        supportedTypes: new Set(['string', 'number', 'boolean', 'object', 'array', 'integer'])
    },
    ollama: {
        maxFunctionNameLength: 50,
        maxDescriptionLength: 500,
        maxParameterDepth: 3,
        maxParameterCount: 10, // Local models have smaller context
        allowEmptyRequired: true,
        requireDescriptions: false,
        functionNamePattern: /^[a-zA-Z0-9_]+$/,
        supportedTypes: new Set(['string', 'number', 'boolean', 'object', 'array'])
    }
};

/**
 * Provider tool validator class
 */
export class ProviderToolValidator {
    private providerRules: Map<string, ProviderRules>;

    constructor() {
        this.providerRules = new Map(Object.entries(PROVIDER_RULES));
    }

    /**
     * Validate a tool for a specific provider
     */
    validateTool(tool: Tool, provider: string): ValidationResult {
        const rules = this.providerRules.get(provider) || PROVIDER_RULES.openai;
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];
        
        // Deep clone the tool for potential fixes
        const fixedTool = JSON.parse(JSON.stringify(tool)) as Tool;
        let wasFixed = false;

        // Validate function name
        const nameValidation = this.validateFunctionName(
            fixedTool.function.name, 
            rules
        );
        if (nameValidation.error) {
            errors.push(nameValidation.error);
        }
        if (nameValidation.fixed) {
            fixedTool.function.name = nameValidation.fixed;
            wasFixed = true;
        }

        // Validate description
        const descValidation = this.validateDescription(
            fixedTool.function.description,
            rules
        );
        if (descValidation.error) {
            errors.push(descValidation.error);
        }
        if (descValidation.warning) {
            warnings.push(descValidation.warning);
        }
        if (descValidation.fixed) {
            fixedTool.function.description = descValidation.fixed;
            wasFixed = true;
        }

        // Validate parameters
        const paramValidation = this.validateParameters(
            fixedTool.function.parameters,
            rules,
            provider
        );
        errors.push(...paramValidation.errors);
        warnings.push(...paramValidation.warnings);
        if (paramValidation.fixed) {
            fixedTool.function.parameters = paramValidation.fixed;
            wasFixed = true;
        }

        // Provider-specific validations
        const providerSpecific = this.validateProviderSpecific(fixedTool, provider);
        errors.push(...providerSpecific.errors);
        warnings.push(...providerSpecific.warnings);
        if (providerSpecific.fixed) {
            Object.assign(fixedTool, providerSpecific.fixed);
            wasFixed = true;
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            fixedTool: wasFixed ? fixedTool : undefined
        };
    }

    /**
     * Validate function name
     */
    private validateFunctionName(name: string, rules: ProviderRules) {
        const result: any = {};

        // Check length
        if (name.length > rules.maxFunctionNameLength) {
            result.error = {
                field: 'function.name',
                message: `Function name exceeds maximum length of ${rules.maxFunctionNameLength}`,
                severity: 'error' as const
            };
            // Auto-fix: truncate
            result.fixed = name.substring(0, rules.maxFunctionNameLength);
        }

        // Check pattern
        if (!rules.functionNamePattern.test(name)) {
            result.error = {
                field: 'function.name',
                message: `Function name contains invalid characters`,
                severity: 'error' as const
            };
            // Auto-fix: replace invalid characters
            result.fixed = name.replace(/[^a-zA-Z0-9_-]/g, '_');
        }

        return result;
    }

    /**
     * Validate description
     */
    private validateDescription(description: string, rules: ProviderRules) {
        const result: any = {};

        // Check if description exists when required
        if (rules.requireDescriptions && !description) {
            result.error = {
                field: 'function.description',
                message: 'Description is required',
                severity: 'error' as const
            };
            result.fixed = 'Performs an operation'; // Generic fallback
        }

        // Check length
        if (description && description.length > rules.maxDescriptionLength) {
            result.warning = {
                field: 'function.description',
                message: `Description exceeds recommended length of ${rules.maxDescriptionLength}`,
                suggestion: 'Consider shortening the description'
            };
            // Auto-fix: truncate with ellipsis
            result.fixed = description.substring(0, rules.maxDescriptionLength - 3) + '...';
        }

        return result;
    }

    /**
     * Validate parameters
     */
    private validateParameters(
        parameters: any,
        rules: ProviderRules,
        provider: string
    ) {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];
        let fixed: any = null;

        // Ensure parameters is an object
        if (parameters.type !== 'object') {
            errors.push({
                field: 'function.parameters.type',
                message: 'Parameters must be of type "object"',
                severity: 'critical'
            });
            fixed = {
                type: 'object',
                properties: parameters.properties || {},
                required: parameters.required || []
            };
        }

        // Check parameter count
        const paramCount = Object.keys(parameters.properties || {}).length;
        if (paramCount > rules.maxParameterCount) {
            warnings.push({
                field: 'function.parameters',
                message: `Parameter count (${paramCount}) exceeds recommended maximum (${rules.maxParameterCount})`,
                suggestion: 'Consider reducing the number of parameters'
            });
        }

        // Validate required array for Anthropic
        if (!rules.allowEmptyRequired && (!parameters.required || parameters.required.length === 0)) {
            if (provider === 'anthropic') {
                // For Anthropic, add at least one optional parameter to required
                const props = Object.keys(parameters.properties || {});
                if (props.length > 0) {
                    if (!fixed) fixed = { ...parameters };
                    fixed.required = [props[0]]; // Add first property as required
                    warnings.push({
                        field: 'function.parameters.required',
                        message: 'Anthropic requires non-empty required array, added first parameter',
                        suggestion: 'Specify which parameters are required'
                    });
                }
            }
        }

        // Validate parameter types and depth
        if (parameters.properties) {
            const typeErrors = this.validateParameterTypes(
                parameters.properties,
                rules.supportedTypes,
                0,
                rules.maxParameterDepth
            );
            errors.push(...typeErrors);
        }

        return { errors, warnings, fixed };
    }

    /**
     * Validate parameter types recursively
     */
    private validateParameterTypes(
        properties: Record<string, ToolParameter>,
        supportedTypes: Set<string>,
        depth: number,
        maxDepth: number
    ): ValidationError[] {
        const errors: ValidationError[] = [];

        if (depth > maxDepth) {
            errors.push({
                field: 'function.parameters',
                message: `Parameter nesting exceeds maximum depth of ${maxDepth}`,
                severity: 'error'
            });
            return errors;
        }

        for (const [key, param] of Object.entries(properties)) {
            // Check if type is supported
            if (param.type && !supportedTypes.has(param.type)) {
                errors.push({
                    field: `function.parameters.properties.${key}.type`,
                    message: `Unsupported type: ${param.type}`,
                    severity: 'error'
                });
            }

            // Recursively check nested objects
            if (param.type === 'object' && param.properties) {
                const nestedErrors = this.validateParameterTypes(
                    param.properties,
                    supportedTypes,
                    depth + 1,
                    maxDepth
                );
                errors.push(...nestedErrors);
            }

            // Check array items
            if (param.type === 'array' && param.items) {
                if (typeof param.items === 'object' && 'properties' in param.items) {
                    const nestedErrors = this.validateParameterTypes(
                        param.items.properties!,
                        supportedTypes,
                        depth + 1,
                        maxDepth
                    );
                    errors.push(...nestedErrors);
                }
            }
        }

        return errors;
    }

    /**
     * Provider-specific validations
     */
    private validateProviderSpecific(tool: Tool, provider: string) {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];
        let fixed: any = null;

        switch (provider) {
            case 'openai':
                // OpenAI-specific: Check for special characters in function names
                if (tool.function.name.includes('-')) {
                    warnings.push({
                        field: 'function.name',
                        message: 'OpenAI prefers underscores over hyphens in function names',
                        suggestion: 'Replace hyphens with underscores'
                    });
                }
                break;

            case 'anthropic':
                // Anthropic-specific: Ensure descriptions are meaningful
                if (tool.function.description && tool.function.description.length < 10) {
                    warnings.push({
                        field: 'function.description',
                        message: 'Description is very short',
                        suggestion: 'Provide a more detailed description for better results'
                    });
                }
                break;

            case 'ollama':
                // Ollama-specific: Warn about complex nested structures
                const complexity = this.calculateComplexity(tool.function.parameters);
                if (complexity > 10) {
                    warnings.push({
                        field: 'function.parameters',
                        message: 'Tool parameters are complex for local models',
                        suggestion: 'Consider simplifying the parameter structure'
                    });
                }
                break;
        }

        return { errors, warnings, fixed };
    }

    /**
     * Calculate parameter complexity score
     */
    private calculateComplexity(parameters: any, depth: number = 0): number {
        let complexity = depth;

        if (parameters.properties) {
            for (const param of Object.values(parameters.properties) as ToolParameter[]) {
                complexity += 1;
                if (param.type === 'object' && param.properties) {
                    complexity += this.calculateComplexity(param, depth + 1);
                }
                if (param.type === 'array' && param.items) {
                    complexity += 2; // Arrays add more complexity
                }
            }
        }

        return complexity;
    }

    /**
     * Batch validate multiple tools
     */
    validateTools(tools: Tool[], provider: string): Map<string, ValidationResult> {
        const results = new Map<string, ValidationResult>();

        for (const tool of tools) {
            const result = this.validateTool(tool, provider);
            results.set(tool.function.name, result);

            if (!result.valid) {
                log.info(`Tool '${tool.function.name}' validation failed for ${provider}: ${JSON.stringify(result.errors)}`);
            }
            if (result.warnings.length > 0) {
                log.info(`Tool '${tool.function.name}' validation warnings for ${provider}: ${JSON.stringify(result.warnings)}`);
            }
        }

        return results;
    }

    /**
     * Auto-fix tools for a provider
     */
    autoFixTools(tools: Tool[], provider: string): Tool[] {
        const fixed: Tool[] = [];

        for (const tool of tools) {
            const result = this.validateTool(tool, provider);
            fixed.push(result.fixedTool || tool);
        }

        return fixed;
    }

    /**
     * Check if a provider supports a tool
     */
    isToolSupportedByProvider(tool: Tool, provider: string): boolean {
        const result = this.validateTool(tool, provider);
        return result.valid || (result.fixedTool !== undefined);
    }
}

// Export singleton instance
export const providerToolValidator = new ProviderToolValidator();