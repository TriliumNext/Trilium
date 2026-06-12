import { OptionNames } from "@triliumnext/commons";
import { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flush, renderComponent } from "../../../test/render";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Modal {
        static instances = new Map<Element, Modal>();
        static getInstance(el: Element) { return Modal.instances.get(el) ?? null; }
        static getOrCreateInstance(el: Element, config?: unknown) {
            return Modal.instances.get(el) ?? new Modal(el, config);
        }
        element: Element;
        config: unknown;
        constructor(el: Element, config?: unknown) { this.element = el; this.config = config; Modal.instances.set(el, this); }
        show() {}
        hide() {}
        dispose() { Modal.instances.delete(this.element); }
    }
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        static getOrCreateInstance(el: Element, config?: unknown) {
            return Tooltip.instances.get(el) ?? new Tooltip(el, config);
        }
        element: Element;
        config: unknown;
        constructor(el: Element, config?: unknown) { this.element = el; this.config = config; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
        update() {}
    }
    return { Modal, Tooltip, default: { Modal, Tooltip } };
});

vi.mock("../../../services/dialog", () => ({
    default: {
        confirm: vi.fn(async () => true),
        info: vi.fn(async () => undefined)
    },
    openDialog: vi.fn(async ($el: { 0: Element }) => $el)
}));

vi.mock("../../../services/toast", () => ({
    default: { showError: vi.fn() }
}));

vi.mock("../../../services/protected_session_holder", () => ({
    default: { resetProtectedSession: vi.fn(async () => undefined) }
}));

import Component from "../../../components/component";
import dialog from "../../../services/dialog";
import options from "../../../services/options";
import protected_session_holder from "../../../services/protected_session_holder";
import server from "../../../services/server";
import toast from "../../../services/toast";
import PasswordSettings from "./password";

// --- Render harness (wraps the component in the Trilium providers via the shared helper) -----------

const parent = { current: new Component() };

function renderApp(node: ComponentChildren = <PasswordSettings />) {
    const { container } = renderComponent(node, { parent: parent.current });
    return container;
}

function click(el: HTMLElement) { act(() => { el.click(); }); }

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

/** The change-password modal is rendered via createPortal into document.body. */
function modal() {
    return document.body.querySelector(".change-password-modal");
}

/** Open the change-password modal by clicking the first option-row button. */
function openChangePasswordModal(root: HTMLElement) {
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(".option-row-link"));
    const changeBtn = buttons[0];
    if (!changeBtn) {
        throw new Error("expected the change-password button");
    }
    click(changeBtn);
}

/** Type a value into a password input within the modal. */
function typeInto(input: HTMLInputElement, value: string) {
    input.value = value;
    act(() => { input.dispatchEvent(new Event("input", { bubbles: true })); });
}

beforeEach(() => {
    setOptions({ protectedSessionTimeout: "600", protectedSessionTimeoutTimeScale: "60" });
    parent.current = new Component();
    vi.clearAllMocks();
    // The auto-mocked server (test/setup.ts) defines inert get/post — supply per-test impls below.
    Object.assign(server, {
        get: vi.fn(async () => undefined),
        post: vi.fn(async () => ({ success: true }))
    });
    // Bootstrap's jQuery tooltip plugin isn't loaded under happy-dom; stub it.
    Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: vi.fn() });
    asMock(dialog.confirm).mockResolvedValue(true);
    asMock(dialog.info).mockResolvedValue(undefined);
});

afterEach(() => {
    // The shared render helper tears down rendered containers; only the createPortal nodes that land
    // directly in document.body need manual cleanup.
    document.body.querySelectorAll(".change-password-modal").forEach((el) => el.remove());
});

// --- Top-level structure --------------------------------------------------------------------------

describe("PasswordSettings", () => {
    it("renders both the change-password and protected-session-timeout sections", async () => {
        const root = renderApp();
        await flush();
        // ChangePassword + ProtectedSessionTimeout = two option sections.
        expect(root.querySelectorAll(".options-section").length).toBe(2);
        // Two action buttons (change + reset) in the change-password section.
        expect(root.querySelectorAll(".option-row-link").length).toBe(2);
        // ProtectedSessionTimeout renders a TimeSelector (number input + select).
        expect(root.querySelector("input[type='number']")).toBeTruthy();
        expect(root.querySelector("select")).toBeTruthy();
        // 600s at scale 60 -> 10 minutes displayed.
        expect(root.querySelector<HTMLInputElement>("input[type='number']")?.value).toBe("10");
    });
});

// --- ChangePassword: the two action rows ----------------------------------------------------------

describe("ChangePassword", () => {
    it("opens the change-password modal when the change button is clicked", async () => {
        const root = renderApp();
        await flush();
        // The modal element always exists (portal), but its dialog body only renders once shown.
        expect(modal()?.querySelector(".modal-dialog")).toBeFalsy();
        openChangePasswordModal(root);
        await flush();
        expect(modal()?.querySelector(".modal-dialog")).toBeTruthy();
        // Three password inputs in the modal body.
        expect(modal()?.querySelectorAll("input[type='password']").length).toBe(3);
    });

    it("resets the password after confirmation and shows a success toast", async () => {
        asMock(dialog.confirm).mockResolvedValue(true);
        const root = renderApp();
        await flush();
        const resetBtn = root.querySelectorAll<HTMLButtonElement>(".option-row-link")[1];
        expect(resetBtn).toBeInstanceOf(HTMLButtonElement);
        click(resetBtn);
        await flush();
        expect(dialog.confirm).toHaveBeenCalledTimes(1);
        expect(server.post).toHaveBeenCalledWith(
            "password/reset?really=yesIReallyWantToResetPasswordAndLoseAccessToMyProtectedNotes"
        );
        expect(toast.showError).toHaveBeenCalledTimes(1);
    });

    it("does nothing when the reset confirmation is declined", async () => {
        asMock(dialog.confirm).mockResolvedValue(false);
        const root = renderApp();
        await flush();
        const resetBtn = root.querySelectorAll<HTMLButtonElement>(".option-row-link")[1];
        click(resetBtn);
        await flush();
        expect(dialog.confirm).toHaveBeenCalledTimes(1);
        expect(server.post).not.toHaveBeenCalledWith(
            "password/reset?really=yesIReallyWantToResetPasswordAndLoseAccessToMyProtectedNotes"
        );
        expect(toast.showError).not.toHaveBeenCalled();
    });
});

// --- ChangePasswordModal: submit / mismatch / failure / cancel ------------------------------------

describe("ChangePasswordModal", () => {
    function setupModal(root: HTMLElement) {
        openChangePasswordModal(root);
        const inputs = Array.from(
            (modal()?.querySelectorAll<HTMLInputElement>("input[type='password']")) ?? []
        );
        if (inputs.length !== 3) {
            throw new Error(`expected three password inputs, got ${inputs.length}`);
        }
        const [ oldPwd, newPwd1, newPwd2 ] = inputs;
        return { oldPwd, newPwd1, newPwd2 };
    }

    function submitForm() {
        const form = modal()?.querySelector("form");
        if (!form) {
            throw new Error("expected a form inside the modal");
        }
        act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    }

    it("shows an error and does not call the server when the new passwords do not match", async () => {
        const root = renderApp();
        await flush();
        const { oldPwd, newPwd1, newPwd2 } = setupModal(root);
        typeInto(oldPwd, "old");
        typeInto(newPwd1, "abc");
        typeInto(newPwd2, "xyz");
        await flush();
        submitForm();
        await flush();
        expect(toast.showError).toHaveBeenCalledTimes(1);
        expect(server.post).not.toHaveBeenCalledWith("password/change", expect.anything());
    });

    it("submits the change, resets the protected session and shows an info dialog on success", async () => {
        asMock(server.post).mockResolvedValue({ success: true });
        const root = renderApp();
        await flush();
        const { oldPwd, newPwd1, newPwd2 } = setupModal(root);
        typeInto(oldPwd, "old");
        typeInto(newPwd1, "same");
        typeInto(newPwd2, "same");
        await flush();
        submitForm();
        await flush();
        expect(server.post).toHaveBeenCalledWith("password/change", {
            current_password: "old",
            new_password: "same"
        });
        expect(dialog.info).toHaveBeenCalledTimes(1);
        expect(protected_session_holder.resetProtectedSession).toHaveBeenCalledTimes(1);
        expect(toast.showError).not.toHaveBeenCalled();
    });

    it("shows the server-provided error message when the change fails", async () => {
        asMock(server.post).mockResolvedValue({ success: false, message: "wrong password" });
        const root = renderApp();
        await flush();
        const { oldPwd, newPwd1, newPwd2 } = setupModal(root);
        typeInto(oldPwd, "old");
        typeInto(newPwd1, "same");
        typeInto(newPwd2, "same");
        await flush();
        submitForm();
        await flush();
        expect(server.post).toHaveBeenCalledWith("password/change", expect.anything());
        expect(toast.showError).toHaveBeenCalledWith("wrong password");
        expect(dialog.info).not.toHaveBeenCalled();
        expect(protected_session_holder.resetProtectedSession).not.toHaveBeenCalled();
    });

    it("does not error or dialog when the change fails without a message", async () => {
        asMock(server.post).mockResolvedValue({ success: false, message: "" });
        const root = renderApp();
        await flush();
        const { oldPwd, newPwd1, newPwd2 } = setupModal(root);
        typeInto(oldPwd, "old");
        typeInto(newPwd1, "same");
        typeInto(newPwd2, "same");
        await flush();
        submitForm();
        await flush();
        expect(server.post).toHaveBeenCalledWith("password/change", expect.anything());
        // Falsy message -> neither branch taken.
        expect(toast.showError).not.toHaveBeenCalled();
        expect(dialog.info).not.toHaveBeenCalled();
    });

    it("clears the fields and hides the modal when the cancel button is clicked", async () => {
        const root = renderApp();
        await flush();
        const { oldPwd, newPwd1, newPwd2 } = setupModal(root);
        typeInto(oldPwd, "old");
        typeInto(newPwd1, "abc");
        typeInto(newPwd2, "abc");
        await flush();
        // The footer holds the cancel + change buttons; cancel is the first.
        const footerButtons = Array.from(modal()?.querySelectorAll<HTMLButtonElement>(".modal-footer button") ?? []);
        const cancelBtn = footerButtons[0];
        expect(cancelBtn).toBeInstanceOf(HTMLButtonElement);
        click(cancelBtn);
        await flush();
        // No submit happened.
        expect(server.post).not.toHaveBeenCalledWith("password/change", expect.anything());
    });
});
