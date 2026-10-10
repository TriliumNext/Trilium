import "@triliumnext/client/src/widgets/type_widgets/NoteMap.css";

import type FNote from "@triliumnext/client/src/entities/fnote.js";
import { t } from "@triliumnext/client/src/services/i18n.js";
import { getNoteImageUrl } from "@triliumnext/client/src/services/image_urls.js";
import type NoteMapWidget from "@triliumnext/client/src/widgets/note_map/NoteMap.js";
import { TYPE_MAPPINGS, type TypeWidget } from "@triliumnext/client/src/widgets/note_types.js";
import { useNoteBlob } from "@triliumnext/client/src/widgets/react/hooks.js";
import { RawHtmlBlock } from "@triliumnext/client/src/widgets/react/RawHtml.js";
import type RelationMapWidget from "@triliumnext/client/src/widgets/type_widgets/relation_map/RelationMap.js";
import { type ComponentType, render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import ShareAppHost, { type AppPayload, type HostedApp } from "./app_host.js";
import { drawMermaid, loadMermaid, readMermaidTheme } from "./mermaid.js";
import { ZoomViewer } from "./zoom_viewer.js";

/**
 * Mounts the note in place of the content the page rendered for visitors without scripts: an
 * image, a canvas, a mind map or a Mermaid note's diagram in a viewer that pans and zooms it, any
 * other note with the app's own widget for its type, read-only.
 */
export default function mountNoteView(container: HTMLElement, payload: AppPayload) {
    container.replaceChildren();
    render(
        <ShareAppHost noteId={container.dataset.noteId ?? ""} payload={payload}>
            {(app) => <SharedNoteView app={app} />}
        </ShareAppHost>,
        container
    );
}

type SharedView = ComponentType<{ app: HostedApp }>;

/**
 * The views of the note types the share theme draws its own way, by type, each loading what it
 * draws with. The app build reads the `import()` of each entry to give the type its group of
 * files in the share theme's manifest; the other types use `TYPE_MAPPINGS`, read the same way.
 */
const SHARE_NOTE_VIEWS: Partial<Record<string, () => Promise<SharedView>>> = {
    image: async () => ImageView,
    canvas: async () => ImageView,
    mindMap: async () => ImageView,
    // Loads the library ahead of the view, which draws with it.
    mermaid: () => import("mermaid").then(() => MermaidView),
    noteMap: async () => {
        const { default: NoteMap } = await import(
            "@triliumnext/client/src/widgets/note_map/NoteMap.js");
        return ({ app }) => <NoteMapView app={app} NoteMap={NoteMap} />;
    },
    relationMap: async () => {
        const { default: RelationMap } = await import(
            "@triliumnext/client/src/widgets/type_widgets/relation_map/RelationMap.js");
        return ({ app }) => <RelationMapView app={app} RelationMap={RelationMap} />;
    }
};

function SharedNoteView({ app }: { app: HostedApp }) {
    const load = SHARE_NOTE_VIEWS[app.note.type];
    const [ View, setView ] = useState<SharedView>();

    useEffect(() => {
        load?.().then((view) => setView(() => view));
    }, [ load ]);

    if (!load) {
        return <NoteView note={app.note} />;
    }
    return View && <View app={app} />;
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

/**
 * Shows the image the share serves for an image note, or the SVG a canvas or a mind map note keeps
 * of its drawing, in a viewer that takes the page.
 */
function ImageView({ app: { note } }: { app: HostedApp }) {
    const src = getNoteImageUrl(note.noteId, note.title, note.blobId);
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
function MermaidView({ app: { note } }: { app: HostedApp }) {
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

/**
 * Draws a note map note's map, from the note's parent on the share unless the note names another
 * root, and opens a clicked note on its shared page.
 */
function NoteMapView({ app, NoteMap }: { app: HostedApp; NoteMap: typeof NoteMapWidget }) {
    const containerRef = useRef<HTMLDivElement>(null);
    return (
        <div ref={containerRef} className="note-detail-note-map">
            <NoteMap
                parentRef={containerRef}
                note={app.note}
                widgetMode="type"
                defaultRootNoteId={app.parentNoteId}
                onOpenNote={app.openNote}
            />
        </div>
    );
}

/** Draws a relation map note's map, and opens a clicked note on its shared page. */
function RelationMapView({ app, RelationMap }: {
    app: HostedApp;
    RelationMap: typeof RelationMapWidget;
}) {
    return (
        <div className="note-detail-relation-map">
            <RelationMap
                note={app.note}
                viewScope={undefined}
                ntxId={null}
                parentComponent={undefined}
                noteContext={undefined}
                isVisible
                onOpenNote={app.openNote}
            />
        </div>
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
