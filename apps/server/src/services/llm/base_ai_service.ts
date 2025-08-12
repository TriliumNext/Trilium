import options from '../options.js';
import type { AIService, ChatCompletionOptions, ChatResponse, Message } from './ai_interface.js';
import { DEFAULT_SYSTEM_PROMPT } from './constants/llm_prompt_constants.js';
import log from '../log.js';

/**
 * Disposable interface for proper resource cleanup
 */
export interface Disposable {
    dispose(): void | Promise<void>;
}

export abstract class BaseAIService implements AIService, Disposable {
    protected name: string;
    protected disposed: boolean = false;

    constructor(name: string) {
        this.name = name;
    }

    abstract generateChatCompletion(messages: Message[], options?: ChatCompletionOptions): Promise<ChatResponse>;

    isAvailable(): boolean {
        if (this.disposed) {
            return false;
        }
        return options.getOptionBool('aiEnabled'); // Base check if AI is enabled globally
    }

    getName(): string {
        return this.name;
    }

    protected getSystemPrompt(customPrompt?: string): string {
        // Use prompt from constants file if no custom prompt is provided
        return customPrompt || DEFAULT_SYSTEM_PROMPT;
    }

    /**
     * Dispose of any resources held by this service
     * Override in subclasses to clean up specific resources
     */
    async dispose(): Promise<void> {
        if (this.disposed) {
            return;
        }
        
        log.info(`Disposing ${this.name} service`);
        this.disposed = true;
        
        // Subclasses should override this to clean up their specific resources
        await this.disposeResources();
    }

    /**
     * Template method for subclasses to implement resource cleanup
     */
    protected async disposeResources(): Promise<void> {
        // Default implementation does nothing
        // Subclasses should override to clean up their resources
    }

    /**
     * Check if the service has been disposed
     */
    protected checkDisposed(): void {
        if (this.disposed) {
            throw new Error(`${this.name} service has been disposed and cannot be used`);
        }
    }
}
