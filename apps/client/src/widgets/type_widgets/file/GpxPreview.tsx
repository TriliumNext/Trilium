import "./GpxPreview.css";

import { useEffect, useMemo, useState } from "preact/hooks";

import type FBlob from "../../../entities/fblob";
import type FNote from "../../../entities/fnote";
import { GpxElevationSample, GpxJourney, GpxStats, parseGpxStats } from "../../../services/gpx";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import { formatDateTime, getMeasurementSystem } from "../../../utils/formatters";
import Alert from "../../react/Alert";
import Collapsible from "../../react/Collapsible";

type MeasurementSystem = ReturnType<typeof getMeasurementSystem>;

interface GpxPreviewProps {
    note: FNote;
    /** The note's blob, fetched by the file widget. Not read for its content — a GPX blob arrives
     *  contentless, the XML is fetched raw below — but watched, so an edited file re-reads. */
    blob: FBlob | null | undefined;
}

/**
 * Main-view preview for GPX files: what the track amounts to — distance, climb, time, and the
 * pieces it is made of — with an elevation profile under it when the points carry elevation. The
 * numbers stand where "no preview available" used to; the track itself is drawn by the geo map
 * (see the geomap collection), not here.
 */
export default function GpxPreview({ note, blob }: GpxPreviewProps) {
    const [ stats, setStats ] = useState<GpxStats | null>();

    useEffect(() => {
        if (!blob) return;
        let cancelled = false;

        // Fetched raw rather than read off the blob: the server returns no inline content for a
        // GPX blob — the same road the geo map takes to draw the track.
        server.get<string | Uint8Array>(`notes/${note.noteId}/open`, undefined, true).then((response) => {
            if (cancelled) return;
            const xml = response instanceof Uint8Array ? new TextDecoder().decode(response) : response;
            setStats(parseGpxStats(xml));
        });

        return () => {
            cancelled = true;
        };
    }, [ note.noteId, blob ]);

    if (stats === undefined) {
        return null;
    }
    if (!stats || (stats.pointCount === 0 && stats.waypoints.length === 0)) {
        // A file that is not readable GPX gets the notice any other unpreviewable file gets.
        return (
            <Alert className="file-preview-not-available" type="info">
                {t("file.file_preview_not_available")}
            </Alert>
        );
    }

    const system = getMeasurementSystem();
    const tiles = buildTiles(stats, system);
    const trackColor = note.getLabelValue("color");

    // The file's internal name is metadata, not a second title — the note's own title already
    // heads the window — so it and the description share one quiet byline above the tiles.
    const bylineName = stats.name !== note.title ? stats.name : undefined;

    return (
        <div className="gpx-preview selectable-text">
            {(bylineName || stats.description) && (
                <div className="gpx-preview-byline">
                    {bylineName && <span className="gpx-preview-name">{bylineName}</span>}
                    {stats.description && <span className="gpx-preview-description">{stats.description}</span>}
                </div>
            )}

            <div className="gpx-preview-stats">
                {tiles.map(({ label, value }) => (
                    <div key={label} className="gpx-stat">
                        <div className="gpx-stat-value">{value}</div>
                        <div className="gpx-stat-label">{label}</div>
                    </div>
                ))}
            </div>

            {stats.elevation && stats.elevation.profile.length > 1 && stats.distance > 0 && (
                <ElevationProfile
                    elevation={stats.elevation}
                    totalDistance={stats.distance}
                    system={system}
                    trackColor={trackColor}
                />
            )}

            {/* Only when there is more than one journey to tell apart — a single-track file is
                already summed up by the stats above. Expanded, unlike the waypoints: a file
                rarely holds more than a handful. */}
            {stats.journeys.length > 1 && (
                <Collapsible
                    className="gpx-journeys"
                    title={journeysTitle(stats.journeys)}
                    initiallyExpanded
                >
                    <ul className="gpx-journey-list">
                        {stats.journeys.map((journey, index) => (
                            <li key={index}>
                                <span className={journey.kind === "route" ? "bx bx-directions" : "bx bx-trip"} aria-hidden="true" />
                                <span className="gpx-journey-name">{journey.name ?? t("gpx_preview.unnamed")}</span>
                                {journey.distance > 0 && (
                                    <span className="gpx-journey-distance">{formatDistance(journey.distance, system)}</span>
                                )}
                            </li>
                        ))}
                    </ul>
                </Collapsible>
            )}

            {/* Collapsed by default: a file can carry dozens (the GPX spec's sample has 86), and
                the numbers above should not have to be scrolled back to over a directory. */}
            {stats.waypoints.length > 0 && (
                <Collapsible
                    className="gpx-waypoints"
                    title={t("gpx_preview.waypoints_with_count", { count: stats.waypoints.length })}
                >
                    <ul className="gpx-waypoint-list">
                        {stats.waypoints.map((waypoint, index) => (
                            <li key={index}>
                                <span className="bx bx-pin" aria-hidden="true" />
                                <span className="gpx-waypoint-name">{waypoint.name ?? t("gpx_preview.unnamed")}</span>
                                {waypoint.description && <span className="gpx-waypoint-description">{waypoint.description}</span>}
                                {waypoint.elevation !== undefined && (
                                    <span className="gpx-waypoint-elevation">{formatElevation(waypoint.elevation, system)}</span>
                                )}
                            </li>
                        ))}
                    </ul>
                </Collapsible>
            )}

            {/* Where the track itself can be seen — hidden when this preview already sits in a geo
                map's own pane (see the note in GpxPreview.css), where the track is right there. */}
            <div className="gpx-preview-map-hint">
                <span className="bx bx-map-alt" aria-hidden="true" />
                {t("gpx_preview.map_hint")}
            </div>
        </div>
    );
}

/** The tiles worth showing for this particular file: a value that would read "0" or restate an
 *  obvious default (one track, no routes) says nothing, so it is left out. */
function buildTiles(stats: GpxStats, system: MeasurementSystem) {
    const tiles: { label: string; value: string }[] = [];

    if (stats.distance > 0) {
        tiles.push({ label: t("gpx_preview.distance"), value: formatDistance(stats.distance, system) });
    }
    if (stats.time && stats.time.duration > 0) {
        tiles.push({ label: t("gpx_preview.duration"), value: formatTravelDuration(stats.time.duration) });
        if (stats.distance > 0) {
            const kmh = (stats.distance / 1000) / (stats.time.duration / 3_600_000);
            tiles.push({ label: t("gpx_preview.avg_speed"), value: formatSpeed(kmh, system) });
        }
    }
    if (stats.time) {
        // The date alone: the day a track was ridden is the fact worth a glance, and the start
        // time is implied well enough by the duration beside it.
        tiles.push({ label: t("gpx_preview.recorded_on"), value: formatDateTime(stats.time.start, "medium", "none") });
    }
    if (stats.elevation) {
        tiles.push(
            { label: t("gpx_preview.elevation_gain"), value: formatElevation(stats.elevation.gain, system) },
            { label: t("gpx_preview.elevation_loss"), value: formatElevation(stats.elevation.loss, system) },
            { label: t("gpx_preview.max_elevation"), value: formatElevation(stats.elevation.max, system) }
        );
    }
    if (stats.pointCount > 0) {
        tiles.push({ label: t("gpx_preview.points"), value: stats.pointCount.toLocaleString() });
    }
    if (stats.segmentCount > 0) {
        tiles.push({ label: t("gpx_preview.segments"), value: stats.segmentCount.toLocaleString() });
    }
    if (stats.trackCount > 1) {
        tiles.push({ label: t("gpx_preview.tracks"), value: stats.trackCount.toLocaleString() });
    }
    if (stats.routeCount > 0) {
        tiles.push({ label: t("gpx_preview.routes"), value: stats.routeCount.toLocaleString() });
    }
    if (stats.waypoints.length > 0) {
        tiles.push({ label: t("gpx_preview.waypoints"), value: stats.waypoints.length.toLocaleString() });
    }

    return tiles;
}

/** What the journey listing is headed with — named by what the file actually holds, since a file
 *  of routes headed "Tracks" would contradict the very rows under it. */
function journeysTitle(journeys: GpxJourney[]): string {
    if (journeys.every((journey) => journey.kind === "track")) {
        return t("gpx_preview.tracks_with_count", { count: journeys.length });
    }
    if (journeys.every((journey) => journey.kind === "route")) {
        return t("gpx_preview.routes_with_count", { count: journeys.length });
    }
    return t("gpx_preview.journeys_with_count", { count: journeys.length });
}

/** The drawing space the profile is projected into. Stretched to the container by the SVG itself
 *  (`preserveAspectRatio="none"`); strokes carry `non-scaling-stroke` so only the shape stretches. */
const CHART_WIDTH = 1000;
const CHART_HEIGHT = 150;
/** Air above the highest point, so the line's crest is not cut by the chart's edge. */
const CHART_TOP_PAD = 10;

function ElevationProfile({ elevation, totalDistance, system, trackColor }: {
    elevation: NonNullable<GpxStats["elevation"]>;
    totalDistance: number;
    system: MeasurementSystem;
    /** The note's own colour — the same one its track wears on the map — or null for the theme's. */
    trackColor: string | null;
}) {
    const [ hover, setHover ] = useState<GpxElevationSample | null>(null);
    const { min, max, profile } = elevation;

    // A flat track still gets a visible line rather than a division by zero.
    const span = Math.max(max - min, 1);
    const x = (distance: number) => (distance / totalDistance) * CHART_WIDTH;
    const y = (sampleElevation: number) => CHART_TOP_PAD + (1 - (sampleElevation - min) / span) * (CHART_HEIGHT - CHART_TOP_PAD);

    const linePath = useMemo(
        () => profile.map((sample, i) => `${i === 0 ? "M" : "L"}${x(sample.distance).toFixed(1)} ${y(sample.elevation).toFixed(1)}`).join(" "),
        [ profile, totalDistance, min, max ]
    );
    const areaPath = `${linePath} L${x(profile[profile.length - 1].distance).toFixed(1)} ${CHART_HEIGHT} L${x(profile[0].distance).toFixed(1)} ${CHART_HEIGHT} Z`;

    function onPointerMove(event: PointerEvent) {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        if (rect.width === 0) return;
        const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        setHover(nearestSample(profile, fraction * totalDistance));
    }

    return (
        <div className="gpx-profile">
            <div className="gpx-profile-heading">{t("gpx_preview.elevation_profile")}</div>
            <div
                className="gpx-profile-plot"
                style={trackColor ? { color: trackColor } : undefined}
                onPointerMove={onPointerMove}
                onPointerLeave={() => setHover(null)}
            >
                <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none">
                    <line className="gpx-profile-gridline" x1={0} y1={y(max)} x2={CHART_WIDTH} y2={y(max)} vector-effect="non-scaling-stroke" />
                    <line className="gpx-profile-gridline" x1={0} y1={y((min + max) / 2)} x2={CHART_WIDTH} y2={y((min + max) / 2)} vector-effect="non-scaling-stroke" />
                    <path className="gpx-profile-area" d={areaPath} />
                    <path className="gpx-profile-line" d={linePath} vector-effect="non-scaling-stroke" />
                    {hover && (
                        <line
                            className="gpx-profile-crosshair"
                            x1={x(hover.distance)} y1={0}
                            x2={x(hover.distance)} y2={CHART_HEIGHT}
                            vector-effect="non-scaling-stroke"
                        />
                    )}
                </svg>
                <span className="gpx-profile-max">{formatElevation(max, system)}</span>
                <span className="gpx-profile-min">{formatElevation(min, system)}</span>
                {hover && (
                    <div className="gpx-profile-tooltip" style={{ left: `${(hover.distance / totalDistance) * 100}%` }}>
                        {formatDistance(hover.distance, system)} · {formatElevation(hover.elevation, system)}
                    </div>
                )}
            </div>
            <div className="gpx-profile-axis">
                <span>0</span>
                <span>{formatDistance(totalDistance, system)}</span>
            </div>
        </div>
    );
}

/** The profile point nearest to the given distance along the track, found by bisection — the
 *  profile is ordered by distance, and the pointer asks on every move. */
function nearestSample(profile: GpxElevationSample[], distance: number): GpxElevationSample {
    let lo = 0;
    let hi = profile.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (profile[mid].distance < distance) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    return distance - profile[lo].distance <= profile[hi].distance - distance ? profile[lo] : profile[hi];
}

const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.28084;

function formatDistance(meters: number, system: MeasurementSystem): string {
    if (system === "imperial") {
        return t("gpx_preview.unit_mi", { value: round(meters / METERS_PER_MILE) });
    }
    if (meters < 1000) {
        return t("gpx_preview.unit_m", { value: Math.round(meters).toLocaleString() });
    }
    return t("gpx_preview.unit_km", { value: round(meters / 1000) });
}

function formatElevation(meters: number, system: MeasurementSystem): string {
    if (system === "imperial") {
        return t("gpx_preview.unit_ft", { value: Math.round(meters * FEET_PER_METER).toLocaleString() });
    }
    return t("gpx_preview.unit_m", { value: Math.round(meters).toLocaleString() });
}

function formatSpeed(kmh: number, system: MeasurementSystem): string {
    if (system === "imperial") {
        return t("gpx_preview.unit_mph", { value: round(kmh * 1000 / METERS_PER_MILE) });
    }
    return t("gpx_preview.unit_kmh", { value: round(kmh) });
}

function formatTravelDuration(milliseconds: number): string {
    const totalMinutes = Math.round(milliseconds / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) {
        return t("gpx_preview.duration_minutes", { minutes });
    }
    return t("gpx_preview.duration_hours_minutes", { hours, minutes });
}

/** A magnitude-appropriate rounding: two decimals close up, none once they would say nothing. */
function round(value: number): string {
    const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}
