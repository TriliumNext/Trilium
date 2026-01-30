import { randomString, Rect } from "@/utils";

import setupContextMenu from "./context_menu";
import TriliumServerFacade from "./trilium_server_facade";

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

export default defineBackground(() => {
    const triliumServerFacade = new TriliumServerFacade();

    // Keyboard shortcuts
    browser.commands.onCommand.addListener(async (command) => {
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
    });

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

        return tabs[0];
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
        });
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
        const blob = await resp.blob();

        return await blob2base64(blob);
    }

    async function postProcessImage(image: { src: string, dataUrl?: string | null }) {
        if (image.src.startsWith("data:image/")) {
            image.dataUrl = image.src;
            const mimeSubtype = image.src.match(/data:image\/(.*?);/)?.[1];
            if (!mimeSubtype) return;
            image.src = `inline.${mimeSubtype}`; // this should extract file type - png/jpg
        }
        else {
            try {
                image.dataUrl = await fetchImage(image.src);
            } catch (e) {
                console.error(`Cannot fetch image from ${image.src}`, e);
            }
        }
    }

    async function postProcessImages(resp: { images?: { src: string, dataUrl?: string }[] }) {
        if (resp.images) {
            for (const image of resp.images) {
                await postProcessImage(image);
            }
        }
    }

    async function saveSelection() {
        const payload = await sendMessageToActiveTab({name: 'trilium-save-selection'});

        await postProcessImages(payload);

        const resp = await triliumServerFacade.callService('POST', 'clippings', payload);

        if (!resp) {
            return;
        }

        toast("Selection has been saved to Trilium.", resp.noteId);
    }

    async function getImagePayloadFromSrc(src: string, pageUrl: string | null | undefined) {
        const image = {
            imageId: randomString(20),
            src
        };

        await postProcessImage(image);

        const activeTab = await getActiveTab();

        return {
            title: activeTab.title,
            content: `<img src="${image.imageId}">`,
            images: [image],
            pageUrl
        };
    }

    async function saveCroppedScreenshot(pageUrl: string | null | undefined) {
        const { rect, devicePixelRatio } = await sendMessageToActiveTab({name: 'trilium-get-rectangle-for-screenshot'});

        const src = await takeCroppedScreenshot(rect, devicePixelRatio);

        const payload = await getImagePayloadFromSrc(src, pageUrl);

        const resp = await triliumServerFacade.callService("POST", "clippings", payload);

        if (!resp) {
            return;
        }

        toast("Screenshot has been saved to Trilium.", resp.noteId);
    }

    async function saveWholeScreenshot(pageUrl: string | null | undefined) {
        const src = await takeWholeScreenshot();

        const payload = await getImagePayloadFromSrc(src, pageUrl);

        const resp = await triliumServerFacade.callService("POST", "clippings", payload);

        if (!resp) {
            return;
        }

        toast("Screenshot has been saved to Trilium.", resp.noteId);
    }

    async function saveImage(srcUrl: string, pageUrl: string | null | undefined) {
        const payload = await getImagePayloadFromSrc(srcUrl, pageUrl);

        const resp = await triliumServerFacade.callService("POST", "clippings", payload);

        if (!resp) {
            return;
        }

        toast("Image has been saved to Trilium.", resp.noteId);
    }

    async function saveWholePage() {
        const payload = await sendMessageToActiveTab({name: 'trilium-save-page'});

        await postProcessImages(payload);

        const resp = await triliumServerFacade.callService('POST', 'notes', payload);

        if (!resp) {
            return;
        }

        toast("Page has been saved to Trilium.", resp.noteId);
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

        if (!resp) {
            return false;
        }

        toast("Link with note has been saved to Trilium.", resp.noteId);

        return true;
    }

    async function getTabsPayload(tabs: Browser.tabs.Tab[]) {
        let content = '<ul>';
        tabs.forEach(tab => {
            content += `<li><a href="${tab.url}">${tab.title}</a></li>`;
        });
        content += '</ul>';

        const domainsCount = tabs.map(tab => tab.url)
            .reduce((acc, url) => {
                const hostname = new URL(url ?? "").hostname;
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
        const tabs = await getWindowTabs();

        const payload = await getTabsPayload(tabs);

        const resp = await triliumServerFacade.callService('POST', 'notes', payload);
        if (!resp) return;

        const tabIds = tabs.map(tab => tab.id).filter(id => id !== undefined) as number[];
        toast(`${tabs.length} links have been saved to Trilium.`, resp.noteId, tabIds);
    }

    browser.contextMenus.onClicked.addListener(async (info: globalThis.Browser.contextMenus.OnClickData & { linkText?: string; }) => {
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

            if (!resp) return;
            toast("Link has been saved to Trilium.", resp.noteId);
        }
        else if (info.menuItemId === 'trilium-save-page') {
            await saveWholePage();
        }
        else {
            console.log("Unrecognized menuItemId", info.menuItemId);
        }
    });

    browser.runtime.onMessage.addListener(async request => {
        console.log("Received", request);

        if (request.name === 'openNoteInTrilium') {
            const resp = await triliumServerFacade.callService('POST', `open/${request.noteId}`);

            if (!resp) {
                return;
            }

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
    });
});
