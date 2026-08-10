import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// t() returns the key so assertions are deterministic and not tied to English text.
vi.mock("./services/i18n", () => ({ t: (key: string) => key }));

const serverMock = vi.hoisted(() => ({
    get: vi.fn(async (url: string): Promise<unknown> =>
        (url === "setup/existing/status"
            ? { state: "idle", fraction: null }
            : url === "setup/existing/backup-defaults"
                ? { storedPassphrase: false, encrypt: false, compress: false }
                : url === "keyboard-actions" ? [] : {})),
    post: vi.fn(async (_url: string, _body?: unknown): Promise<unknown> => ({}))
}));
vi.mock("./services/server", () => ({ default: serverMock }));

const openMock = vi.hoisted(() => ({
    download: vi.fn(),
    getUrlForDownload: vi.fn((url: string) => `/${url}`)
}));
vi.mock("./services/open", () => ({ default: openMock }));

const electronMock = vi.hoisted(() => ({ isElectron: vi.fn(() => false), openPath: vi.fn() }));
vi.mock("./services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./services/utils")>()),
    isElectron: () => electronMock.isElectron()
}));

import ExistingData from "./setup_existing";

const BACKUP = {
    fileName: "Backup 2026-08-07 10-32-21.tnbackup",
    filePath: "/mnt/usb/trilium/Backup 2026-08-07 10-32-21.tnbackup",
    directoryPath: "/mnt/usb/trilium",
    fileSize: 209715200
};

let container: HTMLDivElement;
const onProceed = vi.fn();
const onKept = vi.fn();

function renderScreens() {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(<ExistingData onProceed={onProceed} onKept={onKept} />, container);

    return container;
}

/** Preact flushes effects and state through the microtask queue plus a frame. */
const settle = () => vi.advanceTimersByTimeAsync(50);

function choose(value: string) {
    const radio = container.querySelector<HTMLInputElement>(`input[type=radio][value='${value}']`);
    radio?.click();
    radio?.dispatchEvent(new Event("change", { bubbles: true }));
}

function button(label: string): HTMLButtonElement | undefined {
    return [ ...container.querySelectorAll("button") ]
        .find((element) => element.textContent?.includes(label));
}

/**
 * The button on the page that arrived, not the one that left: happy-dom never fires the animation
 * events that let SlidePages drop the leaving page, so after one transition both pages are in the
 * DOM and the arriving one renders second.
 */
function arrivingButton(label: string): HTMLButtonElement | undefined {
    return [ ...container.querySelectorAll("button") ]
        .filter((element) => element.textContent?.includes(label))
        .at(-1);
}

/** Chooses the backup and answers the parameters screen with everything as it was prefilled. */
async function askForBackup() {
    renderScreens();
    await settle();

    choose("back-up");
    await settle();
    button("setup.continue")?.click();
    await settle();

    arrivingButton("setup.continue")?.click();
    await settle();
}

/**
 * The last question before the erase, answered here so the tests get past it. happy-dom has no
 * `confirm` of its own, so it is stubbed rather than spied on.
 */
const confirmErase = vi.fn(() => true);

beforeEach(() => {
    vi.useFakeTimers();
    onProceed.mockReset();
    onKept.mockReset();
    serverMock.post.mockReset().mockResolvedValue(undefined);
    serverMock.get.mockClear();
    openMock.download.mockClear();
    electronMock.isElectron.mockReset().mockReturnValue(false);
    electronMock.openPath.mockClear();
    confirmErase.mockReset().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmErase);
    window.electronApi = undefined;
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("choosing what happens to the existing knowledge base", () => {
    it("will not continue until one of the two has been chosen", async () => {
        renderScreens();
        await settle();

        expect(button("setup.continue")?.disabled).toBe(true);

        choose("back-up");
        await settle();
        expect(button("setup.continue")?.disabled).toBe(false);
    });

    it("gives each answer a segment of its own, and keeps them exclusive", async () => {
        renderScreens();
        await settle();

        expect(container.querySelectorAll(".existing-data-choices .tn-card-section")).toHaveLength(2);

        choose("back-up");
        await settle();
        choose("delete");
        await settle();

        const checked = [ ...container.querySelectorAll<HTMLInputElement>("input[type=radio]") ]
            .filter((radio) => radio.checked)
            .map((radio) => radio.value);
        // Two groups as far as the browser is concerned, one answer as far as the screen is.
        expect(checked).toEqual([ "delete" ]);
    });

    it("warns about erasure only once erasure is what was chosen", async () => {
        renderScreens();
        await settle();

        expect(container.querySelector(".existing-data-warning")).toBeNull();

        choose("delete");
        await settle();
        expect(container.querySelector(".existing-data-warning")?.textContent)
            .toContain("setup.existing-data-delete-warning");

        // Changing one's mind takes the warning away with it.
        choose("back-up");
        await settle();
        expect(container.querySelector(".existing-data-warning")).toBeNull();
    });

    it("erases and moves on when that is the answer", async () => {
        renderScreens();
        await settle();

        choose("delete");
        await settle();
        button("setup.continue")?.click();
        await settle();

        expect(serverMock.post).toHaveBeenCalledWith("setup/existing/delete");
        expect(onProceed).toHaveBeenCalled();
        // Nothing was backed up, since nothing was asked to be.
        expect(serverMock.post).not.toHaveBeenCalledWith("setup/existing/backup", expect.anything());
    });

    it("leaves everything alone and reopens the database on cancel", async () => {
        renderScreens();
        await settle();

        button("setup.existing-data-cancel")?.click();
        await settle();

        expect(serverMock.post).toHaveBeenCalledWith("setup/existing/keep");
        expect(onKept).toHaveBeenCalled();
    });
});

describe("backing it up first", () => {
    /** Answers the status polls with `status`, leaving every other GET as the default mock has it. */
    function statusAnswers(status: unknown) {
        serverMock.get.mockImplementation(async (url: string) =>
            (url === "setup/existing/status"
                ? status
                : url === "setup/existing/backup-defaults"
                    ? { storedPassphrase: false, encrypt: false, compress: false }
                    : url === "keyboard-actions" ? [] : {}));
    }

    /** Chooses the backup, answers its parameters, sets it going, and rides out one poll interval. */
    async function backUpAndWait() {
        await askForBackup();
        // The answer arrives over a poll, one interval after the backup was set going.
        await vi.advanceTimersByTimeAsync(1100);
        await settle();
    }

    it("asks what the backup should be before taking it, and sends those answers", async () => {
        serverMock.get.mockImplementation(async (url: string) =>
            (url === "setup/existing/backup-defaults"
                ? { storedPassphrase: true, encrypt: true, compress: true }
                : url === "setup/existing/status"
                    ? { state: "done", fraction: 1, result: BACKUP }
                    : url === "keyboard-actions" ? [] : {}));
        renderScreens();
        await settle();

        choose("back-up");
        await settle();
        button("setup.continue")?.click();
        await settle();

        // The questions this platform can ask, which the standalone one cannot: it writes the file
        // itself, so the format is a choice, and it has a passphrase of its own to offer.
        expect(container.textContent).toContain("setup.backup-name");
        expect(container.textContent).toContain("setup.backup-compress");
        expect(container.textContent).toContain("setup.backup-use-stored-password");
        expect(serverMock.post).not.toHaveBeenCalledWith("setup/existing/backup", expect.anything());

        arrivingButton("setup.continue")?.click();
        await vi.advanceTimersByTimeAsync(1100);
        await settle();

        // What the instance is already set up for, offered back and accepted unchanged.
        expect(serverMock.post).toHaveBeenCalledWith("setup/existing/backup", {
            name: expect.stringMatching(/^Trilium data \(/),
            passphrase: "",
            useStoredPassphrase: true,
            compress: true
        });
    });

    it("says what was written, and erases nothing until that is confirmed", async () => {
        statusAnswers({ state: "done", fraction: 1, result: BACKUP });
        await backUpAndWait();

        expect(serverMock.post)
            .toHaveBeenCalledWith("setup/existing/backup", expect.objectContaining({ compress: false }));
        // The path in full: the option holding a custom backup directory is in the database that is
        // about to go, so this may be the last chance to read it.
        expect(container.textContent).toContain(BACKUP.fileName);
        // The folder, not the whole path: the file name is on the line above it.
        expect(container.textContent).toContain(BACKUP.directoryPath);
        expect(container.textContent).not.toContain(BACKUP.filePath);
        expect(container.textContent).toContain("200 MiB");
        expect(serverMock.post).not.toHaveBeenCalledWith("setup/existing/delete");

        button("setup.continue")?.click();
        await settle();
        expect(confirmErase).toHaveBeenCalledWith("setup.existing-data-erase-confirm");
        expect(serverMock.post).toHaveBeenCalledWith("setup/existing/delete");
        expect(onProceed).toHaveBeenCalled();
    });

    it("erases nothing when the last question is answered no", async () => {
        confirmErase.mockReturnValue(false);
        statusAnswers({ state: "done", fraction: 1, result: BACKUP });
        await backUpAndWait();

        button("setup.continue")?.click();
        await settle();

        expect(confirmErase).toHaveBeenCalled();
        expect(serverMock.post).not.toHaveBeenCalledWith("setup/existing/delete");
        expect(onProceed).not.toHaveBeenCalled();
        // Still on the screen it was answered from, so the backup can be taken again or kept.
        expect(container.textContent).toContain(BACKUP.fileName);
    });

    it("shows how far along the write is, once the writer has said anything", async () => {
        // The write runs for minutes, so this screen would otherwise show a spinner and nothing
        // else for the whole of it.
        statusAnswers({ state: "running", fraction: null });
        await askForBackup();

        // Nothing to show yet, so the spinner stands in for the bar.
        expect(container.querySelector(".spinner-border")).not.toBeNull();

        statusAnswers({ state: "running", fraction: 0.42 });
        await vi.advanceTimersByTimeAsync(1000);
        expect(container.querySelector("progress")?.value).toBeCloseTo(0.42);
        expect(container.textContent).toContain("42%");
        // ...and steps aside once there is one, rather than the two competing.
        expect(container.querySelector(".spinner-border")).toBeNull();
    });

    it("saves a copy wherever the user says, and opens the folder on the desktop", async () => {
        electronMock.isElectron.mockReturnValue(true);
        window.electronApi = { shell: { openPath: electronMock.openPath } } as never;
        statusAnswers({ state: "done", fraction: 1, result: BACKUP });
        await backUpAndWait();

        container.querySelector<HTMLAnchorElement>(".existing-data-path-link")?.click();
        expect(electronMock.openPath).toHaveBeenCalledWith(BACKUP.directoryPath);

        button("setup.existing-data-save-as")?.click();
        expect(openMock.download).toHaveBeenCalledWith(
            expect.stringContaining(encodeURIComponent(BACKUP.filePath)));
    });

    it("goes back to the question when the backup cannot even start", async () => {
        // Rejected the way the client's request layer rejects: the response body, not an Error.
        serverMock.post.mockImplementation(async (url: string) => {
            if (url === "setup/existing/backup") {
                throw '{"message":"the disk is full"}';
            }
            return undefined;
        });
        await askForBackup();

        expect(container.querySelector(".page-error")?.textContent).toContain("the disk is full");
        expect(container.querySelector("input[type=radio]")).not.toBeNull();
        expect(onProceed).not.toHaveBeenCalled();
    });

    it("goes back to the question when the backup fails along the way", async () => {
        statusAnswers({ state: "failed", fraction: null, error: "the disk is full" });
        await backUpAndWait();

        expect(container.querySelector(".page-error")?.textContent).toContain("the disk is full");
        expect(container.querySelector("input[type=radio]")).not.toBeNull();
        expect(onProceed).not.toHaveBeenCalled();
    });

    it("keeps waiting through polls that fail, and takes the answer from the one that succeeds", async () => {
        // The standalone worker answers nothing while it is deep inside the write itself; a poll
        // that dies must read as "still going", not as the backup having failed.
        let polls = 0;
        serverMock.get.mockImplementation(async (url: string) => {
            if (url === "setup/existing/status") {
                polls++;
                if (polls < 3) {
                    throw "rejected by browser";
                }
                return { state: "done", fraction: 1, result: BACKUP };
            }
            if (url === "setup/existing/backup-defaults") {
                return { storedPassphrase: false, encrypt: false, compress: false };
            }
            return url === "keyboard-actions" ? [] : {};
        });
        await askForBackup();
        await vi.advanceTimersByTimeAsync(3500);
        await settle();

        expect(container.textContent).toContain(BACKUP.fileName);
        expect(onProceed).not.toHaveBeenCalled();
    });
});

describe("backing up straight to a download on standalone", () => {
    const downloadDatabase = vi.fn();

    beforeEach(() => {
        downloadDatabase.mockClear();
        window.standaloneApi = {
            backup: { downloadDatabase }
        } as unknown as typeof window.standaloneApi;
    });

    afterEach(() => {
        window.standaloneApi = undefined;
    });

    /**
     * Chooses the backup, accepts the suggested name and no password, and arrives at the download
     * screen with nothing started yet.
     */
    const reachDownloadScreen = askForBackup;

    it("asks nothing this platform cannot answer, and never asks the backend to write one", async () => {
        renderScreens();
        await settle();

        choose("back-up");
        await settle();
        button("setup.continue")?.click();
        await settle();

        // No format to choose and no passphrase kept anywhere, so neither question is put.
        expect(container.textContent).toContain("setup.backup-name");
        expect(container.textContent).not.toContain("setup.backup-compress");
        expect(container.textContent).not.toContain("setup.backup-use-stored-password");
        expect(serverMock.get).not.toHaveBeenCalledWith("setup/existing/backup-defaults");
    });

    it("shows the download step without starting anything, and gates Continue on it", async () => {
        let finish: (result: unknown) => void = () => {};
        downloadDatabase.mockImplementation(() => new Promise((resolve) => {
            finish = resolve;
        }));
        await reachDownloadScreen();

        // Arrived, but nothing downloads until the user says so, and Continue is not on offer.
        expect(container.textContent).toContain("setup.backup-data");
        expect(downloadDatabase).not.toHaveBeenCalled();
        expect(arrivingButton("setup.continue")?.disabled).toBe(true);
        expect(serverMock.post).not.toHaveBeenCalledWith("setup/existing/backup", expect.anything());

        arrivingButton("setup.backup-download")?.click();
        await settle();
        // The suggested name, and no password, which is what the parameters screen was left at.
        expect(downloadDatabase).toHaveBeenCalledWith(
            expect.stringMatching(/^Trilium data \(\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\)\.tnbackup$/),
            undefined);
        expect(container.textContent).toContain("setup.backup-downloading");
        expect(arrivingButton("setup.continue")?.disabled).toBe(true);

        finish({ status: "done" });
        await settle();
        expect(container.textContent).toContain("setup.backup-downloaded");
        expect(arrivingButton("setup.continue")?.disabled).toBe(false);

        arrivingButton("setup.continue")?.click();
        await settle();
        // Asked once more before the data goes, since this screen is about the copy rather than
        // about what continuing costs.
        expect(confirmErase).toHaveBeenCalledWith("setup.existing-data-erase-confirm");
        expect(serverMock.post).toHaveBeenCalledWith("setup/existing/delete");
        expect(onProceed).toHaveBeenCalled();
    });

    it("keeps the data when that last question is answered no", async () => {
        confirmErase.mockReturnValue(false);
        downloadDatabase.mockResolvedValue({ status: "done" });
        await reachDownloadScreen();

        arrivingButton("setup.backup-download")?.click();
        await settle();
        arrivingButton("setup.continue")?.click();
        await settle();

        expect(serverMock.post).not.toHaveBeenCalledWith("setup/existing/delete");
        expect(onProceed).not.toHaveBeenCalled();
    });

    it("shows what stopped a failed download, and keeps Continue out of reach", async () => {
        downloadDatabase.mockResolvedValue({ status: "failed", message: "the stream broke" });
        await reachDownloadScreen();

        arrivingButton("setup.backup-download")?.click();
        await settle();

        expect(container.textContent).toContain("the stream broke");
        expect(arrivingButton("setup.continue")?.disabled).toBe(true);
        // The button is back, because trying again is the way out.
        expect(arrivingButton("setup.backup-download")?.disabled).toBe(false);
        expect(serverMock.post).not.toHaveBeenCalledWith("setup/existing/delete");
    });

    it("cancel leaves everything alone and reopens the database", async () => {
        await reachDownloadScreen();

        arrivingButton("setup.existing-data-cancel")?.click();
        await settle();

        expect(serverMock.post).toHaveBeenCalledWith("setup/existing/keep");
        expect(serverMock.post).not.toHaveBeenCalledWith("setup/existing/delete");
        expect(onKept).toHaveBeenCalled();
    });
});
