import { BasePipelineStage } from '../pipeline_stage.js';
import type { ToolExecutionInput, StreamCallback } from '../interfaces.js';
import type { ChatResponse, Message } from '../../ai_interface.js';
import log from '../../../log.js';

interface UserInteractionConfig {
    enableConfirmation: boolean;
    enableCancellation: boolean;
    confirmationTimeout: number; // milliseconds
    autoConfirmLowRisk: boolean;
    requiredConfirmationTools: string[];
}

interface PendingInteraction {
    id: string;
    toolCall: any;
    timestamp: number;
    timeoutHandle?: NodeJS.Timeout;
    resolved: boolean;
}

type InteractionResponse = 'confirm' | 'cancel' | 'timeout';

/**
 * Enhanced User Interaction Pipeline Stage
 * Provides real-time confirmation/cancellation capabilities for tool execution
 */
export class UserInteractionStage extends BasePipelineStage<ToolExecutionInput, { response: ChatResponse, needsFollowUp: boolean, messages: Message[], userInteractions?: any[] }> {
    
    private config: UserInteractionConfig;
    private pendingInteractions: Map<string, PendingInteraction> = new Map();
    private interactionCallbacks: Map<string, (response: InteractionResponse) => void> = new Map();

    constructor(config?: Partial<UserInteractionConfig>) {
        super('UserInteraction');
        
        this.config = {
            enableConfirmation: true,
            enableCancellation: true,
            confirmationTimeout: 15000, // 15 seconds
            autoConfirmLowRisk: true,
            requiredConfirmationTools: ['attribute_search', 'read_note'],
            ...config
        };
    }

    /**
     * Process tool execution with user interaction capabilities
     */
    protected async process(input: ToolExecutionInput): Promise<{ response: ChatResponse, needsFollowUp: boolean, messages: Message[], userInteractions?: any[] }> {
        const { response } = input;

        // If no tool calls or interactions disabled, pass through
        if (!response.tool_calls || response.tool_calls.length === 0 || !this.config.enableConfirmation) {
            return { 
                response, 
                needsFollowUp: false, 
                messages: input.messages,
                userInteractions: []
            };
        }

        log.info(`========== USER INTERACTION STAGE PROCESSING ==========`);
        log.info(`Processing ${response.tool_calls.length} tool calls with user interaction controls`);

        const processedToolCalls: any[] = [];
        const userInteractions: any[] = [];
        const updatedMessages = [...input.messages];

        // Process each tool call with interaction controls
        for (let i = 0; i < response.tool_calls.length; i++) {
            const toolCall = response.tool_calls[i];
            
            const interactionResult = await this.processToolCallWithInteraction(toolCall, input, i);
            
            if (interactionResult) {
                processedToolCalls.push(interactionResult.toolCall);
                updatedMessages.push(interactionResult.message);
                
                if (interactionResult.interaction) {
                    userInteractions.push(interactionResult.interaction);
                }
            }
        }

        // Create enhanced response with interaction metadata
        const enhancedResponse: ChatResponse = {
            ...response,
            tool_calls: processedToolCalls,
            interaction_metadata: {
                total_interactions: userInteractions.length,
                confirmed: userInteractions.filter((i: any) => i.response === 'confirm').length,
                cancelled: userInteractions.filter((i: any) => i.response === 'cancel').length,
                timedout: userInteractions.filter((i: any) => i.response === 'timeout').length
            }
        };

        const needsFollowUp = processedToolCalls.length > 0;

        log.info(`User interaction complete: ${userInteractions.length} interactions processed`);

        return {
            response: enhancedResponse,
            needsFollowUp,
            messages: updatedMessages,
            userInteractions
        };
    }

    /**
     * Process a tool call with user interaction controls
     */
    private async processToolCallWithInteraction(
        toolCall: any, 
        input: ToolExecutionInput, 
        index: number
    ): Promise<{ toolCall: any, message: Message, interaction?: any } | null> {
        
        const toolName = toolCall.function.name;
        const riskLevel = this.assessToolRiskLevel(toolName);
        
        // Determine if confirmation is required
        const requiresConfirmation = this.shouldRequireConfirmation(toolName, riskLevel);
        
        if (!requiresConfirmation) {
            // Execute immediately for low-risk tools
            log.info(`Tool ${toolName} is low-risk, executing immediately`);
            return await this.executeToolDirectly(toolCall, input);
        }

        // Request user confirmation
        log.info(`Tool ${toolName} requires user confirmation (risk level: ${riskLevel})`);
        
        const interactionId = this.generateInteractionId();
        const interaction = await this.requestUserConfirmation(toolCall, interactionId, input.streamCallback);
        
        if (interaction.response === 'confirm') {
            log.info(`User confirmed execution of ${toolName}`);
            const result = await this.executeToolDirectly(toolCall, input);
            return {
                ...result!,
                interaction
            };
        } else if (interaction.response === 'cancel') {
            log.info(`User cancelled execution of ${toolName}`);
            return {
                toolCall,
                message: {
                    role: 'tool',
                    content: `USER_CANCELLED: Execution of ${toolName} was cancelled by user request.`,
                    name: toolName,
                    tool_call_id: toolCall.id
                },
                interaction
            };
        } else {
            // Timeout
            log.info(`User confirmation timeout for ${toolName}, executing with default action`);
            const result = await this.executeToolDirectly(toolCall, input);
            return {
                ...result!,
                interaction: { ...interaction, response: 'timeout_executed' }
            };
        }
    }

    /**
     * Assess the risk level of a tool
     */
    private assessToolRiskLevel(toolName: string): 'low' | 'medium' | 'high' {
        const riskLevels = {
            // Low risk - read-only operations
            'search_notes': 'low',
            'keyword_search': 'low',
            'discover_tools': 'low',
            'template_search': 'low',
            
            // Medium risk - specific data access
            'read_note': 'medium',
            'note_by_path': 'medium',
            
            // High risk - complex queries or potential data modification
            'attribute_search': 'high'
        };

        return (riskLevels as any)[toolName] || 'medium';
    }

    /**
     * Determine if a tool requires user confirmation
     */
    private shouldRequireConfirmation(toolName: string, riskLevel: string): boolean {
        // Always require confirmation for high-risk tools
        if (riskLevel === 'high') {
            return true;
        }

        // Check if tool is in the required confirmation list
        if (this.config.requiredConfirmationTools.includes(toolName)) {
            return true;
        }

        // Auto-confirm low-risk tools if enabled
        if (riskLevel === 'low' && this.config.autoConfirmLowRisk) {
            return false;
        }

        // Default to requiring confirmation for medium-risk tools
        return riskLevel === 'medium';
    }

    /**
     * Request user confirmation for tool execution
     */
    private async requestUserConfirmation(
        toolCall: any, 
        interactionId: string, 
        streamCallback?: StreamCallback
    ): Promise<any> {
        
        const toolName = toolCall.function.name;
        const args = this.parseToolArguments(toolCall.function.arguments);
        
        // Create pending interaction
        const pendingInteraction: PendingInteraction = {
            id: interactionId,
            toolCall,
            timestamp: Date.now(),
            resolved: false
        };

        this.pendingInteractions.set(interactionId, pendingInteraction);

        // Send confirmation request via streaming
        if (streamCallback) {
            this.sendConfirmationRequest(streamCallback, toolCall, interactionId, args);
        }

        // Wait for user response or timeout
        return new Promise<any>((resolve) => {
            // Set up timeout
            const timeoutHandle = setTimeout(() => {
                if (!pendingInteraction.resolved) {
                    pendingInteraction.resolved = true;
                    this.pendingInteractions.delete(interactionId);
                    this.interactionCallbacks.delete(interactionId);
                    
                    resolve({
                        id: interactionId,
                        toolName,
                        response: 'timeout',
                        timestamp: Date.now(),
                        duration: Date.now() - pendingInteraction.timestamp
                    });
                }
            }, this.config.confirmationTimeout);

            pendingInteraction.timeoutHandle = timeoutHandle;

            // Set up response callback
            this.interactionCallbacks.set(interactionId, (response: InteractionResponse) => {
                if (!pendingInteraction.resolved) {
                    pendingInteraction.resolved = true;
                    
                    if (timeoutHandle) {
                        clearTimeout(timeoutHandle);
                    }
                    
                    this.pendingInteractions.delete(interactionId);
                    this.interactionCallbacks.delete(interactionId);
                    
                    resolve({
                        id: interactionId,
                        toolName,
                        response,
                        timestamp: Date.now(),
                        duration: Date.now() - pendingInteraction.timestamp
                    });
                }
            });
        });
    }

    /**
     * Send confirmation request via streaming
     */
    private sendConfirmationRequest(
        streamCallback: StreamCallback,
        toolCall: any,
        interactionId: string,
        args: Record<string, unknown>
    ): void {
        
        const toolName = toolCall.function.name;
        const riskLevel = this.assessToolRiskLevel(toolName);
        
        // Create user-friendly description of the tool action
        const actionDescription = this.createActionDescription(toolName, args);
        
        const confirmationData = {
            type: 'user_confirmation',
            action: 'request',
            interactionId,
            tool: {
                name: toolName,
                description: actionDescription,
                arguments: args,
                riskLevel
            },
            options: {
                confirm: {
                    label: 'Execute',
                    description: `Proceed with ${toolName}`,
                    style: riskLevel === 'high' ? 'warning' : 'primary'
                },
                cancel: {
                    label: 'Cancel',
                    description: 'Skip this tool execution',
                    style: 'secondary'
                }
            },
            timeout: this.config.confirmationTimeout,
            message: `Do you want to execute ${toolName}? ${actionDescription}`
        };

        streamCallback('', false, {
            text: '',
            done: false,
            userInteraction: confirmationData
        });
    }

    /**
     * Create user-friendly action description
     */
    private createActionDescription(toolName: string, args: Record<string, unknown>): string {
        switch (toolName) {
            case 'search_notes':
                return `Search your notes for: "${args.query || 'unknown query'}"`;
            
            case 'read_note':
                return `Read note with ID: ${args.noteId || 'unknown'}`;
            
            case 'keyword_search':
                return `Search for keyword: "${args.query || 'unknown query'}"`;
            
            case 'attribute_search':
                return `Search for ${args.attributeType || 'attribute'}: "${args.attributeName || 'unknown'}"`;
            
            case 'note_by_path':
                return `Find note at path: "${args.path || 'unknown path'}"`;
            
            case 'discover_tools':
                return `Discover available tools`;
            
            default:
                return `Execute ${toolName} with provided parameters`;
        }
    }

    /**
     * Execute tool directly without confirmation
     */
    private async executeToolDirectly(
        toolCall: any, 
        input: ToolExecutionInput
    ): Promise<{ toolCall: any, message: Message }> {
        
        const toolName = toolCall.function.name;
        
        try {
            // Import and use tool registry
            const toolRegistry = (await import('../../tools/tool_registry.js')).default;
            const tool = toolRegistry.getTool(toolName);
            
            if (!tool) {
                throw new Error(`Tool not found: ${toolName}`);
            }

            const args = this.parseToolArguments(toolCall.function.arguments);
            const result = await tool.execute(args);

            return {
                toolCall,
                message: {
                    role: 'tool',
                    content: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                    name: toolName,
                    tool_call_id: toolCall.id
                }
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error executing tool ${toolName}: ${errorMessage}`);

            return {
                toolCall,
                message: {
                    role: 'tool',
                    content: `Error: ${errorMessage}`,
                    name: toolName,
                    tool_call_id: toolCall.id
                }
            };
        }
    }

    /**
     * Parse tool arguments safely
     */
    private parseToolArguments(args: string | Record<string, unknown>): Record<string, unknown> {
        if (typeof args === 'string') {
            try {
                return JSON.parse(args);
            } catch {
                return { query: args };
            }
        }
        return args;
    }

    /**
     * Generate unique interaction ID
     */
    private generateInteractionId(): string {
        return `interaction_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Handle user response to confirmation request
     * This method would be called by the frontend/WebSocket handler
     */
    public handleUserResponse(interactionId: string, response: 'confirm' | 'cancel'): boolean {
        const callback = this.interactionCallbacks.get(interactionId);
        
        if (callback) {
            log.info(`Received user response for interaction ${interactionId}: ${response}`);
            callback(response);
            return true;
        }
        
        log.error(`No callback found for interaction ${interactionId}`);
        return false;
    }

    /**
     * Cancel all pending interactions
     */
    public cancelAllPendingInteractions(): void {
        log.info(`Cancelling ${this.pendingInteractions.size} pending interactions`);
        
        for (const [id, interaction] of this.pendingInteractions.entries()) {
            if (interaction.timeoutHandle) {
                clearTimeout(interaction.timeoutHandle);
            }
            
            const callback = this.interactionCallbacks.get(id);
            if (callback && !interaction.resolved) {
                callback('cancel');
            }
        }
        
        this.pendingInteractions.clear();
        this.interactionCallbacks.clear();
    }

    /**
     * Get pending interactions (for status monitoring)
     */
    public getPendingInteractions(): Array<{ id: string, toolName: string, timestamp: number }> {
        return Array.from(this.pendingInteractions.values()).map(interaction => ({
            id: interaction.id,
            toolName: interaction.toolCall.function.name,
            timestamp: interaction.timestamp
        }));
    }

    /**
     * Update configuration
     */
    public updateConfig(newConfig: Partial<UserInteractionConfig>): void {
        this.config = { ...this.config, ...newConfig };
        log.info(`User interaction configuration updated: ${JSON.stringify(newConfig)}`);
    }
}