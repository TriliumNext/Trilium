import type { WebSocketMessage } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture the callback that file_watcher registers via ws.subscribeToMessages
// at module load. The global setup mock discards it, so we provide our own.
const { wsState } = vi.hoisted(() => ({
    wsState: {
        subscribedCallback: undefined as
            | ((message: WebSocketMessage) => Promise<void> | void)
            | undefined
    }
}));

vi.mock("./ws.js", () => ({
    default: {
        subscribeToMessages(callback: (message: WebSocketMessage) => void) {
            wsState.subscribedCallback = callback;
        }
    }
}));

import froca from "./froca.js";
import server from "./server.js";
import toast, { type ToastOptionsWithRequiredId } from "./toast.js";
// Import AFTER the mocks are declared (vi.mock is hoisted).
import { watchOpenedFile } from "./file_watcher.js";

function makeUpdate(entityType: string, entityId: string): WebSocketMessage {
    return {
        type: "openedFileUpdated",
        entityType,
        entityId,
        lastModifiedMs: 1234,
        filePath: `/tmp/${entityId}`
    } as WebSocketMessage;
}

async function receive(message: WebSocketMessage) {
    const callback = wsState.subscribedCallback;
    if (!callback) throw new Error("file_watcher did not subscribe to ws messages");
    await callback(message);
}

function lastToast(): ToastOptionsWithRequiredId {
    const call = vi.mocked(toast.showPersistent).mock.lastCall;
    if (!call) throw new Error("no toast shown");
    return call[0];
}

describe("file_watcher", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(toast, "showPersistent").mockImplementation(() => {});
    });

    it("ignores messages other than openedFileUpdated", async () => {
        await receive({ type: "ping" } as WebSocketMessage);
        expect(toast.showPersistent).not.toHaveBeenCalled();
    });

    it("offers to upload a changed note file, one toast per note", async () => {
        watchOpenedFile("/tmp/noteA");
        const post = vi.spyOn(server, "post").mockResolvedValue(undefined);
        await receive(makeUpdate("notes", "noteA"));

        const shown = lastToast();
        expect(shown.id).toBe("opened-file-updated-notes-noteA");
        expect(shown.timeout).toBeUndefined();
        expect(shown.notes).toEqual([ "noteA" ]);
        expect(shown.buttons).toHaveLength(2);

        const [ upload, ignore ] = shown.buttons ?? [];
        const dismissToast = vi.fn();
        await upload.onClick({ dismissToast });
        expect(post).toHaveBeenCalledWith("notes/noteA/upload-modified-file", { filePath: "/tmp/noteA" });
        expect(dismissToast).toHaveBeenCalledOnce();

        dismissToast.mockClear();
        await ignore.onClick({ dismissToast });
        expect(post).toHaveBeenCalledOnce();
        expect(dismissToast).toHaveBeenCalledOnce();
    });

    it("links an attachment's toast to its owner note", async () => {
        vi.spyOn(froca, "getAttachment").mockResolvedValue({ ownerId: "owner1", title: "photo.png" } as never);
        watchOpenedFile("/tmp/attB");
        await receive(makeUpdate("attachments", "attB"));

        const shown = lastToast();
        expect(shown.id).toBe("opened-file-updated-attachments-attB");
        expect(shown.notes).toEqual([ { noteId: "owner1", description: "photo.png" } ]);
    });

    it("shows an attachment's toast without a note link when the attachment is gone", async () => {
        vi.spyOn(froca, "getAttachment").mockResolvedValue(null);
        watchOpenedFile("/tmp/attGone");
        await receive(makeUpdate("attachments", "attGone"));

        const shown = lastToast();
        expect(shown.id).toBe("opened-file-updated-attachments-attGone");
        expect(shown.notes).toBeUndefined();
    });

    it("leaves a file opened from another window to that window", async () => {
        await receive(makeUpdate("notes", "otherWindowNote"));
        expect(toast.showPersistent).not.toHaveBeenCalled();
    });

    it("rejects an unrecognized entity type without showing a toast", async () => {
        await expect(receive(makeUpdate("bogus", "x"))).rejects.toThrow(/Unrecognized type 'bogus'/);
        expect(toast.showPersistent).not.toHaveBeenCalled();
    });
});
