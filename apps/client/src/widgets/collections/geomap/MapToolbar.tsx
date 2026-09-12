import "./MapToolbar.css";

import clsx from "clsx";
import { GeolocateControl, type Map as MapLibreGLMap, type MapMouseEvent } from "maplibre-gl";
import { useCallback, useContext, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import toast from "../../../services/toast";
import { isMobile } from "../../../services/utils";
import { useFullscreen } from "../../react/hooks";
import OverlayControlGroup, { OverlayControlButton, OverlayFullscreenButton } from "../../react/OverlayControlGroup";
import { ParentMap, useMapPitch } from "./map";

/**
 * The controls standing in the corner of a geo map: how close in the map is drawn, and how much of
 * the screen it is given.
 *
 * MapLibre offers bars of its own for both (`NavigationControl`, which is what stood here, and
 * `FullscreenControl`), dressed in neither Trilium's buttons nor Trilium's colors — a white box with
 * hairline-separated squares in it, on a map that may well be dark. What they do is done here
 * instead, on the {@link OverlayControlGroup} the image viewer's zoom buttons stand on (see
 * {@link ImageViewer}). No readout between the steps, though: a map's zoom level is a number
 * out of the cartographer's toolbox, not the reader's, and a map has no fitted view a readout
 * could offer back the way an image has.
 *
 * In the foot corner, where every other set of zoom controls floating over content in the app
 * stands, rather than in the top corner MapLibre keeps its own zoom buttons in. The corner is the
 * map's to give: its attribution has been moved to the foot of the other side, beside the scale
 * (see map.tsx).
 *
 * At the group's leading end stands the tilt, after Google Maps's own button: 3D leans the view
 * over, 2D lays it flat again. Which of the two it offers is read off the view itself rather than
 * remembered from the last press — MapLibre tilts for Ctrl and a drag as well, and a button that
 * only watched itself would go on offering a 3D the reader is already in.
 *
 * The locate button sits between the zoom steps and the fullscreen button. It requests the device's
 * position, frames the map on it, and keeps following it until the map is dragged or the button is
 * pressed again. GeolocateControl does the work, with its own button hidden (see useGeolocate).
 *
 * On mobile the two steps stay home, as the image viewer's do: the fingers already zoom, and the
 * foot of a narrow map is spoken for. The tilt is kept — the two-finger drag that leans the view
 * is told to nobody, so the button is the one visible way into 3D — and so is the screen, which a
 * small one has the most to gain from.
 */

/** How far the button leans the view over — a lean rather than the horizon, as Google Maps takes
 *  it. Ctrl and a drag go further, all the way to MapLibre's own limit. */
const TILTED_PITCH = 45;

interface MapToolbarProps {
    /**
     * Called when the device's location dot is clicked, with the dot's position rather than the
     * click's own coordinates on it (see {@link useGeolocate}).
     */
    onLocationClick?: (location: LngLat) => void;
}

/** A position as the Geolocation API reports one and `#geolocation` stores it. */
interface LngLat {
    lat: number;
    lng: number;
}

export default function MapToolbar({ onLocationClick }: MapToolbarProps) {
    const map = useContext(ParentMap);
    // The zoom is only read for the steps' disabled state, so where the steps stay home the map is
    // not listened to for it either.
    const zoom = useMapZoom(isMobile() ? null : map);
    const pitch = useMapPitch(map);
    // The map itself rather than the whole view: what is around it is the note's own chrome, and
    // everything the bar above the map offers is on the map's right-click menu as well.
    const [ isFullscreen, toggleFullscreen ] = useFullscreen(map?.getContainer());
    const locate = useGeolocate(map, onLocationClick);

    if (!map) return null;

    // Whether the reader is in a 3D view however they got there — the button, or Ctrl and a drag.
    const isTilted = (pitch ?? map.getPitch()) > 0;
    // Before the first report, which follows the very next tick: what the map already says it is.
    const current = zoom ?? map.getZoom();

    return (
        <OverlayControlGroup className="geo-map-toolbar" placement="bottom-end" overCanvas>
            {/* Its face names the view it offers, not the one in force — Google Maps's way round. */}
            <OverlayControlButton
                title={isTilted ? t("geo-map.exit-3d") : t("geo-map.enter-3d")}
                text={isTilted ? "2D" : "3D"}
                className="geo-map-tilt-button"
                onClick={() => map.easeTo({ pitch: isTilted ? 0 : TILTED_PITCH })}
            />
            {!isMobile() && <>
                <OverlayControlButton
                    title={t("geo-map.zoom-out")}
                    icon="bx-minus-circle"
                    disabled={current <= map.getMinZoom()}
                    onClick={() => map.zoomOut()}
                />
                <OverlayControlButton
                    title={t("geo-map.zoom-in")}
                    icon="bx-plus-circle"
                    disabled={current >= map.getMaxZoom()}
                    onClick={() => map.zoomIn()}
                />
            </>}
            {locate && <OverlayControlButton
                title={locateTitle(locate)}
                icon="bx-current-location"
                className={clsx("geo-map-locate-button", locate.state === "waiting" && "locating")}
                // Held down while the camera is the device's: waiting for the first fix, or following.
                active={locate.state === "waiting" || locate.state === "following"}
                disabled={locate.state === "denied"}
                onClick={locate.toggle}
            />}
            {/* Nothing is measured across the change: the map keeps the middle of its view through
                a resize of its own accord, and it is told of the new size by the view itself (see
                `useElementSize` in map.tsx). */}
            <OverlayFullscreenButton isFullscreen={isFullscreen} onToggle={toggleFullscreen} />
        </OverlayControlGroup>
    );
}

/**
 * How close in the map is drawn, followed as it changes — by these buttons, by the wheel, or by the
 * view being restored. What it is read for is whether there is any room left to zoom, which is what
 * leaves a button that would do nothing disabled instead of idle: MapLibre clamps a step past
 * either end silently.
 *
 * `zoom` rather than `zoomend`, so that a button reaching the end of the range is disabled as the
 * map arrives there rather than a moment later — the two steps are animated.
 */
function useMapZoom(map: MapLibreGLMap | null) {
    const [ zoom, setZoom ] = useState<number | null>(null);

    useEffect(() => {
        if (!map) return;

        const report = () => setZoom(map.getZoom());
        // The map may have been moved between being built and being listened to.
        report();

        map.on("zoom", report);
        return () => { map.off("zoom", report); };
    }, [ map ]);

    return zoom;
}

/** What the locate button is doing, read off the control's events (see {@link useGeolocate}). */
type LocateState = "off" | "waiting" | "following" | "background" | "denied";

interface Locate {
    state: LocateState;
    /** Whether the last position update failed while the watch stays on. */
    hasError: boolean;
    /** Presses the control's own button: on, back to the position, or off, depending on the state. */
    toggle: () => void;
}

/** The Geolocation API's code for a permission the user or the browser refused. */
const PERMISSION_DENIED = 1;

/** GeolocateControl with its own button hidden; MapToolbar's OverlayControlButton drives it instead
 *  (see {@link useGeolocate}). */
class HiddenGeolocateControl extends GeolocateControl {
    onAdd(map: MapLibreGLMap) {
        const container = super.onAdd(map);
        container.hidden = true;
        return container;
    }
}

/**
 * Drives GeolocateControl from MapToolbar's own button instead of the control's hidden one.
 *
 * GeolocateControl's own behavior is unchanged: the first press starts a watch on the device's
 * position, frames the first fix to its accuracy and follows later fixes; dragging the map keeps the
 * dot and frees the camera; a press while following stops the watch and removes the dot; a press while
 * the camera is free re-centers on the dot. The dot and its accuracy circle are DOM markers, so they
 * need no handling across a style switch (see `keepAdditions` in map.tsx). Button state comes from the
 * control's events instead of its own DOM.
 *
 * `trackuserlocationend` fires both when the watch stops and when a drag frees the camera; only the
 * drag also fires `userlocationlostfocus`, synchronously right after. `setState` is called with "off"
 * and then corrected to "background" — Preact batches both calls into one render, so the button never
 * flashes off. A denied permission is terminal: the control clears its watch and disables its button,
 * and so does this hook.
 *
 * `onLocationClick` receives the last fix from the "geolocate" event, not the click's own coordinates
 * on the dot (see {@link isLocationDot}, which tells a click on the dot from one on the accuracy
 * circle marker).
 *
 * Returns `null` when the Geolocation API is unavailable or the origin is insecure, since browsers
 * refuse the call in both cases.
 */
function useGeolocate(map: MapLibreGLMap | null, onLocationClick?: (location: LngLat) => void): Locate | null {
    const available = canLocate();
    const control = useRef<GeolocateControl | null>(null);
    const [ state, setState ] = useState<LocateState>("off");
    const [ hasError, setHasError ] = useState(false);
    // Whether the reader has been told of the failure the watch is in; a watch reports the same
    // failure over and over, and one toast is enough for it.
    const toldOfError = useRef(false);
    // lastFix holds the position from the most recent "geolocate" event, read by onMapClick below.
    // onLocationClickRef holds the callback so a new function from the caller does not rebuild the
    // control.
    const lastFix = useRef<LngLat | null>(null);
    const onLocationClickRef = useRef(onLocationClick);
    onLocationClickRef.current = onLocationClick;

    useEffect(() => {
        if (!map || !available) return;

        const geolocate = new HiddenGeolocateControl({
            trackUserLocation: true,
            // GPS where the device has it, rather than the cell or Wi-Fi fix the default settles for.
            positionOptions: { enableHighAccuracy: true }
        });
        control.current = geolocate;
        map.addControl(geolocate);

        // trackuserlocationstart moves to "following" if the state was "background", else "waiting";
        // userlocationfocus also sets "following".
        geolocate.on("trackuserlocationstart", () => {
            setState((current) => current === "background" ? "following" : "waiting");
        });
        geolocate.on("userlocationfocus", () => setState("following"));
        geolocate.on("trackuserlocationend", () => {
            setState("off");
            setHasError(false);
            toldOfError.current = false;
        });
        geolocate.on("userlocationlostfocus", () => setState("background"));
        geolocate.on("geolocate", ({ coords }) => {
            lastFix.current = { lat: coords.latitude, lng: coords.longitude };
            setHasError(false);
            toldOfError.current = false;
            setState((current) => current === "waiting" ? "following" : current);
        });
        geolocate.on("error", ({ code }) => {
            if (code === PERMISSION_DENIED) {
                setState("denied");
                toast.showError(t("geo-map.location-denied"));
                return;
            }
            setHasError(true);
            if (!toldOfError.current) {
                toldOfError.current = true;
                toast.showError(t("geo-map.location-unavailable"));
            }
        });

        // The dot is a DOM marker in the canvas container, so a click on it reaches the map's own
        // click event with the dot as its target.
        const onMapClick = (e: MapMouseEvent) => {
            const fix = lastFix.current;
            if (fix && isLocationDot(e.originalEvent.target)) {
                onLocationClickRef.current?.(fix);
            }
        };
        map.on("click", onMapClick);

        return () => {
            map.off("click", onMapClick);
            control.current = null;
            lastFix.current = null;
            setState("off");
            setHasError(false);
            toldOfError.current = false;
            // A map being removed lets go of its controls first, and MapLibre's `removeControl`
            // throws for one the map no longer holds (see the scale control in map.tsx).
            if (map.hasControl(geolocate)) {
                map.removeControl(geolocate);
            }
        };
    }, [ map, available ]);

    const toggle = useCallback(() => { control.current?.trigger(); }, []);

    if (!available) return null;

    return { state, hasError, toggle };
}

/** Whether the Geolocation API can be asked at all: browsers refuse it on an insecure origin. */
function canLocate() {
    return window.isSecureContext === true && !!navigator.geolocation;
}

/**
 * Whether a click landed on GeolocateControl's user-location dot.
 *
 * The dot is a DOM marker, not a layer, so this checks the click's target instead of hit-testing the
 * map; the accuracy circle is a separate marker and does not match. The class name is MapLibre's own,
 * from its stylesheet. MapToolbar.css sets `pointer-events: none` on the dot's pulse pseudo-element so
 * it does not enlarge the hit area.
 */
export function isLocationDot(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(".maplibregl-user-location-dot") !== null;
}

function locateTitle({ state, hasError }: Locate) {
    switch (state) {
        case "denied": return t("geo-map.locate-unavailable");
        case "off": return t("geo-map.locate");
        default: break;
    }
    if (hasError) return t("geo-map.locate-error");
    switch (state) {
        case "waiting": return t("geo-map.locate-waiting");
        case "following": return t("geo-map.locate-following");
        case "background": return t("geo-map.locate-return");
    }
}
