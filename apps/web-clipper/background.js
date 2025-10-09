// Import modules
import { randomString } from './utils.js';
import { triliumServerFacade } from './trilium_server_facade.js';

// Keyboard shortcuts
chrome.commands.onCommand.addListener(async function (command) {
    if (command == "saveSelection") {
        await saveSelection();
    } else if (command == "saveWholePage") {
        await saveWholePage();
    } else if (command == "saveTabs") {
        await saveTabs();
    } else if (command == "saveCroppedScreenshot") {
        const activeTab = await getActiveTab();
        await saveCroppedScreenshot(activeTab.url);
    } else {
        console.log("Unrecognized command", command);
    }
});

function cropImage(newArea, dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = function () {
            const canvas = document.createElement('canvas');
            canvas.width = newArea.width;
            canvas.height = newArea.height;

            const ctx = canvas.getContext('2d');

            ctx.drawImage(img, newArea.x, newArea.y, newArea.width, newArea.height, 0, 0, newArea.width, newArea.height);

            resolve(canvas.toDataURL());
        };

        img.src = dataUrl;
    });
}

async function takeCroppedScreenshot(cropRect) {
    const activeTab = await getActiveTab();
    const zoom = await chrome.tabs.getZoom(activeTab.id) * globalThis.devicePixelRatio || 1;

    const newArea = Object.assign({}, cropRect);
    newArea.x *= zoom;
    newArea.y *= zoom;
    newArea.width *= zoom;
    newArea.height *= zoom;

    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });

    return await cropImage(newArea, dataUrl);
}

async function takeWholeScreenshot() {
    // this saves only visible portion of the page
    // workaround to save the whole page is to scroll & stitch
    // example in https://github.com/mrcoles/full-page-screen-capture-chrome-extension
    // see page.js and popup.js
    return await chrome.tabs.captureVisibleTab(null, { format: 'png' });
}

chrome.runtime.onInstalled.addListener(() => {
    if (isDevEnv()) {
        chrome.action.setIcon({
            path: 'icons/32-dev.png',
        });
    }
});

// Context menus
chrome.contextMenus.create({
    id: "trilium-save-selection",
    title: "Save selection to Trilium",
    contexts: ["selection"]
});

chrome.contextMenus.create({
    id: "trilium-save-cropped-screenshot",
    title: "Clip screenshot to Trilium",
    contexts: ["page"]
});

chrome.contextMenus.create({
    id: "trilium-save-whole-screenshot",
    title: "Save whole screen shot to Trilium",
    contexts: ["page"]
});

chrome.contextMenus.create({
    id: "trilium-save-page",
    title: "Save whole page to Trilium",
    contexts: ["page"]
});

chrome.contextMenus.create({
    id: "trilium-save-link",
    title: "Save link to Trilium",
    contexts: ["link"]
});

chrome.contextMenus.create({
    id: "trilium-save-image",
    title: "Save image to Trilium",
    contexts: ["image"]
});

async function getActiveTab() {
    const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    return tabs[0];
}

async function getWindowTabs() {
    const tabs = await chrome.tabs.query({
        currentWindow: true
    });

    return tabs;
}

async function sendMessageToActiveTab(message) {
    const activeTab = await getActiveTab();

    if (!activeTab) {
        throw new Error("No active tab.");
    }

    // In Manifest V3, we need to inject content script if not already present
    try {
        return await chrome.tabs.sendMessage(activeTab.id, message);
    } catch (error) {
        // Content script might not be injected, try to inject it
        try {
            await chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                files: ['content.js']
            });

            // Wait a bit for the script to initialize
            await new Promise(resolve => setTimeout(resolve, 200));

            return await chrome.tabs.sendMessage(activeTab.id, message);
        } catch (injectionError) {
            console.error('Failed to inject content script:', injectionError);
            throw new Error(`Failed to communicate with page: ${injectionError.message}`);
        }
    }
}

async function toast(message, noteId = null, tabIds = null) {
    try {
        await sendMessageToActiveTab({
            name: 'toast',
            message: message,
            noteId: noteId,
            tabIds: tabIds
        });
    } catch (error) {
        console.error('Failed to show toast:', error);
    }
}

function showStatusToast(message, isProgress = true) {
    // Make this completely async and fire-and-forget
    // Only try to send status if we're confident the content script will be ready
    (async () => {
        try {
            // Test if content script is ready with a quick ping
            const activeTab = await getActiveTab();
            if (!activeTab) return;

            await chrome.tabs.sendMessage(activeTab.id, { name: 'ping' });
            // If ping succeeds, send the status toast
            await chrome.tabs.sendMessage(activeTab.id, {
                name: 'status-toast',
                message: message,
                isProgress: isProgress
            });
        } catch (error) {
            // Content script not ready or failed - silently skip
        }
    })();
}

function updateStatusToast(message, isProgress = true) {
    // Make this completely async and fire-and-forget
    (async () => {
        try {
            const activeTab = await getActiveTab();
            if (!activeTab) return;

            // Direct message without injection logic since content script should be ready by now
            await chrome.tabs.sendMessage(activeTab.id, {
                name: 'update-status-toast',
                message: message,
                isProgress: isProgress
            });
        } catch (error) {
            // Content script not ready or failed - silently skip
        }
    })();
}

function blob2base64(blob) {
    return new Promise(resolve => {
        const reader = new FileReader();
        reader.onloadend = function() {
            resolve(reader.result);
        };
        reader.readAsDataURL(blob);
    });
}

async function fetchImage(url) {
    const resp = await fetch(url);
    const blob = await resp.blob();

    return await blob2base64(blob);
}

async function postProcessImage(image) {
    if (image.src.startsWith("data:image/")) {
        image.dataUrl = image.src;
        image.src = "inline." + image.src.substr(11, 3); // this should extract file type - png/jpg
    }
    else {
        try {
            image.dataUrl = await fetchImage(image.src, image);
        }
        catch (e) {
            console.log(`Cannot fetch image from ${image.src}`);
        }
    }
}

async function postProcessImages(resp) {
    if (resp && resp.images) {
        for (const image of resp.images) {
            await postProcessImage(image);
        }
    }
}

async function saveSelection() {
    showStatusToast("📝 Capturing selection...");

    const payload = await sendMessageToActiveTab({name: 'trilium-save-selection'});

    if (!payload) {
        console.error('No payload received from content script');
        updateStatusToast("❌ Failed to capture selection", false);
        return;
    }

    if (payload.images && payload.images.length > 0) {
        updateStatusToast(`🖼️ Processing ${payload.images.length} image(s)...`);
    }
    await postProcessImages(payload);

    const triliumType = triliumServerFacade.triliumSearch?.status === 'found-desktop' ? 'Desktop' : 'Server';
    updateStatusToast(`💾 Saving to Trilium ${triliumType}...`);

    const resp = await triliumServerFacade.callService('POST', 'clippings', payload);

    if (!resp) {
        updateStatusToast("❌ Failed to save to Trilium", false);
        return;
    }

    await toast("✅ Selection has been saved to Trilium.", resp.noteId);
}

async function getImagePayloadFromSrc(src, pageUrl) {
    const image = {
        imageId: randomString(20),
        src: src
    };

    await postProcessImage(image);

    const activeTab = await getActiveTab();

    return {
        title: activeTab.title,
        content: `<img src="${image.imageId}">`,
        images: [image],
        pageUrl: pageUrl
    };
}

async function saveCroppedScreenshot(pageUrl) {
    showStatusToast("📷 Preparing screenshot...");

    const cropRect = await sendMessageToActiveTab({name: 'trilium-get-rectangle-for-screenshot'});

    updateStatusToast("📸 Capturing screenshot...");
    const src = await takeCroppedScreenshot(cropRect);

    const payload = await getImagePayloadFromSrc(src, pageUrl);

    const triliumType = triliumServerFacade.triliumSearch?.status === 'found-desktop' ? 'Desktop' : 'Server';
    updateStatusToast(`💾 Saving to Trilium ${triliumType}...`);

    const resp = await triliumServerFacade.callService("POST", "clippings", payload);

    if (!resp) {
        updateStatusToast("❌ Failed to save screenshot", false);
        return;
    }

    await toast("✅ Screenshot has been saved to Trilium.", resp.noteId);
}

async function saveWholeScreenshot(pageUrl) {
    showStatusToast("📸 Capturing full screenshot...");

    const src = await takeWholeScreenshot();

    const payload = await getImagePayloadFromSrc(src, pageUrl);

    const triliumType = triliumServerFacade.triliumSearch?.status === 'found-desktop' ? 'Desktop' : 'Server';
    updateStatusToast(`💾 Saving to Trilium ${triliumType}...`);

    const resp = await triliumServerFacade.callService("POST", "clippings", payload);

    if (!resp) {
        updateStatusToast("❌ Failed to save screenshot", false);
        return;
    }

    await toast("✅ Screenshot has been saved to Trilium.", resp.noteId);
}

async function saveImage(srcUrl, pageUrl) {
    const payload = await getImagePayloadFromSrc(srcUrl, pageUrl);

    const resp = await triliumServerFacade.callService("POST", "clippings", payload);

    if (!resp) {
        return;
    }

    await toast("Image has been saved to Trilium.", resp.noteId);
}

async function saveWholePage() {
    // Step 1: Show initial status (completely non-blocking)
    showStatusToast("📄 Page capture started...");

    const payload = await sendMessageToActiveTab({name: 'trilium-save-page'});

    if (!payload) {
        console.error('No payload received from content script');
        updateStatusToast("❌ Failed to capture page content", false);
        return;
    }

    // Step 2: Processing images
    if (payload.images && payload.images.length > 0) {
        updateStatusToast(`🖼️ Processing ${payload.images.length} image(s)...`);
    }
    await postProcessImages(payload);

    // Step 3: Saving to Trilium
    const triliumType = triliumServerFacade.triliumSearch?.status === 'found-desktop' ? 'Desktop' : 'Server';
    updateStatusToast(`💾 Saving to Trilium ${triliumType}...`);

    const resp = await triliumServerFacade.callService('POST', 'notes', payload);

    if (!resp) {
        updateStatusToast("❌ Failed to save to Trilium", false);
        return;
    }

    // Step 4: Success with link
    await toast("✅ Page has been saved to Trilium.", resp.noteId);
}

async function saveLinkWithNote(title, content) {
    const activeTab = await getActiveTab();

    if (!title.trim()) {
        title = activeTab.title;
    }

    const resp = await triliumServerFacade.callService('POST', 'notes', {
        title: title,
        content: content,
        clipType: 'note',
        pageUrl: activeTab.url
    });

    if (!resp) {
        return false;
    }

    await toast("Link with note has been saved to Trilium.", resp.noteId);

    return true;
}

async function getTabsPayload(tabs) {
    let content = '<ul>';
    tabs.forEach(tab => {
        content += `<li><a href="${tab.url}">${tab.title}</a></li>`
    });
    content += '</ul>';

    const domainsCount = tabs.map(tab => tab.url)
        .reduce((acc, url) => {
            const hostname = new URL(url).hostname
            return acc.set(hostname, (acc.get(hostname) || 0) + 1)
        }, new Map());

    let topDomains = [...domainsCount]
        .sort((a, b) => {return b[1]-a[1]})
        .slice(0,3)
        .map(domain=>domain[0])
        .join(', ')

    if (tabs.length > 3) { topDomains += '...' }

    return {
        title: `${tabs.length} browser tabs: ${topDomains}`,
        content: content,
        clipType: 'tabs'
    };
}

async function saveTabs() {
    const tabs = await getWindowTabs();

    const payload = await getTabsPayload(tabs);

    const resp = await triliumServerFacade.callService('POST', 'notes', payload);

    if (!resp) {
        return;
    }

    const tabIds = tabs.map(tab=>{return tab.id});

    await toast(`${tabs.length} links have been saved to Trilium.`, resp.noteId, tabIds);
}

// Helper function
function isDevEnv() {
    const manifest = chrome.runtime.getManifest();
    return manifest.name.endsWith('(dev)');
}

chrome.contextMenus.onClicked.addListener(async function(info, tab) {
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
        await saveImage(info.srcUrl, info.pageUrl);
    }
    else if (info.menuItemId === 'trilium-save-link') {
        const link = document.createElement("a");
        link.href = info.linkUrl;
        // linkText might be available only in firefox
        link.appendChild(document.createTextNode(info.linkText || info.linkUrl));

        const activeTab = await getActiveTab();

        const resp = await triliumServerFacade.callService('POST', 'clippings', {
            title: activeTab.title,
            content: link.outerHTML,
            pageUrl: info.pageUrl
        });

        if (!resp) {
            return;
        }

        await toast("Link has been saved to Trilium.", resp.noteId);
    }
    else if (info.menuItemId === 'trilium-save-page') {
        await saveWholePage();
    }
    else {
        console.log("Unrecognized menuItemId", info.menuItemId);
    }
});

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    console.log("Received", request);

    if (request.name === 'openNoteInTrilium') {
        const resp = await triliumServerFacade.callService('POST', 'open/' + request.noteId);

        if (!resp) {
            return;
        }

        // desktop app is not available so we need to open in browser
        if (resp.result === 'open-in-browser') {
            const {triliumServerUrl} = await chrome.storage.sync.get("triliumServerUrl");

            if (triliumServerUrl) {
                const noteUrl = triliumServerUrl + '/#' + request.noteId;

                console.log("Opening new tab in browser", noteUrl);

                chrome.tabs.create({
                    url: noteUrl
                });
            }
            else {
                console.error("triliumServerUrl not found in local storage.");
            }
        }
    }
    else if (request.name === 'closeTabs') {
        return await chrome.tabs.remove(request.tabIds)
    }
    else if (request.name === 'load-script') {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: sender.tab?.id },
                files: [request.file]
            });
            return { success: true };
        } catch (error) {
            console.error('Failed to load script:', request.file, error);
            return { success: false, error: error.message };
        }
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
        triliumServerFacade.triggerSearchNoteByUrl(activeTab.url);
    }

    // Important: return true to indicate async response
    return true;
});
