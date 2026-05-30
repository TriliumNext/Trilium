import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Replace the log subsystem with silent stubs so the test process doesn't
// touch the real file-based log writer, and so we can assert against calls.
const logStub = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
vi.mock('@triliumnext/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@triliumnext/core')>();
    return {
        ...actual,
        getLog: () => logStub
    };
});

vi.mock('./sql.js', () => ({
    getManyRows: vi.fn(),
    getValue: vi.fn(),
    getRow: vi.fn()
}));

// Mock the entire ws module instead of trying to set up the server
vi.mock('ws', () => ({
    Server: vi.fn(),
    WebSocket: {
        OPEN: 1,
        CLOSED: 3,
        CONNECTING: 0,
        CLOSING: 2
    }
}));

describe('WebSocket Service', () => {
    let wsService: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Import service after mocks are set up
        wsService = (await import('@triliumnext/core')).ws;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Message Broadcasting', () => {
        it('should handle sendMessageToAllClients method exists', () => {
            expect(wsService.sendMessageToAllClients).toBeDefined();
            expect(typeof wsService.sendMessageToAllClients).toBe('function');
        });

        it('should handle regular messages', () => {
            const message = {
                type: 'frontend-update' as const,
                data: { test: 'data' }
            };

            expect(() => {
                wsService.sendMessageToAllClients(message);
            }).not.toThrow();
        });

        it('should handle sync-failed messages', () => {
            const message = {
                type: 'sync-failed' as const,
                lastSyncedPush: 123
            };

            expect(() => {
                wsService.sendMessageToAllClients(message);
            }).not.toThrow();
        });

        it('should handle api-log-messages', () => {
            const message = {
                type: 'api-log-messages' as const,
                messages: ['test message']
            };

            expect(() => {
                wsService.sendMessageToAllClients(message);
            }).not.toThrow();
        });
    });

    describe('Service Methods', () => {
        it('should have all required methods', () => {
            expect(wsService.init).toBeDefined();
            expect(wsService.sendMessageToAllClients).toBeDefined();
            expect(wsService.syncPushInProgress).toBeDefined();
            expect(wsService.syncPullInProgress).toBeDefined();
            expect(wsService.syncFinished).toBeDefined();
            expect(wsService.syncFailed).toBeDefined();
            expect(wsService.sendTransactionEntityChangesToAllClients).toBeDefined();
            expect(wsService.setLastSyncedPush).toBeDefined();
            expect(wsService.reloadFrontend).toBeDefined();
        });

        it('should handle sync methods without errors', () => {
            expect(() => wsService.syncPushInProgress()).not.toThrow();
            expect(() => wsService.syncPullInProgress()).not.toThrow();
            expect(() => wsService.syncFinished()).not.toThrow();
            expect(() => wsService.syncFailed()).not.toThrow();
        });

        it('should handle reload frontend', () => {
            expect(() => wsService.reloadFrontend('test reason')).not.toThrow();
        });

        it('should handle transaction entity changes', () => {
            expect(() => wsService.sendTransactionEntityChangesToAllClients()).not.toThrow();
        });

        it('should handle setLastSyncedPush', () => {
            expect(() => wsService.setLastSyncedPush(123)).not.toThrow();
        });
    });

    describe('Other Message Types', () => {
        it('should handle frontend-update messages', () => {
            const message = {
                type: 'frontend-update' as const,
                data: {
                    lastSyncedPush: 100,
                    entityChanges: []
                }
            };

            expect(() => wsService.sendMessageToAllClients(message)).not.toThrow();
        });

        it('should handle ping messages', () => {
            const message = {
                type: 'ping' as const
            };

            expect(() => wsService.sendMessageToAllClients(message)).not.toThrow();
        });

        it('should handle task progress messages', () => {
            const message = {
                type: 'task-progress' as const,
                taskId: 'task-123',
                progressCount: 50
            };

            expect(() => wsService.sendMessageToAllClients(message)).not.toThrow();
        });
    });
});