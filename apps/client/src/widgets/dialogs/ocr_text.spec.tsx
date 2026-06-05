import { OCRProcessResponse, TextRepresentationResponse } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Modal.tsx imports `Modal as BootstrapModal`; hooks.tsx (pulled in via Button -> ActionButton)
// patches Tooltip.prototype.dispose at import time, so Tooltip must be a real class.
vi.mock("bootstrap", () => {
    class Modal {
        static getOrCreateInstance() { return new Modal(); }
        static getInstance() { return null; }
        show() {}
        hide() {}
        dispose() {}
    }
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    class Dropdown {
        static getOrCreateInstance() { return new Dropdown(); }
        show() {}
        hide() {}
        toggle() {}
        dispose() {}
    }
    return { Modal, Tooltip, Dropdown, default: { Modal, Tooltip, Dropdown } };
});

// The Modal's effect calls openDialog($el) (real one touches bootstrap/jQuery focus); stub it.
vi.mock("../../services/dialog", () => ({
    default: {},
    openDialog: vi.fn(async ($el: unknown) => $el),
    closeActiveDialog: vi.fn()
}));

vi.mock("../../services/toast", () => ({
    default: {
        showMessage: vi.fn(),
        showError: vi.fn(),
        showPersistent: vi.fn(),
        closePersistent: vi.fn()
    }
}));

vi.mock("../../services/clipboard_ext", () => ({
    copyTextWithToast: vi.fn(),
    copyText: vi.fn()
}));

vi.mock("../../components/app_context", () => ({
    default: {
        triggerCommand: vi.fn(() => Promise.resolve()),
        tabManager: { openInNewTab: vi.fn() }
    }
}));

import appContext from "../../components/app_context";
import Component from "../../components/component";
import { copyTextWithToast } from "../../services/clipboard_ext";
import server from "../../services/server";
import toast from "../../services/toast";
import ws from "../../services/ws";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import OcrTextDialog from "./ocr_text";

const toastMock = vi.mocked(toast);
const copyTextWithToastMock = vi.mocked(copyTextWithToast);
const openInNewTabMock = vi.mocked(appContext.tabManager.openInNewTab);

// --- Render harness --------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component;

function renderDialog() {
    const root = document.createElement("div");
    container = root;
    document.body.appendChild(root);
    act(() => {
        render(
            <ParentComponent.Provider value={parent}>
                <NoteContextContext.Provider value={null}>
                    <OcrTextDialog />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>,
            root
        );
    });
    return root;
}

function fireShow(textUrl = "ocr/notes/n1/text", processUrl = "ocr/process-note/n1") {
    act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (parent.handleEventInChildren as any)("showOcrTextDialog", { textUrl, processUrl });
    });
}

async function flush() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

function setGet(impl: (url: string) => Promise<unknown>) {
    Object.assign(server, { get: vi.fn(impl) });
}

function setPost(impl: (url: string, data: unknown) => Promise<unknown>) {
    Object.assign(server, { post: vi.fn(impl) });
}

function modalEl() {
    return container?.querySelector(".modal.ocr-text-modal") ?? null;
}

beforeEach(() => {
    parent = new Component();
    vi.clearAllMocks();
    Object.assign(server, {
        get: vi.fn(async () => ({ success: true, hasOcr: false, text: "" })),
        post: vi.fn(async () => ({ success: true }))
    });
    Object.assign(ws, { logError: vi.fn() });
    // jQuery bootstrap plugins aren't loaded in the test env.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ($.fn as any).tooltip = function () { return this; };
});

afterEach(() => {
    if (container) {
        act(() => { render(null, container as HTMLDivElement); });
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- OcrTextDialog (the event-driven wrapper) -----------------------------------------------------

describe("OcrTextDialog wrapper", () => {
    it("renders nothing until the showOcrTextDialog event fires", async () => {
        const root = renderDialog();
        expect(root.querySelector(".modal")).toBeNull();

        setGet(async () => ({ success: true, hasOcr: false, text: "" }) as TextRepresentationResponse);
        fireShow();
        await flush();

        expect(modalEl()).not.toBeNull();
    });

    it("hides itself when the modal is dismissed (onHidden -> setShown(false))", async () => {
        setGet(async () => ({ success: true, hasOcr: false, text: "" }) as TextRepresentationResponse);
        renderDialog();
        fireShow();
        await flush();

        const modal = modalEl();
        expect(modal).not.toBeNull();

        // The Modal wires onHidden to the bootstrap "hidden.bs.modal" event on its root element.
        act(() => { modal?.dispatchEvent(new Event("hidden.bs.modal", { bubbles: true })); });
        await flush();

        expect(modalEl()).toBeNull();
    });
});

// --- Loading / loaded / empty / error states ------------------------------------------------------

describe("TextRepresentationModal states", () => {
    it("shows the loading state while the request is pending, then the loaded text", async () => {
        let resolveGet: ((value: TextRepresentationResponse) => void) | undefined;
        setGet(() => new Promise<TextRepresentationResponse>((res) => { resolveGet = res; }));

        renderDialog();
        fireShow();
        // No flush yet: the request is still pending.
        expect(container?.querySelector(".ocr-text-modal-loading")).not.toBeNull();
        // While loading there is no footer (footer is hidden during loading).
        expect(container?.querySelector(".modal-footer")).toBeNull();

        act(() => { resolveGet?.({ success: true, hasOcr: true, text: "Hello OCR" }); });
        await flush();

        const content = container?.querySelector(".ocr-text-modal-content");
        expect(content?.textContent).toBe("Hello OCR");
        // Loaded state shows two footer buttons (process + copy).
        expect(container?.querySelectorAll(".modal-footer button.btn").length).toBe(2);
    });

    it("renders the empty state when hasOcr is false", async () => {
        setGet(async () => ({ success: true, hasOcr: false, text: "" }) as TextRepresentationResponse);
        renderDialog();
        fireShow();
        await flush();

        expect(container?.querySelector(".ocr-text-modal-empty")).not.toBeNull();
        // Empty state has the process button but no copy button.
        expect(container?.querySelectorAll(".modal-footer button.btn").length).toBe(1);
    });

    it("renders the empty state when text is missing even if hasOcr is true", async () => {
        setGet(async () => ({ success: true, hasOcr: true, text: "" }) as TextRepresentationResponse);
        renderDialog();
        fireShow();
        await flush();

        expect(container?.querySelector(".ocr-text-modal-empty")).not.toBeNull();
    });

    it("renders the error state with the server-provided message when success is false", async () => {
        setGet(async () => ({ success: false, hasOcr: false, text: "", message: "Boom from server" }) as TextRepresentationResponse);
        renderDialog();
        fireShow();
        await flush();

        const err = container?.querySelector(".ocr-text-modal-error");
        expect(err).not.toBeNull();
        expect(err?.textContent).toContain("Boom from server");
    });

    it("falls back to a translated message when success is false without a message", async () => {
        setGet(async () => ({ success: false, hasOcr: false, text: "" }) as TextRepresentationResponse);
        renderDialog();
        fireShow();
        await flush();

        // The error state still renders; the fallback t() message branch is exercised even
        // though i18n returns an empty string in the test env.
        expect(container?.querySelector(".ocr-text-modal-error")).not.toBeNull();
        expect(container?.querySelector(".ocr-text-modal-error .bx-error")).not.toBeNull();
    });

    it("renders the error state when the request throws (uses error.message)", async () => {
        setGet(async () => { throw new Error("network down"); });
        renderDialog();
        fireShow();
        await flush();

        const err = container?.querySelector(".ocr-text-modal-error");
        expect(err?.textContent).toContain("network down");
    });

    it("renders the error state when the thrown error has no message", async () => {
        setGet(async () => { throw {}; });
        renderDialog();
        fireShow();
        await flush();

        expect(container?.querySelector(".ocr-text-modal-error")).not.toBeNull();
    });
});

// --- copyToClipboard ------------------------------------------------------------------------------

describe("copy to clipboard", () => {
    it("copies the loaded text when the copy button is clicked", async () => {
        setGet(async () => ({ success: true, hasOcr: true, text: "Copy me" }) as TextRepresentationResponse);
        renderDialog();
        fireShow();
        await flush();

        const buttons = Array.from(container?.querySelectorAll<HTMLButtonElement>(".modal-footer button.btn") ?? []);
        // Second button is the copy button (loaded state only).
        const copyButton = buttons[1];
        expect(copyButton).toBeDefined();
        act(() => { copyButton?.click(); });

        expect(copyTextWithToastMock).toHaveBeenCalledWith("Copy me");
    });
});

// --- processOCR branches --------------------------------------------------------------------------

describe("processOCR", () => {
    async function openLoaded(text = "loaded text") {
        setGet(async () => ({ success: true, hasOcr: true, text }) as TextRepresentationResponse);
        renderDialog();
        fireShow();
        await flush();
    }

    function processButton() {
        return container?.querySelector<HTMLButtonElement>(".modal-footer button.btn") ?? null;
    }

    it("shows the processing_complete toast and re-fetches when text is returned", async () => {
        await openLoaded();
        setPost(async () => ({ success: true, result: { text: "new", confidence: 0.9, extractedAt: "" } }) as OCRProcessResponse);
        setGet(async () => ({ success: true, hasOcr: true, text: "refetched" }) as TextRepresentationResponse);

        await act(async () => { processButton()?.click(); });

        expect(toastMock.showMessage).toHaveBeenCalledTimes(1);

        // The re-fetch is scheduled via setTimeout(fetchText, 500); wait it out, then settle.
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
        await flush();
        expect(container?.querySelector(".ocr-text-modal-content")?.textContent).toBe("refetched");
    });

    it("shows the image-based PDF toast when result has no text and is a pdf", async () => {
        await openLoaded();
        setPost(async () => ({
            success: true,
            result: { text: "", confidence: 0.5, extractedAt: "", processingType: "pdf" }
        }) as OCRProcessResponse);

        await act(async () => { processButton()?.click(); });

        expect(toastMock.showPersistent).toHaveBeenCalledTimes(1);
        const opts = toastMock.showPersistent.mock.calls[0]?.[0];
        expect(opts?.id).toMatch(/^ocr-pdf-unsupported-/);
        expect(toastMock.showMessage).not.toHaveBeenCalled();
    });

    it("shows the low-confidence toast with a button that opens media settings", async () => {
        await openLoaded();
        setPost(async () => ({
            success: true,
            minConfidence: 0.6,
            result: { text: "", confidence: 0.42, extractedAt: "", processingType: "image" }
        }) as OCRProcessResponse);

        await act(async () => { processButton()?.click(); });

        expect(toastMock.showPersistent).toHaveBeenCalledTimes(1);
        const opts = toastMock.showPersistent.mock.calls[0]?.[0];
        expect(opts?.id).toMatch(/^ocr-low-confidence-/);
        expect(Array.isArray(opts?.buttons)).toBe(true);

        // Invoke the toast button onClick to cover the openInNewTab + dismissToast path.
        const dismissToast = vi.fn();
        const button = opts?.buttons?.[0];
        button?.onClick({ dismissToast });
        expect(openInNewTabMock).toHaveBeenCalledWith("_optionsMedia", null, true);
        expect(dismissToast).toHaveBeenCalledTimes(1);
    });

    it("falls back to processing_complete when confidence is present but minConfidence is 0", async () => {
        await openLoaded();
        setPost(async () => ({
            success: true,
            minConfidence: 0,
            result: { text: "", confidence: 0.42, extractedAt: "", processingType: "image" }
        }) as OCRProcessResponse);

        await act(async () => { processButton()?.click(); });

        expect(toastMock.showMessage).toHaveBeenCalledTimes(1);
        expect(toastMock.showPersistent).not.toHaveBeenCalled();
    });

    it("shows an error toast when processing fails (success false) with provided message", async () => {
        await openLoaded();
        setPost(async () => ({ success: false, message: "could not process" }) as OCRProcessResponse);

        await act(async () => { processButton()?.click(); });

        expect(toastMock.showError).toHaveBeenCalledTimes(1);
        expect(toastMock.showError).toHaveBeenCalledWith("could not process");
    });

    it("shows a translated error toast when processing fails without a message", async () => {
        await openLoaded();
        setPost(async () => ({ success: false }) as OCRProcessResponse);

        await act(async () => { processButton()?.click(); });

        // The fallback t("ocr.processing_failed") branch runs; i18n returns "" in the test env.
        expect(toastMock.showError).toHaveBeenCalledTimes(1);
    });

    it("swallows server errors thrown during processing (no toast) and resets processing", async () => {
        await openLoaded();
        setPost(async () => { throw new Error("500"); });

        await act(async () => { processButton()?.click(); });

        // The catch branch is empty (server.ts already toasted); no error toast here.
        expect(toastMock.showError).not.toHaveBeenCalled();
        // Button is re-enabled after processing finishes.
        expect(processButton()?.disabled).toBe(false);
    });

    it("disables the process button while processing is in flight", async () => {
        await openLoaded();
        let resolvePost: ((value: OCRProcessResponse) => void) | undefined;
        setPost(() => new Promise<OCRProcessResponse>((res) => { resolvePost = res; }));

        act(() => { processButton()?.click(); });
        // Mid-flight: processing is true, button disabled.
        expect(processButton()?.disabled).toBe(true);

        await act(async () => { resolvePost?.({ success: true } as OCRProcessResponse); });
        expect(processButton()?.disabled).toBe(false);
    });
});
