// @vitest-environment happy-dom
/**
 * The viewer boot sequence and the save plumbing it installs, driven against a real
 * `PDFDocumentProxy` and pdf.js' real event bus. See {@link ./test/fixture_pdf}.
 *
 * `manageSave` is the reason this file exists: it decides when Trilium is told the document is
 * dirty, and most of that logic is heuristic — pdf.js gives no single reliable "annotation
 * changed" signal, so the save is nudged from pointer and keyboard activity as well.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyMinPixelRatio, configurePdfViewerOptions, hideSidebar, main, manageParentCommands, manageSave } from "./bootstrap";
import { setAnnotationEditorUIManager } from "./editing";
import { allFeaturesPdf } from "./test/fixture_pdf";
import { InstalledViewer, installViewerApp, uninstallViewerApp } from "./test/viewer_app";

let viewer: InstalledViewer;

beforeEach(() => {
    window.TRILIUM_NOTE_ID = "note-1";
    window.TRILIUM_NTX_ID = "ntx-1";
});

afterEach(() => {
    setAnnotationEditorUIManager(null);
    delete (globalThis as any).pdfjsLib;
    uninstallViewerApp();
});

/** Marks an annotation-editing tool as active, as pdf.js does while a tool is selected. */
function startEditing(mode = 15) {
    setAnnotationEditorUIManager({ getMode: () => mode, getActive: () => null, hasSelection: false, unselectAll: vi.fn() });
}

/** Adds the `.page` element pdf.js renders each page into, and returns a child of it. */
function renderPage() {
    const page = document.createElement("div");
    page.className = "page";
    const target = document.createElement("span");
    page.append(target);
    viewer.viewerEl.append(page);
    return target;
}

describe("boot sequence", () => {
    /** `main()` reads the viewer's configuration off the iframe URL Trilium builds. */
    function bootWith(query: string) {
        window.history.replaceState({}, "", `/web/viewer.html?${query}`);
        return main();
    }

    // Booting editable installs the localStorage interception, which patches the prototype
    // globally and has no uninstall; put the real methods back so it cannot leak sideways.
    const realGetItem = Storage.prototype.getItem;
    const realSetItem = Storage.prototype.setItem;

    afterEach(() => {
        Storage.prototype.getItem = realGetItem;
        Storage.prototype.setItem = realSetItem;
        window.history.replaceState({}, "", "/");
        document.body.className = "";
        delete window.TRILIUM_HIDE_SIDEBAR;
    });

    it("marks the document read-only and wires up nothing that can modify it", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        await bootWith("editable=0");

        expect(document.body.classList.contains("read-only-document")).toBe(true);

        viewer.eventBus.dispatch("documentloaded", { source: null });
        // Annotations are still listed — they are readable — but nothing that reports the
        // document as modified may be installed, or a read-only note would start saving.
        await vi.waitFor(() => expect(viewer.messagesOfType("pdfjs-viewer-annotations")).toHaveLength(1));
        (viewer.pdfDocument.annotationStorage as any).onSetModified?.();
        expect(viewer.messagesOfType("pdfjs-viewer-document-modified")).toHaveLength(0);
        expect(viewer.messagesOfType("pdfjs-viewer-toc")).toHaveLength(0);
    });

    it("brings up the full editable feature set once the document loads", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        await bootWith("editable=1");

        expect(document.body.classList.contains("read-only-document")).toBe(false);

        viewer.eventBus.dispatch("documentloaded", { source: null });

        // Each sidebar panel is fed by its own setup call; a missing one shows as an empty
        // panel rather than an error, so assert they all reported.
        for (const type of [
            "pdfjs-viewer-annotations",
            "pdfjs-viewer-toc",
            "pdfjs-viewer-page-info",
            "pdfjs-viewer-attachments",
            "pdfjs-viewer-layers"
        ]) {
            await vi.waitFor(() => expect(viewer.messagesOfType(type).length).toBeGreaterThan(0));
        }

        // And the save plumbing is live: dirtying the storage reaches the parent.
        (viewer.pdfDocument.annotationStorage as any).setValue("field-1", { value: "typed" });
        expect(viewer.messagesOfType("pdfjs-viewer-document-modified")).toHaveLength(1);
    });

    it("addresses every message to the viewer that sent it", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        await bootWith("editable=1");

        viewer.eventBus.dispatch("documentloaded", { source: null });
        await vi.waitFor(() => expect(viewer.messagesOfType("pdfjs-viewer-annotations").length).toBeGreaterThan(0));

        // Drive the senders that boot alone does not reach.
        viewer.eventBus.dispatch("pagechanging", { source: null, pageNumber: 2 });
        viewer.sendFromParent({ type: "trilium-request-thumbnail", pageNumber: 1 });
        (viewer.pdfDocument.annotationStorage as any).setValue("field-1", { value: "typed" });
        await vi.waitFor(() => expect(viewer.messagesOfType("pdfjs-viewer-current-page").length).toBeGreaterThan(0));

        // A second open PDF posts onto the same parent window, so what each message carries is the
        // only thing telling the two apart. One that says nothing is applied by whichever viewer
        // happens to receive it — listing one document's annotations against another's pages.
        expect(viewer.messages.length).toBeGreaterThan(0);
        for (const message of viewer.messages) {
            expect(message).toMatchObject({ type: expect.any(String), noteId: "note-1", ntxId: "ntx-1" });
        }
    });

    it("applies the toolbar and sidebar switches from the URL", async () => {
        document.body.innerHTML = `
            <div id="viewsManagerToggleButton"></div>
            <div class="other"></div>
            <div class="toolbarButtonSpacer"></div>`;
        viewer = await installViewerApp(allFeaturesPdf());

        await bootWith("editable=0&toolbar=0&sidebar=0");

        expect(document.body.classList.contains("no-toolbar")).toBe(true);
        expect(window.TRILIUM_HIDE_SIDEBAR).toBe(true);
    });

    it("waits for pdf.js to publish its application object before wiring anything", async () => {
        vi.useFakeTimers();
        // main() is loaded from a script tag that can run before viewer.mjs has created
        // PDFViewerApplication, so it polls rather than assuming it is there.
        const booted = vi.fn();
        const pending = main().then(booted);

        await vi.advanceTimersByTimeAsync(200);
        expect(booted).not.toHaveBeenCalled();

        viewer = await installViewerApp(allFeaturesPdf());
        await vi.advanceTimersByTimeAsync(100);
        await pending;

        expect(booted).toHaveBeenCalled();
        vi.useRealTimers();
    });

    it("adopts the editing manager pdf.js rebuilds for each document", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        await bootWith("editable=1");
        manageSave();

        // Until the manager is announced, input-driven saves cannot tell whether a tool is
        // active, so they stay silent.
        const target = renderPage();
        target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        window.dispatchEvent(new Event("pointerup"));
        expect(viewer.messagesOfType("pdfjs-viewer-document-modified")).toHaveLength(0);

        viewer.eventBus.dispatch("annotationeditoruimanager", {
            source: null,
            uiManager: { getMode: () => 15, getActive: () => null, unselectAll: vi.fn() }
        });

        target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        window.dispatchEvent(new Event("pointerup"));
        expect(viewer.messagesOfType("pdfjs-viewer-document-modified")).toHaveLength(1);
    });
});

describe("reporting the document as modified", () => {
    it("tells the parent on the signals pdf.js gives for a real change", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        const storage = viewer.pdfDocument.annotationStorage as any;
        const resetModified = vi.spyOn(storage, "resetModified");
        manageSave();

        // The primary hook: pdf.js dirties annotationStorage, as filling in a form field does.
        storage.setValue("field-1", { value: "typed" });
        // Deletions and undo/redo only surface here, and only when there is something to undo.
        // Left unconditional: the first stroke of an ink session flips hasSomethingToUndo while
        // the drawing is still outside annotationStorage, so there is nothing to compare against.
        viewer.eventBus.dispatch("editingstateschanged", { source: null, details: { hasSomethingToUndo: true } });

        expect(viewer.messagesOfType("pdfjs-viewer-document-modified")).toHaveLength(2);
        expect(viewer.lastMessageOfType("pdfjs-viewer-document-modified"))
            .toEqual({ type: "pdfjs-viewer-document-modified", noteId: "note-1", ntxId: "ntx-1" });
        // Without the reset pdf.js keeps reporting the same change on every later edit.
        expect(resetModified).toHaveBeenCalledTimes(2);
    });

    it("stays quiet while pdf.js registers the annotations already in the document", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        const storage = viewer.pdfDocument.annotationStorage as any;
        const resetModified = vi.spyOn(storage, "resetModified");
        manageSave();

        // Entering an editing mode turns every stored annotation on a rendered page into an
        // editor, and registering each one dirties annotationStorage. Nothing about the document
        // changed, so pressing a toolbar button — or scrolling another annotated page into view —
        // must not schedule a save, let alone one per annotation (#11059).
        storage.onSetModified();
        storage.onSetModified();

        expect(viewer.messagesOfType("pdfjs-viewer-document-modified")).toHaveLength(0);
        // The flag still has to be cleared, or pdf.js' one-shot would never raise the next
        // real change.
        expect(resetModified).toHaveBeenCalledTimes(2);

        // Which it does: an actual edit is still reported.
        storage.setValue("field-1", { value: "typed" });
        expect(viewer.messagesOfType("pdfjs-viewer-document-modified")).toHaveLength(1);
    });

    it("treats a document that cannot be serialized as unchanged, then catches up", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        const storage = viewer.pdfDocument.annotationStorage as any;
        // pdf.js stores an editor before it is finished: "Add signature" leaves one with no
        // outlines in annotationStorage until the dialog resolves, and serializing it throws.
        // That is a state pdf.js passes through, not a change to report — and not a reason to
        // let the throw out of the storage hook, or out of the setup, either.
        const serializable = vi.spyOn(storage, "serializable", "get").mockImplementation(() => {
            throw new Error("outlines are not set yet");
        });
        expect(() => manageSave()).not.toThrow();

        expect(() => storage.setValue("sig-1", { value: "pending" })).not.toThrow();
        viewer.eventBus.dispatch("switchannotationeditorparams", { source: null });
        expect(viewer.messagesOfType("pdfjs-viewer-document-modified")).toHaveLength(0);

        // The interaction nudges still report blind, and cope with the same state.
        startEditing();
        renderPage().dispatchEvent(new Event("keyup", { bubbles: true }));
        expect(viewer.messagesOfType("pdfjs-viewer-document-modified")).toHaveLength(1);

        // Once the editor is complete the document serializes again, and the change it made is
        // reported against the last hash that could be read — not swallowed.
        serializable.mockRestore();
        storage.setValue("sig-1", { value: "signed" });
        expect(viewer.messagesOfType("pdfjs-viewer-document-modified")).toHaveLength(2);
    });

    it("stays quiet when a tool's parameters leave the document alone", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        manageSave();

        // With nothing selected, the colour picker in a tool's parameter toolbar only sets what
        // the next annotation will be drawn in.
        viewer.eventBus.dispatch("switchannotationeditorparams", { source: null });

        expect(viewer.messagesOfType("pdfjs-viewer-document-modified")).toHaveLength(0);
    });

    it("reports a parameter change that does alter an annotation", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        const storage = viewer.pdfDocument.annotationStorage as any;
        manageSave();

        // Recolouring a selected annotation rewrites what the document serializes to, and this
        // event is the only notice of it — pdf.js updates the editor in place rather than going
        // back through onSetModified. Detaching the hook reproduces that: the content changes,
        // nothing else reports it.
        const hook = storage.onSetModified;
        storage.onSetModified = null;
        storage.setValue("18R", { value: "recoloured" });
        storage.onSetModified = hook;

        viewer.eventBus.dispatch("switchannotationeditorparams", { source: null });

        expect(viewer.messagesOfType("pdfjs-viewer-document-modified")).toHaveLength(1);
    });

    it("survives an editor pdf.js has stored before finishing it", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        const storage = viewer.pdfDocument.annotationStorage as any;
        manageSave();

        // Pressing "Add signature" adds a SignatureEditor to annotationStorage — its own
        // isEmpty() returns false unconditionally — while its outlines are still null, and only
        // fills them in when the signature dialog resolves. Serializing the document in between
        // throws out of the storage hook, from where it reaches the console uncaught.
        Object.defineProperty(storage, "serializable", {
            configurable: true,
            get() {
                throw new TypeError("can't access property \"serialize\", this[#drawOutlines] is null");
            }
        });
        expect(() => storage.onSetModified()).not.toThrow();
        expect(viewer.messagesOfType("pdfjs-viewer-document-modified")).toHaveLength(0);

        // The hash the failed read fell back to has to be the one from before, or the finished
        // signature would look unchanged and never be saved.
        delete storage.serializable;
        storage.setValue("field-1", { value: "typed" });
        expect(viewer.messagesOfType("pdfjs-viewer-document-modified")).toHaveLength(1);
    });

    it("stays quiet when the editing state changes with nothing to undo", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        manageSave();

        // Selecting an existing annotation raises this too; saving on it would mark the note
        // dirty just for a click.
        viewer.eventBus.dispatch("editingstateschanged", { source: null, details: { hasSomethingToUndo: false } });

        expect(viewer.messagesOfType("pdfjs-viewer-document-modified")).toHaveLength(0);
    });
});

describe("nudging the save from input activity", () => {
    it("reports a change when a stroke that began on a page ends", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        manageSave();
        startEditing();
        const target = renderPage();

        // Only the first stroke of an ink session flips hasSomethingToUndo; later strokes
        // accumulate in the uncommitted session, so the end of each one has to nudge the save.
        target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        window.dispatchEvent(new Event("pointerup"));

        expect(viewer.messagesOfType("pdfjs-viewer-document-modified")).toHaveLength(1);
    });

    it("still reports when a stroke starts on a page but ends outside it", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        manageSave();
        startEditing();
        const target = renderPage();

        // pdf.js tracks strokes window-wide, so drawing off the edge of the page is normal;
        // what matters is where the interaction began.
        target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        document.body.dispatchEvent(new Event("pointercancel", { bubbles: true }));

        expect(viewer.messagesOfType("pdfjs-viewer-document-modified")).toHaveLength(1);
    });

    it("ignores input while no annotation tool is active", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        manageSave();
        const target = renderPage();

        // Selecting text or scrolling must not mark the note dirty.
        target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        window.dispatchEvent(new Event("pointerup"));
        target.dispatchEvent(new Event("keyup", { bubbles: true }));

        expect(viewer.messagesOfType("pdfjs-viewer-document-modified")).toHaveLength(0);
    });

    it("reports typing on a page while a tool is active", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        manageSave();
        startEditing();
        const target = renderPage();

        target.dispatchEvent(new Event("keyup", { bubbles: true }));
        // Typing outside any page (the toolbar, the sidebar) is not an edit.
        document.body.dispatchEvent(new Event("keyup", { bubbles: true }));

        expect(viewer.messagesOfType("pdfjs-viewer-document-modified")).toHaveLength(1);
    });
});

describe("producing the saved document", () => {
    it("commits pending edits, returns the bytes, and refreshes the annotations", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        (globalThis as any).pdfjsLib = { getDocument };
        const unselectAll = vi.fn();
        setAnnotationEditorUIManager({ getMode: () => 15, getActive: () => null, hasSelection: false, unselectAll });
        manageSave();

        viewer.sendFromParent({ type: "trilium-request-blob" });
        await vi.waitFor(() => expect(viewer.messagesOfType("pdfjs-viewer-blob")).toHaveLength(1));

        // An in-progress edit is not in annotationStorage yet, so saving without committing
        // first would silently drop it.
        expect(unselectAll).toHaveBeenCalled();

        const blob = viewer.lastMessageOfType("pdfjs-viewer-blob");
        expect(blob).toMatchObject({ noteId: "note-1", ntxId: "ntx-1" });
        expect(blob.data.length).toBeGreaterThan(0);
        // The bytes must be a real PDF the viewer can reopen, not a partial write.
        await expect(getDocument({ data: blob.data }).promise).resolves.toBeTruthy();
    });

    it("does not save on a request from another origin", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        const saveDocument = vi.spyOn(viewer.pdfDocument, "saveDocument");
        manageSave();

        window.dispatchEvent(new MessageEvent("message", {
            data: { type: "trilium-request-blob" },
            origin: "https://evil.example"
        }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(saveDocument).not.toHaveBeenCalled();
    });
});

describe("commands forwarded from the parent", () => {
    it("prints and opens the find bar on request, and ignores other origins", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        // happy-dom does not implement print(), so there is nothing to spy on.
        const print = vi.fn();
        window.print = print;
        const open = vi.fn();
        const app = window.PDFViewerApplication;
        if (app) {
            app.findBar = { open, close: vi.fn(), toggle: vi.fn() };
        }
        manageParentCommands();

        viewer.sendFromParent({ type: "trilium-print" });
        viewer.sendFromParent({ type: "trilium-find" });
        window.dispatchEvent(new MessageEvent("message", {
            data: { type: "trilium-print" },
            origin: "https://evil.example"
        }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(print).toHaveBeenCalledTimes(1);
        expect(open).toHaveBeenCalledTimes(1);
    });
});

describe("viewer configuration", () => {
    afterEach(() => {
        // applyMinPixelRatio redefines this getter on the window.
        Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
    });

    it("raises the device pixel ratio only when it would sharpen rendering", () => {
        Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });

        applyMinPixelRatio(new URLSearchParams("minPixelRatio=2"));
        // pdf.js reads devicePixelRatio at render time to size the page canvas, so raising it
        // supersamples the output on a standard-DPI display.
        expect(window.devicePixelRatio).toBe(2);

        // A display that already exceeds the minimum must be left alone rather than downgraded.
        applyMinPixelRatio(new URLSearchParams("minPixelRatio=1.5"));
        expect(window.devicePixelRatio).toBe(2);
    });

    it("ignores a missing or nonsensical pixel ratio", () => {
        Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });

        for (const query of [ "", "minPixelRatio=0", "minPixelRatio=-3", "minPixelRatio=nope" ]) {
            applyMinPixelRatio(new URLSearchParams(query));
            expect(window.devicePixelRatio).toBe(1);
        }
    });

    it("applies the viewer options once pdf.js announces itself", () => {
        const set = vi.fn();
        window.PDFViewerApplicationOptions = { set };
        configurePdfViewerOptions();

        // pdf.js fires this on the document when the viewer script has loaded; the options
        // have to be set in that window, before it reads its own preferences.
        document.dispatchEvent(new CustomEvent("webviewerloaded", { detail: { source: window } }));

        expect(Object.fromEntries(set.mock.calls)).toMatchObject({
            disablePreferences: true,
            enableHighlightFloatingButton: true,
            enableComment: true,
            enableSignatureEditor: true
        });
        delete window.PDFViewerApplicationOptions;
    });

    it("hides the sidebar toggle along with the spacer that follows it", () => {
        document.body.innerHTML = `
            <div id="viewsManagerToggleButton"></div>
            <div class="other"></div>
            <div class="toolbarButtonSpacer"></div>`;

        hideSidebar();

        // Leaving the spacer behind would show a gap where the button used to be.
        expect(window.TRILIUM_HIDE_SIDEBAR).toBe(true);
        expect(document.getElementById("viewsManagerToggleButton")?.style.display).toBe("none");
        expect(document.querySelector(".toolbarButtonSpacer")).toBeNull();
    });
});
