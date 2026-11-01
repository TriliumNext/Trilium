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
        post: vi.fn(async () => ({ userId: "new" })),
        patch: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
        confirm: vi.fn(async () => true),
        showMessage: vi.fn()
    };
});

vi.mock("../../../services/server", () => ({
    default: { get: mocks.get, post: mocks.post, patch: mocks.patch, remove: mocks.remove }
}));

vi.mock("../../../services/dialog", () => ({ default: { confirm: mocks.confirm } }));

vi.mock("../../../services/toast", () => ({ default: { showMessage: mocks.showMessage, showError: vi.fn() } }));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("./components/OptionsPageHeader", () => ({
    default: ({ below }: { below?: preact.ComponentChildren }) => <div className="header-stub">{below}</div>
}));

// The real modal opens through jQuery and Bootstrap, which happy-dom cannot carry.
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

import UserSettings, { getInitials, getUsernameHue, validateUsername } from "./users";

const ADMIN: UserListItem = {
    userId: "admin", username: "admin", email: null, isAdmin: true,
    isPrimaryAdmin: true, isCurrentUser: true, dateCreated: "2026-11-01 10:00:00.000Z"
};
const ALICE: UserListItem = {
    userId: "alice", username: "alice", email: "alice@example.com", isAdmin: false,
    isPrimaryAdmin: false, isCurrentUser: false, dateCreated: "2026-11-01 11:00:00.000Z"
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
const textBoxes = () => [ ...(dialog()?.querySelectorAll<HTMLInputElement>("input:not([type='radio'])") ?? []) ];

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

describe("the user dialog", () => {
    it("adds a user, trimming the name and storing a blank email as none", async () => {
        await open();
        await act(async () => host.querySelector<HTMLButtonElement>("button[name='create-user-button']")?.click());

        const [ username, email ] = textBoxes();
        await typeInto(username, "  bob ");
        await typeInto(email, " ");
        await act(async () => dialog()?.querySelector<HTMLInputElement>("input[value='admin']")?.click());
        await submit();

        expect(mocks.post).toHaveBeenCalledWith("users", { username: "bob", email: null, isAdmin: true });
        expect(dialog()).toBeNull();
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
        expect(dialog()?.querySelector("input[type='radio']")).toBeNull();
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
    });
});
