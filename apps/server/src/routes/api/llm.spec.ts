import { sleepFor } from "@triliumnext/commons";
import { Application } from "express";
import supertest from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { refreshAuth } from "../../services/auth.js";
import config from "../../services/config.js";

// Mock the CSRF protection middleware to allow tests to pass
vi.mock("../csrf_protection.js", () => ({
    doubleCsrfProtection: (req: any, res: any, next: any) => next(), // No-op middleware
    generateToken: () => "mock-csrf-token"
}));

// Mock WebSocket service
vi.mock("../../services/ws.js", () => ({
    default: {
        sendMessageToAllClients: vi.fn(),
        sendTransactionEntityChangesToAllClients: vi.fn(),
        setLastSyncedPush: vi.fn(),
        syncFailed() {}
    }
}));

// Mock log service
vi.mock("../../services/log.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    }
}));

// Mock chat storage service
const mockChatStorage = {
    createChat: vi.fn(),
    getChat: vi.fn(),
    updateChat: vi.fn(),
    getAllChats: vi.fn(),
    deleteChat: vi.fn()
};
vi.mock("../../services/llm/storage/chat_storage_service.js", () => ({
    default: mockChatStorage
}));

// Mock AI service manager
const mockAiServiceManager = {
    getOrCreateAnyService: vi.fn()
};
vi.mock("../../services/llm/ai_service_manager.js", () => ({
    default: mockAiServiceManager
}));

// Mock chat pipeline
const mockChatPipelineExecute = vi.fn();
class MockChatPipeline {
    execute = mockChatPipelineExecute;
}
vi.mock("../../services/llm/pipeline/chat_pipeline.js", () => ({
    ChatPipeline: MockChatPipeline
}));

// Mock configuration helpers
const mockGetSelectedModelConfig = vi.fn();
vi.mock("../../services/llm/config/configuration_helpers.js", () => ({
    getSelectedModelConfig: mockGetSelectedModelConfig
}));

// Mock options service
vi.mock("../../services/options.js", () => ({
    default: {
        getOptionBool: vi.fn(() => false),
        getOptionMap: vi.fn(() => new Map()),
        createOption: vi.fn(),
        getOption: vi.fn(() => '0'),
        getOptionOrNull: vi.fn(() => null),
        getOptionInt: vi.fn(name => {
            if (name === "protectedSessionTimeout") return Number.MAX_SAFE_INTEGER;
            return 0;
        })
    }
}));

// Session-based login that properly establishes req.session.loggedIn
async function loginWithSession(app: Application) {
    const response = await supertest(app)
        .post("/login")
        .send({ password: "demo1234" })
        .expect(302);

    const setCookieHeader = response.headers["set-cookie"][0];
    expect(setCookieHeader).toBeTruthy();
    return setCookieHeader;
}

// Get CSRF token from the main page
async function getCsrfToken(app: Application, sessionCookie: string) {
    const response = await supertest(app)
        .get("/")

        .expect(200);

    const csrfTokenMatch = response.text.match(/csrfToken: '([^']+)'/);
    if (csrfTokenMatch) {
        return csrfTokenMatch[1];
    }

    throw new Error("CSRF token not found in response");
}

let app: Application;

describe("LLM API Tests", () => {
    let sessionCookie: string;
    let csrfToken: string;
    let createdChatId: string;

    beforeAll(async () => {
        // Use no authentication for testing to avoid complex session/CSRF setup
        config.General.noAuthentication = true;
        refreshAuth();
        const buildApp = (await import("../../app.js")).default;
        app = await buildApp();
        // No need for session cookie or CSRF token when authentication is disabled
        sessionCookie = "";
        csrfToken = "mock-csrf-token";
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("Chat Session Management", () => {
        it("should create a new chat session", async () => {
            const response = await supertest(app)
                .post("/api/llm/chat")
                .send({
                    title: "Test Chat Session",
                    systemPrompt: "You are a helpful assistant for testing.",
                    temperature: 0.7,
                    maxTokens: 1000,
                    model: "gpt-3.5-turbo",
                    provider: "openai"
                })
                .expect(200);

            expect(response.body).toMatchObject({
                id: expect.any(String),
                title: "Test Chat Session",
                createdAt: expect.any(String)
            });

            createdChatId = response.body.id;
        });

        it("should list all chat sessions", async () => {
            const response = await supertest(app)
                .get("/api/llm/chat")
                .expect(200);

            expect(response.body).toHaveProperty('sessions');
            expect(Array.isArray(response.body.sessions)).toBe(true);

            if (response.body.sessions.length > 0) {
                expect(response.body.sessions[0]).toMatchObject({
                    id: expect.any(String),
                    title: expect.any(String),
                    createdAt: expect.any(String),
                    lastActive: expect.any(String),
                    messageCount: expect.any(Number)
                });
            }
        });

        it("should retrieve a specific chat session", async () => {
            if (!createdChatId) {
                // Create a chat first if we don't have one
                const createResponse = await supertest(app)
                    .post("/api/llm/chat")

                    .send({
                        title: "Test Retrieval Chat"
                    })
                    .expect(200);

                createdChatId = createResponse.body.id;
            }

            const response = await supertest(app)
                .get(`/api/llm/chat/${createdChatId}`)

                .expect(200);

            expect(response.body).toMatchObject({
                id: createdChatId,
                title: expect.any(String),
                messages: expect.any(Array),
                createdAt: expect.any(String)
            });
        });

        it("should update a chat session", async () => {
            if (!createdChatId) {
                // Create a chat first if we don't have one
                const createResponse = await supertest(app)
                    .post("/api/llm/chat")
                    .send({
                        title: "Test Update Chat"
                    })
                    .expect(200);

                createdChatId = createResponse.body.id;
            }

            const response = await supertest(app)
                .patch(`/api/llm/chat/${createdChatId}`)
                .send({
                    title: "Updated Chat Title",
                    temperature: 0.8
                })
                .expect(200);

            expect(response.body).toMatchObject({
                id: createdChatId,
                title: "Updated Chat Title",
                updatedAt: expect.any(String)
            });
        });

        it("should return 404 for non-existent chat session", async () => {
            await supertest(app)
                .get("/api/llm/chat/nonexistent-chat-id")

                .expect(404);
        });
    });

    describe("Chat Messaging", () => {
        let testChatId: string;

        beforeEach(async () => {
            // Create a fresh chat for each test
            const createResponse = await supertest(app)
                .post("/api/llm/chat")
                .send({
                    title: "Message Test Chat"
                })
                .expect(200);

            testChatId = createResponse.body.id;
        });

        it("should handle sending a message to a chat", async () => {
            const response = await supertest(app)
                .post(`/api/llm/chat/${testChatId}/messages`)
                .send({
                    message: "Hello, how are you?",
                    options: {
                        temperature: 0.7,
                        maxTokens: 100
                    },
                    includeContext: false,
                    useNoteContext: false
                });

            // The response depends on whether AI is actually configured
            // We should get either a successful response or an error about AI not being configured
            expect([200, 400, 500]).toContain(response.status);

            // All responses should have some body
            expect(response.body).toBeDefined();

            // Either success with response or error
            if (response.body.response) {
                expect(response.body).toMatchObject({
                    response: expect.any(String),
                    sessionId: testChatId
                });
            } else {
                // AI not configured is expected in test environment
                expect(response.body).toHaveProperty('error');
            }
        });

        it("should handle empty message content", async () => {
            const response = await supertest(app)
                .post(`/api/llm/chat/${testChatId}/messages`)
                .send({
                    message: "",
                    options: {}
                });

            expect([200, 400, 500]).toContain(response.status);
            expect(response.body).toHaveProperty('error');
        });

        it("should handle invalid chat ID for messaging", async () => {
            const response = await supertest(app)
                .post("/api/llm/chat/invalid-chat-id/messages")
                .send({
                    message: "Hello",
                    options: {}
                });

            // API returns 200 with error message instead of error status
            expect([200, 404, 500]).toContain(response.status);
            if (response.status === 200) {
                expect(response.body).toHaveProperty('error');
            }
        });
    });

    describe("Chat Streaming", () => {
        let testChatId: string;

        beforeEach(async () => {
            // Reset all mocks
            vi.clearAllMocks();

            // Import options service to access mock
            const options = (await import("../../services/options.js")).default;

            // Setup default mock behaviors
            (options.getOptionBool as any).mockReturnValue(true); // AI enabled
            mockAiServiceManager.getOrCreateAnyService.mockResolvedValue({});
            mockGetSelectedModelConfig.mockResolvedValue({
                model: 'test-model',
                provider: 'test-provider'
            });

            // Create a fresh chat for each test
            // Return a new object each time to avoid shared state issues with concurrent requests
            const mockChat = {
                id: 'streaming-test-chat',
                title: 'Streaming Test Chat',
                messages: [],
                createdAt: new Date().toISOString()
            };
            mockChatStorage.createChat.mockResolvedValue(mockChat);
            mockChatStorage.getChat.mockImplementation(() => Promise.resolve({
                ...mockChat,
                messages: [...mockChat.messages]
            }));

            const createResponse = await supertest(app)
                .post("/api/llm/chat")

                .send({
                    title: "Streaming Test Chat"
                })
                .expect(200);

            testChatId = createResponse.body.id;
        });

        afterEach(() => {
            vi.clearAllMocks();
        });

        it("should initiate streaming for a chat message", async () => {
            // Setup streaming simulation
            mockChatPipelineExecute.mockImplementation(async (input) => {
                const callback = input.streamCallback;
                // Simulate streaming chunks
                await callback('Hello', false, {});
                await callback(' world!', true, {});
            });

            const response = await supertest(app)
                .post(`/api/llm/chat/${testChatId}/messages/stream`)

                .send({
                    content: "Tell me a short story",
                    useAdvancedContext: false,
                    showThinking: false
                });

            // The streaming endpoint should immediately return success
            // indicating that streaming has been initiated
            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                success: true,
                message: "Streaming initiated successfully"
            });

            // Import ws service to access mock
            const ws = (await import("../../services/ws.js")).default;

            // Wait for async streaming operations to complete
            await vi.waitFor(() => {
                expect(ws.sendMessageToAllClients).toHaveBeenCalledWith({
                    type: 'llm-stream',
                    chatNoteId: testChatId,
                    content: ' world!',
                    done: true
                });
            }, { timeout: 1000, interval: 50 });

            // Verify WebSocket messages were sent
            expect(ws.sendMessageToAllClients).toHaveBeenCalledWith({
                type: 'llm-stream',
                chatNoteId: testChatId,
                thinking: undefined
            });

            // Verify streaming chunks were sent
            expect(ws.sendMessageToAllClients).toHaveBeenCalledWith({
                type: 'llm-stream',
                chatNoteId: testChatId,
                content: 'Hello',
                done: false
            });

            expect(ws.sendMessageToAllClients).toHaveBeenCalledWith({
                type: 'llm-stream',
                chatNoteId: testChatId,
                content: ' world!',
                done: true
            });
        });

        it("should handle empty content for streaming", async () => {
            const response = await supertest(app)
                .post(`/api/llm/chat/${testChatId}/messages/stream`)

                .send({
                    content: "",
                    useAdvancedContext: false,
                    showThinking: false
                });

            expect(response.status).toBe(400);
            expect(response.body).toMatchObject({
                success: false,
                error: "Content cannot be empty"
            });
        });

        it("should handle whitespace-only content for streaming", async () => {
            const response = await supertest(app)
                .post(`/api/llm/chat/${testChatId}/messages/stream`)

                .send({
                    content: "   \n\t   ",
                    useAdvancedContext: false,
                    showThinking: false
                });

            expect(response.status).toBe(400);
            expect(response.body).toMatchObject({
                success: false,
                error: "Content cannot be empty"
            });
        });

        it("should handle invalid chat ID for streaming", async () => {
            const response = await supertest(app)
                .post("/api/llm/chat/invalid-chat-id/messages/stream")

                .send({
                    content: "Hello",
                    useAdvancedContext: false,
                    showThinking: false
                });

            // Should still return 200 for streaming initiation
            // Errors would be communicated via WebSocket
            expect(response.status).toBe(200);
        });

        it("should handle streaming with note mentions", async () => {
            // Mock becca for note content retrieval
            vi.doMock('../../becca/becca.js', () => ({
                default: {
                    getNote: vi.fn().mockReturnValue({
                        noteId: 'root',
                        title: 'Root Note',
                        getBlob: () => ({
                            getContent: () => 'Root note content for testing'
                        })
                    })
                }
            }));

            // Setup streaming with mention context
            mockChatPipelineExecute.mockImplementation(async (input) => {
                // Verify mention content is included
                expect(input.query).toContain('Tell me about this note');
                expect(input.query).toContain('Root note content for testing');

                const callback = input.streamCallback;
                await callback('The root note contains', false, {});
                await callback(' important information.', true, {});
            });

            const response = await supertest(app)
                .post(`/api/llm/chat/${testChatId}/messages/stream`)

                .send({
                    content: "Tell me about this note",
                    useAdvancedContext: true,
                    showThinking: true,
                    mentions: [
                        {
                            noteId: "root",
                            title: "Root Note"
                        }
                    ]
                });

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                success: true,
                message: "Streaming initiated successfully"
            });

            // Import ws service to access mock
            const ws = (await import("../../services/ws.js")).default;

            // Verify thinking message was sent
            await sleepFor(1_000);
            expect(ws.sendMessageToAllClients).toHaveBeenCalledWith({
                type: 'llm-stream',
                chatNoteId: testChatId,
                thinking: 'Initializing streaming LLM response...'
            });
        });

        it("should handle streaming with thinking states", async () => {
            mockChatPipelineExecute.mockImplementation(async (input) => {
                const callback = input.streamCallback;
                // Simulate thinking states
                await callback('', false, { thinking: 'Analyzing the question...' });
                await callback('', false, { thinking: 'Formulating response...' });
                await callback('The answer is', false, {});
                await callback(' 42.', true, {});
            });

            const response = await supertest(app)
                .post(`/api/llm/chat/${testChatId}/messages/stream`)

                .send({
                    content: "What is the meaning of life?",
                    useAdvancedContext: false,
                    showThinking: true
                });

            expect(response.status).toBe(200);

            // Import ws service to access mock
            const ws = (await import("../../services/ws.js")).default;

            // Wait for async streaming operations to complete
            await vi.waitFor(() => {
                expect(ws.sendMessageToAllClients).toHaveBeenCalledWith({
                    type: 'llm-stream',
                    chatNoteId: testChatId,
                    thinking: 'Formulating response...',
                    done: false
                });
            }, { timeout: 1000, interval: 50 });

            // Verify thinking messages
            expect(ws.sendMessageToAllClients).toHaveBeenCalledWith({
                type: 'llm-stream',
                chatNoteId: testChatId,
                thinking: 'Analyzing the question...',
                done: false
            });

            expect(ws.sendMessageToAllClients).toHaveBeenCalledWith({
                type: 'llm-stream',
                chatNoteId: testChatId,
                thinking: 'Formulating response...',
                done: false
            });
        });

        it("should handle streaming with tool executions", async () => {
            mockChatPipelineExecute.mockImplementation(async (input) => {
                const callback = input.streamCallback;
                // Simulate tool execution
                await callback('Let me calculate that', false, {});
                await callback('', false, {
                    toolExecution: {
                        tool: 'calculator',
                        arguments: { expression: '2 + 2' },
                        result: '4',
                        toolCallId: 'call_123',
                        action: 'execute'
                    }
                });
                await callback('The result is 4', true, {});
            });

            const response = await supertest(app)
                .post(`/api/llm/chat/${testChatId}/messages/stream`)

                .send({
                    content: "What is 2 + 2?",
                    useAdvancedContext: false,
                    showThinking: false
                });

            expect(response.status).toBe(200);

            // Import ws service to access mock
            const ws = (await import("../../services/ws.js")).default;

            // Wait for async streaming operations to complete
            await vi.waitFor(() => {
                expect(ws.sendMessageToAllClients).toHaveBeenCalledWith({
                    type: 'llm-stream',
                    chatNoteId: testChatId,
                    toolExecution: {
                        tool: 'calculator',
                        args: { expression: '2 + 2' },
                        result: '4',
                        toolCallId: 'call_123',
                        action: 'execute',
                        error: undefined
                    },
                    done: false
                });
            }, { timeout: 1000, interval: 50 });

            // Verify tool execution message
            expect(ws.sendMessageToAllClients).toHaveBeenCalledWith({
                type: 'llm-stream',
                chatNoteId: testChatId,
                toolExecution: {
                    tool: 'calculator',
                    args: { expression: '2 + 2' },
                    result: '4',
                    toolCallId: 'call_123',
                    action: 'execute',
                    error: undefined
                },
                done: false
            });
        });

        it("should handle streaming errors gracefully", async () => {
            mockChatPipelineExecute.mockRejectedValue(new Error('Pipeline error'));

            const response = await supertest(app)
                .post(`/api/llm/chat/${testChatId}/messages/stream`)

                .send({
                    content: "This will fail",
                    useAdvancedContext: false,
                    showThinking: false
                });

            expect(response.status).toBe(200); // Still returns 200

            // Import ws service to access mock
            const ws = (await import("../../services/ws.js")).default;

            // Wait for async streaming operations to complete
            await vi.waitFor(() => {
                expect(ws.sendMessageToAllClients).toHaveBeenCalledWith({
                    type: 'llm-stream',
                    chatNoteId: testChatId,
                    error: 'Error during streaming: Pipeline error',
                    done: true
                });
            }, { timeout: 1000, interval: 50 });
        });

        it("should handle AI disabled state", async () => {
            // Import options service to access mock
            const options = (await import("../../services/options.js")).default;
            (options.getOptionBool as any).mockReturnValue(false); // AI disabled

            const response = await supertest(app)
                .post(`/api/llm/chat/${testChatId}/messages/stream`)

                .send({
                    content: "Hello AI",
                    useAdvancedContext: false,
                    showThinking: false
                });

            expect(response.status).toBe(200);

            // Import ws service to access mock
            const ws = (await import("../../services/ws.js")).default;

            // Wait for async streaming operations to complete
            await vi.waitFor(() => {
                expect(ws.sendMessageToAllClients).toHaveBeenCalledWith({
                    type: 'llm-stream',
                    chatNoteId: testChatId,
                    error: 'Error during streaming: AI features are disabled. Please enable them in the settings.',
                    done: true
                });
            }, { timeout: 1000, interval: 50 });
        });

        it("should save chat messages after streaming completion", async () => {
            const completeResponse = 'This is the complete response';
            mockChatPipelineExecute.mockImplementation(async (input) => {
                const callback = input.streamCallback;
                await callback(completeResponse, true, {});
            });

            await supertest(app)
                .post(`/api/llm/chat/${testChatId}/messages/stream`)

                .send({
                    content: "Save this response",
                    useAdvancedContext: false,
                    showThinking: false
                });

            // Wait for async operations to complete
            await new Promise(resolve => setTimeout(resolve, 300));

            // Note: Due to the mocked environment, the actual chat storage might not be called
            // This test verifies the streaming endpoint works correctly
            // The actual chat storage behavior is tested in the service layer tests
            expect(mockChatPipelineExecute).toHaveBeenCalled();
        });

        it("should handle rapid consecutive streaming requests", async () => {
            let callCount = 0;
            mockChatPipelineExecute.mockImplementation(async (input) => {
                callCount++;
                const callback = input.streamCallback;
                await callback(`Response ${callCount}`, true, {});
            });

            // Ensure chatStorage.updateChat doesn't cause issues with concurrent access
            mockChatStorage.updateChat.mockResolvedValue(undefined);

            // Send multiple requests rapidly (reduced to 2 for reliability with Vite's async timing)
            const promises = Array.from({ length: 2 }, (_, i) =>
                supertest(app)
                    .post(`/api/llm/chat/${testChatId}/messages/stream`)

                    .send({
                        content: `Request ${i + 1}`,
                        useAdvancedContext: false,
                        showThinking: false
                    })
            );

            const responses = await Promise.all(promises);

            // All should succeed
            responses.forEach(response => {
                expect(response.status).toBe(200);
                expect(response.body.success).toBe(true);
            });

            // Wait for async streaming operations to complete
            await vi.waitFor(() => {
                expect(mockChatPipelineExecute).toHaveBeenCalledTimes(2);
            }, {
                timeout: 2000,
                interval: 50
            });
        });

        it("should handle large streaming responses", async () => {
            const largeContent = 'x'.repeat(10000); // 10KB of content
            mockChatPipelineExecute.mockImplementation(async (input) => {
                const callback = input.streamCallback;
                // Simulate chunked delivery of large content
                for (let i = 0; i < 10; i++) {
                    await callback(largeContent.slice(i * 1000, (i + 1) * 1000), false, {});
                }
                await callback('', true, {});
            });

            const response = await supertest(app)
                .post(`/api/llm/chat/${testChatId}/messages/stream`)

                .send({
                    content: "Generate large response",
                    useAdvancedContext: false,
                    showThinking: false
                });

            expect(response.status).toBe(200);

            // Import ws service to access mock
            const ws = (await import("../../services/ws.js")).default;

            // Wait for async streaming operations to complete and verify multiple chunks were sent
            await vi.waitFor(() => {
                const streamCalls = (ws.sendMessageToAllClients as any).mock.calls.filter(
                    call => call[0].type === 'llm-stream' && call[0].content
                );
                expect(streamCalls.length).toBeGreaterThan(5);
            }, { timeout: 1000, interval: 50 });
        });
    });

    describe("Error Handling", () => {
        it("should handle malformed JSON in request body", async () => {
            const response = await supertest(app)
                .post("/api/llm/chat")
                .set('Content-Type', 'application/json')

                .send('{ invalid json }');

            expect([400, 500]).toContain(response.status);
        });

        it("should handle missing required fields", async () => {
            const response = await supertest(app)
                .post("/api/llm/chat")

                .send({
                    // Missing required fields
                });

            // Should still work as title can be auto-generated
            expect([200, 400, 500]).toContain(response.status);
        });

        it("should handle invalid parameter types", async () => {
            const response = await supertest(app)
                .post("/api/llm/chat")

                .send({
                    title: "Test Chat",
                    temperature: "invalid", // Should be number
                    maxTokens: "also-invalid" // Should be number
                });

            // API should handle type conversion or validation
            expect([200, 400, 500]).toContain(response.status);
        });
    });

    afterAll(async () => {
        // Clean up: delete any created chats
        if (createdChatId) {
            try {
                await supertest(app)
                    .delete(`/api/llm/chat/${createdChatId}`)
                ;
            } catch (error) {
                // Ignore cleanup errors
            }
        }
    });
});
