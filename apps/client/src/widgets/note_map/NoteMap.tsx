import "./NoteMap.css";

import ForceGraph from "force-graph";
import { RefObject } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import type NoteContext from "../../components/note_context";
import FNote from "../../entities/fnote";
import link_context_menu from "../../menus/link_context_menu";
import hoisted_note from "../../services/hoisted_note";
import { resolveIconGlyphs, warmIconFonts } from "../../services/icon_glyphs";
import { t } from "../../services/i18n";
import { isMobile } from "../../services/utils";
import Button from "../react/Button";
import { useColorScheme, useEffectiveReadOnly, useElementSize, useNoteLabel, useTriliumOption } from "../react/hooks";
import NoItems from "../react/NoItems";
import OverlayControlGroup, { OverlayControlButton, ZoomControls } from "../react/OverlayControlGroup";
import Slider from "../react/Slider";
import { ZOOM_STEP } from "../react/zoom_pan";
import { loadNotesAndRelations, NoteMapLinkObject, NoteMapNodeObject, NotesAndRelationsData } from "./data";
import { MapTypeOverlayButtons } from "./MapTypeSwitcher";
import { CssData, type MapRendering, setupRendering } from "./rendering";
import { isRootedAtCurrentNote, MapType, NOTE_MAP_TYPE_OPTION, NoteMapWidgetMode, rgb2hex, toMapType, usesReaderPreference } from "./utils";

/** Maximum number of notes to render in the note map before showing a warning. */
const MAX_NOTES_THRESHOLD = 1_000;

interface NoteMapProps {
    note: FNote;
    widgetMode: NoteMapWidgetMode;
    parentRef: RefObject<HTMLElement | null>;
    /** The note the map starts from when the note names none, in place of the active note's parent. */
    defaultRootNoteId?: string | null;
    /** Opens a clicked note where the map's host shows notes, in place of the active note context. */
    onOpenNote?: (noteId: string) => void;
    /** The note context the map is shown in, which can make a read-only note temporarily editable. */
    noteContext?: NoteContext;
}

export default function NoteMap({ note, widgetMode, parentRef, defaultRootNoteId, onOpenNote, noteContext }: NoteMapProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const styleResolverRef = useRef<HTMLDivElement>(null);
    const isReadOnly = useEffectiveReadOnly(note, noteContext);
    const [ mapType, setMapType ] = useMapType(note, widgetMode, isReadOnly);
    const [ mapRootIdLabel ] = useNoteLabel(note, "mapRootNoteId");

    const graphRef =
        useRef<ForceGraph<NoteMapNodeObject, NoteMapLinkObject> | undefined>(undefined);
    // Everything the map is drawn in is settled when it is built — the colour of a note of each type,
    // the colour its title is written in, the shadow under it — so a change of theme calls for it to
    // be built again. The hook answers a theme being chosen and, for the themes that follow the
    // system, the system turning the lights off.
    const themeStyle = useColorScheme();
    const containerSize = useElementSize(parentRef);
    const [ fixNodes, setFixNodes ] = useState(false);
    const [ linkDistance, setLinkDistance ] = useState(40);
    const [ tooManyNotes, setTooManyNotes ] = useState<number | null>(null);
    const [ bypassLimit, setBypassLimit ] = useState(false);
    const notesAndRelationsRef = useRef<NotesAndRelationsData | undefined>(undefined);
    const renderingRef = useRef<MapRendering | undefined>(undefined);
    const [ canZoomIn, setCanZoomIn ] = useState(true);
    const [ canZoomOut, setCanZoomOut ] = useState(true);

    const mapRootId = useMemo(() => {
        if (note.noteId && isRootedAtCurrentNote(widgetMode)) {
            return note.noteId;
        } else if (mapRootIdLabel === "hoisted") {
            return hoisted_note.getHoistedNoteId();
        } else if (mapRootIdLabel) {
            return mapRootIdLabel;
        }
        return defaultRootNoteId ?? appContext.tabManager.getActiveContext()?.parentNoteId ?? null;

    }, [ note ]);

    // Build the note graph instance.
    useEffect(() => {
        const container = containerRef.current;
        if (!container || !mapRootId) return;
        const graph = new ForceGraph<NoteMapNodeObject, NoteMapLinkObject>(container);

        graphRef.current = graph;

        // A fresh graph sizes its canvas to the browser window, and the resize effect below only
        // fires when the container actually changes size — which navigating to another note isn't.
        // Left at the default, the graph centres its content far outside the (much smaller)
        // container's visible area and the map looks empty until something forces a resize.
        const size = parentRef.current?.getBoundingClientRect();
        if (size?.width && size.height) {
            graph.width(size.width).height(size.height);
        }

        // Navigating away mid-load must not let the outgoing note's data land on the new graph.
        let disposed = false;
        let rendering: MapRendering | undefined;
        const labelValues = (name: string) => note.getLabels(name).map(l => l.value) ?? [];
        const excludeRelations = labelValues("mapExcludeRelation");
        const includeRelations = labelValues("mapIncludeRelation");
        Promise.all([
            loadNotesAndRelations(mapRootId, excludeRelations, includeRelations, mapType, widgetMode === "sidebar"),
            // Awaited alongside the notes rather than after them: a canvas asked to draw from a font
            // it does not have yet says nothing and draws tofu, and the map is painted the moment its
            // data lands. Every pack's font, since which of them the map wears is not known until the
            // notes are in hand — and by then there is no waiting left to do.
            warmIconFonts()
        ]).then(([ notesAndRelations ]) => {
            if (disposed || !containerRef.current || !styleResolverRef.current) return;

            // Guard against rendering too many notes which would freeze the browser.
            if (notesAndRelations.nodes.length > MAX_NOTES_THRESHOLD && !bypassLimit) {
                setTooManyNotes(notesAndRelations.nodes.length);
                return;
            }
            setTooManyNotes(null);

            const cssData = getCssData(containerRef.current, styleResolverRef.current);
            const iconGlyphs = resolveIconGlyphs(notesAndRelations.nodes.map((node) => node.icon), containerRef.current);

            // Configure rendering properties.
            rendering = setupRendering(graph, {
                note,
                mapRootId,
                noteIdToSizeMap: notesAndRelations.noteIdToSizeMap,
                cssData,
                notesAndRelations,
                themeStyle,
                widgetMode,
                container,
                iconGlyphs,
                onZoom: (scale) => {
                    setCanZoomIn(scale < graph.maxZoom());
                    setCanZoomOut(scale > graph.minZoom());
                }
            });
            renderingRef.current = rendering;

            // Interaction
            graph
                .onNodeClick((node) => {
                    if (!node.id) return;
                    if (onOpenNote) {
                        onOpenNote(node.id);
                        return;
                    }
                    appContext.tabManager.getActiveContext()?.setNote(node.id);
                    // The map always sends the reader to the pane behind it, never to its own host — so a
                    // map shown in the quick-edit popup has to dismiss it, or it would be left covering the
                    // note it has just gone to. Raised whatever the host: a map anywhere else is behind the
                    // popup's backdrop while that is open, and so cannot be the one being pressed.
                    void appContext.triggerEvent("closePopupEditor", {});
                })
                .onNodeRightClick((node, e) => {
                    if (!node.id || onOpenNote) return;
                    link_context_menu.openContextMenu(node.id, e);
                });

            // Set data
            graph.graphData(notesAndRelations);
            notesAndRelationsRef.current = notesAndRelations;
        });

        return () => {
            disposed = true;
            rendering?.teardown();
            renderingRef.current = undefined;
            // Stops the render loop; without it the discarded graph keeps animating against a
            // detached canvas for the rest of the session.
            graph._destructor();
            container.replaceChildren();
        };
    }, [ note, mapType, bypassLimit, themeStyle ]);

    useEffect(() => {
        if (!graphRef.current || !notesAndRelationsRef.current) return;
        graphRef.current.d3Force("link")?.distance(linkDistance);
        graphRef.current.graphData(notesAndRelationsRef.current);
    }, [ linkDistance, mapType ]);

    // React to container size
    useEffect(() => {
        if (!containerSize || !graphRef.current) return;
        graphRef.current.width(containerSize.width).height(containerSize.height);
    }, [ containerSize?.width, containerSize?.height, mapType ]);

    // Fixing nodes when dragged.
    useEffect(() => {
        graphRef.current?.onNodeDragEnd((node) => {
            if (fixNodes) {
                node.fx = node.x;
                node.fy = node.y;
            } else {
                node.fx = undefined;
                node.fy = undefined;
            }
        });
    }, [ fixNodes, mapType ]);

    useEffect(() => {
        setBypassLimit(false);
    }, [ note, mapType ]);

    if (tooManyNotes && !bypassLimit) {
        return (
            <NoItems
                icon="bx bxs-network-chart"
                text={t("note_map.too-many-notes", { count: tooManyNotes })}
            >
                <Button
                    text={t("note_map.show-anyway")}
                    kind="primary"
                    size="small"
                    onClick={() => setBypassLimit(true)}
                />
            </NoItems>
        );
    }

    return (
        <div className="note-map-widget">
            {/* The sidebar offers the map type in its card's header instead, where the pane keeps the
                controls of a widget (see sidebar/NoteMap.tsx), and neither pinning nor link distance:
                its map is rebuilt for every note it is read for, so both would be gone by the next. */}
            {widgetMode !== "sidebar" && (
                <>
                    <OverlayControlGroup className="note-map-type-controls" placement="top-start" overCanvas>
                        <MapTypeOverlayButtons mapType={mapType} setMapType={setMapType} />
                    </OverlayControlGroup>

                    <OverlayControlGroup className="note-map-layout-controls" placement="bottom-start" overCanvas>
                        <OverlayControlButton
                            icon="bx-lock-alt"
                            title={t("note_map.fix-nodes")}
                            active={fixNodes}
                            onClick={() => setFixNodes(!fixNodes)}
                        />
                        <div className="note-map-link-distance">
                            <Slider
                                min={1} max={100}
                                value={linkDistance} onChange={setLinkDistance}
                                title={t("note_map.link-distance")}
                            />
                        </div>
                    </OverlayControlGroup>

                    {/* The steps stay home on mobile, as on the geo map: the fingers already zoom. */}
                    <OverlayControlGroup className="note-map-zoom-controls" placement="bottom-end" overCanvas>
                        {!isMobile() && (
                            <ZoomControls
                                canZoomIn={canZoomIn}
                                canZoomOut={canZoomOut}
                                onZoomIn={() => renderingRef.current?.zoomBy(ZOOM_STEP)}
                                onZoomOut={() => renderingRef.current?.zoomBy(1 / ZOOM_STEP)}
                            />
                        )}
                        <OverlayControlButton
                            title={t("note_map.fit-to-view")}
                            icon="bx-scan"
                            onClick={() => renderingRef.current?.fitToView()}
                        />
                    </OverlayControlGroup>
                </>
            )}

            {/* What the map is drawn in, asked of the theme — see getCssData. */}
            <div ref={styleResolverRef} class="style-resolver">
                <span class="style-resolver-background" />
                <span class="style-resolver-anchor" />
                <span class="style-resolver-anchor-icon" />
            </div>
            <div ref={containerRef} className="note-map-container" />
        </div>
    );
}

/**
 * Which of the two maps to draw, and how to ask for the other one.
 *
 * The connections tab's map is a lens on whatever note is being read, so which map it draws is the
 * reader's own preference and is kept as an option (see {@link usesReaderPreference}). Everywhere
 * else the map is a note's own thing — a note map note or a hoisted map — and the
 * note it belongs to says which to draw through its `mapType` label. A read-only note keeps its
 * label, so the reader's choice holds only while the note is shown, as on a shared page.
 */
function useMapType(note: FNote, widgetMode: NoteMapWidgetMode, isReadOnly: boolean): [ MapType, (mapType: MapType) => void ] {
    const [ label, setLabel ] = useNoteLabel(note, "mapType");
    const [ option, setOption ] = useTriliumOption(NOTE_MAP_TYPE_OPTION);
    const [ viewedMapType, setViewedMapType ] = useState<MapType>();

    useEffect(() => setViewedMapType(undefined), [ note ]);

    if (usesReaderPreference(widgetMode)) {
        return [ toMapType(option), (mapType) => void setOption(mapType) ];
    }

    return isReadOnly
        ? [ viewedMapType ?? toMapType(label), setViewedMapType ]
        : [ toMapType(label), setLabel ];
}

/**
 * What the map is drawn in, asked of the theme through elements wearing the colours it is after: a
 * canvas knows nothing of a stylesheet, and a theme is free to have its own idea of any of them.
 */
function getCssData(container: HTMLElement, styleResolver: HTMLElement): CssData {
    const containerStyle = window.getComputedStyle(container);
    const colorOf = (selector: string) => {
        const element = styleResolver.querySelector(selector);
        return element ? rgb2hex(window.getComputedStyle(element).color) : "";
    };

    return {
        fontFamily: containerStyle.fontFamily,
        textColor: rgb2hex(containerStyle.color),
        mutedTextColor: rgb2hex(window.getComputedStyle(styleResolver).color),
        backgroundColor: colorOf(".style-resolver-background"),
        anchorColor: colorOf(".style-resolver-anchor"),
        anchorIconColor: colorOf(".style-resolver-anchor-icon")
    };
}
