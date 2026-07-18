import $ from "jquery";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import imageService, { copyImageReferenceToClipboard, copyImageToClipboard, downloadImage, getFileNameFromSrc, getImageDownloadUrl, isImageCopySupported } from "./image.js";
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

    it("leaves the name unchanged when the MIME type yields no extension", () => {
        // "image/" -> split("/")[1] is "" -> extension is falsy, so no suffix is appended.
        expect(getFileNameFromSrc("api/images/abc/screenshot", "image/")).toBe("screenshot");
        // A MIME type without a slash -> split("/")[1] is undefined -> optional chaining short-circuits.
        expect(getFileNameFromSrc("api/images/abc/screenshot", "image")).toBe("screenshot");
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

    it("falls back to fetching a blob and saving it via an object URL", async () => {
        vi.useFakeTimers();
        try {
            vi.mocked(utils.isElectron).mockReturnValue(false);
            (window as any).logError = vi.fn();

            const blob = new Blob(["x"], { type: "image/png" });
            vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => blob })));
            const createObjectURLSpy = vi.fn(() => "blob:fake");
            const revokeObjectURLSpy = vi.fn();
            vi.stubGlobal("URL", { createObjectURL: createObjectURLSpy, revokeObjectURL: revokeObjectURLSpy });
            const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

            // A data: URL doesn't map to a download endpoint, so the blob fallback runs.
            await downloadImage("data:image/png;base64,AAAA");

            expect(createObjectURLSpy).toHaveBeenCalledWith(blob);
            expect(clickSpy).toHaveBeenCalledTimes(1);
            // Revocation is deferred via setTimeout; it hasn't run until timers advance.
            expect(revokeObjectURLSpy).not.toHaveBeenCalled();
            vi.runAllTimers();
            expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:fake");

            clickSpy.mockRestore();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("copyImageToClipboard", () => {
    beforeEach(() => {
        (window as any).logError = vi.fn();
        vi.spyOn(toastService, "showMessage").mockImplementation(() => {});
        vi.spyOn(toastModule, "showError").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        delete (window as any).electronApi;
    });

    it("copies the raw image bytes via the Electron clipboard bridge", async () => {
        vi.mocked(utils.isElectron).mockReturnValue(true);
        vi.stubGlobal("fetch", vi.fn(async () => ({
            ok: true,
            blob: async () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer })
        })));
        const copySpy = vi.fn();
        (window as any).electronApi = { clipboard: { copyImageToClipboard: copySpy } };

        await copyImageToClipboard("api/images/abc/x.png");

        expect(copySpy).toHaveBeenCalledTimes(1);
        const [buffer] = copySpy.mock.calls[0];
        expect(buffer).toBeInstanceOf(Uint8Array);
        expect(Array.from(buffer as Uint8Array)).toEqual([1, 2, 3, 4]);
        expect(toastService.showMessage).toHaveBeenCalledTimes(1);
    });

    it("renders the image to a PNG and writes it via the Web Clipboard API", async () => {
        vi.mocked(utils.isElectron).mockReturnValue(false);
        stubDrawableImage();
        const pngBlob = new Blob(["x"], { type: "image/png" });
        stubCanvasFactory({ toBlob: (cb: (b: Blob | null) => void) => cb(pngBlob) });
        vi.stubGlobal("ClipboardItem", class {
            constructor(public readonly data: unknown) {}
        });
        const writeSpy = vi.fn(async () => {});
        vi.stubGlobal("navigator", { clipboard: { write: writeSpy } });

        await copyImageToClipboard("data:image/png;base64,AAAA");

        expect(writeSpy).toHaveBeenCalledTimes(1);
        expect(toastService.showMessage).toHaveBeenCalledTimes(1);
    });

    it("reports an error when the image has no drawable dimensions", async () => {
        vi.mocked(utils.isElectron).mockReturnValue(false);
        stubDrawableImage();
        // getContext returns null -> renderImageToPng throws before encoding.
        stubCanvasFactory({ getContext: () => null });
        const showErrorSpy = vi.spyOn(toastModule, "showError").mockImplementation(() => {});

        await copyImageToClipboard("data:image/png;base64,AAAA");

        expect((window as any).logError).toHaveBeenCalledTimes(1);
        expect(showErrorSpy).toHaveBeenCalledTimes(1);
        expect(toastService.showMessage).not.toHaveBeenCalled();
    });

    it("reports an error when the canvas cannot encode the image as PNG", async () => {
        vi.mocked(utils.isElectron).mockReturnValue(false);
        stubDrawableImage();
        // toBlob calls back with null -> the encoding promise rejects.
        stubCanvasFactory({ toBlob: (cb: (b: Blob | null) => void) => cb(null) });
        vi.stubGlobal("ClipboardItem", class {
            constructor(public readonly data: unknown) {}
        });
        vi.stubGlobal("navigator", { clipboard: { write: vi.fn(async () => {}) } });
        const showErrorSpy = vi.spyOn(toastModule, "showError").mockImplementation(() => {});

        await copyImageToClipboard("data:image/png;base64,AAAA");

        expect((window as any).logError).toHaveBeenCalledTimes(1);
        expect(showErrorSpy).toHaveBeenCalledTimes(1);
        expect(toastService.showMessage).not.toHaveBeenCalled();
    });
});

/** happy-dom's `Image` reports `naturalWidth` 0 and can't decode, so stub a drawable one. */
function stubDrawableImage() {
    vi.stubGlobal("Image", class {
        naturalWidth = 10;
        naturalHeight = 10;
        set src(_v: string) {}
        decode() {
            return Promise.resolve();
        }
    });
}

/**
 * Spies on `document.createElement` so that a "canvas" tag returns a fake canvas with controllable
 * `getContext`/`toBlob`; every other tag delegates to the real factory.
 */
function stubCanvasFactory(overrides: { getContext?: () => unknown; toBlob?: (cb: (b: Blob | null) => void) => void }) {
    const realCreateElement = document.createElement.bind(document);
    const fakeCanvas = {
        width: 0,
        height: 0,
        getContext: overrides.getContext ?? (() => ({ drawImage: vi.fn() })),
        toBlob: overrides.toBlob ?? ((cb: (b: Blob | null) => void) => cb(new Blob(["x"], { type: "image/png" })))
    };
    vi.spyOn(document, "createElement").mockImplementation((tagName: string, options?: ElementCreationOptions) =>
        tagName === "canvas" ? (fakeCanvas as unknown as HTMLElement) : realCreateElement(tagName, options)
    );
}
