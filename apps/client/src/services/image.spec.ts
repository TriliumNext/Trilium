import $ from "jquery";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import imageService, { copyImageReferenceToClipboard } from "./image.js";
import * as toastModule from "./toast.js";
import toastService from "./toast.js";

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
