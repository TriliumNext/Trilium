import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// t() returns the key so assertions are deterministic and not tied to English text, with any
// interpolated values after it: those are ours to get right, unlike the sentence around them.
vi.mock("./services/i18n", () => ({
    t: (key: string, values?: Record<string, unknown>) => [ key, ...Object.values(values ?? {}) ].join(" ")
}));

import en from "./translations/en/entry.json";

const serverMock = vi.hoisted(() => ({
    // The default serves what transitively imported modules ask for as they load (keyboard_actions
    // fetches its shortcut list on import); the routing installed in beforeEach overrides it.
    get: vi.fn(async (url: string): Promise<unknown> => (url === "keyboard-actions" ? [] : {})),
    post: vi.fn(async (): Promise<unknown> => ({}))
}));
vi.mock("./services/server", () => ({ default: serverMock }));

const uploadMock = vi.hoisted(() => ({
    uploadInChunks: vi.fn(),
    // Stands in for the real one, which the screen tests failures against: mocking the module whole
    // would otherwise leave it undefined.
    ChunkedUploadError: class ChunkedUploadError extends Error {
        constructor(message: string, readonly status: number) {
            super(message);
        }
    }
}));
vi.mock("./services/chunked_upload", () => uploadMock);

import RestoreFromBackup, { stageLabel } from "./setup_restore";

const BACKUPS = [
    { fileName: "backup-daily.db", filePath: "/data/backup/backup-daily.db", mtime: "2026-08-01T10:00:00Z", fileSize: 2048, encrypted: false },
    { fileName: "backup-weekly.tnbackup", filePath: "/data/backup/backup-weekly.tnbackup", mtime: "2026-08-05T10:00:00Z", fileSize: 1024, compressed: true, encrypted: true }
];

let container: HTMLDivElement;
let restore: { stage: string; fraction?: number; error?: string; reason?: string } | null;

function renderRestore(props: Partial<{ onBack: () => void; onRestored: () => void }> = {}) {
    container = document.createElement("div");
    document.body.appendChild(container);
    // `onBack` is omitted only when the caller says so: passing it undefined is the case where
    // nothing led here, which is the whole point of some of the tests below.
    const onBack = "onBack" in props ? props.onBack : vi.fn();
    render(<RestoreFromBackup onBack={onBack} onRestored={props.onRestored ?? vi.fn()} />, container);

    return container;
}

const flushEffects = () => vi.advanceTimersByTimeAsync(50);
const nextPoll = () => vi.advanceTimersByTimeAsync(1000);

/** The row for a backup, which is the whole clickable section rather than a button inside it. */
function backupRow(name: string) {
    return [ ...container.querySelectorAll<HTMLElement>(".restore-backup-row") ]
        .find((row) => row.textContent?.includes(name));
}

const goBack = () => container.querySelector<HTMLElement>(".back-button")?.click();

beforeEach(() => {
    vi.useFakeTimers();
    restore = null;
    serverMock.get.mockImplementation(async (url: string) => {
        if (url === "database/backups") {
            return { backups: BACKUPS, backupFolderPath: "/data/backup" };
        }
        if (url === "keyboard-actions") {
            return [];
        }
        return { restore };
    });
    serverMock.post.mockResolvedValue({ started: true });
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe("picking a backup", () => {
    it("says what a backup was written as, in the same words the options use", async () => {
        renderRestore();
        await flushEffects();

        const encrypted = backupRow("backup-weekly.tnbackup");
        expect([ ...(encrypted?.querySelectorAll(".database-file-badge") ?? []) ].map((b) => b.textContent))
            .toEqual([ "backup.compressed", "backup.encrypted" ]);
        // Nothing to say about a plain copy, so nothing is said.
        expect(backupRow("backup-daily.db")?.querySelectorAll(".database-file-badge")).toHaveLength(0);
    });

    it("lists what is on the device, newest first, and starts restoring the one that is picked", async () => {
        renderRestore();
        await flushEffects();

        // Everything but the row that opens a file, which is the same kind of row without being a backup.
        const names = [ ...container.querySelectorAll(".restore-backup-row:not(.restore-choose-file) .restore-backup-name") ]
            .map((row) => row.textContent);
        expect(names).toEqual([ "backup-weekly.tnbackup", "backup-daily.db" ]);

        backupRow("backup-daily.db")?.click();
        await flushEffects();

        expect(serverMock.post).toHaveBeenCalledWith("setup/restore/start", {
            source: "existing",
            filePath: "/data/backup/backup-daily.db",
            passphrase: undefined
        });
        expect(container.querySelector(".restore-current-step")).toBeTruthy();
    });

    it("asks for the password first when the backup is encrypted, and sends it with the restore", async () => {
        renderRestore();
        await flushEffects();

        backupRow("backup-weekly.tnbackup")?.click();
        await flushEffects();

        expect(serverMock.post).not.toHaveBeenCalled();
        const input = container.querySelector<HTMLInputElement>("input[type=password]");
        expect(input).toBeTruthy();

        if (input) {
            input.value = "hunter2";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        await flushEffects();
        container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await flushEffects();

        expect(serverMock.post).toHaveBeenCalledWith("setup/restore/start", {
            source: "existing",
            filePath: "/data/backup/backup-weekly.tnbackup",
            passphrase: "hunter2"
        });
    });

    it("still offers a file when the backups cannot be listed", async () => {
        serverMock.get.mockRejectedValueOnce(new Error("no backup directory"));

        renderRestore();
        await flushEffects();

        expect(container.querySelector(".restore-choose-file")).toBeTruthy();
        expect(container.querySelector(".restore-file-input")).toBeTruthy();
    });

    it("says nothing about existing backups when there are none, rather than an empty card", async () => {
        serverMock.get.mockImplementation(async (url: string) =>
            (url === "database/backups" ? { backups: [], backupFolderPath: "/data/backup" } : []));

        renderRestore();
        await flushEffects();

        expect(container.textContent).not.toContain("setup.restore-existing-backups");
        // A device being set up for the first time usually has none, and the way in still has to be there.
        expect(container.querySelector(".restore-choose-file")).toBeTruthy();
    });

    it("says it is looking while it does not yet know", async () => {
        let listBackups: (value: unknown) => void = () => {};
        serverMock.get.mockImplementation(async (url: string) =>
            (url === "database/backups" ? new Promise((resolve) => { listBackups = resolve; }) : []));

        renderRestore();
        await flushEffects();

        expect(container.querySelector(".restore-loading")).toBeTruthy();

        listBackups({ backups: BACKUPS, backupFolderPath: "/data/backup" });
        await flushEffects();

        expect(container.querySelector(".restore-loading")).toBeFalsy();
        expect(container.querySelectorAll(".restore-backup-row:not(.restore-choose-file)")).toHaveLength(2);
    });
});

describe("restoring on standalone", () => {
    const importBackup = vi.fn();

    /** Drives the file input, which is the only way in on standalone: there is nothing to upload. */
    async function chooseFile(file: File) {
        const input = container.querySelector<HTMLInputElement>(".restore-file-input");
        Object.defineProperty(input, "files", { value: [ file ], configurable: true });
        input?.dispatchEvent(new Event("change", { bubbles: true }));
        await flushEffects();
    }

    beforeEach(() => {
        window.standaloneApi = { restore: { importBackup } } as unknown as typeof window.standaloneApi;
    });

    afterEach(() => {
        window.standaloneApi = undefined;
    });

    it("hands the file to the worker that owns the database, rather than uploading it", async () => {
        importBackup.mockResolvedValue({ status: "restored" });
        const onRestored = vi.fn();
        renderRestore({ onRestored });
        await flushEffects();

        const backup = new File([ "database bytes" ], "backup.db");
        await chooseFile(backup);

        // The file itself goes across, not a copy of its bytes and not a request.
        expect(importBackup).toHaveBeenCalledWith(expect.objectContaining({ backup }));
        expect(uploadMock.uploadInChunks).not.toHaveBeenCalled();
        expect(serverMock.post).not.toHaveBeenCalled();
        expect(onRestored).toHaveBeenCalled();
    });

    it("asks for the passphrase when the worker says it needs one, and retries with the same file", async () => {
        importBackup.mockResolvedValueOnce({ status: "needs-passphrase" });
        renderRestore();
        await flushEffects();

        const backup = new File([ "container bytes" ], "backup.tnbackup");
        await chooseFile(backup);

        const input = container.querySelector<HTMLInputElement>("input[type=password]");
        expect(input).toBeTruthy();

        importBackup.mockResolvedValueOnce({ status: "restored" });
        if (input) {
            input.value = "hunter2";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        await flushEffects();
        container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await flushEffects();

        // The same file, kept as a reference: nothing was picked again and nothing was re-read.
        expect(importBackup).toHaveBeenLastCalledWith(expect.objectContaining({ backup, passphrase: "hunter2" }));
    });

    it("shows the step the worker reports, since there is nothing to poll", async () => {
        importBackup.mockImplementation(async ({ onProgress }: { onProgress: (p: unknown) => void }) => {
            onProgress({ stage: "validating" });

            return new Promise(() => {});
        });
        renderRestore();
        await flushEffects();

        await chooseFile(new File([ "database bytes" ], "backup.db"));

        expect(container.querySelector(".restore-step-name")?.textContent).toBe("setup.restore-stage-validating");
        expect(serverMock.get).not.toHaveBeenCalledWith("setup/restore/status");
    });

    it("offers no list of existing backups, since there are none to offer", async () => {
        renderRestore();
        await flushEffects();

        expect(serverMock.get).not.toHaveBeenCalledWith("database/backups");
        expect(container.textContent).not.toContain("setup.restore-existing-backups");
        // The way in from a file is the whole screen here.
        expect(container.querySelector(".restore-choose-file")).toBeTruthy();
    });

    it("reports a refusal in the same words every other platform uses", async () => {
        importBackup.mockResolvedValue({
            status: "error", reason: "database-too-new", message: "The database is version 999."
        });
        renderRestore();
        await flushEffects();

        await chooseFile(new File([ "database bytes" ], "backup.db"));

        expect(container.querySelector(".restore-error-headline")?.textContent).toBe("setup.restore-error-too-new");
        expect(container.querySelector(".restore-error-detail")?.textContent).toBe("The database is version 999.");
    });
});

describe("going back", () => {
    it("leaves the restore altogether from the first step, since there is nothing before it", async () => {
        const onBack = vi.fn();
        renderRestore({ onBack });
        await flushEffects();

        goBack();

        expect(onBack).toHaveBeenCalled();
    });

    it("offers no way back from the first step where nothing led here", async () => {
        // The wizard opened at this screen, so the step it would return to was never shown.
        renderRestore({ onBack: undefined });
        await flushEffects();

        expect(container.querySelector(".back-button")).toBeNull();
    });

    it("still goes back a step within the restore, wherever the restore was entered from", async () => {
        renderRestore({ onBack: undefined });
        await flushEffects();
        backupRow("backup-weekly.tnbackup")?.click();
        await flushEffects();
        expect(container.querySelector("input[type=password]")).toBeTruthy();

        goBack();
        await flushEffects();

        expect(container.querySelector(".restore-choose-file")).toBeTruthy();
    });

    it("returns to the backups from the password prompt, rather than out of the flow", async () => {
        const onBack = vi.fn();
        renderRestore({ onBack });
        await flushEffects();
        backupRow("backup-weekly.tnbackup")?.click();
        await flushEffects();
        expect(container.querySelector("input[type=password]")).toBeTruthy();

        goBack();
        await flushEffects();

        expect(onBack).not.toHaveBeenCalled();
        expect(container.querySelector(".restore-choose-file")).toBeTruthy();
    });

    it("carries no stale wrong-password warning back into the next attempt", async () => {
        renderRestore();
        await flushEffects();
        backupRow("backup-weekly.tnbackup")?.click();
        await flushEffects();

        // The server refuses the password, which puts the prompt back with a warning on it.
        restore = { stage: "failed", reason: "wrong-passphrase-or-damaged-header", error: "Verifier tag did not match." };
        container.querySelector("input[type=password]")?.dispatchEvent(new Event("input", { bubbles: true }));
        await nextPoll();

        goBack();
        await flushEffects();
        backupRow("backup-weekly.tnbackup")?.click();
        await flushEffects();

        expect(container.textContent).not.toContain("setup.restore-wrong-passphrase");
    });

    it("stops an upload it walks away from, and says nothing about it", async () => {
        let uploadSignal: AbortSignal | undefined;
        uploadMock.uploadInChunks.mockImplementation(async ({ signal }: { signal: AbortSignal }) => {
            uploadSignal = signal;

            // Never settles on its own: only the abort can end it, which is the point.
            return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
        });
        renderRestore();
        await flushEffects();

        const input = container.querySelector<HTMLInputElement>(".restore-file-input");
        Object.defineProperty(input, "files", { value: [ new File([ "bytes" ], "backup.db") ], configurable: true });
        input?.dispatchEvent(new Event("change", { bubbles: true }));
        await flushEffects();

        goBack();
        await flushEffects();

        expect(uploadSignal?.aborted).toBe(true);
        expect(container.querySelector(".restore-choose-file")).toBeTruthy();
        // Cancelling is not a failure, so it is not reported as one.
        expect(container.querySelector(".restore-error-headline")).toBeFalsy();
    });
});

describe("uploading a backup", () => {
    /** Drives the file input the "choose a file" button opens. */
    async function chooseFile(file: File) {
        const input = container.querySelector<HTMLInputElement>(".restore-file-input");
        Object.defineProperty(input, "files", { value: [ file ], configurable: true });
        input?.dispatchEvent(new Event("change", { bubbles: true }));
        await flushEffects();
    }

    it("sends the file in chunks, shows how far it has got, and restores it once it is there", async () => {
        uploadMock.uploadInChunks.mockImplementation(async ({ onProgress }: { onProgress: (p: unknown) => void }) => {
            onProgress({ sentBytes: 512, totalBytes: 1024, fraction: 0.5, bytesPerSecond: 0 });
            return { fileName: "backup.db", encrypted: false };
        });
        renderRestore();
        await flushEffects();

        await chooseFile(new File([ "database bytes" ], "backup.db"));

        expect(uploadMock.uploadInChunks).toHaveBeenCalledWith(expect.objectContaining({
            endpoint: "setup/restore/upload",
            fileName: "backup.db"
        }));
        expect(serverMock.post).toHaveBeenCalledWith("setup/restore/start", {
            source: "pending",
            filePath: undefined,
            passphrase: undefined
        });
    });

    it("shows how much has gone and how fast, once there is a rate to report", async () => {
        let report: (progress: unknown) => void = () => {};
        uploadMock.uploadInChunks.mockImplementation(async ({ onProgress }: { onProgress: (p: unknown) => void }) => {
            report = onProgress;
            report({ sentBytes: 0, totalBytes: 4 * 1024 * 1024, fraction: 0, bytesPerSecond: 0 });

            return new Promise(() => {});
        });
        renderRestore();
        await flushEffects();

        await chooseFile(new File([ "database bytes" ], "backup.db"));

        // Nothing has gone out yet, so there is no rate to divide into anything.
        expect(container.querySelector(".restore-upload-speed")).toBeFalsy();

        report({ sentBytes: 1024 * 1024, totalBytes: 4 * 1024 * 1024, fraction: 0.25, bytesPerSecond: 512 * 1024 });
        await flushEffects();

        expect(container.querySelector(".restore-progress-detail")?.textContent)
            .toContain("setup.restore-uploaded-so-far 1 MiB 4 MiB");
        // Its own element, since it is pushed to the far side of the line rather than read on from
        // what came before it.
        expect(container.querySelector(".restore-upload-speed")?.textContent?.trim())
            .toBe("setup.restore-upload-speed 512 KiB");
    });

    it("asks for the password when what arrived turns out to be encrypted", async () => {
        uploadMock.uploadInChunks.mockResolvedValue({ fileName: "backup.tnbackup", encrypted: true });
        renderRestore();
        await flushEffects();

        await chooseFile(new File([ "container bytes" ], "backup.tnbackup"));

        expect(serverMock.post).not.toHaveBeenCalled();
        expect(container.querySelector("input[type=password]")).toBeTruthy();
    });

    it("says it is waiting on the connection, in place of a rate that has stopped meaning anything", async () => {
        let report: (progress: unknown) => void = () => {};
        uploadMock.uploadInChunks.mockImplementation(async ({ onProgress }: { onProgress: (p: unknown) => void }) => {
            report = onProgress;
            report({ sentBytes: 1024, totalBytes: 4096, fraction: 0.25, bytesPerSecond: 512, reconnecting: false });

            return new Promise(() => {});
        });
        renderRestore();
        await flushEffects();
        await chooseFile(new File([ "database bytes" ], "backup.db"));

        report({ sentBytes: 1024, totalBytes: 4096, fraction: 0.25, bytesPerSecond: 512, reconnecting: true });
        await flushEffects();

        expect(container.querySelector(".restore-upload-reconnecting")?.textContent)
            .toContain("setup.restore-upload-reconnecting");
        expect(container.querySelector(".restore-upload-speed")).toBeFalsy();
        // Still on the upload rather than thrown back to the picker: waiting is not failing.
        expect(container.querySelector("progress")).toBeTruthy();

        report({ sentBytes: 2048, totalBytes: 4096, fraction: 0.5, bytesPerSecond: 512, reconnecting: false });
        await flushEffects();

        expect(container.querySelector(".restore-upload-reconnecting")).toBeFalsy();
    });

    it("goes back to the picker with the reason when the upload fails", async () => {
        uploadMock.uploadInChunks.mockRejectedValue(new Error("the disk is full"));
        renderRestore();
        await flushEffects();

        await chooseFile(new File([ "database bytes" ], "backup.db"));

        expect(container.querySelector(".restore-error-headline")?.textContent).toBe("setup.restore-error-upload-failed");
        expect(container.querySelector(".restore-error-detail")?.textContent).toBe("the disk is full");
        expect(container.querySelector(".restore-file-input")).toBeTruthy();
    });

    it("says an upload the server no longer holds has to be started again, not retried", async () => {
        uploadMock.uploadInChunks.mockRejectedValue(
            new uploadMock.ChunkedUploadError("The server restarted, so the upload it was holding is gone.", 410)
        );
        renderRestore();
        await flushEffects();

        await chooseFile(new File([ "database bytes" ], "backup.db"));

        expect(container.querySelector(".restore-error-headline")?.textContent).toBe("setup.restore-error-upload-interrupted");
        expect(container.querySelector(".restore-error-detail")?.textContent)
            .toBe("The server restarted, so the upload it was holding is gone.");
    });
});

describe("choosing a backup on the desktop", () => {
    const pickBackup = vi.fn();

    beforeEach(() => {
        window.electronApi = { restore: { pickBackup } } as unknown as typeof window.electronApi;
    });

    afterEach(() => {
        window.electronApi = undefined;
    });

    it("uses the native picker instead of a file input, and restores what it puts forward", async () => {
        pickBackup.mockResolvedValue({ status: "selected", fileName: "backup-daily.db", encrypted: false });
        renderRestore();
        await flushEffects();

        // Nothing to upload: the file never leaves the disk it is already on.
        expect(container.querySelector(".restore-file-input")).toBeFalsy();
        container.querySelector<HTMLElement>(".restore-choose-file")?.click();
        await flushEffects();

        expect(uploadMock.uploadInChunks).not.toHaveBeenCalled();
        expect(serverMock.post).toHaveBeenCalledWith("setup/restore/start", {
            source: "pending",
            filePath: undefined,
            passphrase: undefined
        });
    });

    it("asks for the password when the picked backup turns out to be encrypted", async () => {
        pickBackup.mockResolvedValue({ status: "selected", fileName: "backup.tnbackup", encrypted: true });
        renderRestore();
        await flushEffects();

        container.querySelector<HTMLElement>(".restore-choose-file")?.click();
        await flushEffects();

        expect(serverMock.post).not.toHaveBeenCalled();
        expect(container.querySelector("input[type=password]")).toBeTruthy();
    });

    it("stays where it is when the dialog is dismissed", async () => {
        pickBackup.mockResolvedValue({ status: "cancelled" });
        renderRestore();
        await flushEffects();

        container.querySelector<HTMLElement>(".restore-choose-file")?.click();
        await flushEffects();

        expect(serverMock.post).not.toHaveBeenCalled();
        expect(container.querySelector(".restore-error-headline")).toBeFalsy();
    });

    it("reports a refusal from the other side of the bridge", async () => {
        pickBackup.mockResolvedValue({ status: "error", message: "setup is already busy with 'new-document'" });
        renderRestore();
        await flushEffects();

        container.querySelector<HTMLElement>(".restore-choose-file")?.click();
        await flushEffects();

        expect(container.querySelector(".restore-error-detail")?.textContent).toBe("setup is already busy with 'new-document'");
    });
});

describe("following the restore", () => {
    async function startRestore() {
        renderRestore({ onRestored });
        await flushEffects();
        backupRow("backup-daily.db")?.click();
        await flushEffects();
    }

    let onRestored: () => void;

    beforeEach(() => { onRestored = vi.fn(); });

    it("shows the step it is on, and only that one", async () => {
        await startRestore();

        restore = { stage: "validating" };
        await nextPoll();

        expect(container.querySelector(".restore-step-name")?.textContent).toBe("setup.restore-stage-validating");
        // The steps it is not on say nothing: they go by too quickly to be read, and listing them
        // mostly shows the user things they will never see happen.
        expect(container.textContent).not.toContain("setup.restore-stage-swapping");
    });

    it("shows how far the running step has got", async () => {
        await startRestore();

        restore = { stage: "staging", fraction: 0.42 };
        await nextPoll();

        const bar = container.querySelector<HTMLProgressElement>(".restore-current-step progress");
        expect(bar?.value).toBe(0.42);
        expect(container.querySelector(".restore-stage-progress")?.textContent).toContain("42%");
    });

    it("drops the bar for a step that cannot say how far it has got", async () => {
        await startRestore();

        restore = { stage: "staging", fraction: 0.9 };
        await nextPoll();
        expect(container.querySelector(".restore-current-step progress")).toBeTruthy();

        // Checking a database reads it from end to end with nothing to report along the way; the
        // previous step's bar must not be left sitting under it.
        restore = { stage: "validating" };
        await nextPoll();

        expect(container.querySelector(".restore-current-step progress")).toBeFalsy();
    });

    it("finishes setup once the restore is done", async () => {
        await startRestore();

        restore = { stage: "done" };
        await nextPoll();

        expect(onRestored).toHaveBeenCalled();
    });

    it("survives the moment the database is detached and no request can be answered", async () => {
        await startRestore();

        serverMock.get.mockRejectedValueOnce(new Error("DB not open."));
        await nextPoll();

        expect(container.querySelector(".restore-current-step")).toBeTruthy();

        restore = { stage: "done" };
        await nextPoll();
        expect(onRestored).toHaveBeenCalled();
    });

    it("goes back to the password when that is what was wrong, rather than to the start", async () => {
        await startRestore();

        restore = { stage: "failed", reason: "wrong-passphrase-or-damaged-header", error: "Verifier tag did not match." };
        await nextPoll();

        expect(container.querySelector("input[type=password]")).toBeTruthy();
        expect(container.textContent).toContain("setup.restore-wrong-passphrase");
    });

    it("reports a failure nothing can be done about, back at the picker", async () => {
        await startRestore();

        restore = { stage: "failed", reason: "database-too-new", error: "The database is version 999." };
        await nextPoll();

        expect(container.textContent).toContain("The database is version 999.");
        expect(container.querySelector(".restore-file-input")).toBeTruthy();
    });

    it("leads with what went wrong in the user's terms, keeping the technical detail underneath", async () => {
        await startRestore();

        restore = { stage: "failed", reason: "not-a-database", error: "The file is not a SQLite database." };
        await nextPoll();

        // The reason chooses the sentence; the server's own words are kept, but not as the whole
        // message, since "not a SQLite database" answers a question the user never asked.
        expect(container.querySelector(".restore-error-headline")?.textContent).toBe("setup.restore-error-unusable");
        expect(container.querySelector(".restore-error-detail")?.textContent).toBe("The file is not a SQLite database.");
    });

    it("says something of its own for the failures where the backup is not what is at fault", async () => {
        await startRestore();
        const headline = () => container.querySelector(".restore-error-headline")?.textContent;

        restore = { stage: "failed", reason: "swap-failed", error: "EPERM" };
        await nextPoll();
        expect(headline()).toBe("setup.restore-error-swap-failed");

        await startRestore();
        restore = { stage: "failed", reason: "database-too-old", error: "version 200" };
        await nextPoll();
        expect(headline()).toBe("setup.restore-error-too-old");
    });
});

describe("what the restore calls the stage it is at", () => {
    // Every stage either restore reports: the server's, and the browser-only one which is alone in
    // reporting the two that end it.
    const stages = [ "staging", "validating", "swapping", "migrating", "done", "failed" ];

    it("has a sentence for every stage a restore can report", () => {
        // t() is mocked to hand back the key, so what a label comes back as is the key it looked
        // up: it has to be one the catalogue actually defines, or the user is shown the key itself.
        for (const stage of stages) {
            const label = stageLabel(stage);
            if (!label) {
                continue;
            }

            const [ namespace, key ] = label.split(".");
            expect(namespace).toBe("setup");
            expect(en.setup).toHaveProperty(key);
        }
    });

    it("says what happens next once it is done, rather than naming a finished step", () => {
        // The frame between the last step and the reload, and the one the user watches hardest.
        expect(stageLabel("done")).toBe("setup.redirecting");
        // Nothing is said about a failure here: the screen replacing this one says it properly.
        expect(stageLabel("failed")).toBe("");
    });
});
