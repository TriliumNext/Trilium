import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// t() returns the key so assertions are deterministic and not tied to English text; a counted
// string carries its count, which is the part of those the page decides.
vi.mock("../../../services/i18n", () => ({
    t: (key: string, params?: { count?: number }) => params?.count === undefined ? key : `${key}=${params.count}`
}));

// The real i18n is not initialized under test, so `Trans` would render the bare key and drop what
// it wires in; the stub renders the components themselves, which is what the page is answering for.
vi.mock("react-i18next", () => ({
    Trans: ({ i18nKey, components }: { i18nKey: string, components: Record<string, preact.VNode> }) => (
        <span data-i18n-key={i18nKey}>{Object.values(components)}</span>
    )
}));

const setupMode = vi.hoisted(() => ({
    canBootToSetup: vi.fn(() => true),
    startOver: vi.fn(async () => "restarting" as string),
    isStartOverPending: vi.fn(async () => false),
    cancelStartOver: vi.fn(async () => {})
}));
vi.mock("../../../services/setup_mode", () => setupMode);

const DATABASE_INFO = {
    filePath: "/data/trilium/document.db" as string | null,
    utcDateCreated: "2020-05-17 08:30:00.000Z",
    noteCount: 12,
    attachmentCount: 3,
    sizeBytes: 3 * 1024 * 1024
};

/** What the info endpoint answers; replaced by the test about a database that is not a file. */
let INFO: typeof DATABASE_INFO = DATABASE_INFO;

/** Set where a test needs the info card to have nothing to say. */
const failing = vi.hoisted(() => ({ info: false }));

/** The browser build, which keeps no backups, has no path to its database and cannot compact it. */
const standalone = vi.hoisted(() => ({ enabled: false }));
vi.mock("../../../services/backup_download", () => ({
    isBackupDownloadSupported: () => standalone.enabled
}));
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    // A getter, since the real one is read from `window.glob` when the module loads.
    get isStandalone() { return standalone.enabled; }
}));

/** What the backup page would list; emptied by the test about a database never backed up. */
let BACKUPS: { mtime: Date }[] = [];

const ANONYMIZED_COPY = {
    fileName: "anonymized-light-2026-01-02.db",
    filePath: "/data/anonymized/anonymized-light-2026-01-02.db",
    mtime: new Date("2026-01-02T10:00:00Z"),
    fileSize: 4096
};

/** What the anonymized-databases endpoint would list; emptied by the test about having made none. */
let ANONYMIZED: (typeof ANONYMIZED_COPY)[] = [];

// The info, maintenance and anonymization cards call the backend as they render and as they are used.
const server = vi.hoisted(() => ({
    get: vi.fn(async (url: string) => {
        switch (url) {
            case "database/info":
                if (failing.info) {
                    throw new Error("no answer");
                }
                return INFO;
            case "database/backups":
                return { backupFolderPath: "/data/backup", backups: BACKUPS };
            case "database/check-integrity":
                return { results: [{ integrity_check: "ok" }] };
            case "database/anonymized-databases":
                return { databases: ANONYMIZED, anonymizedFolderPath: "/data/anonymized" };
            // Whatever the page's own imports ask for while they load, e.g. keyboard actions.
            default:
                return [];
        }
    }),
    post: vi.fn(async () => ({ success: true, anonymizedFilePath: "/data/anonymized/copy.db" })),
    postWithTimeout: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({}))
}));
vi.mock("../../../services/server", () => ({ default: server }));

/** Deleting is asked about first; the answer is the test's to give. */
const dialog = vi.hoisted(() => ({ confirm: vi.fn(async () => true), closeActiveDialog: vi.fn() }));
vi.mock("../../../services/dialog", () => ({ default: dialog, closeActiveDialog: dialog.closeActiveDialog }));

const appContext = vi.hoisted(() => ({ triggerCommand: vi.fn(async () => {}) }));
vi.mock("../../../components/app_context", () => ({ default: appContext }));

const toast = vi.hoisted(() => ({
    showMessage: vi.fn(),
    showError: vi.fn()
}));
vi.mock("../../../services/toast", () => ({ default: toast }));

// The page header renders the note's own title, which needs a note context this spec has no use for.
vi.mock("./components/OptionsPageHeader", () => ({ default: () => null }));

// Maintenance hands over to the Content Manager, which needs a note context to navigate with. Only
// that hook is replaced: the card rows still need the rest of the module, ID generation included.
// Opening the real dialog would measure the whole database and draw its charts; what this page
// answers for is that it opens one, and what it does with the answer.
const cleanup = vi.hoisted(() => ({ showCleanupDialog: vi.fn(async () => 1234 as number | null) }));
vi.mock("../space_usage/cleanup_dialog", () => cleanup);

import DatabaseSettings from "./database";

let container: HTMLDivElement;

/** Preact flushes effects and state through the microtask queue plus a frame. */
const settle = () => vi.advanceTimersByTimeAsync(50);

function renderPage() {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(<DatabaseSettings />, container);

    return container;
}

/** By name rather than by label: one label is a prefix of the other. */
function button(name: string): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>(`button[name='${name}']`);
}

beforeEach(() => {
    vi.useFakeTimers();
    setupMode.canBootToSetup.mockReset().mockReturnValue(true);
    setupMode.startOver.mockReset().mockResolvedValue("restarting");
    setupMode.isStartOverPending.mockReset().mockResolvedValue(false);
    setupMode.cancelStartOver.mockReset().mockResolvedValue(undefined);
    failing.info = false;
    INFO = DATABASE_INFO;
    standalone.enabled = false;
    BACKUPS = [ { mtime: new Date("2026-01-01T10:00:00Z") }, { mtime: new Date("2026-01-02T10:00:00Z") } ];
    ANONYMIZED = [ ANONYMIZED_COPY ];
    dialog.closeActiveDialog.mockClear();
    appContext.triggerCommand.mockClear();
    cleanup.showCleanupDialog.mockReset().mockResolvedValue(1234);
    server.get.mockClear();
    server.post.mockClear();
    server.postWithTimeout.mockClear();
    server.remove.mockClear();
    dialog.confirm.mockReset().mockResolvedValue(true);
    toast.showMessage.mockClear();
    toast.showError.mockClear();
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.useRealTimers();
});

describe("what the database is", () => {
    /** The facts of the info card, in the order the card states them. */
    function infoValues() {
        return [ ...container.querySelectorAll(".database-info .tn-card-option-value") ]
            .map((value) => value.textContent);
    }

    it("states where it lives, when it began, what it holds and how large it has grown", async () => {
        renderPage();
        await settle();

        expect(server.get).toHaveBeenCalledWith("database/info");

        const [ location, content, created, size ] = infoValues();
        // Named in full; the desktop reveals it in the file manager rather than opening it.
        expect(location).toBe(DATABASE_INFO.filePath);
        expect(created).toContain("2020");
        expect(content).toBe("database.info_notes=12, database.info_attachments=3");
        expect(size).toBe("3 MiB");
    });

    it("summarizes the backups as their own page does, and leads to it", async () => {
        renderPage();
        await settle();

        const backup = container.querySelector<HTMLAnchorElement>(".database-info a[href]");
        // The same sentence the backup page's header carries, counted over the same listing.
        expect(backup?.textContent).toBe("backup.backups_summary=2");
        expect(backup?.getAttribute("href")).toBe("#root/_hidden/_options/_optionsBackup");
    });

    it("names the storage where the database is no file, and drops what is not kept there", async () => {
        standalone.enabled = true;
        INFO = { ...DATABASE_INFO, filePath: null };
        renderPage();
        await settle();

        // Nothing a file manager could be pointed at, so the storage is named instead of linked.
        const [ location ] = infoValues();
        expect(location).toBe("database.info_location_opfs");
        expect(container.querySelector(".database-info a[href]")).toBeNull();

        // The rest of the card holds: the figures come from the database itself, wherever it lives.
        expect(infoValues()).toHaveLength(4);
        expect(server.get).not.toHaveBeenCalledWith("database/backups");

        // Compacting rebuilds through a temporary store this build keeps in memory, so it is not
        // offered; the checks beside it are, both being things the engine does on its own.
        expect(button("vacuum-database-button")).toBeNull();
        expect(button("check-integrity-button")).not.toBeNull();
        expect(button("fix-consistency-issues-button")).not.toBeNull();

        // An anonymized copy is a file written beside the database, of which there is neither here.
        expect(container.querySelector(".database-anonymization")).toBeNull();
        expect(container.querySelector(".database-file-list")).toBeNull();
        expect(server.get).not.toHaveBeenCalledWith("database/anonymized-databases");
    });

    it("says a database has never been backed up rather than leaving the row blank", async () => {
        BACKUPS = [];
        renderPage();
        await settle();

        const link = container.querySelector(".database-info a[href]");
        expect(link?.textContent).toBe("database.info_no_backup");
        // The row is the way to the backup page, and says on its own what is there: a preview of a
        // page of settings would tell the reader nothing.
        expect(link?.getAttribute("href")).toBe("#root/_hidden/_options/_optionsBackup");
        expect(link?.classList.contains("no-tooltip-preview")).toBe(true);
    });

    it("reads the figures again once the database has been compacted", async () => {
        renderPage();
        await settle();

        button("vacuum-database-button")?.click();
        await settle();

        // Compacting is the one action on the page that changes what the card states, and a size
        // left saying what it did before the rebuild would be plainly wrong.
        expect(server.get.mock.calls.filter(([ url ]) => url === "database/info")).toHaveLength(2);
    });

    it("says nothing at all where the figures cannot be had", async () => {
        failing.info = true;
        renderPage();
        await settle();

        // Only `DatabaseInfo` depends on the figures; the other cards render regardless. That
        // matters most for `SpaceOptions`: a database too large to measure quickly is exactly the
        // one that needs analyzing and cleaning up.
        expect(container.querySelector(".database-info")).toBeNull();
        expect(button("analyze-space-usage-button")).not.toBeNull();
        expect(button("cleanup-button")).not.toBeNull();
        expect(button("check-integrity-button")).not.toBeNull();
    });
});

describe("space usage and cleanup", () => {
    it("hands both tools over to Space Usage rather than repeating them", async () => {
        renderPage();
        await settle();

        button("analyze-space-usage-button")?.click();
        await settle();

        // Space Usage stands on its own, so it opens in a tab; Options can itself be a dialog, and
        // one left standing would cover the tab it just opened.
        expect(appContext.triggerCommand).toHaveBeenCalledWith("showSpaceUsage");
        expect(dialog.closeActiveDialog).toHaveBeenCalled();

        button("cleanup-button")?.click();
        await settle();

        expect(cleanup.showCleanupDialog).toHaveBeenCalled();
        // Erasing changes what the database holds, so the card above states it again.
        expect(server.get.mock.calls.filter(([ url ]) => url === "database/info")).toHaveLength(2);
    });

    it("leaves the figures alone when the cleanup was called off", async () => {
        cleanup.showCleanupDialog.mockResolvedValue(null);
        renderPage();
        await settle();

        button("cleanup-button")?.click();
        await settle();

        expect(server.get.mock.calls.filter(([ url ]) => url === "database/info")).toHaveLength(1);
    });
});

describe("database maintenance", () => {
    it("runs each check against its own endpoint, and says how it went", async () => {
        renderPage();
        await settle();

        button("check-integrity-button")?.click();
        button("fix-consistency-issues-button")?.click();
        button("vacuum-database-button")?.click();
        await settle();

        expect(server.get).toHaveBeenCalledWith("database/check-integrity");
        expect(server.post).toHaveBeenCalledWith("database/find-and-fix-consistency-issues");
        // With a timeout of its own: a rebuild outlives the default one on a large database.
        expect(server.postWithTimeout).toHaveBeenCalledWith("database/vacuum-database", expect.any(Number));
        expect(toast.showMessage).toHaveBeenCalledWith("database_integrity_check.integrity_check_succeeded");
    });
});

describe("anonymized copies", () => {
    it("reads the existing copies on arrival, and lists the new one it makes", async () => {
        renderPage();
        await settle();

        expect(server.get).toHaveBeenCalledWith("database/anonymized-databases");

        // Where the copies are kept is stated as a link into the sentence, so the folder can be
        // opened rather than read out and typed somewhere else.
        const location = container.querySelector(".database-file-list [data-i18n-key]");
        expect(location?.textContent).toBe("/data/anonymized");

        button("light-anonymization-button")?.click();
        await settle();

        expect(server.post).toHaveBeenCalledWith("database/anonymize/light");
        // The copy is a file beside the database, so the list is the only way back to it.
        expect(server.get.mock.calls.filter(([url]) => url === "database/anonymized-databases")).toHaveLength(2);
    });

    it("says nothing about where copies are kept while there are none", async () => {
        ANONYMIZED = [];
        renderPage();
        await settle();

        // A location is worth stating once something can be found there; the empty list says the
        // rest on its own.
        expect(container.querySelector(".database-file-list [data-i18n-key]")).toBeNull();
        expect(container.querySelector(".database-file-list")?.textContent)
            .toContain("database_anonymization.no_anonymized_database_yet");
    });

    it("throws a copy away once asked about, and lists what is left", async () => {
        renderPage();
        await settle();

        container.querySelector<HTMLButtonElement>(".database-file-list button.bx-trash")?.click();
        await settle();

        expect(dialog.confirm).toHaveBeenCalled();
        expect(server.remove).toHaveBeenCalledWith(
            `database/anonymized?filePath=${encodeURIComponent(ANONYMIZED_COPY.filePath)}`);
        expect(server.get.mock.calls.filter(([ url ]) => url === "database/anonymized-databases")).toHaveLength(2);
    });

    it("keeps the copy where the question was answered no", async () => {
        dialog.confirm.mockResolvedValue(false);
        renderPage();
        await settle();

        container.querySelector<HTMLButtonElement>(".database-file-list button.bx-trash")?.click();
        await settle();

        expect(server.remove).not.toHaveBeenCalled();
    });

    it("says so when the copy could not be made, and asks the list for nothing", async () => {
        server.post.mockResolvedValueOnce({ success: false, anonymizedFilePath: "" });
        renderPage();
        await settle();

        button("full-anonymization-button")?.click();
        await settle();

        expect(toast.showError).toHaveBeenCalledWith("database_anonymization.error_creating_anonymized_database");
        expect(server.get.mock.calls.filter(([url]) => url === "database/anonymized-databases")).toHaveLength(1);
    });
});

describe("starting over from Options", () => {
    it("offers the button, and asks nothing of its own before handing over", async () => {
        renderPage();
        await settle();

        // The confirmation is the operating system's or the browser's, not one of this page's.
        expect(container.querySelector(".start-over-pending")).toBeNull();

        button("start-over-button")?.click();
        await settle();

        expect(setupMode.startOver).toHaveBeenCalled();
    });

    it("does not ask a build that restarts itself whether anything is pending", async () => {
        // There is nothing to wait for: the request is acted on by the restart it causes.
        renderPage();
        await settle();

        expect(setupMode.isStartOverPending).not.toHaveBeenCalled();
    });

    it("says a request is standing where the restart is somebody else's to make", async () => {
        setupMode.canBootToSetup.mockReturnValue(false);
        setupMode.startOver.mockResolvedValue("pending");
        renderPage();
        await settle();

        button("start-over-button")?.click();
        await settle();

        // Above the card, since a request left standing is the state of the whole page from here on.
        const notice = container.querySelector(".start-over-pending");
        expect(notice?.textContent).toContain("database.start_over_pending");
        expect(notice?.compareDocumentPosition(container.querySelector(".start-over") as Node))
            .toBe(Node.DOCUMENT_POSITION_FOLLOWING);

        // The button that made it stays where it was, so the row still reads as a whole — but it is
        // out of reach, since the request it would make has already been made.
        expect(button("start-over-button")?.disabled).toBe(true);
    });

    it("takes it back, which is all a server owner can do until they restart", async () => {
        setupMode.canBootToSetup.mockReturnValue(false);
        setupMode.isStartOverPending.mockResolvedValue(true);
        renderPage();
        await settle();

        // Read on arrival: the request outlives the page that made it, so reopening Options is
        // otherwise no way to find out that one is waiting.
        expect(container.querySelector(".start-over-pending")).not.toBeNull();

        button("cancel-start-over-button")?.click();
        await settle();

        expect(setupMode.cancelStartOver).toHaveBeenCalled();
        expect(container.querySelector(".start-over-pending")).toBeNull();
    });

    it("says nothing where the pending question cannot be answered", async () => {
        setupMode.canBootToSetup.mockReturnValue(false);
        setupMode.isStartOverPending.mockRejectedValue(new Error("no answer"));
        renderPage();
        await settle();

        // What is lost is a notice; the button below it is what the page is for.
        expect(container.querySelector(".start-over-pending")).toBeNull();
        expect(button("start-over-button")?.disabled).toBe(false);
    });
});
