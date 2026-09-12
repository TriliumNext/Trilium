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

    it("uses window.open on desktop too; the main process adopts the child", async () => {
        window.electronApi = {} as unknown as ElectronApi;
        const open = vi.spyOn(window, "open").mockReturnValue(null);

        await entrypoints.openInWindowCommand({ notePath: "root/abc123", hoistedNoteId: "root" });

        const [url] = open.mock.calls[0];
        expect(String(url)).toMatch(/[?&]extraWindow=1/);
        expect(String(url)).toMatch(/#root\/abc123$/);
    });
});
