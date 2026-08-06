import { type StyleSpecification } from "maplibre-gl";

export type MapLayer = ({
    type: "vector";
    style: string | (() => Promise<StyleSpecification>);
    styleFallback: StyleSpecification;
} | {
    type: "raster";
    url: string;
    attribution: string;
    /** The deepest zoom the server draws tiles for, past which the last one is stretched instead. */
    maxZoom?: number;
}) & {
    // Common properties
    name: string;
    isDarkTheme?: boolean;
};

// Minimal empty style used as a placeholder while the real style loads asynchronously.
const EMPTY_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [] };

/**
 * Where a raster server is assumed to stop when it has not said, which is where most of them do.
 * Guessing is better than not: MapLibre's own default of 22 has the map ask for levels almost no
 * server draws, and a tile that 404s leaves a hole where stretching the level above would not.
 */
export const DEFAULT_RASTER_MAX_ZOOM = 19;

export const MAP_LAYERS: Record<string, MapLayer> = {
    "openstreetmap": {
        name: "OpenStreetMap",
        type: "raster",
        url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        // Where their standard layer stops: z20 is answered 400, not drawn.
        maxZoom: 19
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
