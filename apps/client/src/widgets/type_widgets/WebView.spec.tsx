import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("../../services/toast", () => ({
    default: {
        showErrorTitleAndMessage: vi.fn(),
        showError: vi.fn(),
        showMessage: vi.fn()
    }
}));

import appContext from "../../components/app_context";
import Component from "../../components/component";
import type NoteContext from "../../components/note_context";
import attributes from "../../services/attributes";
import froca from "../../services/froca";
import toast from "../../services/toast";
import { buildNote } from "../../test/easy-froca";
import { renderComponent, resetFroca } from "../../test/render";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import WebView from "./WebView";

// --- Render harness --------------------------------------------------------------------------------

let parent: Component;

function renderWebView(noteId: string, ntxId: string | null | undefined = "ntx1", ctx: NoteContext | null = null) {
    const note = froca.notes[noteId];
    return renderComponent((
        <WebView
            note={note}
            ntxId={ntxId}
            viewScope={undefined}
            parentComponent={undefined}
            noteContext={undefined}
        />
    ), { parent, noteContext: ctx });
}

beforeEach(() => {
    parent = new Component();
    resetFroca();
    vi.clearAllMocks();
    // appContext.tabManager is only assigned during app load; stub it for the focus/blur listeners.
    Object.assign(appContext, { tabManager: { activateNoteContext: vi.fn() } });
});

// --- DisabledWebView -------------------------------------------------------------------------------

describe("WebView - disabled state", () => {
    it("renders the disabled form when disabled:webViewSrc is set and toggles the attribute on enable", () => {
        buildNote({ id: "n1", title: "WV", "#disabled:webViewSrc": "https://example.com/" });
        const toggleSpy = vi.spyOn(attributes, "toggleDangerousAttribute").mockImplementation(async () => undefined);

        const { container: root } = renderWebView("n1");

        // The disabled URL input shows the stored value and is disabled.
        const input = root.querySelector("input.form-control");
        expect(input).not.toBeNull();
        expect((input as HTMLInputElement).disabled).toBe(true);
        expect((input as HTMLInputElement).value).toBe("https://example.com/");
        expect(input?.getAttribute("type")).toBe("url");

        // The enable button restores the dangerous attribute.
        const buttons = root.querySelectorAll("button.btn-primary");
        expect(buttons.length).toBe(1);
        act(() => { (buttons[0] as HTMLButtonElement).click(); });
        const note = froca.notes["n1"];
        expect(toggleSpy).toHaveBeenCalledWith(note, "label", "webViewSrc", true);
    });
});

// --- SetupWebView ----------------------------------------------------------------------------------

describe("WebView - setup state", () => {
    function getForm(root: HTMLElement) {
        const form = root.querySelector("form.tn-centered-form");
        if (!form) throw new Error("setup form not found");
        return form as HTMLFormElement;
    }

    it("renders the setup form when no webViewSrc label is present", () => {
        buildNote({ id: "n2", title: "WV" });
        const { container: root } = renderWebView("n2");

        // Setup form has a text input (not disabled) and a create button.
        const input = root.querySelector("input.form-control") as HTMLInputElement;
        expect(input).not.toBeNull();
        expect(input.disabled).toBe(false);
        expect(input.getAttribute("type")).toBe("text");
        expect(root.querySelector("button.btn-primary")).not.toBeNull();
    });

    it("shows an error toast when submitting an invalid URL and does not set the label", () => {
        buildNote({ id: "n3", title: "WV" });
        const setLabelSpy = vi.spyOn(attributes, "setLabel").mockImplementation(async () => undefined);
        const { container: root } = renderWebView("n3");

        const input = root.querySelector("input.form-control") as HTMLInputElement;
        input.value = "not a url";
        act(() => {
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });

        act(() => { getForm(root).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

        expect(toast.showErrorTitleAndMessage).toHaveBeenCalledTimes(1);
        expect(setLabelSpy).not.toHaveBeenCalled();
    });

    it("sets the webViewSrc label when submitting a valid URL", () => {
        buildNote({ id: "n4", title: "WV" });
        const setLabelSpy = vi.spyOn(attributes, "setLabel").mockImplementation(async () => undefined);
        const { container: root } = renderWebView("n4");

        const input = root.querySelector("input.form-control") as HTMLInputElement;
        input.value = "https://trilium.test/page";
        act(() => {
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });

        act(() => { getForm(root).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

        expect(toast.showErrorTitleAndMessage).not.toHaveBeenCalled();
        expect(setLabelSpy).toHaveBeenCalledWith("n4", "webViewSrc", "https://trilium.test/page");
    });
});

// --- BrowserWebView (non-electron) -----------------------------------------------------------------

describe("WebView - browser variant", () => {
    it("renders a sandboxed iframe when webViewSrc is set (non-electron)", () => {
        buildNote({ id: "n5", title: "WV", "#webViewSrc": "https://content.test/" });
        const { container: root } = renderWebView("n5", "ntxB");

        const iframe = root.querySelector("iframe.note-detail-web-view-content") as HTMLIFrameElement;
        expect(iframe).not.toBeNull();
        expect(iframe.getAttribute("src")).toBe("https://content.test/");
        expect(iframe.getAttribute("sandbox")).toBe("allow-same-origin allow-scripts allow-popups");
        // No electron webview element in browser mode.
        expect(root.querySelector("webview")).toBeNull();
    });

    it("activates the note context on window blur when the iframe is focused", () => {
        buildNote({ id: "n6", title: "WV", "#webViewSrc": "https://content.test/" });
        const { container: root } = renderWebView("n6", "ntxB");
        const iframe = root.querySelector("iframe") as HTMLIFrameElement;

        // happy-dom: make the iframe the active element so the blur handler proceeds.
        Object.defineProperty(document, "activeElement", { configurable: true, get: () => iframe });
        act(() => { window.dispatchEvent(new Event("blur")); });

        expect(appContext.tabManager.activateNoteContext).toHaveBeenCalledWith("ntxB");
    });

    it("does not activate the note context on window blur when the iframe is not focused", () => {
        buildNote({ id: "n7", title: "WV", "#webViewSrc": "https://content.test/" });
        renderWebView("n7", "ntxB");

        Object.defineProperty(document, "activeElement", { configurable: true, get: () => document.body });
        act(() => { window.dispatchEvent(new Event("blur")); });

        expect(appContext.tabManager.activateNoteContext).not.toHaveBeenCalled();
    });

    it("does not activate the note context when ntxId is missing", () => {
        buildNote({ id: "n8", title: "WV", "#webViewSrc": "https://content.test/" });
        const { container: root } = renderWebView("n8", null);
        const iframe = root.querySelector("iframe") as HTMLIFrameElement;

        Object.defineProperty(document, "activeElement", { configurable: true, get: () => iframe });
        act(() => { window.dispatchEvent(new Event("blur")); });

        expect(appContext.tabManager.activateNoteContext).not.toHaveBeenCalled();
    });

    it("removes the window blur listener on unmount", () => {
        buildNote({ id: "n9", title: "WV", "#webViewSrc": "https://content.test/" });
        const { container: root, unmount } = renderWebView("n9", "ntxB");
        const iframe = root.querySelector("iframe") as HTMLIFrameElement;

        unmount();

        Object.defineProperty(document, "activeElement", { configurable: true, get: () => iframe });
        act(() => { window.dispatchEvent(new Event("blur")); });

        expect(appContext.tabManager.activateNoteContext).not.toHaveBeenCalled();
    });
});

// --- DesktopWebView (electron) ---------------------------------------------------------------------

describe("WebView - electron variant", () => {
    it("renders a <webview> element and wires focus to the note context", async () => {
        // `isElectron` is captured at module load via `"electronApi" in window`; re-import with it set.
        const win = window as unknown as Record<string, unknown>;
        const hadApi = "electronApi" in win;
        win.electronApi = {};
        vi.resetModules();
        const ElectronWebView = (await import("./WebView")).default;
        // resetModules also re-creates the app_context singleton consumed by the re-imported WebView.
        const electronAppContext = (await import("../../components/app_context")).default;
        Object.assign(electronAppContext, { tabManager: { activateNoteContext: vi.fn() } });

        buildNote({ id: "n10", title: "WV", "#webViewSrc": "https://desktop.test/" });
        const note = froca.notes["n10"];

        const localContainer = document.createElement("div");
        document.body.appendChild(localContainer);
        act(() => {
            render((
                <ParentComponent.Provider value={parent}>
                    <NoteContextContext.Provider value={null}>
                        <ElectronWebView
                            note={note}
                            ntxId="ntxD"
                            viewScope={undefined}
                            parentComponent={undefined}
                            noteContext={undefined}
                        />
                    </NoteContextContext.Provider>
                </ParentComponent.Provider>
            ), localContainer);
        });

        const webview = localContainer.querySelector("webview");
        expect(webview).not.toBeNull();
        expect(webview?.getAttribute("src")).toBe("https://desktop.test/");
        expect(webview?.className).toContain("note-detail-web-view-content");
        expect(localContainer.querySelector("iframe")).toBeNull();

        // Focusing the webview should activate the note context.
        if (webview) {
            Object.defineProperty(document, "activeElement", { configurable: true, get: () => webview });
            act(() => { webview.dispatchEvent(new Event("focus")); });
        }
        expect(electronAppContext.tabManager.activateNoteContext).toHaveBeenCalledWith("ntxD");

        act(() => { render(null, localContainer); });
        localContainer.remove();
        if (!hadApi) delete win.electronApi;
        vi.resetModules();
    });
});
