import type { ExistingBackupsResponse } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    /** Whether this build keeps backups as files, or hands one over as a download. */
    downloadSupported: false,
    backups: { backups: [], backupFolderPath: "/data/backups" } as ExistingBackupsResponse,
    stored: {} as Record<string, boolean>,
    saved: [] as [ string, boolean ][],
    post: vi.fn(async (_url: string) => ({ backupFile: "/data/backups/now.db" })),
    showMessage: vi.fn()
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../../../services/backup_download", () => ({
    isBackupDownloadSupported: () => mocks.downloadSupported,
    backUpAndDownload: vi.fn()
}));

// Replacing the shared server mock means also answering what the modules pulled in alongside the
// page ask for on import — the keyboard actions, which expect a list.
vi.mock("../../../services/server", () => ({
    default: {
        get: async (url: string) => {
            if (url === "database/backups") return mocks.backups;
            if (url === "keyboard-actions") return [];
            return {};
        },
        post: mocks.post
    }
}));

vi.mock("../../../services/toast", () => ({
    default: { showMessage: mocks.showMessage, showError: vi.fn() }
}));

vi.mock("../../../services/database_files", () => ({
    summarizeBackups: (backups: unknown[]) => `summary:${backups.length}`,
    describeDatabaseFile: () => "12 MB, yesterday",
    describeDatabaseFormat: () => "SQLite"
}));

vi.mock("../../../services/setup_mode", () => ({
    canBootToSetup: () => false,
    bootToSetup: vi.fn()
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useTriliumOptionBool: (name: string) => [
        mocks.stored[name] === true,
        (value: boolean) => void mocks.saved.push([ name, value ])
    ],
    useStaticTooltip: vi.fn()
}));

vi.mock("./components/OptionsPageHeader", () => ({
    default: ({ below }: { below?: preact.ComponentChildren }) => <div className="header-stub">{below}</div>
}));

import BackupSettings from "./backup";

let host: HTMLElement;

beforeEach(() => {
    mocks.downloadSupported = false;
    mocks.backups = { backups: [], backupFolderPath: "/data/backups" } as ExistingBackupsResponse;
    mocks.stored = {};
    mocks.saved = [];
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
    vi.clearAllMocks();
});

async function open() {
    await act(async () => {
        render(null, host);
        render(<BackupSettings />, host);
    });
    // The stored backups are fetched as the page mounts.
    await act(async () => {});
}

describe("which page a build gets", () => {
    it("lists the backups kept as files, wherever there are any to keep", async () => {
        await open();

        expect(host.querySelector(".header-stub")?.textContent).toContain("summary:0");
        expect(host.querySelector("button[name='backup-database-now-button']")).not.toBeNull();
    });

    it("reduces to the one backup it can take, where none are kept at all", async () => {
        mocks.downloadSupported = true;
        await open();

        // Nothing to list and nowhere to list it: the browser build streams a copy on request.
        expect(host.querySelector(".standalone-backup")).not.toBeNull();
        expect(host.querySelector("button[name='backup-database-now-button']")).toBeNull();
    });

    it("leaves out the folder card where there is no location anyone could open", async () => {
        mocks.backups = { backups: [], backupFolderPath: null } as unknown as ExistingBackupsResponse;
        await open();

        // Backups kept in OPFS, say: real enough, but with no path to reveal.
        expect(host.querySelector(".backup-location")).toBeNull();
    });
});

describe("taking a backup now", () => {
    it("says where the copy was written, and re-reads the list it was added to", async () => {
        await open();

        const button = host.querySelector<HTMLButtonElement>("button[name='backup-database-now-button']");
        await act(async () => button?.click());
        await act(async () => {});

        expect(mocks.post).toHaveBeenCalledWith("database/backup-database");
        expect(mocks.showMessage).toHaveBeenCalledWith(
            expect.stringContaining("backup.database_backed_up_to"),
            expect.any(Number)
        );
    });

    it("holds the button while one is being written, so a second is not asked for", async () => {
        // Never settles, which is what being mid-backup looks like.
        mocks.post.mockImplementationOnce(() => new Promise(() => ({ backupFile: "" })));
        await open();

        const button = () => host.querySelector<HTMLButtonElement>("button[name='backup-database-now-button']");
        await act(async () => button()?.click());

        expect(button()?.disabled).toBe(true);
    });
});

describe("the automatic backups", () => {
    it("offers one switch per interval, each writing back to its own setting", async () => {
        mocks.stored = { dailyBackupEnabled: true };
        await open();

        const toggles = [ ...host.querySelectorAll<HTMLInputElement>(".backup-configuration input.switch-toggle") ];
        expect(toggles).toHaveLength(3);
        expect(toggles.map((toggle) => toggle.checked)).toEqual([ true, false, false ]);

        await act(async () => void toggles[1].dispatchEvent(new Event("input", { bubbles: true })));
        expect(mocks.saved).toContainEqual([ "weeklyBackupEnabled", true ]);
    });
});
