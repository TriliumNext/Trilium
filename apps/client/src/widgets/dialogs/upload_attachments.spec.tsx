import { OptionNames } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { flush, renderComponent, resetFroca } from "../../test/render";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Modal {
        static instances = new Map<Element, Modal>();
        static getOrCreateInstance(el: Element) {
            let inst = Modal.instances.get(el);
            if (!inst) {
                inst = new Modal(el);
                Modal.instances.set(el, inst);
            }
            return inst;
        }
        static getInstance(el: Element) { return Modal.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; }
        show() {}
        hide() {}
        dispose() { Modal.instances.delete(this.element); }
    }
    // FormCheckbox creates a Tooltip per hint; hooks.tsx patches Tooltip.prototype.dispose at import.
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getOrCreateInstance(el: Element) {
            let inst = Tooltip.instances.get(el);
            if (!inst) {
                inst = new Tooltip(el);
                Tooltip.instances.set(el, inst);
            }
            return inst;
        }
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    return { Modal, Tooltip, default: { Modal, Tooltip } };
});

// The Modal component's effect calls openDialog (jQuery + bootstrap). Stub the dialog service so it
// resolves with a fake jQuery widget and never touches real bootstrap focus/keyboard machinery.
vi.mock("../../services/dialog", () => ({
    openDialog: vi.fn(async ($el: unknown) => $el),
    closeActiveDialog: vi.fn()
}));

// upload_attachments.tsx submits through importService.uploadFiles; stub it so nothing touches
// $.ajax / the WS subscriber that the real module registers at import time.
vi.mock("../../services/import.js", () => ({
    default: { uploadFiles: vi.fn(async () => undefined) }
}));

import type Component from "../../components/component";
import importService from "../../services/import.js";
import options from "../../services/options";
import tree from "../../services/tree";
import UploadAttachmentsDialog from "./upload_attachments";

// --- Render harness -------------------------------------------------------------------------------

function renderDialog() {
    const { container, parent } = renderComponent(<UploadAttachmentsDialog />);
    return { el: container, parent };
}

function fireShowDialog(parent: Component, data: unknown) {
    act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (parent.handleEventInChildren as any)("showUploadAttachmentsDialog", data);
    });
}

/** Attach a FileList to the file input and fire its change event (happy-dom forbids assigning .files). */
function selectFiles(el: HTMLElement, fileNames: string[]) {
    const input = el.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();
    if (!input) return;
    const files = fileNames.map((name) => new File([ "x" ], name, { type: "text/plain" }));
    const fileList: Record<string | number, unknown> = {
        length: files.length,
        item: (i: number) => files[i] ?? null
    };
    files.forEach((file, i) => { fileList[i] = file; });
    Object.defineProperty(input, "files", { configurable: true, value: fileList as unknown as FileList });
    act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });
}

function footerButton(el: HTMLElement) {
    return el.querySelector<HTMLButtonElement>(".modal-footer button");
}

function uploadMock() {
    return importService.uploadFiles as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
    resetFroca();
    options.load({ compressImages: "true" } as Record<OptionNames, string>);
    vi.clearAllMocks();
    vi.spyOn(tree, "getNoteTitle").mockResolvedValue("Target Note");
});

// --- Tests ----------------------------------------------------------------------------------------

describe("UploadAttachmentsDialog", () => {
    it("renders the modal shell but no body until an event arrives", () => {
        const { el } = renderDialog();
        expect(el.querySelector(".upload-attachments-dialog")).toBeTruthy();
        // Body (and its checkbox / file upload) only mount once the modal is shown.
        expect(el.querySelector(".modal-dialog")).toBeNull();
        expect(el.querySelector('input[type="file"]')).toBeNull();
    });

    it("opens on the event, resolving the note title and mounting the form", async () => {
        const { el, parent } = renderDialog();
        fireShowDialog(parent, { noteId: "noteAbc" });
        await flush();

        // The useEffect resolves the parent note title (which feeds the FormGroup description).
        expect(tree.getNoteTitle).toHaveBeenCalledWith("noteAbc");
        expect(el.querySelector(".modal-dialog")).toBeTruthy();
        // The file upload and the single shrink-images checkbox are present.
        expect(el.querySelector('input[type="file"]')).toBeTruthy();
        expect(el.querySelectorAll('input[type="checkbox"]').length).toBe(1);
        // Submit button starts disabled because no files are selected yet.
        expect(footerButton(el)?.disabled).toBe(true);
    });

    it("enables the submit button once files are selected", async () => {
        const { el, parent } = renderDialog();
        fireShowDialog(parent, { noteId: "noteFile" });
        await flush();
        expect(footerButton(el)?.disabled).toBe(true);

        selectFiles(el, [ "a.txt" ]);
        expect(footerButton(el)?.disabled).toBe(false);
    });

    it("submits selected files via importService to the attachments entity type", async () => {
        const { el, parent } = renderDialog();
        fireShowDialog(parent, { noteId: "noteSubmit" });
        await flush();
        selectFiles(el, [ "one.txt", "two.txt" ]);

        const form = el.querySelector("form");
        expect(form).toBeTruthy();
        await act(async () => { form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
        await flush();

        expect(uploadMock()).toHaveBeenCalledTimes(1);
        const [ entityType, parentNoteId, files, opts ] = uploadMock().mock.calls[0];
        expect(entityType).toBe("attachments");
        expect(parentNoteId).toBe("noteSubmit");
        expect(Array.isArray(files)).toBe(true);
        expect(files).toHaveLength(2);
        // shrinkImages is initialised from compressImages ("true").
        expect(opts).toEqual({ shrinkImages: true });
        // Submitting hides the modal → body unmounts.
        expect(el.querySelector(".modal-dialog")).toBeNull();
    });

    it("reflects the toggled shrink-images checkbox in the upload options", async () => {
        const { el, parent } = renderDialog();
        fireShowDialog(parent, { noteId: "noteToggle" });
        await flush();
        selectFiles(el, [ "f.png" ]);

        const cb = el.querySelector<HTMLInputElement>('input[type="checkbox"]');
        expect(cb?.checked).toBe(true);
        if (cb) {
            cb.checked = false;
            act(() => { cb.dispatchEvent(new Event("change", { bubbles: true })); });
        }

        const form = el.querySelector("form");
        await act(async () => { form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
        await flush();

        const opts = uploadMock().mock.calls[0][3];
        expect(opts.shrinkImages).toBe(false);
    });

    it("does not upload when submitting without selected files (early return)", async () => {
        const { el, parent } = renderDialog();
        fireShowDialog(parent, { noteId: "noteEmpty" });
        await flush();

        const form = el.querySelector("form");
        expect(form).toBeTruthy();
        await act(async () => { form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
        await flush();

        expect(uploadMock()).not.toHaveBeenCalled();
        // The modal stays open since the submit short-circuited before setShown(false).
        expect(el.querySelector(".modal-dialog")).toBeTruthy();
    });

    it("resets show and files on the bootstrap hidden event (onHidden)", async () => {
        const { el, parent } = renderDialog();
        fireShowDialog(parent, { noteId: "noteHidden" });
        await flush();
        selectFiles(el, [ "x.txt" ]);
        expect(footerButton(el)?.disabled).toBe(false);

        const modalEl = el.querySelector(".upload-attachments-dialog");
        act(() => { modalEl?.dispatchEvent(new Event("hidden.bs.modal", { bubbles: false })); });
        // Body unmounts (show=false) and files were cleared.
        expect(el.querySelector(".modal-dialog")).toBeNull();

        // Re-opening shows a fresh form with the submit button disabled again (files reset to null).
        fireShowDialog(parent, { noteId: "noteHidden" });
        await flush();
        expect(footerButton(el)?.disabled).toBe(true);
    });

    it("initialises shrink-images from compressImages being off", async () => {
        options.load({ compressImages: "false" } as Record<OptionNames, string>);
        const { el, parent } = renderDialog();
        fireShowDialog(parent, { noteId: "noteNoCompress" });
        await flush();
        selectFiles(el, [ "img.png" ]);

        const cb = el.querySelector<HTMLInputElement>('input[type="checkbox"]');
        // shrinkImages state is initialised from compressImages (false here).
        expect(cb?.checked).toBe(false);

        const form = el.querySelector("form");
        await act(async () => { form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
        await flush();

        const opts = uploadMock().mock.calls[0][3];
        expect(opts.shrinkImages).toBe(false);
    });
});
