/**
 * Configuration constants for LLM providers
 */
export const PROVIDER_CONSTANTS = {
    ANTHROPIC: {
        BASE_URL: 'https://api.anthropic.com',
        DEFAULT_MODEL: 'claude-3-5-sonnet-20241022',
        API_VERSION: '2023-06-01',
        BETA_VERSION: undefined,
        CONTEXT_WINDOW: 200000,
        AVAILABLE_MODELS: [
            {
                id: 'claude-3-5-sonnet-20250106',
                name: 'Claude 3.5 Sonnet (New)',
                description: 'Most intelligent model with hybrid reasoning capabilities',
                maxTokens: 8192
            },
            {
                id: 'claude-3-5-sonnet-20241022',
                name: 'Claude 3.5 Sonnet',
                description: 'High level of intelligence and capability',
                maxTokens: 8192
            },
            {
                id: 'claude-3-5-haiku-20241022',
                name: 'Claude 3.5 Haiku',
                description: 'Fastest model with high intelligence',
                maxTokens: 8192
            },
            {
                id: 'claude-3-opus-20240229',
                name: 'Claude 3 Opus',
                description: 'Most capable model for highly complex tasks',
                maxTokens: 8192
            },
            {
                id: 'claude-3-sonnet-20240229',
                name: 'Claude 3 Sonnet',
                description: 'Ideal balance of intelligence and speed',
                maxTokens: 8192
            },
            {
                id: 'claude-3-haiku-20240307',
                name: 'Claude 3 Haiku',
                description: 'Fastest and most compact model',
                maxTokens: 8192
            },
            {
                id: 'claude-2.1',
                name: 'Claude 2.1',
                description: 'Previous generation model',
                maxTokens: 8192
            }
        ]
    },

    OPENAI: {
        BASE_URL: 'https://api.openai.com/v1',
        DEFAULT_MODEL: 'gpt-3.5-turbo',
        CONTEXT_WINDOW: 16000,
        AVAILABLE_MODELS: [
            {
                id: 'gpt-4o',
                name: 'GPT-4o',
                description: 'Most capable multimodal model',
                maxTokens: 8192
            },
            {
                id: 'gpt-4-turbo',
                name: 'GPT-4 Turbo',
                description: 'Advanced capabilities with higher token limit',
                maxTokens: 8192
            },
            {
                id: 'gpt-4',
                name: 'GPT-4',
                description: 'Original GPT-4 model',
                maxTokens: 8192
            },
            {
                id: 'gpt-3.5-turbo',
                name: 'GPT-3.5 Turbo',
                description: 'Fast and efficient model for most tasks',
                maxTokens: 8192
            }
        ]
    },

    OLLAMA: {
        BASE_URL: 'http://localhost:11434',
        DEFAULT_MODEL: 'llama2',
        BATCH_SIZE: 100,
        CHUNKING: {
            SIZE: 4000,
            OVERLAP: 200
        },
        MODEL_DIMENSIONS: {
            default: 8192,
            llama2: 8192,
            mixtral: 8192,
            'mistral': 8192
        },
        MODEL_CONTEXT_WINDOWS: {
            default: 8192,
            llama2: 8192,
            mixtral: 8192,
            'mistral': 8192
        }
    },

    /**
     * MiniMax provider constants
     * Uses Anthropic-compatible API endpoint
     * Documentation: https://platform.minimax.io/docs/
     */
    MINIMAX: {
        BASE_URL: 'https://api.minimax.io/anthropic',
        DEFAULT_MODEL: 'MiniMax-M2.1',
        API_VERSION: '2023-06-01',
        CONTEXT_WINDOW: 200000,
        AVAILABLE_MODELS: [
            {
                id: 'MiniMax-M2.1',
                name: 'MiniMax M2.1',
                description: 'Full capability model with 230B parameters, 10B activated',
                maxTokens: 128000,
                contextWindow: 200000,
                capabilities: {
                    supportsTools: true,
                    supportsStreaming: true,
                    supportsVision: false
                }
            },
            {
                id: 'MiniMax-M2.1-lightning',
                name: 'MiniMax M2.1 Lightning',
                description: 'Fast model for low-latency responses (~100 tps)',
                maxTokens: 128000,
                contextWindow: 200000,
                capabilities: {
                    supportsTools: true,
                    supportsStreaming: true,
                    supportsVision: false
                }
            },
            {
                id: 'MiniMax-M2',
                name: 'MiniMax M2',
                description: 'Balanced model with agentic capabilities, 200k context',
                maxTokens: 128000,
                contextWindow: 200000,
                capabilities: {
                    supportsTools: true,
                    supportsStreaming: true,
                    supportsVision: false
                }
            }
        ]
    }
} as const;

// LLM service configuration constants
export const LLM_CONSTANTS = {
    // Context window sizes (in characters)
    CONTEXT_WINDOW: {
        OLLAMA: 8000,
        OPENAI: 12000,
        ANTHROPIC: 15000,
        VOYAGE: 12000,
        DEFAULT: 6000
    },

    // Batch size configuration
    BATCH_SIZE: {
        OPENAI: 10,     // OpenAI can handle larger batches efficiently
        ANTHROPIC: 5,   // More conservative for Anthropic
        OLLAMA: 1,      // Ollama processes one at a time
        DEFAULT: 5      // Conservative default
    },

    // Chunking parameters
    CHUNKING: {
        DEFAULT_SIZE: 1500,
        OLLAMA_SIZE: 1000,
        DEFAULT_OVERLAP: 100
    },

    // Search/similarity thresholds
    SIMILARITY: {
        DEFAULT_THRESHOLD: 0.65,
        HIGH_THRESHOLD: 0.75,
        LOW_THRESHOLD: 0.5
    },

    // Session management
    SESSION: {
        CLEANUP_INTERVAL_MS: 60 * 60 * 1000, // 1 hour
        SESSION_EXPIRY_MS: 12 * 60 * 60 * 1000, // 12 hours
        MAX_SESSION_MESSAGES: 10
    },

    // Content limits
    CONTENT: {
        MAX_NOTE_CONTENT_LENGTH: 1500,
        MAX_TOTAL_CONTENT_LENGTH: 10000
    },

    // AI Feature Exclusion
    AI_EXCLUSION: {
        LABEL_NAME: 'aiExclude'  // Label used to exclude notes from all AI/LLM features
    },
    
    // MiniMax provider constants (for anthropic-compatible API)
    MINIMAX: 'minimax'
};
