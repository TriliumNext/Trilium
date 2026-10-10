import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import Crop from "@boxicons/js/icons/Crop";

import { basicIcon, parseLinkNote, Popup, textToHtml } from "./main";

const sendMessage = vi.fn(async (_message: object): Promise<unknown> => undefined);
const openOptionsPage = vi.fn(async () => {});
const closeWindow = vi.fn();
let container: HTMLElement;

describe("popup", () => {
    beforeEach(async () => {
        fakeBrowser.reset();
        Object.assign(fakeBrowser.runtime, { sendMessage, openOptionsPage });
        vi.spyOn(window, "close").mockImplementation(closeWindow);
        vi.spyOn(console, "log").mockImplementation(() => {});

        container = document.createElement("div");
        document.body.appendChild(container);
        await act(() => render(<Popup />, container));
    });

    afterEach(async () => {
        await act(() => render(null, container));
        container.remove();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("asks for the connection status and shows it", async () => {
        expect(sendMessage).toHaveBeenCalledWith({ name: "send-trilium-search-status" });
        expect(statusText()).toBe("unknown");
        expect(captureButtons().every((button) => !button.disabled)).toBe(true);

        await receive({ name: "trilium-search-status", triliumSearch: { status: "not-found" } });
        expect(container.querySelector(".status-error")?.textContent).toBe("Not found");
        for (const button of captureButtons()) {
            expect(button.disabled).toBe(true);
            expect(button.title).toBe("This action can't be performed without active connection to Trilium.");
        }
        expect(sendMessage).not.toHaveBeenCalledWith({ name: "trigger-trilium-search-note-url" });

        await receive({ name: "trilium-search-status", triliumSearch: { status: "found-desktop", port: 37840, url: "" } });
        expect(container.querySelector(".status-ok")?.textContent).toBe("Connected on port 37840");
        expect(captureButtons().every((button) => !button.disabled && !button.title)).toBe(true);
        expect(sendMessage).toHaveBeenCalledWith({ name: "trigger-trilium-search-note-url" });

        await receive({
            name: "trilium-search-status",
            triliumSearch: { status: "found-server", url: "https://trilium.example", token: "t" }
        });
        const server = container.querySelector<HTMLElement>(".status-ok");
        expect(server?.textContent).toBe("Connected to the server");
        expect(server?.title).toBe("Connected to https://trilium.example");

        await receive({
            name: "trilium-search-status",
            triliumSearch: { status: "version-mismatch", extensionMajor: 2, triliumMajor: 1 }
        });
        expect(container.querySelector(".status-warning")?.textContent).toContain("Please update Trilium Notes");
        expect(captureButtons().every((button) => !button.disabled)).toBe(true);

        await receive({
            name: "trilium-search-status",
            triliumSearch: { status: "version-mismatch", extensionMajor: 1, triliumMajor: 2 }
        });
        expect(container.querySelector(".status-warning")?.textContent).toContain("Please update this extension");

        await receive({ name: "trilium-search-status", triliumSearch: { status: "searching" } });
        expect(statusText()).toBe("searching");
        expect(captureButtons().every((button) => button.disabled)).toBe(true);

        await receive({ name: "unrelated" });
        expect(statusText()).toBe("searching");
    });

    it("offers to open a page that was already clipped", async () => {
        await receive({ name: "trilium-previously-visited", searchNote: { status: "found", noteId: "clipped" } });
        expect(container.querySelector(".already-visited")?.textContent)
            .toBe("Web page already clipped. Open in Trilium.");

        await act(() => container.querySelector<HTMLAnchorElement>(".already-visited a")?.click());
        expect(sendMessage).toHaveBeenCalledWith({ name: "openNoteInTrilium", noteId: "clipped" });

        await receive({ name: "trilium-previously-visited", searchNote: { status: "not-found", noteId: null } });
        expect(container.querySelector(".already-visited")?.textContent).toBe("");
    });

    it("sends the capture actions, closing the popup for screenshots", async () => {
        await click("Crop screenshot");
        expect(sendMessage).toHaveBeenCalledWith({ name: "save-cropped-screenshot" });
        await click("Save whole screenshot");
        expect(sendMessage).toHaveBeenCalledWith({ name: "save-whole-screenshot" });
        expect(closeWindow).toHaveBeenCalledTimes(2);

        await click("Save whole page");
        expect(sendMessage).toHaveBeenCalledWith({ name: "save-whole-page" });
        await click("Save window's tabs as a list");
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

    it("tells the user when the background script cannot be reached", async () => {
        const alertMock = vi.fn();
        vi.stubGlobal("alert", alertMock);
        sendMessage.mockRejectedValueOnce(new Error("Receiving end does not exist."));

        await click("Save whole page");

        expect(alertMock).toHaveBeenCalledWith("Calling browser runtime failed. Refreshing page might help.");
    });

    it("keeps the note open when it could not be saved, and keeps the page title on request", async () => {
        await click("Save link with a note");
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

    it("saves a link with a note on Ctrl+Enter, and cancels it", async () => {
        expect(container.querySelector("textarea")).toBeNull();
        await click("Save link with a note");
        const textArea = container.querySelector("textarea");
        expect(textArea).not.toBeNull();
        expect(document.activeElement).toBe(textArea);

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

        await click("Cancel");
        expect(container.querySelector("textarea")).toBeNull();
        expect(closeWindow).toHaveBeenCalledTimes(2);
    });
});

describe("icons", () => {
    it("draws each button's Boxicon inline, hidden from assistive technology", async () => {
        vi.spyOn(console, "log").mockImplementation(() => {});
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

/** Clicks the button with the given label, or with that `aria-label` when it shows only an icon. */
async function click(text: string) {
    const button = [ ...container.querySelectorAll("button") ]
        .find((b) => b.textContent?.trim() === text || b.getAttribute("aria-label") === text);
    expect(button, text).toBeDefined();
    await act(() => button?.click());
}

function captureButtons() {
    return [ ...container.querySelectorAll<HTMLButtonElement>(".capture-buttons button") ];
}

function statusText() {
    return container.querySelector(".connection > div")?.textContent?.replace("Status: ", "");
}
