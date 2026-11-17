import { h } from "preact";
import { useContext } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    initLocale: vi.fn(async (_locale: string) => {}),
    startDesktop: vi.fn(async (_root: HTMLElement) => {}),
    parentComponent: vi.fn()
}));

vi.mock("./services/options.js", () => ({ default: { initializedPromise: Promise.resolve() } }));
vi.mock("./services/i18n.js", () => ({ initLocale: mocks.initLocale }));
vi.mock("./desktop_startup.js", () => ({ startDesktop: mocks.startDesktop }));
vi.mock("./layouts/DesktopLayout.js", async () => {
    const { ParentComponent } = await import("./widgets/react/react_utils.js");
    return {
        default: function DesktopLayout() {
            mocks.parentComponent(useContext(ParentComponent));
            return h("div", { id: "root-widget" });
        }
    };
});

describe("desktop entry point", () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = `<div id="splash"></div>`;
        window.glob.currentLocale = { id: "de" } as typeof window.glob.currentLocale;
    });

    afterEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = "";
        document.body.classList.remove("full-screen");
        delete window.electronApi;
    });

    it("renders the layout after the page's elements, under the app context, then starts the app around it", async () => {
        await import("./desktop.js");
        // The instance `desktop.ts` imported, as the modules were reset.
        const { default: appContext } = await import("./components/app_context.js");

        expect(mocks.initLocale).toHaveBeenCalledWith("de");
        const root = document.body.lastElementChild;
        expect(root?.id).toBe("root-widget");
        expect(document.getElementById("splash")).not.toBeNull();
        expect(mocks.parentComponent).toHaveBeenCalledWith(appContext);
        await vi.waitFor(() => expect(mocks.startDesktop).toHaveBeenCalledWith(root));
    });

    it("follows the page's full screen in a browser", async () => {
        await import("./desktop.js");

        Object.defineProperty(document, "fullscreenElement", { value: document.documentElement, configurable: true });
        document.dispatchEvent(new Event("fullscreenchange"));
        expect(document.body.classList.contains("full-screen")).toBe(true);

        Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
        document.dispatchEvent(new Event("fullscreenchange"));
        expect(document.body.classList.contains("full-screen")).toBe(false);
    });

    it("follows the window's full screen in the desktop app", async () => {
        const handlers: { enter?: () => void, leave?: () => void } = {};
        window.electronApi = {
            window: {
                isFullScreen: () => true,
                onEnterFullScreen: (callback: () => void) => { handlers.enter = callback; },
                onLeaveFullScreen: (callback: () => void) => { handlers.leave = callback; }
            }
        } as unknown as typeof window.electronApi;
        await import("./desktop.js");
        expect(document.body.classList.contains("full-screen")).toBe(true);

        handlers.leave?.();
        expect(document.body.classList.contains("full-screen")).toBe(false);
        handlers.enter?.();
        expect(document.body.classList.contains("full-screen")).toBe(true);
    });
});
