import { dayjs } from "@triliumnext/commons";
import { snapdom } from "@zumer/snapdom";

import FNote from "../entities/fnote";
import type { ViewMode, ViewScope } from "./link.js";

const SVG_MIME = "image/svg+xml";

export const isShare = !window.glob;

export function reloadFrontendApp(reason?: string) {
    if (reason) {
        logInfo(`Frontend app reload: ${reason}`);
    }

    if (isElectron()) {
        dynamicRequire("@electron/remote").BrowserWindow.getFocusedWindow()?.reload();
    } else {
        window.location.reload();
    }
}

export function restartDesktopApp() {
    if (!isElectron()) {
        reloadFrontendApp();
        return;
    }

    const app = dynamicRequire("@electron/remote").app;
    app.relaunch();
    app.exit();
}

/**
 * Triggers the system tray to update its menu items, i.e. after a change in dynamic content such as bookmarks or recent notes.
 *
 * On any other platform than Electron, nothing happens.
 */
function reloadTray() {
    if (!isElectron()) {
        return;
    }

    const { ipcRenderer } = dynamicRequire("electron");
    ipcRenderer.send("reload-tray");
}

function parseDate(str: string) {
    try {
        return new Date(Date.parse(str));
    } catch (e: any) {
        throw new Error(`Can't parse date from '${str}': ${e.message} ${e.stack}`);
    }
}

function padNum(num: number) {
    return `${num <= 9 ? "0" : ""}${num}`;
}

function formatTime(date: Date) {
    return `${padNum(date.getHours())}:${padNum(date.getMinutes())}`;
}

function formatTimeWithSeconds(date: Date) {
    return `${padNum(date.getHours())}:${padNum(date.getMinutes())}:${padNum(date.getSeconds())}`;
}

function formatTimeInterval(ms: number) {
    const seconds = Math.round(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const plural = (count: number, name: string) => `${count} ${name}${count > 1 ? "s" : ""}`;
    const segments: string[] = [];

    if (days > 0) {
        segments.push(plural(days, "day"));
    }

    if (days < 2) {
        if (hours % 24 > 0) {
            segments.push(plural(hours % 24, "hour"));
        }

        if (hours < 4) {
            if (minutes % 60 > 0) {
                segments.push(plural(minutes % 60, "minute"));
            }

            if (minutes < 5) {
                if (seconds % 60 > 0) {
                    segments.push(plural(seconds % 60, "second"));
                }
            }
        }
    }

    return segments.join(", ");
}

/** this is producing local time! **/
function formatDate(date: Date) {
    //    return padNum(date.getDate()) + ". " + padNum(date.getMonth() + 1) + ". " + date.getFullYear();
    // instead of european format we'll just use ISO as that's pretty unambiguous

    return formatDateISO(date);
}

/** this is producing local time! **/
function formatDateISO(date: Date) {
    return `${date.getFullYear()}-${padNum(date.getMonth() + 1)}-${padNum(date.getDate())}`;
}

export function formatDateTime(date: Date, userSuppliedFormat?: string): string {
    if (userSuppliedFormat?.trim()) {
        return dayjs(date).format(userSuppliedFormat);
    }
    return `${formatDate(date)} ${formatTime(date)}`;
}

function localNowDateTime() {
    return dayjs().format("YYYY-MM-DD HH:mm:ss.SSSZZ");
}

function now() {
    return formatTimeWithSeconds(new Date());
}

/**
 * Returns `true` if the client is currently running under Electron, or `false` if running in a web browser.
 */
export function isElectron() {
    return !!(window && window.process && window.process.type);
}

/**
 * Returns `true` if the client is running as a PWA, otherwise `false`.
 */
export function isPWA() {
    return (
        window.matchMedia('(display-mode: standalone)').matches
        || window.matchMedia('(display-mode: window-controls-overlay)').matches
        || window.navigator.standalone
        || window.navigator.windowControlsOverlay
    );
}

export function isMac() {
    return navigator.platform.indexOf("Mac") > -1;
}

export const hasTouchBar = (isMac() && isElectron());

export function isCtrlKey(evt: KeyboardEvent | MouseEvent | JQuery.ClickEvent | JQuery.ContextMenuEvent | JQuery.TriggeredEvent | React.PointerEvent<HTMLCanvasElement> | JQueryEventObject) {
    return (!isMac() && evt.ctrlKey) || (isMac() && evt.metaKey);
}

function assertArguments<T>(...args: T[]) {
    for (const i in args) {
        if (!args[i]) {
            console.trace(`Argument idx#${i} should not be falsy: ${args[i]}`);
        }
    }
}

const entityMap: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
    "/": "&#x2F;",
    "`": "&#x60;",
    "=": "&#x3D;"
};

export function escapeHtml(str: string) {
    return str.replace(/[&<>"'`=\/]/g, (s) => entityMap[s]);
}

export function escapeQuotes(value: string) {
    return value.replaceAll('"', "&quot;");
}

export function formatSize(size: number | null | undefined) {
    if (size === null || size === undefined) {
        return "";
    }

    size = Math.max(Math.round(size / 1024), 1);

    if (size < 1024) {
        return `${size} KiB`;
    }
    return `${Math.round(size / 102.4) / 10} MiB`;

}

function toObject<T, R>(array: T[], fn: (arg0: T) => [key: string, value: R]) {
    const obj: Record<string, R> = {};

    for (const item of array) {
        const [key, value] = fn(item);

        obj[key] = value;
    }

    return obj;
}

export function randomString(len: number = 16) {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (let i = 0; i < len; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }

    return text;
}

export function isMobile() {
    return (
        window.glob?.device === "mobile" ||
        // window.glob.device is not available in setup
        (!window.glob?.device && /Mobi/.test(navigator.userAgent))
    );
}

/**
 * Returns true if the client device is an Apple iOS one (iPad, iPhone, iPod).
 * Does not check if the user requested the mobile or desktop layout, use {@link isMobile} for that.
 *
 * @returns `true` if running under iOS.
 */
export function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function isDesktop() {
    return (
        window.glob?.device === "desktop" ||
        // window.glob.device is not available in setup
        (!window.glob?.device && !/Mobi/.test(navigator.userAgent))
    );
}

/**
 * the cookie code below works for simple use cases only - ASCII only
 * not setting a path so that cookies do not leak into other websites if multiplexed with reverse proxy
 */
function setCookie(name: string, value: string) {
    const date = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
    const expires = `; expires=${date.toUTCString()}`;

    document.cookie = `${name}=${value || ""}${expires};`;
}

function getNoteTypeClass(type: string) {
    return `type-${type}`;
}

function getMimeTypeClass(mime: string) {
    if (!mime) {
        return "";
    }

    const semicolonIdx = mime.indexOf(";");

    if (semicolonIdx !== -1) {
        // stripping everything following the semicolon
        mime = mime.substr(0, semicolonIdx);
    }

    return `mime-${mime.toLowerCase().replace(/[\W_]+/g, "-")}`;
}

export function isHtmlEmpty(html: string) {
    if (!html) {
        return true;
    } else if (typeof html !== "string") {
        logError(`Got object of type '${typeof html}' where string was expected.`);
        return false;
    }

    html = html.toLowerCase();

    return (
        !html.includes("<img") &&
        !html.includes("<section") &&
        // the line below will actually attempt to load images so better to check for images first
        $("<div>").html(html).text().trim().length === 0
    );
}

function formatHtml(html: string) {
    let indent = "\n";
    const tab = "\t";
    let i = 0;
    const pre: { indent: string; tag: string }[] = [];

    html = html
        .replace(new RegExp("<pre>([\\s\\S]+?)?</pre>"), (x) => {
            pre.push({ indent: "", tag: x });
            return `<--TEMPPRE${i++}/-->`;
        })
        .replace(new RegExp("<[^<>]+>[^<]?", "g"), (x) => {
            let ret;
            const tagRegEx = /<\/?([^\s/>]+)/.exec(x);
            const tag = tagRegEx ? tagRegEx[1] : "";
            const p = new RegExp("<--TEMPPRE(\\d+)/-->").exec(x);

            if (p) {
                const pInd = parseInt(p[1]);
                pre[pInd].indent = indent;
            }

            if (["area", "base", "br", "col", "command", "embed", "hr", "img", "input", "keygen", "link", "menuitem", "meta", "param", "source", "track", "wbr"].indexOf(tag) >= 0) {
                // self closing tag
                ret = indent + x;
            } else if (x.indexOf("</") < 0) {
                //open tag
                if (x.charAt(x.length - 1) !== ">") ret = indent + x.substr(0, x.length - 1) + indent + tab + x.substr(x.length - 1, x.length);
                else ret = indent + x;
                !p && (indent += tab);
            } else {
                //close tag
                indent = indent.substr(0, indent.length - 1);
                if (x.charAt(x.length - 1) !== ">") ret = indent + x.substr(0, x.length - 1) + indent + x.substr(x.length - 1, x.length);
                else ret = indent + x;
            }
            return ret;
        });

    for (i = pre.length; i--;) {
        html = html.replace(`<--TEMPPRE${i}/-->`, pre[i].tag.replace("<pre>", "<pre>\n").replace("</pre>", `${pre[i].indent}</pre>`));
    }

    return html.charAt(0) === "\n" ? html.substr(1, html.length - 1) : html;
}

export async function clearBrowserCache() {
    if (isElectron()) {
        const win = dynamicRequire("@electron/remote").getCurrentWindow();
        await win.webContents.session.clearCache();
    }
}

function copySelectionToClipboard() {
    const text = window?.getSelection()?.toString();
    if (text && navigator.clipboard) {
        navigator.clipboard.writeText(text);
    }
}

type dynamicRequireMappings = {
    "@electron/remote": typeof import("@electron/remote"),
    "electron": typeof import("electron"),
    "child_process": typeof import("child_process")
};

export function dynamicRequire<T extends keyof dynamicRequireMappings>(moduleName: T): Awaited<dynamicRequireMappings[T]>{
    if (typeof __non_webpack_require__ !== "undefined") {
        return __non_webpack_require__(moduleName);
    }
    // explicitly pass as string and not as expression to suppress webpack warning
    // 'Critical dependency: the request of a dependency is an expression'
    return require(`${moduleName}`);

}

function timeLimit<T>(promise: Promise<T>, limitMs: number, errorMessage?: string) {
    if (!promise || !promise.then) {
        // it's not actually a promise
        return promise;
    }

    // better stack trace if created outside of promise
    const error = new Error(errorMessage || `Process exceeded time limit ${limitMs}`);

    return new Promise<T>((res, rej) => {
        let resolved = false;

        promise.then((result) => {
            resolved = true;

            res(result);
        });

        setTimeout(() => {
            if (!resolved) {
                rej(error);
            }
        }, limitMs);
    });
}

function initHelpDropdown($el: JQuery<HTMLElement>) {
    // stop inside clicks from closing the menu
    const $dropdownMenu = $el.find(".help-dropdown .dropdown-menu");
    $dropdownMenu.on("click", (e) => e.stopPropagation());

    // previous propagation stop will also block help buttons from being opened, so we need to re-init for this element
    initHelpButtons($dropdownMenu);
}

const wikiBaseUrl = "https://triliumnext.github.io/Docs/Wiki/";

function openHelp($button: JQuery<HTMLElement>) {
    if ($button.length === 0) {
        return;
    }

    const helpPage = $button.attr("data-help-page");

    if (helpPage) {
        const url = wikiBaseUrl + helpPage;

        window.open(url, "_blank");
    }
}

async function openInAppHelp($button: JQuery<HTMLElement>) {
    if ($button.length === 0) {
        return;
    }

    const inAppHelpPage = $button.attr("data-in-app-help");
    if (inAppHelpPage) {
        openInAppHelpFromUrl(inAppHelpPage);
    }
}

/**
 * Opens the in-app help at the given page in a split note. If there already is a split note open with a help page, it will be replaced by this one.
 *
 * @param inAppHelpPage the ID of the help note (excluding the `_help_` prefix).
 * @returns a promise that resolves once the help has been opened.
 */
export function openInAppHelpFromUrl(inAppHelpPage: string) {
    return openInReusableSplit(`_help_${inAppHelpPage}`, "contextual-help");
}

/**
 * Similar to opening a new note in a split, but re-uses an existing split if there is already one open with the same view mode.
 *
 * @param targetNoteId the note ID to open in the split.
 * @param targetViewMode the view mode of the split to open the note in.
 * @param openOpts additional options for opening the note.
 */
export async function openInReusableSplit(targetNoteId: string, targetViewMode: ViewMode, openOpts: {
    hoistedNoteId?: string;
} = {}) {
    // Dynamic import to avoid import issues in tests.
    const appContext = (await import("../components/app_context.js")).default;
    const activeContext = appContext.tabManager.getActiveContext();
    if (!activeContext) {
        return;
    }
    const subContexts = activeContext.getSubContexts();
    const existingSubcontext = subContexts.find((s) => s.viewScope?.viewMode === targetViewMode);
    const viewScope: ViewScope = { viewMode: targetViewMode };
    if (!existingSubcontext) {
        // The target split is not already open, open a new split with it.
        const { ntxId } = subContexts[subContexts.length - 1];
        appContext.triggerCommand("openNewNoteSplit", {
            ntxId,
            notePath: targetNoteId,
            hoistedNoteId: openOpts.hoistedNoteId,
            viewScope
        });
    } else {
        // There is already a target split open, make sure it opens on the right note.
        existingSubcontext.setNote(targetNoteId, { viewScope });
    }
}

function initHelpButtons($el: JQuery<HTMLElement> | JQuery<Window>) {
    // for some reason, the .on(event, listener, handler) does not work here (e.g. Options -> Sync -> Help button)
    // so we do it manually
    $el.on("click", (e) => {
        openHelp($(e.target).closest("[data-help-page]"));
        openInAppHelp($(e.target).closest("[data-in-app-help]"));
    });
}

function filterAttributeName(name: string) {
    return name.replace(/[^\p{L}\p{N}_:]/gu, "");
}

const ATTR_NAME_MATCHER = new RegExp("^[\\p{L}\\p{N}_:]+$", "u");

function isValidAttributeName(name: string) {
    return ATTR_NAME_MATCHER.test(name);
}

function sleep(time_ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, time_ms);
    });
}

export function escapeRegExp(str: string) {
    return str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
}

function areObjectsEqual(...args: unknown[]) {
    let i;
    let l;
    let leftChain: object[];
    let rightChain: object[];

    function compare2Objects(x: unknown, y: unknown) {
        let p;

        // remember that NaN === NaN returns false
        // and isNaN(undefined) returns true
        if (typeof x === "number" && typeof y === "number" && isNaN(x) && isNaN(y)) {
            return true;
        }

        // Compare primitives and functions.
        // Check if both arguments link to the same object.
        // Especially useful on the step where we compare prototypes
        if (x === y) {
            return true;
        }

        // Works in case when functions are created in constructor.
        // Comparing dates is a common scenario. Another built-ins?
        // We can even handle functions passed across iframes
        if (
            (typeof x === "function" && typeof y === "function") ||
            (x instanceof Date && y instanceof Date) ||
            (x instanceof RegExp && y instanceof RegExp) ||
            (x instanceof String && y instanceof String) ||
            (x instanceof Number && y instanceof Number)
        ) {
            return x.toString() === y.toString();
        }

        // At last, checking prototypes as good as we can
        if (!(x instanceof Object && y instanceof Object)) {
            return false;
        }

        if (x.isPrototypeOf(y) || y.isPrototypeOf(x)) {
            return false;
        }

        if (x.constructor !== y.constructor) {
            return false;
        }

        if ((x as any).prototype !== (y as any).prototype) {
            return false;
        }

        // Check for infinitive linking loops
        if (leftChain.indexOf(x) > -1 || rightChain.indexOf(y) > -1) {
            return false;
        }

        // Quick checking of one object being a subset of another.
        // todo: cache the structure of arguments[0] for performance
        for (p in y) {
            if (y.hasOwnProperty(p) !== x.hasOwnProperty(p)) {
                return false;
            } else if (typeof (y as any)[p] !== typeof (x as any)[p]) {
                return false;
            }
        }

        for (p in x) {
            if (y.hasOwnProperty(p) !== x.hasOwnProperty(p)) {
                return false;
            } else if (typeof (y as any)[p] !== typeof (x as any)[p]) {
                return false;
            }

            switch (typeof (x as any)[p]) {
                case "object":
                case "function":
                    leftChain.push(x);
                    rightChain.push(y);

                    if (!compare2Objects((x as any)[p], (y as any)[p])) {
                        return false;
                    }

                    leftChain.pop();
                    rightChain.pop();
                    break;

                default:
                    if ((x as any)[p] !== (y as any)[p]) {
                        return false;
                    }
                    break;
            }
        }

        return true;
    }

    if (arguments.length < 1) {
        return true; //Die silently? Don't know how to handle such case, please help...
        // throw "Need two or more arguments to compare";
    }

    for (i = 1, l = arguments.length; i < l; i++) {
        leftChain = []; //Todo: this can be cached
        rightChain = [];

        if (!compare2Objects(arguments[0], arguments[i])) {
            return false;
        }
    }

    return true;
}

function copyHtmlToClipboard(content: string) {
    function listener(e: ClipboardEvent) {
        if (e.clipboardData) {
            e.clipboardData.setData("text/html", content);
            e.clipboardData.setData("text/plain", content);
        }
        e.preventDefault();
    }
    document.addEventListener("copy", listener);
    document.execCommand("copy");
    document.removeEventListener("copy", listener);
}

export function createImageSrcUrl(note: FNote) {
    return `api/images/${note.noteId}/${encodeURIComponent(note.title)}?timestamp=${Date.now()}`;
}





/**
 * Helper function to prepare an element for snapdom rendering.
 * Handles string parsing and temporary DOM attachment for style computation.
 *
 * @param source - Either an SVG/HTML string to be parsed, or an existing SVG/HTML element.
 * @returns An object containing the prepared element and a cleanup function.
 *          The cleanup function removes temporarily attached elements from the DOM,
 *          or is a no-op if the element was already in the DOM.
 */
function prepareElementForSnapdom(source: string | SVGElement | HTMLElement): {
    element: SVGElement | HTMLElement;
    cleanup: () => void;
} {
    if (typeof source === 'string') {
        const parser = new DOMParser();

        // Detect if content is SVG or HTML
        const isSvg = source.trim().startsWith('<svg');
        const mimeType = isSvg ? SVG_MIME : 'text/html';

        const doc = parser.parseFromString(source, mimeType);
        const element = doc.documentElement;

        // Temporarily attach to DOM for proper style computation
        element.style.position = 'absolute';
        element.style.left = '-9999px';
        element.style.top = '-9999px';
        document.body.appendChild(element);

        return {
            element,
            cleanup: () => document.body.removeChild(element)
        };
    }

    return {
        element: source,
        cleanup: () => {} // No-op for existing elements
    };
}

/**
 * Downloads an SVG using snapdom for proper rendering. Can accept either an SVG string, an SVG element, or an HTML element.
 *
 * @param nameWithoutExtension the name of the file. The .svg suffix is automatically added to it.
 * @param svgSource either an SVG string, an SVGElement, or an HTMLElement to be downloaded.
 */
async function downloadAsSvg(nameWithoutExtension: string, svgSource: string | SVGElement | HTMLElement) {
    const { element, cleanup } = prepareElementForSnapdom(svgSource);

    try {
        const result = await snapdom(element, {
            backgroundColor: "transparent",
            scale: 2
        });
        triggerDownload(`${nameWithoutExtension}.svg`, result.url);
    } finally {
        cleanup();
    }
}

/**
 * Downloads the given data URL on the client device, with a custom file name.
 *
 * @param fileName the name to give the downloaded file.
 * @param dataUrl the data URI to download.
 */
function triggerDownload(fileName: string, dataUrl: string) {
    const element = document.createElement("a");
    element.setAttribute("href", dataUrl);
    element.setAttribute("download", fileName);

    element.style.display = "none";
    document.body.appendChild(element);

    element.click();

    document.body.removeChild(element);
}
/**
 * Downloads an SVG as PNG using snapdom. Can accept either an SVG string, an SVG element, or an HTML element.
 *
 * @param nameWithoutExtension the name of the file. The .png suffix is automatically added to it.
 * @param svgSource either an SVG string, an SVGElement, or an HTMLElement to be converted to PNG.
 */
async function downloadAsPng(nameWithoutExtension: string, svgSource: string | SVGElement | HTMLElement) {
    const { element, cleanup } = prepareElementForSnapdom(svgSource);

    try {
        const result = await snapdom(element, {
            backgroundColor: "transparent",
            scale: 2
        });
        const pngImg = await result.toPng();
        await triggerDownload(`${nameWithoutExtension}.png`, pngImg.src);
    } finally {
        cleanup();
    }
}
export function getSizeFromSvg(svgContent: string) {
    const svgDocument = (new DOMParser()).parseFromString(svgContent, SVG_MIME);

    // Try to use width & height attributes if available.
    let width = svgDocument.documentElement?.getAttribute("width");
    let height = svgDocument.documentElement?.getAttribute("height");

    // If not, use the viewbox.
    if (!width || !height) {
        const viewBox = svgDocument.documentElement?.getAttribute("viewBox");
        if (viewBox) {
            const viewBoxParts = viewBox.split(" ");
            width = viewBoxParts[2];
            height = viewBoxParts[3];
        }
    }

    if (width && height) {
        return {
            width: parseFloat(width),
            height: parseFloat(height)
        };
    }
    console.warn("SVG export error", svgDocument.documentElement);
    return null;

}

/**
 * Compares two semantic version strings.
 * Returns:
 *   1  if v1 is greater than v2
 *   0  if v1 is equal to v2
 *   -1 if v1 is less than v2
 *
 * @param v1 First version string
 * @param v2 Second version string
 * @returns
 */
function compareVersions(v1: string, v2: string): number {
    // Remove 'v' prefix and everything after dash if present
    v1 = v1.replace(/^v/, "").split("-")[0];
    v2 = v2.replace(/^v/, "").split("-")[0];

    const v1parts = v1.split(".").map(Number);
    const v2parts = v2.split(".").map(Number);

    // Pad shorter version with zeros
    while (v1parts.length < 3) v1parts.push(0);
    while (v2parts.length < 3) v2parts.push(0);

    // Compare major version
    if (v1parts[0] !== v2parts[0]) {
        return v1parts[0] > v2parts[0] ? 1 : -1;
    }

    // Compare minor version
    if (v1parts[1] !== v2parts[1]) {
        return v1parts[1] > v2parts[1] ? 1 : -1;
    }

    // Compare patch version
    if (v1parts[2] !== v2parts[2]) {
        return v1parts[2] > v2parts[2] ? 1 : -1;
    }

    return 0;
}

/**
 * Compares two semantic version strings and returns `true` if the latest version is greater than the current version.
 */
function isUpdateAvailable(latestVersion: string | null | undefined, currentVersion: string): boolean {
    if (!latestVersion) {
        return false;
    }
    return compareVersions(latestVersion, currentVersion) > 0;
}

export function isLaunchBarConfig(noteId: string) {
    return ["_lbRoot", "_lbAvailableLaunchers", "_lbVisibleLaunchers", "_lbMobileRoot", "_lbMobileAvailableLaunchers", "_lbMobileVisibleLaunchers"].includes(noteId);
}

/**
 * Adds a class to the <body> of the page, where the class name is formed via a prefix and a value.
 * Useful for configurable options such as `heading-style-markdown`, where `heading-style` is the prefix and `markdown` is the dynamic value.
 * There is no separator between the prefix and the value, if needed it has to be supplied manually to the prefix.
 *
 * @param prefix the prefix.
 * @param value the value to be appended to the prefix.
 */
export function toggleBodyClass(prefix: string, value: string) {
    const $body = $("body");
    for (const clazz of Array.from($body[0].classList)) {
        // create copy to safely iterate over while removing classes
        if (clazz.startsWith(prefix)) {
            $body.removeClass(clazz);
        }
    }

    $body.addClass(prefix + value);
}

/**
 * Basic comparison for equality between the two arrays. The values are strictly checked via `===`.
 *
 * @param a the first array to compare.
 * @param b the second array to compare.
 * @returns `true` if both arrays are equals, `false` otherwise.
 */
export function arrayEqual<T>(a: T[], b: T[]) {
    if (a === b) {
        return true;
    }
    if (a.length !== b.length) {
        return false;
    }

    for (let i=0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }

    return true;
}

export type Indexed<T extends object> = T & { index: number };

/**
 * Given an object array, alters every object in the array to have an index field assigned to it.
 *
 * @param items the objects to be numbered.
 * @returns the same object for convenience, with the type changed to indicate the new index field.
 */
export function numberObjectsInPlace<T extends object>(items: T[]): Indexed<T>[] {
    let index = 0;
    for (const item of items) {
        (item as Indexed<T>).index = index++;
    }
    return items as Indexed<T>[];
}

export function mapToKeyValueArray<K extends string | number | symbol, V>(map: Record<K, V>) {
    const values: { key: K, value: V }[] = [];
    for (const [ key, value ] of Object.entries(map)) {
        values.push({ key: key as K, value: value as V });
    }
    return values;
}

export function getErrorMessage(e: unknown) {
    if (e && typeof e === "object" && "message" in e && typeof e.message === "string") {
        return e.message;
    }
    return "Unknown error";

}

/**
 * Handles left or right placement of e.g. tooltips in case of right-to-left languages. If the current language is a RTL one, then left and right are swapped. Other directions are unaffected.
 * @param placement a string optionally containing a "left" or "right" value.
 * @returns a left/right value swapped if needed, or the same as input otherwise.
 */
export function handleRightToLeftPlacement<T extends string>(placement: T) {
    if (!glob.isRtl) return placement;
    if (placement === "left") return "right";
    if (placement === "right") return "left";
    return placement;
}

export default {
    reloadFrontendApp,
    restartDesktopApp,
    reloadTray,
    parseDate,
    formatDateISO,
    formatDateTime,
    formatTimeInterval,
    formatSize,
    localNowDateTime,
    now,
    isElectron,
    isPWA,
    isMac,
    isCtrlKey,
    assertArguments,
    escapeHtml,
    toObject,
    randomString,
    isMobile,
    isDesktop,
    setCookie,
    getNoteTypeClass,
    getMimeTypeClass,
    isHtmlEmpty,
    formatHtml,
    clearBrowserCache,
    copySelectionToClipboard,
    dynamicRequire,
    timeLimit,
    initHelpDropdown,
    initHelpButtons,
    openHelp,
    filterAttributeName,
    isValidAttributeName,
    sleep,
    escapeRegExp,
    areObjectsEqual,
    copyHtmlToClipboard,
    createImageSrcUrl,
    downloadAsSvg,
    downloadAsPng,
    compareVersions,
    isUpdateAvailable,
    isLaunchBarConfig
};
