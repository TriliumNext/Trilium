import $ from "jquery";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import imageService, { copyImageReferenceToClipboard, downloadImage, getFileNameFromSrc, getImageDownloadUrl, isImageCopySupported } from "./image.js";
import open from "./open.js";
import * as toastModule from "./toast.js";
import toastService from "./toast.js";
import utils from "./utils.js";

vi.mock("./utils.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./utils.js")>();
    return { ...actual, default: { ...actual.default, isElectron: vi.fn(() => false) } };
});

describe("copyImageReferenceToClipboard", () => {
    let execCommandSpy: ReturnType<typeof vi.fn>;
    let removeAllRangesSpy: ReturnType<typeof vi.fn>;
    let addRangeSpy: ReturnType<typeof vi.fn>;
    let showErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        // image.ts calls the bare global `logError`, normally installed by ws.ts (which setup.ts mocks).
        (window as any).logError = vi.fn();

        // happy-dom does not implement execCommand; provide a controllable stub.
        execCommandSpy = vi.fn(() => true);
        (document as any).execCommand = execCommandSpy;

        // Track range clean-up performed in the finally block, and range addition done by selectImage's happy path.
        removeAllRangesSpy = vi.fn();
        addRangeSpy = vi.fn();
        const selection = {
            removeAllRanges: removeAllRangesSpy,
            addRange: addRangeSpy
        };
        vi.spyOn(window, "getSelection").mockReturnValue(selection as unknown as Selection);

        vi.spyOn(toastService, "showMessage").mockImplementation(() => {});
        showErrorSpy = vi.spyOn(toastModule, "showError").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("selects the image, copies it and shows a success message, then cleans up", () => {
        const element = document.createElement("div");
        document.body.appendChild(element);
        const $wrapper = $(element);

        copyImageReferenceToClipboard($wrapper);

        // contenteditable is toggled on then removed in the finally block.
        expect($wrapper.attr("contenteditable")).toBeUndefined();
        expect(execCommandSpy).toHaveBeenCalledWith("copy");
        expect(toastService.showMessage).toHaveBeenCalledTimes(1);
        // The happy path adds the element's range to the selection -> proves selectImage actually
        // selected the image (removeAllRanges alone is also fired by the finally block, so it proves nothing).
        expect(addRangeSpy).toHaveBeenCalledTimes(1);
        // Selection was cleaned up in the finally block.
        expect(removeAllRangesSpy).toHaveBeenCalled();
        // No error feedback on the success path.
        expect(showErrorSpy).not.toHaveBeenCalled();

        element.remove();
    });

    it("reports an error when the copy command fails", () => {
        execCommandSpy.mockReturnValue(false);
        const $wrapper = $(document.createElement("div"));

        copyImageReferenceToClipboard($wrapper);

        expect(toastService.showMessage).not.toHaveBeenCalled();
        // The user-facing failure feedback is the named showError export from toast.ts (message is an
        // i18n string, so we only assert it was invoked once on the failure path).
        expect(showErrorSpy).toHaveBeenCalledTimes(1);
        expect((window as any).logError).toHaveBeenCalledTimes(1);
        expect($wrapper.attr("contenteditable")).toBeUndefined();
    });

    it("does nothing in selectImage when the wrapper has no element", () => {
        const addRange = vi.fn();
        (window.getSelection as any).mockReturnValue({
            removeAllRanges: removeAllRangesSpy,
            addRange
        });

        // An empty jQuery wrapper -> .get(0) is undefined -> selectImage early-returns.
        const $empty = $([] as unknown as HTMLElement);

        copyImageReferenceToClipboard($empty);

        expect(addRange).not.toHaveBeenCalled();
        expect(execCommandSpy).toHaveBeenCalledWith("copy");
    });

    it("exposes copyImageReferenceToClipboard on the default export", () => {
        expect(imageService.copyImageReferenceToClipboard).toBe(copyImageReferenceToClipboard);
    });
});

describe("getImageDownloadUrl", () => {
    it("maps note and attachment image URLs to their download endpoints", () => {
        expect(getImageDownloadUrl("api/images/abc123/My%20Image.png")).toBe("api/notes/abc123/download");
        expect(getImageDownloadUrl("api/attachments/att456/image/photo.jpg")).toBe("api/attachments/att456/download");
    });

    it("matches absolute URLs and ignores the query string", () => {
        expect(getImageDownloadUrl("http://localhost:8080/api/images/abc123/x.png?ts=1")).toBe("api/notes/abc123/download");
    });

    it("returns null for sources that aren't note/attachment images", () => {
        expect(getImageDownloadUrl("data:image/png;base64,AAAA")).toBeNull();
        expect(getImageDownloadUrl("https://example.com/cat.png")).toBeNull();
    });
});

describe("getFileNameFromSrc", () => {
    it("uses the decoded last path segment and strips the query", () => {
        expect(getFileNameFromSrc("api/images/abc/My%20Image.png?ts=1")).toBe("My Image.png");
    });

    it("appends an extension from the MIME type when the name has none", () => {
        expect(getFileNameFromSrc("api/images/abc/screenshot", "image/png")).toBe("screenshot.png");
    });

    it("keeps an existing extension and falls back to 'image' for an empty segment", () => {
        expect(getFileNameFromSrc("api/images/abc/photo.jpg", "image/jpeg")).toBe("photo.jpg");
        expect(getFileNameFromSrc("api/images/abc/", "image/png")).toBe("image.png");
    });

    it("derives a clean extension from a compound MIME type", () => {
        expect(getFileNameFromSrc("api/images/abc/diagram", "image/svg+xml")).toBe("diagram.svg");
    });

    it("falls back to the raw segment when it is a malformed URI", () => {
        expect(getFileNameFromSrc("api/images/abc/%E0%A4%A")).toBe("%E0%A4%A");
    });
});

describe("isImageCopySupported", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("is always supported in Electron, regardless of secure context", () => {
        vi.mocked(utils.isElectron).mockReturnValue(true);
        vi.stubGlobal("isSecureContext", false);
        expect(isImageCopySupported()).toBe(true);
    });

    it("is supported in a secure browser context exposing the Clipboard API", () => {
        vi.mocked(utils.isElectron).mockReturnValue(false);
        vi.stubGlobal("isSecureContext", true);
        vi.stubGlobal("ClipboardItem", class {});
        vi.stubGlobal("navigator", { clipboard: { write: vi.fn() } });
        expect(isImageCopySupported()).toBe(true);
    });

    it("is unsupported on a non-secure origin", () => {
        vi.mocked(utils.isElectron).mockReturnValue(false);
        vi.stubGlobal("isSecureContext", false);
        vi.stubGlobal("ClipboardItem", class {});
        vi.stubGlobal("navigator", { clipboard: { write: vi.fn() } });
        expect(isImageCopySupported()).toBe(false);
    });

    it("is unsupported when the Clipboard API is missing", () => {
        vi.mocked(utils.isElectron).mockReturnValue(false);
        vi.stubGlobal("isSecureContext", true);
        vi.stubGlobal("ClipboardItem", undefined);
        vi.stubGlobal("navigator", { clipboard: undefined });
        expect(isImageCopySupported()).toBe(false);
    });
});

describe("downloadImage", () => {
    it("downloads via the resolved download endpoint instead of the inline image URL", async () => {
        vi.mocked(utils.isElectron).mockReturnValue(false);
        const downloadSpy = vi.spyOn(open, "download").mockImplementation(() => {});

        await downloadImage("api/images/abc123/My%20Image.png");

        expect(downloadSpy).toHaveBeenCalledWith("api/notes/abc123/download");
        downloadSpy.mockRestore();
    });

    it("reports an error when the fallback fetch returns a non-OK response", async () => {
        vi.mocked(utils.isElectron).mockReturnValue(false);
        vi.stubGlobal("logError", vi.fn());
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, statusText: "Not Found" })));
        const showErrorSpy = vi.spyOn(toastModule, "showError").mockImplementation(() => {});

        // A data: URL doesn't map to a note/attachment endpoint, so the blob fallback runs and fetches.
        await downloadImage("data:image/png;base64,AAAA");

        expect(showErrorSpy).toHaveBeenCalledTimes(1);
        showErrorSpy.mockRestore();
    });
});
