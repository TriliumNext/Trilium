import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./toast.js", () => ({
    default: {
        showMessage: vi.fn(),
        showError: vi.fn()
    }
}));

// Make t() return the key + the interpolation options so we can assert on the
// message that is passed through, without relying on translated strings.
vi.mock("./i18n.js", () => ({
    t: vi.fn((key: string, opts?: Record<string, unknown>) => ({ key, opts }))
}));

import { t } from "./i18n.js";
import server from "./server.js";
import syncService from "./sync.js";
import toastService from "./toast.js";

const showMessage = toastService.showMessage as ReturnType<typeof vi.fn>;
const showError = toastService.showError as ReturnType<typeof vi.fn>;
const translate = t as unknown as ReturnType<typeof vi.fn>;

interface SyncResult {
    success: boolean;
    message: string;
    errorCode?: string;
}

function stubPost(result: SyncResult) {
    server.post = vi.fn(async () => result) as typeof server.post;
}

describe("syncNow", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("shows a success message and posts to sync/now on success", async () => {
        stubPost({ success: true, message: "" });

        await syncService.syncNow();

        expect(server.post).toHaveBeenCalledWith("sync/now");
        expect(showMessage).toHaveBeenCalledTimes(1);
        // Pin the exact success key so a typo'd or swapped key (e.g. the failure key) is caught.
        expect(translate).toHaveBeenCalledWith("sync.finished-successfully");
        expect(showMessage).toHaveBeenCalledWith({ key: "sync.finished-successfully", opts: undefined });
        expect(showError).not.toHaveBeenCalled();
    });

    it("shows an error with the full message on failure", async () => {
        stubPost({ success: false, message: "boom" });

        await syncService.syncNow();

        expect(showMessage).not.toHaveBeenCalled();
        expect(showError).toHaveBeenCalledTimes(1);
        // The failure message is interpolated into the i18n key; assert it carried the original text.
        expect(translate).toHaveBeenCalledWith("sync.failed", { message: "boom" });
    });

    it("truncates failure messages longer than 200 characters", async () => {
        const longMessage = "x".repeat(250);
        stubPost({ success: false, message: longMessage });

        await syncService.syncNow();

        expect(showError).toHaveBeenCalledTimes(1);
        const interpolated = translate.mock.calls.find(([key]) => key === "sync.failed");
        expect(interpolated).toBeDefined();
        const message = (interpolated![1] as { message: string }).message;
        expect(message).toBe("x".repeat(200) + "...");
        expect(message.length).toBe(203);
    });

    it("suppresses the error when not configured and ignoreNotConfigured is true", async () => {
        stubPost({ success: false, message: "no config", errorCode: "NOT_CONFIGURED" });

        await syncService.syncNow(true);

        expect(showError).not.toHaveBeenCalled();
        expect(showMessage).not.toHaveBeenCalled();
    });

    it("still shows the error when not configured but ignoreNotConfigured is false", async () => {
        stubPost({ success: false, message: "no config", errorCode: "NOT_CONFIGURED" });

        await syncService.syncNow(false);

        expect(showError).toHaveBeenCalledTimes(1);
    });

    it("shows the error when ignoreNotConfigured is true but error is not NOT_CONFIGURED", async () => {
        stubPost({ success: false, message: "other failure", errorCode: "OTHER" });

        await syncService.syncNow(true);

        expect(showError).toHaveBeenCalledTimes(1);
    });
});
