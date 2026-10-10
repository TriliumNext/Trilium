// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppPayload } from "./app_host.js";
import setupAppView from "./app_view.js";

const { initLocale } = vi.hoisted(() => ({ initLocale: vi.fn() }));

vi.mock("@triliumnext/client/src/components/app_context.js", () => ({ default: {} }));
vi.mock("@triliumnext/client/src/services/i18n.js", () => ({ initLocale }));

describe("setupAppView", () => {
    afterEach(() => {
        document.body.replaceChildren();
        document.body.className = "";
        document.documentElement.className = "";
        vi.unstubAllGlobals();
    });

    it("shows the content without mounting where the page has no view or payload", async () => {
        const load = vi.fn();
        document.body.innerHTML = `<div id="content"><div class="share-note-view"></div></div>`;

        await setupAppView(".share-note-view", load);
        document.body.innerHTML = `<div id="content"><script class="share-froca"></script></div>`;
        await setupAppView(".share-note-view", load);

        expect(load).not.toHaveBeenCalled();
        expect(document.documentElement.classList.contains("app-view-shown")).toBe(true);
    });

    it("mounts the view with the app's globals and the payload's locale", async () => {
        const glob = { assetPath: "" };
        vi.stubGlobal("glob", glob);
        const mount = vi.fn();
        const container = renderPage({ locale: "de" });

        await setupAppView(".share-note-view", async () => ({ default: mount }));

        expect(mount).toHaveBeenCalledWith(container,
            expect.objectContaining({ assetPath: "assets/v1" }));
        expect(initLocale).toHaveBeenCalledWith("de");
        expect(glob.assetPath).toBe("assets/v1");
        expect(document.body.classList.contains("desktop")).toBe(true);
        const globals = window as unknown as { $: unknown; jQuery: unknown };
        expect(globals.$).toBeDefined();
        expect(globals.$).toBe(globals.jQuery);
        expect(document.documentElement.classList.contains("app-view-shown")).toBe(true);
    });

    it("shows the content when the view fails to mount, in the default locale", async () => {
        vi.stubGlobal("glob", undefined);
        renderPage({ locale: null });

        await expect(setupAppView(".share-note-view", async () => ({
            default: () => { throw new Error("mount failed"); }
        }))).rejects.toThrow("mount failed");

        expect(initLocale).toHaveBeenCalledWith("en");
        expect(document.documentElement.classList.contains("app-view-shown")).toBe(true);
    });
});

function renderPage(options: AppPayload["options"]) {
    const payload: Partial<AppPayload> = { options, assetPath: "assets/v1" };
    document.body.innerHTML = `<div id="content">
        <div class="share-note-view"></div>
        <script type="application/json" class="share-froca">${JSON.stringify(payload)}</script>
    </div>`;
    return document.querySelector(".share-note-view");
}
