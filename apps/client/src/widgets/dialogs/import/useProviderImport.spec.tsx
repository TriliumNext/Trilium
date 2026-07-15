import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import useProviderImport from "./useProviderImport";

const uploadFiles = vi.fn((..._args: unknown[]) => Promise.resolve());
const isElectron = vi.fn(() => false);

vi.mock("../../../services/import.js", () => ({ default: { uploadFiles: (...args: unknown[]) => uploadFiles(...args) } }));
vi.mock("../../../services/utils.js", () => ({
    default: {
        isElectron: () => isElectron(),
        randomString: () => "rnd1234567"
    }
}));

type Hook = ReturnType<typeof useProviderImport>;
type Args = Parameters<typeof useProviderImport>[0];

let hook: Hook | undefined;

function Probe(args: Args) {
    hook = useProviderImport(args);
    return null;
}

/** Builds a FileList-like the hook can index (it only reads `[0]` and `.length`). */
function fileListOf(...files: File[]): FileList {
    return Object.assign(files.slice(), { item: (i: number) => files[i] ?? null }) as unknown as FileList;
}

describe("useProviderImport", () => {
    let container: HTMLElement;
    let closeDialog: ReturnType<typeof vi.fn>;
    let pickFiles: ReturnType<typeof vi.fn>;
    let grantDroppedFiles: ReturnType<typeof vi.fn>;
    let importFromToken: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        isElectron.mockReturnValue(false);
        closeDialog = vi.fn();
        pickFiles = vi.fn();
        grantDroppedFiles = vi.fn();
        importFromToken = vi.fn(async () => ({}));
        (window as unknown as { electronApi?: unknown }).electronApi = {
            nativeImport: { pickFiles, grantDroppedFiles, importFromToken }
        };
        hook = undefined;
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        delete (window as unknown as { electronApi?: unknown }).electronApi;
    });

    async function mount(overrides: Partial<Args> = {}) {
        const args = { format: "obsidian", parentNoteId: "p1", shrinkImages: false, closeDialog, ...overrides } as Args;
        await act(async () => {
            render(<Probe {...args} />, container);
        });
    }

    function current(): Hook {
        if (!hook) {
            throw new Error("hook is not mounted");
        }
        return hook;
    }

    describe("selection", () => {
        it("starts with no selection and no native browse/drop off desktop", async () => {
            await mount();
            expect(current().hasSelection).toBe(false);
            expect(current().displayNames).toBeUndefined();
            expect(current().onBrowse).toBeUndefined();
            expect(current().onNativeDrop).toBeUndefined();
        });

        it("marks a selection once a file is chosen via the upload route", async () => {
            await mount();
            const file = new File(["x"], "vault.zip");
            await act(async () => current().onChange(fileListOf(file)));
            expect(current().hasSelection).toBe(true);
            // The upload route has no display name override — FileDropZone shows the File itself.
            expect(current().displayNames).toBeUndefined();
        });

        it("clears the selection when onChange receives no files", async () => {
            await mount();
            await act(async () => current().onChange(fileListOf(new File(["x"], "vault.zip"))));
            await act(async () => current().onChange(null));
            expect(current().hasSelection).toBe(false);
        });

        it("exposes native browse/drop on desktop", async () => {
            isElectron.mockReturnValue(true);
            await mount();
            expect(current().onBrowse).toBeInstanceOf(Function);
            expect(current().onNativeDrop).toBeInstanceOf(Function);
        });
    });

    describe("native browse (desktop)", () => {
        beforeEach(() => isElectron.mockReturnValue(true));

        it("stores the native pick and shows its filename, clearing any upload file", async () => {
            await mount();
            await act(async () => current().onChange(fileListOf(new File(["x"], "dropped.zip"))));
            pickFiles.mockResolvedValueOnce({ status: "selected", files: [{ token: "tok", fileName: "Vault.zip" }] });

            await act(async () => {
                current().onBrowse?.();
            });

            expect(current().hasSelection).toBe(true);
            expect(current().displayNames).toEqual(["Vault.zip"]);
        });

        it("ignores a cancelled pick", async () => {
            await mount();
            pickFiles.mockResolvedValueOnce({ status: "cancelled" });
            await act(async () => {
                current().onBrowse?.();
            });
            expect(current().hasSelection).toBe(false);
        });
    });

    describe("native drop (desktop)", () => {
        beforeEach(() => isElectron.mockReturnValue(true));

        it("routes a dropped archive through the native path and reports it was handled", async () => {
            await mount();
            grantDroppedFiles.mockResolvedValueOnce({ status: "selected", files: [{ token: "tok", fileName: "Vault.zip" }] });

            let handled: boolean | undefined;
            await act(async () => {
                handled = await current().onNativeDrop?.([new File(["x"], "Vault.zip"), new File(["y"], "extra.zip")]);
            });

            expect(handled).toBe(true);
            // A provider takes a single file, so only the first dropped file is granted.
            expect(grantDroppedFiles).toHaveBeenCalledWith([expect.any(File)]);
            expect(grantDroppedFiles.mock.calls[0][0]).toHaveLength(1);
            expect(current().displayNames).toEqual(["Vault.zip"]);
        });

        it("falls back to upload (returns false) when the drop did not resolve to a path", async () => {
            await mount();
            grantDroppedFiles.mockResolvedValueOnce({ status: "cancelled" });
            let handled: boolean | undefined;
            await act(async () => {
                handled = await current().onNativeDrop?.([new File(["x"], "folder")]);
            });
            expect(handled).toBe(false);
            expect(current().hasSelection).toBe(false);
        });
    });

    describe("doImport", () => {
        it("does nothing when nothing is selected", async () => {
            await mount();
            await act(async () => current().doImport());
            expect(uploadFiles).not.toHaveBeenCalled();
            expect(importFromToken).not.toHaveBeenCalled();
            expect(closeDialog).not.toHaveBeenCalled();
        });

        it("uploads the chosen file with the provider format and safe-import flags", async () => {
            await mount({ shrinkImages: true });
            const file = new File(["x"], "vault.zip");
            await act(async () => current().onChange(fileListOf(file)));
            await act(async () => current().doImport());

            expect(closeDialog).toHaveBeenCalled();
            expect(uploadFiles).toHaveBeenCalledWith("notes", "p1", [file], {
                format: "obsidian",
                safeImport: "true",
                shrinkImages: "true"
            });
        });

        it("imports a native pick in place via the capability token instead of uploading", async () => {
            isElectron.mockReturnValue(true);
            await mount({ shrinkImages: true });
            pickFiles.mockResolvedValueOnce({ status: "selected", files: [{ token: "tok-1", fileName: "Vault.zip" }] });
            await act(async () => {
                current().onBrowse?.();
            });

            await act(async () => current().doImport());

            expect(closeDialog).toHaveBeenCalled();
            expect(uploadFiles).not.toHaveBeenCalled();
            expect(importFromToken).toHaveBeenCalledTimes(1);
            expect(importFromToken).toHaveBeenCalledWith(
                expect.objectContaining({
                    token: "tok-1",
                    parentNoteId: "p1",
                    format: "obsidian",
                    last: true,
                    options: expect.objectContaining({ safeImport: true, shrinkImages: true, explodeArchives: true })
                })
            );
        });
    });
});
