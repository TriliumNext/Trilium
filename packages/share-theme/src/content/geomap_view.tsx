import "./geomap_view.css";

import froca from "@triliumnext/client/src/services/froca.js";
import options, { type OptionValue } from "@triliumnext/client/src/services/options.js";
import GeoView from "@triliumnext/client/src/widgets/collections/geomap/index.js";
import { render } from "preact";

import type { FrocaPayload } from "./calendar_view.js";

interface GeoMapPayload extends FrocaPayload {
    options: Record<string, OptionValue | null>;
}

/**
 * Loads the map's notes into froca and the display options into `options`, then mounts the app's
 * `GeoView` over them. A `#readOnly` label added to the collection's note turns off every editing
 * control the view has.
 */
export default function mountGeoMap(container: HTMLElement, payload: GeoMapPayload) {
    const { options: optionValues, links: _links, ...rows } = payload;
    options.load(Object.fromEntries(Object.entries(optionValues)
        .flatMap(([ name, value ]) => (value === null ? [] : [ [ name, value ] ]))));

    const noteId = container.dataset.noteId ?? "";
    froca.addResp({
        ...rows,
        attributes: [ ...rows.attributes, {
            attributeId: `${noteId}-share-readOnly`,
            noteId,
            type: "label",
            name: "readOnly",
            value: "",
            position: 0,
            isInheritable: false
        } ]
    });

    const note = froca.getNoteFromCache(noteId);
    if (!note) {
        return;
    }

    render(
        <GeoView
            note={note}
            notePath={noteId}
            noteIds={note.getChildNoteIds()}
            highlightedTokens={null}
            viewConfig={undefined}
            saveConfig={() => {}}
            media="screen"
            onReady={() => {}}
        />,
        container
    );
}
