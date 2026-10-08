/**
 * What a map's coordinates are: places on the Earth, or positions on an image.
 *
 * MapLibre knows only longitude and latitude, so everything on the map is held in `[lng, lat]`
 * whichever it is. A {@link MapSpace} converts at the edge, where a position is read off a note's
 * label or written back onto one: a geo map stores `#geolocation` and `#geoShape` in degrees, an
 * image map `#imagePosition` and `#imageShape` in a coordinate system the map names for its image
 * (see {@link imageSpace}).
 */

import { GEO_LOCATION_ATTRIBUTE, GEO_SHAPE_ATTRIBUTE, IMAGE_POSITION_ATTRIBUTE, IMAGE_SHAPE_ATTRIBUTE } from "@triliumnext/commons";
import { MercatorCoordinate } from "maplibre-gl";
import { createContext } from "preact";

import { GPX_MIME } from "../../../services/gpx";

import type { Bounds } from "./coordinates";
import { CIRCLE_SEGMENTS, type GeoShape, parseGeoShape, readShape, serializeGeoShape, shapeRing, writeShape } from "./shapes";

export interface MapSpace {
    kind: "geo" | "image";
    /** The label a marker note stores its position in. */
    locationAttribute: string;
    /** The label a shape note stores its geometry in. */
    shapeAttribute: string;
    /** A position label's value as `[lng, lat]`, or `null` where it names none. */
    parseLocation(value: string | null | undefined): [number, number] | null;
    /** A `[lng, lat]` position as its label value. */
    serializeLocation(point: [number, number]): string;
    /** A `[lng, lat]` position as it is shown, or with `full` as it is copied. */
    formatLocation(point: [number, number], full?: boolean): string;
    /** A shape label's value in `[lng, lat]`, or `null` where it spells none. */
    parseShape(value: string | null | undefined): GeoShape | null;
    /** A shape in `[lng, lat]` as its label value. */
    serializeShape(shape: GeoShape): string;
}

/** Note-like enough to read a label from, which is all the helpers below need. */
interface LabelSource {
    getLabelValue(name: string): string | null;
}

export const geoSpace: MapSpace = {
    kind: "geo",
    locationAttribute: GEO_LOCATION_ATTRIBUTE,
    shapeAttribute: GEO_SHAPE_ATTRIBUTE,
    parseLocation,
    serializeLocation: ([ lng, lat ]) => [ lat, lng ].join(","),
    formatLocation: (point, full) => formatLocation(point, full ? FULL_PRECISION : undefined),
    parseShape: (value) => value ? parseGeoShape(value) : null,
    serializeShape: serializeGeoShape
};

/** The space a map is drawn in, handed down by the view so every layer reads the same one. */
export const MapSpaceContext = createContext<MapSpace>(geoSpace);

/** Where the note stands on a map in this space, as `[lng, lat]`, or `null` for nowhere. */
export function locationOf(note: LabelSource, space: MapSpace) {
    return space.parseLocation(note.getLabelValue(space.locationAttribute));
}

/** The shape the note draws on a map in this space, or `null` for none. */
export function shapeOf(note: LabelSource, space: MapSpace) {
    return space.parseShape(note.getLabelValue(space.shapeAttribute));
}

/**
 * Whether the note is drawn on the map as a shape, which is what a readable geometry label means.
 * Asked wherever a shape is offered something different from a marker, such as having no pin to
 * move (see DetailPane and ContextMenus).
 */
export function isShapeNote(note: LabelSource, space: MapSpace): boolean {
    return !!shapeOf(note, space);
}

/**
 * Whether the note is drawn as a GPX track, which only a geo map does. On an image map a GPX note is
 * a marker like any other, placed and removed through its position label.
 */
export function isTrackNote(note: { mime: string }, space: MapSpace): boolean {
    return space.kind === "geo" && note.mime === GPX_MIME;
}

/** `lat,lng` as the label stores it, as the `[lng, lat]` GeoJSON wants, or `null` if unreadable. */
export function parseLocation(location: string | null | undefined): [number, number] | null {
    if (!location) return null;

    const [ lat, lng ] = location.split(",", 2).map((part) => parseFloat(part));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return [ lng, lat ];
}

/**
 * A place as it is written and as the label stores it — latitude first — from the `[lng, lat]`
 * {@link parseLocation} yields and MapLibre reports.
 *
 * Six decimals name a spot to within a stride, which is as fine as anything is pointed out on a map.
 * The full stored value is worth having when it is being carried somewhere else, so what is copied
 * asks for every digit rather than what was read.
 */
export function formatLocation([ lng, lat ]: [number, number], precision = 6) {
    return `${lat.toFixed(precision)}, ${lng.toFixed(precision)}`;
}

/** Enough decimals to give back whatever a geo label holds, the map writing a float's worth. */
const FULL_PRECISION = 15;

/** The natural size of the image an image map is drawn over. */
export interface ImageSize {
    width: number;
    height: number;
}

/**
 * The coordinates an image map's own system gives the image's top-left and bottom-right corners,
 * as `#map:imageBounds` names them. Either axis can run either way: a top-left `y` larger than the
 * bottom-right one is a world whose `y` grows upwards.
 */
export interface ImageExtent {
    topLeft: [number, number];
    bottomRight: [number, number];
}

/**
 * Where the image stands in MapLibre's world: its top-left corner, and how much of the world its
 * longer side spans, both in Mercator units (the world being 0–1 each way).
 *
 * Half the world, in the middle, leaves a quarter of it on every side for the camera's bounds (see
 * {@link ImageSpace.maxBounds}), and keeps the image clear of the ±180° seam, which `boundsOf` and
 * MapLibre's own bounds both treat specially.
 */
const IMAGE_ORIGIN = 0.25;
const IMAGE_EXTENT = 0.5;

/** How far past the image the camera can be taken, as a share of the image's longer side. */
const IMAGE_MARGIN = 0.25;

/** How many zoom levels past the image's own resolution the camera can go. */
const IMAGE_OVERZOOM = 2;

/** How finely a stored coordinate resolves the image, in parts of a pixel: a hundredth of a pixel
 *  is finer than any click lands. */
const STORED_PARTS_OF_PIXEL = 100;

export interface ImageSpace extends MapSpace {
    kind: "image";
    /** The image's corners as an image source wants them: top-left, top-right, bottom-right,
     *  bottom-left. */
    corners: [[number, number], [number, number], [number, number], [number, number]];
    /** The box the image fills, for the camera to be fitted to. */
    bounds: Bounds;
    /** The box the camera is kept inside: the image and a margin around it. */
    maxBounds: Bounds;
    /** The deepest zoom worth having: a few levels past the one that draws a pixel per pixel. */
    maxZoom: number;
}

/**
 * The space of a map drawn over an image of the given size, which stores positions in a coordinate
 * system of the map's own choosing: `extent` names the coordinates of the image's corners, and every
 * position is stored in those, so coordinates taken from a game or a survey are used unchanged.
 * Without an extent the corners are `0,0` and the image's size, which stores pixels measured from
 * the top-left corner, `x` to the right and `y` downwards.
 *
 * Positions belong to the coordinate system rather than to the image, so a replacement image keeps
 * every marker in place once its corners are named for the ground it covers.
 *
 * The image is laid onto MapLibre's world in Mercator units rather than degrees. Mercator units are
 * what MapLibre draws in, so a pixel maps to them linearly and the image is drawn without the
 * stretching that latitude would put on it. MapTiler's image viewer places its images the same way.
 */
export function imageSpace({ width, height }: ImageSize, extent?: ImageExtent | null): ImageSpace {
    const { topLeft: [ left, top ], bottomRight: [ right, bottom ] } = extent ?? {
        topLeft: [ 0, 0 ],
        bottomRight: [ width, height ]
    };
    const longerSide = Math.max(width, height);
    const mercatorPerPixel = IMAGE_EXTENT / longerSide;
    // Signed: a negative step is an axis running the other way from the image's pixels.
    const unitsPerPixelX = (right - left) / width;
    const unitsPerPixelY = (bottom - top) / height;
    // Stored to a hundredth of a pixel on the finer axis, shown to a whole one.
    const finestUnit = Math.min(Math.abs(unitsPerPixelX), Math.abs(unitsPerPixelY));
    const storedDecimals = decimalsFor(finestUnit / STORED_PARTS_OF_PIXEL);
    const shownDecimals = decimalsFor(finestUnit);

    function pixelToLngLat([ px, py ]: [number, number]): [number, number] {
        const { lng, lat } = new MercatorCoordinate(
            IMAGE_ORIGIN + px * mercatorPerPixel,
            IMAGE_ORIGIN + py * mercatorPerPixel
        ).toLngLat();
        return [ lng, lat ];
    }

    function toLngLat([ x, y ]: [number, number]): [number, number] {
        return pixelToLngLat([ (x - left) / unitsPerPixelX, (y - top) / unitsPerPixelY ]);
    }

    /** A `[lng, lat]` position in the map's coordinates, unrounded. */
    function toWorld([ lng, lat ]: [number, number]): [number, number] {
        const { x, y } = MercatorCoordinate.fromLngLat({ lng, lat });
        return [
            left + ((x - IMAGE_ORIGIN) / mercatorPerPixel) * unitsPerPixelX,
            top + ((y - IMAGE_ORIGIN) / mercatorPerPixel) * unitsPerPixelY
        ];
    }

    const round = (value: number) => roundTo(value, storedDecimals);
    const toStored = (point: [number, number]) => toWorld(point).map(round) as [number, number];

    const margin = longerSide * IMAGE_MARGIN;
    const [ west, north ] = pixelToLngLat([ -margin, -margin ]);
    const [ east, south ] = pixelToLngLat([ width + margin, height + margin ]);
    const topLeftLngLat = pixelToLngLat([ 0, 0 ]);
    const bottomRightLngLat = pixelToLngLat([ width, height ]);

    return {
        kind: "image",
        locationAttribute: IMAGE_POSITION_ATTRIBUTE,
        shapeAttribute: IMAGE_SHAPE_ATTRIBUTE,
        corners: [ topLeftLngLat, pixelToLngLat([ width, 0 ]), bottomRightLngLat, pixelToLngLat([ 0, height ]) ],
        bounds: [ [ topLeftLngLat[0], bottomRightLngLat[1] ], [ bottomRightLngLat[0], topLeftLngLat[1] ] ],
        maxBounds: [ [ west, south ], [ east, north ] ],
        // MapLibre's world is 512 pixels across at zoom 0, and doubles with each level.
        maxZoom: Math.log2(longerSide / (IMAGE_EXTENT * 512)) + IMAGE_OVERZOOM,

        parseLocation(value) {
            const point = parsePair(value);
            return point && toLngLat(point);
        },
        serializeLocation: (point) => toStored(point).join(","),
        formatLocation(point, full) {
            const [ x, y ] = toWorld(point);
            const decimals = full ? storedDecimals : shownDecimals;
            return `${roundTo(x, decimals)}, ${roundTo(y, decimals)}`;
        },

        parseShape(value) {
            const written = value ? readShape(value) : null;
            if (!written) return null;

            if (written.type === "circle") {
                const [ centerWorld ] = written.points;
                const center = toLngLat(centerWorld);
                const ring = worldCircle(centerWorld, written.radius).map(toLngLat);
                const centerMercator = MercatorCoordinate.fromLngLat({ lng: center[0], lat: center[1] });
                return {
                    type: "circle",
                    center,
                    // The ring's mean reach, in meters at the centre. The ring is an ellipse on
                    // the image where the two axes' units differ.
                    radiusMeters: meanDistance(ring.map(toMercator), [ centerMercator.x, centerMercator.y ])
                        / centerMercator.meterInMercatorCoordinateUnits(),
                    ring
                };
            }

            return { type: written.type, coordinates: written.points.map(toLngLat) };
        },

        serializeShape(shape) {
            if (shape.type === "circle") {
                // Read back off the ring rather than the radius in meters, so a circle keeps the
                // size it was drawn at wherever on the image it stands, measured in the map's units.
                const ring = shapeRing(shape).map(toWorld);
                const center = meanPoint(ring);
                return writeShape({
                    type: "circle",
                    points: [ center.map(round) as [number, number] ],
                    radius: round(meanDistance(ring, center))
                });
            }

            return writeShape({ type: shape.type, points: shape.coordinates.map(toStored) });
        }
    };
}

/**
 * The corners a `#map:imageBounds` value names, as `x,y x,y` for the top-left and the bottom-right
 * corner, or `null` where it names none. Corners sharing an `x` or a `y` span nothing and name none.
 */
export function parseImageExtent(value: string | null | undefined): ImageExtent | null {
    const parts = value?.trim().split(/\s+/);
    if (parts?.length !== 2) return null;

    const topLeft = parsePair(parts[0]);
    const bottomRight = parsePair(parts[1]);
    if (!topLeft || !bottomRight || topLeft[0] === bottomRight[0] || topLeft[1] === bottomRight[1]) {
        return null;
    }

    return { topLeft, bottomRight };
}

/** `x,y` as an image label stores it, or `null` if unreadable. */
function parsePair(value: string | null | undefined): [number, number] | null {
    if (!value) return null;

    const [ x, y ] = value.split(",", 2).map((part) => parseFloat(part));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    return [ x, y ];
}

/** The decimals that resolve a step of `unit`, none for a step of one or more. */
function decimalsFor(unit: number) {
    return Math.max(0, Math.ceil(-Math.log10(unit)));
}

function roundTo(value: number, decimals: number) {
    return Number(value.toFixed(decimals));
}

/** A circle in the map's coordinates as a ring, without the closing repeat. */
function worldCircle([ x, y ]: [number, number], radius: number): [number, number][] {
    const ring: [number, number][] = [];
    for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
        const angle = (2 * Math.PI * i) / CIRCLE_SEGMENTS;
        ring.push([ x + radius * Math.cos(angle), y + radius * Math.sin(angle) ]);
    }
    return ring;
}

function toMercator([ lng, lat ]: [number, number]): [number, number] {
    const { x, y } = MercatorCoordinate.fromLngLat({ lng, lat });
    return [ x, y ];
}

function meanDistance(points: [number, number][], [ cx, cy ]: [number, number]) {
    return points.reduce((sum, [ x, y ]) => sum + Math.hypot(x - cx, y - cy), 0) / points.length;
}

function meanPoint(points: [number, number][]): [number, number] {
    let x = 0;
    let y = 0;
    for (const point of points) {
        x += point[0];
        y += point[1];
    }
    return [ x / points.length, y / points.length ];
}
