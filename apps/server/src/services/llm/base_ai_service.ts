import options from '../options.js';
import type { AIService, ChatCompletionOptions, ChatResponse, Message, NormalizedChatResponse } from './ai_interface.js';
import { DEFAULT_SYSTEM_PROMPT } from './constants/llm_prompt_constants.js';
import { normalizeChatResponse } from './response_normalizer.js';

export abstract class BaseAIService implements AIService {
    protected name: string;

    constructor(name: string) {
        this.name = name;
    }

    abstract generateChatCompletion(messages: Message[], options?: ChatCompletionOptions): Promise<ChatResponse>;

    toNormalizedResponse(response: ChatResponse): NormalizedChatResponse {
        return normalizeChatResponse(response);
    }

    isAvailable(): boolean {
        return options.getOptionBool('aiEnabled'); // Base check if AI is enabled globally
    }

    getName(): string {
        return this.name;
    }

    protected getSystemPrompt(customPrompt?: string): string {
        // Use prompt from constants file if no custom prompt is provided
        return customPrompt || DEFAULT_SYSTEM_PROMPT;
    }
}
