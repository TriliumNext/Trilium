import type { Extension } from '@codemirror/state';

export interface ThemeDefinition {
    id: string;
    name: string;
    load(): Promise<Extension>;
}

const themes: ThemeDefinition[] = [
    {
        id: "abyss",
        name: "Abyss",
        load: async () => (await import("@fsegurai/codemirror-theme-abyss")).abyss
    },
    {
        id: "abcdef",
        name: "ABCDEF",
        load: async () => (await import("@fsegurai/codemirror-theme-abcdef")).abcdef
    },
    {
        id: "android-studio",
        name: "Android Studio",
        load: async () => (await import("@fsegurai/codemirror-theme-android-studio")).androidStudio
    },
    {
        id: "andromeda",
        name: "Andromeda",
        load: async () => (await import("@fsegurai/codemirror-theme-andromeda")).andromeda
    },
    {
        id: "basic-dark",
        name: "Basic Dark",
        load: async () => (await import("@fsegurai/codemirror-theme-basic-dark")).basicDark
    },
    {
        id: "basic-light",
        name: "Basic Light",
        load: async () => (await import("@fsegurai/codemirror-theme-basic-light")).basicLight
    },
    {
        id: "catppuccin-frappe",
        name: "Catppuccin Frappé",
        load: async () => (await import("@catppuccin/codemirror")).catppuccinFrappe
    },
    {
        id: "catppuccin-latte",
        name: "Catppuccin Latte",
        load: async () => (await import("@catppuccin/codemirror")).catppuccinLatte
    },
    {
        id: "catppuccin-macchiato",
        name: "Catppuccin Macchiato",
        load: async () => (await import("@catppuccin/codemirror")).catppuccinMacchiato
    },
    {
        id: "catppuccin-mocha",
        name: "Catppuccin Mocha",
        load: async () => (await import("@catppuccin/codemirror")).catppuccinMocha
    },
    {
        id: "cobalt2",
        name: "Cobalt2",
        load: async () => (await import("@fsegurai/codemirror-theme-cobalt2")).cobalt2
    },
    {
        id: "forest",
        name: "Forest",
        load: async () => (await import("@fsegurai/codemirror-theme-forest")).forest
    },
    {
        id: "github-dark",
        name: "GitHub Dark",
        load: async () => (await import("@fsegurai/codemirror-theme-github-dark")).githubDark
    },
    {
        id: "github-light",
        name: "GitHub Light",
        load: async () => (await import("@fsegurai/codemirror-theme-github-light")).githubLight
    },
    {
        id: "gruvbox-dark",
        name: "Gruvbox Dark",
        load: async () => (await import("@fsegurai/codemirror-theme-gruvbox-dark")).gruvboxDark
    },
    {
        id: "gruvbox-light",
        name: "Gruvbox Light",
        load: async () => (await import("@fsegurai/codemirror-theme-gruvbox-light")).gruvboxLight
    },
    {
        id: "material-mark",
        name: "Material Dark",
        load: async () => (await import("@fsegurai/codemirror-theme-material-dark")).materialDark
    },
    {
        id: "material-light",
        name: "Material Light",
        load: async () => (await import("@fsegurai/codemirror-theme-material-light")).materialLight
    },
    {
        id: "monokai",
        name: "Monokai",
        load: async () => (await import("@fsegurai/codemirror-theme-monokai")).monokai
    },
    {
        id: "nord",
        name: "Nord",
        load: async () => (await import("@fsegurai/codemirror-theme-nord")).nord
    },
    {
        id: "palenight",
        name: "Palenight",
        load: async () => (await import("@fsegurai/codemirror-theme-palenight")).palenight
    },
    {
        id: "solarized-dark",
        name: "Solarized Dark",
        load: async () => (await import("@fsegurai/codemirror-theme-solarized-dark")).solarizedDark
    },
    {
        id: "solarized-light",
        name: "Solarized Light",
        load: async () => (await import("@fsegurai/codemirror-theme-solarized-light")).solarizedLight
    },
    {
        id: "tokyo-night-day",
        name: "Tokyo Night Day",
        load: async () => (await import("@fsegurai/codemirror-theme-tokyo-night-day")).tokyoNightDay
    },
    {
        id: "tokyo-night-storm",
        name: "Tokyo Night Storm",
        load: async () => (await import("@fsegurai/codemirror-theme-tokyo-night-storm")).tokyoNightStorm
    },
    {
        id: "volcano",
        name: "Volcano",
        load: async () => (await import("@fsegurai/codemirror-theme-volcano")).volcano
    },
    {
        id: "vs-code-dark",
        name: "VS Code Dark",
        load: async () => (await import("@fsegurai/codemirror-theme-vscode-dark")).vsCodeDark
    },
    {
        id: "vs-code-light",
        name: "VS Code Light",
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
