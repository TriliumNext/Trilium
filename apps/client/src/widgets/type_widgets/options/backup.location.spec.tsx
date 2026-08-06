import { render, VNode } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    setCustomDir: vi.fn(),
    confirm: vi.fn<() => Promise<boolean>>(),
    isElectron: vi.fn(() => true),
    customDir: ""
}));

// Partial-mock so sibling components (e.g. `useUniqueName` in OptionsRow) keep their real implementation.
vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useTriliumOption: () => [mocks.customDir, mocks.setCustomDir]
}));

vi.mock("../../../services/utils", async (importActual) => ({
    ...(await importActual<typeof import("../../../services/utils")>()),
    isElectron: () => mocks.isElectron()
}));

vi.mock("../../../services/dialog", () => ({ default: { confirm: mocks.confirm } }));

// i18next is never initialized in the client tests, so its `t` returns undefined; echo the key instead.
vi.mock("../../../services/i18n", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/i18n")>()),
    t: (key: string) => key
}));

// Import AFTER the mocks (vi.mock is hoisted, but the component import must resolve the mocked deps).
import { BackupList, BackupLocation } from "./backup";

const DEFAULT_DIR = "/data/backup";
const CUSTOM_DIR = "/mnt/usb/trilium";

let container: HTMLDivElement | undefined;
const refreshCallback = vi.fn();

function renderInto(vnode: VNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(vnode, container);
    return container;
}

function renderLocation(folderPath = DEFAULT_DIR) {
    return renderInto(<BackupLocation backupFolderPath={folderPath} refreshCallback={refreshCallback} />);
}

function button(name: string) {
    return container?.querySelector<HTMLButtonElement>(`button[name="${name}"]`);
}

function setPickDirectory(pickDirectory: unknown) {
    (window as unknown as { electronApi?: unknown }).electronApi = pickDirectory ? { dialog: { pickDirectory } } : undefined;
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.customDir = "";
    mocks.isElectron.mockReturnValue(true);
    setPickDirectory(vi.fn(async () => ({ status: "selected", path: CUSTOM_DIR })));
});

function cleanup() {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
}

/** Lets the click handler's awaited continuation run, so "nothing happened" is a real assertion. */
function settle() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(cleanup);

describe("BackupLocation", () => {
    it("shows the effective location, offering a reset only once a custom one is in use", () => {
        renderLocation();
        expect(container?.querySelector(".backup-location-path")?.textContent).toBe(DEFAULT_DIR);
        // On the desktop the location opens in the OS file manager, as in the About dialog.
        expect(container?.querySelector(".backup-location-path a.tn-link")).not.toBeNull();
        expect(button("select-backup-location-button")?.disabled).toBe(false);
        expect(button("reset-backup-location-button")).toBeNull();

        cleanup();
        mocks.customDir = CUSTOM_DIR;
        renderLocation(CUSTOM_DIR);
        expect(container?.querySelector(".backup-location-path")?.textContent).toBe(CUSTOM_DIR);
        expect(button("reset-backup-location-button")).not.toBeNull();
    });

    it("disables the picker outside Electron, explaining why", () => {
        mocks.isElectron.mockReturnValue(false);

        renderLocation();

        expect(button("select-backup-location-button")?.disabled).toBe(true);
        // The explanation hangs off a wrapper, since a disabled button emits no pointer events.
        expect(container?.querySelector(".tn-disabled-reason button")).not.toBeNull();
        // Nothing can open a file manager here, so the location stays plain text.
        expect(container?.querySelector(".backup-location-path a")).toBeNull();
        expect(container?.querySelector(".backup-location-path")?.textContent).toBe(DEFAULT_DIR);
    });

    it("stores the chosen directory and refreshes, opening the picker at the current location", async () => {
        const pickDirectory = vi.fn(async () => ({ status: "selected", path: CUSTOM_DIR }));
        setPickDirectory(pickDirectory);

        renderLocation();
        button("select-backup-location-button")?.click();

        expect(pickDirectory).toHaveBeenCalledWith({ defaultPath: DEFAULT_DIR });
        await vi.waitFor(() => expect(mocks.setCustomDir).toHaveBeenCalledWith(CUSTOM_DIR));
        await vi.waitFor(() => expect(refreshCallback).toHaveBeenCalled());
    });

    it("leaves the option alone when the picker is dismissed", async () => {
        const pickDirectory = vi.fn(async () => ({ status: "cancelled" }));
        setPickDirectory(pickDirectory);

        renderLocation();
        button("select-backup-location-button")?.click();
        await settle();

        expect(pickDirectory).toHaveBeenCalled();
        expect(mocks.setCustomDir).not.toHaveBeenCalled();
        expect(refreshCallback).not.toHaveBeenCalled();
    });

    it("clears the option on a confirmed reset, and only then", async () => {
        mocks.customDir = CUSTOM_DIR;
        mocks.confirm.mockResolvedValue(false);

        renderLocation(CUSTOM_DIR);
        button("reset-backup-location-button")?.click();
        await settle();

        expect(mocks.confirm).toHaveBeenCalled();
        expect(mocks.setCustomDir).not.toHaveBeenCalled();

        mocks.confirm.mockResolvedValue(true);
        button("reset-backup-location-button")?.click();
        await vi.waitFor(() => expect(mocks.setCustomDir).toHaveBeenCalledWith(""));
        await vi.waitFor(() => expect(refreshCallback).toHaveBeenCalled());
    });
});

describe("BackupList: telling the two locations apart", () => {
    const backup = (filePath: string) => ({ fileName: filePath.split(/[/\\]/).pop() ?? "", filePath, mtime: new Date(0), fileSize: 1 });

    function renderList(folderPath: string, files: string[]) {
        return renderInto(
            <BackupList
                backups={files.map(backup)}
                backupFolderPath={folderPath}
                refreshCallback={refreshCallback}
            />
        );
    }

    function badges() {
        return [...(container?.querySelectorAll(".database-file-badge") ?? [])].map((el) => el.textContent);
    }

    it("badges only the backups left outside a custom location", () => {
        mocks.customDir = CUSTOM_DIR;

        renderList(CUSTOM_DIR, [`${CUSTOM_DIR}/backup-daily.db`, `${DEFAULT_DIR}/backup-weekly.db`]);

        expect(badges()).toEqual(["backup.default_location"]);
    });

    it("badges nothing while the default location is the one in use", () => {
        renderList(DEFAULT_DIR, [`${DEFAULT_DIR}/backup-daily.db`, `${DEFAULT_DIR}/backup-weekly.db`]);

        expect(badges()).toEqual([]);
    });

    it("does not mistake a sibling directory sharing the location's name for the location itself", () => {
        mocks.customDir = CUSTOM_DIR;

        renderList(CUSTOM_DIR, [`${CUSTOM_DIR}-old/backup-daily.db`]);

        expect(badges()).toEqual(["backup.default_location"]);
    });
});
