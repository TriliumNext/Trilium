import type FNote from "@triliumnext/client/src/entities/fnote.js";
import { t } from "@triliumnext/client/src/services/i18n.js";
import { TYPE_MAPPINGS, type TypeWidget } from "@triliumnext/client/src/widgets/note_types.js";
import { useNoteBlob } from "@triliumnext/client/src/widgets/react/hooks.js";
import { RawHtmlBlock } from "@triliumnext/client/src/widgets/react/RawHtml.js";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

import ShareAppHost, { type AppPayload } from "./app_host.js";
import { drawMermaid, loadMermaid, readMermaidTheme } from "./mermaid.js";
import { ZoomViewer } from "./zoom_viewer.js";

/**
 * Mounts the note in place of the content the page rendered for visitors without scripts: an image
 * or a Mermaid note's diagram in a viewer that pans and zooms it, any other note with the app's own
 * widget for its type, read-only.
 */
export default function mountNoteView(container: HTMLElement, payload: AppPayload) {
    container.replaceChildren();
    render(
        <ShareAppHost noteId={container.dataset.noteId ?? ""} payload={payload}>
            {({ note }) => <SharedNoteView note={note} />}
        </ShareAppHost>,
        container
    );
}

function SharedNoteView({ note }: { note: FNote }) {
    switch (note.type) {
        case "image": return <ImageView note={note} />;
        case "mermaid": return <MermaidView note={note} />;
        default: return <NoteView note={note} />;
    }
}

function NoteView({ note }: { note: FNote }) {
    const [ Widget, setWidget ] = useState<TypeWidget>();
    const mapping = TYPE_MAPPINGS[note.type as keyof typeof TYPE_MAPPINGS];

    useEffect(() => {
        Promise.resolve(mapping.view()).then((view) => {
            const widget = "default" in view ? view.default : view;
            setWidget(() => widget);
        });
    }, [ mapping ]);

    return Widget && (
        <div className={mapping.className}>
            <Widget
                note={note}
                viewScope={undefined}
                ntxId={null}
                parentComponent={undefined}
                noteContext={undefined}
                isVisible
            />
        </div>
    );
}

/** Shows an image note's image, which the share serves, in a viewer that takes the page. */
function ImageView({ note }: { note: FNote }) {
    const src = `api/images/${note.noteId}/${encodeURIComponent(note.title)}?${note.blobId}`;
    return (
        <ZoomViewer labels={getZoomPanLabels("image_viewer.viewport")} fillsPage>
            <img src={src} alt={note.title} />
        </ZoomViewer>
    );
}

/**
 * Draws a Mermaid note the way the page draws the diagrams of a text note, in a viewer that takes
 * the page, and draws it again when the theme changes.
 */
function MermaidView({ note }: { note: FNote }) {
    const blob = useNoteBlob(note);
    const theme = useMermaidTheme();
    const [ svg, setSvg ] = useState<string>();

    useEffect(() => {
        const source = blob?.content;
        if (!source) {
            return;
        }

        let isCurrent = true;
        loadMermaid().then((mermaid) => drawMermaid(mermaid, source, theme)).then((drawn) => {
            if (isCurrent) {
                setSvg(drawn);
            }
        }, (error: unknown) => console.error(error));
        return () => { isCurrent = false; };
    }, [ blob, theme ]);

    return (
        <ZoomViewer labels={getZoomPanLabels("svg.preview")} fillsPage>
            {svg && <RawHtmlBlock className="mermaid" html={svg} />}
        </ZoomViewer>
    );
}

/** The page's Mermaid theme, which follows the theme switch's class on `<html>`. */
function useMermaidTheme() {
    const [ theme, setTheme ] = useState(readMermaidTheme);

    useEffect(() => {
        const observer = new MutationObserver(() => setTheme(readMermaidTheme()));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: [ "class" ] });
        return () => observer.disconnect();
    }, []);

    return theme;
}

/** The texts of a viewer, from the app's catalogue, with `labelKey` naming what it shows. */
function getZoomPanLabels(labelKey: string) {
    return {
        label: t(labelKey),
        zoomIn: t("zoom_controls.zoom_in"),
        zoomOut: t("zoom_controls.zoom_out"),
        zoomReset: t("zoom_controls.reset")
    };
}
