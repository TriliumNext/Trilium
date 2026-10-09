import "./geomap_view.css";

import GeoView, { type MapData } from "@triliumnext/client/src/widgets/collections/geomap/index.js";
import { render } from "preact";

import ShareAppHost, { type AppPayload } from "./app_host.js";

/** Mounts the app's `GeoView` over the map's notes and its saved view. */
export default function mountGeoMap(container: HTMLElement, payload: AppPayload) {
    render(
        <ShareAppHost noteId={container.dataset.noteId ?? ""} payload={payload}>
            {({ note, openNote }) => (
                <GeoView
                    note={note}
                    notePath={note.noteId}
                    noteIds={note.getChildNoteIds()}
                    highlightedTokens={null}
                    viewConfig={payload.viewConfig as MapData | undefined}
                    saveConfig={() => {}}
                    media="screen"
                    onReady={() => {}}
                    onOpenNote={openNote}
                />
            )}
        </ShareAppHost>,
        container
    );
}
