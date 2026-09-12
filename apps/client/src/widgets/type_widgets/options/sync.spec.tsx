import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    stored: {} as Record<string, string>,
    /** Every option write, in the order it was made — the test connection depends on that order. */
    saved: [] as [ string, string ][],
    post: vi.fn(async () => ({ success: true, message: "ok" })),
    showMessage: vi.fn(),
    showError: vi.fn()
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

// Replacing the shared server mock means also answering what the modules pulled in alongside the
// page ask for on import — the options load and the keyboard actions.
vi.mock("../../../services/server", () => ({
    default: {
        post: mocks.post,
        get: async (url: string) => (url === "keyboard-actions" ? [] : {})
    }
}));

vi.mock("../../../services/toast", () => ({
    default: { showMessage: mocks.showMessage, showError: mocks.showError }
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useTriliumOption: (name: string) => [
        mocks.stored[name] ?? "",
        async (value: string) => void mocks.saved.push([ name, value ])
    ]
}));

vi.mock("./components/OptionsPageHeader", () => ({ default: () => <div className="header-stub" /> }));

import SyncOptions from "./sync";

let host: HTMLElement;

beforeEach(() => {
    // What a real install holds for the timeout row: a figure and the scale it is read at.
    mocks.stored = { syncServerTimeout: "120", syncServerTimeoutTimeScale: "1" };
    mocks.saved = [];
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
    vi.clearAllMocks();
});

function open() {
    act(() => {
        render(<SyncOptions />, host);
    });
}

const testButton = () => host.querySelector<HTMLButtonElement>("button[name='test-sync-button']");

/** Presses "Test now" and lets it settle: it saves, then posts, and only then reports. */
async function pressTest() {
    await act(async () => testButton()?.click());
    await act(async () => {});
}

/** Types into one of the address boxes, as a keystroke rather than an assignment. */
function type(index: number, value: string) {
    const box = [ ...host.querySelectorAll<HTMLInputElement>("input[type='text']") ][index];
    act(() => {
        box.value = value;
        box.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

describe("the sync settings", () => {
    it("keeps the test apart from the settings it checks, in a card with no heading of its own", () => {
        open();

        const headings = [ ...host.querySelectorAll(".tn-card-heading") ].map((heading) => heading.textContent);
        expect(headings).toEqual([ "sync_2.config_title" ]);

        // Its own card all the same, so it reads as an action rather than one more setting.
        expect(testButton()?.closest(".tn-card")).not.toBeNull();
        expect(testButton()?.closest(".tn-card")?.querySelector(".tn-card-heading")).toBeNull();
    });

    it("commits what has been typed before testing, so the test uses the address on screen", async () => {
        open();
        type(0, "https://sync.example.com:8080");
        type(1, "https://proxy.example.com:3128");

        await pressTest();

        expect(mocks.saved).toEqual([
            [ "syncServerHost", "https://sync.example.com:8080" ],
            [ "syncProxy", "https://proxy.example.com:3128" ]
        ]);
        expect(mocks.post).toHaveBeenCalledWith("sync/test");
    });

    it("reports what the server said on a successful handshake", async () => {
        open();
        await pressTest();

        expect(mocks.showMessage).toHaveBeenCalledWith("ok");
        expect(mocks.showError).not.toHaveBeenCalled();
    });

    it("reports a refused handshake as a failure, even when the server explains itself", async () => {
        mocks.post.mockResolvedValueOnce({ success: false, message: "no route to host" });
        open();

        await pressTest();
        expect(mocks.showError).toHaveBeenCalled();
        expect(mocks.showMessage).not.toHaveBeenCalled();
    });
});
