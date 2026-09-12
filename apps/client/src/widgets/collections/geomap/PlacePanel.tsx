import "./PlacePanel.css";

import { useEffect, useRef } from "preact/hooks";

import { t } from "../../../services/i18n";
import Button from "../../react/Button";
import OverlayPanel, { OverlayPanelBody, OverlayPanelTitle } from "../../react/OverlayPanel";
import { LocationButton } from "./DetailPane";
import type { GeoSearchResult } from "./geocoding";
import { PLACE_MARKER_ICON } from "./PlaceMarker";

interface PlacePanelProps {
    place: GeoSearchResult;
    /** The map may not be edited, so the place can be looked at but not kept. */
    isReadOnly: boolean;
    /** Makes a note of the place, which is what turns the temporary pin into a marker of the map. */
    onAddMarker(): void;
    /** Sends the panel away, and the pin with it. */
    onClose(): void;
}

/**
 * What can be done with a place taken from the search: kept as a marker of the map, or read and
 * dismissed.
 *
 * It stands where the detail pane stands, and the two are one selection between them — picking a
 * place closes the pane and selecting a note closes this (see index.tsx). A panel rather than a popup
 * over the pin: a popup would crowd the address that tells two places of the same name apart, and
 * MapLibre's popups already belong to the markers' previews (see Tooltips).
 *
 * The keyboard follows the panel as it appears, so that searching, taking a place and keeping it are
 * three presses of Enter and the search bar stops reading as the thing in hand. Escape sends the
 * panel away again, the way out being what makes taking the focus fair.
 */
export default function PlacePanel({ place, isReadOnly, onAddMarker, onClose }: PlacePanelProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const addRef = useRef<HTMLButtonElement>(null);

    useEffect(() => { addRef.current?.focus(); }, [ place ]);

    useEffect(() => {
        const panel = panelRef.current;
        if (!panel) return;

        const dismiss = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };

        panel.addEventListener("keydown", dismiss);
        return () => panel.removeEventListener("keydown", dismiss);
    }, [ onClose ]);

    return (
        <OverlayPanel
            className="geo-place-panel"
            containerRef={panelRef}
            header={<OverlayPanelTitle icon={place.icon ?? PLACE_MARKER_ICON} text={place.name} />}
            close={{ text: t("geo-map.close-details"), onClick: onClose }}
        >
            <OverlayPanelBody className="geo-place-panel-body">
                {/* The whole of what the geocoder calls the place, the heading above carrying only
                    its name. A place clicked on the base map is named but not addressed, and the
                    line is left out rather than repeating the heading (see Pois). */}
                {place.label !== place.name && (
                    <div className="geo-place-panel-address">{place.label}</div>
                )}

                {/* The pane's own, so a place and a marker offer their coordinates alike. */}
                <LocationButton coordinates={[ place.lng, place.lat ]} />

                {!isReadOnly && (
                    <Button
                        className="geo-place-panel-add"
                        buttonRef={addRef}
                        kind="primary"
                        icon="bx bx-pin"
                        text={t("geo-map.add-place-as-marker")}
                        onClick={onAddMarker}
                    />
                )}
            </OverlayPanelBody>
        </OverlayPanel>
    );
}
