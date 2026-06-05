import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    // hooks.tsx patches Tooltip.prototype.dispose at import time, so it must be present.
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
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

// Capture the message subscriber registered at module-import time so we can drive the WS callback.
// `vi.hoisted` makes the array available to the hoisted vi.mock factory below.
const { wsSubscribers } = vi.hoisted(() => ({ wsSubscribers: [] as ((message: unknown) => void)[] }));
vi.mock("../../services/ws", () => ({
    default: {
        subscribeToMessages: (cb: (message: unknown) => void) => { wsSubscribers.push(cb); },
        logError: vi.fn()
    }
}));

// Stub the download mechanism so submitting never touches window.location / electron.
vi.mock("../../services/open", () => ({
    default: {
        getUrlForDownload: vi.fn((url: string) => url),
        download: vi.fn()
    }
}));

vi.mock("../../services/toast", () => ({
    default: {
        showPersistent: vi.fn(),
        closePersistent: vi.fn(),
        showError: vi.fn()
    }
}));

import Component from "../../components/component";
import froca from "../../services/froca";
import open from "../../services/open";
import toast from "../../services/toast";
import tree from "../../services/tree";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import ExportDialog from "./export";

// --- Render harness -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component;

function renderDialog() {
    parent = new Component();
    const el = document.createElement("div");
    container = el;
    document.body.appendChild(el);
    act(() => {
        render(
            <ParentComponent.Provider value={parent}>
                <ExportDialog />
            </ParentComponent.Provider>,
            el
        );
    });
    return el;
}

function fireShowExportDialog(data: unknown) {
    act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (parent.handleEventInChildren as any)("showExportDialog", data);
    });
}

async function flush() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function clearFroca() {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
}

/** Build a parent/child pair so froca.getBranchId resolves a real branch id without server load. */
function buildBranch(parentId: string, childId: string) {
    buildNote({ id: parentId, title: parentId, children: [ { id: childId, title: childId } ] });
    return `${parentId}_${childId}`;
}

beforeEach(() => {
    clearFroca();
    // Note: do NOT clear `wsSubscribers` — the component registers its subscriber once at module
    // import time, so resetting the array would permanently drop it for later tests.
    vi.clearAllMocks();
});

afterEach(() => {
    if (container) {
        act(() => { render(null, container as HTMLDivElement); });
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("ExportDialog", () => {
    it("renders the modal shell but no body until an event arrives", () => {
        const el = renderDialog();
        expect(el.querySelector(".export-dialog")).toBeTruthy();
        // Body (and its radio groups) only mount once the modal is shown.
        expect(el.querySelector(".modal-dialog")).toBeNull();
        expect(el.querySelector(".export-button")).toBeNull();
    });

    it("opens on showExportDialog, defaulting to the subtree format choices", async () => {
        buildBranch("parA", "childA");

        const el = renderDialog();
        fireShowExportDialog({ notePath: "parA/childA" });
        await flush();

        // Modal body is mounted with the subtree format chooser visible by default.
        expect(el.querySelector(".modal-dialog")).toBeTruthy();
        expect(el.querySelector(".export-subtree-formats")).toBeTruthy();
        // Default exportType is "subtree" → the single-format block is not rendered.
        expect(el.querySelector(".export-single-formats")).toBeNull();
        // OPML version chooser only appears when the subtree format is opml.
        expect(el.querySelector(".opml-versions")).toBeNull();
        // The export submit button lives in the footer.
        expect(el.querySelector(".export-button")).toBeTruthy();
        // Title reflects the note title (we assert it contains the resolved title, not the i18n text).
        expect(el.querySelector(".modal-title")?.textContent ?? "").toContain("childA");
    });

    it("ignores the event when the note path has no parentNoteId", async () => {
        const el = renderDialog();
        // getNoteIdAndParentIdFromUrl("") → {} (no ids), so early return; body stays unmounted.
        fireShowExportDialog({ notePath: "" });
        await flush();
        expect(el.querySelector(".modal-dialog")).toBeNull();
    });

    it("respects defaultType=single, showing the single-format chooser instead of subtree", async () => {
        buildBranch("parS", "childS");

        const el = renderDialog();
        fireShowExportDialog({ notePath: "parS/childS", defaultType: "single" });
        await flush();

        // The radio default lives in component state initialised from opts?.defaultType, but the
        // initial render uses "subtree"; selecting the single radio drives the single chooser.
        const singleRadio = el.querySelector<HTMLInputElement>('input[type="radio"][value="single"]');
        expect(singleRadio).toBeTruthy();
        if (singleRadio) {
            singleRadio.checked = true;
            act(() => { singleRadio.dispatchEvent(new Event("change", { bubbles: true })); });
        }
        expect(el.querySelector(".export-single-formats")).toBeTruthy();
        expect(el.querySelector(".export-subtree-formats")).toBeNull();
    });

    it("shows the OPML version chooser when the subtree format is set to opml", async () => {
        buildBranch("parO", "childO");

        const el = renderDialog();
        fireShowExportDialog({ notePath: "parO/childO" });
        await flush();

        const opmlRadio = el.querySelector<HTMLInputElement>('input[type="radio"][value="opml"]');
        expect(opmlRadio).toBeTruthy();
        if (opmlRadio) {
            opmlRadio.checked = true;
            act(() => { opmlRadio.dispatchEvent(new Event("change", { bubbles: true })); });
        }
        expect(el.querySelector(".opml-versions")).toBeTruthy();
        // Both OPML version radios are present.
        expect(el.querySelectorAll('.opml-versions input[type="radio"]').length).toBe(2);
    });

    it("submits a subtree HTML export, triggering the download and hiding the modal", async () => {
        const branchId = buildBranch("parE", "childE");

        const el = renderDialog();
        fireShowExportDialog({ notePath: "parE/childE" });
        await flush();

        const form = el.querySelector("form");
        expect(form).toBeTruthy();
        await act(async () => { form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
        await flush();

        // Default subtree + html + version 1.0 → exportBranch builds the download URL.
        expect(open.getUrlForDownload).toHaveBeenCalledTimes(1);
        const url = (open.getUrlForDownload as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(url).toContain(`api/branches/${branchId}/export/subtree/html/1.0/`);
        expect(open.download).toHaveBeenCalledTimes(1);
        // Submitting hides the modal → body unmounts.
        expect(el.querySelector(".modal-dialog")).toBeNull();
    });

    it("submits an OPML export with the chosen opml version in the URL", async () => {
        const branchId = buildBranch("parV", "childV");

        const el = renderDialog();
        fireShowExportDialog({ notePath: "parV/childV" });
        await flush();

        const opmlRadio = el.querySelector<HTMLInputElement>('input[type="radio"][value="opml"]');
        if (opmlRadio) {
            opmlRadio.checked = true;
            act(() => { opmlRadio.dispatchEvent(new Event("change", { bubbles: true })); });
        }
        // Pick OPML version 1.0 (default is 2.0).
        const v1 = el.querySelector<HTMLInputElement>('.opml-versions input[type="radio"][value="1.0"]');
        if (v1) {
            v1.checked = true;
            act(() => { v1.dispatchEvent(new Event("change", { bubbles: true })); });
        }

        const form = el.querySelector("form");
        await act(async () => { form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
        await flush();

        const url = (open.getUrlForDownload as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(url).toContain(`api/branches/${branchId}/export/subtree/opml/1.0/`);
    });

    it("submits a single-note markdown export (covers the singleFormat branch)", async () => {
        const branchId = buildBranch("parSm", "childSm");

        const el = renderDialog();
        fireShowExportDialog({ notePath: "parSm/childSm" });
        await flush();

        // Switch to single export, then pick the markdown single format.
        const singleRadio = el.querySelector<HTMLInputElement>('input[type="radio"][value="single"]');
        if (singleRadio) {
            singleRadio.checked = true;
            act(() => { singleRadio.dispatchEvent(new Event("change", { bubbles: true })); });
        }
        const md = el.querySelector<HTMLInputElement>('.export-single-formats input[type="radio"][value="markdown"]');
        if (md) {
            md.checked = true;
            act(() => { md.dispatchEvent(new Event("change", { bubbles: true })); });
        }

        const form = el.querySelector("form");
        await act(async () => { form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
        await flush();

        const url = (open.getUrlForDownload as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        // exportType === "single" → format comes from singleFormat, version stays 1.0.
        expect(url).toContain(`api/branches/${branchId}/export/single/markdown/1.0/`);
    });

    it("does not export when there is no resolvable branch id", async () => {
        // No froca note built for this path → froca.getBranchId returns null (logged), so opts.branchId
        // is null and onSubmit early-returns. Spy getBranchId to avoid a server load.
        vi.spyOn(froca, "getBranchId").mockResolvedValue(null);
        vi.spyOn(tree, "getNoteTitle").mockResolvedValue("Ghost");

        const el = renderDialog();
        fireShowExportDialog({ notePath: "ghostP/ghostC" });
        await flush();

        const form = el.querySelector("form");
        expect(form).toBeTruthy();
        await act(async () => { form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
        await flush();

        expect(open.getUrlForDownload).not.toHaveBeenCalled();
        expect(open.download).not.toHaveBeenCalled();
    });

    it("resets show on the bootstrap hidden event (onHidden)", async () => {
        buildBranch("parH", "childH");

        const el = renderDialog();
        fireShowExportDialog({ notePath: "parH/childH" });
        await flush();
        expect(el.querySelector(".modal-dialog")).toBeTruthy();

        const modalEl = el.querySelector(".export-dialog");
        act(() => { modalEl?.dispatchEvent(new Event("hidden.bs.modal", { bubbles: false })); });
        expect(el.querySelector(".modal-dialog")).toBeNull();
    });
});

// --- WebSocket export-status toasts (module-level subscribeToMessages callback) --------------------

describe("ExportDialog WS export-status handling", () => {
    // Several modules register WS subscribers at import time; only export.tsx's reacts to "export"
    // task messages. Dispatch to all of them so we exercise the export subscriber without guessing
    // its index.
    function dispatch(message: unknown) {
        expect(wsSubscribers.length).toBeGreaterThan(0);
        for (const cb of wsSubscribers) {
            cb(message);
        }
    }

    it("ignores non-export task messages", () => {
        dispatch({ type: "taskProgressCount", taskType: "import", taskId: "t1", progressCount: 1 });
        dispatch({ type: "log-info", message: "hi" });
        expect(toast.showPersistent).not.toHaveBeenCalled();
        expect(toast.showError).not.toHaveBeenCalled();
        expect(toast.closePersistent).not.toHaveBeenCalled();
    });

    it("shows a persistent progress toast on taskProgressCount", () => {
        dispatch({ type: "taskProgressCount", taskType: "export", taskId: "tp", progressCount: 7 });
        expect(toast.showPersistent).toHaveBeenCalledTimes(1);
        const opts = (toast.showPersistent as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(opts.id).toBe("tp");
        expect(opts.icon).toBe("export");
    });

    it("shows a success toast (with timeout) on taskSucceeded", () => {
        dispatch({ type: "taskSucceeded", taskType: "export", taskId: "ts", result: {} });
        expect(toast.showPersistent).toHaveBeenCalledTimes(1);
        const opts = (toast.showPersistent as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(opts.id).toBe("ts");
        expect(opts.timeout).toBe(5000);
    });

    it("closes the persistent toast and shows an error on taskError", () => {
        dispatch({ type: "taskError", taskType: "export", taskId: "te", message: "boom" });
        expect(toast.closePersistent).toHaveBeenCalledWith("te");
        expect(toast.showError).toHaveBeenCalledWith("boom");
    });

    it("does nothing for an export message whose type matches none of the handled cases", () => {
        // taskType is "export" (passes the guard) but the message type is unrecognized → falls through
        // all the else-if branches without invoking any toast method.
        dispatch({ type: "taskOpenedNote", taskType: "export", taskId: "tx" });
        expect(toast.showPersistent).not.toHaveBeenCalled();
        expect(toast.showError).not.toHaveBeenCalled();
        expect(toast.closePersistent).not.toHaveBeenCalled();
    });
});
