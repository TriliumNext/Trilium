import {
    MAX_PART_HEIGHT, type ScreenshotSlice, ScreenshotStitcher, type StitchMessage, type StitchRequest
} from "@/screenshot";
import {
    describeError, extractPage, isPdfTab, OPTIONAL_REQUEST_TIMEOUT_MS, randomString, type Rect, type SaveOutcome, type Saved
} from "@/utils";

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
    name: "trilium-get-page-metadata";
} | {
    /**
     * Changes the page for a full-page screenshot (its scrollbars, fixed and sticky elements), or
     * restores it.
     */
    name: "trilium-set-floating-elements";
    step: "first" | "rest" | "restore";
} | {
    /** Scrolls the page to `x`, `y` when given, and answers with a {@link ScrollPosition}. */
    name: "trilium-scroll-to";
    x?: number;
    y?: number;
};

/** Where the page is scrolled to and how large it is, in CSS pixels. */
type ScrollPosition = {
    scrollX: number;
    scrollY: number;
    viewportHeight: number;
    /** Not given by a content script from an earlier version of the extension. */
    viewportWidth?: number;
    pageHeight: number;
    devicePixelRatio: number;
};

/**
 * Firefox's `tabs.captureTab()`, which captures any area of the page, in CSS pixels from its top,
 * at the page's pixel ratio. Chrome has no such function.
 */
type CaptureTab = (tabId: number, options: { format: "png", rect: CaptureRect }) => Promise<string>;
type CaptureRect = { x: number, y: number, width: number, height: number };

/** Draws the captures of a full-page screenshot into images, wherever the canvas is. */
interface Stitcher {
    add(slice: ScreenshotSlice): Promise<void>;
    finish(): Promise<string[]> | string[];
}

/** Chrome allows two `captureVisibleTab()` calls a second, and fails a third. */
const CAPTURE_INTERVAL_MS = 550;
/** How long a scrolled page gets to draw what came into view before it is captured. */
const SCROLL_SETTLE_MS = 150;
/** The most captures a full-page screenshot takes, about a minute; a longer page is cut off. */
const MAX_SCREENSHOT_CAPTURES = 100;
/** The largest PDF the clipper saves. It reaches Trilium as base64 in a single request. */
const MAX_PDF_SIZE = 100 * 1024 * 1024;

/**
 * An image of a clipping; `content` references it by `imageId` until Trilium stores it. Trilium
 * holds a `screenshot` to the width setting alone, so a long page stays readable.
 */
type ClippedImage = { imageId: string, src: string, dataUrl?: string, screenshot?: boolean };

/** `linkText` is only available on Firefox. */
type ContextMenuInfo = Browser.contextMenus.OnClickData & { linkText?: string };

export default defineBackground(() => {
    const triliumServerFacade = new TriliumServerFacade();
    /** The open popups: each keeps a port named "popup" connected while it is. */
    const openPopups = new Set<Browser.runtime.Port>();
    /**
     * The last full-page screenshot asked for, which the next one waits for: both would scroll the tab,
     * and under Manifest V3 they share the offscreen document's stitcher.
     */
    let lastFullPageScreenshot: Promise<unknown> = Promise.resolve();

    browser.runtime.onConnect.addListener((port) => {
        if (port.name !== "popup") return;
        openPopups.add(port);
        port.onDisconnect.addListener(() => openPopups.delete(port));
    });

    // Keyboard shortcuts
    browser.commands.onCommand.addListener((command) => showFailures(async () => {
        switch (command) {
            case "saveSelection":
                notify(await saveSelection());
                break;
            case "saveWholePage":
                notify(await saveWholePage());
                break;
            case "saveTabs":
                notify(await saveTabs());
                break;
            case "saveCroppedScreenshot": {
                const activeTab = await getActiveTab();
                notify(await saveCroppedScreenshot(activeTab.url));
                break;
            }
            case "saveFullPageScreenshot": {
                const activeTab = await getActiveTab();
                notify(await saveFullPageScreenshot(activeTab.url));
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
        return await browser.tabs.captureVisibleTab({ format: 'png' });
    }

    /**
     * Scrolls the active tab from the top, one viewport at a time, captures each, and stitches the
     * captures into images of the page from the top. The tab is scrolled back to where it was
     * afterwards. `cutOff` says the page was longer than a screenshot holds.
     */
    async function takeFullPageScreenshot() {
        // A queued screenshot keeps the tab it was asked for, and stops if that tab is no longer active.
        const tab = await getActiveTab();
        const screenshot = lastFullPageScreenshot.then(() => captureFullPage(tab));
        lastFullPageScreenshot = screenshot.catch(() => undefined);
        return await screenshot;
    }

    async function captureFullPage({ id: tabId, windowId }: Browser.tabs.Tab) {
        if (tabId === undefined) {
            throw new Error("No active tab.");
        }

        const start = await scrollTab(tabId);
        try {
            await scrollTab(tabId, start.scrollX, 0);
            await setFloatingElements(tabId, "first");
            // Measured once the page is prepared: without its scrollbars, it can lay out differently.
            const page = await scrollTab(tabId, start.scrollX, 0);
            const height = Math.min(page.pageHeight, MAX_SCREENSHOT_CAPTURES * page.viewportHeight);
            const stitcher = await createStitcher({ pageHeight: height, devicePixelRatio: page.devicePixelRatio });

            const { captureTab } = browser.tabs as typeof browser.tabs & { captureTab?: CaptureTab };
            if (captureTab && page.viewportWidth) {
                const captureRect = (rect: CaptureRect) => captureTab.call(browser.tabs, tabId, { format: "png", rect });
                await captureByArea(tabId, { ...page, viewportWidth: page.viewportWidth }, height, stitcher, captureRect);
            } else {
                await captureByScrolling(tabId, windowId, page, height, stitcher);
            }

            return { parts: await stitcher.finish(), cutOff: height < page.pageHeight };
        } finally {
            await setFloatingElements(tabId, "restore").catch(() => undefined);
            await scrollTab(tabId, start.scrollX, start.scrollY).catch(() => undefined);
        }
    }

    /** Scrolls through the page a viewport at a time, capturing each, as often as Chrome allows. */
    async function captureByScrolling(
        tabId: number, windowId: number, page: ScrollPosition, height: number, stitcher: Stitcher
    ) {
        let position = page;
        let lastCaptureAt = 0;
        for (;;) {
            await delay(Math.max(SCROLL_SETTLE_MS, lastCaptureAt + CAPTURE_INTERVAL_MS - Date.now()));
            await assertTabActive(tabId);

            lastCaptureAt = Date.now();
            const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: "png" });
            await stitcher.add({ dataUrl, y: position.scrollY });
            if (position === page) {
                await setFloatingElements(tabId, "rest");
            }

            const y = position.scrollY + page.viewportHeight;
            if (y >= height) break;
            const next = await scrollTab(tabId, page.scrollX, y);
            // The page stopped scrolling short of the height it reported.
            if (next.scrollY <= position.scrollY) break;
            position = next;
        }
    }

    /**
     * Captures the page from the top with Firefox's `tabs.captureTab()`, an area of up to one image
     * at a time, without scrolling. A fixed header is drawn where it is, at the top. Each area reaches
     * a CSS pixel into the next, so a fractional pixel ratio leaves no gap between them.
     */
    async function captureByArea(
        tabId: number,
        page: ScrollPosition & { viewportWidth: number },
        height: number,
        stitcher: Stitcher,
        captureRect: (rect: CaptureRect) => Promise<string>
    ) {
        const step = Math.floor(MAX_PART_HEIGHT / page.devicePixelRatio);
        await delay(SCROLL_SETTLE_MS);
        for (let y = 0; y < height; y += step) {
            await assertTabActive(tabId);
            const dataUrl = await captureRect({
                x: page.scrollX, y, width: page.viewportWidth, height: Math.min(step + 1, height - y)
            });
            await stitcher.add({ dataUrl, y });
        }
    }

    async function assertTabActive(tabId: number) {
        const tab = await browser.tabs.get(tabId);
        if (!tab.active) {
            throw new Error("The screenshot was stopped because another tab was opened.");
        }
    }

    async function saveFullPageScreenshot(pageUrl: string | null | undefined) {
        const { parts, cutOff } = await takeFullPageScreenshot();
        return await saveScreenshot(parts, pageUrl, cutOff
            ? "Screenshot has been saved to Trilium, but the page was too long to capture in full."
            : undefined);
    }

    /** Scrolls the tab when given a position, and answers where it is scrolled to. */
    async function scrollTab(tabId: number, x?: number, y?: number): Promise<ScrollPosition> {
        const message: BackgroundMessage = { name: "trilium-scroll-to", x, y };
        const position = await browser.tabs.sendMessage(tabId, message);
        if (!position) {
            throw new Error("The page could not be read. Reload it and try again.");
        }
        return position;
    }

    /**
     * Asks the page to change or restore its fixed and sticky elements. A content script from an
     * earlier version of the extension does not know the message, and the page stays as it is.
     */
    async function setFloatingElements(tabId: number, step: "first" | "rest" | "restore") {
        const message: BackgroundMessage = { name: "trilium-set-floating-elements", step };
        await browser.tabs.sendMessage(tabId, message);
    }

    /**
     * Stitches in the background page under Manifest V2, and in the offscreen document under V3,
     * where the service worker has no canvas.
     */
    async function createStitcher(request: StitchRequest): Promise<Stitcher> {
        if (import.meta.env.MANIFEST_VERSION !== 3) {
            return new ScreenshotStitcher(request);
        }

        await ensureOffscreenDocument();
        await askOffscreen({ type: "STITCH_BEGIN", request });
        return {
            add: async (slice) => {
                await askOffscreen({ type: "STITCH_ADD", slice });
            },
            finish: async () => {
                const { count } = await askOffscreen({ type: "STITCH_FINISH" });
                const parts: string[] = [];
                for (let index = 0; index < count; index++) {
                    parts.push((await askOffscreen({ type: "STITCH_PART", index })).dataUrl);
                }
                return parts;
            }
        };
    }

    async function askOffscreen(message: StitchMessage) {
        const response = await browser.runtime.sendMessage(message);
        if (response.error) {
            throw new Error(response.error);
        }
        return response;
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

    function notify(saved: Saved | undefined) {
        if (saved) toast(saved.message, saved.noteId, saved.tabIds);
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

    /**
     * Runs a save the popup asked for, and answers it with the outcome, which the popup shows. A
     * popup closed before the save ends (as it is to crop a screenshot) shows nothing, so the page
     * shows a toast instead, also when another popup was opened since.
     */
    async function saveForPopup(save: () => Promise<Saved | undefined>): Promise<SaveOutcome | undefined> {
        const askers = [ ...openPopups ];
        const askerOpen = () => askers.some((port) => openPopups.has(port));
        try {
            const saved = await save();
            if (!askerOpen()) notify(saved);
            return saved;
        } catch (e) {
            console.error("Web clipper action failed", e);
            if (!askerOpen()) toast(failureMessage(e));
            return { error: failureMessage(e) };
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

    async function fetchImage(url: string, init?: RequestInit) {
        const resp = await fetch(url, init);
        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }

        const blob = await resp.blob();
        if (!/^image\/[\w.+-]+/.test(blob.type)) {
            throw new Error(`Not an image: '${blob.type}'`);
        }

        const dataUrl = await blob2base64(blob);
        if (!dataUrl) {
            throw new Error("The image could not be read.");
        }

        return dataUrl;
    }

    /**
     * Inlines the image as a base64 data URL, and returns whether it could be read. A `data:` URL
     * goes through `fetch()` too, which decodes a URL-encoded one; Trilium reads only base64.
     */
    async function postProcessImage(image: ClippedImage) {
        try {
            image.dataUrl = await fetchImage(image.src);
        } catch (e) {
            console.error(`Cannot fetch image from ${image.src.substring(0, 100)}`, e);
            return false;
        }

        if (image.src.startsWith("data:")) {
            // A `data:` URL names no file: Trilium names the attachment `inline.<type>`.
            const type = image.dataUrl.substring("data:image/".length).split(/[+;,]/)[0];
            image.src = `inline.${type}`;
        }
        return true;
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
                // A callback, so `$&` and `$$` in the URL are not read as replacement patterns.
                payload.content = payload.content?.replaceAll(image.imageId, () => escapeHtml(image.src));
            }
        }

        const failedCount = payload.images.length - downloaded.length;
        payload.images = downloaded;
        return failedCount;
    }

    /** Saves the selection on the page, or the one the popup already read and the user titled. */
    async function saveSelection(selection?: object): Promise<Saved> {
        const payload = selection ?? await requestFromPage({name: 'trilium-save-selection'});

        const failedImages = await postProcessImages(payload);

        const resp = await triliumServerFacade.callService('POST', 'clippings', payload);

        return { noteId: resp.noteId, message: savedMessage("Selection", failedImages) };
    }

    /** A clipping of the images, one after another. */
    async function getImagePayload(srcs: string[], pageUrl: string | null | undefined, screenshot = false) {
        const images: ClippedImage[] = srcs.map((src) => ({
            imageId: randomString(20),
            src,
            ...(screenshot && { screenshot })
        }));
        const activeTab = await getActiveTab();
        const { description } = await readPageMetadata();
        const payload = {
            title: activeTab.title,
            content: images.map(({ imageId }) => `<img src="${imageId}">`).join(""),
            images,
            pageUrl,
            ...(description && { labels: { pageDescription: description } })
        };

        const failedImages = await postProcessImages(payload);

        return { payload, failedImages };
    }

    /**
     * What the page says about itself. A screenshot or an image is saved without it where no
     * content script answers: on browser pages, and on a page loaded before the extension was
     * updated.
     */
    async function readPageMetadata(): Promise<{ description?: string }> {
        try {
            return await sendMessageToActiveTab({ name: "trilium-get-page-metadata" }) ?? {};
        } catch {
            return {};
        }
    }

    async function saveCroppedScreenshot(pageUrl: string | null | undefined) {
        const { rect, devicePixelRatio } = await requestFromPage({
            name: 'trilium-get-rectangle-for-screenshot'
        });
        if (!rect) return undefined;

        return await saveScreenshot([ await takeCroppedScreenshot(rect, devicePixelRatio) ], pageUrl);
    }

    async function saveScreenshot(
        srcs: string[],
        pageUrl: string | null | undefined,
        message = "Screenshot has been saved to Trilium."
    ): Promise<Saved> {
        const { payload } = await getImagePayload(srcs, pageUrl, true);

        const resp = await triliumServerFacade.callService("POST", "clippings", payload);

        return { noteId: resp.noteId, message };
    }

    async function saveImage(srcUrl: string, pageUrl: string | null | undefined): Promise<Saved> {
        const { payload, failedImages } = await getImagePayload([ srcUrl ], pageUrl);

        const resp = await triliumServerFacade.callService("POST", "clippings", payload);

        return { noteId: resp.noteId, message: savedMessage("Image", failedImages) };
    }

    /**
     * Saves the page the popup already extracted and the user edited, or else the article, or the
     * whole page when it has none.
     */
    async function saveWholePage(page?: object): Promise<Saved> {
        let payload = page;
        if (!payload) {
            const activeTab = await getActiveTab();
            if (activeTab.url && await isPdfTab(activeTab)) {
                return await savePdf(activeTab.url, activeTab.title);
            }
            payload = await readPage(activeTab);
        }

        const failedImages = await postProcessImages(payload);

        const resp = await triliumServerFacade.callService('POST', 'notes', payload);

        return { noteId: resp.noteId, message: savedMessage("Page", failedImages) };
    }

    /**
     * Downloads the PDF at `url`, as the browser does, with the website's cookies, and saves it as a
     * file note. Trilium has the route for it since protocol version 1.1.
     */
    async function savePdf(url: string, title: string | undefined, description?: string): Promise<Saved> {
        await triliumServerFacade.requireMinorVersion(1, "Saving a PDF");
        const { dataUrl, fileName } = await downloadPdf(url);

        const resp = await triliumServerFacade.callService("POST", "files", {
            title: title || (await getActiveTab()).title,
            fileName,
            pageUrl: url,
            dataUrl,
            ...(description && { labels: { pageDescription: description } })
        });

        return { noteId: resp.noteId, message: savedMessage("PDF", 0) };
    }

    async function downloadPdf(url: string) {
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) {
            throw new Error(`The PDF could not be downloaded: HTTP ${response.status}`);
        }
        if (Number(response.headers.get("content-length")) > MAX_PDF_SIZE) {
            throw pdfTooLarge();
        }

        const blob = await response.blob();
        if (blob.size > MAX_PDF_SIZE) {
            throw pdfTooLarge();
        }
        // A PDF can have bytes before its header, within the first kilobyte.
        if (!(await blob.slice(0, 1024).text()).includes("%PDF-")) {
            throw new Error("The page is not a PDF.");
        }

        const dataUrl = await blob2base64(new Blob([ blob ], { type: "application/pdf" }));
        if (!dataUrl) {
            throw new Error("The PDF could not be read.");
        }

        return { dataUrl, fileName: pdfFileName(response, url) };
    }

    async function readPage(activeTab: Browser.tabs.Tab) {
        const tabId = activeTab.id;
        if (tabId !== undefined) {
            const article = await extractPage(tabId, "article");
            if (article) return article;
            const wholePage = await extractPage(tabId, "wholePage");
            if (wholePage) return wholePage;
        }
        throw new Error("Trilium found nothing to save on this page.");
    }

    async function saveLinkWithNote(title: string, content: string, description?: string): Promise<Saved> {
        const activeTab = await getActiveTab();

        if (!title.trim()) {
            title = activeTab.title ?? "";
        }

        const resp = await triliumServerFacade.callService('POST', 'notes', {
            title,
            content,
            clipType: 'note',
            pageUrl: activeTab.url,
            ...(description && { labels: { pageDescription: description } })
        });

        return { noteId: resp.noteId, message: "Link with note has been saved to Trilium." };
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

        // Trilium builds link mentions from `tabs` when link previews are turned on; older versions
        // ignore it and save `content`.
        return {
            title: `${tabs.length} browser tabs: ${topDomains}`,
            content,
            clipType: 'tabs',
            tabs: await Promise.all(tabs.map(async tab => ({
                url: tab.url,
                title: tab.title ?? tab.url,
                favicon: await fetchFavicon(tab.favIconUrl)
            })))
        };
    }

    /** The tab's favicon as a base64 data URL, or `undefined` if there is none it can read. */
    async function fetchFavicon(url: string | undefined) {
        if (!url) return undefined;
        try {
            return await fetchImage(url, { signal: AbortSignal.timeout(OPTIONAL_REQUEST_TIMEOUT_MS) });
        } catch {
            return undefined;
        }
    }

    async function saveTabs(): Promise<Saved> {
        const tabs = (await getWindowTabs())
            .filter((tab): tab is Browser.tabs.Tab & { url: string } => !!tab.url);

        const payload = await getTabsPayload(tabs);

        const resp = await triliumServerFacade.callService('POST', 'notes', payload);

        const tabIds = tabs.map(tab => tab.id).filter(id => id !== undefined) as number[];
        return { noteId: resp.noteId, message: `${tabs.length} links have been saved to Trilium.`, tabIds };
    }

    browser.contextMenus.onClicked.addListener((info: ContextMenuInfo) => showFailures(async () => {
        if (info.menuItemId === 'trilium-save-selection') {
            notify(await saveSelection());
        }
        else if (info.menuItemId === 'trilium-save-cropped-screenshot') {
            notify(await saveCroppedScreenshot(info.pageUrl));
        }
        else if (info.menuItemId === 'trilium-save-whole-screenshot') {
            notify(await saveScreenshot([ await takeWholeScreenshot() ], info.pageUrl));
        }
        else if (info.menuItemId === 'trilium-save-full-page-screenshot') {
            notify(await saveFullPageScreenshot(info.pageUrl));
        }
        else if (info.menuItemId === 'trilium-save-image') {
            if (!info.srcUrl) return;
            notify(await saveImage(info.srcUrl, info.pageUrl));
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

            notify({ noteId: resp.noteId, message: "Link has been saved to Trilium." });
        }
        else if (info.menuItemId === 'trilium-save-page') {
            notify(await saveWholePage());
        }
        else {
            console.log("Unrecognized menuItemId", info.menuItemId);
        }
    }));

    // Chrome ignores a promise the listener returns: it answers through `sendResponse()`, after `true`.
    browser.runtime.onMessage.addListener((request, _sender, sendResponse) => {
        void showFailures(() => handleMessage(request)).then(sendResponse);
        return true;
    });

    async function handleMessage(request: any) {
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
            return await saveForPopup(async () => saveCroppedScreenshot((await getActiveTab()).url));
        }
        else if (request.name === 'save-whole-screenshot') {
            return await saveForPopup(async () => {
                const activeTab = await getActiveTab();
                return saveScreenshot([ await takeWholeScreenshot() ], activeTab.url);
            });
        }
        else if (request.name === 'save-full-page-screenshot') {
            return await saveForPopup(async () => saveFullPageScreenshot((await getActiveTab()).url));
        }
        else if (request.name === 'save-whole-page') {
            return await saveForPopup(() => saveWholePage(request.page));
        }
        else if (request.name === 'save-pdf') {
            return await saveForPopup(() => savePdf(request.url, request.title, request.description));
        }
        else if (request.name === 'save-selection') {
            return await saveForPopup(() => saveSelection(request.selection));
        }
        else if (request.name === 'save-link-with-note') {
            return await saveForPopup(() => saveLinkWithNote(request.title, request.content, request.description));
        }
        else if (request.name === 'save-tabs') {
            return await saveForPopup(saveTabs);
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
    }
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

function pdfTooLarge() {
    return new Error(`The PDF is larger than ${MAX_PDF_SIZE / 1024 / 1024} MB, the most the clipper saves.`);
}

/**
 * The PDF's file name, as the website gives it or as its address ends, with a `.pdf` extension;
 * `undefined` when neither names it.
 */
function pdfFileName(response: Response, url: string) {
    const disposition = response.headers.get("content-disposition") ?? "";
    const encoded = /filename\*=[^']*'[^']*'([^;]+)/i.exec(disposition)?.[1];
    const plain = /filename=\s*"?([^";]+)/i.exec(disposition)?.[1];
    const { pathname } = new URL(url);
    const name = (encoded && decodeComponent(encoded.trim()))
        || plain?.trim()
        || decodeComponent(pathname.slice(pathname.lastIndexOf("/") + 1));
    if (!name) return undefined;
    return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

/** Decodes a percent-encoded name, or keeps it as it is when it is malformed. */
function decodeComponent(value: string) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function failureMessage(error: unknown) {
    if (error instanceof TriliumError) return error.message;
    return `Saving to Trilium failed: ${describeError(error)}`;
}

function delay(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
