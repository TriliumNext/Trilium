import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// t() returns the key so assertions are deterministic and not tied to English text.
vi.mock("./services/i18n", () => ({ t: (key: string) => key }));

const serverMock = vi.hoisted(() => ({
    get: vi.fn(async (url: string): Promise<unknown> =>
        (url === "setup/existing/status"
            ? { state: "idle", fraction: null }
            : url === "keyboard-actions" ? [] : {})),
    post: vi.fn(async (_url: string): Promise<unknown> => ({}))
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
    fileSize: 209715200,
    encrypted: false
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

beforeEach(() => {
    vi.useFakeTimers();
    onProceed.mockReset();
    onKept.mockReset();
    serverMock.post.mockReset().mockResolvedValue(undefined);
    serverMock.get.mockClear();
    openMock.download.mockClear();
    electronMock.isElectron.mockReset().mockReturnValue(false);
    electronMock.openPath.mockClear();
    window.electronApi = undefined;
});

afterEach(() => {
    render(null, container);
    container.remove();
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
        expect(serverMock.post).not.toHaveBeenCalledWith("setup/existing/backup");
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
            (url === "setup/existing/status" ? status : url === "keyboard-actions" ? [] : {}));
    }

    /** Chooses the backup, sets it going, and rides out one poll interval. */
    async function backUpAndWait() {
        renderScreens();
        await settle();

        choose("back-up");
        await settle();
        button("setup.continue")?.click();
        // The answer arrives over a poll, one interval after the backup was set going.
        await vi.advanceTimersByTimeAsync(1100);
        await settle();
    }

    it("says what was written, and erases nothing until that is confirmed", async () => {
        statusAnswers({ state: "done", fraction: 1, result: BACKUP });
        await backUpAndWait();

        expect(serverMock.post).toHaveBeenCalledWith("setup/existing/backup");
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
        expect(serverMock.post).toHaveBeenCalledWith("setup/existing/delete");
        expect(onProceed).toHaveBeenCalled();
    });

    it("shows how far along the write is, once the writer has said anything", async () => {
        // The write runs for minutes, so this screen would otherwise show a spinner and nothing
        // else for the whole of it.
        statusAnswers({ state: "running", fraction: null });
        renderScreens();
        await settle();

        choose("back-up");
        await settle();
        button("setup.continue")?.click();
        await settle();

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

    it("says to keep the backup password where the backup needs one", async () => {
        statusAnswers({ state: "done", fraction: 1, result: { ...BACKUP, encrypted: true } });
        await backUpAndWait();

        expect(container.querySelector(".existing-data-warning")?.textContent)
            .toContain("setup.existing-data-encrypted-warning");
    });

    it("goes back to the question when the backup cannot even start", async () => {
        // Rejected the way the client's request layer rejects: the response body, not an Error.
        serverMock.post.mockImplementation(async (url: string) => {
            if (url === "setup/existing/backup") {
                throw '{"message":"the disk is full"}';
            }
            return undefined;
        });
        renderScreens();
        await settle();

        choose("back-up");
        await settle();
        button("setup.continue")?.click();
        await settle();

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
            return url === "keyboard-actions" ? [] : {};
        });
        renderScreens();
        await settle();

        choose("back-up");
        await settle();
        button("setup.continue")?.click();
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
     * The button on the page that arrived, not the one that left: happy-dom never fires the
     * animation events that let SlidePages drop the leaving page, so after one transition both
     * pages are in the DOM and the arriving one renders second.
     */
    function arrivingButton(label: string): HTMLButtonElement | undefined {
        return [ ...container.querySelectorAll("button") ]
            .filter((element) => element.textContent?.includes(label))
            .at(-1);
    }

    /**
     * Chooses the backup, accepts the suggested name and no password, and arrives at the download
     * screen with nothing started yet.
     */
    async function reachDownloadScreen() {
        renderScreens();
        await settle();

        choose("back-up");
        await settle();
        button("setup.continue")?.click();
        await settle();

        // The parameters screen, which the same Continue leaves as it was prefilled.
        arrivingButton("setup.continue")?.click();
        await settle();
    }

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
        expect(serverMock.post).not.toHaveBeenCalledWith("setup/existing/backup");

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
        expect(serverMock.post).toHaveBeenCalledWith("setup/existing/delete");
        expect(onProceed).toHaveBeenCalled();
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
