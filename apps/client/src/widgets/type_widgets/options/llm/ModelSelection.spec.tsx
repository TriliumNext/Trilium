import type { LlmModelInfo } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProviderModelsMock = vi.hoisted(() => vi.fn());
vi.mock("../../../../services/llm_chat", () => ({
    fetchProviderModels: fetchProviderModelsMock
}));

vi.mock("../../../../services/i18n", () => ({ t: (key: string) => key }));

// A lightweight checkbox that records its onChange so we can toggle it directly.
const checkboxHandlers = new Map<string, (checked: boolean) => void>();
vi.mock("../../../react/FormCheckbox", () => ({
    default: ({ name, currentValue, onChange }: { name?: string; currentValue: boolean; onChange: (c: boolean) => void }) => {
        checkboxHandlers.set(name ?? "", onChange);
        return <div className="checkbox-stub" data-name={name} data-checked={String(currentValue)} />;
    }
}));

import ModelSelection from "./ModelSelection";

// `recommended` is set by the server (listProviderModels); the picker only honours it.
const MODELS: LlmModelInfo[] = [
    { id: "gpt-4.1", name: "GPT-4.1", pricing: { input: 2, output: 8 }, isDefault: true, recommended: true },
    { id: "gpt-4o", name: "GPT-4o", pricing: { input: 2.5, output: 10 }, isLegacy: true, recommended: false },
    { id: "custom", name: "Custom", recommended: true }
];

let container: HTMLDivElement | undefined;

async function renderSelection(props: Parameters<typeof ModelSelection>[0]): Promise<HTMLDivElement> {
    container = document.createElement("div");
    document.body.appendChild(container);
    const target = container;
    await act(async () => { render(<ModelSelection {...props} />, target); });
    // Flush the fetch promise + the state updates it schedules.
    await act(async () => {});
    return target;
}

/** Find a toolbar button by its (echoed i18n key) label. */
function buttonByLabel(el: HTMLElement, label: string): HTMLButtonElement | undefined {
    return [...el.querySelectorAll("button")].find(b => b.textContent?.includes(label));
}

describe("ModelSelection", () => {
    beforeEach(() => {
        fetchProviderModelsMock.mockResolvedValue(MODELS);
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
        checkboxHandlers.clear();
        fetchProviderModelsMock.mockReset();
    });

    it("fetches the provider's models and renders one checkbox per model", async () => {
        const query = { provider: "openai", apiKey: "sk-test", baseURL: "http://x/v1" };
        const el = await renderSelection({ query, selected: MODELS, onChange: vi.fn() });

        expect(fetchProviderModelsMock).toHaveBeenCalledWith(query);
        const names = [...el.querySelectorAll(".checkbox-stub")].map(node => node.getAttribute("data-name"));
        expect(names).toEqual(["model-gpt-4.1", "model-gpt-4o", "model-custom"]);
    });

    it("auto-selects the server-recommended models when nothing is selected yet", async () => {
        const onChange = vi.fn();
        await renderSelection({ query: { provider: "openai" }, selected: [], onChange, autoSelectDefaults: true });
        expect(onChange).toHaveBeenCalledWith([MODELS[0], MODELS[2]]); // gpt-4o (recommended: false) excluded
    });

    it("does not auto-select when a selection already exists", async () => {
        const onChange = vi.fn();
        await renderSelection({ query: { provider: "openai" }, selected: [MODELS[0]], onChange, autoSelectDefaults: true });
        expect(onChange).not.toHaveBeenCalled();
    });

    it("leaves an empty selection untouched when auto-select is off", async () => {
        // A provider deliberately emptied to "hide all" — reopening its editor
        // must not silently re-populate it (see shouldSeedDefaultModels).
        const onChange = vi.fn();
        await renderSelection({ query: { provider: "openai" }, selected: [], onChange, autoSelectDefaults: false });
        expect(onChange).not.toHaveBeenCalled();
    });

    it("toggling a checkbox adds or removes that model", async () => {
        const onChange = vi.fn();
        await renderSelection({ query: { provider: "openai" }, selected: [MODELS[0]], onChange });

        act(() => checkboxHandlers.get("model-custom")?.(true));
        expect(onChange).toHaveBeenLastCalledWith([MODELS[0], MODELS[2]]);

        act(() => checkboxHandlers.get("model-gpt-4.1")?.(false));
        expect(onChange).toHaveBeenLastCalledWith([]);
    });

    it("select-all / select-none toggles the whole list", async () => {
        const onChange = vi.fn();
        const el = await renderSelection({ query: { provider: "openai" }, selected: [], onChange });

        const selectAll = buttonByLabel(el, "llm.models_select_all");
        act(() => selectAll?.click());
        expect(onChange).toHaveBeenLastCalledWith(MODELS);
    });

    it("reset-to-defaults re-applies the recommended selection, dropping the rest", async () => {
        const onChange = vi.fn();
        // Start with everything selected, including the non-recommended model.
        const el = await renderSelection({ query: { provider: "openai" }, selected: MODELS, onChange });

        const reset = buttonByLabel(el, "llm.models_reset_defaults");
        act(() => reset?.click());
        expect(onChange).toHaveBeenLastCalledWith([MODELS[0], MODELS[2]]); // gpt-4o (recommended: false) dropped
    });

    it("renders an error state when the fetch fails", async () => {
        fetchProviderModelsMock.mockRejectedValue(new Error("bad key"));
        const el = await renderSelection({ query: { provider: "openai" }, selected: [], onChange: vi.fn() });
        expect(el.textContent).toContain("llm.models_load_failed");
    });

    it("renders an empty state when the provider returns no models", async () => {
        fetchProviderModelsMock.mockResolvedValue([]);
        const el = await renderSelection({ query: { provider: "openai" }, selected: [], onChange: vi.fn() });
        expect(el.textContent).toContain("llm.models_none_available");
    });

    it("shows the provider's setup guidance when listing fails or comes back empty", async () => {
        // The failure state is where a self-hosted user needs instructions, so
        // the caller's checklist rides along with both non-happy paths.
        const troubleshooting = <span>check the server</span>;

        fetchProviderModelsMock.mockRejectedValue(new Error("ECONNREFUSED"));
        const failed = await renderSelection({ query: { provider: "ollama" }, selected: [], onChange: vi.fn(), troubleshooting });
        expect(failed.textContent).toContain("check the server");

        render(null, failed);
        fetchProviderModelsMock.mockResolvedValue([]);
        const empty = await renderSelection({ query: { provider: "ollama" }, selected: [], onChange: vi.fn(), troubleshooting });
        expect(empty.textContent).toContain("check the server");
    });
});
