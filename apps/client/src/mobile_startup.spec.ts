import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    startAppAroundLayout: vi.fn(async (_root: HTMLElement) => {}),
    setupGlobs: vi.fn(),
    setupClipboardImageEmbed: vi.fn(),
    setupLinkHandlers: vi.fn(),
    showPersistent: vi.fn(),
    preloadCommonNoteTypes: vi.fn()
}));

vi.mock("./components/app_startup.js", () => ({ startAppAroundLayout: mocks.startAppAroundLayout }));
vi.mock("./services/glob.js", () => ({ default: { setupGlobs: mocks.setupGlobs } }));
vi.mock("./services/clipboard_image_embed.js", () => ({ setupClipboardImageEmbed: mocks.setupClipboardImageEmbed }));
vi.mock("./services/link.js", () => ({ setupLinkHandlers: mocks.setupLinkHandlers }));
vi.mock("./services/i18n.js", () => ({
    t: (key: string, values?: Record<string, string>) => (values ? `${key} ${JSON.stringify(values)}` : key)
}));
vi.mock("./services/toast.js", () => ({ default: { showPersistent: mocks.showPersistent } }));
vi.mock("./widgets/note_types.js", () => ({ preloadCommonNoteTypes: mocks.preloadCommonNoteTypes }));

import { startMobile } from "./mobile_startup.js";

describe("startMobile", () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it("starts the app around the layout, sets up the page's handlers, then preloads the common note types", async () => {
        const root = document.createElement("div");
        await startMobile(root);

        expect(mocks.setupGlobs).toHaveBeenCalled();
        expect(mocks.startAppAroundLayout).toHaveBeenCalledWith(root);
        expect(mocks.setupClipboardImageEmbed).toHaveBeenCalled();
        expect(mocks.setupLinkHandlers).toHaveBeenCalled();
        expect(mocks.preloadCommonNoteTypes).toHaveBeenCalled();
        expect(mocks.showPersistent).not.toHaveBeenCalled();
    });

    it("shows a critical error, and preloads nothing, when the app fails to start", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        mocks.startAppAroundLayout.mockRejectedValueOnce(new Error("no tree"));
        await startMobile(document.createElement("div"));

        expect(mocks.showPersistent).toHaveBeenCalledWith(expect.objectContaining({
            id: "critical-error",
            message: expect.stringContaining("no tree")
        }));
        expect(mocks.preloadCommonNoteTypes).not.toHaveBeenCalled();
    });
});
