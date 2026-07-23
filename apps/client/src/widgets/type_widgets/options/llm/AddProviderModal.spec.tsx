import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

// Uninitialized i18n returns undefined; echo the key so labels are assertable.
vi.mock("../../../../services/i18n.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../../services/i18n.js")>()),
    t: (key: string) => key
}));

// The real Modal goes through bootstrap + portals; a plain form keeps the
// content and the submit path testable in jsdom.
vi.mock("../../../react/Modal.js", () => ({
    default: (props: { children?: unknown; footer?: unknown; onSubmit?: () => void }) => (
        <form
            data-testid="modal"
            onSubmit={(e) => { e.preventDefault(); props.onSubmit?.(); }}
        >
            {props.children}
            {props.footer}
        </form>
    )
}));

import AddProviderModal, { type LlmProviderConfig } from "./AddProviderModal.js";

describe("AddProviderModal", () => {
    let host: HTMLDivElement | undefined;

    function mount(props: { onSave?: (p: LlmProviderConfig) => void } = {}) {
        host = document.createElement("div");
        document.body.appendChild(host);
        render(
            <AddProviderModal show onHidden={vi.fn()} onSave={props.onSave ?? vi.fn()} />,
            host
        );
        // The modal itself portals to document.body via createPortal.
        return document.body;
    }

    function clickCard(root: HTMLElement, name: string) {
        const card = [...root.querySelectorAll<HTMLElement>(".selectable-card")]
            .find(c => c.textContent?.includes(name));
        if (!card) throw new Error(`card ${name} not found`);
        card.click();
    }

    function typeInto(root: HTMLElement, selector: string, value: string) {
        const input = root.querySelector<HTMLInputElement>(selector);
        if (!input) throw new Error(`input ${selector} not found`);
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function submit(root: HTMLElement) {
        root.querySelector<HTMLFormElement>("[data-testid=modal]")!
            .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }

    afterEach(() => {
        if (host) {
            render(null, host);
            host.remove();
            host = undefined;
        }
        document.body.innerHTML = "";
    });

    it("offers Ollama as a provider card alongside the API providers", async () => {
        let root!: HTMLElement;
        await act(async () => { root = mount(); });
        const titles = [...root.querySelectorAll(".selectable-card")].map(c => c.textContent ?? "").join(" ");
        expect(titles).toContain("Ollama");
        expect(titles).toContain("Anthropic");
    });

    it("saves an Ollama provider without an API key, defaulting the base URL when left empty", async () => {
        const onSave = vi.fn();
        let root!: HTMLElement;
        await act(async () => { root = mount({ onSave }); });

        await act(async () => { clickCard(root, "Ollama"); });
        // Ollama needs no API key — the base URL is the primary connection detail.
        expect(root.querySelector("input[type=password]")).toBeNull();

        await act(async () => { submit(root); });
        expect(onSave).toHaveBeenCalledTimes(1);
        const saved = onSave.mock.calls[0][0] as LlmProviderConfig;
        expect(saved).toMatchObject({ provider: "ollama", apiKey: "" });
        // Left empty, the server falls back to the default local URL.
        expect(saved.baseURL).toBeUndefined();
    });

    it("saves a custom Ollama base URL and rejects an invalid one", async () => {
        const onSave = vi.fn();
        let root!: HTMLElement;
        await act(async () => { root = mount({ onSave }); });
        await act(async () => { clickCard(root, "Ollama"); });

        await act(async () => { typeInto(root, "input[placeholder='http://localhost:11434']", "not a url"); });
        await act(async () => { submit(root); });
        expect(onSave).not.toHaveBeenCalled();

        await act(async () => { typeInto(root, "input[placeholder='http://localhost:11434']", "http://ollama.lan:11434"); });
        await act(async () => { submit(root); });
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave.mock.calls[0][0]).toMatchObject({ provider: "ollama", baseURL: "http://ollama.lan:11434" });
    });
});
