import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    applyCustomFontsFromOptions: vi.fn(async () => {}),
    hasCustomFontContentChanged: vi.fn(() => false),
    applyFontCss: vi.fn(),
    applyThemeFromOptions: vi.fn(async () => {}),
    isIOS: vi.fn(() => false),
    isMobile: vi.fn(() => false)
}));

vi.mock("./custom_fonts.js", () => ({
    applyCustomFontsFromOptions: mocks.applyCustomFontsFromOptions,
    hasCustomFontContentChanged: mocks.hasCustomFontContentChanged
}));
vi.mock("./font.js", () => ({ applyFontCss: mocks.applyFontCss }));
vi.mock("./theme.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./theme.js")>()),
    applyThemeFromOptions: mocks.applyThemeFromOptions
}));
vi.mock("./utils.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./utils.js")>()),
    isIOS: () => mocks.isIOS(),
    isMobile: () => mocks.isMobile()
}));

import { applyAppearance, applyReloadedAppearance } from "./appearance.js";
import LoadResults from "./load_results.js";
import options from "./options.js";

describe("applyAppearance", () => {
    beforeEach(() => {
        options.load({
            theme: "next",
            locale: "he",
            maxContentWidth: "200",
            centerContent: "false",
            motionEnabled: "true",
            shadowsEnabled: "false",
            backdropEffectsEnabled: "true",
            monospaceLigaturesEnabled: "false",
            textNoteStickyTableHeadersEnabled: "false",
            experimentalFeatures: "[]",
            aiEnabled: "true"
        });
    });

    afterEach(() => {
        document.body.className = "";
        document.body.removeAttribute("style");
        document.body.removeAttribute("data-theme-id");
        document.body.lang = "";
        document.body.dir = "";
        document.body.innerHTML = "";
        document.head.querySelector("meta[name='theme-color']")?.remove();
        mocks.isIOS.mockReturnValue(false);
        mocks.isMobile.mockReturnValue(false);
    });

    it("sets the body's classes, custom properties, theme, locale and experimental features from the options", () => {
        applyAppearance();

        const body = document.body;
        expect(body.getAttribute("data-theme-id")).toBe("next");
        expect(body.classList.contains("ios")).toBe(false);
        // The content width has a floor.
        expect(body.style.getPropertyValue("--preferred-max-content-width")).toBe("640px");
        expect(body.classList.contains("prefers-centered-content")).toBe(false);
        expect(body.classList.contains("motion-disabled")).toBe(false);
        expect(body.classList.contains("shadows-disabled")).toBe(true);
        expect(body.classList.contains("backdrop-effects-disabled")).toBe(false);
        expect(body.classList.contains("monospace-ligatures-disabled")).toBe(true);
        expect(body.classList.contains("sticky-table-headers-disabled")).toBe(true);
        expect(body.lang).toBe("he");
        expect(body.dir).toBe("rtl");
        expect(body.classList.contains("experimental-feature-llm")).toBe(true);
        expect(mocks.applyCustomFontsFromOptions).toHaveBeenCalled();
    });

    it("marks iOS, and turns the backdrop effects off on other mobile devices", () => {
        mocks.isMobile.mockReturnValue(true);
        applyAppearance();
        expect(document.body.classList.contains("ios")).toBe(false);
        expect(document.body.classList.contains("backdrop-effects-disabled")).toBe(true);

        mocks.isIOS.mockReturnValue(true);
        applyAppearance();
        expect(document.body.classList.contains("ios")).toBe(true);
        expect(document.body.classList.contains("backdrop-effects-disabled")).toBe(false);
    });

    it("keeps the `theme-color` meta tag on the color of the background tracker", () => {
        document.body.innerHTML = `<div id="background-color-tracker" style="color: rgb(1, 2, 3)"></div>`;
        applyAppearance();
        const meta = document.head.querySelector("meta[name='theme-color']");
        expect(meta?.getAttribute("content")).toBe("rgb(1, 2, 3)");

        const tracker = document.getElementById("background-color-tracker");
        tracker?.style.setProperty("color", "rgb(4, 5, 6)");
        tracker?.dispatchEvent(new Event("transitionend"));
        expect(document.head.querySelectorAll("meta[name='theme-color']")).toHaveLength(1);
        expect(meta?.getAttribute("content")).toBe("rgb(4, 5, 6)");
    });
});

describe("applyReloadedAppearance", () => {
    afterEach(() => {
        document.body.className = "";
        document.body.removeAttribute("style");
        mocks.hasCustomFontContentChanged.mockReturnValue(false);
        vi.clearAllMocks();
    });

    it("applies only the options that were reloaded", async () => {
        options.load({
            theme: "next",
            maxContentWidth: "1000",
            centerContent: "true",
            motionEnabled: "false",
            shadowsEnabled: "false",
            backdropEffectsEnabled: "false",
            monospaceLigaturesEnabled: "false",
            textNoteStickyTableHeadersEnabled: "false"
        });
        const body = document.body;

        applyReloadedAppearance(reloaded("motionEnabled", "backdropEffectsEnabled"));
        expect(body.classList.contains("motion-disabled")).toBe(true);
        expect(body.classList.contains("backdrop-effects-disabled")).toBe(true);
        expect(body.classList.contains("shadows-disabled")).toBe(false);
        expect(mocks.applyThemeFromOptions).not.toHaveBeenCalled();

        applyReloadedAppearance(reloaded("theme", "shadowsEnabled", "monospaceLigaturesEnabled", "textNoteStickyTableHeadersEnabled"));
        expect(mocks.applyThemeFromOptions).toHaveBeenCalledTimes(1);
        expect(body.classList.contains("shadows-disabled")).toBe(true);
        expect(body.classList.contains("monospace-ligatures-disabled")).toBe(true);
        expect(body.classList.contains("sticky-table-headers-disabled")).toBe(true);

        expect(body.style.getPropertyValue("--preferred-max-content-width")).toBe("");
        applyReloadedAppearance(reloaded("centerContent"));
        expect(body.style.getPropertyValue("--preferred-max-content-width")).toBe("1000px");
        expect(body.classList.contains("prefers-centered-content")).toBe(true);
        options.set("maxContentWidth", "1200");
        applyReloadedAppearance(reloaded("maxContentWidth"));
        expect(body.style.getPropertyValue("--preferred-max-content-width")).toBe("1200px");

        // None of them is a font option.
        await vi.dynamicImportSettled();
        expect(mocks.applyFontCss).not.toHaveBeenCalled();
        expect(mocks.applyCustomFontsFromOptions).not.toHaveBeenCalled();
    });

    it("rebuilds the stylesheet of the font options when one of them changes", async () => {
        options.load({ overrideThemeFonts: "true", mainFontFamily: "Arial" });
        applyReloadedAppearance(reloaded("mainFontFamily"));
        await vi.waitFor(() => expect(mocks.applyFontCss).toHaveBeenCalledTimes(1));
        expect(mocks.applyFontCss.mock.calls[0]?.[0]).toContain("Arial");
        expect(mocks.applyCustomFontsFromOptions).toHaveBeenCalledTimes(1);
    });

    it("loads the user's fonts again when the content of one of them changes", async () => {
        applyReloadedAppearance(reloaded());
        expect(mocks.applyCustomFontsFromOptions).not.toHaveBeenCalled();

        mocks.hasCustomFontContentChanged.mockReturnValue(true);
        applyReloadedAppearance(reloaded());
        expect(mocks.applyCustomFontsFromOptions).toHaveBeenCalledTimes(1);

        // Alongside an option that is not a font option.
        applyReloadedAppearance(reloaded("motionEnabled"));
        await vi.waitFor(() => expect(mocks.applyCustomFontsFromOptions).toHaveBeenCalledTimes(2));
        expect(mocks.applyFontCss).not.toHaveBeenCalled();
    });
});

function reloaded(...optionNames: Parameters<LoadResults["addOption"]>[0][]) {
    const loadResults = new LoadResults([]);
    for (const optionName of optionNames) {
        loadResults.addOption(optionName);
    }
    return loadResults;
}
