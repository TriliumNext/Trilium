import type { ElectronApi } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Entrypoints from "./entrypoints.js";

describe("openInWindowCommand", () => {
    const entrypoints = new Entrypoints();

    beforeEach(() => {
        vi.restoreAllMocks();
        delete window.electronApi;
    });

    it("opens a browser window on the extra-window URL", async () => {
        const open = vi.spyOn(window, "open").mockReturnValue(null);

        await entrypoints.openInWindowCommand({ notePath: "root/abc123", hoistedNoteId: "root" });

        const [url] = open.mock.calls[0];
        expect(String(url)).toMatch(/[?&]extraWindow=1/);
        expect(String(url)).toMatch(/#root\/abc123$/);
    });

    it("hands only the hash to Electron, which builds the URL itself", async () => {
        const createExtraWindow = vi.fn();
        window.electronApi = { window: { createExtraWindow } } as unknown as ElectronApi;
        const open = vi.spyOn(window, "open");

        await entrypoints.openInWindowCommand({ notePath: "root/abc123", hoistedNoteId: "root" });

        expect(createExtraWindow).toHaveBeenCalledWith("#root/abc123");
        expect(open).not.toHaveBeenCalled();
    });
});
