import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    features: [] as { id: string; name: string; description: string }[],
    enabled: [] as string[],
    saved: [] as string[][],
    post: vi.fn(async (_url: string) => ({}))
}));

vi.mock("../../../services/experimental_features", () => ({
    getAvailableExperimentalFeatures: () => mocks.features
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
    default: { showMessage: vi.fn(), showError: vi.fn() }
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useTriliumOptionJson: () => [ mocks.enabled, (value: string[]) => void mocks.saved.push(value) ]
}));

vi.mock("./components/OptionsPageHeader", () => ({ default: () => <div className="header-stub" /> }));

import AdvancedSettings from "./advanced";

let host: HTMLElement;

beforeEach(() => {
    mocks.features = [
        { id: "new-layout", name: "New layout", description: "…" },
        { id: "llm", name: "AI", description: "…" },
        { id: "spreadsheets", name: "Spreadsheets", description: "…" }
    ];
    mocks.enabled = [];
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
        render(<AdvancedSettings />, host);
    });
}

const cardHeadings = () => [ ...host.querySelectorAll(".tn-card-heading") ].map((heading) => heading.textContent);
const featureSwitches = () => [ ...host.querySelectorAll<HTMLInputElement>("input.switch-toggle") ];

describe("the experimental features card", () => {
    it("leaves out the features that are switched somewhere better suited to them", () => {
        open();

        // The layout has its own illustrated choice on Appearance, and the AI switch heads its own page.
        expect(featureSwitches()).toHaveLength(1);
        expect(host.querySelector(".tn-card-option-label")?.firstChild?.textContent).toBe("Spreadsheets");
    });

    it("stands down entirely when nothing is left to offer, rather than showing an empty card", () => {
        mocks.features = [ { id: "llm", name: "AI", description: "…" } ];
        open();

        expect(cardHeadings()).toEqual([ "sync.title" ]);
    });

    it("adds a feature to the set it is turned on in, and takes it back out again", () => {
        open();
        act(() => void featureSwitches()[0].dispatchEvent(new Event("input", { bubbles: true })));
        expect(mocks.saved.at(-1)).toEqual([ "spreadsheets" ]);

        mocks.enabled = [ "spreadsheets" ];
        open();
        act(() => void featureSwitches()[0].dispatchEvent(new Event("input", { bubbles: true })));
        expect(mocks.saved.at(-1)).toEqual([]);
    });
});

describe("the advanced sync actions", () => {
    it("asks the server for each of the two repairs it offers", async () => {
        open();

        const [ forceSync, fillChanges ] = [ ...host.querySelectorAll<HTMLButtonElement>(".tn-card-option button") ];
        await act(async () => forceSync.click());
        await act(async () => fillChanges.click());

        expect(mocks.post.mock.calls.map(([ url ]) => url)).toEqual([
            "sync/force-full-sync",
            "sync/fill-entity-changes"
        ]);
    });
});
