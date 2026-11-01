import utils from "./utils.js";
import appContext from "../components/app_context.js";
import server from "./server.js";
import ws from "./ws.js";
import froca from "./froca.js";
import linkService from "./link.js";
import { handleSystemBack } from "./system_back.js";

function setupGlobs() {
    window.glob.isDesktop = utils.isDesktop;
    window.glob.isMobile = utils.isMobile;

    window.glob.getComponentByEl = (el) => appContext.getComponentByEl(el);
    window.glob.getHeaders = server.getHeaders;
    window.glob.getReferenceLinkTitle = (href) => linkService.getReferenceLinkTitle(href);
    window.glob.getReferenceLinkTitleSync = (href, storedTitle) =>
        linkService.getReferenceLinkTitleSync(href, storedTitle);

    // required for ESLint plugin
    window.glob.getActiveContextNote = () => appContext.tabManager.getActiveContextNote();
    window.glob.appContext = appContext; // for debugging
    window.glob.froca = froca;
    window.glob.treeCache = froca; // compatibility for CKEditor builds for a while
    window.__triliumHandleBack = handleSystemBack;

    window.onerror = function (msg, url, lineNo, columnNo, error) {
        ws.logError(formatUncaughtError(String(msg), error, `${url}:${lineNo}:${columnNo}`));

        return false;
    };

    window.addEventListener("unhandledrejection", (e) => {
        const reason: unknown = e?.reason;
        const message = (reason as { message?: unknown } | null)?.message;
        ws.logError(formatUncaughtError(
            typeof message === "string" ? message : String(reason), reason));

        return false;
    });

    for (const appCssNoteId of glob.appCssNoteIds || []) {
        requireCss(`api/notes/download/${appCssNoteId}`, false);
    }

    $("body").on("click", "a.external", function () {
        window.open($(this).attr("href"), "_blank");

        return false;
    });
}

export async function requireCss(url: string, prependAssetPath = true) {
    const cssLinks = Array.from(document.querySelectorAll("link")).map((el) => el.href);

    if (!cssLinks.some((l) => l.endsWith(url))) {
        if (prependAssetPath) {
            url = `${window.glob.assetPath}/${url}`;
        }

        $("head").append($('<link rel="stylesheet" type="text/css" />').attr("href", url));
    }
}

/**
 * The log entry of an uncaught error: the message, the error's other properties as JSON, then its
 * stack, or `location` when it has none.
 */
function formatUncaughtError(message: string, error: unknown, location?: string) {
    if (message.toLowerCase().includes("script error")) {
        return "Uncaught error: No details available";
    }

    const lines = [ `Uncaught error: ${message}` ];
    const details = serializeDetails(error);
    if (details) {
        lines.push(`Details: ${details}`);
    }

    const stack = stackWithoutHeader(error);
    if (stack) {
        lines.push(stack);
    } else if (location) {
        lines.push(`at ${location}`);
    }

    return lines.join("\n");
}

/**
 * The JSON of an error's properties other than the `name`, `message` and `stack` the log entry
 * already shows, or `undefined` when it has none. A `CKEditorError` carries the editor object that
 * threw as its `context`, which would serialize the whole document, so it is left out.
 */
function serializeDetails(error: unknown) {
    if (typeof error !== "object" || error === null) {
        return undefined;
    }

    try {
        const json = JSON.stringify(error, function (this: unknown, key, value) {
            if (this === error && [ "name", "message", "stack" ].includes(key)) {
                return undefined;
            }
            return key === "context" && isCKEditorError(this) ? undefined : value;
        });
        return json === "{}" ? undefined : json;
    } catch (e) {
        return String(e);
    }
}

/** The stack of an error, without the `Name: message` line V8 starts it with. */
function stackWithoutHeader(error: unknown) {
    const { name, message, stack } = (error ?? {}) as { name?: unknown; message?: unknown; stack?: unknown };
    if (typeof stack !== "string") {
        return undefined;
    }

    const header = `${name}: ${message}`;
    return (stack.startsWith(header) ? stack.slice(header.length) : stack).replace(/^\n+/, "");
}

function isCKEditorError(value: unknown) {
    const is = (value as { is?: unknown } | null)?.is;
    return typeof is === "function" && is.call(value, "CKEditorError") === true;
}

export default {
    setupGlobs
};
