import { MapMouseEvent } from "maplibre-gl";
import { useCallback, useContext, useEffect } from "preact/hooks";

import { type CommandMappings } from "../../../components/app_context.js";
import FNote from "../../../entities/fnote.js";
import contextMenu, { type MenuItem } from "../../../menus/context_menu.js";
import NoteColorPicker from "../../../menus/custom-items/NoteColorPicker.jsx";
import linkContextMenu from "../../../menus/link_context_menu.js";
import { copyTextWithToast } from "../../../services/clipboard_ext.js";
import froca from "../../../services/froca.js";
import { t } from "../../../services/i18n.js";
import link from "../../../services/link.js";
import { removeFromMap } from "./api.js";
import { GPX_MIME, trackHitLayers } from "./GpxTrack.js";
import { type GeoMouseEvent, ParentMap, toGeoMouseEvent } from "./map.js";
import { formatLocation, MARKER_LAYER } from "./Markers.js";

interface ContextMenusProps {
    /** The map's own note, which is how the tree is told what the map holds a note by. */
    parentNote: FNote;
    isReadOnly: boolean;
    /**
     * Arms this map for the marker of the given note to be put somewhere else, the next click on the
     * map being where. Handed down rather than triggered as a command because a command is heard by
     * every map at once: embedded maps share no note context, so a broadcast would arm all of them
     * (see the same reasoning around note placement in `index.tsx`).
     */
    onRelocate: (noteId: string) => void;
    /**
     * Creates a note where the click landed. Handed down rather than done here because creating is
     * only half of what the map does with a new note — it opens the pane on it too, and the pane's
     * selection lives with the map (see `createNoteAt` in `index.tsx`).
     */
    onCreateNote: (e: GeoMouseEvent) => void;
}

export default function ContextMenus({ parentNote, isReadOnly, onRelocate, onCreateNote }: ContextMenusProps) {
    const map = useContext(ParentMap);

    const onContextMenu = useCallback((e: GeoMouseEvent) => {
        if (!map) return;
        // The markers first and the tracks after, so that a pin standing on its own track opens the
        // pin's menu rather than the line's — they are the same note either way, but a marker is the
        // smaller target and is what the user was aiming at when they hit both.
        const features = map.queryRenderedFeatures(e.point, {
            layers: [ MARKER_LAYER, ...trackHitLayers(map) ]
        });

        if (features.length > 0) {
            // Marker or track context menu.
            openContextMenu(features[0].properties.id, e, { isEditable: !isReadOnly, onRelocate, parentNote });
        } else {
            // Empty area context menu.
            openMapContextMenu(e, !isReadOnly, onCreateNote);
        }
    }, [ map, isReadOnly, onRelocate, onCreateNote, parentNote ]);

    useEffect(() => {
        if (!onContextMenu || !map) return;

        const handler = (e: MapMouseEvent) => {
            e.preventDefault();
            onContextMenu(toGeoMouseEvent(e));
        };
        map.on("contextmenu", handler);
        return () => { map.off("contextmenu", handler); };
    }, [ map, onContextMenu ]);

    return null;
}

export function openContextMenu(noteId: string, e: GeoMouseEvent, { isEditable, onRelocate, parentNote }: {
    isEditable: boolean;
    onRelocate: (noteId: string) => void;
    parentNote: FNote;
}) {
    let items: MenuItem<keyof CommandMappings>[] = [
        ...buildGeoLocationItem(e),
        { kind: "separator" },
        ...linkContextMenu.getItems(e),
    ];

    if (isEditable) {
        const note = froca.getNoteFromCache(noteId);

        items = [
            ...items,
            { kind: "separator" },
            ...buildRelocateItem(noteId, onRelocate),
            {
                // A track is named for what removing it does, which is delete the note: its line is
                // drawn from the note's own file rather than from a location written on it, so there
                // is no taking it off the map and keeping it (see removeFromMap).
                title: t(note?.mime === GPX_MIME ? "geo-map-context.delete-note" : "geo-map-context.remove-from-map"),
                // Called rather than commanded: what was a broadcast command every open map heard
                // would now put a dialog up on each of them in turn.
                handler: () => note && void removeFromMap(note, parentNote),
                uiIcon: "bx bx-trash"
            },
            { kind: "separator"},
            {
                kind: "custom",
                componentFn: () => NoteColorPicker({note: noteId})
            }
        ];
    }

    contextMenu.show({
        x: e.originalEvent.pageX,
        y: e.originalEvent.pageY,
        items,
        // Pass the events to the link context menu, everything this menu adds handling itself.
        selectMenuItemHandler: ({ command }) => linkContextMenu.handleLinkContextMenuItem(command, e, noteId)
    });
}

export function openMapContextMenu(e: GeoMouseEvent, isEditable: boolean, onCreateNote: (e: GeoMouseEvent) => void) {
    let items: MenuItem<keyof CommandMappings>[] = [
        ...buildGeoLocationItem(e)
    ];

    if (isEditable) {
        items = [
            ...items,
            { kind: "separator" },
            {
                title: t("geo-map-context.add-note"),
                // The click named the place already, so this skips the armed-click step entirely:
                // the note is created here and the pane opened on it, like any other creation.
                handler: () => onCreateNote(e),
                // The pin a dropped note wears, as on the editing group's button (see EditToolbar).
                uiIcon: "bx bx-pin"
            }
        ];
    }

    contextMenu.show({
        x: e.originalEvent.pageX,
        y: e.originalEvent.pageY,
        items,
        selectMenuItemHandler: () => {
            // Nothing to do, as the commands handle themselves.
        }
    });
}

/**
 * The offer to put a marker somewhere else, where the note has a marker to put.
 *
 * The marker is moved by being placed again rather than dragged: the notes are drawn into one symbol
 * layer, not an element apiece, so there is nothing on the map to take hold of.
 *
 * A GPX track is offered nothing, which is why this is a list and not an item. A track is on the map
 * by being drawn across it — its place is the line its file holds, which no click can pick up. What
 * the offer did was write a location onto the note, planting a stray pin somewhere else while the
 * line stayed exactly where it was. The detail pane leaves the button out for the same reason.
 */
function buildRelocateItem(noteId: string, onRelocate: (noteId: string) => void): MenuItem<keyof CommandMappings>[] {
    if (froca.getNoteFromCache(noteId)?.mime === GPX_MIME) {
        return [];
    }

    return [
        { title: t("geo-map-context.move-marker"), handler: () => onRelocate(noteId), uiIcon: "bx bx-move" }
    ];
}

function buildGeoLocationItem(e: GeoMouseEvent) {
    const coordinates: [number, number] = [ e.latlng.lng, e.latlng.lat ];

    return [
        {
            title: formatLocation(coordinates),
            uiIcon: "bx bx-crosshair",
            handler: () => copyTextWithToast(formatLocation(coordinates, 15))
        },
        {
            title: t("geo-map-context.open-location"),
            uiIcon: "bx bx-map-alt",
            handler: () => link.goToLinkExt(null, `geo:${e.latlng.lat},${e.latlng.lng}`)
        }
    ];
}
