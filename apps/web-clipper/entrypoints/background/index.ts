import { randomString, type Rect } from "@/utils";

import setupContextMenu from "./context_menu";
import TriliumServerFacade, { TriliumError } from "./trilium_server_facade";

type BackgroundMessage = {
    name: "toast";
    message: string;
    noteId: string | null;
    tabIds: number[] | null;
} | {
    name: "trilium-save-selection";
} | {
    name: "trilium-get-rectangle-for-screenshot";
} | {
    name: "trilium-save-page";
};

/** An image of a clipping; `content` references it by `imageId` until Trilium stores it. */
type ClippedImage = { imageId: string, src: string, dataUrl?: string };

/** `linkText` is only available on Firefox. */
type ContextMenuInfo = Browser.contextMenus.OnClickData & { linkText?: string };

export default defineBackground(() => {
    const triliumServerFacade = new TriliumServerFacade();

    // Keyboard shortcuts
    browser.commands.onCommand.addListener((command) => showFailures(async () => {
        switch (command) {
            case "saveSelection":
                await saveSelection();
                break;
            case "saveWholePage":
                await saveWholePage();
                break;
            case "saveTabs":
                await saveTabs();
                break;
            case "saveCroppedScreenshot": {
                const activeTab = await getActiveTab();
                await saveCroppedScreenshot(activeTab.url);
                break;
            }
            default:
                console.log("Unrecognized command", command);
        }
    }));

    setupContextMenu();

    function cropImageManifestV2(newArea: Rect, dataUrl: string) {
        return new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = function () {
                const canvas = document.createElement('canvas');
                canvas.width = newArea.width;
                canvas.height = newArea.height;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject();
                    return;
                }
                ctx.drawImage(img, newArea.x, newArea.y, newArea.width, newArea.height, 0, 0, newArea.width, newArea.height);
                resolve(canvas.toDataURL());
            };
            img.onerror = reject;

            img.src = dataUrl;
        });
    }

    async function cropImageManifestV3(newArea: Rect, dataUrl: string) {
        // Create offscreen document if it doesn't exist
        await ensureOffscreenDocument();

        // Send cropping task to offscreen document
        return await browser.runtime.sendMessage({
            type: 'CROP_IMAGE',
            dataUrl,
            cropRect: newArea
        });
    }

    async function takeCroppedScreenshot(cropRect: Rect, devicePixelRatio: number = 1) {
        const activeTab = await getActiveTab();
        const zoom = await browser.tabs.getZoom(activeTab.id) * devicePixelRatio;

        const newArea: Rect = {
            x: cropRect.x * zoom,
            y: cropRect.y * zoom,
            width: cropRect.width * zoom,
            height: cropRect.height * zoom
        };

        const dataUrl = await browser.tabs.captureVisibleTab({ format: 'png' });
        const cropImage = (import.meta.env.MANIFEST_VERSION === 3 ? cropImageManifestV3 : cropImageManifestV2);
        return await cropImage(newArea, dataUrl);
    }

    async function ensureOffscreenDocument() {
        const existingContexts = await browser.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });

        if (existingContexts.length > 0) {
            return; // Already exists
        }

        await browser.offscreen.createDocument({
            url: browser.runtime.getURL('/offscreen.html'),
            reasons: ['DOM_SCRAPING'], // or 'DISPLAY_MEDIA' depending on browser support
            justification: 'Image cropping requires canvas API'
        });
    }

    async function takeWholeScreenshot() {
        // this saves only visible portion of the page
        // workaround to save the whole page is to scroll & stitch
        // example in https://github.com/mrcoles/full-page-screen-capture-chrome-extension
        // see page.js and popup.js
        return await browser.tabs.captureVisibleTab({ format: 'png' });
    }

    async function getActiveTab() {
        const tabs = await browser.tabs.query({
            active: true,
            currentWindow: true
        });

        const activeTab = tabs[0];
        if (!activeTab) {
            throw new Error("No active tab.");
        }

        return activeTab;
    }

    async function getWindowTabs() {
        const tabs = await browser.tabs.query({
            currentWindow: true
        });

        return tabs;
    }

    async function sendMessageToActiveTab(message: BackgroundMessage) {
        const activeTab = await getActiveTab();

        if (!activeTab?.id) {
            throw new Error("No active tab.");
        }

        return await browser.tabs.sendMessage(activeTab.id, message);
    }

    function toast(message: string, noteId: string | null = null, tabIds: number[] | null = null) {
        sendMessageToActiveTab({
            name: 'toast',
            message,
            noteId,
            tabIds
        }).catch(() => {
            // Browser pages and the extension stores run no content script to show it.
        });
    }

    /** Runs a user action, and reports its failure in a toast instead of rejecting. */
    async function showFailures<T>(action: () => Promise<T>) {
        try {
            return await action();
        } catch (e) {
            console.error("Web clipper action failed", e);
            toast(failureMessage(e));
            return undefined;
        }
    }

    async function requestFromPage(message: BackgroundMessage) {
        const response = await sendMessageToActiveTab(message);
        if (!response) {
            throw new Error("The page could not be read. Reload it and try again.");
        }
        return response;
    }

    function blob2base64(blob: Blob) {
        return new Promise<string | null>(resolve => {
            const reader = new FileReader();
            reader.onloadend = function() {
                resolve(reader.result as string | null);
            };
            reader.readAsDataURL(blob);
        });
    }

    async function fetchImage(url: string) {
        const resp = await fetch(url);
        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }

        const blob = await resp.blob();
        if (!blob.type.startsWith("image/")) {
            throw new Error(`Not an image: '${blob.type}'`);
        }

        const dataUrl = await blob2base64(blob);
        if (!dataUrl) {
            throw new Error("The image could not be read.");
        }

        return dataUrl;
    }

    /** Inlines the image as a data URL, and returns whether it could be downloaded. */
    async function postProcessImage(image: ClippedImage) {
        if (image.src.startsWith("data:image/")) {
            image.dataUrl = image.src;
            const mimeSubtype = image.src.match(/data:image\/(.*?);/)?.[1];
            if (!mimeSubtype) return true;
            image.src = `inline.${mimeSubtype}`; // this should extract file type - png/jpg
            return true;
        }

        try {
            image.dataUrl = await fetchImage(image.src);
            return true;
        } catch (e) {
            console.error(`Cannot fetch image from ${image.src}`, e);
            return false;
        }
    }

    /**
     * Inlines the payload's images, and returns how many could not be downloaded. Those go back to
     * their original URL in the content, which Trilium downloads itself or shows from the website.
     */
    async function postProcessImages(payload: { content?: string, images?: ClippedImage[] }) {
        if (!payload.images) return 0;

        const downloaded: ClippedImage[] = [];
        for (const image of payload.images) {
            if (await postProcessImage(image)) {
                downloaded.push(image);
            } else {
                payload.content = payload.content?.replaceAll(image.imageId, escapeHtml(image.src));
            }
        }

        const failedCount = payload.images.length - downloaded.length;
        payload.images = downloaded;
        return failedCount;
    }

    async function saveSelection() {
        const payload = await requestFromPage({name: 'trilium-save-selection'});

        const failedImages = await postProcessImages(payload);

        const resp = await triliumServerFacade.callService('POST', 'clippings', payload);

        toast(savedMessage("Selection", failedImages), resp.noteId);
    }

    async function getImagePayloadFromSrc(src: string, pageUrl: string | null | undefined) {
        const imageId = randomString(20);
        const activeTab = await getActiveTab();
        const payload = {
            title: activeTab.title,
            content: `<img src="${imageId}">`,
            images: [ { imageId, src } ],
            pageUrl
        };

        const failedImages = await postProcessImages(payload);

        return { payload, failedImages };
    }

    async function saveCroppedScreenshot(pageUrl: string | null | undefined) {
        const { rect, devicePixelRatio } = await requestFromPage({
            name: 'trilium-get-rectangle-for-screenshot'
        });
        if (!rect) return;

        const src = await takeCroppedScreenshot(rect, devicePixelRatio);

        const { payload } = await getImagePayloadFromSrc(src, pageUrl);

        const resp = await triliumServerFacade.callService("POST", "clippings", payload);

        toast("Screenshot has been saved to Trilium.", resp.noteId);
    }

    async function saveWholeScreenshot(pageUrl: string | null | undefined) {
        const src = await takeWholeScreenshot();

        const { payload } = await getImagePayloadFromSrc(src, pageUrl);

        const resp = await triliumServerFacade.callService("POST", "clippings", payload);

        toast("Screenshot has been saved to Trilium.", resp.noteId);
    }

    async function saveImage(srcUrl: string, pageUrl: string | null | undefined) {
        const { payload, failedImages } = await getImagePayloadFromSrc(srcUrl, pageUrl);

        const resp = await triliumServerFacade.callService("POST", "clippings", payload);

        toast(savedMessage("Image", failedImages), resp.noteId);
    }

    async function saveWholePage() {
        const payload = await requestFromPage({name: 'trilium-save-page'});

        const failedImages = await postProcessImages(payload);

        const resp = await triliumServerFacade.callService('POST', 'notes', payload);

        toast(savedMessage("Page", failedImages), resp.noteId);
    }

    async function saveLinkWithNote(title: string, content: string) {
        const activeTab = await getActiveTab();

        if (!title.trim()) {
            title = activeTab.title ?? "";
        }

        const resp = await triliumServerFacade.callService('POST', 'notes', {
            title,
            content,
            clipType: 'note',
            pageUrl: activeTab.url
        });

        toast("Link with note has been saved to Trilium.", resp.noteId);

        return true;
    }

    async function getTabsPayload(tabs: (Browser.tabs.Tab & { url: string })[]) {
        let content = '<ul>';
        for (const tab of tabs) {
            content += `<li><a href="${escapeHtml(tab.url)}">${escapeHtml(tab.title ?? tab.url)}</a></li>`;
        }
        content += '</ul>';

        const domainsCount = tabs.map(tab => tab.url)
            .reduce((acc, url) => {
                const hostname = new URL(url).hostname;
                return acc.set(hostname, (acc.get(hostname) || 0) + 1);
            }, new Map());

        let topDomains = [...domainsCount]
            .sort((a, b) => {return b[1]-a[1];})
            .slice(0,3)
            .map(domain=>domain[0])
            .join(', ');

        if (tabs.length > 3) { topDomains += '...'; }

        return {
            title: `${tabs.length} browser tabs: ${topDomains}`,
            content,
            clipType: 'tabs'
        };
    }

    async function saveTabs() {
        const tabs = (await getWindowTabs())
            .filter((tab): tab is Browser.tabs.Tab & { url: string } => !!tab.url);

        const payload = await getTabsPayload(tabs);

        const resp = await triliumServerFacade.callService('POST', 'notes', payload);

        const tabIds = tabs.map(tab => tab.id).filter(id => id !== undefined) as number[];
        toast(`${tabs.length} links have been saved to Trilium.`, resp.noteId, tabIds);
    }

    browser.contextMenus.onClicked.addListener((info: ContextMenuInfo) => showFailures(async () => {
        if (info.menuItemId === 'trilium-save-selection') {
            await saveSelection();
        }
        else if (info.menuItemId === 'trilium-save-cropped-screenshot') {
            await saveCroppedScreenshot(info.pageUrl);
        }
        else if (info.menuItemId === 'trilium-save-whole-screenshot') {
            await saveWholeScreenshot(info.pageUrl);
        }
        else if (info.menuItemId === 'trilium-save-image') {
            if (!info.srcUrl) return;
            await saveImage(info.srcUrl, info.pageUrl);
        }
        else if (info.menuItemId === 'trilium-save-link') {
            if (!info.linkUrl) return;
            // Link text is only available on Firefox.
            const linkText = info.linkText || info.linkUrl;
            const content = `<a href="${info.linkUrl}">${linkText}</a>`;
            const activeTab = await getActiveTab();

            const resp = await triliumServerFacade.callService('POST', 'clippings', {
                title: activeTab.title,
                content,
                pageUrl: info.pageUrl
            });

            toast("Link has been saved to Trilium.", resp.noteId);
        }
        else if (info.menuItemId === 'trilium-save-page') {
            await saveWholePage();
        }
        else {
            console.log("Unrecognized menuItemId", info.menuItemId);
        }
    }));

    browser.runtime.onMessage.addListener((request) => showFailures(async () => {
        console.log("Received", request);

        if (request.name === 'openNoteInTrilium') {
            const resp = await triliumServerFacade.callService('POST', `open/${request.noteId}`);

            // desktop app is not available so we need to open in browser
            if (resp.result === 'open-in-browser') {
                const {triliumServerUrl} = await browser.storage.sync.get("triliumServerUrl");

                if (triliumServerUrl) {
                    const noteUrl = `${triliumServerUrl  }/#${  request.noteId}`;

                    console.log("Opening new tab in browser", noteUrl);

                    browser.tabs.create({
                        url: noteUrl
                    });
                }
                else {
                    console.error("triliumServerUrl not found in local storage.");
                }
            }
        }
        else if (request.name === 'closeTabs') {
            return await browser.tabs.remove(request.tabIds);
        }
        else if (request.name === 'save-cropped-screenshot') {
            const activeTab = await getActiveTab();

            return await saveCroppedScreenshot(activeTab.url);
        }
        else if (request.name === 'save-whole-screenshot') {
            const activeTab = await getActiveTab();

            return await saveWholeScreenshot(activeTab.url);
        }
        else if (request.name === 'save-whole-page') {
            return await saveWholePage();
        }
        else if (request.name === 'save-link-with-note') {
            return await saveLinkWithNote(request.title, request.content);
        }
        else if (request.name === 'save-tabs') {
            return await saveTabs();
        }
        else if (request.name === 'trigger-trilium-search') {
            triliumServerFacade.triggerSearchForTrilium();
        }
        else if (request.name === 'send-trilium-search-status') {
            triliumServerFacade.sendTriliumSearchStatusToPopup();
        }
        else if (request.name === 'trigger-trilium-search-note-url') {
            const activeTab = await getActiveTab();
            if (activeTab.url) {
                triliumServerFacade.triggerSearchNoteByUrl(activeTab.url);
            }
        }
    }));
});

function savedMessage(subject: string, failedImages: number) {
    if (!failedImages) return `${subject} has been saved to Trilium.`;
    const images = failedImages === 1 ? "1 image" : `${failedImages} images`;
    return `${subject} has been saved to Trilium, but ${images} could not be downloaded.`;
}

function escapeHtml(value: string) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("\"", "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function failureMessage(error: unknown) {
    if (error instanceof TriliumError) return error.message;
    const details = error instanceof Error ? error.message : "";
    return details ? `Saving to Trilium failed: ${details}` : "Saving to Trilium failed.";
}
