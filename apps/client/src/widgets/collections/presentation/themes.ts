export const DEFAULT_THEME = "white";

const themes = {
    black: {
        name: "Black",
        loadTheme: () => import("./reveal-themes/black.scss?inline")
    },
    "black-contrast": {
        name: "Black Contrast",
        loadTheme: () => import("./reveal-themes/black-contrast.scss?inline")
    },
    white: {
        name: "White",
        loadTheme: () => import("./reveal-themes/white.scss?inline")
    },
    "white-contrast": {
        name: "White Contrast",
        loadTheme: () => import("./reveal-themes/white-contrast.scss?inline")
    },
    beige: {
        name: "Beige",
        loadTheme: () => import("./reveal-themes/beige.scss?inline")
    },
    serif: {
        name: "Serif",
        loadTheme: () => import("./reveal-themes/serif.scss?inline")
    },
    simple: {
        name: "Simple",
        loadTheme: () => import("./reveal-themes/simple.scss?inline")
    },
    solarized: {
        name: "Solarized",
        loadTheme: () => import("./reveal-themes/solarized.scss?inline")
    },
    moon: {
        name: "Moon",
        loadTheme: () => import("./reveal-themes/moon.scss?inline")
    },
    dracula: {
        name: "Dracula",
        loadTheme: () => import("./reveal-themes/dracula.scss?inline")
    },
    sky: {
        name: "Sky",
        loadTheme: () => import("./reveal-themes/sky.scss?inline")
    },
    blood: {
        name: "Blood",
        loadTheme: () => import("./reveal-themes/blood.scss?inline")
    },
    league: {
        name: "League",
        loadTheme: () => import("./reveal-themes/league.scss?inline")
    },
    night: {
        name: "Night",
        loadTheme: () => import("./reveal-themes/night.scss?inline")
    }
} as const;

export function getPresentationThemes() {
    return Object.entries(themes).map(([ id, theme ]) => ({
        id,
        name: theme.name
    }));
}

export async function loadPresentationTheme(name: keyof typeof themes | string) {
    let theme = themes[name];
    if (!theme) theme = themes[DEFAULT_THEME];

    return (await theme.loadTheme()).default;
}
