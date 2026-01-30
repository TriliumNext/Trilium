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

    // Polyfill removed jQuery methods for autocomplete.js compatibility
    ($ as any).isArray = Array.isArray;
    ($ as any).isFunction = function(obj: any) { return typeof obj === 'function'; };
    ($ as any).isPlainObject = function(obj: any) {
        if (obj == null || typeof obj !== 'object') { return false; }
        const proto = Object.getPrototypeOf(obj);
        if (proto === null) { return true; }
        const Ctor = Object.prototype.hasOwnProperty.call(proto, 'constructor') && proto.constructor;
        return typeof Ctor === 'function' && Ctor === Object;
    };
}

async function setupGlob() {
    const response = await fetch(`./bootstrap${window.location.search}`);
    const json = await response.json();

    window.global = globalThis; /* fixes https://github.com/webpack/webpack/issues/10035 */
    window.glob = {
        ...json,
        activeDialog: null
    };
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
    const { device, assetPath, themeCssUrl, themeUseNextAsBase } = window.glob;

    const cssToLoad: string[] = [];
    if (device !== "print") {
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
    }

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
            break;
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
