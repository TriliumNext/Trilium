import type { LatLng, LeafletMouseEvent } from "leaflet";
import appContext, { type CommandMappings } from "../../../components/app_context.js";
import contextMenu, { type MenuItem } from "../../../menus/context_menu.js";
import linkContextMenu from "../../../menus/link_context_menu.js";
import NoteColorPicker from "../../../menus/custom-items/NoteColorPicker.jsx";
import { t } from "../../../services/i18n.js";
import { createNewNote } from "./api.js";
import { copyTextWithToast } from "../../../services/clipboard_ext.js";
import link from "../../../services/link.js";

export default function openContextMenu(noteId: string, e: LeafletMouseEvent, isEditable: boolean) {
    let items: MenuItem<keyof CommandMappings>[] = [
        ...buildGeoLocationItem(e),
        { kind: "separator" },
        ...linkContextMenu.getItems(e),
    ];

    if (isEditable) {
        items = [
            ...items,
            { kind: "separator" },
            { title: t("geo-map-context.remove-from-map"), command: "deleteFromMap", uiIcon: "bx bx-trash" },
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
        selectMenuItemHandler: ({ command }) => {
            if (command === "deleteFromMap") {
                appContext.triggerCommand(command, { noteId });
                return;
            }

            // Pass the events to the link context menu
            linkContextMenu.handleLinkContextMenuItem(command, e, noteId);
        }
    });
}

export function openMapContextMenu(noteId: string, e: LeafletMouseEvent, isEditable: boolean) {
    let items: MenuItem<keyof CommandMappings>[] = [
        ...buildGeoLocationItem(e)
    ];

    if (isEditable) {
        items = [
            ...items,
            { kind: "separator" },
            {
                title: t("geo-map-context.add-note"),
                handler: () => createNewNote(noteId, e),
                uiIcon: "bx bx-plus"
            }
        ]
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

function buildGeoLocationItem(e: LeafletMouseEvent) {
    function formatGeoLocation(latlng: LatLng, precision: number = 6) {
        return `${latlng.lat.toFixed(precision)}, ${latlng.lng.toFixed(precision)}`;
    }

    return [
        {
            title: formatGeoLocation(e.latlng),
            uiIcon: "bx bx-current-location",
            handler: () => copyTextWithToast(formatGeoLocation(e.latlng, 15))
        },
        {
            title: t("geo-map-context.open-location"),
            uiIcon: "bx bx-map-alt",
            handler: () => link.goToLinkExt(null, `geo:${e.latlng.lat},${e.latlng.lng}`)
        }
    ];
}
