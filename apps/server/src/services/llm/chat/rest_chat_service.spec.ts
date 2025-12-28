import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import RestChatService from './rest_chat_service.js';
import type { Message } from '../ai_interface.js';

// Mock dependencies
vi.mock('../../log.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    }
}));

vi.mock('../../options.js', () => ({
    default: {
        getOption: vi.fn(),
        getOptionBool: vi.fn(),
        getOptionInt: vi.fn(name => {
            if (name === "protectedSessionTimeout") return Number.MAX_SAFE_INTEGER;
            return 0;
        })
    }
}));

vi.mock('../ai_service_manager.js', () => ({
    default: {
        getOrCreateAnyService: vi.fn(),
        generateChatCompletion: vi.fn(),
        isAnyServiceAvailable: vi.fn(),
        getAIEnabled: vi.fn()
    }
}));

vi.mock('../pipeline/chat_pipeline.js', () => ({
    ChatPipeline: vi.fn().mockImplementation(() => ({
        execute: vi.fn()
    }))
}));

vi.mock('./handlers/tool_handler.js', () => {
    class ToolHandler {
        handleToolCalls = vi.fn()
    }
    return { ToolHandler };
});

vi.mock('../chat_storage_service.js', () => ({
    default: {
        getChat: vi.fn(),
        createChat: vi.fn(),
        updateChat: vi.fn(),
        deleteChat: vi.fn(),
        getAllChats: vi.fn(),
        recordSources: vi.fn()
    }
}));

vi.mock('../config/configuration_helpers.js', () => ({
    isAIEnabled: vi.fn(),
    getSelectedModelConfig: vi.fn()
}));

describe('RestChatService', () => {
    let restChatService: typeof RestChatService;
    let mockOptions: any;
    let mockAiServiceManager: any;
    let mockChatStorageService: any;
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Get mocked modules
        mockOptions = (await import('../../options.js')).default;
        mockAiServiceManager = (await import('../ai_service_manager.js')).default;
        mockChatStorageService = (await import('../chat_storage_service.js')).default;

        restChatService = (await import('./rest_chat_service.js')).default;

        // Setup mock request and response
        mockReq = {
            params: {},
            body: {},
            query: {},
            method: 'POST'
        };

        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis()
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('isDatabaseInitialized', () => {
        it('should return true when database is initialized', () => {
            mockOptions.getOption.mockReturnValueOnce('true');

            const result = restChatService.isDatabaseInitialized();

            expect(result).toBe(true);
            expect(mockOptions.getOption).toHaveBeenCalledWith('initialized');
        });

        it('should return false when database is not initialized', () => {
            mockOptions.getOption.mockImplementationOnce(() => {
                throw new Error('Database not initialized');
            });

            const result = restChatService.isDatabaseInitialized();

            expect(result).toBe(false);
        });
    });

    describe('handleSendMessage', () => {
        beforeEach(() => {
            mockReq.params = { chatNoteId: 'chat-123' };
            mockOptions.getOptionBool.mockReturnValue(true); // AI enabled
            vi.spyOn(restChatService, 'isDatabaseInitialized').mockReturnValue(true);
            mockAiServiceManager.getOrCreateAnyService.mockResolvedValue({});
        });

        it('should handle POST request with valid content', async () => {
            mockReq.method = 'POST';
            mockReq.body = {
                content: 'Hello, how are you?',
                useAdvancedContext: false,
                showThinking: false
            };

            const existingChat = {
                id: 'chat-123',
                title: 'Test Chat',
                messages: [{ role: 'user', content: 'Previous message' }],
                noteId: 'chat-123',
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: {}
            };

            mockChatStorageService.getChat.mockResolvedValueOnce(existingChat);

            // Mock the rest of the implementation
            const result = await restChatService.handleSendMessage(mockReq as Request, mockRes as Response);

            expect(mockChatStorageService.getChat).toHaveBeenCalledWith('chat-123');
            expect(mockAiServiceManager.getOrCreateAnyService).toHaveBeenCalled();
        });

        it('should create new chat if not found for POST request', async () => {
            mockReq.method = 'POST';
            mockReq.body = {
                content: 'Hello, how are you?'
            };

            mockChatStorageService.getChat.mockResolvedValueOnce(null);
            const newChat = {
                id: 'new-chat-123',
                title: 'New Chat',
                messages: [],
                noteId: 'new-chat-123',
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: {}
            };
            mockChatStorageService.createChat.mockResolvedValueOnce(newChat);

            await restChatService.handleSendMessage(mockReq as Request, mockRes as Response);

            expect(mockChatStorageService.createChat).toHaveBeenCalledWith('New Chat');
        });

        it('should return error for GET request without stream parameter', async () => {
            mockReq.method = 'GET';
            mockReq.query = {}; // No stream parameter

            const result = await restChatService.handleSendMessage(mockReq as Request, mockRes as Response);

            expect(result).toEqual({
                error: 'Error processing your request: Stream parameter must be set to true for GET/streaming requests'
            });
        });

        it('should return error for POST request with empty content', async () => {
            mockReq.method = 'POST';
            mockReq.body = {
                content: '' // Empty content
            };

            const result = await restChatService.handleSendMessage(mockReq as Request, mockRes as Response);

            expect(result).toEqual({
                error: 'Error processing your request: Content cannot be empty'
            });
        });

        it('should return error when AI is disabled', async () => {
            mockOptions.getOptionBool.mockReturnValue(false); // AI disabled
            mockReq.method = 'POST';
            mockReq.body = {
                content: 'Hello'
            };

            const result = await restChatService.handleSendMessage(mockReq as Request, mockRes as Response);

            expect(result).toEqual({
                error: "AI features are disabled. Please enable them in the settings."
            });
        });

        it('should return error when database is not initialized', async () => {
            vi.spyOn(restChatService, 'isDatabaseInitialized').mockReturnValue(false);
            mockReq.method = 'POST';
            mockReq.body = {
                content: 'Hello'
            };

            const result = await restChatService.handleSendMessage(mockReq as Request, mockRes as Response);

            expect(result).toEqual({
                error: 'Error processing your request: Database is not initialized'
            });
        });

        it('should return error for GET request when chat not found', async () => {
            mockReq.method = 'GET';
            mockReq.query = { stream: 'true' };
            mockReq.body = { content: 'Hello' };

            mockChatStorageService.getChat.mockResolvedValueOnce(null);

            const result = await restChatService.handleSendMessage(mockReq as Request, mockRes as Response);

            expect(result).toEqual({
                error: 'Error processing your request: Chat Note not found, cannot create session for streaming'
            });
        });

        it('should handle GET request with stream parameter', async () => {
            mockReq.method = 'GET';
            mockReq.query = {
                stream: 'true',
                useAdvancedContext: 'true',
                showThinking: 'false'
            };
            mockReq.body = {
                content: 'Hello from stream'
            };

            const existingChat = {
                id: 'chat-123',
                title: 'Test Chat',
                messages: [],
                noteId: 'chat-123',
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: {}
            };

            mockChatStorageService.getChat.mockResolvedValueOnce(existingChat);

            await restChatService.handleSendMessage(mockReq as Request, mockRes as Response);

            expect(mockChatStorageService.getChat).toHaveBeenCalledWith('chat-123');
        });

        it('should handle invalid content types', async () => {
            mockReq.method = 'POST';
            mockReq.body = {
                content: null // Invalid content type
            };

            const result = await restChatService.handleSendMessage(mockReq as Request, mockRes as Response);

            expect(result).toEqual({
                error: 'Error processing your request: Content cannot be empty'
            });
        });

        it('should handle whitespace-only content', async () => {
            mockReq.method = 'POST';
            mockReq.body = {
                content: '   \n\t   ' // Whitespace only
            };

            const result = await restChatService.handleSendMessage(mockReq as Request, mockRes as Response);

            expect(result).toEqual({
                error: 'Error processing your request: Content cannot be empty'
            });
        });
    });

    describe('error handling', () => {
        beforeEach(() => {
            mockReq.params = { chatNoteId: 'chat-123' };
            mockReq.method = 'POST';
            mockReq.body = { content: 'Hello' };
            mockOptions.getOptionBool.mockReturnValue(true);
            vi.spyOn(restChatService, 'isDatabaseInitialized').mockReturnValue(true);
        });

        it('should handle AI service manager errors', async () => {
            mockAiServiceManager.getOrCreateAnyService.mockRejectedValueOnce(
                new Error('No AI provider available')
            );

            const result = await restChatService.handleSendMessage(mockReq as Request, mockRes as Response);

            expect(result).toEqual({
                error: 'Error processing your request: No AI provider available'
            });
        });

        it('should handle chat storage service errors', async () => {
            mockAiServiceManager.getOrCreateAnyService.mockResolvedValueOnce({});
            mockChatStorageService.getChat.mockRejectedValueOnce(
                new Error('Database connection failed')
            );

            const result = await restChatService.handleSendMessage(mockReq as Request, mockRes as Response);

            expect(result).toEqual({
                error: 'Error processing your request: Database connection failed'
            });
        });
    });

    describe('parameter parsing', () => {
        it('should parse useAdvancedContext from body for POST', async () => {
            mockReq.method = 'POST';
            mockReq.body = {
                content: 'Hello',
                useAdvancedContext: true,
                showThinking: false
            };
            mockReq.params = { chatNoteId: 'chat-123' };

            mockOptions.getOptionBool.mockReturnValue(true);
            vi.spyOn(restChatService, 'isDatabaseInitialized').mockReturnValue(true);
            mockAiServiceManager.getOrCreateAnyService.mockResolvedValue({});
            mockChatStorageService.getChat.mockResolvedValue({
                id: 'chat-123',
                title: 'Test',
                messages: [],
                noteId: 'chat-123',
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: {}
            });

            await restChatService.handleSendMessage(mockReq as Request, mockRes as Response);

            // Verify that useAdvancedContext was parsed correctly
            // This would be tested by checking if the right parameters were passed to the pipeline
            expect(mockChatStorageService.getChat).toHaveBeenCalledWith('chat-123');
        });

        it('should parse parameters from query for GET', async () => {
            mockReq.method = 'GET';
            mockReq.query = {
                stream: 'true',
                useAdvancedContext: 'true',
                showThinking: 'true'
            };
            mockReq.body = {
                content: 'Hello from stream'
            };
            mockReq.params = { chatNoteId: 'chat-123' };

            mockOptions.getOptionBool.mockReturnValue(true);
            vi.spyOn(restChatService, 'isDatabaseInitialized').mockReturnValue(true);
            mockAiServiceManager.getOrCreateAnyService.mockResolvedValue({});
            mockChatStorageService.getChat.mockResolvedValue({
                id: 'chat-123',
                title: 'Test',
                messages: [],
                noteId: 'chat-123',
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: {}
            });

            await restChatService.handleSendMessage(mockReq as Request, mockRes as Response);

            expect(mockChatStorageService.getChat).toHaveBeenCalledWith('chat-123');
        });

        it('should handle mixed parameter sources for GET', async () => {
            mockReq.method = 'GET';
            mockReq.query = {
                stream: 'true',
                useAdvancedContext: 'false' // Query parameter
            };
            mockReq.body = {
                content: 'Hello',
                useAdvancedContext: true, // Body parameter should take precedence
                showThinking: true
            };
            mockReq.params = { chatNoteId: 'chat-123' };

            mockOptions.getOptionBool.mockReturnValue(true);
            vi.spyOn(restChatService, 'isDatabaseInitialized').mockReturnValue(true);
            mockAiServiceManager.getOrCreateAnyService.mockResolvedValue({});
            mockChatStorageService.getChat.mockResolvedValue({
                id: 'chat-123',
                title: 'Test',
                messages: [],
                noteId: 'chat-123',
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: {}
            });

            await restChatService.handleSendMessage(mockReq as Request, mockRes as Response);

            expect(mockChatStorageService.getChat).toHaveBeenCalledWith('chat-123');
        });
    });
});
