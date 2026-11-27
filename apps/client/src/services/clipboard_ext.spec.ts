import type { ElectronApi } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./i18n.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./i18n.js")>()),
    t: (key: string) => key
}));

import toast, { type ToastOptions } from "./toast.js";
import utils from "./utils.js";
import { buildNote } from "../test/easy-froca";
import {
    canReadClipboardText, type CopiedContent, copyHtml, copyHtmlWithToast,
    copyReferenceWithToast, copyText, copyTextWithToast, copyWhenReady, readClipboardText
} from "./clipboard_ext.js";

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

function setClipboard(value: unknown) {
    Object.defineProperty(navigator, "clipboard", {
        value,
        configurable: true,
        writable: true
    });
}

/** Installs the `ClipboardItem` constructor that the asynchronous Clipboard API needs. */
function stubClipboardItem() {
    (globalThis as any).ClipboardItem = class {
        constructor(public readonly data: Record<string, unknown>) {}
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).ClipboardItem;
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

    it("keeps the fallback textarea inside an open modal that traps focus", () => {
        setClipboard(undefined);

        document.body.innerHTML = `
            <input class="quick-search">
            <div class="modal show" tabindex="-1"><input class="first"><button class="copy">Copy</button></div>`;
        const modal = document.querySelector<HTMLElement>(".modal");
        const first = document.querySelector<HTMLInputElement>(".first");
        const button = document.querySelector<HTMLButtonElement>(".copy");
        if (!modal || !first || !button) throw new Error("fixture missing");
        // Bootstrap's `FocusTrap` pulls focus that lands outside the modal back into it.
        const trap = (e: FocusEvent) => {
            if (!modal.contains(e.target as Node)) {
                first.focus();
            }
        };
        document.addEventListener("focusin", trap);
        button.focus();

        let copiedValue: string | undefined;
        (document as unknown as { execCommand: () => boolean }).execCommand = () => {
            const active = document.activeElement;
            copiedValue = active instanceof HTMLTextAreaElement ? active.value : undefined;
            return true;
        };

        try {
            expect(copyText("in-modal")).toBe(true);
        } finally {
            document.removeEventListener("focusin", trap);
        }
        expect(copiedValue).toBe("in-modal");
        expect(document.querySelector("textarea")).toBeNull();
        expect(document.activeElement).toBe(button);
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

    it("shows a success message when the copy succeeds", async () => {
        setClipboard({ writeText: vi.fn() });
        const showMessage = vi.spyOn(toast, "showMessage").mockImplementation(() => {});
        const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});

        await copyTextWithToast("yay");

        expect(showMessage).toHaveBeenCalledTimes(1);
        expect(showError).not.toHaveBeenCalled();
    });

    it("shows an error message when the copy fails", async () => {
        setClipboard(undefined);
        (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
        const showMessage = vi.spyOn(toast, "showMessage").mockImplementation(() => {});
        const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});

        await copyTextWithToast("nope");

        expect(showError).toHaveBeenCalledTimes(1);
        expect(showMessage).not.toHaveBeenCalled();
    });

    it("waits for the write, and tries the text area when the browser refuses it", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        setClipboard({ writeText: vi.fn(async () => { throw new Error("NotAllowedError"); }) });
        const execCommand = vi.fn(() => false);
        (document as unknown as { execCommand: typeof execCommand }).execCommand = execCommand;
        const showMessage = vi.spyOn(toast, "showMessage").mockImplementation(() => {});
        const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});

        await copyTextWithToast("refused");
        expect(execCommand).toHaveBeenCalledWith("copy");
        expect(showError).toHaveBeenCalledExactlyOnceWith("clipboard.copy_failed");
        expect(showMessage).not.toHaveBeenCalled();

        execCommand.mockReturnValue(true);
        await copyTextWithToast("refused");
        expect(showMessage).toHaveBeenCalledExactlyOnceWith("clipboard.copy_success");
    });
});

describe("copyWhenReady", () => {
    /** A promise of `CopiedContent` that the test resolves or rejects. */
    function deferred() {
        let resolve: (value: CopiedContent | null) => void = () => {};
        let reject: (reason: unknown) => void = () => {};
        const promise = new Promise<CopiedContent | null>((onResolve, onReject) => {
            resolve = onResolve;
            reject = onReject;
        });
        return { promise, resolve, reject };
    }

    /** A clipboard whose `write()` reads every value of its item, as a browser does. */
    function stubReadingClipboard() {
        const write = vi.fn(async (items: { data: Record<string, Promise<Blob>> }[]) => {
            await Promise.all(Object.values(items[0].data));
        });
        setClipboard({ write });
        stubClipboardItem();
        return write;
    }

    function spyOnToasts() {
        return {
            showMessage: vi.spyOn(toast, "showMessage").mockImplementation(() => {}),
            showError: vi.spyOn(toast, "showError").mockImplementation(() => {}),
            showPersistent: vi.spyOn(toast, "showPersistent").mockImplementation(() => {})
        };
    }

    /** Runs `action` and returns the rejections that nothing handled meanwhile. */
    async function collectUnhandledRejections(action: () => Promise<void>) {
        const rejections: unknown[] = [];
        const onRejection = (reason: unknown) => rejections.push(reason);
        process.on("unhandledRejection", onRejection);
        try {
            await action();
            await new Promise((resolve) => setTimeout(resolve, 10));
        } finally {
            process.off("unhandledRejection", onRejection);
        }
        return rejections;
    }

    /** The button of the toast that `showPersistent` showed. */
    function getReadyButton(showPersistent: ReturnType<typeof spyOnToasts>["showPersistent"]) {
        const options = showPersistent.mock.calls[0]?.[0] as ToastOptions | undefined;
        expect(options?.message).toBe("clipboard.copy_ready");
        const button = options?.buttons?.[0];
        expect(button?.text).toBe("clipboard.copy_button");
        return button;
    }

    it("starts the write before the content resolves, with HTML only when asked", async () => {
        const write = stubReadingClipboard();
        const toasts = spyOnToasts();
        const content = deferred();

        const copied = copyWhenReady(content.promise, { isHtml: true });
        expect(write).toHaveBeenCalledTimes(1);
        const data = write.mock.calls[0][0][0].data;
        expect(Object.keys(data).sort()).toStrictEqual([ "text/html", "text/plain" ]);
        content.resolve({ html: "<a>Link</a>", text: "#root/a" });
        await copied;
        expect(await (await data["text/html"]).text()).toBe("<a>Link</a>");
        expect(await (await data["text/plain"]).text()).toBe("#root/a");
        expect(toasts.showMessage).toHaveBeenCalledExactlyOnceWith("clipboard.copy_success");

        await copyWhenReady(Promise.resolve({ text: "https://example.com" }), { isHtml: false });
        expect(Object.keys(write.mock.calls[1][0][0].data)).toStrictEqual([ "text/plain" ]);
        expect(toasts.showError).not.toHaveBeenCalled();
    });

    it("rejects the promised data for no content, and shows nothing of its own", async () => {
        stubReadingClipboard();
        const toasts = spyOnToasts();

        const rejections = await collectUnhandledRejections(() =>
            copyWhenReady(Promise.resolve(null), { isHtml: true }));
        expect(rejections).toStrictEqual([]);
        expect(toasts.showMessage).not.toHaveBeenCalled();
        expect(toasts.showError).not.toHaveBeenCalled();
        expect(toasts.showPersistent).not.toHaveBeenCalled();
    });

    it("leaves no rejection unhandled when a refused write precedes a failed lookup", async () => {
        const toasts = spyOnToasts();
        const refusingWrite = vi.fn(async () => { throw new Error("NotAllowedError"); });
        setClipboard({ write: refusingWrite });
        stubClipboardItem();
        const lookup = deferred();

        const rejections = await collectUnhandledRejections(async () => {
            const copied = copyWhenReady(lookup.promise, { isHtml: true });
            await new Promise((resolve) => setTimeout(resolve, 0));
            toast.showError("lookup failed");
            lookup.resolve(null);
            await copied;
        });
        expect(refusingWrite).toHaveBeenCalledTimes(1);

        // A constructor that throws is refused the same way.
        (globalThis as any).ClipboardItem = class {
            constructor() {
                throw new TypeError("Promises are not supported.");
            }
        };
        const secondLookup = deferred();
        rejections.push(...await collectUnhandledRejections(async () => {
            const copied = copyWhenReady(secondLookup.promise, { isHtml: false });
            await new Promise((resolve) => setTimeout(resolve, 0));
            secondLookup.resolve(null);
            await copied;
        }));

        expect(rejections).toStrictEqual([]);
        expect(toasts.showError).toHaveBeenCalledExactlyOnceWith("lookup failed");
        expect(toasts.showPersistent).not.toHaveBeenCalled();
        expect(toasts.showMessage).not.toHaveBeenCalled();
    });

    it("reports an exception in the content as a failed reference", async () => {
        stubReadingClipboard();
        vi.spyOn(console, "error").mockImplementation(() => {});
        const toasts = spyOnToasts();

        await copyWhenReady(Promise.reject(new Error("defect")), { isHtml: true });
        expect(toasts.showError).toHaveBeenCalledExactlyOnceWith("block_reference.copy_failed");
        expect(toasts.showPersistent).not.toHaveBeenCalled();
    });

    it("offers the ready content in a toast when the write is refused", async () => {
        setClipboard({ write: vi.fn(async () => { throw new Error("NotAllowedError"); }) });
        stubClipboardItem();
        const toasts = spyOnToasts();
        const copyHtmlToClipboard = vi.spyOn(utils, "copyHtmlToClipboard").mockReturnValue(true);

        await copyWhenReady(Promise.resolve({ html: "<a>Link</a>", text: "#a" }), { isHtml: true });
        expect(copyHtmlToClipboard).not.toHaveBeenCalled();
        expect(toasts.showMessage).not.toHaveBeenCalled();
        const button = getReadyButton(toasts.showPersistent);

        const dismissToast = vi.fn();
        button?.onClick({ dismissToast });
        expect(copyHtmlToClipboard).toHaveBeenCalledExactlyOnceWith("<a>Link</a>", "#a");
        expect(toasts.showMessage).toHaveBeenCalledExactlyOnceWith("clipboard.copy_success");
        expect(dismissToast).toHaveBeenCalledTimes(1);

        copyHtmlToClipboard.mockReturnValue(false);
        button?.onClick({ dismissToast });
        expect(toasts.showError).toHaveBeenCalledExactlyOnceWith("clipboard.copy_failed");
        expect(dismissToast).toHaveBeenCalledTimes(2);
    });

    it("copies through the copy command without the asynchronous API", async () => {
        setClipboard(undefined);
        const toasts = spyOnToasts();
        const copyHtmlToClipboard = vi.spyOn(utils, "copyHtmlToClipboard").mockReturnValue(true);

        await copyWhenReady(Promise.resolve({ html: "<a>Link</a>", text: "#a" }), { isHtml: true });
        expect(copyHtmlToClipboard).toHaveBeenCalledExactlyOnceWith("<a>Link</a>", "#a");
        expect(toasts.showMessage).toHaveBeenCalledExactlyOnceWith("clipboard.copy_success");

        // A plain text copy goes through the text area, and a failed one offers the button.
        const execCommand = vi.fn(() => false);
        (document as unknown as { execCommand: typeof execCommand }).execCommand = execCommand;
        await copyWhenReady(Promise.resolve({ text: "https://example.com" }), { isHtml: false });
        expect(execCommand).toHaveBeenCalledWith("copy");
        const button = getReadyButton(toasts.showPersistent);
        execCommand.mockReturnValue(true);
        button?.onClick({ dismissToast: vi.fn() });
        expect(toasts.showMessage).toHaveBeenCalledTimes(2);
    });
});

describe("copyHtml", () => {
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

describe("copyReferenceWithToast", () => {
    it("copies a reference link drawn from what the href points at", async () => {
        setClipboard(undefined);
        const copyHtmlToClipboard = vi.spyOn(utils, "copyHtmlToClipboard").mockReturnValue(true);
        const showMessage = vi.spyOn(toast, "showMessage").mockImplementation(() => {});
        const board = buildNote({ title: "Board" });
        const href = `#root/${board.noteId}?column=colTodo00001&columnTitle=To%20Do`;

        await copyReferenceWithToast(href);

        const [ html, plainText ] = copyHtmlToClipboard.mock.calls[0];
        // The editor keeps only the class and the href, and draws the rest from the href itself,
        // so the markup is read back the way a paste parses it.
        const parsed = document.createElement("div");
        parsed.innerHTML = html;
        const $anchor = parsed.querySelector("a.reference-link");
        expect($anchor?.getAttribute("href")).toBe(href);
        expect($anchor?.textContent).toContain("Board");
        // What a Markdown or code note pastes, where the rich flavour is of no use.
        expect(plainText).toBe(href);
        expect(showMessage).toHaveBeenCalledTimes(1);
    });

    it("starts the write before the label of the link is loaded", async () => {
        const write = vi.fn(async (items: { data: Record<string, Promise<Blob>> }[]) => {
            await Promise.all(Object.values(items[0].data));
        });
        setClipboard({ write });
        stubClipboardItem();
        vi.spyOn(toast, "showMessage").mockImplementation(() => {});
        const board = buildNote({ title: "Board" });
        const href = `#root/${board.noteId}`;

        const copied = copyReferenceWithToast(href);
        expect(write).toHaveBeenCalledTimes(1);
        await copied;
        const html = await (await write.mock.calls[0][0][0].data["text/html"]).text();
        expect(html).toContain("Board");
        expect(html).toContain(`href="${href}"`);
    });
});

describe("reading the clipboard text", () => {
    const originalPermissions = Object.getOwnPropertyDescriptor(navigator, "permissions");

    function setPermissionQuery(query: (descriptor: PermissionDescriptor) => Promise<unknown>) {
        Object.defineProperty(navigator, "permissions", {
            value: { query },
            configurable: true,
            writable: true
        });
    }

    afterEach(() => {
        delete window.electronApi;
        if (originalPermissions) {
            Object.defineProperty(navigator, "permissions", originalPermissions);
        }
    });

    it("can read on desktop, and in a browser only through navigator.clipboard.readText()", async () => {
        setPermissionQuery(async () => ({ state: "granted" }));
        setClipboard(undefined);
        expect(await canReadClipboardText()).toBe(false);
        setClipboard({ writeText: vi.fn() });
        expect(await canReadClipboardText()).toBe(false);

        window.electronApi = {} as unknown as ElectronApi;
        expect(await canReadClipboardText()).toBe(true);
    });

    it("follows the clipboard-read permission where the browser knows it", async () => {
        setClipboard({ readText: vi.fn() });
        const query = vi.fn(async (_descriptor: PermissionDescriptor) => ({ state: "denied" }));
        setPermissionQuery(query);
        expect(await canReadClipboardText()).toBe(false);
        expect(query).toHaveBeenCalledExactlyOnceWith({ name: "clipboard-read" });

        query.mockResolvedValue({ state: "prompt" });
        expect(await canReadClipboardText()).toBe(true);
        query.mockRejectedValue(new TypeError("'clipboard-read' is not a valid PermissionName"));
        expect(await canReadClipboardText()).toBe(true);
    });

    it("reads through the main process on desktop, and navigator.clipboard elsewhere", async () => {
        setClipboard({ readText: vi.fn(async () => "from the browser") });
        expect(await readClipboardText()).toBe("from the browser");

        const readText = vi.fn(async () => "from the main process");
        window.electronApi = { clipboard: { readText } } as unknown as ElectronApi;
        expect(await readClipboardText()).toBe("from the main process");
    });
});
