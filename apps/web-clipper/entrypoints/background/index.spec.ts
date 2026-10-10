import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

const { facade, TriliumError } = vi.hoisted(() => ({
    facade: {
        callService: vi.fn<(method: string, path: string, body?: unknown) => Promise<any>>(),
        triggerSearchForTrilium: vi.fn(),
        sendTriliumSearchStatusToPopup: vi.fn(),
        triggerSearchNoteByUrl: vi.fn()
    },
    TriliumError: class extends Error {

        constructor(readonly reason: string, message: string) {
            super(message);
        }

    }
}));

vi.mock("./trilium_server_facade", () => ({
    TriliumError,
    default: class {

        callService = facade.callService;
        triggerSearchForTrilium = facade.triggerSearchForTrilium;
        sendTriliumSearchStatusToPopup = facade.sendTriliumSearchStatusToPopup;
        triggerSearchNoteByUrl = facade.triggerSearchNoteByUrl;

    }
}));

import background from "./index";

type Tab = { id?: number, title?: string, url?: string };
type ContextMenuClick = {
    menuItemId: string,
    pageUrl?: string,
    srcUrl?: string,
    linkUrl?: string,
    linkText?: string
};

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const CROPPED_PNG = "data:image/png;base64,Q1JPUA==";
const PNG_DATA_URL = /^data:image\/png;base64,/;
const PAGE_URL = "https://example.com/page";
const MENU_URL = "https://example.com/menu";
const ACTIVE_TAB: Tab = { id: 7, title: "Active page", url: PAGE_URL };
const TRILIUM_FAILURE = new TriliumError("not-found", "Trilium was not found.");
const FAILURE_TOAST = { name: "toast", message: "Trilium was not found.", noteId: null };
const GENERIC_FAILURE_TOAST = { name: "toast", message: expect.any(String), noteId: null };

let onCommand: (command: string) => Promise<void>;
let onContextMenuClicked: (info: ContextMenuClick) => Promise<void>;
let tabs: Tab[];
let tabMessageHandler: (message: { name: string }) => unknown;
const tabsSendMessage = vi.fn(
    (_tabId: number, message: { name: string }) => Promise.resolve(tabMessageHandler(message)));
const contextMenusCreate = vi.fn();
const contextMenusRemoveAll = vi.fn(async () => {});
const getContexts = vi.fn(async (): Promise<unknown[]> => []);
const createDocument = vi.fn(async () => {});
const runtimeSendMessage = vi.fn(async (_message: unknown): Promise<unknown> => PNG);
const fetchMock = vi.fn(
    async (_url: string) => new Response(new Blob([ "img" ], { type: "image/png" })));

describe("background", () => {
    beforeEach(async () => {
        fakeBrowser.reset();
        tabs = [ ACTIVE_TAB ];
        tabMessageHandler = () => undefined;
        facade.callService.mockResolvedValue({ noteId: "saved" });
        vi.stubGlobal("fetch", fetchMock);
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});

        Object.assign(fakeBrowser.commands.onCommand, {
            addListener: (listener: typeof onCommand) => {
                onCommand = listener;
            }
        });
        Object.assign(fakeBrowser.contextMenus, {
            create: contextMenusCreate,
            removeAll: contextMenusRemoveAll,
            onClicked: {
                addListener: (listener: typeof onContextMenuClicked) => {
                    onContextMenuClicked = listener;
                }
            }
        });
        Object.assign(fakeBrowser.tabs, {
            query: async ({ active }: { active?: boolean }) => (active ? tabs.slice(0, 1) : tabs),
            sendMessage: tabsSendMessage,
            getZoom: async () => 1.5,
            captureVisibleTab: async () => PNG
        });
        Object.assign(fakeBrowser.runtime, { getContexts, sendMessage: runtimeSendMessage });
        Object.assign(fakeBrowser, { offscreen: { createDocument } });

        background.main();
        await vi.waitFor(() => expect(contextMenusCreate).toHaveBeenCalledTimes(6));
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("registers the context menu items once", () => {
        expect(contextMenusRemoveAll).toHaveBeenCalledBefore(contextMenusCreate);
        expect(contextMenusCreate.mock.calls.map(([ item ]) => item.id)).toEqual([
            "trilium-save-selection",
            "trilium-save-cropped-screenshot",
            "trilium-save-whole-screenshot",
            "trilium-save-page",
            "trilium-save-link",
            "trilium-save-image"
        ]);
    });

    describe("saving the selection", () => {
        it("inlines the images, saves a clipping and shows a toast", async () => {
            tabMessageHandler = () => ({
                title: "Page",
                content: `<img src="i2"><img src="i3"><img src="i4">`,
                images: [
                    { imageId: "i2", src: "https://example.com/a.png" },
                    { imageId: "i3", src: "data:image/jpeg;base64,/9j/4AAQ" },
                    { imageId: "i4", src: "data:image/;base64,AAAA" }
                ]
            });

            await onContextMenuClicked({ menuItemId: "trilium-save-selection" });

            expect(tabsSendMessage).toHaveBeenCalledWith(7, { name: "trilium-save-selection" });
            expect(facade.callService).toHaveBeenCalledWith("POST", "clippings", {
                title: "Page",
                content: `<img src="i2"><img src="i3"><img src="i4">`,
                images: [
                    {
                        imageId: "i2",
                        src: "https://example.com/a.png",
                        dataUrl: expect.stringMatching(PNG_DATA_URL)
                    },
                    {
                        imageId: "i3",
                        src: "inline.jpeg",
                        dataUrl: "data:image/jpeg;base64,/9j/4AAQ"
                    },
                    {
                        imageId: "i4",
                        src: "data:image/;base64,AAAA",
                        dataUrl: "data:image/;base64,AAAA"
                    }
                ]
            });
            expect(await lastToast()).toMatchObject({
                name: "toast",
                message: "Selection has been saved to Trilium.",
                noteId: "saved",
                tabIds: null
            });
        });

        it("links the images it cannot download to their website and says so", async () => {
            fetchMock
                .mockRejectedValueOnce(new Error("blocked"))
                .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }))
                .mockResolvedValueOnce(new Response("<html>", { headers: { "Content-Type": "text/html" } }));
            tabMessageHandler = () => ({
                title: "Page",
                content: `<img src="i1"><img src="i2"><img src="i3"><img src="i4">`,
                images: [
                    { imageId: "i1", src: "https://example.com/blocked.png" },
                    { imageId: "i2", src: "https://example.com/forbidden.png?a=1&b=\"2\"" },
                    { imageId: "i3", src: "https://example.com/page.html" },
                    { imageId: "i4", src: "https://example.com/ok.png" }
                ]
            });

            await onContextMenuClicked({ menuItemId: "trilium-save-selection" });

            expect(lastPayload()).toEqual({
                title: "Page",
                content: `<img src="https://example.com/blocked.png">`
                    + `<img src="https://example.com/forbidden.png?a=1&amp;b=&quot;2&quot;">`
                    + `<img src="https://example.com/page.html"><img src="i4">`,
                images: [ {
                    imageId: "i4",
                    src: "https://example.com/ok.png",
                    dataUrl: expect.stringMatching(PNG_DATA_URL)
                } ]
            });
            expect(console.error).toHaveBeenCalledTimes(3);
            expect(await lastToast()).toMatchObject({
                message: "Selection has been saved to Trilium, but 3 images could not be downloaded.",
                noteId: "saved"
            });
        });

        it("counts an image the browser cannot read as not downloaded", async () => {
            vi.stubGlobal("FileReader", class {

                result = null;
                onloadend: (() => void) | null = null;

                readAsDataURL() {
                    setTimeout(() => this.onloadend?.());
                }

            });
            tabMessageHandler = () => ({
                title: "Page",
                content: `<img src="i1">`,
                images: [ { imageId: "i1", src: "https://example.com/a.png" } ]
            });

            await onContextMenuClicked({ menuItemId: "trilium-save-selection" });

            expect(lastPayload()).toMatchObject({ content: `<img src="https://example.com/a.png">`, images: [] });
            expect(await lastToast()).toMatchObject({
                message: "Selection has been saved to Trilium, but 1 image could not be downloaded."
            });
        });

        it("is bound to the keyboard shortcut and shows why saving failed", async () => {
            tabMessageHandler = () => ({ title: "Page", content: "x" });
            await onCommand("saveSelection");
            expect(await lastToast()).toMatchObject({ message: "Selection has been saved to Trilium." });

            facade.callService.mockRejectedValue(TRILIUM_FAILURE);

            await onCommand("saveSelection");

            expect(facade.callService)
                .toHaveBeenCalledWith("POST", "clippings", { title: "Page", content: "x" });
            expect(await lastToast()).toMatchObject(FAILURE_TOAST);
        });

        it("shows a toast when the page returns nothing or something else fails", async () => {
            await onCommand("saveSelection");
            expect(facade.callService).not.toHaveBeenCalled();
            expect(await lastToast()).toMatchObject(GENERIC_FAILURE_TOAST);

            tabMessageHandler = () => ({ title: "Page", content: "x" });
            facade.callService.mockRejectedValue(new Error("unexpected"));
            await onCommand("saveSelection");
            expect(await lastToast()).toMatchObject({
                ...GENERIC_FAILURE_TOAST,
                message: expect.stringContaining("unexpected")
            });
        });

        it("logs the failure when no page can show a toast", async () => {
            tabs = [];
            await expect(onCommand("saveSelection")).resolves.toBeUndefined();

            tabs = [ { title: "Tab without id" } ];
            await expect(onCommand("saveSelection")).resolves.toBeUndefined();

            tabs = [ ACTIVE_TAB ];
            tabMessageHandler = () => {
                throw new Error("Could not establish connection.");
            };
            await expect(onCommand("saveSelection")).resolves.toBeUndefined();
            await lastToast();
            expect(facade.callService).not.toHaveBeenCalled();
            expect(console.error).toHaveBeenCalledTimes(3);
        });
    });

    describe("saving the whole page", () => {
        it("saves the readable page from the shortcut, the menu and the popup", async () => {
            const page = { title: "Article", content: "<p>Body</p>", images: [], clipType: "page" };
            tabMessageHandler = () => page;

            await onCommand("saveWholePage");
            await onContextMenuClicked({ menuItemId: "trilium-save-page" });
            await sendRuntimeMessage({ name: "save-whole-page" });

            expect(facade.callService).toHaveBeenCalledTimes(3);
            expect(facade.callService).toHaveBeenLastCalledWith("POST", "notes", page);
            expect(await lastToast()).toMatchObject({ noteId: "saved" });

            facade.callService.mockRejectedValue(TRILIUM_FAILURE);
            tabsSendMessage.mockClear();
            await onCommand("saveWholePage");
            expect(await lastToast()).toMatchObject(FAILURE_TOAST);
        });
    });

    describe("screenshots", () => {
        it("crops the screenshot in an offscreen document and saves it as an image", async () => {
            tabMessageHandler = () => ({
                rect: { x: 10, y: 20, width: 100, height: 50 },
                devicePixelRatio: 2
            });

            await onCommand("saveCroppedScreenshot");

            expect(createDocument).toHaveBeenCalledOnce();
            expect(runtimeSendMessage).toHaveBeenCalledWith({
                type: "CROP_IMAGE",
                dataUrl: PNG,
                cropRect: { x: 30, y: 60, width: 300, height: 150 }
            });
            const [ method, path, payload ] = facade.callService.mock.calls[0] ?? [];
            expect([ method, path ]).toEqual([ "POST", "clippings" ]);
            expect(payload).toEqual({
                title: "Active page",
                content: expect.stringMatching(/^<img src="[A-Za-z0-9]{20}">$/),
                images: [ { imageId: expect.any(String), src: "inline.png", dataUrl: PNG } ],
                pageUrl: PAGE_URL
            });
            const { content, images } = payload as {
                content: string,
                images: { imageId: string }[]
            };
            expect(content).toContain(images[0]?.imageId);
            expect(await lastToast()).toMatchObject({ noteId: "saved" });
        });

        it("reuses the offscreen document and uses the context menu's page URL", async () => {
            tabMessageHandler = () => ({ rect: { x: 0, y: 0, width: 10, height: 10 } });
            getContexts.mockResolvedValue([ { contextType: "OFFSCREEN_DOCUMENT" } ]);

            await onContextMenuClicked({
                menuItemId: "trilium-save-cropped-screenshot",
                pageUrl: MENU_URL
            });

            expect(createDocument).not.toHaveBeenCalled();
            expect(runtimeSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                cropRect: { x: 0, y: 0, width: 15, height: 15 }
            }));
            expect(lastPayload()).toMatchObject({ pageUrl: MENU_URL });

            facade.callService.mockRejectedValue(TRILIUM_FAILURE);
            tabsSendMessage.mockClear();
            await sendRuntimeMessage({ name: "save-cropped-screenshot" });
            expect(lastPayload()).toMatchObject({ pageUrl: PAGE_URL });
            expect(await lastToast()).toMatchObject(FAILURE_TOAST);
        });

        it("saves nothing and shows nothing when the crop is cancelled", async () => {
            tabMessageHandler = (message) => {
                return message.name === "toast" ? undefined : { rect: null };
            };

            await expect(onCommand("saveCroppedScreenshot")).resolves.toBeUndefined();

            expect(facade.callService).not.toHaveBeenCalled();
            expect(await lastToast()).toBeUndefined();
        });

        it("saves the visible part of the page", async () => {
            await onContextMenuClicked({
                menuItemId: "trilium-save-whole-screenshot",
                pageUrl: MENU_URL
            });
            expect(lastPayload()).toMatchObject({
                images: [ { src: "inline.png", dataUrl: PNG } ],
                pageUrl: MENU_URL
            });
            expect(await lastToast()).toMatchObject({ noteId: "saved" });

            facade.callService.mockRejectedValue(TRILIUM_FAILURE);
            tabsSendMessage.mockClear();
            await sendRuntimeMessage({ name: "save-whole-screenshot" });
            expect(lastPayload()).toMatchObject({ pageUrl: PAGE_URL });
            expect(await lastToast()).toMatchObject(FAILURE_TOAST);
        });

        it("crops the screenshot on a canvas under Manifest V2", async () => {
            vi.stubGlobal("__MANIFEST_VERSION__", 2);
            const drawImage = vi.fn();
            const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
                .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
            vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(CROPPED_PNG);
            const image = stubImageLoading();
            tabMessageHandler = () => ({
                rect: { x: 10, y: 20, width: 100, height: 50 },
                devicePixelRatio: 1
            });

            await onCommand("saveCroppedScreenshot");

            expect(runtimeSendMessage).not.toHaveBeenCalled();
            expect(drawImage)
                .toHaveBeenCalledWith(image.instances[0], 15, 30, 150, 75, 0, 0, 150, 75);
            expect(lastPayload()).toMatchObject({
                images: [ { src: "inline.png", dataUrl: CROPPED_PNG } ]
            });

            getContext.mockReturnValue(null);
            tabsSendMessage.mockClear();
            await onCommand("saveCroppedScreenshot");
            expect(await lastToast()).toMatchObject(GENERIC_FAILURE_TOAST);

            image.fail = true;
            tabsSendMessage.mockClear();
            await onCommand("saveCroppedScreenshot");
            expect(await lastToast()).toMatchObject(GENERIC_FAILURE_TOAST);
        });
    });

    describe("context menu", () => {
        it("saves an image by fetching it", async () => {
            await onContextMenuClicked({ menuItemId: "trilium-save-image", pageUrl: PAGE_URL });
            expect(facade.callService).not.toHaveBeenCalled();

            await onContextMenuClicked({
                menuItemId: "trilium-save-image",
                srcUrl: "https://example.com/cat.png",
                pageUrl: PAGE_URL
            });
            expect(fetchMock).toHaveBeenCalledWith("https://example.com/cat.png");
            expect(lastPayload()).toMatchObject({
                title: "Active page",
                images: [ {
                    src: "https://example.com/cat.png",
                    dataUrl: expect.stringMatching(PNG_DATA_URL)
                } ],
                pageUrl: PAGE_URL
            });
            expect(await lastToast()).toMatchObject({ noteId: "saved" });

            fetchMock.mockResolvedValueOnce(new Response("Not found", { status: 404 }));
            await onContextMenuClicked({
                menuItemId: "trilium-save-image",
                srcUrl: "https://example.com/gone.png",
                pageUrl: PAGE_URL
            });
            expect(lastPayload()).toMatchObject({
                content: `<img src="https://example.com/gone.png">`,
                images: []
            });
            expect(await lastToast()).toMatchObject({
                message: "Image has been saved to Trilium, but 1 image could not be downloaded.",
                noteId: "saved"
            });

            facade.callService.mockRejectedValue(TRILIUM_FAILURE);
            tabsSendMessage.mockClear();
            await onContextMenuClicked({
                menuItemId: "trilium-save-image",
                srcUrl: "https://example.com/cat.png"
            });
            expect(await lastToast()).toMatchObject(FAILURE_TOAST);
        });

        it("saves a link, with its URL as the text when the browser gives none", async () => {
            await onContextMenuClicked({ menuItemId: "trilium-save-link", pageUrl: PAGE_URL });
            expect(facade.callService).not.toHaveBeenCalled();

            await onContextMenuClicked({
                menuItemId: "trilium-save-link",
                linkUrl: "https://example.com/target",
                linkText: "Target",
                pageUrl: PAGE_URL
            });
            expect(facade.callService).toHaveBeenLastCalledWith("POST", "clippings", {
                title: "Active page",
                content: "<a href=\"https://example.com/target\">Target</a>",
                pageUrl: PAGE_URL
            });
            expect(await lastToast()).toMatchObject({ noteId: "saved" });

            facade.callService.mockRejectedValue(TRILIUM_FAILURE);
            tabsSendMessage.mockClear();
            await onContextMenuClicked({
                menuItemId: "trilium-save-link",
                linkUrl: "https://example.com/target"
            });
            expect(lastPayload()).toMatchObject({
                content: "<a href=\"https://example.com/target\">https://example.com/target</a>"
            });
            expect(await lastToast()).toMatchObject(FAILURE_TOAST);
        });

        it("ignores unknown items and commands", async () => {
            await onContextMenuClicked({ menuItemId: "unknown" });
            await onCommand("unknown");
            expect(facade.callService).not.toHaveBeenCalled();
            expect(tabsSendMessage).not.toHaveBeenCalled();
        });
    });

    describe("saving tabs", () => {
        it("saves the tabs as a list of links, titled by the most common domains", async () => {
            tabs = [
                { id: 1, title: "A1", url: "https://a.com/1" },
                { id: 2, title: "B1", url: "https://b.com/1" },
                { title: "B2", url: "https://b.com/2" },
                { id: 4, title: "C1", url: "https://c.com/1" },
                { id: 5, title: "D1", url: "https://d.com/1" }
            ];

            await onCommand("saveTabs");

            expect(facade.callService).toHaveBeenCalledWith("POST", "notes", {
                title: "5 browser tabs: b.com, a.com, c.com...",
                content: "<ul>"
                    + "<li><a href=\"https://a.com/1\">A1</a></li>"
                    + "<li><a href=\"https://b.com/1\">B1</a></li>"
                    + "<li><a href=\"https://b.com/2\">B2</a></li>"
                    + "<li><a href=\"https://c.com/1\">C1</a></li>"
                    + "<li><a href=\"https://d.com/1\">D1</a></li>"
                    + "</ul>",
                clipType: "tabs"
            });
            expect(await lastToast()).toMatchObject({ noteId: "saved", tabIds: [ 1, 2, 4, 5 ] });
        });

        it("skips tabs without a URL and escapes the titles", async () => {
            tabs = [
                { id: 1, title: "Loading" },
                { id: 2, title: "<b>Bold</b> & \"quoted\"", url: "https://a.com/?x=1&y=\"2\"" },
                { id: 3, url: "https://a.com/untitled" }
            ];

            await onCommand("saveTabs");

            expect(lastPayload()).toEqual({
                title: "2 browser tabs: a.com",
                content: "<ul><li><a href=\"https://a.com/?x=1&amp;y=&quot;2&quot;\">"
                    + "&lt;b&gt;Bold&lt;/b&gt; &amp; &quot;quoted&quot;</a></li>"
                    + "<li><a href=\"https://a.com/untitled\">https://a.com/untitled</a></li></ul>",
                clipType: "tabs"
            });
            expect(await lastToast()).toMatchObject({
                message: "2 links have been saved to Trilium.",
                tabIds: [ 2, 3 ]
            });
        });

        it("adds no ellipsis for up to three tabs and shows why saving failed", async () => {
            tabs = [
                { id: 1, title: "A", url: "https://a.com/" },
                { id: 2, title: "B", url: "https://b.com/" }
            ];
            facade.callService.mockRejectedValue(TRILIUM_FAILURE);

            await sendRuntimeMessage({ name: "save-tabs" });

            expect(lastPayload()).toMatchObject({ title: "2 browser tabs: a.com, b.com" });
            expect(await lastToast()).toMatchObject(FAILURE_TOAST);
        });
    });

    describe("popup and toast messages", () => {
        it("saves a link with a note, titled after the tab when the title is blank", async () => {
            const saveWithTitle = (title: string, content = "") => sendRuntimeMessage({
                name: "save-link-with-note",
                title,
                content
            });

            await expect(saveWithTitle("  ", "Note")).resolves.toBe(true);
            expect(facade.callService).toHaveBeenLastCalledWith("POST", "notes", {
                title: "Active page",
                content: "Note",
                clipType: "note",
                pageUrl: PAGE_URL
            });
            expect(await lastToast()).toMatchObject({ noteId: "saved" });

            facade.callService.mockRejectedValue(TRILIUM_FAILURE);
            await expect(saveWithTitle("Mine")).resolves.toBeUndefined();
            expect(lastPayload()).toMatchObject({ title: "Mine" });

            tabs = [ { id: 7, url: "https://example.com/untitled" } ];
            await saveWithTitle("");
            expect(lastPayload()).toMatchObject({ title: "" });
        });

        it("opens a note in the browser when the desktop app cannot", async () => {
            const create = vi.fn(async (_properties: { url: string }) => ({}));
            Object.assign(fakeBrowser.tabs, { create });
            const openNote = () => sendRuntimeMessage({ name: "openNoteInTrilium", noteId: "n1" });

            facade.callService.mockResolvedValue({ result: "ok" });
            await openNote();
            expect(facade.callService).toHaveBeenLastCalledWith("POST", "open/n1");

            facade.callService.mockRejectedValue(TRILIUM_FAILURE);
            await openNote();
            expect(await lastToast()).toMatchObject(FAILURE_TOAST);

            facade.callService.mockResolvedValue({ result: "open-in-browser" });
            vi.mocked(console.error).mockClear();
            await openNote();
            expect(console.error).toHaveBeenCalledOnce();
            expect(create).not.toHaveBeenCalled();

            await fakeBrowser.storage.sync.set({ triliumServerUrl: "https://trilium.example" });
            await openNote();
            expect(create).toHaveBeenCalledExactlyOnceWith({ url: "https://trilium.example/#n1" });
        });

        it("closes the saved tabs", async () => {
            const remove = vi.spyOn(fakeBrowser.tabs, "remove").mockResolvedValue(undefined);
            await sendRuntimeMessage({ name: "closeTabs", tabIds: [ 1, 2 ] });
            expect(remove).toHaveBeenCalledWith([ 1, 2 ]);
        });

        it("forwards Trilium searches to the server facade", async () => {
            await sendRuntimeMessage({ name: "trigger-trilium-search" });
            expect(facade.triggerSearchForTrilium).toHaveBeenCalledOnce();

            await sendRuntimeMessage({ name: "send-trilium-search-status" });
            expect(facade.sendTriliumSearchStatusToPopup).toHaveBeenCalledOnce();

            await sendRuntimeMessage({ name: "trigger-trilium-search-note-url" });
            expect(facade.triggerSearchNoteByUrl).toHaveBeenCalledWith(PAGE_URL);

            tabs = [ { id: 7 } ];
            await sendRuntimeMessage({ name: "trigger-trilium-search-note-url" });
            expect(facade.triggerSearchNoteByUrl).toHaveBeenCalledOnce();

            await expect(sendRuntimeMessage({ name: "unknown" })).resolves.toBeUndefined();
        });
    });
});

async function sendRuntimeMessage(message: object) {
    const [ result ] = await fakeBrowser.runtime.onMessage.trigger(message, {}, () => {});
    return result;
}

function lastPayload() {
    return facade.callService.mock.lastCall?.[2];
}

async function lastToast() {
    await new Promise((resolve) => setTimeout(resolve));
    return tabsSendMessage.mock.calls
        .map(([ , message ]) => message)
        .filter((message) => message.name === "toast")
        .at(-1);
}

function stubImageLoading() {
    const state = { fail: false, instances: [] as object[] };
    vi.stubGlobal("Image", class {

        onload: (() => void) | null = null;
        onerror: ((event: Event) => void) | null = null;

        constructor() {
            state.instances.push(this);
        }

        set src(_value: string) {
            setTimeout(() => (state.fail ? this.onerror?.(new Event("error")) : this.onload?.()));
        }

    });
    return state;
}
