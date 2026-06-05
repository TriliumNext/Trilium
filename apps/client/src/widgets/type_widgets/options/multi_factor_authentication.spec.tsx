import { OptionNames } from "@triliumnext/commons";
import { ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
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
    return { Tooltip, default: { Tooltip } };
});

// Stub <Trans> so the description is rendered without pulling in React's context (react-i18next
// imports from `react`, which clashes with preact under happy-dom -> "Invalid hook call").
vi.mock("react-i18next", () => ({
    Trans: ({ i18nKey }: { i18nKey?: string }) => <span class="trans-stub" data-i18n-key={i18nKey} />
}));

vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    isElectron: vi.fn(() => false),
    isMobile: vi.fn(() => false)
}));

vi.mock("../../../services/dialog", () => ({
    default: {
        confirm: vi.fn(async () => true),
        prompt: vi.fn(async () => null)
    }
}));

vi.mock("../../../services/toast", () => ({
    default: { showError: vi.fn() }
}));

import Component from "../../../components/component";
import dialog from "../../../services/dialog";
import options from "../../../services/options";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { isElectron } from "../../../services/utils";
import ws from "../../../services/ws";
import { NoteContextContext, ParentComponent } from "../../react/react_utils";
import MultiFactorAuthenticationSettings from "./multi_factor_authentication";

// --- Render harness (wraps the component in the Trilium providers, like react_utils.tsx) -----------

let container: HTMLDivElement | undefined;
const parent = { current: new Component() };

function renderApp(node: ComponentChildren = <MultiFactorAuthenticationSettings />) {
    const root = document.createElement("div");
    container = root;
    document.body.appendChild(root);
    act(() => {
        render((
            <ParentComponent.Provider value={parent.current}>
                <NoteContextContext.Provider value={null}>
                    {node}
                </NoteContextContext.Provider>
            </ParentComponent.Provider>
        ), root);
    });
    return root;
}

function click(el: HTMLElement) { act(() => { el.click(); }); }
function change(el: Element) { act(() => { el.dispatchEvent(new Event("change", { bubbles: true })); }); }

async function flush() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

/** Mocked GET that returns a per-URL response from the supplied map (default: undefined). */
function mockGet(responses: Record<string, unknown>) {
    (server.get as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => responses[url]);
}

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
    setOptions({ mfaEnabled: "false", mfaMethod: "totp" });
    parent.current = new Component();
    vi.clearAllMocks();
    (isElectron as ReturnType<typeof vi.fn>).mockReturnValue(false);
    // The auto-mocked server (test/setup.ts) only defines get/post — supply per-test impls below.
    Object.assign(server, {
        get: vi.fn(async () => undefined),
        post: vi.fn(async () => undefined),
        put: vi.fn(async () => undefined)
    });
    Object.assign(ws, { logError: vi.fn() });
    // Bootstrap's jQuery tooltip plugin isn't loaded under happy-dom; stub it (used by FormCheckbox).
    Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: vi.fn() });
    asMock(dialog.confirm).mockResolvedValue(true);
    asMock(dialog.prompt).mockResolvedValue(null);
});

afterEach(() => {
    if (container) {
        act(() => { if (container) render(null, container); });
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Top-level: electron vs non-electron ----------------------------------------------------------

describe("MultiFactorAuthenticationSettings", () => {
    it("renders only a notice under Electron (no enable section)", async () => {
        (isElectron as ReturnType<typeof vi.fn>).mockReturnValue(true);
        const root = renderApp();
        await flush();
        // The Electron branch renders a single FormText and no OptionsSection / checkbox.
        expect(root.querySelector(".options-section")).toBeNull();
        expect(root.querySelector("input[type='checkbox']")).toBeNull();
    });

    it("renders the enable section without the method section while MFA is disabled", async () => {
        setOptions({ mfaEnabled: "false", mfaMethod: "totp" });
        const root = renderApp();
        await flush();
        // Only the EnableMultiFactor section is present.
        expect(root.querySelectorAll(".options-section").length).toBe(1);
        expect(root.querySelector("input[type='checkbox']")).toBeTruthy();
        // No method radios yet.
        expect(root.querySelector("input[type='radio']")).toBeNull();
    });

    it("renders the method section once MFA is enabled", async () => {
        setOptions({ mfaEnabled: "true", mfaMethod: "totp" });
        mockGet({ "totp/status": { set: false }, "totp_recovery/enabled": { success: true, keysExist: false } });
        const root = renderApp();
        await flush();
        // EnableMultiFactor + mfa-method + totp secret + recovery keys.
        expect(root.querySelector(".mfa-options")).toBeTruthy();
        expect(root.querySelectorAll("input[type='radio']").length).toBe(2);
    });
});

// --- EnableMultiFactor: the checkbox persists -----------------------------------------------------

describe("EnableMultiFactor", () => {
    it("toggling the checkbox saves the option", async () => {
        setOptions({ mfaEnabled: "false", mfaMethod: "totp" });
        // After enabling, the method section mounts TotpSettings which loads status/recovery keys.
        mockGet({
            "totp/status": { set: false },
            "totp_recovery/enabled": { success: true, keysExist: false }
        });
        const root = renderApp();
        await flush();
        const checkbox = root.querySelector("input[type='checkbox']");
        expect(checkbox).toBeInstanceOf(HTMLInputElement);
        if (checkbox instanceof HTMLInputElement) {
            checkbox.checked = true;
            change(checkbox);
            await flush();
        }
        expect(server.put).toHaveBeenCalledWith("options", { mfaEnabled: "true" });
    });
});

// --- MultiFactorMethod: switching between TOTP and OAuth ------------------------------------------

describe("MultiFactorMethod", () => {
    it("selecting the OAuth radio persists the method and renders OAuth settings", async () => {
        setOptions({ mfaEnabled: "true", mfaMethod: "totp" });
        mockGet({
            "totp/status": { set: false },
            "totp_recovery/enabled": { success: true, keysExist: false },
            "oauth/status": { enabled: false }
        });
        const root = renderApp();
        await flush();
        const radios = Array.from(root.querySelectorAll("input[type='radio']")) as HTMLInputElement[];
        const oauthRadio = radios.find(r => r.value === "oauth");
        expect(oauthRadio).toBeTruthy();
        if (oauthRadio) {
            oauthRadio.checked = true;
            change(oauthRadio);
            await flush();
        }
        expect(server.put).toHaveBeenCalledWith("options", { mfaMethod: "oauth" });
    });

    it("renders the OAuth branch (RawHtml description) when mfaMethod is oauth", async () => {
        setOptions({ mfaEnabled: "true", mfaMethod: "oauth" });
        mockGet({ "oauth/status": { enabled: false } });
        const root = renderApp();
        await flush();
        // OAuth settings section is rendered; the TOTP secret button is not.
        expect(server.get).toHaveBeenCalledWith("oauth/status");
        expect(root.querySelector(".user-account-name")).toBeNull();
    });
});

// --- TotpSettings: status, recovery keys, generation ----------------------------------------------

describe("TotpSettings", () => {
    it("shows the no-secret note admonition and loads status + recovery keys on mount", async () => {
        setOptions({ mfaEnabled: "true", mfaMethod: "totp" });
        mockGet({
            "totp/status": { set: false },
            "totp_recovery/enabled": { success: true, keysExist: false }
        });
        const root = renderApp();
        await flush();
        expect(server.get).toHaveBeenCalledWith("totp/status");
        expect(server.get).toHaveBeenCalledWith("totp_recovery/enabled");
        expect(root.querySelector(".admonition.note")).toBeTruthy();
        // No used codes loaded because keysExist is false.
        expect(server.get).not.toHaveBeenCalledWith("totp_recovery/used");
    });

    it("shows the warning admonition and used recovery codes when a secret is set", async () => {
        setOptions({ mfaEnabled: "true", mfaMethod: "totp" });
        mockGet({
            "totp/status": { set: true },
            "totp_recovery/enabled": { success: true, keysExist: true },
            "totp_recovery/used": { success: true, usedRecoveryCodes: [ "2024/01/02", "not-a-date", 3 as unknown as string ] }
        });
        const root = renderApp();
        await flush();
        expect(server.get).toHaveBeenCalledWith("totp_recovery/used");
        expect(root.querySelector(".admonition.warning")).toBeTruthy();
        // Recovery list has one entry per code.
        const items = root.querySelectorAll("ol li");
        expect(items.length).toBe(3);
        // The invalid-date code renders inside a <code> element.
        expect(root.querySelector("ol li code")?.textContent).toBe("not-a-date");
    });

    it("shows an error toast when the recovery-keys status request fails", async () => {
        setOptions({ mfaEnabled: "true", mfaMethod: "totp" });
        mockGet({
            "totp/status": { set: false },
            "totp_recovery/enabled": { success: false }
        });
        renderApp();
        await flush();
        expect(toast.showError).toHaveBeenCalled();
    });

    it("generates a new secret (no existing secret) then persists fresh recovery codes", async () => {
        setOptions({ mfaEnabled: "true", mfaMethod: "totp" });
        mockGet({
            "totp/status": { set: false },
            "totp_recovery/enabled": { success: true, keysExist: false },
            "totp/generate": { success: true, message: "SECRET123" },
            "totp_recovery/generate": { success: true, recoveryCodes: [ "code-a", "code-b" ] }
        });
        asMock(dialog.prompt).mockResolvedValue("ok");
        const root = renderApp();
        await flush();

        const generateBtn = root.querySelector(".options-section button");
        expect(generateBtn).toBeInstanceOf(HTMLButtonElement);
        if (generateBtn instanceof HTMLButtonElement) {
            click(generateBtn);
            await flush();
        }
        // No confirm needed because no secret was previously set.
        expect(dialog.confirm).not.toHaveBeenCalled();
        expect(dialog.prompt).toHaveBeenCalled();
        expect(server.post).toHaveBeenCalledWith("totp_recovery/set", { recoveryCodes: [ "code-a", "code-b" ] });
    });

    it("regenerating an existing secret asks for confirmation first", async () => {
        setOptions({ mfaEnabled: "true", mfaMethod: "totp" });
        mockGet({
            "totp/status": { set: true },
            "totp_recovery/enabled": { success: true, keysExist: false },
            "totp/generate": { success: true, message: "NEWSECRET" },
            "totp_recovery/generate": { success: true, recoveryCodes: [ "x" ] }
        });
        asMock(dialog.confirm).mockResolvedValue(true);
        asMock(dialog.prompt).mockResolvedValue("ok");
        const root = renderApp();
        await flush();
        const generateBtn = root.querySelector(".options-section button");
        if (generateBtn instanceof HTMLButtonElement) {
            click(generateBtn);
            await flush();
        }
        expect(dialog.confirm).toHaveBeenCalled();
        expect(server.get).toHaveBeenCalledWith("totp/generate");
    });

    it("aborts regeneration when the confirmation is declined", async () => {
        setOptions({ mfaEnabled: "true", mfaMethod: "totp" });
        mockGet({
            "totp/status": { set: true },
            "totp_recovery/enabled": { success: true, keysExist: false },
            "totp/generate": { success: true, message: "NEWSECRET" }
        });
        asMock(dialog.confirm).mockResolvedValue(false);
        const root = renderApp();
        await flush();
        const generateBtn = root.querySelector(".options-section button");
        if (generateBtn instanceof HTMLButtonElement) {
            click(generateBtn);
            await flush();
        }
        expect(dialog.confirm).toHaveBeenCalled();
        // Cancelled before requesting a new secret.
        expect(server.get).not.toHaveBeenCalledWith("totp/generate");
    });

    it("shows an error toast when secret generation fails", async () => {
        setOptions({ mfaEnabled: "true", mfaMethod: "totp" });
        mockGet({
            "totp/status": { set: false },
            "totp_recovery/enabled": { success: true, keysExist: false },
            "totp/generate": { success: false, message: "boom" }
        });
        const root = renderApp();
        await flush();
        const generateBtn = root.querySelector(".options-section button");
        if (generateBtn instanceof HTMLButtonElement) {
            click(generateBtn);
            await flush();
        }
        expect(toast.showError).toHaveBeenCalledWith("boom");
        expect(dialog.prompt).not.toHaveBeenCalled();
    });
});

// --- TotpRecoveryKeys: generate via its own button + failure branch -------------------------------

describe("TotpRecoveryKeys", () => {
    it("renders the 'no keys' state and generates recovery keys via its button", async () => {
        setOptions({ mfaEnabled: "true", mfaMethod: "totp" });
        mockGet({
            "totp/status": { set: false },
            "totp_recovery/enabled": { success: true, keysExist: false },
            "totp_recovery/generate": { success: true, recoveryCodes: [ "g1", "g2" ] }
        });
        const root = renderApp();
        await flush();
        // The last OptionsSection is the recovery-keys section; its button generates keys.
        const sections = root.querySelectorAll(".options-section");
        const recoverySection = sections[sections.length - 1];
        const generateBtn = recoverySection.querySelector("button");
        expect(generateBtn).toBeInstanceOf(HTMLButtonElement);
        // No keys yet → a <p> placeholder, no ordered list.
        expect(recoverySection.querySelector("ol")).toBeNull();
        if (generateBtn instanceof HTMLButtonElement) {
            click(generateBtn);
            await flush();
        }
        expect(server.post).toHaveBeenCalledWith("totp_recovery/set", { recoveryCodes: [ "g1", "g2" ] });
    });

    it("still posts the (empty) recovery codes when generation succeeds without codes", async () => {
        setOptions({ mfaEnabled: "true", mfaMethod: "totp" });
        mockGet({
            "totp/status": { set: false },
            "totp_recovery/enabled": { success: true, keysExist: false },
            // success but no recoveryCodes -> skips the setRecoveryKeys branch, still posts undefined codes.
            "totp_recovery/generate": { success: true }
        });
        const root = renderApp();
        await flush();
        const sections = root.querySelectorAll(".options-section");
        const recoverySection = sections[sections.length - 1];
        const generateBtn = recoverySection.querySelector("button");
        if (generateBtn instanceof HTMLButtonElement) {
            click(generateBtn);
            await flush();
        }
        expect(server.post).toHaveBeenCalledWith("totp_recovery/set", { recoveryCodes: undefined });
        expect(toast.showError).not.toHaveBeenCalled();
    });

    it("shows an error toast when recovery-key generation fails", async () => {
        setOptions({ mfaEnabled: "true", mfaMethod: "totp" });
        mockGet({
            "totp/status": { set: false },
            "totp_recovery/enabled": { success: true, keysExist: false },
            "totp_recovery/generate": { success: false }
        });
        const root = renderApp();
        await flush();
        const sections = root.querySelectorAll(".options-section");
        const recoverySection = sections[sections.length - 1];
        const generateBtn = recoverySection.querySelector("button");
        if (generateBtn instanceof HTMLButtonElement) {
            click(generateBtn);
            await flush();
        }
        expect(toast.showError).toHaveBeenCalled();
        expect(server.post).not.toHaveBeenCalledWith("totp_recovery/set", expect.anything());
    });
});

// --- OAuthSettings: enabled vs disabled / missing variables ---------------------------------------

describe("OAuthSettings", () => {
    it("shows the user account details when OAuth is enabled and logged in", async () => {
        setOptions({ mfaEnabled: "true", mfaMethod: "oauth" });
        mockGet({ "oauth/status": { enabled: true, name: "Alice", email: "alice@example.com" } });
        const root = renderApp();
        await flush();
        expect(root.querySelector(".user-account-name")?.textContent).toBe("Alice");
        expect(root.querySelector(".user-account-email")?.textContent).toBe("alice@example.com");
    });

    it("falls back to the 'not logged in' label when name/email are absent", async () => {
        setOptions({ mfaEnabled: "true", mfaMethod: "oauth" });
        mockGet({ "oauth/status": { enabled: true } });
        const root = renderApp();
        await flush();
        // Both account fields still render (their text comes from the not-logged-in fallback).
        expect(root.querySelector(".user-account-name")).toBeTruthy();
        expect(root.querySelector(".user-account-email")).toBeTruthy();
        // Neither reflects a concrete account value.
        expect(root.querySelector(".user-account-name")?.textContent).not.toContain("@");
    });

    it("shows a caution admonition when disabled with missing variables", async () => {
        setOptions({ mfaEnabled: "true", mfaMethod: "oauth" });
        mockGet({ "oauth/status": { enabled: false, missingVars: [ "CLIENT_ID", "CLIENT_SECRET" ] } });
        const root = renderApp();
        await flush();
        expect(root.querySelector(".user-account-name")).toBeNull();
        expect(root.querySelector(".admonition.caution")).toBeTruthy();
    });

    it("omits the admonition when OAuth is disabled with no missing variables", async () => {
        setOptions({ mfaEnabled: "true", mfaMethod: "oauth" });
        mockGet({ "oauth/status": { enabled: false } });
        const root = renderApp();
        await flush();
        expect(root.querySelector(".admonition.caution")).toBeNull();
    });
});
