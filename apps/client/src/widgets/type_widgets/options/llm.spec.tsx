import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { optionStore } = vi.hoisted(() => ({
    optionStore: new Map<string, string>()
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

// Page chrome and the add dialog are exercised elsewhere.
vi.mock("./components/OptionsPageHeader.js", () => ({ default: () => null }));
vi.mock("./llm/AddProviderModal.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./llm/AddProviderModal.js")>();
    return { ...actual, default: () => null };
});

import LlmSettings from "./llm.js";

describe("LlmSettings semantic search section", () => {
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
    });

    afterEach(() => {
        if (host) {
            render(null, host);
            host.remove();
            host = undefined;
        }
    });

    it("renders the embedding model row with the configured value", async () => {
        optionStore.set("llmEmbeddingModel", "mxbai-embed-large");
        const el = await mount();

        expect(el.textContent).toContain("llm.semantic_search_title");
        const input = el.querySelector<HTMLInputElement>("input[placeholder='nomic-embed-text']");
        expect(input?.value).toBe("mxbai-embed-large");
    });

    it("stores an updated embedding model", async () => {
        const el = await mount();
        const input = el.querySelector<HTMLInputElement>("input[placeholder='nomic-embed-text']");
        if (!input) throw new Error("embedding model input not found");

        await act(async () => {
            input.value = "granite-embedding";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(optionStore.get("llmEmbeddingModel")).toBe("granite-embedding");
    });

    it("hides the sections while AI features are disabled", async () => {
        optionStore.set("aiEnabled", "false");
        const el = await mount();
        expect(el.textContent).not.toContain("llm.semantic_search_title");
    });
});
