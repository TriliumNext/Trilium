import { beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../entities/fnote";
import { isElectron } from "../../services/utils";
import { isOptionPageVisibleOnPlatform } from "./OptionsDialog";

// `isStandalone` is a const in the target, read here as a live getter so each scenario can flip it.
// `vi.hoisted` runs before the hoisted `vi.mock` factory, so the factory can reference it.
const ctrl = vi.hoisted(() => ({ standalone: false }));

// Importing the dialog pulls in the options stack, so keep the real `utils` module (e.g. `isShare`,
// needed when `options.ts` initialises) and only swap out the platform checks.
vi.mock("../../services/utils", async (importActual) => ({
    ...(await importActual<typeof import("../../services/utils")>()),
    isElectron: vi.fn(() => true),
    get isStandalone() {
        return ctrl.standalone;
    }
}));

function fakePage(label?: "electronOnly" | "serverOnly" | "notInStandalone") {
    return {
        isLabelTruthy: (name: string) => name === label
    } as unknown as FNote;
}

describe("isOptionPageVisibleOnPlatform", () => {
    beforeEach(() => {
        vi.mocked(isElectron).mockReturnValue(true);
        ctrl.standalone = false;
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

    it("hides a #notInStandalone page in the standalone build, on either platform it runs as", () => {
        // Standalone serves itself from this browser, so it answers to neither of the labels above
        // and has to be asked about on its own — including where it runs inside Electron.
        for (const electron of [ true, false ]) {
            vi.mocked(isElectron).mockReturnValue(electron);

            ctrl.standalone = false;
            expect(isOptionPageVisibleOnPlatform(fakePage("notInStandalone"))).toBe(true);
            ctrl.standalone = true;
            expect(isOptionPageVisibleOnPlatform(fakePage("notInStandalone"))).toBe(false);
            // Only the labelled pages go: the rest of the settings are still there.
            expect(isOptionPageVisibleOnPlatform(fakePage())).toBe(true);
        }
    });
});
