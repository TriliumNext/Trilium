/**
 * Parameter Type Coercer
 * 
 * Provides automatic type conversion, array normalization, default value injection,
 * and schema validation with fixes for tool parameters.
 */

import log from '../../log.js';
import type { Tool, ToolParameter } from './tool_interfaces.js';

/**
 * Coercion result
 */
export interface CoercionResult {
    success: boolean;
    value: any;
    wasCoerced: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Coercion options
 */
export interface CoercionOptions {
    /** Strict mode - fail on any coercion error */
    strict: boolean;
    /** Apply default values */
    applyDefaults: boolean;
    /** Normalize arrays (single values to arrays) */
    normalizeArrays: boolean;
    /** Trim string values */
    trimStrings: boolean;
    /** Convert number strings to numbers */
    parseNumbers: boolean;
    /** Convert boolean strings to booleans */
    parseBooleans: boolean;
    /** Provider-specific quirks */
    provider?: string;
}

/**
 * Default coercion options
 */
const DEFAULT_OPTIONS: CoercionOptions = {
    strict: false,
    applyDefaults: true,
    normalizeArrays: true,
    trimStrings: true,
    parseNumbers: true,
    parseBooleans: true
};

/**
 * Provider-specific quirks
 */
const PROVIDER_QUIRKS = {
    openai: {
        // OpenAI sometimes sends stringified JSON for complex objects
        parseJsonStrings: true,
        // OpenAI may send null for optional parameters
        treatNullAsUndefined: true
    },
    anthropic: {
        // Anthropic strictly validates types
        strictTypeChecking: true,
        // Anthropic requires arrays to be actual arrays
        requireArrayTypes: true
    },
    ollama: {
        // Local models may have looser type handling
        lenientParsing: true,
        // May send numbers as strings more often
        aggressiveNumberParsing: true
    }
};

/**
 * Parameter coercer class
 */
export class ParameterCoercer {
    private options: CoercionOptions;

    constructor(options?: Partial<CoercionOptions>) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    /**
     * Coerce tool call arguments to match tool definition
     */
    coerceToolArguments(
        args: Record<string, unknown>,
        tool: Tool,
        options?: Partial<CoercionOptions>
    ): CoercionResult {
        const opts = { ...this.options, ...options };
        const errors: string[] = [];
        const warnings: string[] = [];
        let wasCoerced = false;
        
        const parameters = tool.function.parameters;
        const coercedArgs: Record<string, any> = {};
        
        // Process each parameter
        for (const [paramName, paramDef] of Object.entries(parameters.properties)) {
            const rawValue = args[paramName];
            const isRequired = parameters.required?.includes(paramName);
            
            // Handle missing values
            if (rawValue === undefined || rawValue === null) {
                if (opts.provider === 'openai' && rawValue === null) {
                    // OpenAI quirk: treat null as undefined
                    if (isRequired && !paramDef.default) {
                        errors.push(`Required parameter '${paramName}' is null`);
                        continue;
                    }
                }
                
                if (opts.applyDefaults && paramDef.default !== undefined) {
                    coercedArgs[paramName] = paramDef.default;
                    wasCoerced = true;
                    warnings.push(`Applied default value for '${paramName}'`);
                } else if (isRequired) {
                    errors.push(`Required parameter '${paramName}' is missing`);
                }
                continue;
            }
            
            // Coerce the value
            const coerced = this.coerceValue(
                rawValue,
                paramDef,
                paramName,
                opts
            );
            
            if (coerced.success) {
                coercedArgs[paramName] = coerced.value;
                if (coerced.wasCoerced) {
                    wasCoerced = true;
                    warnings.push(...coerced.warnings);
                }
            } else {
                errors.push(...coerced.errors);
                if (!opts.strict) {
                    // In non-strict mode, use original value
                    coercedArgs[paramName] = rawValue;
                    warnings.push(`Failed to coerce '${paramName}', using original value`);
                }
            }
        }
        
        // Check for unknown parameters
        for (const paramName of Object.keys(args)) {
            if (!(paramName in parameters.properties)) {
                warnings.push(`Unknown parameter '${paramName}' will be ignored`);
            }
        }
        
        return {
            success: errors.length === 0,
            value: coercedArgs,
            wasCoerced,
            errors,
            warnings
        };
    }

    /**
     * Coerce a single value to match its type definition
     */
    private coerceValue(
        value: unknown,
        definition: ToolParameter,
        path: string,
        options: CoercionOptions
    ): CoercionResult {
        const errors: string[] = [];
        const warnings: string[] = [];
        let wasCoerced = false;
        let coercedValue = value;
        
        // Handle provider-specific JSON string parsing
        if (options.provider === 'openai' && 
            typeof value === 'string' && 
            (definition.type === 'object' || definition.type === 'array')) {
            try {
                coercedValue = JSON.parse(value);
                wasCoerced = true;
                warnings.push(`Parsed JSON string for '${path}'`);
            } catch {
                // Not valid JSON, continue with string value
            }
        }
        
        // Type-specific coercion
        switch (definition.type) {
            case 'string':
                const stringResult = this.coerceToString(coercedValue, path, options);
                coercedValue = stringResult.value;
                wasCoerced = wasCoerced || stringResult.wasCoerced;
                warnings.push(...stringResult.warnings);
                break;
                
            case 'number':
            case 'integer':
                const numberResult = this.coerceToNumber(
                    coercedValue, 
                    path, 
                    definition,
                    definition.type === 'integer',
                    options
                );
                if (numberResult.success) {
                    coercedValue = numberResult.value;
                    wasCoerced = wasCoerced || numberResult.wasCoerced;
                    warnings.push(...numberResult.warnings);
                } else {
                    errors.push(...numberResult.errors);
                }
                break;
                
            case 'boolean':
                const boolResult = this.coerceToBoolean(coercedValue, path, options);
                if (boolResult.success) {
                    coercedValue = boolResult.value;
                    wasCoerced = wasCoerced || boolResult.wasCoerced;
                    warnings.push(...boolResult.warnings);
                } else {
                    errors.push(...boolResult.errors);
                }
                break;
                
            case 'array':
                const arrayResult = this.coerceToArray(
                    coercedValue,
                    path,
                    definition,
                    options
                );
                if (arrayResult.success) {
                    coercedValue = arrayResult.value;
                    wasCoerced = wasCoerced || arrayResult.wasCoerced;
                    warnings.push(...arrayResult.warnings);
                } else {
                    errors.push(...arrayResult.errors);
                }
                break;
                
            case 'object':
                const objectResult = this.coerceToObject(
                    coercedValue,
                    path,
                    definition,
                    options
                );
                if (objectResult.success) {
                    coercedValue = objectResult.value;
                    wasCoerced = wasCoerced || objectResult.wasCoerced;
                    warnings.push(...objectResult.warnings);
                } else {
                    errors.push(...objectResult.errors);
                }
                break;
                
            default:
                warnings.push(`Unknown type '${definition.type}' for '${path}'`);
        }
        
        // Validate enum values
        if (definition.enum && !definition.enum.includes(String(coercedValue))) {
            errors.push(`Value for '${path}' must be one of: ${definition.enum.join(', ')}`);
        }
        
        return {
            success: errors.length === 0,
            value: coercedValue,
            wasCoerced,
            errors,
            warnings
        };
    }

    /**
     * Coerce to string
     */
    private coerceToString(
        value: unknown,
        path: string,
        options: CoercionOptions
    ): CoercionResult {
        const warnings: string[] = [];
        let wasCoerced = false;
        let result: string;
        
        if (typeof value === 'string') {
            result = options.trimStrings ? value.trim() : value;
            if (result !== value) {
                wasCoerced = true;
                warnings.push(`Trimmed whitespace from '${path}'`);
            }
        } else if (value === null || value === undefined) {
            result = '';
            wasCoerced = true;
            warnings.push(`Converted null/undefined to empty string for '${path}'`);
        } else {
            result = String(value);
            wasCoerced = true;
            warnings.push(`Converted ${typeof value} to string for '${path}'`);
        }
        
        return {
            success: true,
            value: result,
            wasCoerced,
            errors: [],
            warnings
        };
    }

    /**
     * Coerce to number
     */
    private coerceToNumber(
        value: unknown,
        path: string,
        definition: ToolParameter,
        isInteger: boolean,
        options: CoercionOptions
    ): CoercionResult {
        const errors: string[] = [];
        const warnings: string[] = [];
        let wasCoerced = false;
        let result: number;
        
        if (typeof value === 'number') {
            result = isInteger ? Math.round(value) : value;
            if (result !== value) {
                wasCoerced = true;
                warnings.push(`Rounded to integer for '${path}'`);
            }
        } else if (typeof value === 'string' && options.parseNumbers) {
            const parsed = isInteger ? parseInt(value, 10) : parseFloat(value);
            if (!isNaN(parsed)) {
                result = parsed;
                wasCoerced = true;
                warnings.push(`Parsed string to number for '${path}'`);
            } else {
                errors.push(`Cannot parse '${value}' as number for '${path}'`);
                return { success: false, value, wasCoerced: false, errors, warnings };
            }
        } else if (typeof value === 'boolean') {
            result = value ? 1 : 0;
            wasCoerced = true;
            warnings.push(`Converted boolean to number for '${path}'`);
        } else {
            errors.push(`Cannot coerce ${typeof value} to number for '${path}'`);
            return { success: false, value, wasCoerced: false, errors, warnings };
        }
        
        // Validate constraints
        if (definition.minimum !== undefined && result < definition.minimum) {
            result = definition.minimum;
            wasCoerced = true;
            warnings.push(`Clamped to minimum value ${definition.minimum} for '${path}'`);
        }
        if (definition.maximum !== undefined && result > definition.maximum) {
            result = definition.maximum;
            wasCoerced = true;
            warnings.push(`Clamped to maximum value ${definition.maximum} for '${path}'`);
        }
        
        return {
            success: true,
            value: result,
            wasCoerced,
            errors,
            warnings
        };
    }

    /**
     * Coerce to boolean
     */
    private coerceToBoolean(
        value: unknown,
        path: string,
        options: CoercionOptions
    ): CoercionResult {
        const warnings: string[] = [];
        let wasCoerced = false;
        let result: boolean;
        
        if (typeof value === 'boolean') {
            result = value;
        } else if (typeof value === 'string' && options.parseBooleans) {
            const lower = value.toLowerCase().trim();
            if (lower === 'true' || lower === 'yes' || lower === '1') {
                result = true;
                wasCoerced = true;
                warnings.push(`Parsed string to boolean true for '${path}'`);
            } else if (lower === 'false' || lower === 'no' || lower === '0') {
                result = false;
                wasCoerced = true;
                warnings.push(`Parsed string to boolean false for '${path}'`);
            } else {
                return {
                    success: false,
                    value,
                    wasCoerced: false,
                    errors: [`Cannot parse '${value}' as boolean for '${path}'`],
                    warnings
                };
            }
        } else if (typeof value === 'number') {
            result = value !== 0;
            wasCoerced = true;
            warnings.push(`Converted number to boolean for '${path}'`);
        } else {
            result = Boolean(value);
            wasCoerced = true;
            warnings.push(`Coerced ${typeof value} to boolean for '${path}'`);
        }
        
        return {
            success: true,
            value: result,
            wasCoerced,
            errors: [],
            warnings
        };
    }

    /**
     * Coerce to array
     */
    private coerceToArray(
        value: unknown,
        path: string,
        definition: ToolParameter,
        options: CoercionOptions
    ): CoercionResult {
        const errors: string[] = [];
        const warnings: string[] = [];
        let wasCoerced = false;
        let result: any[];
        
        if (Array.isArray(value)) {
            result = value;
        } else if (options.normalizeArrays) {
            // Convert single value to array
            result = [value];
            wasCoerced = true;
            warnings.push(`Normalized single value to array for '${path}'`);
        } else {
            errors.push(`Expected array for '${path}', got ${typeof value}`);
            return { success: false, value, wasCoerced: false, errors, warnings };
        }
        
        // Validate array constraints
        if (definition.minItems !== undefined && result.length < definition.minItems) {
            errors.push(`Array '${path}' must have at least ${definition.minItems} items`);
        }
        if (definition.maxItems !== undefined && result.length > definition.maxItems) {
            result = result.slice(0, definition.maxItems);
            wasCoerced = true;
            warnings.push(`Truncated array to ${definition.maxItems} items for '${path}'`);
        }
        
        // Coerce array items if type is specified
        if (definition.items) {
            const coercedItems: any[] = [];
            for (let i = 0; i < result.length; i++) {
                const itemResult = this.coerceValue(
                    result[i],
                    definition.items as ToolParameter,
                    `${path}[${i}]`,
                    options
                );
                if (itemResult.success) {
                    coercedItems.push(itemResult.value);
                    if (itemResult.wasCoerced) wasCoerced = true;
                    warnings.push(...itemResult.warnings);
                } else {
                    errors.push(...itemResult.errors);
                    coercedItems.push(result[i]); // Keep original on error
                }
            }
            result = coercedItems;
        }
        
        return {
            success: errors.length === 0,
            value: result,
            wasCoerced,
            errors,
            warnings
        };
    }

    /**
     * Coerce to object
     */
    private coerceToObject(
        value: unknown,
        path: string,
        definition: ToolParameter,
        options: CoercionOptions
    ): CoercionResult {
        const errors: string[] = [];
        const warnings: string[] = [];
        let wasCoerced = false;
        let result: Record<string, any>;
        
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            result = value as Record<string, any>;
        } else if (typeof value === 'string') {
            // Try to parse as JSON
            try {
                result = JSON.parse(value);
                wasCoerced = true;
                warnings.push(`Parsed JSON string for object '${path}'`);
            } catch {
                errors.push(`Cannot parse string as object for '${path}'`);
                return { success: false, value, wasCoerced: false, errors, warnings };
            }
        } else {
            errors.push(`Expected object for '${path}', got ${typeof value}`);
            return { success: false, value, wasCoerced: false, errors, warnings };
        }
        
        // Coerce nested properties if defined
        if (definition.properties) {
            const coercedObj: Record<string, any> = {};
            for (const [propName, propDef] of Object.entries(definition.properties)) {
                if (propName in result) {
                    const propResult = this.coerceValue(
                        result[propName],
                        propDef,
                        `${path}.${propName}`,
                        options
                    );
                    if (propResult.success) {
                        coercedObj[propName] = propResult.value;
                        if (propResult.wasCoerced) wasCoerced = true;
                        warnings.push(...propResult.warnings);
                    } else {
                        errors.push(...propResult.errors);
                        coercedObj[propName] = result[propName]; // Keep original on error
                    }
                } else if (propDef.default !== undefined && options.applyDefaults) {
                    coercedObj[propName] = propDef.default;
                    wasCoerced = true;
                    warnings.push(`Applied default value for '${path}.${propName}'`);
                }
            }
            
            // Include any additional properties not in schema
            for (const propName of Object.keys(result)) {
                if (!(propName in coercedObj)) {
                    coercedObj[propName] = result[propName];
                }
            }
            
            result = coercedObj;
        }
        
        return {
            success: errors.length === 0,
            value: result,
            wasCoerced,
            errors,
            warnings
        };
    }

    /**
     * Update coercion options
     */
    updateOptions(options: Partial<CoercionOptions>): void {
        this.options = { ...this.options, ...options };
    }

    /**
     * Get current options
     */
    getOptions(): CoercionOptions {
        return { ...this.options };
    }
}

// Export singleton instance
export const parameterCoercer = new ParameterCoercer();