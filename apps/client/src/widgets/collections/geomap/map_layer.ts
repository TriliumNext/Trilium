export interface MapLayer {
    name: string;
    isDarkTheme?: boolean;
}

interface VectorLayer extends MapLayer {
    type: "vector";
    style: string | (() => Promise<{}>);
    styleFallback: {};
}

interface RasterLayer extends MapLayer {
    type: "raster";
    url: string;
    attribution: string;
}

// Minimal empty style used as a placeholder while the real style loads asynchronously.
const EMPTY_STYLE = { version: 8, sources: {}, layers: [] };

export const MAP_LAYERS: Record<string, VectorLayer | RasterLayer> = {
    "openstreetmap": {
        name: "OpenStreetMap",
        type: "raster",
        url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    },
    "versatiles-colorful": {
        name: "VersaTiles Colorful",
        type: "vector",
        style: async () => (await import("./styles/colorful/en.json")).default,
        styleFallback: EMPTY_STYLE
    },
    "versatiles-eclipse": {
        name: "VersaTiles Eclipse",
        type: "vector",
        style: async () => (await import("./styles/eclipse/en.json")).default,
        styleFallback: EMPTY_STYLE,
        isDarkTheme: true
    },
    "versatiles-graybeard": {
        name: "VersaTiles Graybeard",
        type: "vector",
        style: async () => (await import("./styles/graybeard/en.json")).default,
        styleFallback: EMPTY_STYLE
    },
    "versatiles-neutrino": {
        name: "VersaTiles Neutrino",
        type: "vector",
        style: async () => (await import("./styles/neutrino/en.json")).default,
        styleFallback: EMPTY_STYLE
    },
    "versatiles-shadow": {
        name: "VersaTiles Shadow",
        type: "vector",
        style: async () => (await import("./styles/shadow/en.json")).default,
        styleFallback: EMPTY_STYLE,
        isDarkTheme: true
    }
};

export const DEFAULT_MAP_LAYER_NAME: keyof typeof MAP_LAYERS = "versatiles-colorful";
