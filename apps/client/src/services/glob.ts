import utils from "./utils.js";
import appContext from "../components/app_context.js";
import server from "./server.js";
import ws from "./ws.js";
import froca from "./froca.js";
import linkService from "./link.js";

function setupGlobs() {
    window.glob.isDesktop = utils.isDesktop;
    window.glob.isMobile = utils.isMobile;

    window.glob.getComponentByEl = (el) => appContext.getComponentByEl(el);
    window.glob.getHeaders = server.getHeaders;
    window.glob.getReferenceLinkTitle = (href) => linkService.getReferenceLinkTitle(href);
    window.glob.getReferenceLinkTitleSync = (href) => linkService.getReferenceLinkTitleSync(href);

    // required for ESLint plugin and CKEditor
    window.glob.getActiveContextNote = () => appContext.tabManager.getActiveContextNote();
    window.glob.appContext = appContext; // for debugging
    window.glob.froca = froca;
    window.glob.treeCache = froca; // compatibility for CKEditor builds for a while

    window.onerror = function (msg, url, lineNo, columnNo, error) {
        const string = String(msg).toLowerCase();

        let errorObjectString = "";
        try {
            errorObjectString = JSON.stringify(error);
        } catch (e: any) {
            errorObjectString = e.toString();
        }
        let message = "Uncaught error: ";

        if (string.includes("script error")) {
            message += "No details available";
        } else {
            message += [`Message: ${msg}`, `URL: ${url}`, `Line: ${lineNo}`, `Column: ${columnNo}`, `Error object: ${errorObjectString}`, `Stack: ${error && error.stack}`].join(", ");
        }

        ws.logError(message);

        return false;
    };

    window.addEventListener("unhandledrejection", (e) => {
        const string = e?.reason?.message?.toLowerCase();

        let message = "Uncaught error: ";
        let errorObjectString;

        try {
            errorObjectString = JSON.stringify(e.reason)
        } catch (error: any) {
            errorObjectString = error.toString();
        }

        if (string?.includes("script error")) {
            message += "No details available";
        } else {
            message += [
                `Message: ${e.reason.message}`,
                `Line: ${e.reason.lineNumber}`,
                `Column: ${e.reason.columnNumber}`,
                `Error object: ${errorObjectString}`,
                `Stack: ${e.reason && e.reason.stack}`
            ].join(", ");
        }

        ws.logError(message);

        return false;
    });

    for (const appCssNoteId of glob.appCssNoteIds || []) {
        requireCss(`api/notes/download/${appCssNoteId}`, false);
    }

    utils.initHelpButtons($(window));

    $("body").on("click", "a.external", function () {
        window.open($(this).attr("href"), "_blank");

        return false;
    });
}

async function requireCss(url: string, prependAssetPath = true) {
    const cssLinks = Array.from(document.querySelectorAll("link")).map((el) => el.href);

    if (!cssLinks.some((l) => l.endsWith(url))) {
        if (prependAssetPath) {
            url = `${window.glob.assetPath}/${url}`;
        }

        $("head").append($('<link rel="stylesheet" type="text/css" />').attr("href", url));
    }
}

export default {
    setupGlobs
};
