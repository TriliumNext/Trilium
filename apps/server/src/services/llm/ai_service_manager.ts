import options from '../options.js';
import eventService from '../events.js';
import type { AIService, ChatCompletionOptions, ChatResponse, Message } from './ai_interface.js';
import { AnthropicService } from './providers/anthropic_service.js';
import { ContextExtractor } from './context/index.js';
import agentTools from './context_extractors/index.js';
import contextService from './context/services/context_service.js';
import log from '../log.js';
import { OllamaService } from './providers/ollama_service.js';
import { OpenAIService } from './providers/openai_service.js';
import { ProviderFactory, ProviderType, getProviderFactory } from './providers/provider_factory.js';

// Import interfaces
import type {
  ServiceProviders,
  IAIServiceManager,
  ProviderMetadata
} from './interfaces/ai_service_interfaces.js';
import type { NoteSearchResult } from './interfaces/context_interfaces.js';

// Import new configuration system
import {
    getSelectedProvider,
    parseModelIdentifier,
    isAIEnabled,
    getDefaultModelForProvider,
    clearConfigurationCache,
    validateConfiguration
} from './config/configuration_helpers.js';

/**
 * Interface representing relevant note context
 */
interface NoteContext {
    title: string;
    content?: string;
    noteId?: string;
    summary?: string;
    score?: number;
}

// Service cache entry with TTL
interface ServiceCacheEntry {
    service: AIService;
    provider: ServiceProviders;
    createdAt: number;
    lastUsed: number;
}

// Disposable interface for proper resource cleanup
export interface Disposable {
    dispose(): void | Promise<void>;
}

export class AIServiceManager implements IAIServiceManager, Disposable {
    private serviceCache: Map<ServiceProviders, ServiceCacheEntry> = new Map();
    private readonly SERVICE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL
    private readonly CLEANUP_INTERVAL_MS = 60 * 1000; // Cleanup check every minute
    private cleanupTimer: NodeJS.Timeout | null = null;
    private initialized = false;
    private disposed = false;
    private providerFactory: ProviderFactory | null = null;

    constructor() {
        // Initialize provider factory
        this.providerFactory = getProviderFactory({
            enableHealthChecks: true,
            healthCheckInterval: 60000,
            enableFallback: true,
            enableCaching: true,
            cacheTimeout: this.SERVICE_TTL_MS,
            enableMetrics: true
        });

        // Initialize tools immediately
        this.initializeTools().catch(error => {
            log.error(`Error initializing LLM tools during AIServiceManager construction: ${error.message || String(error)}`);
        });

        // Start periodic cleanup of stale services
        this.startCleanupTimer();

        this.initialized = true;
    }

    /**
     * Initialize all LLM tools in one place
     */
    private async initializeTools(): Promise<void> {
        try {
            log.info('Initializing LLM tools during AIServiceManager construction...');

            // Initialize agent tools
            await this.initializeAgentTools();
            log.info("Agent tools initialized successfully");

            // Initialize LLM tools
            const toolInitializer = await import('./tools/tool_initializer.js');
            await toolInitializer.default.initializeTools();
            log.info("LLM tools initialized successfully");
        } catch (error: unknown) {
            log.error(`Error initializing tools: ${this.handleError(error)}`);
            // Don't throw, just log the error to prevent breaking construction
        }
    }

    /**
     * Get the currently selected provider using the new configuration system
     */
    async getSelectedProviderAsync(): Promise<ServiceProviders | null> {
        try {
            const selectedProvider = await getSelectedProvider();
            return selectedProvider as ServiceProviders || null;
        } catch (error) {
            log.error(`Failed to get selected provider: ${error}`);
            return null;
        }
    }

    /**
     * Validate AI configuration using the new configuration system
     */
    async validateConfiguration(): Promise<string | null> {
        try {
            const result = await validateConfiguration();

            if (!result.isValid) {
                let message = 'There are issues with your AI configuration:';
                for (const error of result.errors) {
                    message += `\n• ${error}`;
                }
                if (result.warnings.length > 0) {
                    message += '\n\nWarnings:';
                    for (const warning of result.warnings) {
                        message += `\n• ${warning}`;
                    }
                }
                message += '\n\nPlease check your AI settings.';
                return message;
            }

            if (result.warnings.length > 0) {
                let message = 'AI configuration warnings:';
                for (const warning of result.warnings) {
                    message += `\n• ${warning}`;
                }
                log.info(message);
            }

            return null;
        } catch (error) {
            log.error(`Error validating AI configuration: ${error}`);
            return `Configuration validation failed: ${error}`;
        }
    }

    /**
     * Ensure manager is initialized before using
     */
    private ensureInitialized() {
        // No longer needed with simplified approach
    }

    /**
     * Get or create any available AI service following the simplified pattern
     * Returns a service or throws a meaningful error
     */
    async getOrCreateAnyService(): Promise<AIService> {
        this.ensureInitialized();

        // Get the selected provider using the new configuration system
        const selectedProvider = await this.getSelectedProviderAsync();


        if (!selectedProvider) {
            throw new Error('No AI provider is selected. Please select a provider (OpenAI, Anthropic, or Ollama) in your AI settings.');
        }

        try {
            const service = await this.getOrCreateChatProvider(selectedProvider);
            if (service) {
                return service;
            }
            throw new Error(`Failed to create ${selectedProvider} service`);
        } catch (error) {
            log.error(`Provider ${selectedProvider} not available: ${error}`);
            throw new Error(`Selected AI provider (${selectedProvider}) is not available. Please check your configuration: ${error}`);
        }
    }

    /**
     * Check if any AI service is available (legacy method for backward compatibility)
     */
    isAnyServiceAvailable(): boolean {
        this.ensureInitialized();

        // Check if we have the selected provider available
        return this.getAvailableProviders().length > 0;
    }

    /**
     * Get list of available providers
     */
        getAvailableProviders(): ServiceProviders[] {
        this.ensureInitialized();

        const allProviders: ServiceProviders[] = ['openai', 'anthropic', 'ollama'];
        const availableProviders: ServiceProviders[] = [];

        for (const providerName of allProviders) {
            // Check configuration to see if provider would be available
            try {
                switch (providerName) {
                    case 'openai':
                        if (options.getOption('openaiApiKey') || options.getOption('openaiBaseUrl')) {
                            availableProviders.push(providerName);
                        }
                        break;
                    case 'anthropic':
                        if (options.getOption('anthropicApiKey')) {
                            availableProviders.push(providerName);
                        }
                        break;
                    case 'ollama':
                        if (options.getOption('ollamaBaseUrl')) {
                            availableProviders.push(providerName);
                        }
                        break;
                }
            } catch (error) {
                // Ignore configuration errors, provider just won't be available
            }
        }

        return availableProviders;
    }

    /**
     * Generate a chat completion response using the first available AI service
     * based on the configured precedence order
     */
    async generateChatCompletion(messages: Message[], options: ChatCompletionOptions = {}): Promise<ChatResponse> {
        this.ensureInitialized();

        log.info(`[AIServiceManager] generateChatCompletion called with options: ${JSON.stringify({
            model: options.model,
            stream: options.stream,
            enableTools: options.enableTools
        })}`);
        log.info(`[AIServiceManager] Stream option type: ${typeof options.stream}`);

        if (!messages || messages.length === 0) {
            throw new Error('No messages provided for chat completion');
        }

        // Get the selected provider
        const selectedProvider = await this.getSelectedProviderAsync();

        if (!selectedProvider) {
            throw new Error('No AI provider is selected. Please select a provider in your AI settings.');
        }

        // Check if the selected provider is available
        const availableProviders = this.getAvailableProviders();
        if (!availableProviders.includes(selectedProvider)) {
            throw new Error(`Selected AI provider (${selectedProvider}) is not available. Please check your configuration.`);
        }

        // If a specific provider is requested and available, use it
        if (options.model && options.model.includes(':')) {
            // Use the new configuration system to parse model identifier
            const modelIdentifier = parseModelIdentifier(options.model);

            if (modelIdentifier.provider && modelIdentifier.provider === selectedProvider) {
                try {
                    const service = await this.getOrCreateChatProvider(modelIdentifier.provider as ServiceProviders);
                    if (service) {
                        const modifiedOptions = { ...options, model: modelIdentifier.modelId };
                        log.info(`[AIServiceManager] Using provider ${modelIdentifier.provider} from model prefix with modifiedOptions.stream: ${modifiedOptions.stream}`);
                        return await service.generateChatCompletion(messages, modifiedOptions);
                    }
                } catch (error) {
                    log.error(`Error with specified provider ${modelIdentifier.provider}: ${error}`);
                    throw new Error(`Failed to use specified provider ${modelIdentifier.provider}: ${error}`);
                }
            } else if (modelIdentifier.provider && modelIdentifier.provider !== selectedProvider) {
                throw new Error(`Model specifies provider '${modelIdentifier.provider}' but selected provider is '${selectedProvider}'. Please select the correct provider or use a model without provider prefix.`);
            }
            // If not a provider prefix, treat the entire string as a model name and continue with normal provider selection
        }

        // Use the selected provider
        try {
            const service = await this.getOrCreateChatProvider(selectedProvider);
            if (!service) {
                throw new Error(`Failed to create selected chat provider: ${selectedProvider}. Please check your configuration.`);
            }
            log.info(`[AIServiceManager] Using selected provider ${selectedProvider} with options.stream: ${options.stream}`);
            return await service.generateChatCompletion(messages, options);
        } catch (error) {
            log.error(`Error with selected provider ${selectedProvider}: ${error}`);
            throw new Error(`Selected AI provider (${selectedProvider}) failed: ${error}`);
        }
    }

    setupEventListeners() {
        // Setup event listeners for AI services
    }

    /**
     * Get the context extractor service
     * @returns The context extractor instance
     */
    getContextExtractor() {
        return contextExtractor;
    }

    /**
     * Get the context service for advanced context management
     * @returns The context service instance
     */
    getContextService() {
        return contextService;
    }

    /**
     * Get the index service for managing knowledge base indexing
     * @returns null since index service has been removed
     */
    getIndexService() {
        log.info('Index service has been removed - returning null');
        return null;
    }

    /**
     * Ensure agent tools are initialized (no-op as they're initialized in constructor)
     * Kept for backward compatibility with existing API
     */
    async initializeAgentTools(): Promise<void> {
        // Agent tools are already initialized in the constructor
        // This method is kept for backward compatibility
        log.info("initializeAgentTools called, but tools are already initialized in constructor");
    }

    /**
     * Get the agent tools manager
     * This provides access to all agent tools
     */
    getAgentTools() {
        return agentTools;
    }

    /**
     * Get the vector search tool for semantic similarity search
     * Returns null since vector search has been removed
     */
    getVectorSearchTool() {
        log.info('Vector search has been removed - getVectorSearchTool returning null');
        return null;
    }

    /**
     * Get the note navigator tool for hierarchical exploration
     */
    getNoteNavigatorTool() {
        const tools = agentTools.getTools();
        return tools.noteNavigator;
    }

    /**
     * Get the query decomposition tool for complex queries
     */
    getQueryDecompositionTool() {
        const tools = agentTools.getTools();
        return tools.queryDecomposition;
    }

    /**
     * Get the contextual thinking tool for transparent reasoning
     */
    getContextualThinkingTool() {
        const tools = agentTools.getTools();
        return tools.contextualThinking;
    }

    /**
     * Get whether AI features are enabled using the new configuration system
     */
    async getAIEnabledAsync(): Promise<boolean> {
        return isAIEnabled();
    }

    /**
     * Get whether AI features are enabled (sync version for compatibility)
     */
    getAIEnabled(): boolean {
        // For synchronous compatibility, use the old method
        // In a full refactor, this should be async
        return options.getOptionBool('aiEnabled');
    }

    /**
     * Start the cleanup timer for removing stale services
     */
    private startCleanupTimer(): void {
        if (this.cleanupTimer) return;
        
        this.cleanupTimer = setInterval(() => {
            this.cleanupStaleServices();
        }, this.CLEANUP_INTERVAL_MS);
    }

    /**
     * Stop the cleanup timer
     */
    private stopCleanupTimer(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    /**
     * Cleanup stale services that haven't been used recently
     */
    private cleanupStaleServices(): void {
        if (this.disposed) return;

        const now = Date.now();
        const staleProviders: ServiceProviders[] = [];

        for (const [provider, entry] of this.serviceCache.entries()) {
            if (now - entry.lastUsed > this.SERVICE_TTL_MS) {
                staleProviders.push(provider);
            }
        }

        for (const provider of staleProviders) {
            this.disposeService(provider);
        }

        if (staleProviders.length > 0) {
            log.info(`Cleaned up ${staleProviders.length} stale service(s): ${staleProviders.join(', ')}`);
        }
    }

    /**
     * Dispose a specific service
     */
    private disposeService(provider: ServiceProviders): void {
        const entry = this.serviceCache.get(provider);
        if (entry) {
            // If the service implements disposable, call dispose
            if ('dispose' in entry.service && typeof (entry.service as any).dispose === 'function') {
                try {
                    (entry.service as any).dispose();
                } catch (error) {
                    log.error(`Error disposing ${provider} service: ${error}`);
                }
            }
            this.serviceCache.delete(provider);
            log.info(`Disposed ${provider} service`);
        }
    }

    /**
     * Clear all cached providers (forces recreation on next access)
     */
    public clearCurrentProvider(): void {
        // Clear provider factory cache
        if (this.providerFactory) {
            this.providerFactory.clearCache();
        }
        
        // Clear local cache
        for (const provider of this.serviceCache.keys()) {
            this.disposeService(provider);
        }
        log.info('Cleared all cached providers - will be recreated on next access');
    }

    /**
     * Get or create a provider instance using the provider factory
     */
    private async getOrCreateChatProvider(providerName: ServiceProviders): Promise<AIService | null> {
        if (this.disposed) {
            throw new Error('AIServiceManager has been disposed');
        }

        if (!this.providerFactory) {
            throw new Error('Provider factory not initialized');
        }

        try {
            // Map ServiceProviders to ProviderType
            const providerTypeMap: Record<ServiceProviders, ProviderType> = {
                'openai': ProviderType.OPENAI,
                'anthropic': ProviderType.ANTHROPIC,
                'ollama': ProviderType.OLLAMA
            };

            const providerType = providerTypeMap[providerName];
            if (!providerType) {
                log.error(`Unknown provider name: ${providerName}`);
                return null;
            }

            // Check if provider is configured
            switch (providerName) {
                case 'openai': {
                    const apiKey = options.getOption('openaiApiKey');
                    const baseUrl = options.getOption('openaiBaseUrl');
                    if (!apiKey && !baseUrl) return null;
                    break;
                }
                case 'anthropic': {
                    const apiKey = options.getOption('anthropicApiKey');
                    if (!apiKey) return null;
                    break;
                }
                case 'ollama': {
                    const baseUrl = options.getOption('ollamaBaseUrl');
                    if (!baseUrl) return null;
                    break;
                }
            }

            // Use provider factory to create the service
            const service = await this.providerFactory.createProvider(providerType);
            
            if (service && service.isAvailable()) {
                log.info(`Created ${providerName} service via provider factory`);
                return service;
            }

            throw new Error(`${providerName} service not available`);
        } catch (error: any) {
            log.error(`Failed to create ${providerName} chat provider: ${error.message || 'Unknown error'}`);
            
            // Provider factory handles fallback internally if configured
            return null;
        }
    }

    /**
     * Dispose of all resources and cleanup
     */
    async dispose(): Promise<void> {
        if (this.disposed) return;

        log.info('Disposing AIServiceManager...');
        this.disposed = true;

        // Stop cleanup timer
        this.stopCleanupTimer();

        // Dispose provider factory
        if (this.providerFactory) {
            this.providerFactory.dispose();
            this.providerFactory = null;
        }

        // Dispose all cached services
        for (const provider of this.serviceCache.keys()) {
            this.disposeService(provider);
        }

        log.info('AIServiceManager disposed successfully');
    }

    /**
     * Initialize the AI Service using the new configuration system
     */
    async initialize(): Promise<void> {
        try {
            log.info("Initializing AI service...");

            // Check if AI is enabled using the new helper
            const aiEnabled = await isAIEnabled();

            if (!aiEnabled) {
                log.info("AI features are disabled in options");
                return;
            }

            // Index service has been removed - no initialization needed

            // Tools are already initialized in the constructor
            // No need to initialize them again

            this.initialized = true;
            log.info("AI service initialized successfully");
        } catch (error: any) {
            log.error(`Error initializing AI service: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get description of available agent tools
     */
    async getAgentToolsDescription(): Promise<string> {
        try {
            // Get all available tools
            const tools = agentTools.getAllTools();

            if (!tools || tools.length === 0) {
                return "";
            }

            // Format tool descriptions
            const toolDescriptions = tools.map(tool =>
                `- ${tool.name}: ${tool.description}`
            ).join('\n');

            return `Available tools:\n${toolDescriptions}`;
        } catch (error) {
            log.error(`Error getting agent tools description: ${error}`);
            return "";
        }
    }

    /**
     * Get enhanced context with available agent tools
     * @param noteId - The ID of the note
     * @param query - The user's query
     * @param showThinking - Whether to show LLM's thinking process
     * @param relevantNotes - Optional notes already found to be relevant
     * @returns Enhanced context with agent tools information
     */
    async getAgentToolsContext(
        noteId: string,
        query: string,
        showThinking: boolean = false,
        relevantNotes: NoteSearchResult[] = []
    ): Promise<string> {
        try {
            // Create agent tools message
            const toolsMessage = await this.getAgentToolsDescription();

            // Agent tools are already initialized in the constructor
            // No need to initialize them again

            // If we have notes that were already found to be relevant, use them directly
            let contextNotes = relevantNotes;

            // If no notes provided, find relevant ones
            if (!contextNotes || contextNotes.length === 0) {
                try {
                    // Get the default LLM service for context enhancement
                    const provider = this.getSelectedProvider();
                    const llmService = await this.getService(provider);

                    // Find relevant notes
                    contextNotes = await contextService.findRelevantNotes(
                        query,
                        noteId,
                        {
                            maxResults: 5,
                            summarize: true,
                            llmService
                        }
                    );

                    log.info(`Found ${contextNotes.length} relevant notes for context`);
                } catch (error) {
                    log.error(`Failed to find relevant notes: ${this.handleError(error)}`);
                    // Continue without context notes
                    contextNotes = [];
                }
            }

            // Format notes into context string if we have any
            let contextStr = "";
            if (contextNotes && contextNotes.length > 0) {
                contextStr = "\n\nRelevant context:\n";
                contextNotes.forEach((note, index) => {
                    contextStr += `[${index + 1}] "${note.title}"\n${note.content || 'No content available'}\n\n`;
                });
            }

            // Combine tool message with context
            return toolsMessage + contextStr;
        } catch (error) {
            log.error(`Error getting agent tools context: ${this.handleError(error)}`);
            return "";
        }
    }

    /**
     * Get AI service for the given provider
     */
    async getService(provider?: string): Promise<AIService> {
        this.ensureInitialized();

        // If provider is specified, try to get or create it
        if (provider) {
            const service = await this.getOrCreateChatProvider(provider as ServiceProviders);
            if (service && service.isAvailable()) {
                return service;
            }
            throw new Error(`Specified provider ${provider} is not available`);
        }

        // Otherwise, use the selected provider
        const selectedProvider = await this.getSelectedProviderAsync();
        if (!selectedProvider) {
            throw new Error('No AI provider is selected. Please select a provider in your AI settings.');
        }

        const service = await this.getOrCreateChatProvider(selectedProvider);
        if (service && service.isAvailable()) {
            return service;
        }

        // If no provider is available, throw a clear error
        throw new Error(`Selected AI provider (${selectedProvider}) is not available. Please check your AI settings.`);
    }

    /**
     * Get the preferred provider based on configuration using the new system
     */
    async getPreferredProviderAsync(): Promise<string> {
        try {
            const selectedProvider = await getSelectedProvider();
            if (selectedProvider === null) {
                // No provider selected, fallback to default
                log.info('No provider selected, using default provider');
                return 'openai';
            }
            return selectedProvider;
        } catch (error) {
            log.error(`Error getting preferred provider: ${error}`);
            return 'openai';
        }
    }

    /**
     * Get the selected provider based on configuration (sync version for compatibility)
     */
    getSelectedProvider(): string {
        this.ensureInitialized();

        // Try to get the selected provider synchronously
        try {
            const selectedProvider = options.getOption('aiSelectedProvider');
            if (selectedProvider) {
                return selectedProvider;
            }
        } catch (error) {
            log.error(`Error getting selected provider: ${error}`);
        }

        // Return a default if nothing is selected (for backward compatibility)
        return 'openai';
    }

    /**
     * Check if a service cache entry is stale
     */
    private isServiceStale(entry: ServiceCacheEntry): boolean {
        const now = Date.now();
        return now - entry.lastUsed > this.SERVICE_TTL_MS;
    }

    /**
     * Check if a specific provider is available
     */
    isProviderAvailable(provider: string): boolean {
        // Check health status from provider factory
        if (this.providerFactory) {
            const providerTypeMap: Record<string, ProviderType> = {
                'openai': ProviderType.OPENAI,
                'anthropic': ProviderType.ANTHROPIC,
                'ollama': ProviderType.OLLAMA
            };
            
            const providerType = providerTypeMap[provider];
            if (providerType) {
                const healthStatus = this.providerFactory.getHealthStatus(providerType);
                if (healthStatus) {
                    return healthStatus.healthy;
                }
            }
        }

        // Fallback to configuration check
        try {
            switch (provider) {
                case 'openai':
                    return !!(options.getOption('openaiApiKey') || options.getOption('openaiBaseUrl'));
                case 'anthropic':
                    return !!options.getOption('anthropicApiKey');
                case 'ollama':
                    return !!options.getOption('ollamaBaseUrl');
                default:
                    return false;
            }
        } catch {
            return false;
        }
    }

    /**
     * Get metadata about a provider
     */
    getProviderMetadata(provider: string): ProviderMetadata | null {
        // Get capabilities from provider factory
        if (this.providerFactory) {
            const providerTypeMap: Record<string, ProviderType> = {
                'openai': ProviderType.OPENAI,
                'anthropic': ProviderType.ANTHROPIC,
                'ollama': ProviderType.OLLAMA
            };
            
            const providerType = providerTypeMap[provider];
            if (providerType) {
                const capabilities = this.providerFactory.getCapabilities(providerType);
                if (capabilities) {
                    return {
                        name: provider,
                        capabilities: {
                            chat: true,
                            streaming: capabilities.streaming,
                            functionCalling: capabilities.functionCalling
                        },
                        models: ['default'], // Could be enhanced to get actual models
                        defaultModel: 'default'
                    };
                }
            }
        }

        // Fallback
        return {
            name: provider,
            capabilities: {
                chat: true,
                streaming: true,
                functionCalling: provider === 'openai'
            },
            models: ['default'],
            defaultModel: 'default'
        };
    }


    /**
     * Error handler that properly types the error object
     */
    private handleError(error: unknown): string {
        if (error instanceof Error) {
            return error.message || String(error);
        }
        return String(error);
    }

    // Removed complex event listener and cache invalidation logic
    // Services will be created fresh when needed by reading current options

}

// Singleton instance (lazy-loaded) - can be disposed and recreated
let instance: AIServiceManager | null = null;

/**
 * Get the AIServiceManager instance (creates it if not already created or disposed)
 */
function getInstance(): AIServiceManager {
    if (!instance || (instance as any).disposed) {
        instance = new AIServiceManager();
    }
    return instance;
}

/**
 * Create a new AIServiceManager instance (for testing or isolated contexts)
 */
function createNewInstance(): AIServiceManager {
    return new AIServiceManager();
}

/**
 * Dispose the current singleton instance
 */
async function disposeInstance(): Promise<void> {
    if (instance) {
        await instance.dispose();
        instance = null;
    }
}

export default {
    getInstance,
    createNewInstance,
    disposeInstance,
    // Also export methods directly for convenience
    isAnyServiceAvailable(): boolean {
        return getInstance().isAnyServiceAvailable();
    },
    async getOrCreateAnyService(): Promise<AIService> {
        return getInstance().getOrCreateAnyService();
    },
    getAvailableProviders() {
        return getInstance().getAvailableProviders();
    },
    async generateChatCompletion(messages: Message[], options: ChatCompletionOptions = {}): Promise<ChatResponse> {
        return getInstance().generateChatCompletion(messages, options);
    },
    // Context and index related methods
    getContextExtractor() {
        return getInstance().getContextExtractor();
    },
    getContextService() {
        return getInstance().getContextService();
    },
    getIndexService() {
        return getInstance().getIndexService();
    },
    // Agent tools related methods
    // Tools are now initialized in the constructor
    getAgentTools() {
        return getInstance().getAgentTools();
    },
    getVectorSearchTool() {
        return getInstance().getVectorSearchTool();
    },
    getNoteNavigatorTool() {
        return getInstance().getNoteNavigatorTool();
    },
    getQueryDecompositionTool() {
        return getInstance().getQueryDecompositionTool();
    },
    getContextualThinkingTool() {
        return getInstance().getContextualThinkingTool();
    },
    async getAgentToolsContext(
        noteId: string,
        query: string,
        showThinking: boolean = false,
        relevantNotes: NoteSearchResult[] = []
    ): Promise<string> {
        return getInstance().getAgentToolsContext(
            noteId,
            query,
            showThinking,
            relevantNotes
        );
    },
    // New methods
    async getService(provider?: string): Promise<AIService> {
        return getInstance().getService(provider);
    },
    getSelectedProvider(): string {
        return getInstance().getSelectedProvider();
    },
    isProviderAvailable(provider: string): boolean {
        return getInstance().isProviderAvailable(provider);
    },
    getProviderMetadata(provider: string): ProviderMetadata | null {
        return getInstance().getProviderMetadata(provider);
    }
};

// Create an instance of ContextExtractor for backward compatibility
const contextExtractor = new ContextExtractor();
