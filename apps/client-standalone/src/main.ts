import { attachServiceWorkerBridge, startLocalServerWorker } from "./local-bridge.js";

async function bootstrap() {
    /* fixes https://github.com/webpack/webpack/issues/10035 */
    window.global = globalThis;

    // 1) Start local worker ASAP (so /bootstrap is fast)
    startLocalServerWorker();

    // 2) Bridge SW -> local worker
    attachServiceWorkerBridge();

    // 3) Register SW
    if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.register("./sw.js", { scope: "/" });
        // Optionally wait for activation
        await navigator.serviceWorker.ready;
    }

    await setupGlob();
    loadStylesheets();
    loadIcons();
    setBodyAttributes();
    await loadScripts();
}

async function setupGlob() {
    const response = await fetch("/bootstrap");
    console.log("Service worker state", navigator.serviceWorker.controller);
    console.log("Resp", response);
    const json = await response.json();
    console.log("Bootstrap", json);

    window.glob = {
        ...json,
        activeDialog: null
    };
}

function loadStylesheets() {
    const { assetPath, themeCssUrl, themeUseNextAsBase } = window.glob;
    const cssToLoad = [];
    cssToLoad.push(`${assetPath}/stylesheets/theme-light.css`);
    if (themeCssUrl) {
        cssToLoad.push(themeCssUrl);
    }
    if (themeUseNextAsBase === "next") {
        cssToLoad.push(`${assetPath}/stylesheets/theme-next.css`)
    } else if (themeUseNextAsBase === "next-dark") {
        cssToLoad.push(`${assetPath}/stylesheets/theme-next-dark.css`)
    } else if (themeUseNextAsBase === "next-light") {
        cssToLoad.push(`${assetPath}/stylesheets/theme-next-light.css`)
    }
    cssToLoad.push(`${assetPath}/stylesheets/style.css`);

    for (const href of cssToLoad) {
        const linkEl = document.createElement("link");
        linkEl.href = href;
        linkEl.rel = "stylesheet";
        document.body.appendChild(linkEl);
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
        isElectron && "isElectron",
        hasNativeTitleBar && "native-titlebar",
        hasBackgroundEffects && "background-effects"
    ].filter(Boolean);

    for (const classToSet of classesToSet) {
        document.body.classList.add(classToSet);
    }

    document.body.lang = currentLocale.id;
    document.body.dir = currentLocale.rtl ? "rtl" : "ltr";
}

async function loadScripts() {
    await import("./runtime.js");
    await import("./desktop.js");
}

bootstrap();
