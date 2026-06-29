import { beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../entities/fnote";
import { isElectron } from "../../services/utils";
import { isOptionPageVisibleOnPlatform } from "./OptionsDialog";

// Importing the dialog pulls in the options stack, so keep the real `utils` module (e.g. `isShare`,
// needed when `options.ts` initialises) and only swap out the platform check.
vi.mock("../../services/utils", async (importActual) => ({
    ...(await importActual<typeof import("../../services/utils")>()),
    isElectron: vi.fn(() => true)
}));

function fakePage(label?: "electronOnly" | "serverOnly") {
    return {
        isLabelTruthy: (name: string) => name === label
    } as unknown as FNote;
}

describe("isOptionPageVisibleOnPlatform", () => {
    beforeEach(() => {
        vi.mocked(isElectron).mockReturnValue(true);
    });

    it("shows pages without a platform label on every platform", () => {
        vi.mocked(isElectron).mockReturnValue(true);
        expect(isOptionPageVisibleOnPlatform(fakePage())).toBe(true);
        vi.mocked(isElectron).mockReturnValue(false);
        expect(isOptionPageVisibleOnPlatform(fakePage())).toBe(true);
    });

    it("shows an #electronOnly page only on the Electron desktop app", () => {
        vi.mocked(isElectron).mockReturnValue(true);
        expect(isOptionPageVisibleOnPlatform(fakePage("electronOnly"))).toBe(true);
        vi.mocked(isElectron).mockReturnValue(false);
        expect(isOptionPageVisibleOnPlatform(fakePage("electronOnly"))).toBe(false);
    });

    it("shows a #serverOnly page only on the server (web/mobile)", () => {
        vi.mocked(isElectron).mockReturnValue(false);
        expect(isOptionPageVisibleOnPlatform(fakePage("serverOnly"))).toBe(true);
        vi.mocked(isElectron).mockReturnValue(true);
        expect(isOptionPageVisibleOnPlatform(fakePage("serverOnly"))).toBe(false);
    });
});
