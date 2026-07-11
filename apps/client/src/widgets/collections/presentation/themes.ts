export const DEFAULT_THEME = "white";

const themes = {
    black: {
        name: "Black",
        loadTheme: () => import("reveal.js/theme/black.css?raw")
    },
    white: {
        name: "White",
        loadTheme: () => import("reveal.js/theme/white.css?raw")
    },
    beige: {
        name: "Beige",
        loadTheme: () => import("reveal.js/theme/beige.css?raw")
    },
    serif: {
        name: "Serif",
        loadTheme: () => import("reveal.js/theme/serif.css?raw")
    },
    simple: {
        name: "Simple",
        loadTheme: () => import("reveal.js/theme/simple.css?raw")
    },
    solarized: {
        name: "Solarized",
        loadTheme: () => import("reveal.js/theme/solarized.css?raw")
    },
    moon: {
        name: "Moon",
        loadTheme: () => import("reveal.js/theme/moon.css?raw")
    },
    dracula: {
        name: "Dracula",
        loadTheme: () => import("reveal.js/theme/dracula.css?raw")
    },
    sky: {
        name: "Sky",
        loadTheme: () => import("reveal.js/theme/sky.css?raw")
    },
    blood: {
        name: "Blood",
        loadTheme: () => import("reveal.js/theme/blood.css?raw")
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
