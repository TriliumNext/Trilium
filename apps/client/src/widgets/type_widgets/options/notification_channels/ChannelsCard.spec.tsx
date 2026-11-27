import type { EntityChange, WebSocketMessage } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => {
    const state = {
        calls: [] as { route: string; body?: unknown }[],
        routes: {} as Record<string, unknown>
    };
    /** Looks a request up in `routes` by its method and URL. A function there can throw. */
    const send = (method: string, url: string, body?: unknown) => {
        const route = `${method} ${url}`;
        state.calls.push({ route, body });
        const answer = route in LOAD_ROUTES ? LOAD_ROUTES[route] : state.routes[route];
        return typeof answer === "function" ? answer() : answer;
    };
    /** The requests that `keyboard_actions.ts` and `options.ts` send as they load. */
    const LOAD_ROUTES: Record<string, unknown> = { "GET keyboard-actions": [], "GET options": {} };
    return { state, send };
});
const mocks = vi.hoisted(() => ({
    confirm: vi.fn(async (_message: unknown) => true),
    showError: vi.fn(),
    showMessage: vi.fn(),
    handlers: new Set<(message: WebSocketMessage) => void>()
}));

vi.mock("../../../../services/i18n", () => ({
    t: (key: string, options?: object) => (options ? `${key} ${JSON.stringify(options)}` : key)
}));
vi.mock("../../../../services/server", () => ({
    default: {
        get: async (url: string) => backend.send("GET", url),
        getWithSilentErrors: async (url: string) => backend.send("GET", url),
        getWithSilentNotFound: async (url: string) => backend.send("GET", url),
        post: async (url: string, body?: unknown) => backend.send("POST", url, body),
        postWithSilentErrors: async (url: string, body?: unknown) =>
            backend.send("POST", url, body),
        patch: async (url: string, body?: unknown) => backend.send("PATCH", url, body),
        put: async (url: string, body?: unknown) => backend.send("PUT", url, body),
        remove: async (url: string, _componentId?: string, body?: unknown) =>
            backend.send("DELETE", url, body),
        withCredentials: async (method: string, url: string, body: unknown) =>
            backend.send(`${method} with credentials`, url, body)
    }
}));
vi.mock("../../../../services/ws", () => {
    const ignore = () => {};
    const waitForMaxKnownEntityChangeId = async () => {};
    return {
        default: { subscribeToMessages: ignore, waitForMaxKnownEntityChangeId },
        subscribeToMessages: (handler: (message: WebSocketMessage) => void) => {
            mocks.handlers.add(handler);
        },
        unsubscribeToMessage: (handler: (message: WebSocketMessage) => void) => {
            mocks.handlers.delete(handler);
        },
        subscribeToReconnect: ignore,
        waitForMaxKnownEntityChangeId,
        logError: ignore
    };
});
vi.mock("../../../../services/dialog", () => ({ default: { confirm: mocks.confirm } }));
vi.mock("../../../../services/toast", () => ({
    default: { showError: mocks.showError, showMessage: mocks.showMessage }
}));
// Renders on `document.body` for `portal`, as the real one does.
vi.mock("../../../react/Modal", async () => {
    const { createPortal } = await import("preact");
    return {
        default: ({ className, show, portal, footer, onSubmit, children }: {
            className?: string;
            show?: boolean;
            portal?: boolean;
            footer?: preact.ComponentChildren;
            onSubmit?: () => void;
            children?: preact.ComponentChildren;
        }) => {
            if (!show) {
                return null;
            }
            const dialog = (
                <div className={`modal ${className ?? ""}`}>
                    <form onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
                        <div className="modal-body">{children}</div>
                        <div className="modal-footer">{footer}</div>
                    </form>
                </div>
            );
            return portal ? createPortal(dialog, document.body) : dialog;
        }
    };
});

import { renderInto } from "../../../../test/render";
import {
    makeChannel, makeList, makeReview, makeSecret, makeWebhook
} from "../../../../test/notification_channels";
import NotificationChannelsCard from "./ChannelsCard";

beforeEach(() => {
    backend.state.calls = [];
    backend.state.routes = {};
});

afterEach(() => {
    vi.clearAllMocks();
});

describe("the forwarding of this instance", () => {
    it("names why channels are off or paused, and an unreadable record", async () => {
        backend.state.routes = {
            "GET notification-channels": makeList([], {
                off: "safe-mode",
                pause: { causes: [ "restore", "rollback" ], since: "2026-11-27 10:00:00.000Z" },
                isRecordReadable: false
            })
        };
        const card = await open();
        const text = card.textContent ?? "";

        expect(text).toContain("notification_channels.forwarding_here");
        expect(text).toContain("notification_channels.off.safe-mode");
        expect(text).toContain("notification_channels.pause_causes.restore");
        expect(text).toContain("notification_channels.pause_causes.rollback");
        expect(text).not.toContain("notification_channels.pause_causes.move");
        expect(text).toContain("\"name\":\"notification-deliveries.json\"");

        await act(async () => button(card, "skip-due-notifications")?.click());
        await settle();
        expect(bodies("POST notification-channels/resume")).toEqual([ { sendDue: false } ]);
        expect(bodies("GET notification-channels")).toHaveLength(2);
    });
});

describe("a channel", () => {
    it("shows its state, its status and the actions that apply to it", async () => {
        backend.state.routes = {
            "GET notification-channels": makeList([
                makeChannel({
                    channelId: "s1",
                    status: {
                        counts: {
                            sent: 3, sentPublic: 1, skipped: 0, failed: 1, expired: 0,
                            waitingForBudget: 2
                        },
                        lastErrorCode: "http",
                        lastHttpStatus: 502,
                        runsBackendScripts: false,
                        recordHoldsActivation: true,
                        recordSequence: 1
                    }
                }),
                makeChannel({
                    channelId: "s2", runsOn: "frontend", state: "changed",
                    localCounts: {
                        sent: 1, sentPublic: 0, skipped: 0, failed: 0, expired: 0,
                        waitingForBudget: 0
                    }
                }),
                makeWebhook({ isAddressSet: false })
            ], { isForwardingInstance: false })
        };
        const card = await open();
        const [ backendScript, frontendScript, webhook ] = rows(card);

        expect(stateOf(backendScript)).toBe("enabled");
        expect(backendScript.textContent).toContain("notification_channels.counts");
        expect(backendScript.textContent).toContain("notification_channels.waiting_for_budget");
        expect(backendScript.textContent).toContain("notification_channels.last_error_http");
        expect(backendScript.textContent).toContain("\"status\":502");
        expect(backendScript.textContent)
            .toContain("notification_channels.status_backend_scripting_off");
        expect(actionsOf(backendScript)).toEqual([ "bx-paper-plane", "bx-edit" ]);

        // A frontend channel shows what this device delivered, and runs no test send.
        expect(stateOf(frontendScript)).toBe("changed");
        expect(frontendScript.textContent).toContain("notification_channels.local_counts");
        expect(actionsOf(frontendScript)).toEqual([]);
        expect(button(card, "review-channel")).not.toBeNull();

        expect(stateOf(webhook)).toBe("found");
        expect(webhook.textContent).toContain("notification_channels.address_unset_elsewhere");
        expect(actionsOf(webhook)).toEqual([ "bx-edit", "bx-trash" ]);
    });

    it("is disabled at once, and enabled only through its review", async () => {
        backend.state.routes = {
            "GET notification-channels": makeList([
                makeChannel({ channelId: "s1" }),
                makeChannel({ channelId: "s2", state: "found", activationId: undefined })
            ]),
            "DELETE notification-channels/s1/enable": {
                channel: makeChannel({ channelId: "s1", state: "found" }), isRecorded: false
            },
            "GET notification-channels/s2/review": makeReview()
        };
        const card = await open();
        const [ enabled, found ] = card.querySelectorAll<HTMLInputElement>("input.switch-toggle");
        expect(enabled.checked).toBe(true);
        expect(found.checked).toBe(false);

        await flip(enabled);
        expect(bodies("DELETE notification-channels/s1/enable")).toHaveLength(1);
        expect(mocks.showMessage)
            .toHaveBeenCalledWith("notification_channels.disable_not_recorded");

        await flip(found);
        expect(bodies("GET notification-channels/s2/review")).toHaveLength(1);
        expect(isOnBody(card, ".modal.notification-channel-dialog")).toBe(true);
        expect(bodies("POST notification-channels/s2/enable")).toHaveLength(0);
    });

    it("shows the outcome of a test send, with the message of a script as text", async () => {
        backend.state.routes = {
            "GET notification-channels": makeList([ makeChannel() ]),
            "POST notification-channels/c1/test": {
                code: "script-error", diagnostic: "<b>Refused</b> by the receiver"
            }
        };
        const card = await open();
        await act(async () => card.querySelector<HTMLButtonElement>(".bx-paper-plane")?.click());
        await settle();

        const result = card.querySelector(".notification-channel-test-result");
        expect(result?.textContent).toContain("notification_channels.outcomes.script-error");
        expect(result?.querySelector(".notification-channel-test-code")?.textContent)
            .toBe("script-error");
        const diagnostic = result?.querySelector(".notification-channel-diagnostic");
        expect(diagnostic?.textContent).toBe("<b>Refused</b> by the receiver");
        expect(diagnostic?.querySelector("b")).toBeNull();
    });

    it("is deleted after a confirmation that shows its title as text", async () => {
        backend.state.routes = {
            "GET notification-channels": makeList([ makeWebhook({ title: "<i>Pager</i>" }) ])
        };
        mocks.confirm.mockResolvedValueOnce(false);
        const card = await open();
        const trash = () => card.querySelector<HTMLButtonElement>(".bx-trash");

        await act(async () => trash()?.click());
        expect(mocks.confirm.mock.calls[0][0]).toContain("&lt;i&gt;Pager");
        expect(mocks.confirm.mock.calls[0][0]).not.toContain("<i>");
        expect(bodies("DELETE notification-channels/w1")).toHaveLength(0);

        await act(async () => trash()?.click());
        await settle();
        expect(bodies("DELETE notification-channels/w1")).toHaveLength(1);
    });

    it("offers what to do about a missing activation and an unbound template", async () => {
        backend.state.routes = {
            "GET notification-channels": makeList([
                makeChannel({ channelId: "s1", recordHold: "missing" }),
                makeWebhook({ state: "enabled", activationId: "a2", isTemplateBound: false })
            ]),
            "GET notification-channels/w1/secret": makeSecret(),
            "DELETE notification-channels/s1/enable": {
                channel: makeChannel({ channelId: "s1", state: "found" }), isRecorded: true
            }
        };
        const card = await open();
        // On the forwarding instance, the time of the last change comes from the secret route.
        expect(rows(card)[1].textContent).toContain("notification_channels.address_changed");

        expect(button(card, "enable-channel-again")).not.toBeNull();
        await act(async () => button(card, "disable-channel")?.click());
        await settle();
        expect(bodies("DELETE notification-channels/s1/enable")).toHaveLength(1);

        await act(async () => button(card, "bind-webhook-template")?.click());
        await settle();
        expect(isOnBody(card, ".modal.webhook-dialog")).toBe(true);
    });
});

describe("the list", () => {
    it("offers to add a webhook, or says that webhooks need a sync server", async () => {
        backend.state.routes = { "GET notification-channels": makeList([]) };
        const card = await open();
        expect(card.textContent).toContain("notification_channels.no_channels");
        expect(button(card, "add-webhook")).not.toBeNull();
        expect(card.querySelector(".notification-webhooks-unavailable")).toBeNull();

        backend.state.routes = { "GET notification-channels": makeList([], {}, false) };
        const standalone = await open();
        expect(button(standalone, "add-webhook")).toBeNull();
        expect(standalone.querySelector(".notification-webhooks-unavailable")?.textContent)
            .toBe("notification_channels.webhooks_need_sync_server");
    });

    it("loads again once after changes that concern channels, and not after others", async () => {
        backend.state.routes = {
            "GET notification-channels": makeList([ makeChannel({ channelId: "s1" }) ])
        };
        await open();
        const loads = () => bodies("GET notification-channels").length;
        expect(loads()).toBe(1);

        await act(async () => {
            dispatch(entityChange("notes", "unrelated"),
                entityChange("attributes", "a1", { noteId: "unrelated", name: "iconClass" }));
            await wait(600);
        });
        expect(loads()).toBe(1);

        await act(async () => {
            dispatch(entityChange("notification_channel_records", "r1"));
            dispatch(entityChange("attributes", "a2", { noteId: "s1", name: "iconClass" }),
                entityChange("attributes", "a3", { noteId: "n9", name: "notificationChannel" }));
            await wait(600);
        });
        expect(loads()).toBe(2);
    });
});

async function open() {
    let container: HTMLElement | undefined;
    await act(async () => {
        container = renderInto(<NotificationChannelsCard />);
    });
    await settle();
    if (!container) {
        throw new Error("The card was not rendered");
    }
    return container;
}

async function settle() {
    for (let round = 0; round < 3; round++) {
        await act(() => wait(0));
    }
}

function wait(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** The bodies of the requests sent to a route, by its method and URL. */
function bodies(route: string) {
    return backend.state.calls.filter((call) => call.route === route).map(({ body }) => body);
}

function button(container: HTMLElement, name: string) {
    return container.querySelector<HTMLButtonElement>(`button[name="${name}"]`);
}

/** Whether a dialog that the card opened is on `document.body`, where `portal` puts it. */
function isOnBody(card: HTMLElement, selector: string) {
    const dialog = document.querySelector(selector);
    return !!dialog && !card.contains(dialog);
}

function rows(container: HTMLElement) {
    return [ ...container.querySelectorAll<HTMLElement>(".tn-card-option.notification-channel") ];
}

function stateOf(row: HTMLElement) {
    const classes = row.querySelector(".notification-channel-state")?.classList;
    return [ "found", "enabled", "changed" ].find((state) => classes?.contains(state));
}

/** The icons of the action buttons of a row, in their order. */
function actionsOf(row: HTMLElement) {
    const icons = [ "bx-paper-plane", "bx-edit", "bx-trash" ];
    return [ ...row.querySelectorAll(".tn-card-option-actions button") ].map((action) =>
        icons.find((icon) => action.classList.contains(icon)));
}

async function flip(input: HTMLInputElement) {
    await act(async () => {
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
}

function entityChange(entityName: string, entityId: string, entity?: object): EntityChange {
    return { entityName, entityId, entity, hash: "h", isSynced: true, isErased: false };
}

function dispatch(...entityChanges: EntityChange[]) {
    for (const handler of mocks.handlers) {
        handler({ type: "frontend-update", data: { lastSyncedPush: 0, entityChanges } });
    }
}
