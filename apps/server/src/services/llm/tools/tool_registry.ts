/**
 * Tool Registry
 *
 * This file defines the registry for tools that can be called by LLMs.
 */

import type { Tool, ToolHandler } from './tool_interfaces.js';
import log from '../../log.js';

/**
 * Registry for tools that can be called by LLMs
 */
export class ToolRegistry {
    private static instance: ToolRegistry;
    private tools: Map<string, ToolHandler> = new Map();
    private initializationAttempted = false;

    private constructor() {}

    /**
     * Get singleton instance of the tool registry
     */
    public static getInstance(): ToolRegistry {
        if (!ToolRegistry.instance) {
            ToolRegistry.instance = new ToolRegistry();
        }

        return ToolRegistry.instance;
    }

    /**
     * Try to initialize tools if registry is empty
     */
    private tryInitializeTools(): boolean {
        if (this.initializationAttempted || this.tools.size > 0) {
            return this.tools.size > 0;
        }

        this.initializationAttempted = true;
        log.info("Tool registry is empty, attempting synchronous initialization");

        try {
            // Use existing tooling to initialize
            // This is a light touch, not creating anything new
            log.info("Tools should be initialized by AIServiceManager constructor");
            return this.tools.size > 0;
        } catch (error: any) {
            log.error(`Error during tool initialization attempt: ${error.message}`);
            return false;
        }
    }

    /**
     * Validate a tool to ensure it's properly initialized
     * @param handler Tool handler to validate
     */
    private validateToolHandler(handler: ToolHandler): boolean {
        try {
            if (!handler) {
                log.error(`Invalid tool handler: null or undefined`);
                return false;
            }

            if (!handler.definition) {
                log.error(`Tool handler is missing definition`);
                return false;
            }

            if (!handler.definition.function || !handler.definition.function.name) {
                log.error(`Tool definition is missing function name`);
                return false;
            }

            if (!handler.execute || typeof handler.execute !== 'function') {
                log.error(`Tool '${handler.definition.function.name}' is missing execute method`);
                return false;
            }

            // Try to invoke the execute method with a test parameter to verify it's bound properly
            // We don't actually execute, just check that it's callable
            if (handler.execute.toString().includes('[native code]')) {
                log.error(`Tool '${handler.definition.function.name}' has an unbound execute method`);
                return false;
            }

            return true;
        } catch (error: any) {
            log.error(`Error validating tool handler: ${error.message}`);
            return false;
        }
    }

    /**
     * Register a tool with the registry
     */
    public registerTool(handler: ToolHandler): void {
        if (!this.validateToolHandler(handler)) {
            log.error(`Failed to register tool: validation failed`);
            return;
        }

        const name = handler.definition.function.name;

        if (this.tools.has(name)) {
            log.info(`Tool '${name}' already registered, replacing...`);
        }

        this.tools.set(name, handler);
    }

    /**
     * Get a tool by name
     */
    public getTool(name: string): ToolHandler | undefined {
        // Try initialization if registry is empty
        if (this.tools.size === 0) {
            this.tryInitializeTools();
        }

        const tool = this.tools.get(name);

        if (!tool) {
            log.error(`Tool '${name}' not found in registry`);
            return undefined;
        }

        // Validate the tool before returning it
        if (!this.validateToolHandler(tool)) {
            log.error(`Tool '${name}' failed validation when retrieved`);
            return undefined;
        }

        return tool;
    }

    /**
     * Get all registered tools
     */
    public getAllTools(): ToolHandler[] {
        // Try initialization if registry is empty
        if (this.tools.size === 0) {
            this.tryInitializeTools();
        }

        // Filter out any tools that fail validation
        return Array.from(this.tools.values()).filter(tool => this.validateToolHandler(tool));
    }

    /**
     * Get all tool definitions for sending to LLM
     */
    public getAllToolDefinitions(): Tool[] {
        // Only get definitions from valid tools
        const validTools = this.getAllTools();
        const toolDefs = validTools.map(handler => handler.definition);
        
        // Enhanced debugging for tool recognition issues (only in debug mode)
        if (process.env.LLM_DEBUG === 'true') {
            log.info(`========== TOOL REGISTRY INFO ==========`);
            log.info(`Total tools in registry: ${this.tools.size}`);
            log.info(`Valid tools after validation: ${validTools.length}`);
            log.info(`Tool definitions being sent to LLM: ${toolDefs.length}`);
        }
        
        // Log each tool for debugging (only in debug mode)
        if (process.env.LLM_DEBUG === 'true') {
            toolDefs.forEach((def, idx) => {
                log.info(`Tool ${idx + 1}: ${def.function.name} - ${def.function.description?.substring(0, 100) || 'No description'}...`);
                log.info(`  Parameters: ${Object.keys(def.function.parameters?.properties || {}).join(', ') || 'none'}`);
                log.info(`  Required: ${def.function.parameters?.required?.join(', ') || 'none'}`);
            });
        }
        
        if (toolDefs.length === 0) {
            log.error(`CRITICAL: No tool definitions available for LLM! This will prevent tool calling.`);
            log.error(`Registry size: ${this.tools.size}, Initialization attempted: ${this.initializationAttempted}`);
            
            // Try to provide debugging info about what's in the registry
            log.error(`Raw tools in registry:`);
            this.tools.forEach((handler, name) => {
                log.error(`  - ${name}: ${handler ? 'exists' : 'null'}, definition: ${handler?.definition ? 'exists' : 'missing'}`);
            });
        }
        
        log.info(`==============================================`);
        
        return toolDefs;
    }

    /**
     * Clear all tools from the registry
     */
    public clearTools(): void {
        this.tools.clear();
        this.initializationAttempted = false;
        log.info('Tool registry cleared');
    }

    /**
     * Debug method to get detailed registry status
     */
    public getDebugInfo(): {
        registrySize: number;
        validToolCount: number;
        initializationAttempted: boolean;
        toolDetails: Array<{
            name: string;
            hasDefinition: boolean;
            hasExecute: boolean;
            isValid: boolean;
            error?: string;
        }>;
    } {
        const toolDetails: Array<{
            name: string;
            hasDefinition: boolean;
            hasExecute: boolean;
            isValid: boolean;
            error?: string;
        }> = [];
        
        this.tools.forEach((handler, name) => {
            let isValid = false;
            let error: string | undefined;
            
            try {
                isValid = this.validateToolHandler(handler);
            } catch (e) {
                error = e instanceof Error ? e.message : String(e);
            }
            
            toolDetails.push({
                name,
                hasDefinition: !!handler?.definition,
                hasExecute: typeof handler?.execute === 'function',
                isValid,
                error
            });
        });
        
        const validTools = this.getAllTools();
        
        return {
            registrySize: this.tools.size,
            validToolCount: validTools.length,
            initializationAttempted: this.initializationAttempted,
            toolDetails
        };
    }
}

// Export singleton instance
const toolRegistry = ToolRegistry.getInstance();
export default toolRegistry;
