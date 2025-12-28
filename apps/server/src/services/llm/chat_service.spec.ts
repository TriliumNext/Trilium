import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatService } from './chat_service.js';
import type { Message, ChatCompletionOptions } from './ai_interface.js';

// Mock dependencies
vi.mock('./chat_storage_service.js', () => ({
    default: {
        createChat: vi.fn(),
        getChat: vi.fn(),
        updateChat: vi.fn(),
        deleteChat: vi.fn(),
        getAllChats: vi.fn(),
        recordSources: vi.fn()
    }
}));

vi.mock('../log.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    }
}));

vi.mock('./constants/llm_prompt_constants.js', () => ({
    CONTEXT_PROMPTS: {
        NOTE_CONTEXT_PROMPT: 'Context: {context}',
        SEMANTIC_NOTE_CONTEXT_PROMPT: 'Query: {query}\nContext: {context}'
    },
    ERROR_PROMPTS: {
        USER_ERRORS: {
            GENERAL_ERROR: 'Sorry, I encountered an error processing your request.',
            CONTEXT_ERROR: 'Sorry, I encountered an error processing the context.'
        }
    }
}));

vi.mock('./pipeline/chat_pipeline.js', () => {
    class ChatPipeline {
        config: any;

        constructor(config: any) {
            this.config = config;
        }

        execute = vi.fn();
        getMetrics = vi.fn();
        resetMetrics = vi.fn();
        stages = {
            contextExtraction: {
                execute: vi.fn()
            },
            semanticContextExtraction: {
                execute: vi.fn()
            }
        }
    }
    return { ChatPipeline };
});

vi.mock('./ai_service_manager.js', () => ({
    default: {
        getService: vi.fn()
    }
}));

describe('ChatService', () => {
    let chatService: ChatService;
    let mockChatStorageService: any;
    let mockAiServiceManager: any;
    let mockChatPipeline: any;
    let mockLog: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Get mocked modules
        mockChatStorageService = (await import('./chat_storage_service.js')).default;
        mockAiServiceManager = (await import('./ai_service_manager.js')).default;
        mockLog = (await import('../log.js')).default;

        // Setup pipeline mock
        mockChatPipeline = {
            execute: vi.fn(),
            getMetrics: vi.fn(),
            resetMetrics: vi.fn(),
            stages: {
                contextExtraction: {
                    execute: vi.fn()
                },
                semanticContextExtraction: {
                    execute: vi.fn()
                }
            }
        };

        // Create a new ChatService instance
        chatService = new ChatService();

        // Replace the internal pipelines with our mock
        (chatService as any).pipelines.set('default', mockChatPipeline);
        (chatService as any).pipelines.set('agent', mockChatPipeline);
        (chatService as any).pipelines.set('performance', mockChatPipeline);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with default pipelines', () => {
            expect(chatService).toBeDefined();
            // Verify pipelines are created by checking internal state
            expect((chatService as any).pipelines).toBeDefined();
            expect((chatService as any).sessionCache).toBeDefined();
        });
    });

    describe('createSession', () => {
        it('should create a new chat session with default title', async () => {
            const mockChat = {
                id: 'chat-123',
                title: 'New Chat',
                messages: [],
                noteId: 'chat-123',
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: {}
            };

            mockChatStorageService.createChat.mockResolvedValueOnce(mockChat);

            const session = await chatService.createSession();

            expect(session).toEqual({
                id: 'chat-123',
                title: 'New Chat',
                messages: [],
                isStreaming: false
            });

            expect(mockChatStorageService.createChat).toHaveBeenCalledWith('New Chat', []);
        });

        it('should create a new chat session with custom title and messages', async () => {
            const initialMessages: Message[] = [
                { role: 'user', content: 'Hello' }
            ];

            const mockChat = {
                id: 'chat-456',
                title: 'Custom Chat',
                messages: initialMessages,
                noteId: 'chat-456',
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: {}
            };

            mockChatStorageService.createChat.mockResolvedValueOnce(mockChat);

            const session = await chatService.createSession('Custom Chat', initialMessages);

            expect(session).toEqual({
                id: 'chat-456',
                title: 'Custom Chat',
                messages: initialMessages,
                isStreaming: false
            });

            expect(mockChatStorageService.createChat).toHaveBeenCalledWith('Custom Chat', initialMessages);
        });
    });

    describe('getOrCreateSession', () => {
        it('should return cached session if available', async () => {
            const mockChat = {
                id: 'chat-123',
                title: 'Test Chat',
                messages: [{ role: 'user', content: 'Hello' }],
                noteId: 'chat-123',
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: {}
            };

            const cachedSession = {
                id: 'chat-123',
                title: 'Old Title',
                messages: [],
                isStreaming: false
            };

            // Pre-populate cache
            (chatService as any).sessionCache.set('chat-123', cachedSession);
            mockChatStorageService.getChat.mockResolvedValueOnce(mockChat);

            const session = await chatService.getOrCreateSession('chat-123');

            expect(session).toEqual({
                id: 'chat-123',
                title: 'Test Chat', // Should be updated from storage
                messages: [{ role: 'user', content: 'Hello' }], // Should be updated from storage
                isStreaming: false
            });

            expect(mockChatStorageService.getChat).toHaveBeenCalledWith('chat-123');
        });

        it('should load session from storage if not cached', async () => {
            const mockChat = {
                id: 'chat-123',
                title: 'Test Chat',
                messages: [{ role: 'user', content: 'Hello' }],
                noteId: 'chat-123',
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: {}
            };

            mockChatStorageService.getChat.mockResolvedValueOnce(mockChat);

            const session = await chatService.getOrCreateSession('chat-123');

            expect(session).toEqual({
                id: 'chat-123',
                title: 'Test Chat',
                messages: [{ role: 'user', content: 'Hello' }],
                isStreaming: false
            });

            expect(mockChatStorageService.getChat).toHaveBeenCalledWith('chat-123');
        });

        it('should create new session if not found', async () => {
            mockChatStorageService.getChat.mockResolvedValueOnce(null);

            const mockNewChat = {
                id: 'chat-new',
                title: 'New Chat',
                messages: [],
                noteId: 'chat-new',
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: {}
            };

            mockChatStorageService.createChat.mockResolvedValueOnce(mockNewChat);

            const session = await chatService.getOrCreateSession('nonexistent');

            expect(session).toEqual({
                id: 'chat-new',
                title: 'New Chat',
                messages: [],
                isStreaming: false
            });

            expect(mockChatStorageService.getChat).toHaveBeenCalledWith('nonexistent');
            expect(mockChatStorageService.createChat).toHaveBeenCalledWith('New Chat', []);
        });

        it('should create new session when no sessionId provided', async () => {
            const mockNewChat = {
                id: 'chat-new',
                title: 'New Chat',
                messages: [],
                noteId: 'chat-new',
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: {}
            };

            mockChatStorageService.createChat.mockResolvedValueOnce(mockNewChat);

            const session = await chatService.getOrCreateSession();

            expect(session).toEqual({
                id: 'chat-new',
                title: 'New Chat',
                messages: [],
                isStreaming: false
            });

            expect(mockChatStorageService.createChat).toHaveBeenCalledWith('New Chat', []);
        });
    });

    describe('sendMessage', () => {
        beforeEach(() => {
            const mockSession = {
                id: 'chat-123',
                title: 'Test Chat',
                messages: [],
                isStreaming: false
            };

            const mockChat = {
                id: 'chat-123',
                title: 'Test Chat',
                messages: [],
                noteId: 'chat-123',
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: {}
            };

            mockChatStorageService.getChat.mockResolvedValue(mockChat);
            mockChatStorageService.updateChat.mockResolvedValue(mockChat);

            mockChatPipeline.execute.mockResolvedValue({
                text: 'Hello! How can I help you?',
                model: 'gpt-3.5-turbo',
                provider: 'OpenAI',
                usage: { promptTokens: 10, completionTokens: 8, totalTokens: 18 }
            });
        });

        it('should send message and get AI response', async () => {
            const session = await chatService.sendMessage('chat-123', 'Hello');

            expect(session.messages).toHaveLength(2);
            expect(session.messages[0]).toEqual({
                role: 'user',
                content: 'Hello'
            });
            expect(session.messages[1]).toEqual({
                role: 'assistant',
                content: 'Hello! How can I help you?',
                tool_calls: undefined
            });

            expect(mockChatStorageService.updateChat).toHaveBeenCalledTimes(2); // Once for user message, once for complete conversation
            expect(mockChatPipeline.execute).toHaveBeenCalled();
        });

        it('should handle streaming callback', async () => {
            const streamCallback = vi.fn();

            await chatService.sendMessage('chat-123', 'Hello', {}, streamCallback);

            expect(mockChatPipeline.execute).toHaveBeenCalledWith(
                expect.objectContaining({
                    streamCallback
                })
            );
        });

        it('should update title for first message', async () => {
            const mockChat = {
                id: 'chat-123',
                title: 'New Chat',
                messages: [],
                noteId: 'chat-123',
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: {}
            };

            mockChatStorageService.getChat.mockResolvedValue(mockChat);

            await chatService.sendMessage('chat-123', 'What is the weather like?');

            // Should update title based on first message
            expect(mockChatStorageService.updateChat).toHaveBeenLastCalledWith(
                'chat-123',
                expect.any(Array),
                'What is the weather like?'
            );
        });

        it('should handle errors gracefully', async () => {
            mockChatPipeline.execute.mockRejectedValueOnce(new Error('AI service error'));

            const session = await chatService.sendMessage('chat-123', 'Hello');

            expect(session.messages).toHaveLength(2);
            expect(session.messages[1]).toEqual({
                role: 'assistant',
                content: 'Sorry, I encountered an error processing your request.'
            });

            expect(session.isStreaming).toBe(false);
            expect(mockChatStorageService.updateChat).toHaveBeenCalledWith(
                'chat-123',
                expect.arrayContaining([
                    expect.objectContaining({
                        role: 'assistant',
                        content: 'Sorry, I encountered an error processing your request.'
                    })
                ])
            );
        });

        it('should handle tool calls in response', async () => {
            const toolCalls = [{
                id: 'call_123',
                type: 'function' as const,
                function: {
                    name: 'searchNotes',
                    arguments: '{"query": "test"}'
                }
            }];

            mockChatPipeline.execute.mockResolvedValueOnce({
                text: 'I need to search for notes.',
                model: 'gpt-4',
                provider: 'OpenAI',
                tool_calls: toolCalls,
                usage: { promptTokens: 10, completionTokens: 8, totalTokens: 18 }
            });

            const session = await chatService.sendMessage('chat-123', 'Search for notes about AI');

            expect(session.messages[1]).toEqual({
                role: 'assistant',
                content: 'I need to search for notes.',
                tool_calls: toolCalls
            });
        });
    });

    describe('sendContextAwareMessage', () => {
        beforeEach(() => {
            const mockSession = {
                id: 'chat-123',
                title: 'Test Chat',
                messages: [],
                isStreaming: false
            };

            const mockChat = {
                id: 'chat-123',
                title: 'Test Chat',
                messages: [],
                noteId: 'chat-123',
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: {}
            };

            mockChatStorageService.getChat.mockResolvedValue(mockChat);
            mockChatStorageService.updateChat.mockResolvedValue(mockChat);

            mockChatPipeline.execute.mockResolvedValue({
                text: 'Based on the context, here is my response.',
                model: 'gpt-4',
                provider: 'OpenAI',
                usage: { promptTokens: 20, completionTokens: 15, totalTokens: 35 }
            });
        });

        it('should send context-aware message with note ID', async () => {
            const session = await chatService.sendContextAwareMessage(
                'chat-123',
                'What is this note about?',
                'note-456'
            );

            expect(session.messages).toHaveLength(2);
            expect(session.messages[0]).toEqual({
                role: 'user',
                content: 'What is this note about?'
            });

            expect(mockChatPipeline.execute).toHaveBeenCalledWith(
                expect.objectContaining({
                    noteId: 'note-456',
                    query: 'What is this note about?',
                    showThinking: false
                })
            );

            expect(mockChatStorageService.updateChat).toHaveBeenLastCalledWith(
                'chat-123',
                expect.any(Array),
                undefined,
                expect.objectContaining({
                    contextNoteId: 'note-456'
                })
            );
        });

        it('should use agent pipeline when showThinking is enabled', async () => {
            await chatService.sendContextAwareMessage(
                'chat-123',
                'Analyze this note',
                'note-456',
                { showThinking: true }
            );

            expect(mockChatPipeline.execute).toHaveBeenCalledWith(
                expect.objectContaining({
                    showThinking: true
                })
            );
        });

        it('should handle errors in context-aware messages', async () => {
            mockChatPipeline.execute.mockRejectedValueOnce(new Error('Context error'));

            const session = await chatService.sendContextAwareMessage(
                'chat-123',
                'What is this note about?',
                'note-456'
            );

            expect(session.messages[1]).toEqual({
                role: 'assistant',
                content: 'Sorry, I encountered an error processing the context.'
            });
        });
    });

    describe('addNoteContext', () => {
        it('should add note context to session', async () => {
            const mockSession = {
                id: 'chat-123',
                title: 'Test Chat',
                messages: [
                    { role: 'user', content: 'Tell me about AI features' }
                ],
                isStreaming: false
            };

            const mockChat = {
                id: 'chat-123',
                title: 'Test Chat',
                messages: mockSession.messages,
                noteId: 'chat-123',
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: {}
            };

            mockChatStorageService.getChat.mockResolvedValue(mockChat);
            mockChatStorageService.updateChat.mockResolvedValue(mockChat);

            // Mock the pipeline's context extraction stage
            mockChatPipeline.stages.contextExtraction.execute.mockResolvedValue({
                context: 'This note contains information about AI features...',
                sources: [
                    {
                        noteId: 'note-456',
                        title: 'AI Features',
                        similarity: 0.95,
                        content: 'AI features content'
                    }
                ]
            });

            const session = await chatService.addNoteContext('chat-123', 'note-456');

            expect(session.messages).toHaveLength(2);
            expect(session.messages[1]).toEqual({
                role: 'user',
                content: 'Context: This note contains information about AI features...'
            });

            expect(mockChatStorageService.recordSources).toHaveBeenCalledWith(
                'chat-123',
                [expect.objectContaining({
                    noteId: 'note-456',
                    title: 'AI Features',
                    similarity: 0.95,
                    content: 'AI features content'
                })]
            );
        });
    });

    describe('addSemanticNoteContext', () => {
        it('should add semantic note context to session', async () => {
            const mockSession = {
                id: 'chat-123',
                title: 'Test Chat',
                messages: [],
                isStreaming: false
            };

            const mockChat = {
                id: 'chat-123',
                title: 'Test Chat',
                messages: [],
                noteId: 'chat-123',
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: {}
            };

            mockChatStorageService.getChat.mockResolvedValue(mockChat);
            mockChatStorageService.updateChat.mockResolvedValue(mockChat);

            mockChatPipeline.stages.semanticContextExtraction.execute.mockResolvedValue({
                context: 'Semantic context about machine learning...',
                sources: []
            });

            const session = await chatService.addSemanticNoteContext(
                'chat-123',
                'note-456',
                'machine learning algorithms'
            );

            expect(session.messages).toHaveLength(1);
            expect(session.messages[0]).toEqual({
                role: 'user',
                content: 'Query: machine learning algorithms\nContext: Semantic context about machine learning...'
            });

            expect(mockChatPipeline.stages.semanticContextExtraction.execute).toHaveBeenCalledWith({
                noteId: 'note-456',
                query: 'machine learning algorithms'
            });
        });
    });

    describe('getAllSessions', () => {
        it('should return all chat sessions', async () => {
            const mockChats = [
                {
                    id: 'chat-1',
                    title: 'Chat 1',
                    messages: [{ role: 'user', content: 'Hello' }],
                    noteId: 'chat-1',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    metadata: {}
                },
                {
                    id: 'chat-2',
                    title: 'Chat 2',
                    messages: [{ role: 'user', content: 'Hi' }],
                    noteId: 'chat-2',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    metadata: {}
                }
            ];

            mockChatStorageService.getAllChats.mockResolvedValue(mockChats);

            const sessions = await chatService.getAllSessions();

            expect(sessions).toHaveLength(2);
            expect(sessions[0]).toEqual({
                id: 'chat-1',
                title: 'Chat 1',
                messages: [{ role: 'user', content: 'Hello' }],
                isStreaming: false
            });
            expect(sessions[1]).toEqual({
                id: 'chat-2',
                title: 'Chat 2',
                messages: [{ role: 'user', content: 'Hi' }],
                isStreaming: false
            });
        });

        it('should update cached sessions with latest data', async () => {
            const mockChats = [
                {
                    id: 'chat-1',
                    title: 'Updated Title',
                    messages: [{ role: 'user', content: 'Updated message' }],
                    noteId: 'chat-1',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    metadata: {}
                }
            ];

            // Pre-populate cache with old data
            (chatService as any).sessionCache.set('chat-1', {
                id: 'chat-1',
                title: 'Old Title',
                messages: [{ role: 'user', content: 'Old message' }],
                isStreaming: true
            });

            mockChatStorageService.getAllChats.mockResolvedValue(mockChats);

            const sessions = await chatService.getAllSessions();

            expect(sessions[0]).toEqual({
                id: 'chat-1',
                title: 'Updated Title',
                messages: [{ role: 'user', content: 'Updated message' }],
                isStreaming: true // Should preserve streaming state
            });
        });
    });

    describe('deleteSession', () => {
        it('should delete session from cache and storage', async () => {
            // Pre-populate cache
            (chatService as any).sessionCache.set('chat-123', {
                id: 'chat-123',
                title: 'Test Chat',
                messages: [],
                isStreaming: false
            });

            mockChatStorageService.deleteChat.mockResolvedValue(true);

            const result = await chatService.deleteSession('chat-123');

            expect(result).toBe(true);
            expect((chatService as any).sessionCache.has('chat-123')).toBe(false);
            expect(mockChatStorageService.deleteChat).toHaveBeenCalledWith('chat-123');
        });
    });

    describe('generateChatCompletion', () => {
        it('should use AI service directly for simple completion', async () => {
            const messages: Message[] = [
                { role: 'user', content: 'Hello' }
            ];

            const mockService = {
                getName: () => 'OpenAI',
                generateChatCompletion: vi.fn().mockResolvedValue({
                    text: 'Hello! How can I help?',
                    model: 'gpt-3.5-turbo',
                    provider: 'OpenAI'
                })
            };

            mockAiServiceManager.getService.mockResolvedValue(mockService);

            const result = await chatService.generateChatCompletion(messages);

            expect(result).toEqual({
                text: 'Hello! How can I help?',
                model: 'gpt-3.5-turbo',
                provider: 'OpenAI'
            });

            expect(mockService.generateChatCompletion).toHaveBeenCalledWith(messages, {});
        });

        it('should use pipeline for advanced context', async () => {
            const messages: Message[] = [
                { role: 'user', content: 'Hello' }
            ];

            const options = {
                useAdvancedContext: true,
                noteId: 'note-123'
            };

            // Mock AI service for this test
            const mockService = {
                getName: () => 'OpenAI',
                generateChatCompletion: vi.fn()
            };
            mockAiServiceManager.getService.mockResolvedValue(mockService);

            mockChatPipeline.execute.mockResolvedValue({
                text: 'Response with context',
                model: 'gpt-4',
                provider: 'OpenAI',
                tool_calls: []
            });

            const result = await chatService.generateChatCompletion(messages, options);

            expect(result).toEqual({
                text: 'Response with context',
                model: 'gpt-4',
                provider: 'OpenAI',
                tool_calls: []
            });

            expect(mockChatPipeline.execute).toHaveBeenCalledWith({
                messages,
                options,
                query: 'Hello',
                noteId: 'note-123'
            });
        });

        it('should throw error when no AI service available', async () => {
            const messages: Message[] = [
                { role: 'user', content: 'Hello' }
            ];

            mockAiServiceManager.getService.mockResolvedValue(null);

            await expect(chatService.generateChatCompletion(messages)).rejects.toThrow(
                'No AI service available'
            );
        });
    });

    describe('pipeline metrics', () => {
        it('should get pipeline metrics', () => {
            mockChatPipeline.getMetrics.mockReturnValue({ requestCount: 5 });

            const metrics = chatService.getPipelineMetrics();

            expect(metrics).toEqual({ requestCount: 5 });
            expect(mockChatPipeline.getMetrics).toHaveBeenCalled();
        });

        it('should reset pipeline metrics', () => {
            chatService.resetPipelineMetrics();

            expect(mockChatPipeline.resetMetrics).toHaveBeenCalled();
        });

        it('should handle different pipeline types', () => {
            mockChatPipeline.getMetrics.mockReturnValue({ requestCount: 3 });

            const metrics = chatService.getPipelineMetrics('agent');

            expect(metrics).toEqual({ requestCount: 3 });
        });
    });

    describe('generateTitleFromMessages', () => {
        it('should generate title from first user message', () => {
            const messages: Message[] = [
                { role: 'user', content: 'What is machine learning?' },
                { role: 'assistant', content: 'Machine learning is...' }
            ];

            // Access private method for testing
            const generateTitle = (chatService as any).generateTitleFromMessages.bind(chatService);
            const title = generateTitle(messages);

            expect(title).toBe('What is machine learning?');
        });

        it('should truncate long titles', () => {
            const messages: Message[] = [
                { role: 'user', content: 'This is a very long message that should be truncated because it exceeds the maximum length' },
                { role: 'assistant', content: 'Response' }
            ];

            const generateTitle = (chatService as any).generateTitleFromMessages.bind(chatService);
            const title = generateTitle(messages);

            expect(title).toBe('This is a very long message...');
            expect(title.length).toBe(30);
        });

        it('should return default title for empty or invalid messages', () => {
            const generateTitle = (chatService as any).generateTitleFromMessages.bind(chatService);

            expect(generateTitle([])).toBe('New Chat');
            expect(generateTitle([{ role: 'assistant', content: 'Hello' }])).toBe('New Chat');
        });

        it('should use first line for multiline messages', () => {
            const messages: Message[] = [
                { role: 'user', content: 'First line\nSecond line\nThird line' },
                { role: 'assistant', content: 'Response' }
            ];

            const generateTitle = (chatService as any).generateTitleFromMessages.bind(chatService);
            const title = generateTitle(messages);

            expect(title).toBe('First line');
        });
    });
});
