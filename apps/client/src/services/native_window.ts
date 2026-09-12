import type { ElectronWindowApi } from "@triliumnext/commons";

import options from "./options.js";
import { getThemeStyle } from "./theme.js";

/**
 * Height of the macOS traffic-light buttons, in device-independent pixels. AppKit draws them at a
 * fixed physical size regardless of the page zoom, so their height has to take part in the
 * conversion in {@link applyTitleBarButtons}.
 *
 * Electron reports the band it reserves for them — `TRAFFIC_LIGHT_HEIGHT + 2 * yOffset` — as
 * `env(titlebar-area-height)`, which is how this was measured rather than guessed. Should a future
 * macOS resize the buttons, the symptom is a constant vertical drift that grows with the zoom.
 */
const TRAFFIC_LIGHT_HEIGHT = 14;

/**
 * Pushes the theme-derived part of the native window configuration to Electron: the preferred
 * light/dark mode (which drives the tint of background effects such as Mica on Windows), the
 * window background material and the native title bar colors and button position.
 *
 * These all come from the active theme's CSS variables, which Electron cannot observe itself, so
 * this runs at startup, after every live theme change (see `applyTheme`), when the OS color scheme
 * changes and when the zoom factor changes (see `zoom.ts`, since the button geometry is expressed
 * in the theme's own CSS pixels). No-op outside Electron.
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
    // The themes express these offsets in the same CSS pixels as the tab bar they have to line up
    // with, but Electron takes them in device-independent pixels, which the page zoom does not
    // touch. Converting through the zoom factor keeps the native buttons where the (scaled) tab bar
    // expects them instead of leaving them stranded at their 100% position.
    const zoomFactor = win.getZoomFactor();
    const toDeviceIndependentPixels = (value: number) => Math.round(value * zoomFactor);

    // Window Controls Overlay is supported on Windows and Linux. The height is opt-in: themes only
    // set --native-titlebar-height where the buttons need repositioning (currently Linux), and
    // leaving it unset keeps Chromium's system caption height.
    if (window.glob.platform === "win32" || window.glob.platform === "linux") {
        const color = style.getPropertyValue("--native-titlebar-background");
        const symbolColor = style.getPropertyValue("--native-titlebar-foreground");
        const height = parseInt(style.getPropertyValue("--native-titlebar-height"), 10);
        if (color && symbolColor) {
            win.setTitleBarOverlay({
                color,
                symbolColor,
                ...(Number.isFinite(height) && { height: toDeviceIndependentPixels(height) })
            });
        }
    }

    if (window.glob.platform === "darwin") {
        const xOffset = parseInt(style.getPropertyValue("--native-titlebar-darwin-x-offset"), 10);
        const yOffset = parseInt(style.getPropertyValue("--native-titlebar-darwin-y-offset"), 10);
        win.setWindowButtonPosition({
            x: toDeviceIndependentPixels(xOffset),
            // The vertical offset is the gap *above* the traffic lights, not their centre line:
            // Electron reserves a band of `TRAFFIC_LIGHT_HEIGHT + 2 * offset` at the top of the
            // window and centres the buttons in it. The buttons keep their size whatever the zoom,
            // so scaling the gap alone would leave them off-centre by half their height for every
            // 100% of zoom — visibly high when zoomed in. Scale the centre line the theme asked for
            // and derive the gap that puts the (unscaled) buttons on it.
            y: Math.max(0, Math.round((yOffset + TRAFFIC_LIGHT_HEIGHT / 2) * zoomFactor - TRAFFIC_LIGHT_HEIGHT / 2))
        });
    }
}
