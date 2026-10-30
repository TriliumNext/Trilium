import type { BootstrapDefinition } from "@triliumnext/commons";

/**
 * The device the page renders for, as `bootstrap` reports it or as the URL and browser say. A print
 * link opened without a session renders the setup, set-password or login screen, which takes the
 * screen device so that `loadStylesheets()` loads the theme.
 */
export function resolveDevice(bootstrap: BootstrapState) {
    const device = bootstrap.device || getDevice();
    const rendersPrintPage = bootstrap.dbInitialized
        && bootstrap.passwordSet !== false
        && bootstrap.loggedIn !== false;
    return device === "print" && !rendersPrintPage ? getScreenDevice() : device;
}

type BootstrapState = Pick<BootstrapDefinition,
    "device" | "dbInitialized" | "passwordSet" | "loggedIn">;

function getDevice() {
    // Respect user's manual override via URL.
    if (new URLSearchParams(window.location.search).has("print")) {
        return "print";
    }
    return getScreenDevice();
}

function getScreenDevice() {
    // Respect user's manual override via URL.
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has("desktop")) {
        return "desktop";
    } else if (urlParams.has("mobile")) {
        return "mobile";
    }

    const deviceCookie = document.cookie.split("; ")
        .find(row => row.startsWith("trilium-device="))?.split("=")[1];
    if (deviceCookie === "desktop" || deviceCookie === "mobile") return deviceCookie;
    return isMobile() ? "mobile" : "desktop";
}

// https://stackoverflow.com/a/73731646/944162
function isMobile() {
    const mQ = matchMedia?.("(pointer:coarse)");
    if (mQ?.media === "(pointer:coarse)") return !!mQ.matches;

    if ("orientation" in window) return true;
    const userAgentsRegEx =
        /\b(Android|iPhone|iPad|iPod|Windows Phone|BlackBerry|webOS|IEMobile)\b/i;
    return userAgentsRegEx.test(navigator.userAgent);
}
