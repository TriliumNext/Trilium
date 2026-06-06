import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../test/easy-froca";
import open, { checkType, downloadFileNote, getUrlForDownload, openNoteExternally } from "./open.js";
import options from "./options.js";
import server from "./server.js";
import utils from "./utils.js";

const realWindow = window as any;

/** Build a minimal electronApi.shell stub and install it on window. */
function installElectronApi() {
    const shell = {
        downloadURL: vi.fn(),
        openCustom: vi.fn(),
        openPath: vi.fn(async () => "") as ReturnType<typeof vi.fn>
    };
    realWindow.electronApi = { shell };
    return shell;
}

function removeElectronApi() {
    delete realWindow.electronApi;
}

describe("open service", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        removeElectronApi();
        // Default: behave like a plain web browser.
        vi.spyOn(utils, "isElectron").mockReturnValue(false);
        vi.spyOn(utils, "isMac").mockReturnValue(false);
        // window.open / location.href are used as side effects; stub open, track href.
        vi.spyOn(window, "open").mockReturnValue(null);
    });

    afterEach(() => {
        removeElectronApi();
    });

    describe("getUrlForDownload", () => {
        it("returns an absolute URL under Electron and a relative one in the browser", () => {
            (window as any).history.replaceState({}, "", "/");
            vi.spyOn(utils, "isElectron").mockReturnValue(true);
            const electronUrl = getUrlForDownload("api/notes/abc/download");
            // host is derived from window.location: protocol//hostname:port
            expect(electronUrl).toMatch(/^https?:\/\/[^/]+\/api\/notes\/abc\/download$/);

            vi.spyOn(utils, "isElectron").mockReturnValue(false);
            expect(getUrlForDownload("api/notes/abc/download")).toBe("api/notes/abc/download");
        });
    });

    describe("download", () => {
        it("uses electronApi.shell.downloadURL when running under Electron", () => {
            const shell = installElectronApi();
            open.download("http://example/x");
            expect(shell.downloadURL).toHaveBeenCalledWith("http://example/x");
        });

        it("navigates via window.location.href in the browser", () => {
            open.download("http://example/y");
            expect(window.location.href).toContain("http://example/y");
        });
    });

    describe("downloadFileNote", () => {
        it("delegates to customDownload for PDF file notes via the parent component", () => {
            const note = buildNote({ title: "Doc", type: "file" });
            (note as any).mime = "application/pdf";
            const parent = { triggerEvent: vi.fn() } as any;
            downloadFileNote(note, parent, "ntx-1");
            expect(parent.triggerEvent).toHaveBeenCalledWith("customDownload", { ntxId: "ntx-1" });
        });

        it("delegates to customDownload for the _backendLog note", () => {
            const note = buildNote({ id: "_backendLog", title: "Backend log", type: "text" });
            const parent = { triggerEvent: vi.fn() } as any;
            downloadFileNote(note, parent, null);
            expect(parent.triggerEvent).toHaveBeenCalledWith("customDownload", { ntxId: null });
        });

        it("downloads the note content when there is no parent component", () => {
            const note = buildNote({ title: "Plain", type: "file" });
            (note as any).mime = "image/png";
            downloadFileNote(note, null, undefined);
            expect(window.location.href).toContain(`api/notes/${note.noteId}/download?`);
        });

        it("downloads via URL (not customDownload) for an ordinary file even when a parent component is present", () => {
            const note = buildNote({ title: "Plain", type: "file" });
            (note as any).mime = "image/png";
            const parent = { triggerEvent: vi.fn() } as any;
            downloadFileNote(note, parent, "ntx-2");
            expect(parent.triggerEvent).not.toHaveBeenCalled();
            expect(window.location.href).toContain(`api/notes/${note.noteId}/download?`);
        });
    });

    describe("downloadAttachment", () => {
        it("downloads an attachment via a cache-busted URL", () => {
            open.downloadAttachment("att-123");
            expect(window.location.href).toContain("api/attachments/att-123/download?");
        });
    });

    describe("downloadRevision", () => {
        it("downloads a revision via the revisions endpoint", () => {
            open.downloadRevision("note-1", "rev-9");
            expect(window.location.href).toContain("api/revisions/rev-9/download");
        });
    });

    describe("checkType", () => {
        it("accepts notes and attachments but throws otherwise", () => {
            expect(() => checkType("notes")).not.toThrow();
            expect(() => checkType("attachments")).not.toThrow();
            expect(() => checkType("bogus")).toThrow(/Unrecognized type 'bogus'/);
        });
    });

    describe("openCustom", () => {
        it("does nothing in the browser (no electronApi)", async () => {
            server.post = vi.fn(async () => ({ tmpFilePath: "/tmp/x" })) as typeof server.post;
            await open.openNoteCustom("n1", "image/png");
            expect(server.post).not.toHaveBeenCalled();
        });

        it("does nothing under Electron on macOS", async () => {
            const shell = installElectronApi();
            vi.spyOn(utils, "isMac").mockReturnValue(true);
            server.post = vi.fn(async () => ({ tmpFilePath: "/tmp/x" })) as typeof server.post;
            await open.openAttachmentCustom("a1", "image/png");
            expect(server.post).not.toHaveBeenCalled();
            expect(shell.openCustom).not.toHaveBeenCalled();
        });

        it("saves to tmp dir and opens the file under Electron on non-Mac", async () => {
            const shell = installElectronApi();
            server.post = vi.fn(async () => ({ tmpFilePath: "/tmp/file.png" })) as typeof server.post;
            await open.openNoteCustom("n2", "image/png");
            expect(server.post).toHaveBeenCalledWith("notes/n2/save-to-tmp-dir");
            expect(shell.openCustom).toHaveBeenCalledWith("/tmp/file.png");
        });
    });

    describe("openExternally", () => {
        it("opens common mime types in the browser via window.open", async () => {
            await openNoteExternally("n3", "application/pdf");
            expect(window.open).toHaveBeenCalledWith("api/notes/n3/open");
        });

        it("navigates via location.href for non-browser-openable mime types", async () => {
            await open.openAttachmentExternally("a3", "application/zip");
            expect(window.location.href).toContain("api/attachments/a3/download");
        });

        it("covers all canOpenInBrowser branches (image/audio/video)", async () => {
            await openNoteExternally("img", "image/jpeg");
            expect(window.open).toHaveBeenLastCalledWith("api/notes/img/open");
            await openNoteExternally("aud", "audio/mpeg");
            expect(window.open).toHaveBeenLastCalledWith("api/notes/aud/open");
            await openNoteExternally("vid", "video/mp4");
            expect(window.open).toHaveBeenLastCalledWith("api/notes/vid/open");
        });

        it("opens via the OS under Electron and does not fall back when openPath succeeds", async () => {
            const shell = installElectronApi();
            vi.spyOn(utils, "isElectron").mockReturnValue(true);
            shell.openPath.mockResolvedValue(""); // empty string = success
            server.post = vi.fn(async () => ({ tmpFilePath: "/tmp/a.bin" })) as typeof server.post;
            await openNoteExternally("n4", "application/octet-stream");
            expect(server.post).toHaveBeenCalledWith("notes/n4/save-to-tmp-dir");
            expect(shell.openPath).toHaveBeenCalledWith("/tmp/a.bin");
            expect(window.open).not.toHaveBeenCalled();
        });

        it("falls back to window.open under Electron when openPath returns an error", async () => {
            const shell = installElectronApi();
            vi.spyOn(utils, "isElectron").mockReturnValue(true);
            shell.openPath.mockResolvedValue("no default app"); // non-empty = failure
            server.post = vi.fn(async () => ({ tmpFilePath: "/tmp/b.bin" })) as typeof server.post;
            await open.openAttachmentExternally("a4", "application/octet-stream");
            // Under Electron getFileUrl yields an absolute URL (host prefix).
            expect(window.open).toHaveBeenCalledWith(
                expect.stringContaining("api/attachments/a4/download")
            );
        });
    });

    describe("openNoteOnServer", () => {
        // options is a process-wide singleton with no reset between spec files; capture the
        // original value and restore it so these tests do not leak into other specs.
        let originalSyncServerHost: string | undefined;

        beforeEach(async () => {
            await options.initializedPromise;
            originalSyncServerHost = options.get("syncServerHost");
        });

        afterEach(() => {
            if (originalSyncServerHost === undefined) {
                options.set("syncServerHost", "");
            } else {
                options.set("syncServerHost", originalSyncServerHost);
            }
        });

        it("logs an error when no sync server host is configured", async () => {
            options.set("syncServerHost", "");
            const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            await open.openNoteOnServer("n5");
            expect(errSpy).toHaveBeenCalledWith("No sync server host configured");
            expect(window.open).not.toHaveBeenCalled();
        });

        it("opens the note URL in a new browser tab when a sync server host is set", async () => {
            options.set("syncServerHost", "https://sync.example.com");
            await open.openNoteOnServer("n6");
            expect(window.open).toHaveBeenCalledWith(
                "https://sync.example.com/#root/n6",
                "_blank",
                "noopener,noreferrer"
            );
        });
    });

    describe("openDirectory", () => {
        it("warns in a non-Electron environment", async () => {
            const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            await open.openDirectory("/some/dir");
            expect(errSpy).toHaveBeenCalledWith("Not running in an Electron environment.");
        });

        it("opens the directory under Electron when openPath succeeds", async () => {
            const shell = installElectronApi();
            vi.spyOn(utils, "isElectron").mockReturnValue(true);
            shell.openPath.mockResolvedValue(""); // success
            const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            await open.openDirectory("/ok/dir");
            expect(shell.openPath).toHaveBeenCalledWith("/ok/dir");
            expect(errSpy).not.toHaveBeenCalled();
        });

        it("logs an error under Electron when openPath returns an error string", async () => {
            const shell = installElectronApi();
            vi.spyOn(utils, "isElectron").mockReturnValue(true);
            shell.openPath.mockResolvedValue("ENOENT"); // failure
            const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            await open.openDirectory("/bad/dir");
            expect(errSpy).toHaveBeenCalledWith("Failed to open directory:", "ENOENT");
        });

        it("catches and logs filesystem errors thrown by openPath", async () => {
            const shell = installElectronApi();
            vi.spyOn(utils, "isElectron").mockReturnValue(true);
            shell.openPath.mockRejectedValue(new Error("boom"));
            const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            await open.openDirectory("/throws");
            expect(errSpy).toHaveBeenCalledWith("Error:", "boom");
        });
    });
});
