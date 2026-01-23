import type { AIService, Message, ChatCompletionOptions, ChatResponse } from '../ai_interface.js';

/**
 * Interface for any LLM provider metadata
 */
export interface ProviderMetadata {
  name: string;
  capabilities: {
    chat: boolean;
    streaming: boolean;
    functionCalling?: boolean;
  };
  models: string[];
  defaultModel?: string;
}

/**
 * Interface for AI service manager configuration
 */
export interface AIServiceManagerConfig {
  defaultProvider?: string;
  fallbackProviders?: string[];
  customModels?: Record<string, string>;
}

/**
 * Interface for managing AI service providers
 */
export interface IAIServiceManager {
  getService(provider?: string): Promise<AIService>;
  getAvailableProviders(): string[];
  getSelectedProvider(): string;
  isProviderAvailable(provider: string): boolean;
  getProviderMetadata(provider: string): ProviderMetadata | null;
  getAIEnabled(): boolean;
}

/**
 * Type for service providers
 */
export type ServiceProviders = 'openai' | 'anthropic' | 'ollama' | 'minimax';

/**
 * LLM model configuration
 */
export interface ModelConfig {
  provider: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}
