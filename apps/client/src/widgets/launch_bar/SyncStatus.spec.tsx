import type { WebSocketMessage } from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../entities/fnote";

const mocks = vi.hoisted(() => ({
    options: {} as Record<string, string>,
    syncNow: vi.fn(),
    onMessage: undefined as ((message: WebSocketMessage) => void) | undefined
}));

vi.mock("../../services/server", () => ({
    default: { get: (url: string) => Promise.resolve(url === "keyboard-actions" ? [] : {}) }
}));
vi.mock("../../services/sync", () => ({ default: { syncNow: mocks.syncNow } }));
vi.mock("../../services/ws", () => ({
    default: { getMaxKnownEntityChangeSyncId: () => 0, subscribeToMessages: () => {} },
    subscribeToMessages: (callback: (message: WebSocketMessage) => void) => {
        mocks.onMessage = callback;
    },
    unsubscribeToMessage: () => { mocks.onMessage = undefined; }
}));
vi.mock("../../services/i18n", async () => {
    const { createInstance } = await import("i18next");
    const translations = await import("../../translations/en/translation.json");
    const i18n = createInstance();
    await i18n.init({
        lng: "en",
        interpolation: { escapeValue: false },
        resources: { en: { translation: translations.default } }
    });
    return { t: i18n.t };
});
// `useTriliumOptionBool` is mocked alongside `useTriliumOption` rather than left to the original:
// it reaches for its module's own binding, which a mock of the export does not reach.
vi.mock("../react/hooks", async (importOriginal) => {
    const hooks = await importOriginal<typeof import("../react/hooks")>();
    return {
        ...hooks,
        useTriliumOption: (name: string) => [ mocks.options[name] ?? "", vi.fn() ],
        useTriliumOptionBool: (name: string) => [ mocks.options[name] === "true", vi.fn() ],
        useStaticTooltip: (...args: Parameters<typeof hooks.useStaticTooltip>) =>
            hooks.useStaticTooltip(args[0], { ...args[1], animation: false })
    };
});
vi.mock("./launch_bar_widgets", () => ({ launcherContextMenuHandler: () => undefined }));

import SyncStatus from "./SyncStatus";

let container: HTMLDivElement;

beforeEach(() => {
    mocks.options = {
        syncServerHost: "https://stored.example/",
        effectiveSyncServerHost: "https://effective.example/",
        syncServerHostOverridden: "true"
    };
    mocks.syncNow.mockClear();
    container = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    act(() => { render(null, container); });
    container.remove();
});

function mount() {
    act(() => {
        render(<SyncStatus launcherNote={{} as FNote} />, container);
    });
}

const icon = () => container.querySelector<HTMLElement>(".sync-status-icon");

function showTooltip() {
    const element = icon();
    expect(element).not.toBeNull();
    if (!element) throw new Error("Missing sync icon");
    const tooltip = Tooltip.getInstance(element);
    expect(tooltip).not.toBeNull();
    tooltip?.show();
    const body = document.querySelector<HTMLElement>(".tooltip-inner");
    expect(body).not.toBeNull();
    if (!body) throw new Error("Missing tooltip");
    return { element, body };
}

describe("SyncStatus", () => {
    it("syncs when pressed, and refuses a second request while one is running", () => {
        mount();

        icon()?.click();
        expect(mocks.syncNow).toHaveBeenCalledTimes(1);

        act(() => { mocks.onMessage?.({ type: "sync-pull-in-progress", lastSyncedPush: 0 }); });
        icon()?.click();
        expect(mocks.syncNow).toHaveBeenCalledTimes(1);
    });

    it("names the sync state without naming the server", () => {
        mount();

        const { body } = showTooltip();
        expect(body.textContent).toContain("Sync status will be known");
        expect(body.textContent).not.toContain("https://effective.example/");
        expect(body.textContent).not.toContain("https://stored.example/");
    });

    it("shows the button when a config override supplies the address, whatever is stored", () => {
        mocks.options.syncServerHost = "";
        mount();

        expect(icon()).not.toBeNull();
    });

    it("hides the button when the configuration turns sync off, whatever the stored host says", () => {
        mocks.options.effectiveSyncServerHost = "";
        mount();

        expect(icon()).toBeNull();
    });

    it("follows the stored host while nothing overrides it", () => {
        mocks.options.syncServerHostOverridden = "false";
        mocks.options.effectiveSyncServerHost = "";

        mount();
        expect(icon()).not.toBeNull();

        for (const storedHost of [ "disabled", "" ]) {
            mocks.options.syncServerHost = storedHost;
            act(() => { render(null, container); });
            mount();
            expect(icon()).toBeNull();
        }
    });

    it("fills a progress bar while pulling, and drops it once the pull is over", () => {
        mount();
        const bar = () => container.querySelector<HTMLElement>(".sync-status-progress");

        act(() => { mocks.onMessage?.({ type: "sync-pull-in-progress", lastSyncedPush: 0 }); });
        expect(bar()).toBeNull();

        act(() => {
            mocks.onMessage?.({ type: "sync-pull-in-progress", lastSyncedPush: 0, progress: { pulled: 25, total: 100 } });
        });
        const element = bar();
        expect(element).not.toBeNull();
        expect(element?.getAttribute("aria-valuenow")).toBe("25");
        expect(element?.style.getPropertyValue("--sync-progress")).toBe("25%");

        act(() => { mocks.onMessage?.({ type: "sync-push-in-progress", lastSyncedPush: 0 }); });
        expect(bar()).toBeNull();

        act(() => {
            mocks.onMessage?.({ type: "sync-pull-in-progress", lastSyncedPush: 0, progress: { pulled: 5, total: 10 } });
        });
        expect(bar()).not.toBeNull();
        act(() => { mocks.onMessage?.({ type: "sync-finished", lastSyncedPush: 0 }); });
        expect(bar()).toBeNull();
    });
});
