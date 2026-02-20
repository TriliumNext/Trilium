export type MapLayer = ({
    type: "vector";
    style: string | (() => Promise<{}>)
} | {
    type: "raster";
    url: string;
    attribution: string;
}) & {
    // Common properties
    name: string;
    isDarkTheme?: boolean;
};

export const MAP_LAYERS: Record<string, MapLayer> = {
    "openstreetmap": {
        name: "OpenStreetMap",
        type: "raster",
        url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    },
    "versatiles-colorful": {
        name: "VersaTiles Colorful",
        type: "vector",
        style: async () => (await import("./styles/colorful/en.json")).default
    },
    "versatiles-eclipse": {
        name: "VersaTiles Eclipse",
        type: "vector",
        style: async () => (await import("./styles/eclipse/en.json")).default,
        isDarkTheme: true
    },
    "versatiles-graybeard": {
        name: "VersaTiles Graybeard",
        type: "vector",
        style: async () => (await import("./styles/graybeard/en.json")).default
    },
    "versatiles-neutrino": {
        name: "VersaTiles Neutrino",
        type: "vector",
        style: async () => (await import("./styles/neutrino/en.json")).default
    },
    "versatiles-shadow": {
        name: "VersaTiles Shadow",
        type: "vector",
        style: async () => (await import("./styles/shadow/en.json")).default,
        isDarkTheme: true
    }
};

export const DEFAULT_MAP_LAYER_NAME: keyof typeof MAP_LAYERS = "versatiles-colorful";
