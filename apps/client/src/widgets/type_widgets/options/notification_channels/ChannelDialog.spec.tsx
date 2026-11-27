import type { NotificationChannelView } from "@triliumnext/commons";
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
    runBundle: vi.fn(async (_bundle: unknown): Promise<unknown> => undefined),
    showMessage: vi.fn()
}));

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
            backend.send("DELETE", url, body)
    }
}));
vi.mock("../../../../services/bundle", () => ({
    executeBundleWithoutErrorHandling: mocks.runBundle
}));
vi.mock("../../../../services/toast", () => ({
    default: { showError: vi.fn(), showMessage: mocks.showMessage }
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

import { buildNote } from "../../../../test/easy-froca";
import { makeChannel, makeReview, makeWebhook } from "../../../../test/notification_channels";
import { renderInto } from "../../../../test/render";
import ChannelDialog, { type ConfigWidgetProps } from "./ChannelDialog";

const FOUND = { state: "found", activationId: undefined } as const;

beforeEach(() => {
    backend.state.calls = [];
    backend.state.routes = {};
});

afterEach(() => {
    vi.clearAllMocks();
});

describe("the review of a script channel", () => {
    it("shows what runs as text, where it runs, and that backend scripts are off", async () => {
        const text = "Note s1 \"<img src=x onerror=alert(1)>\"\n#notificationChannel\n[U+202E]";
        backend.state.routes = {
            "GET notification-channels/s1/review": makeReview({
                text, forwardingRunsBackendScripts: false
            })
        };
        const dialog = await openDialog(makeChannel({ channelId: "s1", ...FOUND }));

        expect(dialog.querySelector(".notification-channel-review-text code")?.textContent)
            .toBe(text);
        expect(dialog.querySelector("img")).toBeNull();
        expect(dialog.textContent).toContain("notification_channels.runs_on_backend");
        expect(dialog.textContent).toContain("notification_channels.backend_scripting_off");
        expect(submitButton(dialog)?.textContent).toContain("notification_channels.enable");
    });

    it("shows only the attributes that changed, when the review names them", async () => {
        backend.state.routes = {
            "GET notification-channels/s1/review": makeReview({
                changes: [ {
                    change: "changed", type: "label", name: "iconClass",
                    previousValue: "bx bx-star", value: "bx bx-bell"
                } ]
            })
        };
        const dialog = await openDialog(makeChannel({ channelId: "s1", state: "changed" }));

        expect(dialog.querySelector(".notification-channel-review-text")).toBeNull();
        const changes = [ ...dialog.querySelectorAll(".notification-channel-changes li") ];
        expect(changes).toHaveLength(1);
        expect(changes[0].textContent).toContain("notification_channels.attribute_changed");
        expect(changes[0].querySelector("code")?.textContent)
            .toBe("#iconClass=\"bx bx-star\" → \"bx bx-bell\"");
    });

    it("runs the settings widget only on request, and enables with its labels", async () => {
        buildNote({ id: "s1", title: "Pager", "#topic": "old", "#notificationChannel": "" });
        const widgetRoute = "GET notification-channels/s1/config-widget?revision=r7";
        backend.state.routes = {
            "GET notification-channels/s1/review": makeReview({
                revision: "r7", hasConfigWidget: true
            }),
            [widgetRoute]: { bundle: { script: "", html: "", noteId: "w1", allNoteIds: [ "w1" ] } },
            "POST notification-channels/s1/enable": { channel: makeChannel(), isRecorded: true }
        };
        mocks.runBundle.mockResolvedValue(TopicWidget);
        const dialog = await openDialog(makeChannel({ channelId: "s1", ...FOUND }));
        expect(bodies(widgetRoute)).toHaveLength(0);
        expect(mocks.runBundle).not.toHaveBeenCalled();

        await act(async () => button(dialog, "run-channel-widget")?.click());
        await settle();
        expect(bodies(widgetRoute)).toHaveLength(1);
        // The widget starts from the note's own labels, without the built-in ones.
        const widget = dialog.querySelector<HTMLButtonElement>(".topic-widget");
        expect(widget?.textContent).toBe(JSON.stringify({ topic: "old" }));
        await act(async () => widget?.click());

        await enter(dialog.querySelector<HTMLInputElement>("input[type=number]"), "10");
        await choose(protectedNotes(dialog), "public");
        await submit(dialog);
        expect(bodies("POST notification-channels/s1/enable")).toEqual([ {
            revision: "r7", graceTime: 600, protectedNotes: "public",
            labels: { topic: "alerts" }
        } ]);
    });

    it("loads the review again when what the channel runs changed meanwhile", async () => {
        backend.state.routes = {
            "GET notification-channels/s1/review": makeReview(),
            "POST notification-channels/s1/enable": refusal("stale-revision")
        };
        const dialog = await openDialog(makeChannel({ channelId: "s1", ...FOUND }));
        await submit(dialog);

        expect(bodies("POST notification-channels/s1/enable")).toEqual([
            { revision: "r1", graceTime: 300, protectedNotes: "none" }
        ]);
        expect(bodies("GET notification-channels/s1/review")).toHaveLength(2);
        expect(dialog.textContent).toContain("notification_channels.review_changed");
    });
});

describe("the settings of an enabled channel", () => {
    it("are saved as a settings record that names what it read", async () => {
        backend.state.routes = {
            "GET notification-channels/s1/review": makeReview(),
            "PATCH notification-channels/s1/settings": undefined
        };
        const onChanged = vi.fn();
        const channel = makeChannel({ channelId: "s1", settingsRecordIds: [ "x1" ] });
        const dialog = await openDialog(channel, onChanged);
        expect(submitButton(dialog)?.textContent).toContain("common.save");

        await choose(protectedNotes(dialog), "public");
        await submit(dialog);
        expect(bodies("PATCH notification-channels/s1/settings")).toEqual([ {
            protectedNotes: "public", expected: { activationId: "a1", recordIds: [ "x1" ] }
        } ]);
        expect(bodies("POST notification-channels/s1/enable")).toHaveLength(0);
        expect(onChanged).toHaveBeenCalledOnce();
    });

    it("say that another device changed them, and load the list again", async () => {
        backend.state.routes = {
            "GET notification-channels/s1/review": makeReview(),
            "PATCH notification-channels/s1/settings": refusal("stale-revision")
        };
        const onChanged = vi.fn();
        const dialog = await openDialog(makeChannel({ channelId: "s1" }), onChanged);

        await choose(protectedNotes(dialog), "public");
        await submit(dialog);
        expect(dialog.textContent).toContain("notification_channels.settings_changed_elsewhere");
        expect(onChanged).toHaveBeenCalledOnce();
    });
});

describe("a built-in channel", () => {
    it("is enabled at its revision without a review of code", async () => {
        backend.state.routes = {
            "GET notification-channels/w1/review": makeReview({ revision: "h1", text: "{}" }),
            "POST notification-channels/w1/enable": { channel: makeWebhook(), isRecorded: false }
        };
        const dialog = await openDialog(makeWebhook());

        expect(dialog.querySelector(".notification-channel-review")).toBeNull();
        expect(dialog.textContent).toContain("notification_channels.runs_on_built_in");
        await submit(dialog);
        expect(bodies("POST notification-channels/w1/enable")).toEqual([
            { revision: "h1", graceTime: 300, protectedNotes: "none" }
        ]);
        expect(mocks.showMessage).toHaveBeenCalledWith("notification_channels.enable_not_recorded");
    });
});

/** A settings widget that sets the label `topic` when it is pressed. */
function TopicWidget({ settings, onChange }: ConfigWidgetProps) {
    return (
        <button
            type="button"
            className="topic-widget"
            onClick={() => onChange({ ...settings, topic: "alerts" })}
        >
            {JSON.stringify(settings)}
        </button>
    );
}

/** Opens the dialog and returns its element, which `portal` puts on `document.body`. */
async function openDialog(channel: NotificationChannelView, onChanged = vi.fn()) {
    let container: HTMLElement | undefined;
    await act(async () => {
        container = renderInto(
            <ChannelDialog channel={channel} onChanged={onChanged} onClosed={vi.fn()} />);
    });
    await settle();
    const dialog = document.querySelector<HTMLElement>(".modal.notification-channel-dialog");
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

function refusal(code: string) {
    return () => {
        throw JSON.stringify({ code });
    };
}

function bodies(route: string) {
    return backend.state.calls.filter((call) => call.route === route).map(({ body }) => body);
}

function button(container: HTMLElement, name: string) {
    return container.querySelector<HTMLButtonElement>(`button[name="${name}"]`);
}

function submitButton(container: HTMLElement) {
    return button(container, "submit-channel-dialog");
}

function protectedNotes(container: HTMLElement) {
    return container.querySelector<HTMLSelectElement>(
        "select[id^=\"notification-channel-protected-notes\"]");
}

async function enter(input: HTMLInputElement | null, value: string) {
    await act(async () => {
        if (input) {
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
        }
    });
}

async function choose(select: HTMLSelectElement | null, value: string) {
    if (!select) {
        throw new Error("No select");
    }
    await act(async () => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

async function submit(container: HTMLElement) {
    await act(async () => container.querySelector("form")?.requestSubmit());
    await settle();
}
