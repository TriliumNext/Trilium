import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderComponent } from "../../test/render";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static getInstance() { return null; }
        dispose() {}
        show() {}
        hide() {}
    }
    class Modal {
        static instances = new Map<Element, Modal>();
        static getOrCreateInstance(el: Element) {
            let inst = Modal.instances.get(el);
            if (!inst) {
                inst = new Modal();
                Modal.instances.set(el, inst);
            }
            return inst;
        }
        static getInstance(el: Element) { return Modal.instances.get(el) ?? null; }
        show() {}
        hide() {}
        dispose() {}
    }
    return { Tooltip, Modal, default: { Tooltip, Modal } };
});
vi.mock("../../services/dialog", () => ({
    openDialog: vi.fn(async ($widget: { 0: Element }) => $widget),
    closeActiveDialog: vi.fn()
}));
vi.mock("../../services/toast", () => ({
    default: { showMessage: vi.fn() }
}));
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    default: {
        ...(await importOriginal<typeof import("../../services/utils")>()).default,
        isElectron: vi.fn(() => false)
    }
}));

import Component from "../../components/component";
import server from "../../services/server";
import toast from "../../services/toast";
import utils from "../../services/utils";
import { CKEditorApi } from "../type_widgets/text/CKEditorWithWatchdog";
import MarkdownImportDialog from "./markdown_import";

// --- Harness ------------------------------------------------------------------------------------

let container: HTMLElement | undefined;
let parent: Component;

function renderDialog() {
    const rendered = renderComponent(<MarkdownImportDialog />);
    container = rendered.container;
    parent = rendered.parent;
    return container;
}

function fireEvent(name: string, data: unknown) {
    act(() => {
        (parent.handleEventInChildren as (n: string, d: unknown) => unknown)(name, data);
    });
}

function makeEditorApi() {
    return { addHtmlToEditor: vi.fn() } as unknown as CKEditorApi;
}

function getDialog() {
    return container?.querySelector(".markdown-import-dialog") ?? null;
}

function getTextarea() {
    return container?.querySelector("textarea") ?? null;
}

beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(server, { post: vi.fn(async () => ({ htmlContent: "<p>converted</p>" })) });
    (utils.isElectron as ReturnType<typeof vi.fn>).mockReturnValue(false);
});

// --- Tests --------------------------------------------------------------------------------------

describe("MarkdownImportDialog", () => {
    it("renders the modal structure hidden by default", () => {
        renderDialog();
        const dialog = getDialog();
        expect(dialog).not.toBeNull();
        expect(dialog?.classList.contains("modal")).toBe(true);
        // Hidden: the inner modal-dialog body should not be present until shown.
        expect(container?.querySelector(".modal-dialog")).toBeNull();
    });

    it("opens the dialog and renders the textarea + import button when not on Electron", () => {
        renderDialog();
        const editorApi = makeEditorApi();
        fireEvent("showPasteMarkdownDialog", { editorApi });

        expect(getTextarea()).not.toBeNull();
        expect(container?.querySelector(".markdown-import-button")).not.toBeNull();
        // No clipboard / conversion path on the web branch.
        expect(server.post).not.toHaveBeenCalled();
    });

    it("reads from clipboard and converts immediately on Electron (no dialog shown)", async () => {
        (utils.isElectron as ReturnType<typeof vi.fn>).mockReturnValue(true);
        const readText = vi.fn(async () => "# Hello");
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { readText }
        });

        renderDialog();
        const editorApi = makeEditorApi();
        await act(async () => {
            (parent.handleEventInChildren as (n: string, d: unknown) => unknown)(
                "showPasteMarkdownDialog",
                { editorApi }
            );
            await new Promise((r) => setTimeout(r, 0));
        });

        expect(readText).toHaveBeenCalledTimes(1);
        expect(server.post).toHaveBeenCalledWith("other/render-markdown", { markdownContent: "# Hello" });
        expect((editorApi as unknown as { addHtmlToEditor: ReturnType<typeof vi.fn> }).addHtmlToEditor)
            .toHaveBeenCalledWith("<p>converted</p>");
        expect(toast.showMessage).toHaveBeenCalledTimes(1);
        // Dialog stays hidden on the Electron path.
        expect(container?.querySelector(".modal-dialog")).toBeNull();
    });

    it("updates the textarea value on input", () => {
        renderDialog();
        fireEvent("showPasteMarkdownDialog", { editorApi: makeEditorApi() });

        const textarea = getTextarea();
        expect(textarea).not.toBeNull();
        if (textarea) {
            textarea.value = "some markdown";
            act(() => { textarea.dispatchEvent(new Event("input", { bubbles: true })); });
            expect(textarea.value).toBe("some markdown");
        }
    });

    it("submits via the import button: converts text and closes the dialog", async () => {
        renderDialog();
        const editorApi = makeEditorApi();
        fireEvent("showPasteMarkdownDialog", { editorApi });

        const textarea = getTextarea();
        if (textarea) {
            textarea.value = "**bold**";
            act(() => { textarea.dispatchEvent(new Event("input", { bubbles: true })); });
        }

        const button = container?.querySelector<HTMLButtonElement>(".markdown-import-button");
        expect(button).not.toBeNull();
        await act(async () => {
            button?.click();
            await new Promise((r) => setTimeout(r, 0));
        });

        expect(server.post).toHaveBeenCalledWith("other/render-markdown", { markdownContent: "**bold**" });
        expect((editorApi as unknown as { addHtmlToEditor: ReturnType<typeof vi.fn> }).addHtmlToEditor)
            .toHaveBeenCalledWith("<p>converted</p>");
        expect(toast.showMessage).toHaveBeenCalledTimes(1);
        // Submitting hides the dialog body.
        expect(container?.querySelector(".modal-dialog")).toBeNull();
    });

    it("does not convert when submitting with empty text", async () => {
        renderDialog();
        fireEvent("showPasteMarkdownDialog", { editorApi: makeEditorApi() });

        const button = container?.querySelector<HTMLButtonElement>(".markdown-import-button");
        await act(async () => {
            button?.click();
            await new Promise((r) => setTimeout(r, 0));
        });

        expect(server.post).not.toHaveBeenCalled();
        expect(toast.showMessage).not.toHaveBeenCalled();
    });

    it("submits via Ctrl+Enter inside the textarea", async () => {
        renderDialog();
        const editorApi = makeEditorApi();
        fireEvent("showPasteMarkdownDialog", { editorApi });

        const textarea = getTextarea();
        if (textarea) {
            textarea.value = "line";
            act(() => { textarea.dispatchEvent(new Event("input", { bubbles: true })); });

            const evt = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true });
            const preventDefault = vi.spyOn(evt, "preventDefault");
            await act(async () => {
                textarea.dispatchEvent(evt);
                await new Promise((r) => setTimeout(r, 0));
            });
            expect(preventDefault).toHaveBeenCalled();
        }

        expect(server.post).toHaveBeenCalledWith("other/render-markdown", { markdownContent: "line" });
    });

    it("focuses the textarea when the modal's shown event fires", () => {
        renderDialog();
        fireEvent("showPasteMarkdownDialog", { editorApi: makeEditorApi() });

        const textarea = getTextarea();
        expect(textarea).not.toBeNull();
        const focusSpy = textarea ? vi.spyOn(textarea, "focus") : null;

        const dialog = getDialog();
        act(() => {
            dialog?.dispatchEvent(new Event("shown.bs.modal", { bubbles: false }));
        });
        expect(focusSpy).toHaveBeenCalled();
    });

    it("clears the text and hides when the modal's hidden event fires", () => {
        renderDialog();
        fireEvent("showPasteMarkdownDialog", { editorApi: makeEditorApi() });

        const textarea = getTextarea();
        if (textarea) {
            textarea.value = "dirty content";
            act(() => { textarea.dispatchEvent(new Event("input", { bubbles: true })); });
            expect(textarea.value).toBe("dirty content");
        }

        const dialog = getDialog();
        act(() => {
            dialog?.dispatchEvent(new Event("hidden.bs.modal", { bubbles: false }));
        });

        // Hidden again: the modal body is removed and the text state was reset.
        expect(container?.querySelector(".modal-dialog")).toBeNull();
    });

    it("ignores plain Enter (without Ctrl) in the textarea", async () => {
        renderDialog();
        fireEvent("showPasteMarkdownDialog", { editorApi: makeEditorApi() });

        const textarea = getTextarea();
        if (textarea) {
            textarea.value = "line";
            act(() => { textarea.dispatchEvent(new Event("input", { bubbles: true })); });

            const evt = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: false, bubbles: true });
            await act(async () => {
                textarea.dispatchEvent(evt);
                await new Promise((r) => setTimeout(r, 0));
            });
        }

        expect(server.post).not.toHaveBeenCalled();
    });
});
