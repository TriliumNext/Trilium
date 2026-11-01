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

import UserSettings, { buildSetupUrl, validateUsername } from "./users";

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
/** The rows of the "..." menu opened last by {@link openMenu}. */
const menuItems = () => [ ...[ ...document.querySelectorAll(".tn-popup:not([data-closing])") ].at(-1)?.querySelectorAll<HTMLElement>("li.dropdown-item") ?? [] ];

async function openMenu(row: HTMLElement | undefined) {
    await act(async () => row?.querySelector<HTMLButtonElement>("button.user-row-menu-button")?.click());
}

/** Opens the row's menu and runs its `index`th action: edit, new setup link, delete. */
async function runMenuItem(row: HTMLElement | undefined, index: number) {
    await openMenu(row);
    await act(async () => menuItems()[index]?.click());
    await act(async () => {});
}
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
    it("shows each user with their initials, badges and email, admins and users apart", async () => {
        mocks.users.current = [ ALICE, ADMIN, { ...ALICE, userId: "bob", username: "bob", isAdmin: true } ];
        await open();

        const cards = [ ...host.querySelectorAll<HTMLElement>(".users-list") ];
        expect(cards.map((card) => card.querySelector(".tn-card-heading")?.textContent)).toEqual([ "users.admins_heading", "users.users_heading" ]);
        expect(cards.map((card) => [ ...card.querySelectorAll(".user-row-username") ].map((name) => name.textContent)))
            .toEqual([ [ "admin", "bob" ], [ "alice" ] ]);

        const [ adminRow, , aliceRow ] = rows();
        expect(adminRow.querySelector(".user-avatar")?.textContent).toBe("AD");
        expect(adminRow.querySelector(".user-badge-you")).not.toBeNull();
        expect(adminRow.querySelector(".user-badge-admin")?.textContent).toContain("users.badge_primary_admin");
        expect(adminRow.querySelector(".user-row-email-none")?.textContent).toBe("users.no_email");

        expect(aliceRow.querySelector(".user-badge-admin")).toBeNull();
        // The email and the date are one line, set apart by a bullet as the backup list does.
        expect(aliceRow.querySelector(".user-row-meta")?.textContent).toMatch(/^alice@example\.com • users\.created$/);
    });

    it("leaves out a group with nobody in it", async () => {
        mocks.users.current = [ ADMIN ];
        await open();

        expect([ ...host.querySelectorAll(".users-list .tn-card-heading") ].map((heading) => heading.textContent))
            .toEqual([ "users.admins_heading" ]);
    });

    it("puts the actions in one menu, and blocks deleting yourself", async () => {
        await open();

        expect(rows()[0].querySelectorAll("button")).toHaveLength(1);
        await openMenu(rows()[0]);
        expect(menuItems().map((item) => item.textContent)).toEqual([
            "users.edit_user", "users.create_setup_link", "users.delete_user"
        ]);
        expect(menuItems().map((item) => item.querySelector(".tn-icon")?.className.match(/bx-[\w-]+/)?.[0]))
            .toEqual([ "bx-edit-alt", "bx-link", "bx-trash" ]);
        expect(menuItems()[2].classList.contains("disabled")).toBe(true);
        await act(async () => menuItems()[2].click());
        expect(mocks.confirm).not.toHaveBeenCalled();

        await runMenuItem(rows()[1], 2);
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

        await openMenu(rows()[0]);
        expect(menuItems()[1].classList.contains("disabled")).toBe(true);

        await runMenuItem(rows()[1], 1);
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

        await runMenuItem(rows()[1], 0);
        expect(textBoxes()[0]?.value).toBe("alice");
        await typeInto(textBoxes()[1], "new@example.com");
        await submit();
        expect(mocks.patch).toHaveBeenLastCalledWith("users/alice", { username: "alice", email: "new@example.com", isAdmin: false });

        await runMenuItem(rows()[0], 0);
        expect(adminToggle()?.checked).toBe(true);
        expect(adminToggle()?.disabled).toBe(true);
        expect(dialog()?.textContent).toContain("users.role_locked_primary");
        await submit();
        expect(mocks.patch).toHaveBeenLastCalledWith("users/admin", { username: "admin", email: null, isAdmin: undefined });
    });
});

describe("helpers", () => {
    it("validates usernames and builds setup links", () => {
        expect(validateUsername(" ", [ ALICE ])).toBe("users.error_username_required");
        expect(validateUsername("alice", [ ALICE ])).toBe("users.error_username_taken");
        expect(validateUsername("alice", [ ALICE ], "alice")).toBeUndefined();

        expect(buildSetupUrl("tok", { origin: "https://notes.example.com", pathname: "/trilium/" }))
            .toBe("https://notes.example.com/trilium/?setupAccount=tok");
        expect(buildSetupUrl("tok", { origin: "http://localhost:8080", pathname: "/index.html" }))
            .toBe("http://localhost:8080/?setupAccount=tok");
    });
});
