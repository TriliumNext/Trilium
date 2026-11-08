export type Rect = { x: number, y: number, width: number, height: number };

/** How long a request the extension can do without, such as a favicon, has to answer, in milliseconds. */
export const OPTIONAL_REQUEST_TIMEOUT_MS = 3000;

/** An image of a clipping; the clipping's `content` references it by `imageId`. */
export type ClippedImage = { imageId: string, src: string };

/** A page clip, as `entrypoints/readable-page/index.ts` extracts it. */
export interface ReadablePage {
    title: string;
    content: string;
    images: ClippedImage[];
    pageUrl: string;
    clipType: "page";
    labels: Record<string, string>;
}

/** What a save made: the note, the message that reports it, and the tabs it saved, if any. */
export type Saved = { noteId: string, message: string, tabIds?: number[] };

/** How a save the popup asked for went, as the background answers it. */
export type SaveOutcome = Saved | { error: string };

/** The two ways to read a page: its article, as Defuddle finds it, and all of it. */
export type PageVariant = "article" | "wholePage";

declare global {
    /** Registered in the tab's isolated world by `entrypoints/readable-page/index.ts`. */
    var triliumReadPage: (variant: PageVariant) => ReadablePage | undefined;
}

/**
 * Injects `entrypoints/readable-page/index.ts` into the tab and reads the page as `variant`, or
 * returns `undefined` when that reading shows nothing. Throws where the extension cannot run
 * scripts, such as browser pages.
 */
export async function extractPage(tabId: number, variant: PageVariant): Promise<ReadablePage | undefined> {
    await browser.scripting.executeScript({ target: { tabId }, files: [ "/readable-page.js" ] });
    const [ injection ] = await browser.scripting.executeScript({
        target: { tabId },
        func: (variant: PageVariant) => globalThis.triliumReadPage(variant),
        args: [ variant ]
    });
    return (injection?.result ?? undefined) as ReadablePage | undefined;
}

/**
 * Whether the tab shows a PDF in the browser's own viewer. Chrome runs scripts in the page around
 * its viewer; Firefox runs none in its viewer, so the website is asked for the type instead.
 */
export async function isPdfTab({ id, url }: { id?: number, url?: string }) {
    if (id === undefined || !url || !/^https?:\/\//.test(url)) return false;

    try {
        const [ injection ] = await browser.scripting.executeScript({ target: { tabId: id }, func: isPdfDocument });
        return injection?.result === true;
    } catch {
        try {
            const signal = AbortSignal.timeout(OPTIONAL_REQUEST_TIMEOUT_MS);
            const response = await fetch(url, { method: "HEAD", credentials: "include", signal });
            return isPdfType(response.headers.get("content-type"));
        } catch {
            return false;
        }
    }
}

/** Runs in the tab. Chrome's viewer is an `<embed>` of `about:blank` in the page at the PDF's address. */
function isPdfDocument() {
    return document.contentType === "application/pdf"
        || !!document.querySelector("embed[type='application/pdf'][src='about:blank']");
}

/** Whether a `Content-Type` header names a PDF, whatever its parameters. */
export function isPdfType(contentType: string | null) {
    return contentType?.split(";")[0]?.trim().toLowerCase() === "application/pdf";
}

/**
 * The cause of a thrown value, which might be an error from another realm, which `instanceof Error`
 * rejects, an error without a message, or not an error at all.
 */
export function describeError(error: unknown) {
    if (error instanceof Error) return error.message || error.name;
    const message = (error as { message?: unknown } | null | undefined)?.message;
    if (typeof message === "string" && message) return message;
    return String(error);
}

export function randomString(len: number) {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (let i = 0; i < len; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }

    return text;
}

export function getPageLocationOrigin() {
    // location.origin normally returns the protocol + domain + port (eg. https://example.com:8080)
    // but for file:// protocol this is browser dependant and in particular Firefox returns "null" in this case.
    return location.protocol === 'file:' ? 'file://' : location.origin;
}

export function createLink(clickAction: object, text: string, color = "lightskyblue") {
    const link = document.createElement('a');
    link.href = "javascript:";
    link.style.color = color;
    link.appendChild(document.createTextNode(text));
    link.addEventListener("click", () => {
        browser.runtime.sendMessage(null, clickAction);
    });

    return link;
}

/** The page's own summary, preferred to the one it gives social sites, on a single line. */
export function getPageDescription() {
    const selectors = [
        "meta[name='description']",
        "meta[property='og:description']",
        "meta[name='twitter:description']"
    ];
    for (const selector of selectors) {
        const description = document.querySelector(selector)?.getAttribute("content")
            ?.replace(/\s+/g, " ").trim();
        if (description) return description;
    }
    return undefined;
}

/** The `#pageDescription` label of every clip of the page, if the page has one. */
export function descriptionLabels(): Record<string, string> {
    const description = getPageDescription();
    return description ? { pageDescription: description } : {};
}

export function makeLinksAbsolute(container: HTMLElement) {
    // `link.href` reads the URL the browser resolved against the page, and leaves
    // `mailto:`, `tel:` and other non-web schemes unchanged.
    for (const link of container.getElementsByTagName('a')) {
        if (link.href) {
            link.setAttribute("href", link.href);
        }
    }
}

/**
 * Replaces the `src` of each image in `container` with an `imageId`, the same one for the same image.
 * An image waiting to be lazy-loaded is listed under the address the page keeps for later.
 */
export function getImages(container: HTMLElement) {
    const images: ClippedImage[] = [];

    for (const img of container.getElementsByTagName('img')) {
        const src = lazyImageSource(img) ?? img.src;
        if (!src) {
            continue;
        }

        const existingImage = images.find(image => image.src === src);

        if (existingImage) {
            img.src = existingImage.imageId;
        }
        else {
            const imageId = randomString(20);

            images.push({
                imageId,
                src
            });

            img.src = imageId;
        }
    }

    return images;
}

/** The attributes lazy-loading scripts keep an image's address in, the same ones Defuddle reads. */
const LAZY_SOURCE_ATTRIBUTES = [ "data-src", "data-original", "data-lazy-src" ];

/** The web address in the first lazy-loading attribute of `img` that holds one. */
function lazyImageSource(img: HTMLImageElement) {
    for (const attribute of LAZY_SOURCE_ATTRIBUTES) {
        const value = img.getAttribute(attribute)?.trim();
        if (!value) continue;

        let url: URL;
        try {
            url = new URL(value, img.baseURI);
        } catch {
            continue;
        }
        if (url.protocol === "http:" || url.protocol === "https:") {
            return url.href;
        }
    }
    return undefined;
}
