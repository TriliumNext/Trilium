import type { OAuthStatus } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    const state = {
        electron: false,
        stored: {} as Record<string, string>,
        oauth: {} as Partial<OAuthStatus>,
        totpSet: false
    };

    return {
        state,
        get: vi.fn(async (url: string) => {
            if (url === "oauth/status") return state.oauth;
            if (url === "totp/status") return { set: state.totpSet };
            if (url === "totp_recovery/enabled") return { success: true, keysExist: false };
            if (url === "keyboard-actions") return [];
            return {};
        }),
        post: vi.fn(async (_url: string): Promise<{ success: boolean; message?: string }> => ({ success: true })),
        confirm: vi.fn(async () => true),
        showMessage: vi.fn(),
        showError: vi.fn(),
        resetProtectedSession: vi.fn()
    };
});

// The whole sign-in section is server-only; the desktop app authenticates differently.
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    isElectron: () => mocks.state.electron
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

/*
 * Stands in for the Bootstrap shell, keeping only what the dialog inside it is driven through. The
 * real one opens through jQuery and Bootstrap, which happy-dom cannot carry — and it throws from an
 * effect, which abandons the rest of that flush along with it.
 */
vi.mock("../../react/Modal", () => ({
    default: ({ className, show, footer, onSubmit, children }: {
        className?: string;
        show?: boolean;
        footer?: preact.ComponentChildren;
        onSubmit?: () => void;
        children?: preact.ComponentChildren;
    }) => (show
        ? <div className={`modal ${className ?? ""}`}>
            <form onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
                <div className="modal-body">{children}</div>
                <div className="modal-footer">{footer}</div>
            </form>
        </div>
        : null)
}));

vi.mock("../../../services/server", () => ({
    default: { get: mocks.get, post: mocks.post, put: async () => ({}), remove: async () => ({}) }
}));

vi.mock("../../../services/dialog", () => ({
    default: { confirm: mocks.confirm, prompt: vi.fn() }
}));

// A changed password invalidates whatever the old one unlocked, so the session is dropped with it.
vi.mock("../../../services/protected_session_holder", () => ({
    default: { resetProtectedSession: mocks.resetProtectedSession }
}));

vi.mock("../../../services/toast", () => ({
    default: { showMessage: mocks.showMessage, showError: mocks.showError }
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useTriliumOption: (name: string) => [ mocks.state.stored[name] ?? "", vi.fn() ]
}));

vi.mock("./components/OptionsPageHeader", () => ({ default: () => <div className="header-stub" /> }));

import PasswordSettings from "./password";

let host: HTMLElement;

beforeEach(() => {
    mocks.state.electron = false;
    // What a real install holds for the protected-session row: a figure and the scale it is read at.
    mocks.state.stored = { protectedSessionTimeout: "600", protectedSessionTimeoutTimeScale: "1" };
    mocks.state.oauth = {};
    mocks.state.totpSet = false;
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
    vi.clearAllMocks();
});

async function open() {
    await act(async () => {
        render(null, host);
        render(<PasswordSettings />, host);
    });
}

// Read from the text leading the heading: a status badge sits in the same line, and its own words
// would otherwise be run together with the title's.
const cardHeadings = () =>
    [ ...host.querySelectorAll(".tn-card-heading") ].map((heading) => heading.firstChild?.textContent);
const badgeTone = () => host.querySelector(".mfa-status-badge")?.className;
const button = (name: string) => host.querySelector<HTMLButtonElement>(`button[name='${name}']`);

describe("the page on a desktop build", () => {
    it("offers the password settings alone, the sign-in method being the server's business", async () => {
        mocks.state.electron = true;
        await open();

        expect(cardHeadings()).toEqual([ "password.heading", "password.protected_session_timeout" ]);
        expect(mocks.get).not.toHaveBeenCalledWith("oauth/status");
    });
});

describe("choosing a sign-in method", () => {
    it("offers the local password with two-factor beside it, by default", async () => {
        await open();

        expect(cardHeadings()).toContain("multi_factor_authentication.authentication_title");
        // TOTP, not the OpenID card: the two are alternatives, never both.
        expect(cardHeadings()).toContain("multi_factor_authentication.totp_section_title");
        expect(cardHeadings()).not.toContain("multi_factor_authentication.oauth_title");
    });

    it("swaps to the OpenID card once that is the chosen method", async () => {
        mocks.state.stored = { ...mocks.state.stored, mfaMethod: "oauth" };
        await open();

        expect(cardHeadings()).toContain("multi_factor_authentication.oauth_title");
        expect(cardHeadings()).not.toContain("multi_factor_authentication.totp_section_title");
    });
});

describe("the OpenID card", () => {
    beforeEach(() => {
        mocks.state.stored = { ...mocks.state.stored, mfaMethod: "oauth" };
    });

    it("says the server is not set up, and names the variables it is missing", async () => {
        mocks.state.oauth = { missingVars: [ "oauthClientId", "oauthClientSecret" ] };
        await open();

        expect(badgeTone()).toContain("inactive");
        expect(host.querySelector(".mfa-notice .admonition")).not.toBeNull();
        // Nothing to connect with yet, so nothing is offered.
        expect(button("oauth-connect-button")).toBeNull();
    });

    it("offers to bind an account once the server is set up but none is bound", async () => {
        mocks.state.oauth = { missingVars: [], enrolled: false };
        await open();

        expect(badgeTone()).toContain("pending");
        expect(button("oauth-connect-button")).not.toBeNull();
        expect(button("oauth-disconnect-button")).toBeNull();
    });

    it("shows the bound account and the way to be rid of it once one is bound", async () => {
        mocks.state.oauth = {
            missingVars: [],
            enrolled: true,
            name: "Ada",
            email: "ada@example.com",
            issuerUrl: "https://accounts.example.com"
        };
        await open();

        expect(badgeTone()).toContain("active");
        expect(host.textContent).toContain("ada@example.com");
        expect(button("oauth-connect-button")).toBeNull();
        expect(button("oauth-disconnect-button")).not.toBeNull();
    });

    it("asks before unbinding, and leaves the account alone when the answer is no", async () => {
        mocks.state.oauth = { missingVars: [], enrolled: true, name: "Ada", email: "ada@example.com" };
        mocks.confirm.mockResolvedValueOnce(false);
        await open();

        await act(async () => button("oauth-disconnect-button")?.click());
        expect(mocks.post).not.toHaveBeenCalledWith("oauth/disconnect");

        await act(async () => button("oauth-disconnect-button")?.click());
        expect(mocks.post).toHaveBeenCalledWith("oauth/disconnect");
    });
});

describe("changing the password", () => {
    const dialog = () => document.querySelector(".change-password-modal");
    const boxes = () => [ ...(dialog()?.querySelectorAll<HTMLInputElement>("input[type='password']") ?? []) ];

    /** Opens the dialog and fills it in: the current password, then the new one twice over. */
    async function fillIn(oldPassword: string, first: string, second: string) {
        await act(async () => button("change-password-button")?.click());

        for (const [ index, value ] of [ oldPassword, first, second ].entries()) {
            await act(async () => {
                const box = boxes()[index];
                if (box) {
                    box.value = value;
                    box.dispatchEvent(new Event("input", { bubbles: true }));
                }
            });
        }

        await act(async () => {
            dialog()?.querySelector<HTMLFormElement>("form")?.requestSubmit();
        });
        await act(async () => {});
    }

    it("asks for the current password and the new one twice over", async () => {
        await open();
        await act(async () => button("change-password-button")?.click());

        expect(boxes()).toHaveLength(3);
    });

    it("refuses a pair that does not match, without asking the server anything", async () => {
        await open();
        await fillIn("old", "new-one", "new-other");

        expect(mocks.showError).toHaveBeenCalledWith("password.password_mismatch");
        expect(mocks.post).not.toHaveBeenCalled();
    });

    it("sends the change and clears the protected session, which the old password unlocked", async () => {
        await open();
        await fillIn("old", "new", "new");

        expect(mocks.post).toHaveBeenCalledWith("password/change", {
            current_password: "old",
            new_password: "new"
        });
        expect(mocks.resetProtectedSession).toHaveBeenCalled();
        expect(mocks.showMessage).toHaveBeenCalledWith("password.password_changed_success");
    });

    it("reports what the server objected to, and keeps the session as it was", async () => {
        mocks.post.mockResolvedValueOnce({ success: false, message: "password.wrong_password" });
        await open();
        await fillIn("wrong", "new", "new");

        expect(mocks.showError).toHaveBeenCalledWith("password.wrong_password");
        expect(mocks.resetProtectedSession).not.toHaveBeenCalled();
    });
});

describe("the password actions", () => {
    it("asks before resetting, since it costs access to every protected note", async () => {
        mocks.confirm.mockResolvedValueOnce(false);
        await open();

        await act(async () => button("reset-password-button")?.click());
        expect(mocks.post).not.toHaveBeenCalled();

        await act(async () => button("reset-password-button")?.click());
        expect(mocks.post.mock.calls[0][0]).toContain("password/reset");
    });
});
