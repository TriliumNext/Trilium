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
            csrfToken: "csrf-test-token",
            httpBaseUrl: undefined,
            isElectron: false
        };
    });

    it("submits a CSRF-protected browser navigation for OIDC redirects", async () => {
        const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});

        await entrypoints.logoutCommand();

        const form = document.body.querySelector("form");
        expect(form).not.toBeNull();
        expect(form?.method).toBe("POST");
        expect(form?.action).toBe("http://localhost:3000/logout");
        expect(
            form?.querySelector("input[name='x-csrf-token']")?.getAttribute("value")
        ).toBe("csrf-test-token");
        expect(submit).toHaveBeenCalledOnce();
    });

    it("selects the correct logout target for each runtime", async () => {
        const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
        const actions: string[] = [];

        window.glob.httpBaseUrl = "http://127.0.0.1:37742";
        await entrypoints.logoutCommand();
        actions.push(document.body.querySelector("form")?.action ?? "");

        document.body.replaceChildren();
        const happyDOM = (window as unknown as {
            happyDOM: { setURL(url: string): void }
        }).happyDOM;
        happyDOM.setURL("trilium-app://app/");
        window.glob.isElectron = true;
        await entrypoints.logoutCommand();
        actions.push(document.body.querySelector("form")?.action ?? "");

        document.body.replaceChildren();
        window.glob.isElectron = false;
        window.glob.httpBaseUrl = undefined;
        happyDOM.setURL("http://localhost:3000/");
        window.history.replaceState({}, "", "/trilium/");
        await entrypoints.logoutCommand();
        actions.push(document.body.querySelector("form")?.action ?? "");
        happyDOM.setURL("http://localhost:3000/");

        expect(actions).toEqual([
            "http://127.0.0.1:37742/logout",
            "trilium-app://app/logout",
            "http://localhost:3000/trilium/logout"
        ]);
        expect(submit).toHaveBeenCalledTimes(3);
    });
});
