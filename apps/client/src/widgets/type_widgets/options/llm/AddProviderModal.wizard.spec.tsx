import type { LlmModelInfo } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    onSave: vi.fn(),
    onHidden: vi.fn(),
    /** The Antigravity download found for the device running Trilium. */
    antigravityDownload: {} as { version?: string; url?: string }
}));

vi.mock("./antigravity_download", () => ({ useAntigravityDownload: () => mocks.antigravityDownload }));

/** Messages whose text a case depends on; every other key renders as itself. */
const MESSAGES = vi.hoisted<Record<string, string>>(() => ({
    "llm.antigravity_agent_description": "Uses your Google account.\n\nDownload the server.\n\nSign in once."
}));

vi.mock("../../../../services/i18n", () => ({ t: (key: string) => MESSAGES[key] ?? key }));

// Renders the key, inside the `Link` component when one is passed, so links can be looked up.
vi.mock("react-i18next", async () => {
    const { cloneElement } = await import("preact");
    return {
        Trans: ({ i18nKey, components }: { i18nKey: string; components?: { Link?: preact.VNode } }) =>
            components?.Link ? cloneElement(components.Link, {}, i18nKey) : <>{i18nKey}</>
    };
});

/*
 * Stands in for the wizard shell, keeping only what drives it: the step being shown, and the one
 * button that leaves it. The real one opens through Bootstrap, which happy-dom cannot carry — and it
 * throws from an effect, which abandons the rest of that flush along with it.
 */
vi.mock("../../../react/WizardModal", () => ({
    default: ({ show, steps, step, onStepChange, onFinish }: {
        show?: boolean;
        steps: { id: string; content: preact.ComponentChildren; canContinue?: boolean }[];
        step: string;
        onStepChange: (id: string) => void;
        onFinish: () => void;
    }) => {
        if (!show) return null;

        const index = steps.findIndex((candidate) => candidate.id === step);
        const current = steps[index];
        const isLast = index === steps.length - 1;

        return (
            <div className="wizard-stub">
                <div className="wizard-step">{current?.content}</div>
                <button
                    className="wizard-next"
                    disabled={current?.canContinue === false}
                    onClick={() => (isLast ? onFinish() : onStepChange(steps[index + 1].id))}
                >next</button>
            </div>
        );
    }
}));

// Listing a provider's models is a request of its own, and none of these cases are about it.
// The stub renders the checklist it is handed, which the screen shows when listing fails.
vi.mock("./ModelSelection", () => ({
    default: ({ troubleshooting }: { troubleshooting?: preact.ComponentChildren }) => <div className="model-selection-stub">{troubleshooting}</div>
}));

import AddProviderModal, { type LlmProviderConfig } from "./AddProviderModal";

let host: HTMLElement;

beforeEach(() => {
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
    vi.clearAllMocks();
    mocks.antigravityDownload = {};
});

function open(existingProvider?: LlmProviderConfig) {
    act(() => {
        render(null, host);
        render(
            <AddProviderModal
                show
                onHidden={mocks.onHidden}
                onSave={mocks.onSave}
                existingProvider={existingProvider}
            />,
            host
        );
    });
}

const nextButton = () => document.querySelector<HTMLButtonElement>("button.wizard-next");
const providerCard = (name: string) =>
    [ ...document.querySelectorAll<HTMLElement>(".selectable-card") ]
        .find((card) => card.textContent?.includes(name));
const textBoxes = () => [ ...document.querySelectorAll<HTMLInputElement>(".wizard-step input[type='text'], .wizard-step input[type='password']") ];

/** Types into one of the connection fields, as a keystroke rather than an assignment. */
function type(box: HTMLInputElement | undefined, value: string) {
    if (!box) return;
    act(() => {
        box.value = value;
        box.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

/** Walks to the last step, where the wizard's button commits what has been entered. */
function finish() {
    act(() => void nextButton()?.click());
    act(() => void nextButton()?.click());
}

describe("the model step", () => {
    /** Picks a provider and moves on to the model step. */
    function modelStepFor(name: string) {
        open();
        act(() => providerCard(name)?.click());
        act(() => void nextButton()?.click());
        return document.querySelector(".model-selection-stub");
    }

    it("offers the setup steps that fit the provider when its models cannot be listed", () => {
        const antigravity = modelStepFor("Google Antigravity");
        expect(antigravity?.textContent).toContain("llm.antigravity_setup_download");
        expect(antigravity?.textContent).toContain("llm.antigravity_setup_path");
        expect(antigravity?.textContent).toContain("llm.antigravity_setup_sign_in");
        expect(antigravity?.textContent).not.toContain("llm.troubleshoot_server_running");

        expect(modelStepFor("Ollama")?.textContent).toContain("llm.troubleshoot_server_running");
        expect(modelStepFor("Claude Code")?.textContent).toBe("");
    });

    it("links the exact download for the device running Trilium when one was found", () => {
        mocks.antigravityDownload = { version: "1.1.1", url: "https://dl.google.com/agy.zip" };

        const step = modelStepFor("Google Antigravity");
        const link = step?.querySelector<HTMLAnchorElement>("a[href='https://dl.google.com/agy.zip']");
        expect(link?.textContent).toBe("llm.antigravity_setup_archive");
        expect(link?.target).toBe("_blank");
        expect(step?.querySelector("button")).toBeNull();
        expect(step?.textContent).not.toContain("llm.antigravity_setup_download");

        // Without one, the step links the registry entry instead.
        mocks.antigravityDownload = {};
        const fallback = modelStepFor("Google Antigravity");
        expect(fallback?.querySelector("a[href*='agentclientprotocol/registry']")?.textContent).toBe("llm.antigravity_setup_download");
        expect(fallback?.querySelector("a[href*='dl.google.com']")).toBeNull();
    });
});

describe("picking a provider", () => {
    it("holds the step until one has been chosen, rather than taking whichever is first", () => {
        open();
        expect(nextButton()?.disabled).toBe(true);
    });

    it("moves straight on once a card is pressed, the choice being the action", () => {
        open();
        act(() => providerCard("OpenAI")?.click());

        // The picker is gone: what is on screen now is the chosen provider's connection step.
        expect(providerCard("OpenAI")).toBeUndefined();
        expect(textBoxes().length).toBeGreaterThan(0);
    });

    it("writes in the endpoint only for a provider whose port is the user's to get right", () => {
        open();
        act(() => providerCard("Ollama")?.click());
        // Self-hosted: the default is filled in so the port can be corrected rather than guessed.
        expect(textBoxes().some((box) => box.value.startsWith("http"))).toBe(true);

        open();
        act(() => providerCard("OpenAI")?.click());
        // A vendor's endpoint is a hint only, so an unedited field stores no override.
        expect(textBoxes().every((box) => box.value === "")).toBe(true);
    });
});

describe("the connection step", () => {
    it("will not go on without the key a vendor requires, and will once it has one", () => {
        open();
        act(() => providerCard("OpenAI")?.click());
        expect(nextButton()?.disabled).toBe(true);

        type(textBoxes()[0], "sk-abc");
        expect(nextButton()?.disabled).toBe(false);
    });

    it("asks nothing of a provider that signs in through its own program", () => {
        open();
        act(() => providerCard("Claude Code")?.click());

        // No key, no endpoint — the step is complete the moment it is reached.
        expect(nextButton()?.disabled).toBe(false);
    });

    it("shows such a provider's description one paragraph at a time", () => {
        open();
        act(() => providerCard("Google Antigravity")?.click());

        const paragraphs = [ ...document.querySelectorAll(".wizard-step p") ].map((p) => p.textContent);
        expect(paragraphs).toEqual([ "Uses your Google account.", "Download the server.", "Sign in once." ]);
    });

    it("opens on the connection step when editing, the provider type being fixed by then", () => {
        open({ id: "openai_1", name: "OpenAI", provider: "openai", apiKey: "sk-old" });

        expect(providerCard("OpenAI")).toBeUndefined();
        expect(textBoxes()[0]?.value).toBe("sk-old");
    });
});

describe("what gets saved", () => {
    it("stores the key and the provider it belongs to, and no endpoint that was never set", () => {
        open();
        act(() => providerCard("OpenAI")?.click());
        type(textBoxes()[0], "  sk-abc  ");
        finish();

        const [ saved ] = mocks.onSave.mock.calls[0] as [ LlmProviderConfig ];
        expect(saved).toMatchObject({ provider: "openai", name: "OpenAI", apiKey: "sk-abc" });
        // Left out entirely rather than stored empty, so the provider's own default stands.
        expect(saved).not.toHaveProperty("baseURL");
    });

    it("stores no key at all for a provider that authenticates elsewhere", () => {
        open();
        act(() => providerCard("Claude Code")?.click());
        finish();

        const [ saved ] = mocks.onSave.mock.calls[0] as [ LlmProviderConfig ];
        expect(saved.apiKey).toBe("");
        expect(saved).not.toHaveProperty("baseURL");
    });

    it("keeps the id of the provider being edited, so it replaces rather than adds", () => {
        const existing: LlmProviderConfig = {
            id: "openai_123",
            name: "OpenAI",
            provider: "openai",
            apiKey: "sk-old",
            selectedModels: [ { id: "gpt-4" } as LlmModelInfo ]
        };

        open(existing);
        type(textBoxes()[0], "sk-new");
        act(() => void nextButton()?.click());
        act(() => void nextButton()?.click());

        const [ saved ] = mocks.onSave.mock.calls[0] as [ LlmProviderConfig ];
        expect(saved.id).toBe("openai_123");
        expect(saved.apiKey).toBe("sk-new");
        // The stored selection is carried through rather than reset by reopening the editor.
        expect(saved.selectedModels).toEqual(existing.selectedModels);
    });

    it("puts the dialog away once it has saved", () => {
        open();
        act(() => providerCard("Claude Code")?.click());
        finish();

        expect(mocks.onHidden).toHaveBeenCalled();
    });
});
