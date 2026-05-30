import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import toast from "./toast.js";
import { copyText, copyTextWithToast } from "./clipboard_ext.js";

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

function setClipboard(value: unknown) {
    Object.defineProperty(navigator, "clipboard", {
        value,
        configurable: true,
        writable: true
    });
}

afterEach(() => {
    vi.restoreAllMocks();
    if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
        setClipboard(undefined);
    }
    document.body.innerHTML = "";
});

describe("copyText", () => {
    it("returns undefined for empty text without touching the clipboard", () => {
        const writeText = vi.fn();
        setClipboard({ writeText });

        expect(copyText("")).toBeUndefined();
        expect(writeText).not.toHaveBeenCalled();
    });

    it("uses navigator.clipboard.writeText when available and returns true", () => {
        const writeText = vi.fn();
        setClipboard({ writeText });

        expect(copyText("hello")).toBe(true);
        expect(writeText).toHaveBeenCalledWith("hello");
    });

    it("falls back to execCommand when navigator.clipboard is unavailable", () => {
        setClipboard(undefined);

        let capturedValue: string | undefined;
        const execCommand = vi.fn((command: string) => {
            // The textarea must still be attached when copy runs.
            const textArea = document.querySelector("textarea");
            capturedValue = textArea?.value;
            return command === "copy";
        });
        (document as unknown as { execCommand: typeof execCommand }).execCommand = execCommand;

        expect(copyText("fallback-text")).toBe(true);
        expect(execCommand).toHaveBeenCalledWith("copy");
        expect(capturedValue).toBe("fallback-text");
        // The textarea is removed in the finally block.
        expect(document.querySelector("textarea")).toBeNull();
    });

    it("returns false and warns when the fallback throws", () => {
        setClipboard(undefined);

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = new Error("execCommand failed");
        (document as unknown as { execCommand: () => never }).execCommand = () => {
            throw error;
        };

        expect(copyText("boom")).toBe(false);
        expect(warn).toHaveBeenCalledWith(error);
        // The textarea is still cleaned up despite the throw.
        expect(document.querySelector("textarea")).toBeNull();
    });
});

describe("copyTextWithToast", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("shows a success message when the copy succeeds", () => {
        setClipboard({ writeText: vi.fn() });
        const showMessage = vi.spyOn(toast, "showMessage").mockImplementation(() => {});
        const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});

        copyTextWithToast("yay");

        expect(showMessage).toHaveBeenCalledTimes(1);
        expect(showError).not.toHaveBeenCalled();
    });

    it("shows an error message when the copy fails", () => {
        setClipboard(undefined);
        (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
        const showMessage = vi.spyOn(toast, "showMessage").mockImplementation(() => {});
        const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});

        copyTextWithToast("nope");

        expect(showError).toHaveBeenCalledTimes(1);
        expect(showMessage).not.toHaveBeenCalled();
    });
});
