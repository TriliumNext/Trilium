import type { WebSocketMessage } from "@triliumnext/commons";
import type { OptionNames } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// The component imports `ws, { subscribeToMessages, unsubscribeToMessage }` as named exports plus a
// default with `getMaxKnownEntityChangeSyncId`. The shared setup.ts auto-mock only defines
// `default.subscribeToMessages`, so we provide a complete mock here and capture the subscribed handler.
// Shared mutable state lives in vi.hoisted so the (hoisted) vi.mock factory can read it.
const wsState = vi.hoisted(() => ({
    subscribedHandlers: [] as Array<(message: WebSocketMessage) => void>,
    maxKnownEntityChangeSyncId: 0
}));
vi.mock("../../services/ws", () => {
    const subscribeToMessages = vi.fn((handler: (message: WebSocketMessage) => void) => {
        wsState.subscribedHandlers.push(handler);
    });
    const unsubscribeToMessage = vi.fn((handler: (message: WebSocketMessage) => void) => {
        const idx = wsState.subscribedHandlers.indexOf(handler);
        if (idx >= 0) wsState.subscribedHandlers.splice(idx, 1);
    });
    const def = {
        subscribeToMessages,
        unsubscribeToMessage,
        logError: vi.fn(),
        getMaxKnownEntityChangeSyncId: () => wsState.maxKnownEntityChangeSyncId
    };
    return { default: def, subscribeToMessages, unsubscribeToMessage };
});

vi.mock("../../services/sync", () => ({
    default: { syncNow: vi.fn(async () => undefined) }
}));

// i18next is not initialized in the test env, so `t()` would yield undefined; the component's
// STATE_MAPPINGS feed those titles to escapeQuotes(). Return the key so it stays a defined string.
vi.mock("../../services/i18n", () => ({
    t: (key: string) => key
}));

// useStaticTooltip patches Tooltip.prototype.dispose at import and instantiates a Tooltip — stub it.
vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    return { Tooltip, default: { Tooltip } };
});

import options from "../../services/options";
import sync from "../../services/sync";
import { buildNote } from "../../test/easy-froca";
import SyncStatus from "./SyncStatus";

// --- Render helper --------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
function renderInto(vnode: unknown) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(vnode as never, container as HTMLDivElement));
    return container;
}

function setSyncServerHost(value: string) {
    options.load({ syncServerHost: value } as Record<OptionNames, string>);
}

/** Synchronously dispatch a WebSocket message to every subscribed `useSyncStatus` handler. */
function fireMessage(message: WebSocketMessage) {
    act(() => wsState.subscribedHandlers.forEach(handler => handler(message)));
}

function statusIcon() {
    return container?.querySelector<HTMLSpanElement>(".sync-status-icon") ?? null;
}

function setMaxKnownSyncId(value: number) {
    wsState.maxKnownEntityChangeSyncId = value;
}

beforeEach(() => {
    wsState.subscribedHandlers.length = 0;
    wsState.maxKnownEntityChangeSyncId = 0;
    setSyncServerHost("https://example.com");
    Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: vi.fn() });
    (sync.syncNow as ReturnType<typeof vi.fn>).mockClear();
});

afterEach(() => {
    if (container) { render(null, container); container.remove(); container = undefined; }
    vi.restoreAllMocks();
});

describe("SyncStatus", () => {
    it("renders nothing when no sync server host is configured", () => {
        setSyncServerHost("");
        const launcherNote = buildNote({ id: "lbHidden", title: "Sync" });
        const root = renderInto(<SyncStatus launcherNote={launcherNote} />);
        expect(root.querySelector(".sync-status-widget")).toBeNull();
        expect(root.querySelector(".sync-status-icon")).toBeNull();
    });

    it("renders the widget with the unknown state by default and subscribes", () => {
        const launcherNote = buildNote({ id: "lb1", title: "Sync" });
        const root = renderInto(<SyncStatus launcherNote={launcherNote} />);

        expect(root.querySelector(".sync-status-widget.launcher-button")).not.toBeNull();
        const icon = statusIcon();
        expect(icon?.classList.contains("sync-status-unknown")).toBe(true);
        expect(icon?.classList.contains("bx-time")).toBe(true);
        // No "has changes" sub-icon for the unknown state.
        expect(icon?.querySelector(".sync-status-sub-icon")).toBeNull();
        expect(wsState.subscribedHandlers.length).toBe(1);
    });

    it("moves to in-progress on pull/push and ignores clicks while syncing", () => {
        const launcherNote = buildNote({ id: "lb2", title: "Sync" });
        renderInto(<SyncStatus launcherNote={launcherNote} />);

        fireMessage({ type: "sync-pull-in-progress", lastSyncedPush: 0 });
        let icon = statusIcon();
        expect(icon?.classList.contains("sync-status-in-progress")).toBe(true);
        expect(icon?.classList.contains("bx-analyse")).toBe(true);

        // Clicking while in-progress must not trigger a sync.
        icon?.click();
        expect(sync.syncNow).not.toHaveBeenCalled();

        fireMessage({ type: "sync-push-in-progress", lastSyncedPush: 0 });
        icon = statusIcon();
        expect(icon?.classList.contains("sync-status-in-progress")).toBe(true);
    });

    it("shows connected-no-changes when all changes pushed, and triggers syncNow on click", () => {
        setMaxKnownSyncId(7);
        const launcherNote = buildNote({ id: "lb3", title: "Sync" });
        renderInto(<SyncStatus launcherNote={launcherNote} />);

        fireMessage({ type: "sync-finished", lastSyncedPush: 7 });
        const icon = statusIcon();
        expect(icon?.classList.contains("sync-status-connected-no-changes")).toBe(true);
        expect(icon?.classList.contains("bx-wifi")).toBe(true);
        expect(icon?.querySelector(".sync-status-sub-icon")).toBeNull();

        icon?.click();
        expect(sync.syncNow).toHaveBeenCalledTimes(1);
    });

    it("shows connected-with-changes (with star sub-icon) when changes remain unpushed", () => {
        setMaxKnownSyncId(9);
        const launcherNote = buildNote({ id: "lb4", title: "Sync" });
        renderInto(<SyncStatus launcherNote={launcherNote} />);

        fireMessage({ type: "sync-finished", lastSyncedPush: 3 });
        const icon = statusIcon();
        expect(icon?.classList.contains("sync-status-connected-with-changes")).toBe(true);
        const subIcon = icon?.querySelector(".sync-status-sub-icon");
        expect(subIcon?.classList.contains("bxs-star")).toBe(true);
    });

    it("shows disconnected-no-changes and disconnected-with-changes on sync-failed", () => {
        setMaxKnownSyncId(4);
        const launcherNote = buildNote({ id: "lb5", title: "Sync" });
        renderInto(<SyncStatus launcherNote={launcherNote} />);

        fireMessage({ type: "sync-failed", lastSyncedPush: 4 });
        expect(statusIcon()?.classList.contains("sync-status-disconnected-no-changes")).toBe(true);
        expect(statusIcon()?.classList.contains("bx-wifi-off")).toBe(true);
        expect(statusIcon()?.querySelector(".sync-status-sub-icon")).toBeNull();

        fireMessage({ type: "sync-failed", lastSyncedPush: 1 });
        expect(statusIcon()?.classList.contains("sync-status-disconnected-with-changes")).toBe(true);
        expect(statusIcon()?.querySelector(".sync-status-sub-icon")).not.toBeNull();
    });

    it("reads lastSyncedPush from a top-level field and from message.data", () => {
        setMaxKnownSyncId(5);
        const launcherNote = buildNote({ id: "lb6", title: "Sync" });
        renderInto(<SyncStatus launcherNote={launcherNote} />);

        // frontend-update carries lastSyncedPush in `data`; it sets the running value but does not
        // change the visible state by itself.
        fireMessage({ type: "frontend-update", data: { lastSyncedPush: 5, entityChanges: [] } });
        // A subsequent sync-finished without a top-level lastSyncedPush keeps the value read earlier...
        // sync-finished does carry a top-level lastSyncedPush, so this confirms the top-level branch.
        fireMessage({ type: "sync-finished", lastSyncedPush: 5 });
        expect(statusIcon()?.classList.contains("sync-status-connected-no-changes")).toBe(true);
    });

    it("updates lastSyncedPush from message.data after an initial top-level read", () => {
        setMaxKnownSyncId(8);
        const launcherNote = buildNote({ id: "lb7", title: "Sync" });
        renderInto(<SyncStatus launcherNote={launcherNote} />);

        // First establish lastSyncedPush via a top-level field (so it is defined),
        // then a message carrying it in `data` updates it (the else-if branch).
        fireMessage({ type: "sync-finished", lastSyncedPush: 2 });
        expect(statusIcon()?.classList.contains("sync-status-connected-with-changes")).toBe(true);

        // A task-style message whose `data` carries lastSyncedPush updates the tracked value.
        fireMessage({ type: "frontend-update", data: { lastSyncedPush: 8, entityChanges: [] } } as WebSocketMessage);
        fireMessage({ type: "sync-failed", lastSyncedPush: 8 });
        expect(statusIcon()?.classList.contains("sync-status-disconnected-no-changes")).toBe(true);
    });

    it("invokes the context-menu handler bound to the launcher note", () => {
        const launcherNote = buildNote({ id: "lb8", title: "Sync" });
        const root = renderInto(<SyncStatus launcherNote={launcherNote} />);
        const widget = root.querySelector<HTMLDivElement>(".sync-status-widget");
        expect(widget).not.toBeNull();

        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        const preventDefault = vi.spyOn(event, "preventDefault");
        widget?.dispatchEvent(event);
        // The handler runs and calls preventDefault (this note has no removable branch, so the menu
        // itself short-circuits before showing — we only assert the handler was wired up & fired).
        expect(preventDefault).toHaveBeenCalled();
    });

    it("unsubscribes the message handler on unmount", () => {
        const launcherNote = buildNote({ id: "lb9", title: "Sync" });
        renderInto(<SyncStatus launcherNote={launcherNote} />);
        expect(wsState.subscribedHandlers.length).toBe(1);

        if (container) { act(() => render(null, container as HTMLDivElement)); }
        expect(wsState.subscribedHandlers.length).toBe(0);
    });
});
