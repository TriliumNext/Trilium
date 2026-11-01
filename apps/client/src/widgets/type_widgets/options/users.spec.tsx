import type { UserListItem } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    const users: { current: unknown[] } = { current: [] };

    return {
        users,
        get: vi.fn(async (url: string) => {
            if (url === "users") return users.current;
            if (url === "keyboard-actions") return [];
            return {};
        }),
        post: vi.fn(async (url: string) => (url === "users"
            ? { userId: "new", setupLink: { token: "new-token", expiresAt: "2026-11-08 10:00:00.000Z" } }
            : { token: "fresh-token", expiresAt: "2026-11-08 10:00:00.000Z" })),
        patch: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
        confirm: vi.fn(async () => true),
        copyText: vi.fn(() => true),
        showMessage: vi.fn()
    };
});

vi.mock("../../../services/server", () => ({
    default: { get: mocks.get, post: mocks.post, patch: mocks.patch, remove: mocks.remove }
}));

vi.mock("../../../services/dialog", () => ({ default: { confirm: mocks.confirm } }));

vi.mock("../../../services/clipboard_ext", () => ({ copyText: mocks.copyText }));

vi.mock("../../../services/toast", () => ({ default: { showMessage: mocks.showMessage, showError: vi.fn() } }));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("./components/OptionsPageHeader", () => ({
    default: ({ below }: { below?: preact.ComponentChildren }) => <div className="header-stub">{below}</div>
}));

// The real modal opens through jQuery and Bootstrap, which happy-dom cannot carry. Like Bootstrap,
// the stand-in reports `onHidden` once a shown dialog has been closed.
vi.mock("../../react/Modal", async () => {
    const { useEffect, useRef } = await import("preact/hooks");

    return {
        default: ({ className, show, footer, onSubmit, onHidden, children }: {
            className?: string;
            show?: boolean;
            footer?: preact.ComponentChildren;
            onSubmit?: () => void;
            onHidden?: () => void;
            children?: preact.ComponentChildren;
        }) => {
            const wasShown = useRef(false);
            useEffect(() => {
                if (wasShown.current && !show) onHidden?.();
                wasShown.current = !!show;
            }, [ show ]);

            return show
                ? <div className={`modal ${className ?? ""}`}>
                    <form onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
                        <div className="modal-body">{children}</div>
                        <div className="modal-footer">{footer}</div>
                    </form>
                </div>
                : null;
        }
    };
});

import UserSettings, { buildSetupUrl, getInitials, getUsernameHue, validateUsername } from "./users";

const ADMIN: UserListItem = {
    userId: "admin", username: "admin", email: null, isAdmin: true,
    isPrimaryAdmin: true, isCurrentUser: true, hasPassword: false, setupLinkExpiresAt: null,
    dateCreated: "2026-11-01 10:00:00.000Z"
};
const ALICE: UserListItem = {
    userId: "alice", username: "alice", email: "alice@example.com", isAdmin: false,
    isPrimaryAdmin: false, isCurrentUser: false, hasPassword: false, setupLinkExpiresAt: "2026-11-08 11:00:00.000Z",
    dateCreated: "2026-11-01 11:00:00.000Z"
};

let host: HTMLElement;

beforeEach(() => {
    mocks.users.current = [ ADMIN, ALICE ];
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
    vi.clearAllMocks();
});

async function open() {
    await act(async () => {
        render(<UserSettings />, host);
    });
}

const rows = () => [ ...host.querySelectorAll<HTMLElement>(".user-row") ];
const dialog = () => document.querySelector(".user-dialog");
const textBoxes = () => [ ...(dialog()?.querySelectorAll<HTMLInputElement>("input:not([type='checkbox'])") ?? []) ];
const adminToggle = () => dialog()?.querySelector<HTMLInputElement>("input[type='checkbox']");

async function typeInto(input: HTMLInputElement | undefined, value: string) {
    await act(async () => {
        if (!input) return;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

async function submit() {
    await act(async () => dialog()?.querySelector<HTMLFormElement>("form")?.requestSubmit());
    await act(async () => {});
}

describe("the user list", () => {
    it("shows each user with their initials, badges and email", async () => {
        await open();

        expect(rows()).toHaveLength(2);
        const [ adminRow, aliceRow ] = rows();
        expect(adminRow.querySelector(".user-avatar")?.textContent).toBe("AD");
        expect(adminRow.querySelector(".user-badge-you")).not.toBeNull();
        expect(adminRow.querySelector(".user-badge-admin")?.textContent).toContain("users.badge_primary_admin");
        expect(adminRow.querySelector(".user-row-email-none")?.textContent).toBe("users.no_email");

        expect(aliceRow.querySelector(".user-badge-admin")).toBeNull();
        expect(aliceRow.querySelector(".user-row-email")?.textContent).toBe("alice@example.com");
    });

    it("blocks deleting yourself, and deletes another user after confirming", async () => {
        await open();
        const deleteButton = (row: HTMLElement) => row.querySelector<HTMLButtonElement>(".destructive-action-icon");

        expect(deleteButton(rows()[0])?.disabled).toBe(true);

        await act(async () => deleteButton(rows()[1])?.click());
        expect(mocks.confirm).toHaveBeenCalled();
        expect(mocks.remove).toHaveBeenCalledWith("users/alice");
        expect(mocks.get.mock.calls.filter(([ url ]) => url === "users")).toHaveLength(2);
    });
});

describe("setup links", () => {
    it("says where each user stands with their password", async () => {
        mocks.users.current = [
            ADMIN,
            ALICE,
            { ...ALICE, userId: "carol", username: "carol", setupLinkExpiresAt: null },
            { ...ALICE, userId: "dave", username: "dave", hasPassword: true, setupLinkExpiresAt: null },
            { ...ALICE, userId: "erin", username: "erin", hasPassword: true }
        ];
        await open();

        const status = (row: HTMLElement) => row.querySelector(".user-badge-pending, .user-badge-expired")?.textContent ?? null;
        expect(rows().map(status)).toEqual([
            null,
            "users.badge_setup_pending",
            "users.badge_setup_expired",
            null,
            "users.badge_reset_pending"
        ]);
    });

    it("creates a new link after confirming, but never for the primary admin", async () => {
        await open();
        // Edit, new setup link, delete: the link is the middle one.
        const linkButton = (row: HTMLElement) => row.querySelectorAll<HTMLButtonElement>(".tn-card-option-actions > button")[1];

        expect(linkButton(rows()[0]).disabled).toBe(true);

        await act(async () => linkButton(rows()[1]).click());
        await act(async () => {});
        expect(mocks.confirm).toHaveBeenCalledWith("users.create_setup_link_confirmation");
        expect(mocks.post).toHaveBeenCalledWith("users/alice/setup-link");
        expect(document.querySelector<HTMLInputElement>(".setup-link-dialog input")?.value)
            .toBe("http://localhost:3000/?setupAccount=fresh-token");
    });
});

describe("the user dialog", () => {
    it("adds a user, trimming the name and storing a blank email as none", async () => {
        await open();
        await act(async () => host.querySelector<HTMLButtonElement>("button[name='create-user-button']")?.click());

        // The fields sit in cards, and the role is a single toggle rather than a choice of two.
        expect(dialog()?.querySelectorAll(".tn-card")).toHaveLength(2);
        expect(dialog()?.querySelector("input[type='radio']")).toBeNull();

        const [ username, email ] = textBoxes();
        await typeInto(username, "  bob ");
        await typeInto(email, " ");
        expect(adminToggle()?.checked).toBe(false);
        await act(async () => adminToggle()?.click());
        await submit();

        expect(mocks.post).toHaveBeenCalledWith("users", { username: "bob", email: null, isAdmin: true });
        expect(dialog()).toBeNull();

        // The new user's link is shown once the user dialog is gone, ready to copy.
        const linkBox = document.querySelector<HTMLInputElement>(".setup-link-dialog input");
        expect(linkBox?.value).toBe("http://localhost:3000/?setupAccount=new-token");
        await act(async () => document.querySelector<HTMLButtonElement>(".setup-link-row .btn")?.click());
        expect(mocks.copyText).toHaveBeenCalledWith("http://localhost:3000/?setupAccount=new-token");
    });

    it("refuses a username another user already has, without asking the server", async () => {
        await open();
        await act(async () => host.querySelector<HTMLButtonElement>("button[name='create-user-button']")?.click());

        await typeInto(textBoxes()[0], "alice");
        await submit();

        expect(mocks.post).not.toHaveBeenCalled();
        expect(dialog()?.textContent).toContain("users.error_username_taken");
    });

    it("edits a user, but leaves the role of the primary admin alone", async () => {
        await open();
        const edit = (row: HTMLElement) => row.querySelector<HTMLButtonElement>(".tn-card-option-actions button:not(.destructive-action-icon)");

        await act(async () => edit(rows()[1])?.click());
        expect(textBoxes()[0]?.value).toBe("alice");
        await typeInto(textBoxes()[1], "new@example.com");
        await submit();
        expect(mocks.patch).toHaveBeenLastCalledWith("users/alice", { username: "alice", email: "new@example.com", isAdmin: false });

        await act(async () => edit(rows()[0])?.click());
        expect(adminToggle()?.checked).toBe(true);
        expect(adminToggle()?.disabled).toBe(true);
        expect(dialog()?.textContent).toContain("users.role_locked_primary");
        await submit();
        expect(mocks.patch).toHaveBeenLastCalledWith("users/admin", { username: "admin", email: null, isAdmin: undefined });
    });
});

describe("helpers", () => {
    it("derives initials, a stable hue and username errors", () => {
        expect(getInitials("alice")).toBe("AL");
        expect(getInitials("jane.doe")).toBe("JD");
        expect(getInitials("  ")).toBe("?");

        expect(getUsernameHue("alice")).toBe(getUsernameHue("alice"));
        expect(getUsernameHue("alice")).toBeGreaterThanOrEqual(0);
        expect(getUsernameHue("alice")).toBeLessThan(360);

        expect(validateUsername(" ", [ ALICE ])).toBe("users.error_username_required");
        expect(validateUsername("alice", [ ALICE ])).toBe("users.error_username_taken");
        expect(validateUsername("alice", [ ALICE ], "alice")).toBeUndefined();

        expect(buildSetupUrl("tok", { origin: "https://notes.example.com", pathname: "/trilium/" }))
            .toBe("https://notes.example.com/trilium/?setupAccount=tok");
        expect(buildSetupUrl("tok", { origin: "http://localhost:8080", pathname: "/index.html" }))
            .toBe("http://localhost:8080/?setupAccount=tok");
    });
});
