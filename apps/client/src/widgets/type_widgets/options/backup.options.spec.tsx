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
    /** Whether the encryption option actually reached the server, read back after each write. */
    encryptionStored: false,
    stored: {} as Record<string, boolean>,
    saved: [] as [ string, boolean ][],
    showMessage: vi.fn(),
    showError: vi.fn()
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../../../services/toast", () => ({
    default: { showMessage: mocks.showMessage, showError: mocks.showError }
}));

// The page re-reads the option straight from the store after writing it, to catch a save that was
// swallowed — which is the difference between "encrypted" and "quietly in the clear".
vi.mock("../../../services/options", () => ({
    default: { is: () => mocks.encryptionStored }
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
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
    mocks.encryptionStored = false;
    mocks.stored = {};
    mocks.saved = [];
    (window as unknown as { electronApi: unknown }).electronApi = {
        backupPassphrase: {
            getStatus: async () => mocks.passphrase,
            set: async () => mocks.setResult,
            clear: async () => mocks.clearResult
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

    it("offers to replace the passphrase, and a switch, once one is held", async () => {
        mocks.passphrase = { available: true, set: true };
        await open();

        expect(button("change-backup-password-button")).not.toBeNull();
        expect(button("turn-on-backup-encryption-button")).toBeNull();
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

    it("turns encryption on and says so once the keyring has taken the passphrase", async () => {
        mocks.encryptionStored = true;
        await open();
        await savePassword();

        expect(mocks.saved).toContainEqual([ "backupEnableEncryption", true ]);
        expect(mocks.showMessage).toHaveBeenCalledWith("backup.password_stored");
    });

    it("says nothing at all when the user declines the OS confirmation", async () => {
        mocks.setResult = "cancelled";
        await open();
        await savePassword();

        expect(mocks.saved).toEqual([]);
        expect(mocks.showError).not.toHaveBeenCalled();
        expect(mocks.showMessage).not.toHaveBeenCalled();
    });

    it("reports a keyring that would not take it, and leaves encryption off", async () => {
        mocks.setResult = "failed";
        await open();
        await savePassword();

        expect(mocks.saved).toEqual([]);
        expect(mocks.showError).toHaveBeenCalledWith("backup.password_not_stored");
    });

    it("warns when the passphrase was kept but the setting never reached the server", async () => {
        // Otherwise the next backup goes out in the clear under the belief that it is encrypted.
        mocks.encryptionStored = false;
        await open();
        await savePassword();

        expect(mocks.showError).toHaveBeenCalledWith("backup.encryption_not_enabled");
        expect(mocks.showMessage).not.toHaveBeenCalled();
    });
});

describe("turning encryption off", () => {
    beforeEach(() => {
        mocks.passphrase = { available: true, set: true };
        mocks.stored = { backupEnableEncryption: true };
    });

    /** Flips the encryption switch, which is the one beside the change-password button. */
    async function flipOff() {
        const toggle = host.querySelector<HTMLInputElement>(".tn-card-option input.switch-toggle");
        await act(async () => void toggle?.dispatchEvent(new Event("input", { bubbles: true })));
        await act(async () => {});
    }

    it("forgets the passphrase along with the setting, there being nothing left to keep it for", async () => {
        await open();
        await flipOff();

        expect(mocks.saved).toContainEqual([ "backupEnableEncryption", false ]);
        expect(mocks.showError).not.toHaveBeenCalled();
    });

    it("leaves the setting alone when the OS confirmation is declined", async () => {
        mocks.clearResult = "cancelled";
        await open();
        await flipOff();

        expect(mocks.saved).toEqual([]);
    });

    it("warns when the passphrase is gone but the setting stayed on", async () => {
        // The passphrase is already forgotten by this point, so a backup believed encrypted would
        // quietly fall back to an unencrypted one with nothing on the page to explain why.
        mocks.encryptionStored = true;
        await open();
        await flipOff();

        expect(mocks.showError).toHaveBeenCalledWith("backup.encryption_not_disabled");
    });
});
