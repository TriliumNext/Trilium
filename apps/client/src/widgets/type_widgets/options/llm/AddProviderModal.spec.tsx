import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// The Modal component drives a real bootstrap Modal + jQuery openDialog inside a useEffect when
// `show` is true. Stub both so happy-dom does not choke on bootstrap internals; the inner DOM
// (form, groups, footer) still renders because Modal renders it whenever `show || keepInDom`.
vi.mock("bootstrap", () => {
    class Modal {
        static instances = new Map<Element, Modal>();
        static getOrCreateInstance(el: Element) {
            let inst = Modal.instances.get(el);
            if (!inst) {
                inst = new Modal(el);
                Modal.instances.set(el, inst);
            }
            return inst;
        }
        static getInstance(el: Element) { return Modal.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; }
        show() {}
        hide() {}
        dispose() { Modal.instances.delete(this.element); }
    }
    // hooks.tsx patches Tooltip.prototype.dispose at import-time, so it must exist.
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    return { Modal, Tooltip, default: { Modal, Tooltip } };
});

vi.mock("../../../../services/dialog", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../../services/dialog")>()),
    openDialog: vi.fn(async ($el: { 0: HTMLElement }) => $el)
}));

import AddProviderModal, { PROVIDER_TYPES } from "./AddProviderModal";

// --- Render helper (portals into document.body) --------------------------------------------------

let container: HTMLDivElement | undefined;

function renderModal(props: Parameters<typeof AddProviderModal>[0]) {
    const localContainer = document.createElement("div");
    container = localContainer;
    document.body.appendChild(localContainer);
    act(() => render(<AddProviderModal {...props} />, localContainer));
    // The component portals into document.body; query the portal root there.
    const modal = document.body.querySelector<HTMLElement>(".add-provider-modal");
    if (!modal) {
        throw new Error("Modal did not render");
    }
    return modal;
}

function typeInto(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
    glob.activeDialog = null;
});

afterEach(() => {
    const localContainer = container;
    if (localContainer) {
        act(() => render(null, localContainer));
        localContainer.remove();
        container = undefined;
    }
    // Remove any portal leftovers so subsequent queries are isolated.
    for (const el of Array.from(document.body.querySelectorAll(".add-provider-modal"))) {
        el.remove();
    }
    vi.restoreAllMocks();
});

describe("AddProviderModal", () => {
    function defaultProps(overrides: Partial<Parameters<typeof AddProviderModal>[0]> = {}) {
        return {
            show: true,
            onHidden: vi.fn(),
            onSave: vi.fn(),
            ...overrides
        } satisfies Parameters<typeof AddProviderModal>[0];
    }

    it("renders the modal structure with provider select, base url and api key fields", () => {
        const modal = renderModal(defaultProps());

        const select = modal.querySelector<HTMLSelectElement>("select.form-select");
        expect(select).not.toBeNull();
        // The first provider type is preselected.
        expect(select?.value).toBe(PROVIDER_TYPES[0].id);
        // One option per provider type.
        expect(modal.querySelectorAll("select.form-select option").length).toBe(PROVIDER_TYPES.length);

        // Two text-ish inputs: base url (text) + api key (password).
        const inputs = modal.querySelectorAll<HTMLInputElement>("input.form-control");
        expect(inputs.length).toBe(2);
        const types = Array.from(inputs).map(i => i.getAttribute("type"));
        expect(types).toContain("text");
        expect(types).toContain("password");

        // Base url input uses the selected provider's default URL as placeholder.
        const baseUrlInput = Array.from(inputs).find(i => i.getAttribute("type") === "text");
        expect(baseUrlInput?.getAttribute("placeholder")).toBe(PROVIDER_TYPES[0].defaultBaseUrl);
    });

    it("disables the submit button until a non-empty api key is entered", () => {
        const modal = renderModal(defaultProps());
        const submit = modal.querySelector<HTMLButtonElement>("button[type='submit']");
        expect(submit?.disabled).toBe(true);

        const apiKeyInput = Array.from(modal.querySelectorAll<HTMLInputElement>("input.form-control"))
            .find(i => i.getAttribute("type") === "password");
        if (!apiKeyInput) {
            throw new Error("api key input missing");
        }
        act(() => typeInto(apiKeyInput, "secret-key"));

        expect(submit?.disabled).toBe(false);
    });

    it("keeps submit disabled when the api key is only whitespace", () => {
        const modal = renderModal(defaultProps());
        const apiKeyInput = Array.from(modal.querySelectorAll<HTMLInputElement>("input.form-control"))
            .find(i => i.getAttribute("type") === "password");
        if (!apiKeyInput) {
            throw new Error("api key input missing");
        }
        act(() => typeInto(apiKeyInput, "   "));

        const submit = modal.querySelector<HTMLButtonElement>("button[type='submit']");
        expect(submit?.disabled).toBe(true);
    });

    it("shows the invalid-url danger description and disables submit for a malformed base url", () => {
        const modal = renderModal(defaultProps());
        const inputs = Array.from(modal.querySelectorAll<HTMLInputElement>("input.form-control"));
        const baseUrlInput = inputs.find(i => i.getAttribute("type") === "text");
        const apiKeyInput = inputs.find(i => i.getAttribute("type") === "password");
        if (!baseUrlInput || !apiKeyInput) {
            throw new Error("inputs missing");
        }

        act(() => typeInto(apiKeyInput, "secret-key"));
        act(() => typeInto(baseUrlInput, "not a url"));

        // Invalid URL renders a danger span.
        expect(modal.querySelector(".text-danger")).not.toBeNull();
        const submit = modal.querySelector<HTMLButtonElement>("button[type='submit']");
        expect(submit?.disabled).toBe(true);
    });

    it("accepts an http(s) base url and re-enables submit", () => {
        const modal = renderModal(defaultProps());
        const inputs = Array.from(modal.querySelectorAll<HTMLInputElement>("input.form-control"));
        const baseUrlInput = inputs.find(i => i.getAttribute("type") === "text");
        const apiKeyInput = inputs.find(i => i.getAttribute("type") === "password");
        if (!baseUrlInput || !apiKeyInput) {
            throw new Error("inputs missing");
        }

        act(() => typeInto(apiKeyInput, "secret-key"));
        act(() => typeInto(baseUrlInput, "http://localhost:1234/v1"));

        expect(modal.querySelector(".text-danger")).toBeNull();
        const submit = modal.querySelector<HTMLButtonElement>("button[type='submit']");
        expect(submit?.disabled).toBe(false);
    });

    it("rejects a non-http(s) protocol base url", () => {
        const modal = renderModal(defaultProps());
        const inputs = Array.from(modal.querySelectorAll<HTMLInputElement>("input.form-control"));
        const baseUrlInput = inputs.find(i => i.getAttribute("type") === "text");
        const apiKeyInput = inputs.find(i => i.getAttribute("type") === "password");
        if (!baseUrlInput || !apiKeyInput) {
            throw new Error("inputs missing");
        }

        act(() => typeInto(apiKeyInput, "secret-key"));
        act(() => typeInto(baseUrlInput, "ftp://example.com"));

        expect(modal.querySelector(".text-danger")).not.toBeNull();
    });

    it("updates the base url placeholder when the provider type changes", () => {
        const modal = renderModal(defaultProps());
        const select = modal.querySelector<HTMLSelectElement>("select.form-select");
        if (!select) {
            throw new Error("select missing");
        }

        const second = PROVIDER_TYPES[1];
        select.value = second.id;
        act(() => { select.dispatchEvent(new Event("change", { bubbles: true })); });

        const baseUrlInput = Array.from(modal.querySelectorAll<HTMLInputElement>("input.form-control"))
            .find(i => i.getAttribute("type") === "text");
        expect(baseUrlInput?.getAttribute("placeholder")).toBe(second.defaultBaseUrl);
    });

    it("submits a provider with trimmed api key and base url, then resets and hides", () => {
        const onSave = vi.fn();
        const onHidden = vi.fn();
        const modal = renderModal(defaultProps({ onSave, onHidden }));

        const inputs = Array.from(modal.querySelectorAll<HTMLInputElement>("input.form-control"));
        const baseUrlInput = inputs.find(i => i.getAttribute("type") === "text");
        const apiKeyInput = inputs.find(i => i.getAttribute("type") === "password");
        const form = modal.querySelector<HTMLFormElement>("form");
        if (!baseUrlInput || !apiKeyInput || !form) {
            throw new Error("missing elements");
        }

        act(() => typeInto(apiKeyInput, "  my-key  "));
        act(() => typeInto(baseUrlInput, "  https://api.example.com/v1  "));

        act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

        expect(onSave).toHaveBeenCalledTimes(1);
        const saved = onSave.mock.calls[0][0];
        expect(saved.apiKey).toBe("my-key");
        expect(saved.baseURL).toBe("https://api.example.com/v1");
        expect(saved.provider).toBe(PROVIDER_TYPES[0].id);
        expect(saved.name).toBe(PROVIDER_TYPES[0].name);
        expect(saved.id.startsWith(`${PROVIDER_TYPES[0].id}_`)).toBe(true);
        expect(onHidden).toHaveBeenCalledTimes(1);

        // Form was reset: api key cleared.
        const apiKeyAfter = Array.from(modal.querySelectorAll<HTMLInputElement>("input.form-control"))
            .find(i => i.getAttribute("type") === "password");
        expect(apiKeyAfter?.value).toBe("");
    });

    it("omits baseURL when no base url is provided", () => {
        const onSave = vi.fn();
        const modal = renderModal(defaultProps({ onSave }));
        const apiKeyInput = Array.from(modal.querySelectorAll<HTMLInputElement>("input.form-control"))
            .find(i => i.getAttribute("type") === "password");
        const form = modal.querySelector<HTMLFormElement>("form");
        if (!apiKeyInput || !form) {
            throw new Error("missing elements");
        }

        act(() => typeInto(apiKeyInput, "key-only"));
        act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

        expect(onSave).toHaveBeenCalledTimes(1);
        const saved = onSave.mock.calls[0][0];
        expect("baseURL" in saved).toBe(false);
    });

    it("does not save when submitted with no api key (canSubmit false)", () => {
        const onSave = vi.fn();
        const onHidden = vi.fn();
        const modal = renderModal(defaultProps({ onSave, onHidden }));
        const form = modal.querySelector<HTMLFormElement>("form");
        if (!form) {
            throw new Error("form missing");
        }

        act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

        expect(onSave).not.toHaveBeenCalled();
        // handleSubmit returns early; onHidden only fires for the successful path.
        expect(onHidden).not.toHaveBeenCalled();
    });

    it("cancels via the secondary button: resets and hides without saving", () => {
        const onSave = vi.fn();
        const onHidden = vi.fn();
        const modal = renderModal(defaultProps({ onSave, onHidden }));

        const apiKeyInput = Array.from(modal.querySelectorAll<HTMLInputElement>("input.form-control"))
            .find(i => i.getAttribute("type") === "password");
        if (!apiKeyInput) {
            throw new Error("api key input missing");
        }
        act(() => typeInto(apiKeyInput, "to-be-discarded"));

        const cancelBtn = modal.querySelector<HTMLButtonElement>("button.btn-secondary");
        if (!cancelBtn) {
            throw new Error("cancel button missing");
        }
        act(() => cancelBtn.click());

        expect(onSave).not.toHaveBeenCalled();
        expect(onHidden).toHaveBeenCalledTimes(1);

        const apiKeyAfter = Array.from(modal.querySelectorAll<HTMLInputElement>("input.form-control"))
            .find(i => i.getAttribute("type") === "password");
        expect(apiKeyAfter?.value).toBe("");
    });
});
