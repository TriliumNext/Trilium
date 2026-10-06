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

describe("logoutCommand", () => {
    const entrypoints = new Entrypoints();

    beforeEach(() => {
        vi.restoreAllMocks();
        document.body.replaceChildren();
        window.history.replaceState({}, "", "/");
        window.glob = {
            ...window.glob,
            baseApiUrl: "api/",
            csrfToken: "csrf-test-token"
        };
    });

    it("submits a CSRF-protected form navigation to the logout route", () => {
        const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});

        entrypoints.logoutCommand();

        const form = document.body.querySelector("form");
        expect(form).not.toBeNull();
        expect(form?.method).toBe("POST");
        expect(form?.action).toBe("http://localhost:3000/logout");
        expect(form?.querySelector("input[name='x-csrf-token']")?.getAttribute("value"))
            .toBe("csrf-test-token");
        expect(submit).toHaveBeenCalledOnce();

        // The route resolves against the page like every other request, so a sub-path
        // deployment keeps its prefix.
        document.body.replaceChildren();
        window.history.replaceState({}, "", "/trilium/");
        entrypoints.logoutCommand();
        expect(document.body.querySelector("form")?.action)
            .toBe("http://localhost:3000/trilium/logout");
        window.history.replaceState({}, "", "/");
    });
});
