import "./MapToolbar.css";

import type { MindElixirInstance } from "mind-elixir";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { isMobile } from "../../../services/utils";
import { useFullscreen } from "../../react/hooks";
import OverlayControlGroup, { OverlayControlButton, OverlayFullscreenButton } from "../../react/OverlayControlGroup";
import OverlayToolbar, { OverlayToolbarButton } from "../../react/OverlayToolbar";
import { centerMapOn, type MapPoint, readMapCenter, stepZoom } from "./viewport";

interface MapToolbarProps {
    mind: MindElixirInstance;
}

/**
 * The controls standing in the bottom corner of a mind map: the scale the map is drawn at, where it
 * stands, and how much of the screen it is given.
 *
 * Mind Elixir lays two bars of its own over a map — this corner and the one opposite (see
 * {@link DirectionToolbar}) — which are left out entirely (`toolBar: false`, see MindMap.tsx). They
 * were dressed in neither Trilium's buttons nor Trilium's colors, standing on a surface of their own
 * beside the node panel they share the map with. Everything they did is done here, over the same
 * instance, on the {@link OverlayControlGroup} the image viewer's zoom buttons stand on (see
 * {@link ImageViewer}), as the geo map's controls are. The readout
 * between the steps says the scale the way the image viewer says it — a hundred being the map drawn
 * at its own size — and pressed, takes the map back there, as the image viewer's does: unlike a geo
 * map, a mind map has a natural size to be reset to.
 *
 * On mobile the steps and the readout stay home, as the geo map's steps do: the fingers already
 * zoom, and a narrow foot has little room. What remains is leaving focus, recentering, and the
 * screen.
 */
export default function MapToolbar({ mind }: MapToolbarProps) {
    const scale = useMapScale(mind);
    const isFocused = useMapFocus(mind);
    const [ isFullscreen, toggleFullscreen ] = useMapFullscreen(mind);

    const limits = { sensitivity: mind.scaleSensitivity, min: mind.scaleMin, max: mind.scaleMax };
    const zoomedIn = stepZoom(scale, 1, limits);
    const zoomedOut = stepZoom(scale, -1, limits);

    return (
        <OverlayControlGroup className="mind-map-view-toolbar" placement="bottom-end" overCanvas>
            {/* Leaving focus mode is about the map rather than about any one node, so it stands
                here rather than in the menu a node is right-clicked for — which is where Mind
                Elixir kept it, offered on every node whether the map was narrowed or not. It is
                only here while there is something to leave, the map otherwise showing all it has. */}
            {isFocused && (
                <OverlayControlButton
                    title={t("mind-map.cancelFocus")}
                    icon="bx-exit"
                    onClick={() => mind.cancelFocus()}
                />
            )}

            {!isMobile() && <>
                <OverlayControlButton
                    title={t("mind-map.zoom-out")}
                    icon="bx-minus-circle"
                    disabled={zoomedOut === null}
                    onClick={() => zoomedOut !== null && mind.scale(zoomedOut)}
                />
                <OverlayControlButton
                    title={t("mind-map.reset-zoom")}
                    text={`${Math.round(scale * 100)}%`}
                    onClick={() => mind.scale(1)}
                />
                <OverlayControlButton
                    title={t("mind-map.zoom-in")}
                    icon="bx-plus-circle"
                    disabled={zoomedIn === null}
                    onClick={() => zoomedIn !== null && mind.scale(zoomedIn)}
                />
            </>}
            <OverlayControlButton
                title={t("mind-map.center-map")}
                icon="bx-current-location"
                onClick={() => mind.toCenter()}
            />
            <OverlayFullscreenButton isFullscreen={isFullscreen} onToggle={toggleFullscreen} />
        </OverlayControlGroup>
    );
}

/**
 * The bar standing in the top corner opposite: which way the map's branches run from its root —
 * to the left of it, to the right of it, to either side, or below it.
 *
 * The four are a choice rather than four things to do, so the one the map is laid out by is shown
 * pressed. Their marks are Mind Elixir's own, kept because they draw the very thing they set and
 * nothing in Trilium's icon set says it (see MapToolbar.css).
 */
export function DirectionToolbar({ mind }: MapToolbarProps) {
    const direction = useMapDirection(mind);

    return (
        // The bar stands at the head of the map, where a tooltip over it would fall off.
        <OverlayToolbar className="mind-map-direction-toolbar" titlePosition="bottom">
            {buildDirections().map(({ value, icon, label, apply }) => (
                <OverlayToolbarButton
                    key={value}
                    icon={`mind-map-direction-icon ${icon}`}
                    text={label}
                    active={direction === value}
                    onClick={() => apply(mind)}
                />
            ))}
        </OverlayToolbar>
    );
}

/**
 * The ways a map is laid out, in the order Mind Elixir offered them — the downward one last, being
 * the one it added last, and the only one its own bar never carried: each with the value
 * `mind.direction` reads as, the mark it wears, and the call that lays the map out that way.
 *
 * Named afresh on every render, which follows a change of locale.
 */
function buildDirections() {
    return [
        {
            value: 0,
            icon: "mind-map-direction-left",
            label: t("mind-map.direction-left"),
            apply: (mind: MindElixirInstance) => mind.initLeft()
        },
        {
            value: 1,
            icon: "mind-map-direction-right",
            label: t("mind-map.direction-right"),
            apply: (mind: MindElixirInstance) => mind.initRight()
        },
        {
            value: 2,
            icon: "mind-map-direction-side",
            label: t("mind-map.direction-side"),
            apply: (mind: MindElixirInstance) => mind.initSide()
        },
        {
            value: 3,
            icon: "mind-map-direction-down",
            label: t("mind-map.direction-down"),
            apply: (mind: MindElixirInstance) => mind.initDown()
        }
    ];
}

/**
 * The scale the map is drawn at, followed as it changes — by these buttons, by the wheel, or by the
 * map fitting itself. What it is read for is whether there is any room left to zoom, which is what
 * leaves a button that would do nothing disabled instead.
 */
function useMapScale(mind: MindElixirInstance) {
    const [ scale, setScale ] = useState(mind.scaleVal);

    useEffect(() => {
        // The map may have been moved between being built and being listened to.
        setScale(mind.scaleVal);

        mind.bus.addListener("scale", setScale);
        return () => mind.bus.removeListener("scale", setScale);
    }, [ mind ]);

    return scale;
}

/** The way the map is laid out, followed as it changes. */
function useMapDirection(mind: MindElixirInstance) {
    return useMapState(mind, (mind) => mind.direction);
}

/** Whether the map is narrowed to one node's branch, followed as that comes and goes. */
function useMapFocus(mind: MindElixirInstance) {
    return useMapState(mind, (mind) => mind.isFocusMode);
}

/**
 * Follows something a map holds that it does not announce in its own right.
 *
 * Neither the direction nor the focus is spoken of directly: content carrying a direction of its own
 * is taken silently as a map is filled, and narrowing a map says only that it has been laid out
 * afresh. What every one of them does say is that the branches have been drawn, which is asked after
 * instead — it costs a read of what is wanted, and it is the one word that comes however the map
 * arrived at it.
 */
function useMapState<T>(mind: MindElixirInstance, read: (mind: MindElixirInstance) => T) {
    const [ value, setValue ] = useState(() => read(mind));
    // Read afresh on every report rather than closed over, so that a listener bound once follows a
    // reader the component hands over anew on each render.
    const readRef = useRef(read);
    readRef.current = read;

    useEffect(() => {
        const report = () => setValue(() => readRef.current(mind));

        report();
        mind.bus.addListener("linkDiv", report);
        return () => mind.bus.removeListener("linkDiv", report);
    }, [ mind ]);

    return value;
}

/**
 * Whether the map has the screen to itself, and the way to give it or take it back.
 *
 * What was in the middle of the view is put back in the middle of the new one: the map is drawn at
 * the same scale on a canvas of a different size, and would otherwise keep the offset it had and
 * slide off towards the corner it is pinned to. The point is taken as the change is asked for and
 * spent when it lands — a change is only reported once the view has already been resized, leaving
 * nothing to measure by then. A screen left by pressing Escape is therefore not followed, as it was
 * not by the bar this one replaces.
 */
function useMapFullscreen(mind: MindElixirInstance): [ boolean, () => void ] {
    const center = useRef<MapPoint | null>(null);

    const [ isFullscreen, toggleScreen ] = useFullscreen(mind.el, () => {
        const taken = center.current;
        center.current = null;
        if (taken) centerMapOn(mind, taken);
    });

    const toggle = useCallback(() => {
        center.current = readMapCenter(mind);

        // A refused request leaves the view the size it was, so there is nothing to put back — and
        // holding on to the point would move the map on whatever change came next.
        toggleScreen().then((changed) => {
            if (!changed) center.current = null;
        });
    }, [ mind, toggleScreen ]);

    return [ isFullscreen, toggle ];
}
