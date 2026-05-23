import type { Extension } from '@codemirror/state';

export type ThemeVariant = "light" | "dark";

export interface ThemeDefinition {
    id: string;
    name: string;
    variant: ThemeVariant;
    load(): Promise<Extension>;
}

const themes: ThemeDefinition[] = [
    {
        id: "abyss",
        name: "Abyss",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-abyss")).abyss
    },
    {
        id: "abcdef",
        name: "ABCDEF",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-abcdef")).abcdef
    },
    {
        id: "android-studio",
        name: "Android Studio",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-android-studio")).androidStudio
    },
    {
        id: "andromeda",
        name: "Andromeda",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-andromeda")).andromeda
    },
    {
        id: "basic-dark",
        name: "Basic Dark",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-basic-dark")).basicDark
    },
    {
        id: "basic-light",
        name: "Basic Light",
        variant: "light",
        load: async () => (await import("@fsegurai/codemirror-theme-basic-light")).basicLight
    },
    {
        id: "catppuccin-frappe",
        name: "Catppuccin Frappé",
        variant: "dark",
        load: async () => (await import("@catppuccin/codemirror")).catppuccinFrappe
    },
    {
        id: "catppuccin-latte",
        name: "Catppuccin Latte",
        variant: "light",
        load: async () => (await import("@catppuccin/codemirror")).catppuccinLatte
    },
    {
        id: "catppuccin-macchiato",
        name: "Catppuccin Macchiato",
        variant: "dark",
        load: async () => (await import("@catppuccin/codemirror")).catppuccinMacchiato
    },
    {
        id: "catppuccin-mocha",
        name: "Catppuccin Mocha",
        variant: "dark",
        load: async () => (await import("@catppuccin/codemirror")).catppuccinMocha
    },
    {
        id: "cobalt2",
        name: "Cobalt2",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-cobalt2")).cobalt2
    },
    {
        id: "forest",
        name: "Forest",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-forest")).forest
    },
    {
        id: "github-dark",
        name: "GitHub Dark",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-github-dark")).githubDark
    },
    {
        id: "github-light",
        name: "GitHub Light",
        variant: "light",
        load: async () => (await import("@fsegurai/codemirror-theme-github-light")).githubLight
    },
    {
        id: "high-contrast-dark",
        name: "High Contrast Dark",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-high-contrast-dark")).highContrastDark
    },
    {
        id: "high-contrast-light",
        name: "High Contrast Light",
        variant: "light",
        load: async () => (await import("@fsegurai/codemirror-theme-high-contrast-light")).highContrastLight
    },
    {
        id: "gruvbox-dark",
        name: "Gruvbox Dark",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-gruvbox-dark")).gruvboxDark
    },
    {
        id: "gruvbox-light",
        name: "Gruvbox Light",
        variant: "light",
        load: async () => (await import("@fsegurai/codemirror-theme-gruvbox-light")).gruvboxLight
    },
    {
        id: "material-mark",
        name: "Material Dark",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-material-dark")).materialDark
    },
    {
        id: "material-light",
        name: "Material Light",
        variant: "light",
        load: async () => (await import("@fsegurai/codemirror-theme-material-light")).materialLight
    },
    {
        id: "material-ocean",
        name: "Material Ocean",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-material-ocean")).materialOcean
    },
    {
        id: "monokai",
        name: "Monokai",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-monokai")).monokai
    },
    {
        id: "nord",
        name: "Nord",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-nord")).nord
    },
    {
        id: "palenight",
        name: "Palenight",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-palenight")).palenight
    },
    {
        id: "solarized-dark",
        name: "Solarized Dark",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-solarized-dark")).solarizedDark
    },
    {
        id: "solarized-light",
        name: "Solarized Light",
        variant: "light",
        load: async () => (await import("@fsegurai/codemirror-theme-solarized-light")).solarizedLight
    },
    {
        id: "synthwave-84",
        name: "Synthwave '84",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-synthwave-84")).synthwave84
    },
    {
        id: "tokyo-night-day",
        name: "Tokyo Night Day",
        variant: "light",
        load: async () => (await import("@fsegurai/codemirror-theme-tokyo-night-day")).tokyoNightDay
    },
    {
        id: "tokyo-night-storm",
        name: "Tokyo Night Storm",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-tokyo-night-storm")).tokyoNightStorm
    },
    {
        id: "volcano",
        name: "Volcano",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-volcano")).volcano
    },
    {
        id: "vs-code-dark",
        name: "VS Code Dark",
        variant: "dark",
        load: async () => (await import("@fsegurai/codemirror-theme-vscode-dark")).vsCodeDark
    },
    {
        id: "vs-code-light",
        name: "VS Code Light",
        variant: "light",
        load: async () => (await import("@fsegurai/codemirror-theme-vscode-light")).vsCodeLight
    },
]

export function getThemeById(id: string) {
    for (const theme of themes) {
        if (theme.id === id) {
            return theme;
        }
    }

    return null;
}

export default themes;
