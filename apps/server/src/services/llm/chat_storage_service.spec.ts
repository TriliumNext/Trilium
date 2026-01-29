import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatStorageService, type StoredChat } from './chat_storage_service.js';
import type { Message } from './ai_interface.js';

// Mock dependencies
vi.mock('../notes.js', () => ({
    default: {
        createNewNote: vi.fn()
    }
}));

vi.mock('../sql.js', () => ({
    default: {
        getRow: vi.fn(),
        getRows: vi.fn(),
        execute: vi.fn()
    }
}));

vi.mock('../attributes.js', () => ({
    default: {
        createLabel: vi.fn()
    }
}));

vi.mock('../log.js', () => ({
    default: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
    }
}));

vi.mock('i18next', () => ({
    t: vi.fn((key: string) => {
        switch (key) {
            case 'ai.chat.root_note_title':
                return 'AI Chats';
            case 'ai.chat.root_note_content':
                return 'This note contains all AI chat conversations.';
            case 'ai.chat.new_chat_title':
                return 'New Chat';
            default:
                return key;
        }
    })
}));

describe('ChatStorageService', () => {
    let chatStorageService: ChatStorageService;
    let mockNotes: any;
    let mockSql: any;
    let mockAttributes: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        chatStorageService = new ChatStorageService();

        // Get mocked modules
        mockNotes = (await import('../notes.js')).default;
        mockSql = (await import('../sql.js')).default;
        mockAttributes = (await import('../attributes.js')).default;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('getOrCreateChatRoot', () => {
        it('should return existing chat root if it exists', async () => {
            mockSql.getRow.mockResolvedValueOnce({ noteId: 'existing-root-123' });

            const rootId = await chatStorageService.getOrCreateChatRoot();

            expect(rootId).toBe('existing-root-123');
            expect(mockSql.getRow).toHaveBeenCalledWith(
                'SELECT noteId FROM attributes WHERE name = ? AND value = ?',
                ['label', 'triliumChatRoot']
            );
        });

        it('should create new chat root if it does not exist', async () => {
            mockSql.getRow.mockResolvedValueOnce(null);
            mockNotes.createNewNote.mockReturnValueOnce({
                note: { noteId: 'new-root-123' }
            });

            const rootId = await chatStorageService.getOrCreateChatRoot();

            expect(rootId).toBe('new-root-123');
            expect(mockNotes.createNewNote).toHaveBeenCalledWith({
                parentNoteId: 'root',
                title: 'AI Chats',
                type: 'text',
                content: 'This note contains all AI chat conversations.'
            });
            expect(mockAttributes.createLabel).toHaveBeenCalledWith(
                'new-root-123',
                'triliumChatRoot',
                ''
            );
        });
    });

    describe('createChat', () => {
        it('should create a new chat with default title', async () => {
            const mockDate = new Date('2024-01-01T00:00:00Z');
            vi.useFakeTimers();
            vi.setSystemTime(mockDate);

            mockSql.getRow.mockResolvedValueOnce({ noteId: 'root-123' });
            mockNotes.createNewNote.mockReturnValueOnce({
                note: { noteId: 'chat-123' }
            });

            const messages: Message[] = [
                { role: 'user', content: 'Hello' }
            ];

            const result = await chatStorageService.createChat('Test Chat', messages);

            expect(result).toEqual({
                id: 'chat-123',
                title: 'Test Chat',
                messages,
                noteId: 'chat-123',
                createdAt: mockDate,
                updatedAt: mockDate,
                metadata: {}
            });

            expect(mockNotes.createNewNote).toHaveBeenCalledWith({
                parentNoteId: 'root-123',
                title: 'Test Chat',
                type: 'code',
                mime: 'application/json',
                content: JSON.stringify({
                    messages,
                    metadata: {},
                    createdAt: mockDate,
                    updatedAt: mockDate
                }, null, 2)
            });

            expect(mockAttributes.createLabel).toHaveBeenCalledWith(
                'chat-123',
                'triliumChat',
                ''
            );

            vi.useRealTimers();
        });

        it('should create chat with custom metadata', async () => {
            mockSql.getRow.mockResolvedValueOnce({ noteId: 'root-123' });
            mockNotes.createNewNote.mockReturnValueOnce({
                note: { noteId: 'chat-123' }
            });

            const metadata = {
                model: 'gpt-4',
                provider: 'openai',
                temperature: 0.7
            };

            const result = await chatStorageService.createChat('Test Chat', [], metadata);

            expect(result.metadata).toEqual(metadata);
        });

        it('should generate default title if none provided', async () => {
            mockSql.getRow.mockResolvedValueOnce({ noteId: 'root-123' });
            mockNotes.createNewNote.mockReturnValueOnce({
                note: { noteId: 'chat-123' }
            });

            const result = await chatStorageService.createChat('');

            expect(result.title).toContain('New Chat');
            expect(result.title).toMatch(/\d{4}/);
        });
    });

    describe('getAllChats', () => {
        it('should return all chats with parsed content', async () => {
            const mockChats = [
                {
                    noteId: 'chat-1',
                    title: 'Chat 1',
                    dateCreated: '2024-01-01T00:00:00Z',
                    dateModified: '2024-01-01T01:00:00Z',
                    content: JSON.stringify({
                        messages: [{ role: 'user', content: 'Hello' }],
                        metadata: { model: 'gpt-4' },
                        createdAt: '2024-01-01T00:00:00Z',
                        updatedAt: '2024-01-01T01:00:00Z'
                    })
                },
                {
                    noteId: 'chat-2',
                    title: 'Chat 2',
                    dateCreated: '2024-01-02T00:00:00Z',
                    dateModified: '2024-01-02T01:00:00Z',
                    content: JSON.stringify({
                        messages: [{ role: 'user', content: 'Hi' }],
                        metadata: { provider: 'anthropic' }
                    })
                }
            ];

            mockSql.getRows.mockResolvedValueOnce(mockChats);

            const result = await chatStorageService.getAllChats();

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                id: 'chat-1',
                title: 'Chat 1',
                messages: [{ role: 'user', content: 'Hello' }],
                noteId: 'chat-1',
                createdAt: new Date('2024-01-01T00:00:00Z'),
                updatedAt: new Date('2024-01-01T01:00:00Z'),
                metadata: { model: 'gpt-4' }
            });

            expect(mockSql.getRows).toHaveBeenCalledWith(
                expect.stringContaining('SELECT notes.noteId, notes.title'),
                ['label', 'triliumChat']
            );
            expect(mockSql.getRows).toHaveBeenCalledWith(
                expect.stringContaining('notes.isDeleted = 0'),
                ['label', 'triliumChat']
            );
        });

        it('should handle chats with invalid JSON content', async () => {
            const mockChats = [
                {
                    noteId: 'chat-1',
                    title: 'Chat 1',
                    dateCreated: '2024-01-01T00:00:00Z',
                    dateModified: '2024-01-01T01:00:00Z',
                    content: 'invalid json'
                }
            ];

            mockSql.getRows.mockResolvedValueOnce(mockChats);
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const result = await chatStorageService.getAllChats();

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                id: 'chat-1',
                title: 'Chat 1',
                messages: [],
                noteId: 'chat-1',
                createdAt: new Date('2024-01-01T00:00:00Z'),
                updatedAt: new Date('2024-01-01T01:00:00Z'),
                metadata: {}
            });

            expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to parse chat content:', expect.any(Error));
            consoleErrorSpy.mockRestore();
        });
    });

    describe('getChat', () => {
        it('should return specific chat by ID', async () => {
            const mockChat = {
                noteId: 'chat-123',
                title: 'Test Chat',
                dateCreated: '2024-01-01T00:00:00Z',
                dateModified: '2024-01-01T01:00:00Z',
                content: JSON.stringify({
                    messages: [{ role: 'user', content: 'Hello' }],
                    metadata: { model: 'gpt-4' },
                    createdAt: '2024-01-01T00:00:00Z',
                    updatedAt: '2024-01-01T01:00:00Z'
                })
            };

            mockSql.getRow.mockResolvedValueOnce(mockChat);

            const result = await chatStorageService.getChat('chat-123');

            expect(result).toEqual({
                id: 'chat-123',
                title: 'Test Chat',
                messages: [{ role: 'user', content: 'Hello' }],
                noteId: 'chat-123',
                createdAt: new Date('2024-01-01T00:00:00Z'),
                updatedAt: new Date('2024-01-01T01:00:00Z'),
                metadata: { model: 'gpt-4' }
            });

            expect(mockSql.getRow).toHaveBeenCalledWith(
                expect.stringContaining('notes.isDeleted = 0'),
                ['chat-123']
            );
        });

        it('should return null if chat not found or deleted', async () => {
            mockSql.getRow.mockResolvedValueOnce(null);

            const result = await chatStorageService.getChat('nonexistent');

            expect(result).toBeNull();
        });
    });

    describe('updateChat', () => {
        it('should update chat messages and metadata', async () => {
            const existingChat: StoredChat = {
                id: 'chat-123',
                title: 'Test Chat',
                messages: [{ role: 'user' as const, content: 'Hello' }],
                noteId: 'chat-123',
                createdAt: new Date('2024-01-01T00:00:00Z'),
                updatedAt: new Date('2024-01-01T01:00:00Z'),
                metadata: { model: 'gpt-4' }
            };

            const newMessages: Message[] = [
                { role: 'user', content: 'Hello' },
                { role: 'assistant', content: 'Hi there!' }
            ];

            const newMetadata = { provider: 'openai', temperature: 0.7 };

            // Mock getChat to return existing chat
            vi.spyOn(chatStorageService, 'getChat').mockResolvedValueOnce(existingChat);

            const mockDate = new Date('2024-01-01T02:00:00Z');
            vi.useFakeTimers();
            vi.setSystemTime(mockDate);

            const result = await chatStorageService.updateChat(
                'chat-123',
                newMessages,
                'Updated Title',
                newMetadata
            );

            expect(result).toEqual({
                ...existingChat,
                title: 'Updated Title',
                messages: newMessages,
                updatedAt: mockDate,
                metadata: { model: 'gpt-4', provider: 'openai', temperature: 0.7 }
            });

            expect(mockSql.execute).toHaveBeenCalledWith(
                'UPDATE blobs SET content = ? WHERE blobId = (SELECT blobId FROM notes WHERE noteId = ?)',
                [
                    JSON.stringify({
                        messages: newMessages,
                        metadata: { model: 'gpt-4', provider: 'openai', temperature: 0.7 },
                        createdAt: existingChat.createdAt,
                        updatedAt: mockDate
                    }, null, 2),
                    'chat-123'
                ]
            );

            expect(mockSql.execute).toHaveBeenCalledWith(
                'UPDATE notes SET title = ? WHERE noteId = ?',
                ['Updated Title', 'chat-123']
            );

            vi.useRealTimers();
        });

        it('should return null if chat not found', async () => {
            vi.spyOn(chatStorageService, 'getChat').mockResolvedValueOnce(null);

            const result = await chatStorageService.updateChat(
                'nonexistent',
                [],
                'Title'
            );

            expect(result).toBeNull();
        });
    });

    describe('deleteChat', () => {
        it('should mark chat as deleted', async () => {
            const result = await chatStorageService.deleteChat('chat-123');

            expect(result).toBe(true);
            expect(mockSql.execute).toHaveBeenCalledWith(
                'UPDATE notes SET isDeleted = 1 WHERE noteId = ?',
                ['chat-123']
            );
        });

        it('should return false on SQL error', async () => {
            mockSql.execute.mockRejectedValueOnce(new Error('SQL error'));
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const result = await chatStorageService.deleteChat('chat-123');

            expect(result).toBe(false);
            expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to delete chat:', expect.any(Error));
            consoleErrorSpy.mockRestore();
        });
    });

    describe('recordToolExecution', () => {
        it('should record tool execution in chat metadata', async () => {
            const existingChat = {
                id: 'chat-123',
                title: 'Test Chat',
                messages: [],
                noteId: 'chat-123',
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: {}
            };

            vi.spyOn(chatStorageService, 'getChat').mockResolvedValueOnce(existingChat);
            vi.spyOn(chatStorageService, 'updateChat').mockResolvedValueOnce(existingChat);

            const result = await chatStorageService.recordToolExecution(
                'chat-123',
                'searchNotes',
                'tool-123',
                { query: 'test' },
                'Found 3 notes'
            );

            expect(result).toBe(true);
            expect(chatStorageService.updateChat).toHaveBeenCalledWith(
                'chat-123',
                [],
                undefined,
                expect.objectContaining({
                    toolExecutions: expect.arrayContaining([
                        expect.objectContaining({
                            id: 'tool-123',
                            name: 'searchNotes',
                            arguments: { query: 'test' },
                            result: 'Found 3 notes'
                        })
                    ])
                })
            );
        });

        it('should return false if chat not found', async () => {
            vi.spyOn(chatStorageService, 'getChat').mockResolvedValueOnce(null);

            const result = await chatStorageService.recordToolExecution(
                'nonexistent',
                'searchNotes',
                'tool-123',
                { query: 'test' },
                'Result'
            );

            expect(result).toBe(false);
        });
    });

    describe('recordSources', () => {
        it('should record sources in chat metadata', async () => {
            const existingChat = {
                id: 'chat-123',
                title: 'Test Chat',
                messages: [],
                noteId: 'chat-123',
                createdAt: new Date(),
                updatedAt: new Date(),
                metadata: {}
            };

            const sources = [
                {
                    noteId: 'note-1',
                    title: 'Source Note 1',
                    similarity: 0.95
                },
                {
                    noteId: 'note-2',
                    title: 'Source Note 2',
                    similarity: 0.87
                }
            ];

            vi.spyOn(chatStorageService, 'getChat').mockResolvedValueOnce(existingChat);
            vi.spyOn(chatStorageService, 'updateChat').mockResolvedValueOnce(existingChat);

            const result = await chatStorageService.recordSources('chat-123', sources);

            expect(result).toBe(true);
            expect(chatStorageService.updateChat).toHaveBeenCalledWith(
                'chat-123',
                [],
                undefined,
                expect.objectContaining({
                    sources
                })
            );
        });
    });

    describe('extractToolExecutionsFromMessages', () => {
        it('should extract tool executions from assistant messages with tool calls', async () => {
            const messages: Message[] = [
                {
                    role: 'assistant',
                    content: 'I need to search for notes.',
                    tool_calls: [
                        {
                            id: 'call_123',
                            type: 'function',
                            function: {
                                name: 'searchNotes',
                                arguments: '{"query": "test"}'
                            }
                        }
                    ]
                },
                {
                    role: 'tool',
                    content: 'Found 2 notes',
                    tool_call_id: 'call_123'
                },
                {
                    role: 'assistant',
                    content: 'Based on the search results...'
                }
            ];

            // Access private method through any cast for testing
            const extractToolExecutions = (chatStorageService as any).extractToolExecutionsFromMessages.bind(chatStorageService);
            const toolExecutions = extractToolExecutions(messages, []);

            expect(toolExecutions).toHaveLength(1);
            expect(toolExecutions[0]).toEqual(
                expect.objectContaining({
                    id: 'call_123',
                    name: 'searchNotes',
                    arguments: { query: 'test' },
                    result: 'Found 2 notes',
                    timestamp: expect.any(Date)
                })
            );
        });

        it('should handle error responses from tools', async () => {
            const messages: Message[] = [
                {
                    role: 'assistant',
                    content: 'I need to search for notes.',
                    tool_calls: [
                        {
                            id: 'call_123',
                            type: 'function',
                            function: {
                                name: 'searchNotes',
                                arguments: '{"query": "test"}'
                            }
                        }
                    ]
                },
                {
                    role: 'tool',
                    content: 'Error: Search service unavailable',
                    tool_call_id: 'call_123'
                }
            ];

            const extractToolExecutions = (chatStorageService as any).extractToolExecutionsFromMessages.bind(chatStorageService);
            const toolExecutions = extractToolExecutions(messages, []);

            expect(toolExecutions).toHaveLength(1);
            expect(toolExecutions[0]).toEqual(
                expect.objectContaining({
                    id: 'call_123',
                    name: 'searchNotes',
                    error: 'Search service unavailable',
                    result: 'Error: Search service unavailable'
                })
            );
        });

        it('should not duplicate existing tool executions', async () => {
            const existingToolExecutions = [
                {
                    id: 'call_123',
                    name: 'searchNotes',
                    arguments: { query: 'existing' },
                    result: 'Previous result',
                    timestamp: new Date()
                }
            ];

            const messages: Message[] = [
                {
                    role: 'assistant',
                    content: 'I need to search for notes.',
                    tool_calls: [
                        {
                            id: 'call_123', // Same ID as existing
                            type: 'function',
                            function: {
                                name: 'searchNotes',
                                arguments: '{"query": "test"}'
                            }
                        }
                    ]
                },
                {
                    role: 'tool',
                    content: 'Found 2 notes',
                    tool_call_id: 'call_123'
                }
            ];

            const extractToolExecutions = (chatStorageService as any).extractToolExecutionsFromMessages.bind(chatStorageService);
            const toolExecutions = extractToolExecutions(messages, existingToolExecutions);

            expect(toolExecutions).toHaveLength(1);
            expect(toolExecutions[0].arguments).toEqual({ query: 'existing' });
        });
    });
});
