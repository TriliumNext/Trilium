import { OptionNames } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

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
    class Modal {
        static getOrCreateInstance() { return new Modal(); }
        static getInstance() { return null; }
        show() {}
        hide() {}
    }
    return { Tooltip, Modal, default: { Tooltip, Modal } };
});

vi.mock("../../../services/keyboard_actions", () => ({
    default: { getAction: vi.fn(async () => ({ effectiveShortcuts: [] })) }
}));

// Shared mock fns must be created via vi.hoisted so they exist when the hoisted vi.mock factories run.
const { experimentalFeatureEnabled, confirmResult } = vi.hoisted(() => ({
    experimentalFeatureEnabled: vi.fn((_id: string) => true),
    confirmResult: vi.fn(async (_msg: string) => true)
}));

// Control whether the LLM feature is "enabled".
vi.mock("../../../services/experimental_features", () => ({
    isExperimentalFeatureEnabled: (id: string) => experimentalFeatureEnabled(id)
}));

// Drive the confirm() result for the delete flow.
vi.mock("../../../services/dialog", () => ({
    default: { confirm: (msg: string) => confirmResult(msg) },
    openDialog: vi.fn(async ($el: unknown) => $el)
}));

// Replace the modal with a lightweight stub exposing onSave/onHidden through buttons,
// keeping a real PROVIDER_TYPES export so the provider-name lookup still resolves.
vi.mock("./llm/AddProviderModal", () => ({
    PROVIDER_TYPES: [
        { id: "anthropic", name: "Anthropic", defaultBaseUrl: "https://api.anthropic.com/v1" },
        { id: "openai", name: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1" }
    ],
    default: ({ show, onHidden, onSave }: {
        show: boolean;
        onHidden: () => void;
        onSave: (p: { id: string; name: string; provider: string; apiKey: string }) => void;
    }) => (
        <div className="add-provider-stub" data-show={String(show)}>
            <button
                type="button"
                className="stub-save"
                onClick={() => onSave({ id: "openai_1", name: "OpenAI", provider: "openai", apiKey: "k" })}
            />
            <button type="button" className="stub-hide" onClick={onHidden} />
        </div>
    )
}));

import options from "../../../services/options";
import server from "../../../services/server";
import ws from "../../../services/ws";
import { ParentComponent } from "../../react/react_utils";
import LlmSettings from "./llm";

// --- Render harness -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;

function renderComponent() {
    const target = document.createElement("div");
    container = target;
    document.body.appendChild(target);
    act(() => {
        render(
            <ParentComponent.Provider value={null}>
                <LlmSettings />
            </ParentComponent.Provider>,
            target
        );
    });
    return target;
}

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

beforeEach(() => {
    setOptions({ llmProviders: "[]", mcpEnabled: "false" });
    experimentalFeatureEnabled.mockReturnValue(true);
    confirmResult.mockResolvedValue(true);
    vi.clearAllMocks();
    experimentalFeatureEnabled.mockReturnValue(true);
    confirmResult.mockResolvedValue(true);
    Object.assign(server, { put: vi.fn(async () => undefined) });
    Object.assign(ws, { logError: vi.fn() });
});

afterEach(() => {
    const target = container;
    if (target) {
        act(() => render(null, target));
        target.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Feature gating -------------------------------------------------------------------------------

describe("LlmSettings feature gating", () => {
    it("shows only the not-enabled notice when the LLM feature is disabled", () => {
        experimentalFeatureEnabled.mockReturnValue(false);
        const el = renderComponent();
        expect(el.querySelector(".options-section")).toBeTruthy();
        expect(el.querySelector("p.form-text")).toBeTruthy();
        // The provider table / MCP section must not be rendered in the disabled branch.
        expect(el.querySelector("table")).toBeNull();
        expect(el.querySelector(".switch-widget")).toBeNull();
    });

    it("renders provider and MCP sections when enabled", () => {
        const el = renderComponent();
        // Two OptionsSection cards: providers + MCP.
        expect(el.querySelectorAll(".options-section").length).toBeGreaterThanOrEqual(2);
        expect(el.querySelector(".switch-widget")).toBeTruthy();
        expect(el.querySelector(".add-provider-stub")).toBeTruthy();
    });
});

// --- Provider list / parsing ----------------------------------------------------------------------

describe("ProviderSettings & ProviderList", () => {
    it("shows the empty placeholder when no providers are configured", () => {
        setOptions({ llmProviders: "[]", mcpEnabled: "false" });
        const el = renderComponent();
        expect(el.querySelector("table")).toBeNull();
        // The "no providers" div is rendered inside the providers card.
        expect(el.querySelector("h5")).toBeTruthy();
    });

    it("treats malformed JSON as an empty provider list", () => {
        setOptions({ llmProviders: "{not json", mcpEnabled: "false" });
        const el = renderComponent();
        expect(el.querySelector("table")).toBeNull();
    });

    it("treats an empty option string as an empty provider list", () => {
        setOptions({ llmProviders: "", mcpEnabled: "false" });
        const el = renderComponent();
        expect(el.querySelector("table")).toBeNull();
    });

    it("renders a row per provider, resolving known and unknown provider types", () => {
        setOptions({
            llmProviders: JSON.stringify([
                { id: "a", name: "My OpenAI", provider: "openai", apiKey: "x" },
                { id: "b", name: "Custom", provider: "some-unknown-provider", apiKey: "y" }
            ]),
            mcpEnabled: "false"
        });
        const el = renderComponent();
        const rows = el.querySelectorAll("tbody tr");
        expect(rows.length).toBe(2);
        // First column = provider name; second column = resolved type label or raw provider id.
        const firstRowCells = rows[0]?.querySelectorAll("td");
        expect(firstRowCells?.[0]?.textContent).toBe("My OpenAI");
        expect(firstRowCells?.[1]?.textContent).toBe("OpenAI"); // resolved via PROVIDER_TYPES
        const secondRowCells = rows[1]?.querySelectorAll("td");
        expect(secondRowCells?.[1]?.textContent).toBe("some-unknown-provider"); // falls back to raw id
        // Each row exposes a delete action button.
        expect(el.querySelectorAll("tbody .icon-action").length).toBe(2);
    });
});

// --- Add provider ---------------------------------------------------------------------------------

describe("adding a provider", () => {
    it("appends the saved provider and persists the new JSON", async () => {
        setOptions({ llmProviders: "[]", mcpEnabled: "false" });
        const el = renderComponent();
        const save = el.querySelector(".stub-save");
        expect(save).toBeTruthy();
        await act(async () => { (save as HTMLButtonElement).click(); });

        expect(server.put).toHaveBeenCalled();
        const lastCall = (server.put as ReturnType<typeof vi.fn>).mock.calls.at(-1);
        const payload = lastCall?.[1] as Record<string, string> | undefined;
        const stored = payload?.llmProviders ? JSON.parse(payload.llmProviders) : [];
        expect(stored).toHaveLength(1);
        expect(stored[0]?.provider).toBe("openai");
    });

    it("opens the add modal when clicking the add button", () => {
        const el = renderComponent();
        const stub = el.querySelector(".add-provider-stub");
        expect(stub?.getAttribute("data-show")).toBe("false");

        const addButton = el.querySelector(".options-section .btn");
        expect(addButton).toBeTruthy();
        act(() => { (addButton as HTMLButtonElement).click(); });
        // Re-query after the state update toggled `show`.
        expect(el.querySelector(".add-provider-stub")?.getAttribute("data-show")).toBe("true");

        // Hiding the modal flips it back.
        act(() => { (el.querySelector(".stub-hide") as HTMLButtonElement).click(); });
        expect(el.querySelector(".add-provider-stub")?.getAttribute("data-show")).toBe("false");
    });
});

// --- Delete provider ------------------------------------------------------------------------------

describe("deleting a provider", () => {
    function seedOneProvider() {
        setOptions({
            llmProviders: JSON.stringify([ { id: "a", name: "My OpenAI", provider: "openai", apiKey: "x" } ]),
            mcpEnabled: "false"
        });
    }

    it("removes the provider after the user confirms", async () => {
        confirmResult.mockResolvedValue(true);
        seedOneProvider();
        const el = renderComponent();
        expect(el.querySelectorAll("tbody tr").length).toBe(1);

        const deleteBtn = el.querySelector("tbody .icon-action");
        await act(async () => { (deleteBtn as HTMLButtonElement).click(); });

        expect(confirmResult).toHaveBeenCalled();
        expect(server.put).toHaveBeenCalled();
        const lastCall = (server.put as ReturnType<typeof vi.fn>).mock.calls.at(-1);
        const payload = lastCall?.[1] as Record<string, string> | undefined;
        const stored = payload?.llmProviders ? JSON.parse(payload.llmProviders) : null;
        expect(stored).toEqual([]);
    });

    it("keeps the provider when the user cancels the confirmation", async () => {
        confirmResult.mockResolvedValue(false);
        seedOneProvider();
        const el = renderComponent();

        const deleteBtn = el.querySelector("tbody .icon-action");
        await act(async () => { (deleteBtn as HTMLButtonElement).click(); });

        expect(confirmResult).toHaveBeenCalled();
        expect(server.put).not.toHaveBeenCalled();
    });
});

// --- MCP settings & endpoint URL ------------------------------------------------------------------

describe("McpSettings & getMcpEndpointUrl", () => {
    it("hides the endpoint row while MCP is disabled and shows it when enabled", () => {
        setOptions({ llmProviders: "[]", mcpEnabled: "false" });
        const el = renderComponent();
        expect(el.querySelector("input[readonly]")).toBeNull();

        // Toggle the MCP switch on.
        const toggle = el.querySelector(".switch-widget input.switch-toggle");
        expect(toggle).toBeTruthy();
        act(() => { (toggle as HTMLInputElement).dispatchEvent(new Event("input", { bubbles: true })); });

        expect(el.querySelector("input[readonly]")).toBeTruthy();
    });

    it("renders the endpoint readonly when MCP is enabled from the start", () => {
        setOptions({ llmProviders: "[]", mcpEnabled: "true" });
        const el = renderComponent();
        const input = el.querySelector<HTMLInputElement>("input[readonly]");
        expect(input).toBeTruthy();
        expect(input?.value).toContain("/mcp");
    });

    it("derives the endpoint from window.glob.httpBaseUrl when present", () => {
        const glob = window.glob as unknown as Record<string, unknown>;
        const previous = glob.httpBaseUrl;
        glob.httpBaseUrl = "https://desktop.example";
        try {
            setOptions({ llmProviders: "[]", mcpEnabled: "true" });
            const el = renderComponent();
            const input = el.querySelector<HTMLInputElement>("input[readonly]");
            expect(input?.value).toBe("https://desktop.example/mcp");
        } finally {
            glob.httpBaseUrl = previous;
        }
    });

    it("derives the endpoint from window.location when no httpBaseUrl is set", () => {
        const glob = window.glob as unknown as Record<string, unknown>;
        const previous = glob.httpBaseUrl;
        glob.httpBaseUrl = undefined;
        try {
            setOptions({ llmProviders: "[]", mcpEnabled: "true" });
            const el = renderComponent();
            const input = el.querySelector<HTMLInputElement>("input[readonly]");
            expect(input?.value).toContain("//localhost:");
            expect(input?.value.endsWith("/mcp")).toBe(true);
        } finally {
            glob.httpBaseUrl = previous;
        }
    });

    it("falls back to the https default port when the location is https without an explicit port", () => {
        const glob = window.glob as unknown as Record<string, unknown>;
        const previousBaseUrl = glob.httpBaseUrl;
        glob.httpBaseUrl = undefined;
        // Override the location's protocol/port so the `https → 443` branch is exercised.
        const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
        Object.defineProperty(window, "location", {
            configurable: true,
            value: { protocol: "https:", port: "" }
        });
        try {
            setOptions({ llmProviders: "[]", mcpEnabled: "true" });
            const el = renderComponent();
            const input = el.querySelector<HTMLInputElement>("input[readonly]");
            expect(input?.value).toBe("https://localhost:443/mcp");
        } finally {
            glob.httpBaseUrl = previousBaseUrl;
            if (locationDescriptor) {
                Object.defineProperty(window, "location", locationDescriptor);
            }
        }
    });
});
