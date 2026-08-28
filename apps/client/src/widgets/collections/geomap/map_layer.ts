export type MapLayer = ({
    type: "vector";
    /**
     * Where the style is fetched from, for MapLibre to fetch itself.
     *
     * Named by URL rather than bundled: a style is an index of remote assets — it carries the tile,
     * glyph and sprite URLs but none of their content — so a copy held here still needs the server
     * that a URL would have been answered by, and only pins itself to the asset paths that server
     * had on the day it was taken.
     */
    style: string;
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
        style: versatilesStyle("colorful")
    },
    "versatiles-eclipse": {
        name: "VersaTiles Eclipse",
        type: "vector",
        style: versatilesStyle("eclipse"),
        isDarkTheme: true
    },
    "versatiles-graybeard": {
        name: "VersaTiles Graybeard",
        type: "vector",
        style: versatilesStyle("graybeard")
    },
    "versatiles-neutrino": {
        name: "VersaTiles Neutrino",
        type: "vector",
        style: versatilesStyle("neutrino")
    },
    "versatiles-shadow": {
        name: "VersaTiles Shadow",
        type: "vector",
        style: versatilesStyle("shadow"),
        isDarkTheme: true
    }
};

export const DEFAULT_MAP_LAYER_NAME: keyof typeof MAP_LAYERS = "versatiles-colorful";

/**
 * One of the styles VersaTiles publishes, labelled in English.
 *
 * `en.json` is the variant that labels every place in English where it has an English name; the
 * `style.json` beside it labels each in the language of the country it is drawn in.
 */
function versatilesStyle(name: string) {
    return `https://tiles.versatiles.org/assets/styles/${name}/en.json`;
}
