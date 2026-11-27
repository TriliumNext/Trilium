import type { NotificationChannelView } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => {
    const state = {
        calls: [] as { route: string; body?: unknown }[],
        routes: {} as Record<string, unknown>,
        credentials: [] as unknown[]
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

vi.mock("../../../../services/i18n", () => ({
    t: (key: string, options?: object) => (options ? `${key} ${JSON.stringify(options)}` : key)
}));
vi.mock("../../../../services/server", () => ({
    default: {
        get: async (url: string) => backend.send("GET", url),
        getWithSilentErrors: async (url: string) => backend.send("GET", url),
        post: async (url: string, body?: unknown) => backend.send("POST", url, body),
        postWithSilentErrors: async (url: string, body?: unknown) =>
            backend.send("POST", url, body),
        patch: async (url: string, body?: unknown) => backend.send("PATCH", url, body),
        remove: async (url: string, _componentId?: string, body?: unknown) =>
            backend.send("DELETE", url, body),
        withCredentials: async (
            method: string, url: string, body: unknown, credentials: unknown
        ) => {
            backend.state.credentials.push(credentials);
            return backend.send(`${method} with credentials`, url, body);
        }
    }
}));
vi.mock("../../../../services/toast", () => ({
    default: { showError: vi.fn(), showMessage: vi.fn() }
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

import options from "../../../../services/options";
import {
    makeForwarding, makeSecret, makeWebhook
} from "../../../../test/notification_channels";
import { renderInto } from "../../../../test/render";
import WebhookDialog, { getSecretChange } from "./WebhookDialog";

const SECRET_ROUTE = "notification-channels/w1/secret";
const PUT_SECRET = `PUT with credentials ${SECRET_ROUTE}`;

beforeEach(() => {
    backend.state.calls = [];
    backend.state.credentials = [];
    backend.state.routes = {
        [`GET ${SECRET_ROUTE}`]: makeSecret(),
        "GET totp/status": { set: false, isCodeAsked: false }
    };
    options.set("isPasswordSet", "true");
});

afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
});

describe("a webhook on the forwarding instance", () => {
    it("saves a changed template with the address after one password prompt", async () => {
        const dialog = await openDialog(makeWebhook({ config: { template: "{}" } }));
        const template = "{\n    \"message\": \"{{title}}\"\n}";
        await type(templateBox(dialog), template);
        await submit(dialog);

        expect(credentialsBoxes()).toHaveLength(1);
        expect(sentRoutes()).toEqual([]);
        await answerCredentials("the password");

        expect(sentRoutes()).toEqual([ "PATCH notification-channels/w1", PUT_SECRET ]);
        expect(bodies("PATCH notification-channels/w1")).toEqual([
            { title: "Webhook", config: { template } }
        ]);
        expect(bodies(PUT_SECRET)).toEqual([ { template, expected: 3 } ]);
        expect(backend.state.credentials).toEqual([ { password: "the password", code: "" } ]);
        expect(credentialsBoxes()).toHaveLength(0);
    });

    it("asks for a password only where one is set", async () => {
        options.set("isPasswordSet", "false");
        const dialog = await openDialog(makeWebhook());
        await type(templateBox(dialog), "{}");
        await submit(dialog);
        expect(credentialsBoxes()).toHaveLength(0);
        expect(dialog.textContent).toContain("notification_channels.refusals.password-not-set");
        expect(sentRoutes()).toEqual([]);

        // The route refuses with the same code when the server has no password.
        options.set("isPasswordSet", "true");
        backend.state.routes[PUT_SECRET] = () => {
            throw JSON.stringify({ code: "password-not-set" });
        };
        await submit(dialog);
        await answerCredentials("guess");
        expect(sentRoutes()).toEqual([ "PATCH notification-channels/w1", PUT_SECRET ]);
        expect(dialog.textContent).toContain("notification_channels.refusals.password-not-set");
    });

    it("sends a new address without the credentials of the old one, and says so", async () => {
        const dialog = await openDialog(makeWebhook());
        expect(entryNames(dialog, "webhook-headers")).toEqual([ "Authorization" ]);

        await type(textBox(dialog, "webhook-url"), "https://ntfy.example/alerts");
        expect(entryNames(dialog, "webhook-headers")).toEqual([]);
        expect(dialog.textContent).toContain("notification_channels.new_address");
        await type(dialog.querySelector("input[name=\"webhook-headers-name\"]"), "X-Priority");
        await type(dialog.querySelector("input[name=\"webhook-headers-value\"]"), "high");
        await act(async () => button(dialog, "webhook-headers-add")?.click());
        await submit(dialog);
        await answerCredentials("the password");

        expect(sentRoutes()).toEqual([ PUT_SECRET ]);
        expect(bodies(PUT_SECRET)).toEqual([ {
            url: "https://ntfy.example/alerts",
            label: "ntfy on the NAS",
            network: { allowPrivate: false, allowLoopback: false },
            headers: { "X-Priority": "high" },
            values: {},
            template: "",
            expected: 3
        } ]);
    });

    it("deletes a stored header on save, and drops one added in the dialog", async () => {
        const dialog = await openDialog(makeWebhook());
        await type(dialog.querySelector("input[name=\"webhook-headers-name\"]"), "X-Priority");
        await type(dialog.querySelector("input[name=\"webhook-headers-value\"]"), "high");
        await act(async () => button(dialog, "webhook-headers-add")?.click());
        expect(entryNames(dialog, "webhook-headers")).toEqual([ "Authorization", "X-Priority" ]);

        for (const entryName of [ "X-Priority", "Authorization" ]) {
            const deleteButton = entryRow(dialog, "webhook-headers", entryName)
                ?.querySelector<HTMLButtonElement>("button.bx-x");
            expect(deleteButton, entryName).toBeTruthy();
            await act(async () => deleteButton?.click());
        }
        expect(entryNames(dialog, "webhook-headers")).toEqual([]);

        await submit(dialog);
        await answerCredentials("the password");
        expect(bodies(PUT_SECRET)).toEqual([
            { headers: { Authorization: null }, template: "", expected: 3 }
        ]);
    });

    it("starts from a known receiver's template, and names the values it lacks", async () => {
        const dialog = await openDialog(makeWebhook());
        await act(async () => button(dialog, "webhook-template-pushover")?.click());

        expect(templateBox(dialog)?.value).toContain("\"token\": \"{{secret.token}}\"");
        expect(templateBox(dialog)?.value).toContain("\"user\": \"{{secret.user}}\"");
        expect(dialog.querySelector(".webhook-template-missing")?.textContent)
            .toContain("\"names\":\"user\"");
    });

    it("adds a webhook, then enters its address under the new ID", async () => {
        backend.state.routes = {
            ...backend.state.routes,
            "POST notification-channels": { channel: makeWebhook({ channelId: "n1" }) },
            "GET notification-channels/n1/secret": makeSecret({
                isSet: false, version: 0, headers: [], values: []
            })
        };
        const dialog = await openDialog(undefined);
        expect(dialog.querySelector(".webhook-network")).toBeNull();

        await type(textBox(dialog, "webhook-url"), "https://hooks.example/abc");
        await submit(dialog);
        await answerCredentials("the password");

        expect(bodies("POST notification-channels")).toEqual([ {
            type: "webhook",
            title: "notification_channels.webhook_default_title",
            config: { template: "" }
        } ]);
        expect(bodies("PUT with credentials notification-channels/n1/secret")).toEqual([ {
            url: "https://hooks.example/abc",
            label: "",
            network: { allowPrivate: false, allowLoopback: false },
            headers: {},
            values: {},
            template: "",
            expected: 0
        } ]);
    });
});

describe("a webhook on another instance", () => {
    it("shows the template read-only, says where the address is set, asks nothing", async () => {
        const template = "{\"message\": \"{{title}}\"}";
        const dialog = await openDialog(makeWebhook({ config: { template } }), false);

        expect(templateBox(dialog)).toBeNull();
        expect(dialog.querySelector(".webhook-template-text code")?.textContent).toBe(template);
        expect(dialog.textContent).toContain("notification_channels.address_set_elsewhere");

        await type(textBox(dialog, "webhook-title"), "Pager");
        await submit(dialog);
        expect(credentialsBoxes()).toHaveLength(0);
        expect(sentRoutes()).toEqual([ "PATCH notification-channels/w1" ]);
        expect(bodies("PATCH notification-channels/w1")).toEqual([ { title: "Pager" } ]);
    });
});

describe("getSecretChange", () => {
    it("sends what changed, and a template that needs binding, but nothing for no change", () => {
        const secret = makeSecret();
        const edit = {
            url: "", label: "ntfy on the NAS", headers: {}, values: {},
            network: { allowPrivate: false, allowLoopback: false }
        };

        expect(getSecretChange(edit, secret, false)).toBeNull();
        expect(getSecretChange(edit, secret, true)).toEqual({});
        expect(getSecretChange({ ...edit, label: "Phone", values: { token: null } }, secret, false))
            .toEqual({ label: "Phone", values: { token: null } });
        // Without an address, a template has nothing to be bound to.
        expect(getSecretChange(edit, makeSecret({ isSet: false }), true)).toBeNull();
    });
});

/** Opens the dialog and returns its element, which `portal` puts on `document.body`. */
async function openDialog(channel: NotificationChannelView | undefined, isForwarding = true) {
    let container: HTMLElement | undefined;
    await act(async () => {
        container = renderInto(
            <WebhookDialog
                channel={channel}
                forwarding={makeForwarding({ isForwardingInstance: isForwarding })}
                onChanged={vi.fn()}
                onClosed={vi.fn()}
            />
        );
    });
    await settle();
    const dialog = document.querySelector<HTMLElement>(".modal.webhook-dialog");
    if (!container || !dialog || container.contains(dialog)) {
        throw new Error("The dialog was not rendered on the body");
    }
    return dialog;
}

async function settle() {
    for (let round = 0; round < 3; round++) {
        await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    }
}

/** The routes that changed something, in the order they were sent. */
function sentRoutes() {
    return backend.state.calls.map(({ route }) => route)
        .filter((route) => !route.startsWith("GET"));
}

function bodies(route: string) {
    return backend.state.calls.filter((call) => call.route === route).map(({ body }) => body);
}

function button(container: HTMLElement, name: string) {
    return container.querySelector<HTMLButtonElement>(`button[name="${name}"]`);
}

function textBox(container: HTMLElement, name: string) {
    return container.querySelector<HTMLInputElement>(`input[id^="${name}"]`);
}

function templateBox(container: HTMLElement) {
    return container.querySelector<HTMLTextAreaElement>("textarea.webhook-template-text");
}

function entryNames(container: HTMLElement, name: string) {
    return [ ...container.querySelectorAll(`.${name} .webhook-secret-entry code`) ]
        .map((code) => code.textContent);
}

function entryRow(container: HTMLElement, name: string, entryName: string) {
    return [ ...container.querySelectorAll(`.${name} .webhook-secret-entry`) ]
        .find((row) => row.querySelector("code")?.textContent === entryName);
}

function credentialsBoxes() {
    return [ ...document.querySelectorAll<HTMLInputElement>(".credentials-modal input") ];
}

async function type(field: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
    if (!field) {
        throw new Error("No field");
    }
    await act(async () => {
        field.value = value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

async function submit(container: HTMLElement) {
    await act(async () => container.querySelector("form")?.requestSubmit());
    await settle();
}

async function answerCredentials(password: string) {
    await type(credentialsBoxes()[0] ?? null, password);
    await act(async () => {
        document.querySelector<HTMLFormElement>(".credentials-modal form")?.requestSubmit();
    });
    await settle();
}
