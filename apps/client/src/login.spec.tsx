import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// t() returns the key so assertions are deterministic and not tied to English text;
// initLocale is a no-op (no http backend under test).
vi.mock("./services/i18n", () => ({
    t: (key: string) => key,
    initLocale: vi.fn(),
    getCurrentLanguage: () => "en"
}));

import { App, PasswordLogin } from "./login";

let container: HTMLDivElement;
function renderInto(vnode: preact.ComponentChild) {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(vnode, container);
    return container;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function mockFetch(resp: { ok?: boolean; status?: number; json?: () => Promise<unknown> } | "reject") {
    const fn = resp === "reject"
        ? vi.fn().mockRejectedValue(new Error("network down"))
        : vi.fn().mockResolvedValue({ ok: false, status: 200, json: async () => ({}), ...resp });
    globalThis.fetch = fn as typeof fetch;
    return fn;
}

afterEach(() => {
    render(null, container);
    container.remove();
    vi.restoreAllMocks();
});

describe("PasswordLogin", () => {
    function setup(totpEnabled = false) {
        const onError = vi.fn();
        const c = renderInto(<PasswordLogin illustration={null} totpEnabled={totpEnabled} error={null} errorId={0} onError={onError} />);
        const form = c.querySelector("form");
        const password = c.querySelector('input[name="password"]') as HTMLInputElement;
        const totp = c.querySelector('input[name="totpToken"]') as HTMLInputElement | null;
        const submit = () => form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        return { onError, password, totp, submit };
    }

    it("posts the password read from the DOM (autofill-safe) and navigates on success", async () => {
        const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
        const fetchFn = mockFetch({ ok: true, status: 200 });
        const { password, submit } = setup();

        // Simulate browser autofill: set .value WITHOUT firing an input event.
        password.value = "autofilled";
        submit();
        await flush();

        const body = fetchFn.mock.calls[0]?.[1]?.body as URLSearchParams;
        expect(body.get("password")).toBe("autofilled");
        expect(assign).toHaveBeenCalledWith(".");
    });

    it("includes the TOTP token only when TOTP is enabled", async () => {
        vi.spyOn(window.location, "assign").mockImplementation(() => {});
        const fetchFn = mockFetch({ ok: true, status: 200 });
        const { password, totp, submit } = setup(true);
        password.value = "secret";
        if (totp) totp.value = "123456";
        submit();
        await flush();

        const body = fetchFn.mock.calls[0]?.[1]?.body as URLSearchParams;
        expect(body.get("totpToken")).toBe("123456");
    });

    it("reports an incorrect password on 401 {factor:'password'}", async () => {
        mockFetch({ ok: false, status: 401, json: async () => ({ factor: "password" }) });
        const { onError, password, submit } = setup();
        password.value = "wrong";
        submit();
        await flush();
        expect(onError).toHaveBeenCalledWith("login.incorrect-password");
    });

    it("reports a bad TOTP for a 6-digit second factor", async () => {
        mockFetch({ ok: false, status: 401, json: async () => ({ factor: "totp" }) });
        const { onError, password, totp, submit } = setup(true);
        password.value = "secret";
        if (totp) totp.value = "123456";
        submit();
        await flush();
        expect(onError).toHaveBeenCalledWith("login.incorrect-totp");
    });

    it("reports a bad recovery code when the second factor has recovery-code shape", async () => {
        mockFetch({ ok: false, status: 401, json: async () => ({ factor: "totp" }) });
        const { onError, password, totp, submit } = setup(true);
        password.value = "secret";
        if (totp) totp.value = "abcdefghijklmnopqrstuv=="; // 22 chars + "=="
        submit();
        await flush();
        expect(onError).toHaveBeenCalledWith("login.incorrect-recovery-code");
    });

    it("reports rate limiting on 429 rather than a credential error", async () => {
        mockFetch({ ok: false, status: 429 });
        const { onError, password, submit } = setup();
        password.value = "secret";
        submit();
        await flush();
        expect(onError).toHaveBeenCalledWith("login.too-many-attempts");
    });

    it("reports a connection error when fetch rejects (network failure)", async () => {
        mockFetch("reject");
        const { onError, password, submit } = setup();
        password.value = "secret";
        submit();
        await flush();
        expect(onError).toHaveBeenCalledWith("login.connection-error");
    });

    it("disables the submit button while a request is in flight", async () => {
        globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {})) as typeof fetch; // never resolves
        const c = renderInto(<PasswordLogin illustration={null} totpEnabled={false} error={null} errorId={0} onError={vi.fn()} />);
        const button = c.querySelector('button[type="submit"]') as HTMLButtonElement;
        const password = c.querySelector('input[name="password"]') as HTMLInputElement;
        expect(button.disabled).toBe(false);

        password.value = "secret";
        c.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await flush();
        expect(button.disabled).toBe(true);
    });
});

describe("login App — SSO branch", () => {
    beforeEach(() => {
        window.glob.login = { ssoEnabled: true, ssoIssuerName: "Google", ssoIssuerIcon: "", totpEnabled: false };
    });
    afterEach(() => {
        window.glob.login = undefined;
    });

    it("navigates to the OpenID route when the SSO button is clicked", () => {
        const hrefSpy = vi.spyOn(window.location, "href", "set").mockImplementation(() => {});
        const button = renderInto(<App />).querySelector("button");
        button?.click();
        expect(hrefSpy).toHaveBeenCalledWith("/authenticate");
    });

    it("shows the one-shot SSO error when present", () => {
        window.glob.login = { ssoEnabled: true, ssoIssuerName: "Google", totpEnabled: false, ssoError: "wrong_account" };
        const c = renderInto(<App />);
        expect(c.textContent).toContain("login.sso-wrong-account");
    });
});
