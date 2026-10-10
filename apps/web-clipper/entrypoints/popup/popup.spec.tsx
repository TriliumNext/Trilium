import Crop from "@boxicons/js/icons/Crop";
import { readFileSync } from "fs";
import { join } from "path";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { basicIcon, parseLinkNote, Popup, previewDocument, shortcutsByCommand, textToHtml } from "./main";

const DISCONNECTED = "This action can't be performed without active connection to Trilium.";

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
    labels: { publishedDate: "2024-05-01" }
};
const tabsQuery = vi.fn(async (): Promise<{ id?: number }[]> => [ { id: 7 } ]);
const tabsSendMessage = vi.fn(async (_tabId: number, _message: object): Promise<unknown> => PAGE);
const closeWindow = vi.fn();
let container: HTMLElement;

describe("popup", () => {
    beforeEach(async () => {
        fakeBrowser.reset();
        Object.assign(fakeBrowser.runtime, { sendMessage, openOptionsPage });
        Object.assign(fakeBrowser.commands, { getAll: getAllCommands });
        Object.assign(fakeBrowser.tabs, { query: tabsQuery, sendMessage: tabsSendMessage });
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
        expect(button("Crop screenshot")?.title).toBe("Crop screenshot (Ctrl+Shift+E)");
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
        expect(container.querySelector(".callout-warning")?.textContent).toContain("Please update Trilium Notes");
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
        expect(container.querySelector(".not-found strong")?.textContent).toBe("Trilium was not found.");
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
        expect(container.querySelector(".already-visited span")?.textContent).toBe("Web page already clipped.");
        const link = container.querySelector<HTMLAnchorElement>(".already-visited a");
        expect(link?.textContent).toBe("Open in Trilium");

        await act(() => link?.click());
        expect(sendMessage).toHaveBeenCalledWith({ name: "openNoteInTrilium", noteId: "clipped" });

        await receive({ name: "trilium-previously-visited", searchNote: { status: "not-found", noteId: null } });
        expect(container.querySelector(".already-visited")).toBeNull();
    });

    it("sends the capture actions, closing the popup for screenshots", async () => {
        await click("Crop screenshot");
        expect(sendMessage).toHaveBeenCalledWith({ name: "save-cropped-screenshot" });
        await click("Visible area screenshot");
        expect(sendMessage).toHaveBeenCalledWith({ name: "save-whole-screenshot" });
        expect(closeWindow).toHaveBeenCalledTimes(2);

        await click("All tabs in window");
        expect(sendMessage).toHaveBeenCalledWith({ name: "save-tabs" });
        await click("Check the connection again");
        expect(sendMessage).toHaveBeenCalledWith({ name: "trigger-trilium-search" });
        await click("Options");
        expect(openOptionsPage).toHaveBeenCalledOnce();
        expect(closeWindow).toHaveBeenCalledTimes(2);

        const openWindow = vi.spyOn(window, "open").mockImplementation(() => null);
        await click("Help");
        expect(openWindow).toHaveBeenCalledWith("https://docs.triliumnotes.org/user-guide/setup/web-clipper", "_blank");
    });

    it("shows the keyboard shortcut of each action that has one", () => {
        expect(getAllCommands).toHaveBeenCalledOnce();
        expect(shortcutOf("Save page to Trilium")).toBe("Alt+Shift+S");
        expect(toolbar()).toEqual([
            { label: "Crop", title: "Crop screenshot (Ctrl+Shift+E)" },
            { label: "Screenshot", title: "Visible area screenshot" },
            { label: "Note", title: "Link with a note" },
            { label: "Tabs", title: "All tabs in window" }
        ]);
        expect(container.querySelectorAll(".toolbar-action kbd")).toHaveLength(0);
    });

    it("previews the readable page with its title, source and date", () => {
        expect(tabsQuery).toHaveBeenCalledWith({ active: true, currentWindow: true });
        expect(tabsSendMessage).toHaveBeenCalledWith(7, { name: "trilium-save-page" });

        expect(cardParts()).toEqual([ "page-heading", "page-body", "btn btn-primary primary-action" ]);
        const heading = container.querySelector(".page-heading");
        expect(heading).not.toBeNull();
        expect(heading?.querySelector(".page-icon svg path")).not.toBeNull();
        expect(heading?.querySelector<HTMLInputElement>(".page-title")?.value).toBe("An article");
        expect(heading?.querySelector(".page-meta")?.textContent).toBe("example.com · Published 2024-05-01");
        const frame = container.querySelector<HTMLIFrameElement>(".page-body iframe.page-content");
        expect(frame?.getAttribute("sandbox")).toBe("");
        expect(frame?.getAttribute("srcdoc")).toBe(previewDocument(PAGE));
        expect(button("Save page to Trilium")?.disabled).toBe(false);
    });

    it("saves the extracted page with the edited title, and closes", async () => {
        await type(".page-title", "  My title ");
        await click("Save page to Trilium");
        expect(sendMessage).toHaveBeenCalledWith({ name: "save-whole-page", page: { ...PAGE, title: "My title" } });
        expect(closeWindow).toHaveBeenCalledOnce();

        await type(".page-title", "   ");
        await click("Save page to Trilium");
        expect(sendMessage).toHaveBeenLastCalledWith({ name: "save-whole-page", page: PAGE });
    });

    it("leaves out the date of a page that has none", async () => {
        tabsSendMessage.mockResolvedValueOnce({ ...PAGE, labels: {} });
        await rerender();
        expect(container.querySelector(".page-meta")?.textContent).toBe("example.com");
    });

    it("says so while the page is read, and when it cannot be", async () => {
        let resolvePage: (page: unknown) => void = () => {};
        tabsSendMessage.mockReturnValueOnce(new Promise((resolve) => {
            resolvePage = resolve;
        }));
        await rerender();
        expect(placeholder()).toBe("Reading the page…");
        expect(cardParts()).toEqual([ "page-body", "btn btn-primary primary-action" ]);
        expect(button("Save page to Trilium")?.disabled).toBe(true);

        resolvePage(undefined);
        await flush();
        expect(placeholder()).toBe("This page cannot be saved as an article.");
        expect(button("Save page to Trilium")?.disabled).toBe(true);
        expect(container.querySelector("iframe")).toBeNull();

        tabsSendMessage.mockRejectedValueOnce(new Error("Could not establish connection."));
        await rerender();
        expect(placeholder()).toBe("This page cannot be saved as an article.");

        tabsQuery.mockResolvedValueOnce([ {} ]);
        await rerender();
        expect(placeholder()).toBe("This page cannot be saved as an article.");
        expect(tabsSendMessage).toHaveBeenCalledTimes(3);
    });

    it("tells the user when the background script cannot be reached", async () => {
        const alertMock = vi.fn();
        vi.stubGlobal("alert", alertMock);
        sendMessage.mockRejectedValueOnce(new Error("Receiving end does not exist."));

        await click("All tabs in window");

        expect(alertMock).toHaveBeenCalledWith("Calling browser runtime failed. Refreshing page might help.");
    });

    it("writes a link note in a view of its own, and goes back to the actions", async () => {
        expect(container.querySelector("textarea")).toBeNull();
        await click("Link with a note");
        const textArea = container.querySelector("textarea");
        expect(textArea).not.toBeNull();
        expect(document.activeElement).toBe(textArea);
        expect(captureButtons()).toHaveLength(0);
        expect(container.querySelector(".view-header h4")?.textContent).toBe("Link with a note");
        expect(textArea?.placeholder).toBe("The first sentence becomes the note's title, the rest its text.");
        expect(shortcutOf("Save")).toBe("Ctrl+Enter");
        expect(button("Save")?.querySelectorAll("kbd")).toHaveLength(1);
        expect(container.querySelector(".hint")).toBeNull();

        await click("Back");
        expect(container.querySelector("textarea")).toBeNull();
        expect(captureButtons()).toHaveLength(5);
        expect(closeWindow).not.toHaveBeenCalled();
    });

    it("saves a link with a note on Ctrl+Enter", async () => {
        await click("Link with a note");
        const textArea = container.querySelector("textarea");

        await act(() => {
            if (!textArea) return;
            textArea.value = "Read later. It has <b>tips</b>\nand more";
            textArea.dispatchEvent(new Event("input", { bubbles: true }));
        });
        sendMessage.mockResolvedValueOnce(true);
        await act(async () => {
            textArea?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
        });
        expect(sendMessage).toHaveBeenCalledWith({
            name: "save-link-with-note",
            title: "Read later.",
            content: "<p>It has &lt;b&gt;tips&lt;/b&gt;</p><p>and more</p>"
        });
        expect(closeWindow).toHaveBeenCalledOnce();
    });

    it("keeps the note open when it could not be saved, and keeps the page title on request", async () => {
        await click("Link with a note");
        const textArea = container.querySelector("textarea");
        const keepTitle = container.querySelector<HTMLInputElement>("input[type=checkbox]");
        expect(textArea).not.toBeNull();
        expect(keepTitle?.checked).toBe(false);

        await act(() => {
            if (!textArea || !keepTitle) return;
            textArea.value = "First. Second.";
            textArea.dispatchEvent(new Event("input", { bubbles: true }));
            keepTitle.click();
        });
        expect(keepTitle?.checked).toBe(true);
        expect(textArea?.placeholder).toBe("The note's text.");

        await act(async () => {
            textArea?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        });
        expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ name: "save-link-with-note" }));

        sendMessage.mockResolvedValueOnce(undefined);
        await click("Save");
        expect(sendMessage).toHaveBeenCalledWith({
            name: "save-link-with-note",
            title: "",
            content: "<p>First. Second.</p>"
        });
        expect(textArea?.value).toBe("First. Second.");
        expect(closeWindow).not.toHaveBeenCalled();
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
        expect(basicIcon(Crop)).toBe(Crop.packs.basic);
        expect(() => basicIcon({ name: "brand", defaultPack: "brands", packs: {} }))
            .toThrow("Boxicons has no basic variant of 'brand'.");
    });
});

describe("parseLinkNote", () => {
    it("takes the first sentence or line as the title, unless the page title is kept", () => {
        expect(parseLinkNote("   ", false)).toEqual({ title: "", content: "" });
        expect(parseLinkNote(" Great read! Worth it. ", false)).toEqual({ title: "Great read!", content: "Worth it." });
        expect(parseLinkNote("First line\nsecond line", false)).toEqual({ title: "First line", content: "second line" });
        expect(parseLinkNote("Just a title", false)).toEqual({ title: "Just a title", content: "" });
        expect(parseLinkNote(" Great read! Worth it. ", true)).toEqual({ title: "", content: "Great read! Worth it." });
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

function placeholder() {
    return container.querySelector(".page-body > .page-preview-placeholder")?.textContent;
}

async function click(text: string) {
    const target = button(text);
    await act(() => target?.click());
}

function shortcutOf(text: string) {
    return button(text)?.querySelector("kbd")?.textContent;
}

function toolbar() {
    return [ ...container.querySelectorAll<HTMLButtonElement>(".toolbar-action") ].map((action) => {
        expect(action.getAttribute("aria-label")).toBe(action.title.replace(/ \(.*\)$/, ""));
        return { label: action.querySelector(".action-label")?.textContent, title: action.title };
    });
}

/** The class names of the preview card's parts, in order. */
function cardParts() {
    const card = container.querySelector(".page-preview");
    expect(card).not.toBeNull();
    return [ ...card?.children ?? [] ].map((part) => part.className);
}

function captureButtons() {
    return [ ...container.querySelectorAll<HTMLButtonElement>(".capture-actions button") ];
}

function status() {
    return {
        dot: container.querySelector<HTMLElement>(".connection > span > .status-dot")?.className,
        text: container.querySelector(".connection > span")?.textContent
    };
}
