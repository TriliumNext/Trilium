import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../../test/render";

const mocks = vi.hoisted(() => ({
    download: vi.fn(),
    getUrlForDownload: vi.fn((url: string) => `resolved:${url}`),
    isLegacy: false,
    get: vi.fn(async (url: string) =>
        (url === "keyboard-actions" ? [] : { set: true, isCodeAsked: true })),
    withCredentials: vi.fn(async () => ({ token: "the token" }))
}));

vi.mock("../../../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../../../../services/open", () => ({
    default: { download: mocks.download, getUrlForDownload: mocks.getUrlForDownload }
}));

vi.mock("../../../../services/options", () => ({
    default: { is: (name: string) => name === "isSecondFactorLegacy" && mocks.isLegacy }
}));

vi.mock("../../../../services/server", () => ({
    default: { get: mocks.get, withCredentials: mocks.withCredentials }
}));

vi.mock("../../../react/Modal", () => ({
    default: ({ className, show, footer, onSubmit, children }: {
        className?: string;
        show?: boolean;
        footer?: preact.ComponentChildren;
        onSubmit?: () => void;
        children?: preact.ComponentChildren;
    }) => (show
        ? <div className={`modal ${className ?? ""}`}>
            <form onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
                <div className="modal-body">{children}</div>
                <div className="modal-footer">{footer}</div>
            </form>
        </div>
        : null)
}));

// The line under each file states its size and age; neither is what these cases are reading.
vi.mock("../../../../services/database_files", () => ({
    describeDatabaseFile: () => "12 MB, yesterday"
}));

vi.mock("../../../react/hooks/tooltip", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../react/hooks/tooltip")>()),
    useStaticTooltip: vi.fn()
}));

import DatabaseFileList from "./DatabaseFileList";

const FILES = [
    { fileName: "older.db", filePath: "/backups/older.db", mtime: new Date(1000), fileSize: 10 },
    { fileName: "newest.db", filePath: "/backups/newest.db", mtime: new Date(3000), fileSize: 30 },
    { fileName: "middle.db", filePath: "/backups/middle.db", mtime: new Date(2000), fileSize: 20 }
];

function list(files = FILES, extra: Record<string, unknown> = {}) {
    return renderInto(
        <DatabaseFileList
            title="backup.title"
            files={files}
            downloadEndpoint="database/download-backup"
            downloadKind="backup"
            downloadText="backup.download"
            emptyIcon="bx bx-data"
            emptyText="backup.no_backups"
            {...extra}
        />
    );
}

const fileNames = (container: HTMLElement) =>
    [ ...container.querySelectorAll(".selectable-text") ].map((name) => name.textContent);

afterEach(() => {
    mocks.isLegacy = false;
    vi.clearAllMocks();
});

describe("DatabaseFileList", () => {
    it("puts the newest first, which is the one anyone is looking for", () => {
        expect(fileNames(list())).toEqual([ "newest.db", "middle.db", "older.db" ]);
    });

    it("says there are none rather than showing an empty card", () => {
        const container = list([]);

        expect(container.querySelector(".no-items")).not.toBeNull();
        expect(fileNames(container)).toEqual([]);
    });

    it("downloads the file it was pressed on, by path rather than by name", () => {
        const [ download ] = [ ...list().querySelectorAll<HTMLButtonElement>("button") ];
        download.click();

        // Encoded, since a path may hold characters a query string would otherwise end on.
        expect(mocks.getUrlForDownload).toHaveBeenCalledWith(
            "database/download-backup?filePath=%2Fbackups%2Fnewest.db"
        );
        expect(mocks.download).toHaveBeenCalledWith("resolved:database/download-backup?filePath=%2Fbackups%2Fnewest.db");
    });

    it("offers removal only where the list has somewhere to remove to", () => {
        expect(list().querySelectorAll("button")).toHaveLength(3);

        const onDelete = vi.fn();
        const withDelete = list(FILES, { onDelete });
        expect(withDelete.querySelectorAll("button")).toHaveLength(6);

        const remove = [ ...withDelete.querySelectorAll<HTMLButtonElement>("button") ][1];
        expect(remove.className).toContain("destructive-action-icon");
        remove.click();
        expect(onDelete).toHaveBeenCalledWith(FILES[1]);
    });

    it("marks a file with whatever the list has to say about it", () => {
        const container = list(FILES, {
            fileBadges: (file: { fileName: string }) =>
                (file.fileName === "newest.db" ? [ { text: "backup.latest" } ] : [])
        });

        expect(container.querySelectorAll(".ext-badge")).toHaveLength(1);
    });

    it("asks for a password and code for a legacy second factor, and sends the token", async () => {
        mocks.isLegacy = true;
        const container = list();
        const credentialsBoxes = () =>
            [ ...document.querySelectorAll<HTMLInputElement>(".credentials-modal input") ];

        await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
        expect(mocks.download).not.toHaveBeenCalled();
        expect(credentialsBoxes()).toHaveLength(2);

        for (const [ index, value ] of [ "the password", "123456" ].entries()) {
            await act(async () => {
                const box = credentialsBoxes()[index];
                box.value = value;
                box.dispatchEvent(new Event("input", { bubbles: true }));
            });
        }
        await act(async () =>
            document.querySelector<HTMLFormElement>(".credentials-modal form")?.requestSubmit());
        await act(async () => {});

        expect(mocks.withCredentials).toHaveBeenCalledWith("POST", "database/download-token",
            { kind: "backup", filePath: "/backups/newest.db" },
            { password: "the password", code: "123456" });
        expect(mocks.download).toHaveBeenCalledWith(
            "resolved:database/download-backup?filePath=%2Fbackups%2Fnewest.db"
            + "&downloadToken=the%20token");
    });

    it("downloads nothing when the credentials dialog is canceled", async () => {
        mocks.isLegacy = true;
        const container = list();

        await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
        await act(async () =>
            document.querySelector<HTMLButtonElement>(".credentials-modal .modal-footer button")
                ?.click());

        expect(mocks.withCredentials).not.toHaveBeenCalled();
        expect(mocks.download).not.toHaveBeenCalled();
    });
});
