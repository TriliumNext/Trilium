import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderComponent } from "../../test/render";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Stub bootstrap's Modal/Tooltip so the Modal component's effects (and hooks.tsx Tooltip patching)
// don't blow up under happy-dom.
vi.mock("bootstrap", () => {
    class Modal {
        static instances = new Map<Element, Modal>();
        static getOrCreateInstance(el: Element) {
            const existing = Modal.instances.get(el);
            if (existing) return existing;
            const instance = new Modal(el);
            Modal.instances.set(el, instance);
            return instance;
        }
        element: Element;
        constructor(el: Element) { this.element = el; }
        show() {}
        hide() {}
        dispose() { Modal.instances.delete(this.element); }
    }
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

// openDialog is otherwise driven by bootstrap + jQuery; stub it to a resolved no-op.
vi.mock("../../services/dialog", () => ({
    openDialog: vi.fn(async ($dialog: JQuery<HTMLElement>) => $dialog),
    closeActiveDialog: vi.fn()
}));

import type Component from "../../components/component";
import PromptDialog, { type PromptDialogOptions } from "./prompt";

// --- Render harness -------------------------------------------------------------------------------

let container: HTMLElement | undefined;
let parent: Component;

function renderDialog() {
    const result = renderComponent(<PromptDialog />);
    container = result.container;
    parent = result.parent;
    return container;
}

function fireTrilium(name: string, data: unknown) {
    act(() => {
        (parent.handleEventInChildren as (n: string, d: unknown) => void)(name, data);
    });
}

function showPrompt(opts: PromptDialogOptions) {
    fireTrilium("showPromptDialog", opts);
}

function modalEl(): HTMLDivElement {
    const el = container?.querySelector<HTMLDivElement>(".prompt-dialog");
    if (!el) throw new Error("modal element not rendered");
    return el;
}

function dispatchShown() {
    act(() => { modalEl().dispatchEvent(new Event("shown.bs.modal", { bubbles: true })); });
}

function dispatchHidden() {
    act(() => { modalEl().dispatchEvent(new Event("hidden.bs.modal", { bubbles: true })); });
}

function submitForm() {
    const form = container?.querySelector<HTMLFormElement>("form");
    if (!form) throw new Error("form not rendered");
    act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}

beforeEach(() => {
    vi.clearAllMocks();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("PromptDialog", () => {
    it("renders the modal shell with default title before any event", () => {
        const root = renderDialog();
        const modal = root.querySelector(".prompt-dialog");
        expect(modal).toBeTruthy();
        expect(modal?.className).toContain("modal");
        // Not shown yet: the inner modal-dialog body should be absent.
        expect(root.querySelector(".modal-dialog")).toBeNull();
    });

    it("shows the dialog with the provided default value when the event fires", () => {
        renderDialog();
        showPrompt({ title: "My Title", message: "Question?", defaultValue: "preset" });

        const input = container?.querySelector<HTMLInputElement>("input.form-control");
        const label = container?.querySelector<HTMLLabelElement>("label");
        const title = container?.querySelector<HTMLElement>(".modal-title");
        expect(input?.value).toBe("preset");
        expect(label?.textContent).toBe("Question?");
        expect(title?.textContent).toBe("My Title");
    });

    it("falls back to an empty value when no defaultValue is given", () => {
        renderDialog();
        showPrompt({ message: "Q" });
        const input = container?.querySelector<HTMLInputElement>("input.form-control");
        expect(input?.value).toBe("");
    });

    it("invokes the shown callback with jQuery selectors and focuses the answer field", () => {
        renderDialog();
        const shown = vi.fn();
        showPrompt({ defaultValue: "abc", shown });
        dispatchShown();

        expect(shown).toHaveBeenCalledTimes(1);
        const args = shown.mock.calls[0]?.[0];
        // $dialog, $question, $answer, $form are jQuery objects (have a length property).
        expect(args?.$dialog?.length).toBeGreaterThan(0);
        expect(args?.$answer?.length).toBeGreaterThan(0);
        expect(args?.$form?.length).toBeGreaterThan(0);
        // The answer field has the focus.
        const input = container?.querySelector<HTMLInputElement>("input.form-control");
        expect(document.activeElement).toBe(input);
    });

    it("tolerates a shown event when no shown callback is provided", () => {
        renderDialog();
        showPrompt({ defaultValue: "x" });
        expect(() => dispatchShown()).not.toThrow();
    });

    it("captures the edited value on submit and reports it via the callback on hide", () => {
        renderDialog();
        const callback = vi.fn();
        showPrompt({ defaultValue: "start", callback });

        // Edit the field.
        const input = container?.querySelector<HTMLInputElement>("input.form-control");
        if (!input) throw new Error("input missing");
        act(() => {
            input.value = "edited";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });

        submitForm();
        dispatchHidden();

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith("edited");
    });

    it("reports null when hidden without submitting (cancel)", () => {
        renderDialog();
        const callback = vi.fn();
        showPrompt({ defaultValue: "start", callback });

        // Hide without submitting.
        dispatchHidden();

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(null);
    });

    it("tolerates a hidden event when no callback is provided and clears state", () => {
        renderDialog();
        showPrompt({ defaultValue: "y" });
        expect(() => dispatchHidden()).not.toThrow();
    });

    it("respects the readOnly option on the answer field", () => {
        renderDialog();
        showPrompt({ defaultValue: "ro", readOnly: true });
        const input = container?.querySelector<HTMLInputElement>("input.form-control");
        expect(input?.readOnly).toBe(true);
    });

    it("resets options after hide so a subsequent prompt starts fresh", () => {
        renderDialog();
        const firstCallback = vi.fn();
        showPrompt({ title: "First", defaultValue: "one", callback: firstCallback });
        submitForm();
        dispatchHidden();
        expect(firstCallback).toHaveBeenCalledWith("one");

        // Second prompt with no title should fall back to the default title, not "First".
        const secondCallback = vi.fn();
        showPrompt({ defaultValue: "two", callback: secondCallback });
        const title = container?.querySelector<HTMLElement>(".modal-title");
        expect(title?.textContent).not.toBe("First");
        const input = container?.querySelector<HTMLInputElement>("input.form-control");
        expect(input?.value).toBe("two");

        // Cancel the second one; submitValue must have been reset, so callback gets null.
        dispatchHidden();
        expect(secondCallback).toHaveBeenCalledWith(null);
    });
});
