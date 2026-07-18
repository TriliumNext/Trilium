import type { ElectronWindowApi } from "@triliumnext/commons";

import options from "./options.js";
import { getThemeStyle } from "./theme.js";

/**
 * Pushes the theme-derived part of the native window configuration to Electron: the preferred
 * light/dark mode (which drives the tint of background effects such as Mica on Windows), the
 * window background material and the native title bar colors and button position.
 *
 * These all come from the active theme's CSS variables, which Electron cannot observe itself, so
 * this runs at startup, after every live theme change (see `applyTheme`) and when the OS color
 * scheme changes. No-op outside Electron.
 */
export function syncNativeWindowWithTheme() {
    const win = window.electronApi?.window;
    if (!win) {
        return;
    }

    const style = window.getComputedStyle(document.body);

    applyDarkOrLightMode(win);
    applyTransparencyEffects(win, style);

    // The title bar overlay only exists when the native title bar is hidden; setting it otherwise throws.
    if (options.get("nativeTitleBarVisible") !== "true") {
        applyTitleBarButtons(win, style);
    }
}

/**
 * Informs Electron that we prefer a dark or light theme. Apart from changing prefers-color-scheme at CSS level which is a side effect,
 * this fixes color issues with background effects or native title bars.
 */
function applyDarkOrLightMode(win: ElectronWindowApi) {
    let themeSource: "system" | "light" | "dark" = "system";

    const themeStyle = getThemeStyle();
    if (themeStyle !== "auto") {
        themeSource = themeStyle;
    }

    win.setNativeThemeSource(themeSource);
}

/** Window effects (Mica on Windows and Vibrancy on macOS), driven by the theme's `--background-material`. */
function applyTransparencyEffects(win: ElectronWindowApi, style: CSSStyleDeclaration) {
    const material = style.getPropertyValue("--background-material").trim();
    if (window.glob.platform === "win32") {
        const bgMaterialOptions = ["auto", "none", "mica", "acrylic", "tabbed"] as const;
        const foundBgMaterialOption = bgMaterialOptions.find((bgMaterialOption) => material === bgMaterialOption);
        if (foundBgMaterialOption) {
            win.setBackgroundMaterial(foundBgMaterialOption);
        }
    }

    if (window.glob.platform === "darwin") {
        const bgMaterialOptions = [ "popover", "tooltip", "titlebar", "selection", "menu", "sidebar", "header", "sheet", "window", "hud", "fullscreen-ui", "content", "under-window", "under-page" ] as const;
        const foundBgMaterialOption = bgMaterialOptions.find((bgMaterialOption) => material === bgMaterialOption);
        if (foundBgMaterialOption) {
            win.setVibrancy(foundBgMaterialOption);
        }
    }
}

function applyTitleBarButtons(win: ElectronWindowApi, style: CSSStyleDeclaration) {
    if (window.glob.platform === "win32") {
        const color = style.getPropertyValue("--native-titlebar-background");
        const symbolColor = style.getPropertyValue("--native-titlebar-foreground");
        if (color && symbolColor) {
            win.setTitleBarOverlay({ color, symbolColor });
        }
    }

    if (window.glob.platform === "darwin") {
        const xOffset = parseInt(style.getPropertyValue("--native-titlebar-darwin-x-offset"), 10);
        const yOffset = parseInt(style.getPropertyValue("--native-titlebar-darwin-y-offset"), 10);
        win.setWindowButtonPosition({ x: xOffset, y: yOffset });
    }
}
