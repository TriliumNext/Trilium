import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    triggerCommand: vi.fn(),
    openInAppHelpFromUrl: vi.fn()
}));

vi.mock("../../components/app_context", () => ({
    default: { triggerCommand: mocks.triggerCommand }
}));

vi.mock("../../services/utils", async (importActual) => ({
    ...await importActual<typeof import("../../services/utils")>(),
    openInAppHelpFromUrl: mocks.openInAppHelpFromUrl
}));

import { openHelpPageFor } from "./HelpButton";

describe("openHelpPageFor", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("opens help beside a tab's note, over a dialog, and over the quick edit popup itself", () => {
        openHelpPageFor("page", "ntx-tab");
        openHelpPageFor("page", undefined);
        expect(mocks.openInAppHelpFromUrl).toHaveBeenCalledTimes(2);
        expect(mocks.triggerCommand).not.toHaveBeenCalled();

        openHelpPageFor("page", "_options");
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openInPopup", { noteIdOrPath: "_help_page" });

        openHelpPageFor("page", "_popup-editor");
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openInNestedPopup", { noteIdOrPath: "_help_page" });
        openHelpPageFor("page", "_popup-editor-nested");
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openInNestedPopup", { noteIdOrPath: "_help_page" });
        expect(mocks.openInAppHelpFromUrl).toHaveBeenCalledTimes(2);
    });
});
