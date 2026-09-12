import type { SyncConfigResponse, WebSocketMessage } from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../entities/fnote";

const mocks = vi.hoisted(() => ({
    storedHost: "https://stored.example/",
    getConfig: vi.fn<() => Promise<SyncConfigResponse>>(),
    syncNow: vi.fn(),
    onMessage: undefined as ((message: WebSocketMessage) => void) | undefined
}));

vi.mock("../../services/server", () => ({
    default: {
        get: (url: string) => url === "sync/config" ? mocks.getConfig()
            : Promise.resolve(url === "keyboard-actions" ? [] : {})
    }
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
vi.mock("../react/hooks", async (importOriginal) => {
    const hooks = await importOriginal<typeof import("../react/hooks")>();
    return {
        ...hooks,
        useTriliumOption: () => [ mocks.storedHost, vi.fn() ],
        useStaticTooltip: (...args: Parameters<typeof hooks.useStaticTooltip>) =>
            hooks.useStaticTooltip(args[0], { ...args[1], animation: false })
    };
});
vi.mock("./launch_bar_widgets", () => ({ launcherContextMenuHandler: () => undefined }));

import SyncStatus from "./SyncStatus";

let container: HTMLDivElement;

beforeEach(() => {
    mocks.storedHost = "https://stored.example/";
    mocks.getConfig.mockReset().mockResolvedValue({ syncServerHost: "https://effective.example/" });
    mocks.syncNow.mockClear();
    container = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    act(() => { render(null, container); });
    container.remove();
});

async function mount() {
    await act(async () => {
        render(<SyncStatus launcherNote={{} as FNote} />, container);
    });
    await act(async () => {});
}

function showTooltip() {
    const icon = container.querySelector<HTMLElement>(".sync-status-icon");
    expect(icon).not.toBeNull();
    if (!icon) throw new Error("Missing sync icon");
    const tooltip = Tooltip.getInstance(icon);
    expect(tooltip).not.toBeNull();
    tooltip?.show();
    const body = document.querySelector<HTMLElement>(".tooltip-inner");
    expect(body).not.toBeNull();
    if (!body) throw new Error("Missing tooltip");
    return { icon, body };
}

describe("SyncStatus", () => {
    it("shows the effective host even when the stored host is empty", async () => {
        mocks.storedHost = "";
        await mount();
        const { icon, body } = showTooltip();
        expect(body.textContent).toContain("https://effective.example/");
        expect(mocks.getConfig).toHaveBeenCalledTimes(1);
        icon.click();
        expect(mocks.syncNow).toHaveBeenCalledTimes(1);
    });

    it("keeps the host through status changes and prevents duplicate sync requests", async () => {
        await mount();
        for (const type of [ "sync-finished", "sync-failed", "sync-pull-in-progress" ] as const) {
            await act(async () => { mocks.onMessage?.({ type, lastSyncedPush: 0 }); });
            const { icon, body } = showTooltip();
            expect(body.textContent).toContain("https://effective.example/");
            expect(body.textContent).not.toContain(mocks.storedHost);
            if (type === "sync-pull-in-progress") {
                icon.click();
                expect(mocks.syncNow).not.toHaveBeenCalled();
            }
        }
    });

    it("escapes markup in the host instead of rendering it", async () => {
        const host = 'https://sync.example/<b title="test">&value</b>';
        mocks.getConfig.mockResolvedValue({ syncServerHost: host });
        await mount();
        const { body } = showTooltip();
        expect(body.textContent).toContain(host);
        expect(body.querySelector("b")).toBeNull();
    });

    it("hides disabled sync but keeps the button available after a config read fails", async () => {
        mocks.getConfig.mockResolvedValue({ syncServerHost: null });
        await mount();
        expect(container.querySelector(".sync-status-icon")).toBeNull();
        mocks.storedHost = "https://changed.example/";
        mocks.getConfig.mockRejectedValue(new Error("Unavailable"));
        await mount();
        const { icon, body } = showTooltip();
        expect(body.textContent).not.toContain(mocks.storedHost);
        icon.click();
        expect(mocks.syncNow).toHaveBeenCalledTimes(1);
    });

    it("refreshes after a host change and ignores stale responses", async () => {
        let resolveFirst: ((value: SyncConfigResponse) => void) | undefined;
        mocks.getConfig.mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }));
        await mount();
        mocks.storedHost = "https://new.example/";
        mocks.getConfig.mockResolvedValue({ syncServerHost: "https://new.example/" });
        await mount();
        expect(showTooltip().body.textContent).toContain("https://new.example/");
        await act(async () => { resolveFirst?.({ syncServerHost: "https://old.example/" }); });
        const { body } = showTooltip();
        expect(body.textContent).toContain("https://new.example/");
        expect(body.textContent).not.toContain("https://old.example/");
        expect(mocks.getConfig).toHaveBeenCalledTimes(2);
    });
});
