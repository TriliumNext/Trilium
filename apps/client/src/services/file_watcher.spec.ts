import type { WebSocketMessage } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture the callback that file_watcher registers via ws.subscribeToMessages
// at module load. The global setup mock discards it, so we provide our own.
// These are wrapped in vi.hoisted so they exist when the hoisted vi.mock
// factories below reference them.
const { wsState, triggerEvent } = vi.hoisted(() => ({
    wsState: {
        subscribedCallback: undefined as
            | ((message: WebSocketMessage) => Promise<void> | void)
            | undefined
    },
    triggerEvent: vi.fn()
}));

vi.mock("./ws.js", () => ({
    default: {
        subscribeToMessages(callback: (message: WebSocketMessage) => void) {
            wsState.subscribedCallback = callback;
        }
    }
}));

vi.mock("../components/app_context.js", () => ({
    default: { triggerEvent }
}));

// Import AFTER the mocks are declared (vi.mock is hoisted).
import fileWatcher from "./file_watcher.js";

function makeUpdate(entityType: string, entityId: string): WebSocketMessage {
    return {
        type: "openedFileUpdated",
        entityType,
        entityId,
        lastModifiedMs: 1234,
        filePath: `/tmp/${entityId}`
    } as WebSocketMessage;
}

describe("file_watcher", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("registers a ws message subscriber on load", () => {
        expect(typeof wsState.subscribedCallback).toBe("function");
    });

    it("ignores messages that are not openedFileUpdated", async () => {
        await wsState.subscribedCallback!({ type: "ping" } as WebSocketMessage);
        expect(triggerEvent).not.toHaveBeenCalled();
    });

    it("stores the update, triggers the event, and exposes it via getFileModificationStatus", async () => {
        await wsState.subscribedCallback!(makeUpdate("notes", "noteA"));

        expect(triggerEvent).toHaveBeenCalledWith("openedFileUpdated", {
            entityType: "notes",
            entityId: "noteA",
            lastModifiedMs: 1234,
            filePath: "/tmp/noteA"
        });

        const status = fileWatcher.getFileModificationStatus("notes", "noteA");
        expect(status).toMatchObject({ entityType: "notes", entityId: "noteA" });
    });

    it("handles both notes and attachments entity types independently", async () => {
        await wsState.subscribedCallback!(makeUpdate("attachments", "attB"));
        expect(fileWatcher.getFileModificationStatus("attachments", "attB")).toMatchObject({
            entityId: "attB"
        });
        // notes bucket is unaffected.
        expect(fileWatcher.getFileModificationStatus("notes", "attB")).toBeUndefined();
    });

    it("fileModificationUploaded removes a stored status", async () => {
        await wsState.subscribedCallback!(makeUpdate("notes", "noteC"));
        expect(fileWatcher.getFileModificationStatus("notes", "noteC")).toBeDefined();

        fileWatcher.fileModificationUploaded("notes", "noteC");
        expect(fileWatcher.getFileModificationStatus("notes", "noteC")).toBeUndefined();
    });

    it("ignoreModification removes a stored status", async () => {
        await wsState.subscribedCallback!(makeUpdate("attachments", "attD"));
        expect(fileWatcher.getFileModificationStatus("attachments", "attD")).toBeDefined();

        fileWatcher.ignoreModification("attachments", "attD");
        expect(fileWatcher.getFileModificationStatus("attachments", "attD")).toBeUndefined();
    });

    it("throws on an unrecognized entity type via the public API", () => {
        expect(() => fileWatcher.getFileModificationStatus("bogus", "x")).toThrow(/Unrecognized type 'bogus'/);
        expect(() => fileWatcher.fileModificationUploaded("bogus", "x")).toThrow(/should be 'notes' or 'attachments'/);
        expect(() => fileWatcher.ignoreModification("bogus", "x")).toThrow(/Unrecognized type/);
    });

    it("propagates the unrecognized-type error from the ws handler", async () => {
        await expect(wsState.subscribedCallback!(makeUpdate("bogus", "x"))).rejects.toThrow(/Unrecognized type 'bogus'/);
        expect(triggerEvent).not.toHaveBeenCalled();
    });
});
