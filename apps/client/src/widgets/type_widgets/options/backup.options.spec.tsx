import type { BackupPassphraseStatus } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    /** What the OS keyring reports: whether there is one, and whether it holds a passphrase. */
    passphrase: { available: true, set: false } as BackupPassphraseStatus,
    /** What the keyring answers when asked to store or forget one. */
    setResult: "applied" as string,
    clearResult: "applied" as string,
    clear: vi.fn(),
    stored: {} as Record<string, boolean>,
    saved: [] as [ string, boolean ][],
    showMessage: vi.fn(),
    showError: vi.fn()
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../../../services/toast", () => ({
    default: { showMessage: mocks.showMessage, showError: mocks.showError }
}));

vi.mock("../../react/hooks/options", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks/options")>()),
    useTriliumOptionBool: (name: string) => [
        mocks.stored[name] === true,
        async (value: boolean) => void mocks.saved.push([ name, value ])
    ]
}));

import { BackupOptions } from "./backup";

let host: HTMLElement;

beforeEach(() => {
    mocks.passphrase = { available: true, set: false };
    mocks.setResult = "applied";
    mocks.clearResult = "applied";
    mocks.stored = {};
    mocks.saved = [];
    (window as unknown as { electronApi: unknown }).electronApi = {
        backupPassphrase: {
            getStatus: async () => mocks.passphrase,
            async set() {
                if (mocks.setResult === "applied") {
                    mocks.passphrase = { ...mocks.passphrase, set: true };
                }
                return mocks.setResult;
            },
            async clear() {
                mocks.clear();
                if (mocks.clearResult === "applied") {
                    mocks.passphrase = { ...mocks.passphrase, set: false };
                }
                return mocks.clearResult;
            }
        }
    };
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
    delete (window as unknown as { electronApi?: unknown }).electronApi;
    vi.clearAllMocks();
});

async function open() {
    await act(async () => {
        render(null, host);
        render(<BackupOptions />, host);
    });
    // The keyring is asked what it holds as the card mounts.
    await act(async () => {});
}

const button = (name: string) => host.querySelector<HTMLButtonElement>(`button[name='${name}']`);
const encryptionRow = () => host.querySelector(".tn-card-option");
/** The switch beside the change-password button. */
const encryptionSwitch = () =>
    encryptionRow()?.querySelector<HTMLInputElement>("input.switch-toggle");

describe("what the encryption controls offer", () => {
    it("holds the whole feature out of reach without a keyring to keep the passphrase in", async () => {
        mocks.passphrase = { available: false, set: false };
        await open();

        expect(button("turn-on-backup-encryption-button")?.disabled).toBe(true);
        expect(encryptionRow()?.querySelector(".tn-card-option-description")?.textContent).toBe("backup.no_keyring");
    });

    it("offers to set a passphrase where there is a keyring but nothing in it yet", async () => {
        await open();

        expect(button("turn-on-backup-encryption-button")?.disabled).toBe(false);
        expect(button("change-backup-password-button")).toBeNull();
        // Nothing to switch on until there is a passphrase to switch it on with.
        expect(host.querySelector("input.switch-toggle[id^='backup-compression']")).not.toBeNull();
    });

    it("mounts the password dialog on the body, beside Bootstrap's backdrop", async () => {
        await open();

        const modal = document.querySelector(".backup-password-modal");
        expect(modal).not.toBeNull();
        expect(host.contains(modal)).toBe(false);
        expect(modal?.parentElement).toBe(document.body);
    });

    it("offers to replace the passphrase, and a switch that is on, once one is held", async () => {
        // A stored passphrase decides; the option can say otherwise after a page script wrote it.
        mocks.passphrase = { available: true, set: true };
        mocks.stored = { backupEnableEncryption: false };
        await open();

        expect(button("change-backup-password-button")).not.toBeNull();
        expect(button("turn-on-backup-encryption-button")).toBeNull();
        expect(encryptionSwitch()?.checked).toBe(true);
    });
});

describe("storing a passphrase", () => {
    /** Types a password into the dialog twice over and saves it, which is what the card acts on. */
    async function savePassword(password = "hunter2") {
        await act(async () => button("turn-on-backup-encryption-button")?.click());

        const boxes = [ ...document.querySelectorAll<HTMLInputElement>(".backup-password-modal input[type='password']") ];
        for (const box of boxes) {
            await act(async () => {
                box.value = password;
                box.dispatchEvent(new Event("input", { bubbles: true }));
            });
        }

        await act(async () => {
            document.querySelector<HTMLFormElement>(".backup-password-modal form")?.requestSubmit();
        });
        await act(async () => {});
    }

    it("says so once the keyring has taken the passphrase, and shows encryption on", async () => {
        await open();
        await savePassword();

        expect(mocks.showMessage).toHaveBeenCalledWith("backup.password_stored");
        expect(mocks.showError).not.toHaveBeenCalled();
        expect(encryptionSwitch()?.checked).toBe(true);
        // The options route refuses the option, so the page never writes it.
        expect(mocks.saved).toEqual([]);
    });

    it("says nothing at all when the user declines the OS confirmation", async () => {
        mocks.setResult = "cancelled";
        await open();
        await savePassword();

        expect(mocks.showError).not.toHaveBeenCalled();
        expect(mocks.showMessage).not.toHaveBeenCalled();
        expect(button("turn-on-backup-encryption-button")).not.toBeNull();
    });

    it("reports a keyring that would not take it, and leaves encryption off", async () => {
        mocks.setResult = "failed";
        await open();
        await savePassword();

        expect(mocks.showError).toHaveBeenCalledWith("backup.password_not_stored");
        expect(button("turn-on-backup-encryption-button")).not.toBeNull();
    });
});

describe("turning encryption off", () => {
    beforeEach(() => {
        mocks.passphrase = { available: true, set: true };
    });

    async function flipOff() {
        const toggle = encryptionSwitch();
        expect(toggle?.checked).toBe(true);
        await act(async () => void toggle?.dispatchEvent(new Event("input", { bubbles: true })));
        await act(async () => {});
    }

    it("forgets the passphrase, which is what switches encryption off", async () => {
        await open();
        await flipOff();

        expect(mocks.clear).toHaveBeenCalledOnce();
        expect(button("turn-on-backup-encryption-button")).not.toBeNull();
        expect(mocks.saved).toEqual([]);
        expect(mocks.showError).not.toHaveBeenCalled();
    });

    it("keeps the switch on when the OS confirmation is declined", async () => {
        mocks.clearResult = "cancelled";
        await open();
        await flipOff();

        expect(mocks.clear).toHaveBeenCalledOnce();
        expect(encryptionSwitch()?.checked).toBe(true);
        expect(mocks.saved).toEqual([]);
    });
});
