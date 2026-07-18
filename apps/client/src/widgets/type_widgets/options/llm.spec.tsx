import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { optionStore, confirmMock, modalProps } = vi.hoisted(() => ({
    optionStore: new Map<string, string>(),
    confirmMock: vi.fn(async () => true),
    modalProps: { last: undefined as undefined | { kind?: string; onSave: (p: unknown) => void } }
}));

// Options hooks backed by a plain map so the sections render without the server.
vi.mock("../../react/hooks.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks.js")>()),
    useTriliumOption: (name: string) => [
        optionStore.get(name) ?? "",
        (value: string) => { optionStore.set(name, value); }
    ],
    useTriliumOptionBool: (name: string) => [
        optionStore.get(name) === "true",
        (value: boolean) => { optionStore.set(name, String(value)); }
    ]
}));

vi.mock("../../../services/i18n.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/i18n.js")>()),
    t: (key: string) => key
}));

vi.mock("../../../services/utils.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils.js")>()),
    isStandalone: false
}));

vi.mock("../../../services/dialog.js", () => ({
    default: { confirm: confirmMock }
}));

// Page chrome and the add dialog are exercised by their own specs; capture the
// dialog props so tests can drive onSave directly.
vi.mock("./components/OptionsPageHeader.js", () => ({ default: () => null }));
vi.mock("./llm/AddProviderModal.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./llm/AddProviderModal.js")>();
    return {
        ...actual,
        default: (props: { kind?: string; onSave: (p: unknown) => void }) => {
            modalProps.last = props;
            return null;
        }
    };
});

import LlmSettings from "./llm.js";

function setProviders(providers: unknown[]) {
    optionStore.set("llmProviders", JSON.stringify(providers));
}

const LLM_PROVIDER = { id: "a1", name: "My Anthropic", provider: "anthropic", apiKey: "k" };
const SEARCH_ENGINE = { id: "sx1", name: "Home SearXNG", provider: "searxng", apiKey: "", baseURL: "http://localhost:8888", type: "search" };

describe("LlmSettings web search section", () => {
    let host: HTMLDivElement | undefined;

    async function mount() {
        host = document.createElement("div");
        document.body.appendChild(host);
        const target = host;
        await act(async () => { render(<LlmSettings />, target); });
        return target;
    }

    beforeEach(() => {
        optionStore.clear();
        optionStore.set("aiEnabled", "true");
        confirmMock.mockReset();
        confirmMock.mockResolvedValue(true);
        modalProps.last = undefined;
    });

    afterEach(() => {
        if (host) {
            render(null, host);
            host.remove();
            host = undefined;
        }
    });

    it("splits configured entries between the provider and search engine sections", async () => {
        setProviders([LLM_PROVIDER, SEARCH_ENGINE]);
        const el = await mount();

        const sections = [...el.querySelectorAll(".options-section")].map(s => s.textContent ?? "");
        const providerSection = sections.find(s => s.includes("llm.configured_providers"))!;
        const searchSection = sections.find(s => s.includes("llm.web_search_title"))!;

        expect(providerSection).toContain("My Anthropic");
        expect(providerSection).not.toContain("Home SearXNG");
        expect(searchSection).toContain("Home SearXNG");
        expect(searchSection).not.toContain("My Anthropic");
        // The engine dropdown lists the provider default plus each configured engine.
        const options = [...el.querySelectorAll("select option")].map(o => o.textContent);
        expect(options).toContain("llm.web_search_provider_default");
        expect(options).toContain("Home SearXNG");
    });

    it("auto-selects a newly added engine while the provider default is active", async () => {
        setProviders([]);
        await mount();

        const searchModal = modalProps.last;
        expect(searchModal?.kind).toBe("search");
        await act(async () => { searchModal!.onSave({ ...SEARCH_ENGINE }); });

        expect(JSON.parse(optionStore.get("llmProviders")!)).toHaveLength(1);
        expect(optionStore.get("llmWebSearchEngine")).toBe("sx1");
    });

    it("deletes an engine after confirmation and falls back to the provider default", async () => {
        setProviders([SEARCH_ENGINE]);
        optionStore.set("llmWebSearchEngine", "sx1");
        const el = await mount();

        const searchSection = [...el.querySelectorAll(".options-section")]
            .find(s => s.textContent?.includes("llm.web_search_title"))!;
        await act(async () => {
            searchSection.querySelector<HTMLButtonElement>("[title='llm.delete_provider'], button")!.click();
        });

        expect(confirmMock).toHaveBeenCalled();
        expect(JSON.parse(optionStore.get("llmProviders")!)).toEqual([]);
        expect(optionStore.get("llmWebSearchEngine")).toBe("provider");
    });

    it("keeps the engine when the deletion is not confirmed", async () => {
        confirmMock.mockResolvedValue(false);
        setProviders([SEARCH_ENGINE]);
        const el = await mount();

        const searchSection = [...el.querySelectorAll(".options-section")]
            .find(s => s.textContent?.includes("llm.web_search_title"))!;
        await act(async () => {
            searchSection.querySelector<HTMLButtonElement>("[title='llm.delete_provider'], button")!.click();
        });

        expect(JSON.parse(optionStore.get("llmProviders")!)).toHaveLength(1);
    });
});
