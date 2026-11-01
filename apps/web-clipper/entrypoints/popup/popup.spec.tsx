import Bookmark from "@boxicons/js/icons/Bookmark";
import Crop from "@boxicons/js/icons/Crop";
import FileDetail from "@boxicons/js/icons/FileDetail";
import Globe from "@boxicons/js/icons/Globe";
import Paperclip from "@boxicons/js/icons/Paperclip";
import { readFileSync } from "fs";
import { join } from "path";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { iconVariant, Popup, previewDocument, shortcutsByCommand, textToHtml } from "./main";

const DISCONNECTED = "This action can't be performed without active connection to Trilium.";
const UNREACHABLE = "This action is not available on this page.";

const sendMessage = vi.fn(async (_message: object): Promise<unknown> => undefined);
const openOptionsPage = vi.fn(async () => {});
const getAllCommands = vi.fn(async () => [
    { name: "saveSelection", shortcut: "Ctrl+Shift+S" },
    { name: "saveWholePage", shortcut: "Alt+Shift+S" },
    { name: "saveCroppedScreenshot", shortcut: "Ctrl+Shift+E" },
    { name: "saveTabs", shortcut: "" }
]);
const PAGE = {
    title: "An article",
    content: `<p>Body</p><img src="i1"><img src="https://example.com/b.png">`,
    images: [ { imageId: "i1", src: "https://example.com/a.png" } ],
    pageUrl: "https://example.com/post?id=1",
    clipType: "page",
    labels: { pageAuthor: "Jane Doe", publishedDate: "2024-05-01", modifiedDate: "2024-06-12" }
};
const WHOLE_PAGE = { ...PAGE, content: `<nav>Menu</nav><p>Body</p><img src="i1">` };
/** How `readable-page.js` reads the tab, by variant, as `browser.scripting.executeScript()` answers. */
let pageReadings: Record<string, unknown> = {};
/** Whether the tab shows a PDF, as the check run in the tab answers. */
let pdfTab = false;
const executeScript = vi.fn(async ({ args, func }: { args?: [ string ], func?: unknown }): Promise<unknown> => {
    if (args) return [ { result: pageReadings[args[0]] } ];
    return func ? [ { result: pdfTab } ] : [];
});
const tabsQuery = vi.fn(async (): Promise<{ id?: number, title?: string, url?: string }[]> => [ { id: 7 } ]);
const SELECTION = {
    title: "Page title",
    content: `<p>A quote</p><img src="i2">`,
    images: [ { imageId: "i2", src: "https://example.com/c.png" } ],
    pageUrl: "https://example.com/post?id=1#part"
};
/** What the content script answers to `trilium-save-selection`; nothing is selected unless a test says so. */
let selection: unknown;
/** What the content script answers to `trilium-get-page-metadata`, or the error it fails with; no description unless a test says so. */
let metadata: unknown;
const tabsSendMessage = vi.fn(async (_tabId: number, message: { name: string }): Promise<unknown> => {
    if (message.name === "trilium-get-page-metadata") {
        if (metadata instanceof Error) throw metadata;
        return metadata;
    }
    return selection;
});
const closeWindow = vi.fn();
const disconnect = vi.fn();
const connect = vi.fn((_info: { name: string }) => ({ disconnect }));
let container: HTMLElement;

describe("popup", () => {
    beforeEach(async () => {
        fakeBrowser.reset();
        selection = undefined;
        metadata = {};
        pageReadings = { article: PAGE, wholePage: WHOLE_PAGE };
        pdfTab = false;
        Object.assign(fakeBrowser.runtime, { sendMessage, openOptionsPage, connect });
        Object.assign(fakeBrowser.commands, { getAll: getAllCommands });
        Object.assign(fakeBrowser.tabs, { query: tabsQuery, sendMessage: tabsSendMessage });
        Object.assign(fakeBrowser, { scripting: { executeScript } });
        vi.spyOn(window, "close").mockImplementation(closeWindow);
        vi.spyOn(console, "log").mockImplementation(() => {});

        container = document.createElement("div");
        document.body.appendChild(container);
        await act(() => render(<Popup />, container));
        await flush();
    });

    afterEach(async () => {
        await act(() => render(null, container));
        container.remove();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("asks for the connection status and shows it in the footer", async () => {
        expect(sendMessage).toHaveBeenCalledWith({ name: "send-trilium-search-status" });
        expect(status()).toEqual({ dot: "status-dot status-dot-pending", text: "Looking for Trilium…" });
        expect(captureButtons()).toHaveLength(5);
        expect(container.querySelector(".popup-header")).toBeNull();
        expect([ ...container.querySelectorAll(".connection button") ].map((b) => b.getAttribute("aria-label")))
            .toEqual([ "Check the connection again", "Options", "Help" ]);
        expect(captureButtons().every((button) => !button.disabled)).toBe(true);

        await receive({ name: "trilium-search-status", triliumSearch: { status: "found-desktop", port: 37840, url: "" } });
        expect(status()).toEqual({ dot: "status-dot status-dot-ok", text: "Connected to the desktop app" });
        expect(container.querySelector<HTMLElement>(".connection .status-ok")?.title).toBe("Connected to port 37840");
        expect(container.querySelector(".connection .status-ok")).not.toBeNull();
        expect(captureButtons().every((button) => !button.disabled)).toBe(true);
        expect(button("Save page to Trilium")?.title).toBe("");
        expect(button("Area screenshot")?.title).toBe("Area screenshot (Ctrl+Shift+E)");
        expect(sendMessage).toHaveBeenCalledWith({ name: "trigger-trilium-search-note-url" });

        await receive({
            name: "trilium-search-status",
            triliumSearch: { status: "found-server", url: "https://trilium.example", token: "t" }
        });
        expect(status().text).toBe("Connected to the server");
        expect(container.querySelector<HTMLElement>(".connection .status-ok")?.title)
            .toBe("Connected to https://trilium.example");

        await receive({ name: "trilium-search-status", triliumSearch: { status: "searching" } });
        expect(status()).toEqual({ dot: "status-dot status-dot-pending", text: "Looking for Trilium…" });
        for (const button of captureButtons()) {
            expect(button.disabled).toBe(true);
            expect(button.title).toBe(DISCONNECTED);
        }

        await receive({ name: "unrelated" });
        expect(status().text).toBe("Looking for Trilium…");
    });

    it("explains a version mismatch above the actions, which stay enabled", async () => {
        expect(container.querySelector(".callout-warning")).toBeNull();

        await receive({
            name: "trilium-search-status",
            triliumSearch: { status: "version-mismatch", extensionMajor: 2, triliumMajor: 1 }
        });
        expect(status()).toEqual({ dot: "status-dot status-dot-warning", text: "Incompatible version" });
        expect(container.querySelector(".popup > .notices:first-child > .callout-warning")?.textContent)
            .toContain("Please update Trilium Notes");
        expect(captureButtons().every((button) => !button.disabled)).toBe(true);

        await receive({
            name: "trilium-search-status",
            triliumSearch: { status: "version-mismatch", extensionMajor: 1, triliumMajor: 2 }
        });
        expect(container.querySelector(".callout-warning")?.textContent).toContain("Please update this extension");
    });

    it("replaces the actions with a way out when Trilium is not found", async () => {
        await receive({ name: "trilium-search-status", triliumSearch: { status: "not-found" } });
        expect(status()).toEqual({ dot: "status-dot status-dot-error", text: "Not found" });
        expect(captureButtons()).toHaveLength(0);
        const notFound = container.querySelector(".no-items.not-found");
        expect(notFound).not.toBeNull();
        expect(notFound?.querySelector(":scope > svg.icon path")).not.toBeNull();
        expect(notFound?.querySelector("h4")?.textContent).toBe("Trilium was not found");
        expect(notFound?.querySelector("p")?.textContent)
            .toBe("Start the desktop app, or connect to a server in the options.");
        expect([ ...notFound?.querySelectorAll("button") ?? [] ].map((b) => [ b.textContent, !!b.querySelector("svg.icon") ]))
            .toEqual([ [ "Retry", true ], [ "Open options", true ] ]);
        expect(sendMessage).not.toHaveBeenCalledWith({ name: "trigger-trilium-search-note-url" });

        await click("Retry");
        expect(sendMessage).toHaveBeenCalledWith({ name: "trigger-trilium-search" });
        await click("Open options");
        expect(openOptionsPage).toHaveBeenCalledOnce();
        expect(closeWindow).not.toHaveBeenCalled();
    });

    it("offers to open a page that was already clipped", async () => {
        expect(container.querySelector(".already-visited")).toBeNull();

        await receive({ name: "trilium-previously-visited", searchNote: { status: "found", noteId: "clipped" } });
        expect(container.querySelector(".popup > .notices:first-child > .already-visited span")?.textContent)
            .toBe("Web page already clipped.");
        const link = container.querySelector<HTMLAnchorElement>(".already-visited a");
        expect(link?.textContent).toBe("Open in Trilium");

        await act(() => link?.click());
        expect(sendMessage).toHaveBeenCalledWith({ name: "openNoteInTrilium", noteId: "clipped" });

        await receive({ name: "trilium-previously-visited", searchNote: { status: "not-found", noteId: null } });
        expect(container.querySelector(".already-visited")).toBeNull();
        expect(container.querySelector(".notices")).toBeNull();
    });

    it("sends the capture actions, closing the popup only to crop on the page", async () => {
        await click("Area screenshot");
        expect(sendMessage).toHaveBeenCalledWith({ name: "save-cropped-screenshot" });
        expect(closeWindow).toHaveBeenCalledOnce();
        await click("Visible area screenshot");
        await flush();
        expect(sendMessage).toHaveBeenCalledWith({ name: "save-whole-screenshot" });
        await click("Full page screenshot");
        await flush();
        expect(sendMessage).toHaveBeenCalledWith({ name: "save-full-page-screenshot" });

        await click("All tabs in this window");
        await flush();
        expect(sendMessage).toHaveBeenCalledWith({ name: "save-tabs" });
        await click("Check the connection again");
        expect(sendMessage).toHaveBeenCalledWith({ name: "trigger-trilium-search" });
        await click("Options");
        expect(openOptionsPage).toHaveBeenCalledOnce();
        expect(closeWindow).toHaveBeenCalledOnce();

        const openWindow = vi.spyOn(window, "open").mockImplementation(() => null);
        await click("Help");
        expect(openWindow).toHaveBeenCalledWith("https://docs.triliumnotes.org/user-guide/setup/web-clipper", "_blank");
    });

    it("shows the keyboard shortcut of each action that has one", async () => {
        expect(getAllCommands).toHaveBeenCalledOnce();
        expect(shortcutOf("Save page to Trilium")).toEqual({ text: "Alt+Shift+S", keys: [ "Alt", "Shift", "S" ] });
        expect(toolbar()).toEqual([
            { label: "Area", title: "Area screenshot (Ctrl+Shift+E)" },
            { label: "Visible", title: "Visible area screenshot" },
            { label: "Full page", title: "Full page screenshot" },
            { label: "All tabs", title: "All tabs in this window" }
        ]);
        expect(container.querySelectorAll(".toolbar-action kbd")).toHaveLength(0);

        getAllCommands.mockResolvedValueOnce([ { name: "saveWholePage", shortcut: "⌥⇧S" } ]);
        await rerender();
        expect(shortcutOf("Save page to Trilium")).toEqual({ text: "⌥⇧S", keys: [ "⌥⇧S" ] });
    });

    it("previews the readable page with its title, source and date", () => {
        expect(tabsQuery).toHaveBeenCalledWith({ active: true, currentWindow: true });
        expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: [ "/readable-page.js" ] });

        expect(cardParts()).toEqual([ "page-heading", "clip-mode", "page-body", "btn btn-primary primary-action" ]);
        expect(modes()).toEqual([ [ "Page", "true" ], [ "Bookmark", "false" ] ]);
        const heading = container.querySelector(".page-heading");
        expect(heading).not.toBeNull();
        expect(heading?.querySelector(".page-icon svg path")).not.toBeNull();
        expect(heading?.querySelector<HTMLInputElement>(".page-title")?.value).toBe("An article");
        expect(heading?.querySelector(".page-meta")?.textContent).toBe("example.com");
        expect(publishedDate()).toBe("Published 2024-05-01");
        const dateIcon = container.querySelector<HTMLElement>(".page-fields > .page-field:nth-child(4) > .page-field-icon");
        expect(dateIcon?.querySelector("svg.icon path")).not.toBeNull();
        expect(dateIcon?.title).toBe(
            "The date the page was published. It is saved in the #publishedDate label of the note.");
        expect(modifiedDate()).toBe("Updated 2024-06-12");
        const modifiedIcon = container.querySelector<HTMLElement>(".page-fields > .page-field:nth-child(5) > .page-field-icon");
        expect(modifiedIcon?.querySelector("svg.icon path")).not.toBeNull();
        expect(modifiedIcon?.title).toBe(
            "The date the page was last modified. It is saved in the #modifiedDate label of the note.");
        const frame = container.querySelector<HTMLIFrameElement>(".page-body iframe.page-content");
        expect(frame?.getAttribute("sandbox")).toBe("allow-same-origin");
        expect(frame?.getAttribute("srcdoc")).toBe(previewDocument(PAGE));
        expect([ ...container.querySelector(".page-body")?.children ?? [] ].map((part) => part.className))
            .toEqual([ "page-fields", "page-variant", "page-content" ]);
        expect(button("Save page to Trilium")?.disabled).toBe(false);
    });

    it("reads the whole page when the user switches to it, once, and keeps the choice", async () => {
        expect(variants()).toEqual([ [ "Article", "true", false ], [ "Whole page", "false", false ] ]);
        expect(container.querySelector(".page-variant")?.getAttribute("aria-label")).toBe("How to read the page");
        expect(wholePageReads()).toBe(0);

        let finishReading: () => void = () => {};
        executeScript
            .mockResolvedValueOnce([])
            .mockReturnValueOnce(new Promise((resolve) => {
                finishReading = () => resolve([ { result: WHOLE_PAGE } ]);
            }));
        await click("Whole page");
        expect(variants()).toEqual([ [ "Article", "false", false ], [ "Whole page", "true", false ] ]);
        expect(placeholder()).toBe("Reading the page…");
        expect(button("Save page to Trilium")?.disabled).toBe(true);
        await ctrlEnter(".note-text");
        expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ name: "save-whole-page" }));

        await act(() => finishReading());
        await flush();
        expect(frameDocument()).toBe(previewDocument(WHOLE_PAGE));
        await click("Article");
        expect(frameDocument()).toBe(previewDocument(PAGE));
        await click("Whole page");
        expect(frameDocument()).toBe(previewDocument(WHOLE_PAGE));
        expect(wholePageReads()).toBe(1);

        await click("Bookmark");
        expect(container.querySelector(".page-variant")).toBeNull();
        await receive({ name: "trilium-search-status", triliumSearch: { status: "not-found" } });
        await receive({ name: "trilium-search-status", triliumSearch: { status: "found-desktop", port: 37840, url: "" } });
        await flush();
        await click("Page");
        await flush();
        expect(variants()).toEqual([ [ "Article", "false", false ], [ "Whole page", "true", false ] ]);

        await type(".page-title", "Gallery");
        await click("Save page to Trilium");
        expect(sendMessage).toHaveBeenLastCalledWith({ name: "save-whole-page", page: { ...WHOLE_PAGE, title: "Gallery" } });

        await click("Article");
        expect(frameDocument()).toBe(previewDocument(PAGE));
    });

    it("goes back to the article when the whole page shows nothing or cannot be read", async () => {
        pageReadings = { article: PAGE };
        await click("Whole page");
        await flush();
        expect(variants()).toEqual([ [ "Article", "true", false ], [ "Whole page", "false", true ] ]);
        expect(button("Whole page")?.title).toBe("Trilium found nothing to save on this page.");
        expect(frameDocument()).toBe(previewDocument(PAGE));

        await rerender();
        executeScript.mockRejectedValueOnce(new Error("The tab was closed."));
        await click("Whole page");
        await flush();
        expect(variants()).toEqual([ [ "Article", "true", false ], [ "Whole page", "false", true ] ]);
    });

    it("opens a page without an article on the whole page", async () => {
        pageReadings = { wholePage: WHOLE_PAGE };
        await rerender();
        expect(modes()).toEqual([ [ "Page", "true" ], [ "Bookmark", "false" ] ]);
        expect(variants()).toEqual([ [ "Article", "false", true ], [ "Whole page", "true", false ] ]);
        expect(button("Article")?.title).toBe("Trilium found no article on this page.");
        expect(frameDocument()).toBe(previewDocument(WHOLE_PAGE));
        expect(container.querySelector<HTMLInputElement>(".page-title")?.value).toBe("An article");

        await click("Save page to Trilium");
        expect(sendMessage).toHaveBeenLastCalledWith({ name: "save-whole-page", page: WHOLE_PAGE });
    });

    it("saves the extracted page with the edited title", async () => {
        await type(".page-title", "  My title ");
        await click("Save page to Trilium");
        expect(sendMessage).toHaveBeenCalledWith({ name: "save-whole-page", page: { ...PAGE, title: "My title" } });

        await type(".page-title", "   ");
        await click("Save page to Trilium");
        expect(sendMessage).toHaveBeenLastCalledWith({ name: "save-whole-page", page: PAGE });
    });

    it("leaves out the dates of a page that states none", async () => {
        pageReadings = { article: { ...PAGE, labels: {} }, wholePage: WHOLE_PAGE };
        await rerender();
        expect(container.querySelector(".page-meta")?.textContent).toBe("example.com");
        expect(container.querySelectorAll(".page-fields > .page-field")).toHaveLength(3);
        expect(publishedDate()).toBeUndefined();
        expect(modifiedDate()).toBeUndefined();
    });

    it("says so while the page is read", async () => {
        let resolvePage: (page: unknown) => void = () => {};
        executeScript.mockReturnValueOnce(new Promise((resolve) => {
            resolvePage = resolve;
        }));
        await rerender();
        expect(placeholder()).toBe("Reading the page…");
        expect(cardParts()).toEqual([ "page-body", "btn btn-primary primary-action" ]);
        expect(button("Save page to Trilium")?.disabled).toBe(true);

        resolvePage([]);
        await flush();
        expect(container.querySelector(".page-body iframe")).not.toBeNull();
    });

    it("opens a page with nothing to save on a bookmark, and keeps every other action", async () => {
        pageReadings = {};
        await rerender();
        expect(container.querySelector(".no-items")).toBeNull();
        expect(container.querySelector(".clip-mode")).toBeNull();
        expect(container.querySelector(".clip-hint")?.textContent).toBe("This page has nothing to save; save it as a bookmark.");
        expect(container.querySelector(".page-body")?.className).toBe("page-body compact");
        expect(document.activeElement).toBe(container.querySelector(".page-body .note-text"));
        expect(container.querySelector(".page-meta")).toBeNull();
        expect(button("Save bookmark")?.disabled).toBe(false);
        expect(captureButtons().map((action) => action.disabled)).toEqual([ false, false, false, false, false ]);
    });

    it("keeps only the actions that need no access to a page out of reach", async () => {
        executeScript.mockRejectedValueOnce(new Error("Cannot access a chrome:// URL"));
        tabsSendMessage.mockRejectedValueOnce(new Error("Could not establish connection."));
        await rerender();
        expect(unavailable()).toBe(
            "The extension cannot access this page.\nIf it is a regular web page, reload it."
        );
        expect(container.querySelector(".page-preview")).toBeNull();
        expect(captureButtons().map((action) => action.disabled)).toEqual([ true, true, true, false ]);
        expect(button("Area screenshot")?.title).toBe(UNREACHABLE);
        expect(button("Visible area screenshot")?.title).toBe(UNREACHABLE);

        tabsQuery.mockResolvedValueOnce([ {} ]);
        await rerender();
        expect(unavailable()).toContain("The extension cannot access this page.");
        expect(executeScript).toHaveBeenCalledTimes(3);
        expect(tabsSendMessage).toHaveBeenCalledTimes(4);
    });

    it("previews the selection first, and switches to the whole page", async () => {
        selection = SELECTION;
        await rerender();
        expect(tabsSendMessage).toHaveBeenCalledWith(7, { name: "trilium-save-selection" });
        expect(modes()).toEqual([ [ "Selection", "true" ], [ "Page", "false" ], [ "Bookmark", "false" ] ]);
        expect(frameDocument()).toBe(previewDocument(SELECTION));
        // The heading shows the icon Trilium gives the note each mode saves.
        expect(headingIcon()).toEqual(pathsOf(iconVariant(Paperclip).content));
        expect(shortcutOf("Save selection").keys).toEqual([ "Ctrl", "Shift", "S" ]);
        expect(container.querySelector(".page-meta")?.textContent).toBe("example.com");
        expect(publishedDate()).toBeUndefined();
        expect(modifiedDate()).toBeUndefined();

        await click("Page");
        expect(modes()).toEqual([ [ "Selection", "false" ], [ "Page", "true" ], [ "Bookmark", "false" ] ]);
        expect(frameDocument()).toBe(previewDocument(PAGE));
        expect(headingIcon()).toEqual(pathsOf(iconVariant(Globe).content));
        expect(publishedDate()).toBe("Published 2024-05-01");
        await click("Save page to Trilium");
        expect(sendMessage).toHaveBeenLastCalledWith({ name: "save-whole-page", page: PAGE });

        await click("Bookmark");
        expect(headingIcon()).toEqual(pathsOf(iconVariant(Bookmark).content));

        await click("Selection");
        await type(".page-title", " Quote ");
        await click("Save selection");
        expect(sendMessage).toHaveBeenLastCalledWith({ name: "save-selection", selection: { ...SELECTION, title: "Quote" } });
        expect(closeWindow).not.toHaveBeenCalled();
    });

    it("saves the selection of a page with nothing else to save, and ignores an empty one", async () => {
        selection = SELECTION;
        pageReadings = {};
        await rerender();
        expect(container.querySelector(".no-items")).toBeNull();
        expect(modes()).toEqual([ [ "Selection", "true" ], [ "Bookmark", "false" ] ]);
        expect(frameDocument()).toBe(previewDocument(SELECTION));
        expect(container.querySelector<HTMLInputElement>(".page-title")?.value).toBe("Page title");
        await click("Save selection");
        expect(sendMessage).toHaveBeenLastCalledWith({ name: "save-selection", selection: SELECTION });

        selection = { ...SELECTION, content: " <p> </p>", images: [] };
        pageReadings = { article: PAGE, wholePage: WHOLE_PAGE };
        await rerender();
        expect(modes()).toEqual([ [ "Page", "true" ], [ "Bookmark", "false" ] ]);
        expect(frameDocument()).toBe(previewDocument(PAGE));

        selection = { ...SELECTION, content: `<img src="i2">` };
        await rerender();
        expect(modes()).toHaveLength(3);
        expect(frameDocument()).toBe(previewDocument(selection as typeof SELECTION));
    });

    it("tells the user when the background script cannot be reached, with the reason for a save", async () => {
        const alertMock = vi.fn();
        vi.stubGlobal("alert", alertMock);
        sendMessage.mockRejectedValueOnce(new Error("Receiving end does not exist."));
        await click("All tabs in this window");
        await flush();
        expect(saveStatus()).toEqual({
            kind: "callout callout-error save-status",
            text: "Saving to Trilium failed: the popup could not reach the extension's background script"
                + " (Receiving end does not exist.)."
        });
        expect(alertMock).not.toHaveBeenCalled();

        sendMessage.mockRejectedValueOnce(new Error("Receiving end does not exist."));
        await click("Check the connection again");
        expect(alertMock).toHaveBeenCalledWith("Calling browser runtime failed. Refreshing page might help.");
    });

    it("writes a bookmark in the card, keeping the note across modes", async () => {
        tabsQuery.mockResolvedValueOnce([ { id: 7, title: "A page", url: "https://example.com/post" } ]);
        await rerender();

        await click("Bookmark");
        expect(modes()).toEqual([ [ "Page", "false" ], [ "Bookmark", "true" ] ]);
        const textArea = container.querySelector(".page-body .page-fields.bookmark .note-text");
        expect(textArea).not.toBeNull();
        expect(container.querySelector(".page-body")?.className).toBe("page-body");
        expect(document.activeElement).toBe(textArea);
        expect(container.querySelector<HTMLElement>(".page-field:first-child > .page-field-icon")?.title)
            .toBe("Your note about the page. It is saved as the content of the note.");
        expect(container.querySelector(".page-body iframe")).toBeNull();
        expect(container.querySelector<HTMLInputElement>(".page-title")?.value).toBe("An article");
        expect(container.querySelector(".page-meta")?.textContent).toBe("example.com");
        expect(publishedDate()).toBeUndefined();
        expect(modifiedDate()).toBeUndefined();
        expect(shortcutOf("Save bookmark")).toEqual({ text: "Ctrl+Enter", keys: [ "Ctrl", "Enter" ] });

        await type(".page-body .note-text", "Worth a read");
        await click("Page");
        expect(container.querySelector(".page-fields.bookmark")).toBeNull();
        await click("Bookmark");
        expect(container.querySelector<HTMLTextAreaElement>(".page-body .note-text")?.value).toBe("Worth a read");
        expect(closeWindow).not.toHaveBeenCalled();

        sendMessage.mockResolvedValueOnce({ noteId: "n1", message: "Link with note has been saved to Trilium." });
        await click("Save bookmark");
        await flush();
        expect(sendMessage).toHaveBeenLastCalledWith({
            name: "save-link-with-note",
            title: "An article",
            content: "<p>Worth a read</p>"
        });
        expect(saveStatus()?.text).toBe("Link with note has been saved to Trilium.Open note");
        expect(closeWindow).not.toHaveBeenCalled();
    });

    it("shows the page's description atop the preview in every mode, and saves it as edited", async () => {
        metadata = { description: "All about the post" };
        selection = SELECTION;
        await rerender();
        const description = () =>
            container.querySelector<HTMLTextAreaElement>(".page-body > .page-fields .page-description");
        expect(description()?.value).toBe("All about the post");
        expect(description()?.getAttribute("aria-label")).toBe("Page description");
        expect(description()?.getAttribute("placeholder")).toBe("Add a description");
        const icon = container.querySelector<HTMLElement>(".page-fields > .page-field:nth-child(2) > .page-field-icon");
        expect(icon?.querySelector("svg.icon path")).not.toBeNull();
        expect(icon?.title).toBe(
            "The page's description. It is saved in the #pageDescription label of the note.");

        await click("Save selection");
        expect(sendMessage).toHaveBeenLastCalledWith({
            name: "save-selection",
            selection: { ...SELECTION, title: "An article", labels: { pageDescription: "All about the post" } }
        });

        await click("Page");
        await type(".page-description", "  Edited\n  description ");
        await click("Save page to Trilium");
        expect(sendMessage).toHaveBeenLastCalledWith({
            name: "save-whole-page",
            page: { ...PAGE, labels: { ...PAGE.labels, pageDescription: "Edited description" } }
        });

        await click("Bookmark");
        expect(description()?.value).toBe("  Edited\n  description ");
        sendMessage.mockResolvedValueOnce(undefined);
        await ctrlEnter(".page-description");
        expect(sendMessage).toHaveBeenLastCalledWith({
            name: "save-link-with-note",
            title: "An article",
            content: "",
            description: "Edited description"
        });

        // A cleared description stays in the card while it is edited, and is not saved.
        await type(".page-description", " ");
        expect(description()).not.toBeNull();
        await click("Save bookmark");
        expect(sendMessage).toHaveBeenLastCalledWith({ name: "save-link-with-note", title: "An article", content: "" });
        await click("Page");
        await click("Save page to Trilium");
        expect(sendMessage).toHaveBeenLastCalledWith({
            name: "save-whole-page",
            page: PAGE
        });
    });

    it("offers an empty description where the page gives none or cannot be asked for one", async () => {
        const description = () => container.querySelector<HTMLTextAreaElement>(".page-description");
        // An outdated content script answers nothing.
        metadata = undefined;
        await rerender();
        expect(description()?.value).toBe("");
        await type(".page-description", "Written by hand");
        await click("Save page to Trilium");
        expect(sendMessage).toHaveBeenLastCalledWith({
            name: "save-whole-page",
            page: { ...PAGE, labels: { ...PAGE.labels, pageDescription: "Written by hand" } }
        });

        metadata = new Error("Could not establish connection.");
        await rerender();
        await click("Bookmark");
        expect(description()?.value).toBe("");
        expect(container.querySelector(".page-body .note-text")).not.toBeNull();
    });

    it("takes the description from the page reading when the content script cannot be asked", async () => {
        const labels = { ...PAGE.labels, pageDescription: "All about the post" };
        pageReadings = { article: { ...PAGE, labels }, wholePage: WHOLE_PAGE };
        metadata = new Error("Could not establish connection.");
        await rerender();

        expect(container.querySelector<HTMLTextAreaElement>(".page-description")?.value)
            .toBe("All about the post");
        await click("Save page to Trilium");
        expect(sendMessage).toHaveBeenLastCalledWith({
            name: "save-whole-page",
            page: { ...PAGE, labels }
        });
    });

    it("offers the page's author in Page mode, and saves it as edited", async () => {
        const author = () => container.querySelector<HTMLInputElement>(".page-fields .page-author");
        expect(author()?.value).toBe("Jane Doe");
        expect(author()?.getAttribute("aria-label")).toBe("Author");
        expect(author()?.getAttribute("placeholder")).toBe("Add an author");
        const icon = container.querySelector<HTMLElement>(".page-fields > .page-field:nth-child(3) > .page-field-icon");
        expect(icon?.querySelector("svg.icon path")).not.toBeNull();
        expect(icon?.title).toBe("The page's author. It is saved in the #pageAuthor label of the note.");

        await type(".page-author", "  John   Smith ");
        await click("Save page to Trilium");
        expect(sendMessage).toHaveBeenLastCalledWith({
            name: "save-whole-page",
            page: { ...PAGE, labels: { ...PAGE.labels, pageAuthor: "John Smith" } }
        });

        await type(".page-author", " ");
        expect(author()).not.toBeNull();
        await click("Save page to Trilium");
        const { pageAuthor: _, ...withoutAuthor } = PAGE.labels;
        expect(sendMessage).toHaveBeenLastCalledWith({ name: "save-whole-page", page: { ...PAGE, labels: withoutAuthor } });

        selection = SELECTION;
        await rerender();
        expect(author()).toBeNull();
        await click("Bookmark");
        expect(author()).toBeNull();

        selection = undefined;
        pageReadings = { article: { ...PAGE, labels: {} }, wholePage: WHOLE_PAGE };
        await rerender();
        expect(author()?.value).toBe("");
        await type(".page-author", "Written by hand");
        await click("Save page to Trilium");
        expect(sendMessage).toHaveBeenLastCalledWith({
            name: "save-whole-page",
            page: { ...PAGE, labels: { pageAuthor: "Written by hand" } }
        });
    });

    it("never lets a preview run scripts, since it shares the extension's origin", async () => {
        selection = SELECTION;
        await rerender();
        for (const mode of [ "Selection", "Page" ]) {
            await click(mode);
            const frame = container.querySelector(".page-body iframe.page-content");
            expect(frame, mode).not.toBeNull();
            const sandbox = frame?.getAttribute("sandbox")?.split(/\s+/);
            expect(sandbox, mode).toContain("allow-same-origin");
            expect(sandbox, mode).not.toContain("allow-scripts");
        }
    });

    it("keeps the preview as tall as the page, so that it scrolls with the description", async () => {
        const frame = container.querySelector<HTMLIFrameElement>(".page-body iframe.page-content");
        expect(frame).not.toBeNull();
        if (!frame) return;
        let height = 640;
        const root = { getBoundingClientRect: () => ({ height }) };
        let onResize: (() => void) | undefined;
        const observe = vi.fn();
        class ResizeObserver {
            constructor(callback: () => void) { onResize = callback; }
            observe = observe;
        }
        Object.defineProperty(frame, "contentDocument", { configurable: true, value: { documentElement: root } });
        Object.defineProperty(frame, "contentWindow", { configurable: true, value: { ResizeObserver } });
        await act(() => {
            frame.dispatchEvent(new Event("load"));
        });
        expect(observe).toHaveBeenCalledWith(root);
        onResize?.();
        expect(frame.style.height).toBe("640px");

        // The page grows when it rewraps beside the card's scrollbar, or when an image loads.
        height = 712.4;
        onResize?.();
        expect(frame.style.height).toBe("713px");

        Object.defineProperty(frame, "contentDocument", { configurable: true, value: null });
        await act(() => {
            frame.dispatchEvent(new Event("load"));
        });
        expect(frame.style.height).toBe("713px");
    });

    it("keeps a draft bookmark while Trilium is briefly not found", async () => {
        await click("Bookmark");
        await type(".page-title", "My title");
        await type(".page-body .note-text", "Half-written note");

        await receive({ name: "trilium-search-status", triliumSearch: { status: "not-found" } });
        expect(container.querySelector(".page-body .note-text")).toBeNull();
        await receive({ name: "trilium-search-status", triliumSearch: { status: "found-desktop", port: 37840, url: "" } });
        await flush();

        expect(modes()).toEqual([ [ "Page", "false" ], [ "Bookmark", "true" ] ]);
        expect(container.querySelector<HTMLInputElement>(".page-title")?.value).toBe("My title");
        expect(container.querySelector<HTMLTextAreaElement>(".page-body .note-text")?.value).toBe("Half-written note");
    });

    it("saves the title and the text as they are, on Ctrl+Enter from either field", async () => {
        await click("Bookmark");
        await type(".page-title", "  Read later. Soon ");
        await type(".page-body .note-text", " It has <b>tips</b>\nand more ");
        await ctrlEnter(".page-body .note-text");
        expect(sendMessage).toHaveBeenCalledWith({
            name: "save-link-with-note",
            title: "Read later. Soon",
            content: "<p>It has &lt;b&gt;tips&lt;/b&gt;</p><p>and more</p>"
        });
    });

    it("keeps the bookmark open when it could not be saved, and leaves an empty title to the page", async () => {
        await click("Bookmark");
        await type(".page-title", "");
        const title = container.querySelector(".page-title");
        await act(async () => {
            title?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        });
        expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ name: "save-link-with-note" }));

        sendMessage.mockResolvedValueOnce({ error: "Trilium was not found." });
        await ctrlEnter(".page-title");
        await flush();
        expect(sendMessage).toHaveBeenCalledWith({ name: "save-link-with-note", title: "", content: "" });
        expect(container.querySelector(".page-body .note-text")).not.toBeNull();
        expect(saveStatus()).toEqual({ kind: "callout callout-error save-status", text: "Trilium was not found." });
        expect(button("Save bookmark")?.disabled).toBe(false);

        await click("Page");
        await ctrlEnter(".page-title");
        expect(sendMessage).toHaveBeenLastCalledWith({ name: "save-whole-page", page: PAGE });
        expect(closeWindow).not.toHaveBeenCalled();
    });

    it("asks for a note in every mode, and saves it above the clipped content", async () => {
        selection = SELECTION;
        await rerender();
        const note = () => container.querySelector<HTMLTextAreaElement>(".page-fields > .page-field:first-child > .note-text");
        expect(note()).not.toBeNull();
        expect(document.activeElement).toBe(note());
        expect(note()?.getAttribute("aria-label")).toBe("Your note");
        expect(note()?.getAttribute("placeholder")).toBe("Add a note about this page");
        const icon = container.querySelector<HTMLElement>(".page-fields > .page-field:first-child > .page-field-icon");
        expect(icon?.querySelector("svg.icon path")).not.toBeNull();
        expect(icon?.title).toBe("Your note about the page. It is saved above the clipped content.");

        await type(".note-text", " Worth <b>reading</b>\nlater ");
        await click("Save selection");
        const aside = `<aside class="admonition note"><p>Worth &lt;b&gt;reading&lt;/b&gt;</p><p>later</p></aside>`;
        expect(sendMessage).toHaveBeenLastCalledWith({
            name: "save-selection",
            selection: { ...SELECTION, title: "An article", content: aside + SELECTION.content }
        });

        await click("Page");
        expect(document.activeElement).toBe(note());
        expect(note()?.value).toBe(" Worth <b>reading</b>\nlater ");
        await ctrlEnter(".note-text");
        expect(sendMessage).toHaveBeenLastCalledWith({
            name: "save-whole-page",
            page: { ...PAGE, content: aside + PAGE.content }
        });
        sendMessage.mockClear();
        await ctrlEnter(".page-author");
        expect(sendMessage).toHaveBeenCalledOnce();

        await type(".note-text", " \n ");
        await click("Save page to Trilium");
        expect(sendMessage).toHaveBeenLastCalledWith({ name: "save-whole-page", page: PAGE });
    });

    describe("a PDF", () => {
        const PDF_TAB = { id: 7, title: "Annual report", url: "https://example.com/files/report.pdf" };

        it("offers to save the PDF in Chrome's viewer as a file, or a bookmark of it", async () => {
            pdfTab = true;
            tabsQuery.mockResolvedValueOnce([ PDF_TAB ]);
            await rerender();

            expect(modes()).toEqual([ [ "PDF", "true" ], [ "Bookmark", "false" ] ]);
            expect(headingIcon()).toEqual(pathsOf(iconVariant(FileDetail).content));
            expect(container.querySelector<HTMLInputElement>(".page-title")?.value).toBe("Annual report");
            expect(container.querySelector(".page-meta")?.textContent).toBe("example.com");
            expect(container.querySelector(".clip-hint")?.textContent).toBe("The PDF is saved as a file in Trilium.");
            expect(container.querySelector(".note-text")).toBeNull();
            expect(container.querySelector(".page-author")).toBeNull();
            expect(container.querySelector(".page-content")).toBeNull();
            expect(container.querySelector(".page-body")?.className).toBe("page-body compact");
            expect(placeholder()).toBeUndefined();
            expect(shortcutOf("Save PDF to Trilium").text).toBe("Alt+Shift+S");

            await type(".page-title", "Edited");
            await type(".page-description", " Key   figures ");
            let answerSave: (answer: unknown) => void = () => {};
            sendMessage.mockReturnValueOnce(new Promise((resolve) => answerSave = resolve));
            await click("Save PDF to Trilium");
            expect(sendMessage).toHaveBeenLastCalledWith({
                name: "save-pdf", url: PDF_TAB.url, title: "Edited", description: "Key figures"
            });
            expect(saveStatus()).toEqual({ kind: "callout callout-info save-status", text: "Saving to Trilium…" });
            expect(button("Save PDF to Trilium")?.disabled).toBe(true);
            await ctrlEnter(".page-title");
            expect(sendMessageCalls("save-pdf")).toBe(1);

            answerSave({ noteId: "n1", message: "PDF has been saved to Trilium." });
            await flush();
            expect(saveStatus()).toEqual({
                kind: "callout callout-success save-status", text: "PDF has been saved to Trilium.Open note"
            });
            expect(button("Save PDF to Trilium")?.disabled).toBe(true);
            expect(closeWindow).not.toHaveBeenCalled();

            await click("Bookmark");
            expect(button("Save bookmark")?.disabled).toBe(false);
            expect(container.querySelector(".page-body")?.className).toBe("page-body compact");
            expect(container.querySelector(".note-text")).not.toBeNull();
            expect(container.querySelector(".clip-hint")).toBeNull();
        });

        it("offers it in Firefox's viewer, where the website names the type, keeping out what needs the page", async () => {
            const fetchMock = vi.fn(async () => new Response(null, { headers: { "Content-Type": "application/pdf" } }));
            vi.stubGlobal("fetch", fetchMock);
            executeScript.mockRejectedValueOnce(new Error("Missing host permission for the tab"));
            executeScript.mockRejectedValueOnce(new Error("Missing host permission for the tab"));
            tabsSendMessage.mockRejectedValueOnce(new Error("Could not establish connection."));
            tabsSendMessage.mockRejectedValueOnce(new Error("Could not establish connection."));
            tabsQuery.mockResolvedValueOnce([ { ...PDF_TAB, title: "report.pdf" } ]);
            await rerender();

            expect(fetchMock).toHaveBeenCalledWith(PDF_TAB.url,
                expect.objectContaining({ method: "HEAD", credentials: "include" }));
            expect(container.querySelector(".capture-actions > .no-items")).toBeNull();
            expect(modes()).toEqual([ [ "PDF", "true" ], [ "Bookmark", "false" ] ]);
            expect(button("Area screenshot")?.disabled).toBe(true);
            expect(button("All tabs in this window")?.disabled).toBe(false);

            sendMessage.mockResolvedValueOnce({ error: "Saving a PDF needs a newer version of Trilium." });
            await click("Save PDF to Trilium");
            expect(sendMessage).toHaveBeenLastCalledWith({ name: "save-pdf", url: PDF_TAB.url, title: "report.pdf" });
            await flush();
            expect(saveStatus()).toEqual({
                kind: "callout callout-error save-status",
                text: "Saving a PDF needs a newer version of Trilium."
            });

            sendMessage.mockResolvedValueOnce(undefined);
            await click("Save PDF to Trilium");
            await flush();
            expect(saveStatus()?.text)
                .toBe("Saving to Trilium failed: the extension's background script gave no answer.");
            expect(sendMessageCalls("save-pdf")).toBe(2);
            expect(closeWindow).not.toHaveBeenCalled();
        });
    });

    it("stays open while a save runs, then shows how it went in place of the clipped notice", async () => {
        expect(connect).toHaveBeenCalledWith({ name: "popup" });
        await receive({ name: "trilium-previously-visited", searchNote: { status: "found", noteId: "clipped" } });
        expect(container.querySelector(".already-visited")).not.toBeNull();
        let answerSave: (answer: unknown) => void = () => {};
        sendMessage.mockReturnValueOnce(new Promise((resolve) => answerSave = resolve));
        await click("All tabs in this window");
        expect(saveStatus()).toEqual({ kind: "callout callout-info save-status", text: "Saving to Trilium…" });
        expect(container.querySelector(".already-visited")).toBeNull();
        expect(container.querySelector(".capture-actions .save-status")).toBeNull();
        for (const action of captureButtons()) {
            expect(action.disabled, action.getAttribute("aria-label") ?? "").toBe(true);
        }
        expect(button("Area screenshot")?.title).toBe("Trilium is saving the last clipping.");

        answerSave({ noteId: "n1", message: "2 links have been saved to Trilium.", tabIds: [ 7, 8 ] });
        await flush();
        expect(saveStatus()).toEqual({
            kind: "callout callout-success save-status",
            text: "2 links have been saved to Trilium.Open noteClose saved tabs"
        });
        expect(captureButtons().every((action) => !action.disabled)).toBe(true);
        await clickLink("Close saved tabs");
        expect(sendMessage).toHaveBeenLastCalledWith({ name: "closeTabs", tabIds: [ 7, 8 ] });
        expect(closeWindow).toHaveBeenCalledOnce();

        sendMessage.mockResolvedValueOnce({ noteId: "n2", message: "Page has been saved to Trilium." });
        await click("Save page to Trilium");
        await flush();
        expect(saveStatus()?.text).toBe("Page has been saved to Trilium.Open note");
        expect(button("Save page to Trilium")?.disabled).toBe(true);
        expect(button("All tabs in this window")?.disabled).toBe(false);
        await click("Whole page");
        await flush();
        expect(button("Save page to Trilium")?.disabled).toBe(false);
        await click("Article");
        expect(button("Save page to Trilium")?.disabled).toBe(true);
        await clickLink("Open note");
        expect(sendMessage).toHaveBeenLastCalledWith({ name: "openNoteInTrilium", noteId: "n2" });
        expect(closeWindow).toHaveBeenCalledTimes(2);

        await act(() => render(null, container));
        expect(disconnect).toHaveBeenCalledOnce();
    });

    it("renders itself into the page's root element", async () => {
        const root = document.createElement("div");
        root.id = "root";
        document.body.appendChild(root);
        vi.resetModules();

        await import("./main");

        expect(root.querySelector(".popup")).not.toBeNull();
        root.remove();
    });
});

describe("previewDocument", () => {
    it("loads the page's images from the website, and keeps the rest of its content", () => {
        const doc = new DOMParser().parseFromString(previewDocument(PAGE), "text/html");
        expect([ ...doc.querySelectorAll("img") ].map((img) => img.getAttribute("src")))
            .toEqual([ "https://example.com/a.png", "https://example.com/b.png" ]);
        expect(doc.querySelector("p")?.textContent).toBe("Body");
        expect(doc.querySelector("style")?.textContent).toContain("max-width: 100%");
    });

    it("leaves the frame nothing to navigate to, by mouse, keyboard or refresh", () => {
        const doc = new DOMParser().parseFromString(previewDocument({
            content: `<p>See <a href="https://example.com/next">the next page</a></p>`
                + `<meta http-equiv="refresh" content="0; url=https://example.com/elsewhere">`
                + `<map><area href="https://example.com/area" alt="Area"></map>`,
            images: []
        }), "text/html");
        const link = doc.querySelector("p a");
        expect(link?.textContent).toBe("the next page");
        expect(link?.hasAttribute("href")).toBe(false);
        expect(doc.querySelector("area")?.hasAttribute("href")).toBe(false);
        expect(doc.querySelector("meta[http-equiv]")).toBeNull();
    });

    it("shows an embedded YouTube video as a chip, and drops other embedded content", () => {
        const doc = new DOMParser().parseFromString(previewDocument({
            content: `<p>Intro</p>`
                + `<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1"></iframe>`
                + `<iframe src="https://www.youtube-nocookie.com/embed/jNQXAC9IVRw"></iframe>`
                + `<iframe src="https://player.vimeo.com/video/76979871"></iframe>`
                + `<iframe></iframe>`,
            images: []
        }), "text/html");
        expect(doc.querySelector("iframe")).toBeNull();
        expect(doc.querySelector("p")?.textContent).toBe("Intro");

        const chips = [ ...doc.querySelectorAll(".embed-chip") ];
        expect(chips.map((chip) => [ ...chip.children ].map((child) => child.textContent))).toEqual([
            [ "", "YouTube video", "youtu.be/dQw4w9WgXcQ" ],
            [ "", "YouTube video", "youtu.be/jNQXAC9IVRw" ]
        ]);
        expect(chips[0]?.querySelector("svg path")).not.toBeNull();
    });

    it("colors links with the theme's link colors, which the frame cannot read from the popup", () => {
        const theme = readFileSync(join(import.meta.dirname, "../../assets/theme.css"), "utf8");
        const [ light, dark ] = [ ...theme.matchAll(/--link-color: (#[0-9a-f]+);/g) ].map((match) => match[1]);
        expect(light).toBeDefined();
        expect(dark).toBeDefined();
        expect(previewDocument(PAGE)).toContain(`color: light-dark(${light}, ${dark})`);
    });
});

describe("shortcutsByCommand", () => {
    it("keeps only the commands that have a shortcut", () => {
        expect(shortcutsByCommand([
            { name: "saveWholePage", shortcut: "Alt+Shift+S" },
            { name: "saveTabs", shortcut: "" },
            { name: "saveSelection" },
            { shortcut: "Ctrl+Q" }
        ])).toEqual({ saveWholePage: "Alt+Shift+S" });
    });
});

describe("icons", () => {
    it("draws each button's Boxicon inline, hidden from assistive technology", async () => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        Object.assign(fakeBrowser.commands, { getAll: getAllCommands });
        Object.assign(fakeBrowser.tabs, { query: tabsQuery, sendMessage: tabsSendMessage });
        Object.assign(fakeBrowser, { scripting: { executeScript } });
        const container = document.createElement("div");
        await act(() => render(<Popup />, container));

        const icons = container.querySelectorAll("button > svg.icon");
        expect(icons).toHaveLength(8);
        for (const icon of icons) {
            expect(icon.getAttribute("aria-hidden")).toBe("true");
            expect(icon.getAttribute("viewBox")).toBe("0 0 24 24");
            expect(icon.querySelector("path")).not.toBeNull();
        }
        for (const button of container.querySelectorAll("button.icon-action")) {
            expect(button.getAttribute("aria-label")).toBe(button.getAttribute("title"));
        }

        await act(() => render(null, container));
    });

    it("uses the outlined variant, and refuses an icon that has none", () => {
        expect(iconVariant(Crop)).toBe(Crop.packs.basic);
        expect(() => iconVariant({ name: "brand", defaultPack: "brands", packs: {} }))
            .toThrow("Boxicons has no basic variant of 'brand'.");
    });
});

describe("textToHtml", () => {
    it("escapes the text and makes a paragraph of each line", () => {
        expect(textToHtml("a & <b>\nc")).toBe("<p>a &amp; &lt;b&gt;</p><p>c</p>");
        expect(textToHtml("")).toBe("<p></p>");
    });
});

async function receive(message: object) {
    await act(async () => {
        await fakeBrowser.runtime.onMessage.trigger(message, {}, () => {});
    });
}

/** The save in progress or how the last one went, as the popup shows it: its classes and its text. */
function saveStatus() {
    const status = container.querySelector(".popup > .notices:first-child > .save-status");
    return status ? { kind: status.className, text: status.textContent } : undefined;
}

function sendMessageCalls(name: string) {
    return sendMessage.mock.calls.filter(([ message ]) => (message as { name?: string }).name === name).length;
}

async function clickLink(text: string) {
    const link = [ ...container.querySelectorAll("a") ].find((a) => a.textContent === text);
    expect(link, text).toBeDefined();
    await act(() => link?.click());
}

/** Lets the promises the effects start, such as reading the shortcuts, settle. */
async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve));
    });
}

/** The button with the given label, or with that `aria-label` when it shows only an icon. */
function button(text: string) {
    const found = [ ...container.querySelectorAll("button") ].find((b) => {
        const label = b.querySelector(".action-label")?.textContent ?? b.textContent?.trim();
        return label === text || b.getAttribute("aria-label") === text;
    });
    expect(found, text).toBeDefined();
    return found;
}

/** Renders the popup again, so that it extracts the page anew. */
async function rerender() {
    await act(() => render(null, container));
    await act(() => render(<Popup />, container));
    await flush();
}

async function type(selector: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(selector);
    expect(input, selector).not.toBeNull();
    await act(() => {
        if (!input) return;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

function unavailable() {
    const empty = container.querySelector(".capture-actions > .no-items");
    expect(empty).not.toBeNull();
    expect(empty?.querySelector("svg.icon path")).not.toBeNull();
    return empty?.textContent;
}

async function ctrlEnter(selector: string) {
    const field = container.querySelector(selector);
    expect(field, selector).not.toBeNull();
    await act(async () => {
        field?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    });
}

function placeholder() {
    return container.querySelector(".page-body > .page-preview-placeholder")?.textContent;
}

async function click(text: string) {
    const target = button(text);
    await act(() => target?.click());
}

/** The shortcut shown on a button: its text, and the keys drawn as separate key caps. */
function shortcutOf(text: string) {
    const shortcut = button(text)?.querySelector(".shortcut");
    expect(shortcut, text).not.toBeNull();
    return {
        text: shortcut?.textContent,
        keys: [ ...shortcut?.querySelectorAll(":scope > kbd") ?? [] ].map((key) => key.textContent)
    };
}

function toolbar() {
    return [ ...container.querySelectorAll<HTMLButtonElement>(".toolbar-action") ].map((action) => {
        expect(action.getAttribute("aria-label")).toBe(action.title.replace(/ \(.*\)$/, ""));
        return { label: action.querySelector(".action-label")?.textContent, title: action.title };
    });
}

/** The clip mode switch's options, each with whether it is the current one. */
function modes() {
    return [ ...container.querySelectorAll(".clip-mode button") ]
        .map((option) => [ option.textContent, option.getAttribute("aria-pressed") ]);
}

/** The path data of the icon in the preview heading. */
function headingIcon() {
    const icon = container.querySelector(".page-heading .page-icon svg.icon");
    expect(icon).not.toBeNull();
    return pathsOf(icon?.innerHTML ?? "");
}

/** The path data of an icon's markup, which the DOM serializes differently from Boxicons. */
function pathsOf(markup: string) {
    return [ ...markup.matchAll(/ d="([^"]*)"/g) ].map(([ , d ]) => d);
}

/** How many times the popup read the whole page. */
function wholePageReads() {
    return executeScript.mock.calls.filter(([ injection ]) => injection.args?.[0] === "wholePage").length;
}

/** The page variant switch's options, each with whether it is the current one and whether it is disabled. */
function variants() {
    return [ ...container.querySelectorAll<HTMLButtonElement>(".page-body > .page-variant button") ]
        .map((option) => [ option.textContent, option.getAttribute("aria-pressed"), option.disabled ]);
}


function frameDocument() {
    const frame = container.querySelector(".page-body iframe.page-content");
    expect(frame).not.toBeNull();
    return frame?.getAttribute("srcdoc");
}

/** The class names of the preview card's parts, in order. */
function cardParts() {
    const card = container.querySelector(".page-preview");
    expect(card).not.toBeNull();
    return [ ...card?.children ?? [] ].map((part) => part.className);
}

function captureButtons() {
    return [ ...container.querySelectorAll<HTMLButtonElement>(".capture-actions button") ]
        .filter((button) => !button.closest(".clip-mode, .page-variant"));
}

function status() {
    return {
        dot: container.querySelector<HTMLElement>(".connection > span > .status-dot")?.className,
        text: container.querySelector(".connection > span")?.textContent
    };
}

function publishedDate() {
    return container.querySelector(".page-fields .page-published-date")?.textContent;
}

function modifiedDate() {
    return container.querySelector(".page-fields .page-modified-date")?.textContent;
}
