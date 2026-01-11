async function bootstrap() {
    showSplash();
    await setupGlob();
    await Promise.all([
        initJQuery(),
        loadBootstrapCss()
    ]);
    loadStylesheets();
    loadIcons();
    setBodyAttributes();
    await loadScripts();
    hideSplash();
}

async function initJQuery() {
    const $ = (await import("jquery")).default;
    window.$ = $;
    window.jQuery = $;
}

async function setupGlob() {
    const response = await fetch(`/bootstrap${window.location.search}`);
    const json = await response.json();

    window.global = globalThis; /* fixes https://github.com/webpack/webpack/issues/10035 */
    window.glob = {
        ...json,
        activeDialog: null,
        device: json.device || getDevice()
    };
}

function getDevice() {
    // Respect user's manual override via URL.
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has("print")) {
        return "print";
    } else if (urlParams.has("desktop")) {
        return "desktop";
    } else if (urlParams.has("mobile")) {
        return "mobile";
    }

    const deviceCookie = document.cookie.split("; ").find(row => row.startsWith("trilium-device="))?.split("=")[1];
    if (deviceCookie === "desktop" || deviceCookie === "mobile") return deviceCookie;
    return isMobile() ? "mobile" : "desktop";
}

// https://stackoverflow.com/a/73731646/944162
function isMobile() {
    const mQ = matchMedia?.("(pointer:coarse)");
    if (mQ?.media === "(pointer:coarse)") return !!mQ.matches;

    if ("orientation" in window) return true;
    const userAgentsRegEx = /\b(Android|iPhone|iPad|iPod|Windows Phone|BlackBerry|webOS|IEMobile)\b/i;
    return userAgentsRegEx.test(navigator.userAgent);
}

async function loadBootstrapCss() {
    // We have to selectively import Bootstrap CSS based on text direction.
    if (glob.isRtl) {
        await import("bootstrap/dist/css/bootstrap.rtl.min.css");
    } else {
        await import("bootstrap/dist/css/bootstrap.min.css");
    }
}

function loadStylesheets() {
    const { assetPath, themeCssUrl, themeUseNextAsBase } = window.glob;
    const cssToLoad: string[] = [];
    cssToLoad.push(`${assetPath}/stylesheets/ckeditor-theme.css`);
    cssToLoad.push(`api/fonts`);
    cssToLoad.push(`${assetPath}/stylesheets/theme-light.css`);
    if (themeCssUrl) {
        cssToLoad.push(themeCssUrl);
    }
    if (themeUseNextAsBase === "next") {
        cssToLoad.push(`${assetPath}/stylesheets/theme-next.css`);
    } else if (themeUseNextAsBase === "next-dark") {
        cssToLoad.push(`${assetPath}/stylesheets/theme-next-dark.css`);
    } else if (themeUseNextAsBase === "next-light") {
        cssToLoad.push(`${assetPath}/stylesheets/theme-next-light.css`);
    }
    cssToLoad.push(`${assetPath}/stylesheets/style.css`);

    for (const href of cssToLoad) {
        const linkEl = document.createElement("link");
        linkEl.href = href;
        linkEl.rel = "stylesheet";
        document.head.appendChild(linkEl);
    }
}

function loadIcons() {
    const styleEl = document.createElement("style");
    styleEl.innerText = window.glob.iconPackCss;
    document.head.appendChild(styleEl);
}

function setBodyAttributes() {
    const { device, headingStyle, layoutOrientation, platform, isElectron, hasNativeTitleBar, hasBackgroundEffects, currentLocale } = window.glob;
    const classesToSet = [
        device,
        `heading-style-${headingStyle}`,
        `layout-${layoutOrientation}`,
        `platform-${platform}`,
        isElectron && "electron",
        hasNativeTitleBar && "native-titlebar",
        hasBackgroundEffects && "background-effects"
    ].filter(Boolean) as string[];

    for (const classToSet of classesToSet) {
        document.body.classList.add(classToSet);
    }

    document.body.lang = currentLocale.id;
    document.body.dir = currentLocale.rtl ? "rtl" : "ltr";
}

async function loadScripts() {
    switch (glob.device) {
        case "mobile":
            await import("./mobile.js");
            break;
        case "print":
            await import("./print.js");
            break;
        case "desktop":
        default:
            await import("./desktop.js");
    }
}

function showSplash() {
    // hide body to reduce flickering on the startup. This is done through JS and not CSS to not hide <noscript>
    document.body.style.display = "none";
}

function hideSplash() {
    document.body.style.display = "block";
}

bootstrap();
