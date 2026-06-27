import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { WebSocketMessage } from "@triliumnext/commons";
import appContext from "../components/app_context.js";
import * as i18n from "./i18n.js";
import server from "./server.js";
import toastService from "./toast.js";
import ws from "./ws.js";

// Capture the message handlers that import.ts registers at module load. The
// global ws mock's subscribeToMessages is a no-op, so we replace it with a
// capturing variant BEFORE importing the module under test.
type MessageHandler = (message: WebSocketMessage) => void | Promise<void>;
const handlers: MessageHandler[] = [];
ws.subscribeToMessages = ((cb: MessageHandler) => {
    handlers.push(cb);
}) as typeof ws.subscribeToMessages;

let importService: typeof import("./import.js").default;
let uploadFiles: typeof import("./import.js").uploadFiles;

beforeAll(async () => {
    const mod = await import("./import.js");
    importService = mod.default;
    uploadFiles = mod.uploadFiles;
    // Two handlers registered at load: importNotes + importAttachments.
    expect(handlers.length).toBe(2);
});

// Toast service spies.
toastService.showError = vi.fn();
toastService.showPersistent = vi.fn();
toastService.closePersistent = vi.fn();

// A fake active note context whose setNote we can assert against.
const setNote = vi.fn(async () => {});
const getActiveContext = vi.fn(() => ({ setNote }) as any);
(appContext as any).tabManager = { getActiveContext };

beforeEach(() => {
    vi.clearAllMocks();
    getActiveContext.mockReturnValue({ setNote } as any);
});

describe("uploadFiles", () => {
    beforeEach(() => {
        ($ as any).ajax = vi.fn(async () => ({}));
        server.getHeaders = vi.fn(async () => ({ "x-h": "1" })) as typeof server.getHeaders;
    });

    it("throws on an unrecognized entity type", async () => {
        await expect(uploadFiles("bogus", "p1", ["f"], { shrinkImages: false })).rejects.toThrow(
            "Unrecognized import entity type 'bogus'."
        );
        expect(($ as any).ajax).not.toHaveBeenCalled();
    });

    it("returns early without uploading when there are no files", async () => {
        const result = await uploadFiles("notes", "p1", [], { shrinkImages: false });
        expect(result).toBeUndefined();
        expect(($ as any).ajax).not.toHaveBeenCalled();
    });

    it("posts one ajax request per file, flagging the last, and forwards options + headers", async () => {
        await uploadFiles("notes", "parent1", ["a", "b"], {
            shrinkImages: true,
            safeImport: "true"
        });

        const ajax = ($ as any).ajax as ReturnType<typeof vi.fn>;
        expect(ajax).toHaveBeenCalledTimes(2);

        const first = ajax.mock.calls[0][0];
        expect(first.url).toContain("notes/parent1/notes-import");
        expect(first.type).toBe("POST");
        expect(first.headers).toEqual({ "x-h": "1" });
        const firstData = first.data as FormData;
        expect(firstData.get("last")).toBe("false");
        expect(firstData.get("upload")).toBe("a");
        expect(firstData.get("shrinkImages")).toBe("true");
        expect(firstData.get("safeImport")).toBe("true");
        // taskId is shared across files in the same upload batch.
        const taskId = firstData.get("taskId");
        expect(typeof taskId).toBe("string");

        const second = ajax.mock.calls[1][0];
        const secondData = second.data as FormData;
        expect(secondData.get("last")).toBe("true");
        expect(secondData.get("upload")).toBe("b");
        expect(secondData.get("taskId")).toBe(taskId);
    });

    it("uses the attachments endpoint for the attachments entity type", async () => {
        await uploadFiles("attachments", "host1", ["a"], { shrinkImages: false });
        const first = ($ as any).ajax.mock.calls[0][0];
        expect(first.url).toContain("notes/host1/attachments-import");
    });

    it("surfaces an upload error through the toast service via the ajax error callback", async () => {
        // Spy on the i18n binding so we can verify xhr.responseText is forwarded
        // without depending on i18next interpolation (i18next is uninitialised in
        // the test env, so t() returns the key and never interpolates). We assert
        // the call args/structure rather than a human-readable translated string.
        const tSpy = vi.spyOn(i18n, "t");
        vi.useFakeTimers();
        try {
            ($ as any).ajax = vi.fn(async (opts: any) => {
                opts.error({ responseText: "boom" });
                return {};
            });
            await uploadFiles("notes", "p1", ["a"], { shrinkImages: false });
            // The error toast is deferred (so a WebSocket taskError can claim the taskId first and
            // win), so the fallback only fires after IMPORT_ERROR_FALLBACK_DELAY — flush it first.
            vi.runOnlyPendingTimers();
            expect(toastService.showError).toHaveBeenCalledTimes(1);
            // The xhr.responseText ("boom") must be forwarded into the message
            // interpolation, not dropped or replaced with the whole xhr object.
            expect(tSpy).toHaveBeenCalledWith("import.failed", { message: "boom" });
        } finally {
            tSpy.mockRestore();
            vi.useRealTimers();
        }
    });

    it("is also reachable through the default export", async () => {
        await importService.uploadFiles("notes", "p1", ["a"], { shrinkImages: false });
        expect(($ as any).ajax).toHaveBeenCalledTimes(1);
    });
});

// Convenience: invoke both subscribed handlers with a message.
async function dispatch(message: any) {
    for (const handler of handlers) {
        await handler(message);
    }
}

describe("importNotes ws handler", () => {
    const handler = () => handlers[0];

    it("ignores messages without a matching taskType", async () => {
        await handler()({ type: "taskSucceeded" } as any); // no taskType
        await handler()({ type: "taskSucceeded", taskType: "importAttachments" } as any); // wrong type
        expect(toastService.showError).not.toHaveBeenCalled();
        expect(toastService.showPersistent).not.toHaveBeenCalled();
    });

    it("closes the toast and shows an error on taskError", async () => {
        await handler()({ type: "taskError", taskType: "importNotes", taskId: "t1", message: "nope" } as any);
        expect(toastService.closePersistent).toHaveBeenCalledWith("t1");
        expect(toastService.showError).toHaveBeenCalledWith("nope");
    });

    it("shows the error only once when the same task reports it twice (the WebSocket + fallback dedup)", async () => {
        // A fresh taskId — the dedup guard is module-level state that survives clearAllMocks.
        await handler()({ type: "taskError", taskType: "importNotes", taskId: "dedupT", message: "boom" } as any);
        await handler()({ type: "taskError", taskType: "importNotes", taskId: "dedupT", message: "boom again" } as any);
        // The second report for the same taskId is suppressed, so only the first toast shows.
        expect(toastService.showError).toHaveBeenCalledTimes(1);
        expect(toastService.showError).toHaveBeenCalledWith("boom");
    });

    it("shows a persistent count-only progress toast when no total is reported", async () => {
        await handler()({ type: "taskProgressCount", taskType: "importNotes", taskId: "t2", progressCount: 3 } as any);
        expect(toastService.showPersistent).toHaveBeenCalledTimes(1);
        const toast = (toastService.showPersistent as any).mock.calls[0][0];
        expect(toast.id).toBe("t2");
        expect(toast.progress).toBeUndefined();
    });

    it("shows a progress-bar toast when a total is reported", async () => {
        await handler()({ type: "taskProgressCount", taskType: "importNotes", taskId: "t2", progressCount: 3, totalCount: 12 } as any);
        const toast = (toastService.showPersistent as any).mock.calls[0][0];
        expect(toast.progress).toBe(3 / 12);
    });

    it("shows a generic 'starting' message (no bar) before anything is counted", async () => {
        const tSpy = vi.spyOn(i18n, "t").mockImplementation(((key: string) => key) as typeof i18n.t);
        await handler()({ type: "taskProgressCount", taskType: "importNotes", taskId: "t2", progressCount: 0 } as any);
        const toast = (toastService.showPersistent as any).mock.calls[0][0];
        expect(toast.progress).toBeUndefined();
        expect(toast.message).toBe("import.starting");
        tSpy.mockRestore();
    });

    it("shows a success toast and navigates to the imported note when one is returned", async () => {
        await handler()({
            type: "taskSucceeded",
            taskType: "importNotes",
            taskId: "t3",
            result: { importedNoteId: "imp1" }
        } as any);
        const toast = (toastService.showPersistent as any).mock.calls[0][0];
        expect(toast.timeout).toBe(5000);
        expect(setNote).toHaveBeenCalledWith("imp1");
    });

    it("shows a success toast but does not navigate when there is no imported note id", async () => {
        await handler()({
            type: "taskSucceeded",
            taskType: "importNotes",
            taskId: "t4",
            result: {}
        } as any);
        expect(toastService.showPersistent).toHaveBeenCalledTimes(1);
        expect(setNote).not.toHaveBeenCalled();
    });

    it("tolerates a missing active context on success navigation", async () => {
        getActiveContext.mockReturnValue(undefined as any);
        await handler()({
            type: "taskSucceeded",
            taskType: "importNotes",
            taskId: "t5",
            result: { importedNoteId: "imp2" }
        } as any);
        expect(setNote).not.toHaveBeenCalled();
    });

    it("does nothing for a matching task with an unhandled message type", async () => {
        await handler()({ type: "ping", taskType: "importNotes", taskId: "t6" } as any);
        expect(toastService.showError).not.toHaveBeenCalled();
        expect(toastService.showPersistent).not.toHaveBeenCalled();
        expect(toastService.closePersistent).not.toHaveBeenCalled();
    });
});

describe("importAttachments ws handler", () => {
    const handler = () => handlers[1];

    it("ignores messages without a matching taskType", async () => {
        await handler()({ type: "taskSucceeded" } as any); // no taskType
        await handler()({ type: "taskSucceeded", taskType: "importNotes" } as any); // wrong type
        expect(toastService.showError).not.toHaveBeenCalled();
        expect(toastService.showPersistent).not.toHaveBeenCalled();
    });

    it("closes the toast and shows an error on taskError", async () => {
        await handler()({ type: "taskError", taskType: "importAttachments", taskId: "a1", message: "bad" } as any);
        expect(toastService.closePersistent).toHaveBeenCalledWith("a1");
        expect(toastService.showError).toHaveBeenCalledWith("bad");
    });

    it("shows a persistent progress toast on taskProgressCount", async () => {
        await handler()({ type: "taskProgressCount", taskType: "importAttachments", taskId: "a2", progressCount: 1 } as any);
        expect(toastService.showPersistent).toHaveBeenCalledTimes(1);
        expect((toastService.showPersistent as any).mock.calls[0][0].id).toBe("a2");
    });

    it("navigates to the attachments view on success when a parent note id is present", async () => {
        await handler()({
            type: "taskSucceeded",
            taskType: "importAttachments",
            taskId: "a3",
            result: { parentNoteId: "par1", importedNoteId: "imp3" }
        } as any);
        const toast = (toastService.showPersistent as any).mock.calls[0][0];
        expect(toast.timeout).toBe(5000);
        expect(setNote).toHaveBeenCalledWith("imp3", { viewScope: { viewMode: "attachments" } });
    });

    it("shows a success toast but does not navigate when there is no parent note id", async () => {
        await handler()({
            type: "taskSucceeded",
            taskType: "importAttachments",
            taskId: "a4",
            result: {}
        } as any);
        expect(toastService.showPersistent).toHaveBeenCalledTimes(1);
        expect(setNote).not.toHaveBeenCalled();
    });

    it("navigates with an undefined note id when the parent gates but the imported note id is missing", async () => {
        // The source gates navigation on result.parentNoteId but passes
        // result.importedNoteId to setNote. With a parent present and no
        // imported id, setNote is still called with the (undefined) id.
        await handler()({
            type: "taskSucceeded",
            taskType: "importAttachments",
            taskId: "a4b",
            result: { parentNoteId: "par2" }
        } as any);
        expect(toastService.showPersistent).toHaveBeenCalledTimes(1);
        expect(setNote).toHaveBeenCalledTimes(1);
        expect(setNote).toHaveBeenCalledWith(undefined, { viewScope: { viewMode: "attachments" } });
    });

    it("tolerates a missing active context on success navigation", async () => {
        getActiveContext.mockReturnValue(undefined as any);
        await handler()({
            type: "taskSucceeded",
            taskType: "importAttachments",
            taskId: "a5",
            result: { parentNoteId: "par2", importedNoteId: "imp4" }
        } as any);
        expect(setNote).not.toHaveBeenCalled();
    });

    it("does nothing for a matching task with an unhandled message type", async () => {
        await handler()({ type: "ping", taskType: "importAttachments", taskId: "a6" } as any);
        expect(toastService.showError).not.toHaveBeenCalled();
        expect(toastService.showPersistent).not.toHaveBeenCalled();
        expect(toastService.closePersistent).not.toHaveBeenCalled();
    });
});

describe("dispatch sanity", () => {
    it("delivers an unrelated message to both handlers without side effects", async () => {
        await dispatch({ type: "ping" });
        expect(toastService.showError).not.toHaveBeenCalled();
    });
});
