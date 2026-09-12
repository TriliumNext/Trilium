import type { SetupBackupDefaults } from "@triliumnext/commons";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// t() returns the key so assertions are deterministic and not tied to English text.
vi.mock("./services/i18n", () => ({ t: (key: string) => key }));

const mocks = vi.hoisted(() => ({
    startBackupDownload: vi.fn(
        async (
            _fileName: string,
            _passphrase?: string,
            _onProgress?: (sentBytes: number, totalBytes: number) => void
        ) => ({ status: "done" }) as { status: string; message?: string }
    )
}));

vi.mock("./services/backup_download", async (importOriginal) => ({
    // The naming rules are real (they have their own tests); only the download is stubbed.
    ...(await importOriginal<typeof import("./services/backup_download")>()),
    isBackupDownloadSupported: () => true,
    startBackupDownload: mocks.startBackupDownload
}));

import SetupBackupDatabase, { BackupParameters } from "./setup_backup";

let container: HTMLDivElement;
const onDone = vi.fn();

/** Preact flushes effects and state through the microtask queue plus a frame. */
const settle = () => vi.advanceTimersByTimeAsync(50);

function renderScreen() {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(<SetupBackupDatabase onDone={onDone} />, container);

    return container;
}

function button(label: string): HTMLButtonElement | undefined {
    return [ ...container.querySelectorAll("button") ]
        .find((element) => element.textContent?.includes(label));
}

function nameField(): HTMLInputElement | null {
    return container.querySelector<HTMLInputElement>("input:not([type=password])");
}

/** The password pair, in the order they are filled in: the password, then its confirmation. */
function passwordFields(): HTMLInputElement[] {
    return [ ...container.querySelectorAll<HTMLInputElement>("input[type=password]") ];
}

/** The toggles, in the order they appear: the stored password, then compression. */
function toggles(): HTMLInputElement[] {
    return [ ...container.querySelectorAll<HTMLInputElement>("input.switch-toggle") ];
}

/** Operates a toggle the way a click on it does. */
function flip(toggle: HTMLInputElement | undefined) {
    if (!toggle) {
        throw new Error("the toggle is not on screen");
    }

    toggle.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Types into a controlled text box the way the browser does: value, then an input event. */
function type(input: HTMLInputElement | null, value: string) {
    if (!input) {
        throw new Error("the field is not on screen");
    }

    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The shape of the name proposed by commons, which every platform now suggests. */
const SUGGESTED_NAME = /^Trilium data \(\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\)$/;

/**
 * Answers the parameters screen and arrives at the download, which is where most of this is.
 *
 * @returns the name the backup was left under, since the field is gone by the time it matters.
 */
async function reachDownload({ name, password }: { name?: string; password?: string } = {}) {
    renderScreen();
    await settle();

    if (name !== undefined) {
        type(nameField(), name);
        await settle();
    }
    if (password !== undefined) {
        const [ first, second ] = passwordFields();
        type(first, password);
        type(second, password);
        await settle();
    }

    const chosen = nameField()?.value ?? "";
    button("setup.continue")?.click();
    await settle();

    return chosen;
}

beforeEach(() => {
    vi.useFakeTimers();
    onDone.mockReset();
    mocks.startBackupDownload.mockReset().mockResolvedValue({ status: "done" });
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.useRealTimers();
});

describe("choosing what the backup is called and whether it is locked", () => {
    it("opens on the parameters, with the name filled in and nothing downloading", async () => {
        renderScreen();
        await settle();

        expect(container.textContent).toContain("setup.backup-name");
        expect(nameField()?.value).toMatch(SUGGESTED_NAME);
        // Optional, so both fields start empty and Continue is available anyway.
        expect(passwordFields().map((field) => field.value)).toEqual([ "", "" ]);
        expect(button("setup.continue")?.disabled).toBe(false);
        expect(mocks.startBackupDownload).not.toHaveBeenCalled();
        // Nothing here is destructive, so leaving is available from the start.
        expect(button("setup.backup-finish")?.disabled).toBe(false);
    });

    it("will not continue on a password typed only once, which would back up unlocked", async () => {
        renderScreen();
        await settle();

        const [ first, second ] = passwordFields();
        type(first, "hunter2");
        await settle();
        expect(button("setup.continue")?.disabled).toBe(true);

        type(second, "hunter3");
        await settle();
        expect(button("setup.continue")?.disabled).toBe(true);

        type(second, "hunter2");
        await settle();
        expect(button("setup.continue")?.disabled).toBe(false);
    });

    it("refuses characters a filename cannot hold, as they are typed", async () => {
        renderScreen();
        await settle();

        type(nameField(), 'Q3 notes: "final" <v2>');
        await settle();

        expect(nameField()?.value).toBe("Q3 notes final v2");
    });

    it("carries the name and password through to the download", async () => {
        await reachDownload({ name: "Before the big import", password: "hunter2" });

        button("setup.backup-download")?.click();
        await settle();

        expect(mocks.startBackupDownload)
            .toHaveBeenCalledWith("Before the big import.tnbackup", "hunter2", expect.any(Function));
    });

    it("downloads under the suggested name, without a password, when neither was touched", async () => {
        const chosen = await reachDownload();
        expect(chosen).toMatch(SUGGESTED_NAME);

        button("setup.backup-download")?.click();
        await settle();

        // Empty, not absent: the service turns that into an unencrypted container.
        expect(mocks.startBackupDownload)
            .toHaveBeenCalledWith(`${chosen}.tnbackup`, "", expect.any(Function));
    });
});

describe("the questions a platform that writes its own backup can ask", () => {
    const onContinue = vi.fn();

    /** Renders just the parameters screen, which is the only part of this the platform changes. */
    async function renderParameters(defaults: SetupBackupDefaults | null) {
        container = document.createElement("div");
        document.body.appendChild(container);
        render(<BackupParameters defaults={defaults} onContinue={onContinue} />, container);
        await settle();
    }

    beforeEach(() => onContinue.mockReset());

    it("asks nothing about the format where there is no format to choose", async () => {
        // The standalone platform, whose backup is a download: nothing stored to lock it with, and
        // compressing the stream is more than the devices it exists for can afford.
        await renderParameters(null);

        expect(container.textContent).toContain("setup.backup-name");
        expect(container.textContent).not.toContain("setup.backup-compress");
        expect(container.textContent).not.toContain("setup.backup-use-stored-password");
        expect(toggles()).toHaveLength(0);
    });

    it("starts from how the instance already backs up, rather than from nothing", async () => {
        await renderParameters({ storedPassphrase: true, encrypt: true, compress: true });

        const [ stored, compress ] = toggles();
        expect(stored.checked).toBe(true);
        expect(compress.checked).toBe(true);
        // Nothing to type, so nothing is asked for: the stored password is never shown, which is
        // why asking for it is a choice rather than a value, and the fields it stands in for have
        // no part left to play.
        expect(passwordFields()).toHaveLength(0);
        expect(container.textContent).not.toContain("setup.backup-password-description");
        expect(button("setup.continue")?.disabled).toBe(false);
    });

    it("offers the password fields where the instance encrypts nothing", async () => {
        await renderParameters({ storedPassphrase: true, encrypt: false, compress: false });

        const [ stored, compress ] = toggles();
        expect(stored.checked).toBe(false);
        expect(compress.checked).toBe(false);
        expect(passwordFields()).toHaveLength(2);
    });

    it("offers no stored password where there is none stored", async () => {
        // Every server deployment, and any desktop whose system has no keyring to keep one in.
        await renderParameters({ storedPassphrase: false, encrypt: true, compress: false });

        expect(container.textContent).not.toContain("setup.backup-use-stored-password");
        expect(container.textContent).toContain("setup.backup-compress");
        expect(passwordFields()).toHaveLength(2);
    });

    it("gives the fields back when the stored password is turned off again", async () => {
        await renderParameters({ storedPassphrase: true, encrypt: true, compress: false });

        flip(toggles()[0]);
        await settle();

        expect(passwordFields()).toHaveLength(2);
        type(passwordFields()[0], "hunter2");
        type(passwordFields()[1], "hunter2");
        await settle();

        button("setup.continue")?.click();
        expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({
            passphrase: "hunter2",
            useStoredPassphrase: false
        }));
    });

    it("does not let a password that is no longer on screen hold up continuing", async () => {
        await renderParameters({ storedPassphrase: true, encrypt: false, compress: false });

        // Half-typed, which is the one state Continue must not accept...
        type(passwordFields()[0], "hunter2");
        await settle();
        expect(button("setup.continue")?.disabled).toBe(true);

        // ...until the fields go away with the choice that replaces them. What they were holding
        // goes with them, or Continue would stay disabled by a segment nobody can see.
        flip(toggles()[0]);
        await settle();
        expect(passwordFields()).toHaveLength(0);
        expect(button("setup.continue")?.disabled).toBe(false);

        button("setup.continue")?.click();
        expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({
            passphrase: "",
            useStoredPassphrase: true
        }));
    });

    it("hands on every answer, so the backup is written as the user described it", async () => {
        await renderParameters({ storedPassphrase: false, encrypt: false, compress: false });

        type(nameField(), "Before the import");
        flip(toggles()[0]);
        await settle();

        button("setup.continue")?.click();
        expect(onContinue).toHaveBeenCalledWith({
            name: "Before the import",
            passphrase: "",
            useStoredPassphrase: false,
            compress: true
        });
    });
});

describe("backing up from the setup screen", () => {
    it("names the file up front and downloads nothing until asked", async () => {
        const chosen = await reachDownload();

        expect(container.textContent).toContain("setup.backup-data");
        // The name is on the screen before the download, since it is what the user goes looking
        // for afterwards, and it is the one part of the line that is not boilerplate.
        expect(container.querySelector(".backup-download-file strong")?.textContent)
            .toBe(`${chosen}.tnbackup`);
        expect(mocks.startBackupDownload).not.toHaveBeenCalled();
        expect(button("setup.backup-finish")?.disabled).toBe(false);
    });

    it("downloads on request, and says so while it runs and once it is done", async () => {
        let finish: (result: { status: string }) => void = () => {};
        mocks.startBackupDownload.mockImplementation(() => new Promise((resolve) => {
            finish = resolve;
        }));
        await reachDownload();

        button("setup.backup-download")?.click();
        await settle();

        expect(container.textContent).toContain("setup.backup-downloading");
        // Said while it runs, because leaving the screen is exactly what would break it.
        expect(container.textContent).toContain("setup.backup-do-not-close");
        // The running download has the screen to itself: nothing to press, nothing to re-read.
        expect(button("setup.backup-download")).toBeUndefined();
        expect(container.querySelector(".backup-download-file")).toBeNull();
        // Leaving mid-stream would abandon the download, so that one moment is held.
        expect(button("setup.backup-finish")?.disabled).toBe(true);

        finish({ status: "done" });
        await settle();
        // The outcome is stated where it cannot be missed, and taking another copy is offered again.
        expect(container.querySelector(".backup-download-outcome")?.textContent)
            .toContain("setup.backup-downloaded");
        expect(container.textContent).not.toContain("setup.backup-do-not-close");
        expect(button("setup.backup-download")?.disabled).toBe(false);
        expect(container.querySelector(".backup-download-file")).not.toBeNull();
        expect(button("setup.backup-finish")?.disabled).toBe(false);
    });

    it("counts the download as it goes, since the browser's own progress is out of sight on a phone", async () => {
        let report: ((sent: number, total: number) => void) | undefined;
        mocks.startBackupDownload.mockImplementation((_name, _passphrase, onProgress) => {
            report = onProgress;

            return new Promise(() => {});
        });
        await reachDownload();

        button("setup.backup-download")?.click();
        await settle();
        // Nothing yet: a total of nothing has no percentage, and the spinner already says "working".
        expect(container.querySelector(".backup-download-progress")).toBeNull();

        report?.(512 * 1024 * 1024, 1024 * 1024 * 1024);
        await settle();
        expect(container.querySelector(".backup-download-progress")?.textContent)
            .toContain("setup.backup-downloading-size");
        // Its own element, which is what lets a width be held for it.
        expect(container.querySelector(".backup-download-percent")?.textContent)
            .toBe("setup.backup-downloading-percent");
        expect(mocks.startBackupDownload).toHaveBeenCalledWith(
            expect.any(String), "", expect.any(Function));
    });

    it("shows what stopped a failed download, and offers another go", async () => {
        mocks.startBackupDownload.mockResolvedValue({ status: "failed", message: "the stream broke" });
        await reachDownload();

        button("setup.backup-download")?.click();
        await settle();

        expect(container.querySelector(".backup-download-outcome")?.textContent)
            .toContain("the stream broke");
        // Trying again is the way out, so the button and the name it writes are both back.
        expect(button("setup.backup-download")?.disabled).toBe(false);
        expect(container.querySelector(".backup-download-file")).not.toBeNull();
        // Still not trapped: the way back to the notes stays open through a failure.
        expect(button("setup.backup-finish")?.disabled).toBe(false);
    });

    it("hands back to the application when it is done with", async () => {
        await reachDownload();

        button("setup.backup-finish")?.click();
        await settle();

        expect(onDone).toHaveBeenCalled();
    });
});
