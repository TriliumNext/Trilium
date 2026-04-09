import { getThemeStyle } from "./services/theme";

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
    window.glob.getThemeStyle = getThemeStyle;
}

async function loadBootstrapCss() {
    // We have to selectively import Bootstrap CSS based on text direction.
    if (glob.isRtl) {
        await import("bootstrap/dist/css/bootstrap.rtl.min.css");
    } else {
        await import("bootstrap/dist/css/bootstrap.min.css");
    }
}

type StylesheetRef = {
    href: string;
    media?: string;
};

function getConfiguredThemeStylesheets(stylesheetsPath: string, theme: string, customThemeCssUrl?: string) {
    if (theme === "auto") {
        return [{ href: `${stylesheetsPath}/theme-dark.css`, media: "(prefers-color-scheme: dark)" }];
    }

    if (theme === "dark") {
        return [{ href: `${stylesheetsPath}/theme-dark.css` }];
    }

    if (theme === "next") {
        return [
            { href: `${stylesheetsPath}/theme-next-light.css` },
            { href: `${stylesheetsPath}/theme-next-dark.css`, media: "(prefers-color-scheme: dark)" }
        ];
    }

    if (theme === "next-light") {
        return [{ href: `${stylesheetsPath}/theme-next-light.css` }];
    }

    if (theme === "next-dark") {
        return [{ href: `${stylesheetsPath}/theme-next-dark.css` }];
    }

    if (theme !== "light" && customThemeCssUrl) {
        return [{ href: customThemeCssUrl }];
    }

    return [];
}

function loadStylesheets() {
    const { device, assetPath, theme, themeBase, customThemeCssUrl } = window.glob;
    const stylesheetsPath = `${assetPath}/stylesheets`;

    const cssToLoad: StylesheetRef[] = [];
    if (device !== "print") {
        cssToLoad.push({ href: `${stylesheetsPath}/ckeditor-theme.css` });
        cssToLoad.push({ href: `api/fonts` });
        cssToLoad.push({ href: `${stylesheetsPath}/theme-light.css` });
        cssToLoad.push(...getConfiguredThemeStylesheets(stylesheetsPath, theme, customThemeCssUrl));
        if (themeBase) {
            cssToLoad.push(...getConfiguredThemeStylesheets(stylesheetsPath, themeBase));
        }
        cssToLoad.push({ href: `${stylesheetsPath}/style.css` });
    }

    for (const { href, media } of cssToLoad) {
        const linkEl = document.createElement("link");
        linkEl.href = href;
        linkEl.rel = "stylesheet";
        if (media) {
            linkEl.media = media;
        }
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
