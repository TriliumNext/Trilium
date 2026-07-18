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

import AddProviderModal, { getProviderKind, type LlmProviderConfig } from "./AddProviderModal.js";

describe("AddProviderModal", () => {
    let host: HTMLDivElement | undefined;

    function mount(props: { kind?: "llm" | "search"; onSave?: (p: LlmProviderConfig) => void; onHidden?: () => void }) {
        host = document.createElement("div");
        document.body.appendChild(host);
        render(
            <AddProviderModal
                show
                onHidden={props.onHidden ?? vi.fn()}
                onSave={props.onSave ?? vi.fn()}
                kind={props.kind}
            />,
            host
        );
        // The modal itself portals to document.body via createPortal.
        return document.body;
    }

    function cardTitles(root: HTMLElement) {
        return [...root.querySelectorAll(".selectable-card")].map(c => c.textContent ?? "");
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

    it("offers LLM providers by default and search engines for kind=search", async () => {
        let root!: HTMLElement;
        await act(async () => { root = mount({}); });
        expect(cardTitles(root).join(" ")).toContain("Anthropic");
        expect(cardTitles(root).join(" ")).not.toContain("Tavily");
        await act(async () => { render(null, host!); });
        document.body.innerHTML = "";

        await act(async () => { root = mount({ kind: "search" }); });
        const titles = cardTitles(root).join(" ");
        expect(titles).toContain("Tavily");
        expect(titles).toContain("SearXNG");
        expect(titles).not.toContain("Anthropic");
    });

    it("saves a Tavily engine with type search, api key and custom display name", async () => {
        const onSave = vi.fn();
        let root!: HTMLElement;
        await act(async () => { root = mount({ kind: "search", onSave }); });

        await act(async () => { clickCard(root, "Tavily"); });
        await act(async () => {
            typeInto(root, "input[type=password]", "tvly-secret");
            typeInto(root, "input[placeholder=Tavily]", "Work Tavily");
        });
        await act(async () => { submit(root); });

        expect(onSave).toHaveBeenCalledTimes(1);
        const saved = onSave.mock.calls[0][0] as LlmProviderConfig;
        expect(saved).toMatchObject({ provider: "tavily", type: "search", apiKey: "tvly-secret", name: "Work Tavily" });
        expect(getProviderKind(saved)).toBe("search");
    });

    it("requires a non-empty valid base URL for SearXNG before saving", async () => {
        const onSave = vi.fn();
        let root!: HTMLElement;
        await act(async () => { root = mount({ kind: "search", onSave }); });
        await act(async () => { clickCard(root, "SearXNG"); });

        // No URL yet → the submit is rejected.
        await act(async () => { submit(root); });
        expect(onSave).not.toHaveBeenCalled();

        // An invalid URL is rejected too.
        await act(async () => { typeInto(root, "input[placeholder='http://localhost:8888']", "not a url"); });
        await act(async () => { submit(root); });
        expect(onSave).not.toHaveBeenCalled();

        // A valid URL saves with the default display name.
        await act(async () => { typeInto(root, "input[placeholder='http://localhost:8888']", "http://searx.lan:8888"); });
        await act(async () => { submit(root); });
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave.mock.calls[0][0]).toMatchObject({
            provider: "searxng",
            type: "search",
            baseURL: "http://searx.lan:8888",
            name: "SearXNG",
            apiKey: ""
        });
    });

    it("saves LLM providers without a type marker (backward compatible entries)", async () => {
        const onSave = vi.fn();
        let root!: HTMLElement;
        await act(async () => { root = mount({ onSave }); });

        await act(async () => { clickCard(root, "Anthropic"); });
        await act(async () => { typeInto(root, "input[type=password]", "sk-ant"); });
        await act(async () => { submit(root); });

        const saved = onSave.mock.calls[0][0] as LlmProviderConfig;
        expect(saved.type).toBeUndefined();
        expect(getProviderKind(saved)).toBe("llm");
    });
});
