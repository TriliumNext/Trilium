export function getThemeStyle(): "auto" | "light" | "dark" {
    const configuredTheme = window.glob?.theme;
    if (configuredTheme === "auto" || configuredTheme === "next") {
        return "auto";
    }

    if (configuredTheme === "light" || configuredTheme === "dark") {
        return configuredTheme;
    }

    if (configuredTheme === "next-light") {
        return "light";
    }

    if (configuredTheme === "next-dark") {
        return "dark";
    }

    const style = window.getComputedStyle(document.body);
    const themeStyle = style.getPropertyValue("--theme-style");
    if (style.getPropertyValue("--theme-style-auto") !== "true" && (themeStyle === "light" || themeStyle === "dark")) {
        return themeStyle as "light" | "dark";
    }

    return "auto";
}

export function getEffectiveThemeStyle(): "light" | "dark" {
    const themeStyle = getThemeStyle();
    if (themeStyle === "auto") {
        return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    return themeStyle === "dark" ? "dark" : "light";
}
