import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import toast from "./toast.js";
import utils from "./utils.js";
import { copyHtml, copyHtmlWithToast, copyText, copyTextWithToast } from "./clipboard_ext.js";

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

describe("copyHtml", () => {
    afterEach(() => {
        delete (globalThis as any).ClipboardItem;
    });

    /** Install the `ClipboardItem` constructor the asynchronous Clipboard API needs. */
    function stubClipboardItem() {
        (globalThis as any).ClipboardItem = class {
            constructor(public readonly data: Record<string, unknown>) {}
        };
    }

    it("writes both flavours through navigator.clipboard when available", async () => {
        const write = vi.fn(async (..._args: any[]) => {});
        setClipboard({ write });
        stubClipboardItem();
        const copyHtmlToClipboard = vi.spyOn(utils, "copyHtmlToClipboard");

        expect(await copyHtml("<b>x</b>", "x")).toBe(true);

        const items = write.mock.calls[0][0] as any[];
        expect(await (items[0].data["text/html"] as Blob).text()).toBe("<b>x</b>");
        expect(await (items[0].data["text/plain"] as Blob).text()).toBe("x");
        expect(copyHtmlToClipboard).not.toHaveBeenCalled();
    });

    it("falls back to the copy event outside a secure context, where the API is undefined (#10723)", async () => {
        setClipboard(undefined);
        const copyHtmlToClipboard = vi.spyOn(utils, "copyHtmlToClipboard").mockReturnValue(true);

        // The plain text defaults to the HTML.
        expect(await copyHtml("<b>x</b>")).toBe(true);
        expect(copyHtmlToClipboard).toHaveBeenCalledWith("<b>x</b>", "<b>x</b>");
    });

    it("returns false and warns when the copy event itself throws", async () => {
        setClipboard(undefined);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = new Error("execCommand failed");
        vi.spyOn(utils, "copyHtmlToClipboard").mockImplementation(() => {
            throw error;
        });

        expect(await copyHtml("<b>x</b>")).toBe(false);
        expect(warn).toHaveBeenCalledWith(error);
    });

    it("falls back to the copy event when the write is denied, and reports a failure of both", async () => {
        const denied = new Error("NotAllowedError");
        setClipboard({ write: vi.fn(async () => { throw denied; }) });
        stubClipboardItem();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const copyHtmlToClipboard = vi.spyOn(utils, "copyHtmlToClipboard").mockReturnValue(false);

        expect(await copyHtml("<b>x</b>", "x")).toBe(false);
        expect(warn).toHaveBeenCalledWith(denied);
        expect(copyHtmlToClipboard).toHaveBeenCalledWith("<b>x</b>", "x");
    });
});

describe("copyHtmlWithToast", () => {
    it("copies through the copy event, defaults the plain text to the HTML, and reports success", async () => {
        // No `navigator.clipboard` at all: the API is undefined outside secure contexts, which is
        // how Trilium is usually served over a LAN (#10723).
        setClipboard(undefined);
        const copyHtmlToClipboard = vi.spyOn(utils, "copyHtmlToClipboard").mockReturnValue(true);
        const showMessage = vi.spyOn(toast, "showMessage").mockImplementation(() => {});
        const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});

        await copyHtmlWithToast("<b>x</b>");
        expect(copyHtmlToClipboard).toHaveBeenCalledWith("<b>x</b>", "<b>x</b>");

        await copyHtmlWithToast("<a href=\"#root/abc\">Note</a>", "#root/abc");
        expect(copyHtmlToClipboard).toHaveBeenLastCalledWith("<a href=\"#root/abc\">Note</a>", "#root/abc");

        expect(showMessage).toHaveBeenCalledTimes(2);
        expect(showError).not.toHaveBeenCalled();
    });

    it("shows an error message when the copy fails", async () => {
        setClipboard(undefined);
        vi.spyOn(utils, "copyHtmlToClipboard").mockReturnValue(false);
        const showMessage = vi.spyOn(toast, "showMessage").mockImplementation(() => {});
        const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});

        await copyHtmlWithToast("<b>x</b>");

        expect(showError).toHaveBeenCalledTimes(1);
        expect(showMessage).not.toHaveBeenCalled();
    });
});
