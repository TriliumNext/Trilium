import { ScreenshotStitcher, type StitchMessage } from "@/screenshot";

let stitcher: ScreenshotStitcher | undefined;
let stitchedParts: string[] = [];

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'CROP_IMAGE') {
        cropImage(message.cropRect, message.dataUrl).then(sendResponse);
        return true; // Keep channel open for async response
    }
    if (typeof message.type === "string" && message.type.startsWith("STITCH_")) {
        // A failure answers its message, which the background script throws again.
        stitch(message).then(sendResponse, (e: Error) => sendResponse({ error: e.message }));
        return true;
    }
});

/**
 * Stitches a full-page screenshot one message at a time: Chrome refuses a message over 64 MiB,
 * which the captures of a long page, or all of its images, would exceed.
 */
async function stitch(message: StitchMessage) {
    switch (message.type) {
        case "STITCH_BEGIN":
            stitcher = new ScreenshotStitcher(message.request);
            stitchedParts = [];
            return {};
        case "STITCH_ADD":
            await currentStitcher().add(message.slice);
            return {};
        case "STITCH_FINISH":
            stitchedParts = currentStitcher().finish();
            stitcher = undefined;
            return { count: stitchedParts.length };
        case "STITCH_PART":
            return { dataUrl: stitchedParts[message.index] };
    }
}

function currentStitcher() {
    if (!stitcher) {
        throw new Error("No screenshot is being stitched.");
    }
    return stitcher;
}

function cropImage(newArea: { x: number, y: number, width: number, height: number }, dataUrl: string) {
    return new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = newArea.width;
            canvas.height = newArea.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(img, newArea.x, newArea.y, newArea.width, newArea.height,
                    0, 0, newArea.width, newArea.height);
            }
            resolve(canvas.toDataURL());
        };
        img.src = dataUrl;
    });
}
