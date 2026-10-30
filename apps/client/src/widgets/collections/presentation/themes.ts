export const DEFAULT_THEME = "white";

const themes = {
    black: {
        name: "Black",
        isDark: true,
        loadTheme: () => import("./reveal-themes/black.scss?inline")
    },
    "black-contrast": {
        name: "Black Contrast",
        isDark: true,
        loadTheme: () => import("./reveal-themes/black-contrast.scss?inline")
    },
    white: {
        name: "White",
        isDark: false,
        loadTheme: () => import("./reveal-themes/white.scss?inline")
    },
    "white-contrast": {
        name: "White Contrast",
        isDark: false,
        loadTheme: () => import("./reveal-themes/white-contrast.scss?inline")
    },
    beige: {
        name: "Beige",
        isDark: false,
        loadTheme: () => import("./reveal-themes/beige.scss?inline")
    },
    serif: {
        name: "Serif",
        isDark: false,
        loadTheme: () => import("./reveal-themes/serif.scss?inline")
    },
    simple: {
        name: "Simple",
        isDark: false,
        loadTheme: () => import("./reveal-themes/simple.scss?inline")
    },
    solarized: {
        name: "Solarized",
        isDark: false,
        loadTheme: () => import("./reveal-themes/solarized.scss?inline")
    },
    moon: {
        name: "Moon",
        isDark: true,
        loadTheme: () => import("./reveal-themes/moon.scss?inline")
    },
    dracula: {
        name: "Dracula",
        isDark: true,
        loadTheme: () => import("./reveal-themes/dracula.scss?inline")
    },
    sky: {
        name: "Sky",
        isDark: false,
        loadTheme: () => import("./reveal-themes/sky.scss?inline")
    },
    blood: {
        name: "Blood",
        isDark: true,
        loadTheme: () => import("./reveal-themes/blood.scss?inline")
    },
    league: {
        name: "League",
        isDark: true,
        loadTheme: () => import("./reveal-themes/league.scss?inline")
    },
    night: {
        name: "Night",
        isDark: true,
        loadTheme: () => import("./reveal-themes/night.scss?inline")
    }
} as const;

/** The themes, each with whether its background is dark, as the `color-scheme` that it sets says. */
export function getPresentationThemes() {
    return Object.entries(themes).map(([ id, theme ]) => ({
        id,
        name: theme.name,
        isDark: theme.isDark
    }));
}

/** Whether the background of the theme `name`, or of the default theme for an unknown one, is dark. */
export function isPresentationThemeDark(name: string) {
    return (themes[name as keyof typeof themes] ?? themes[DEFAULT_THEME]).isDark;
}

export async function loadPresentationTheme(name: keyof typeof themes | string) {
    let theme = themes[name];
    if (!theme) theme = themes[DEFAULT_THEME];

    return (await theme.loadTheme()).default;
}
