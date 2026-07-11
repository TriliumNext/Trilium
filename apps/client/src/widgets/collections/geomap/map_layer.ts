import { type StyleSpecification } from "maplibre-gl";

export type MapLayer = ({
    type: "vector";
    style: string | (() => Promise<StyleSpecification>);
    styleFallback: StyleSpecification;
} | {
    type: "raster";
    url: string;
    attribution: string;
}) & {
    // Common properties
    name: string;
    isDarkTheme?: boolean;
};

// Minimal empty style used as a placeholder while the real style loads asynchronously.
const EMPTY_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [] };

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
        style: async () => (await import("./styles/colorful/en.json")).default as unknown as StyleSpecification,
        styleFallback: EMPTY_STYLE
    },
    "versatiles-eclipse": {
        name: "VersaTiles Eclipse",
        type: "vector",
        style: async () => (await import("./styles/eclipse/en.json")).default as unknown as StyleSpecification,
        styleFallback: EMPTY_STYLE,
        isDarkTheme: true
    },
    "versatiles-graybeard": {
        name: "VersaTiles Graybeard",
        type: "vector",
        style: async () => (await import("./styles/graybeard/en.json")).default as unknown as StyleSpecification,
        styleFallback: EMPTY_STYLE,
    },
    "versatiles-neutrino": {
        name: "VersaTiles Neutrino",
        type: "vector",
        style: async () => (await import("./styles/neutrino/en.json")).default as unknown as StyleSpecification,
        styleFallback: EMPTY_STYLE,
    },
    "versatiles-shadow": {
        name: "VersaTiles Shadow",
        type: "vector",
        style: async () => (await import("./styles/shadow/en.json")).default as unknown as StyleSpecification,
        styleFallback: EMPTY_STYLE,
        isDarkTheme: true
    }
};

export const DEFAULT_MAP_LAYER_NAME: keyof typeof MAP_LAYERS = "versatiles-colorful";
