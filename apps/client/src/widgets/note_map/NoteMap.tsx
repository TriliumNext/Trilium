import "./NoteMap.css";

import ForceGraph from "force-graph";
import { RefObject } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import FNote from "../../entities/fnote";
import link_context_menu from "../../menus/link_context_menu";
import hoisted_note from "../../services/hoisted_note";
import { t } from "../../services/i18n";
import { getEffectiveThemeStyle } from "../../services/theme";
import ActionButton from "../react/ActionButton";
import { useElementSize, useNoteLabel } from "../react/hooks";
import NoItems from "../react/NoItems";
import Slider from "../react/Slider";
import { loadNotesAndRelations, NoteMapLinkObject, NoteMapNodeObject, NotesAndRelationsData } from "./data";
import { CssData, setupRendering } from "./rendering";
import { MapType, NoteMapWidgetMode, rgb2hex } from "./utils";

/** Maximum number of notes to render in the note map before showing a warning. */
const MAX_NOTES_THRESHOLD = 1_000;

interface NoteMapProps {
    note: FNote;
    widgetMode: NoteMapWidgetMode;
    parentRef: RefObject<HTMLElement>;
}

export default function NoteMap({ note, widgetMode, parentRef }: NoteMapProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const styleResolverRef = useRef<HTMLDivElement>(null);
    const [ mapTypeRaw, setMapType ] = useNoteLabel(note, "mapType");
    const [ mapRootIdLabel ] = useNoteLabel(note, "mapRootNoteId");
    const mapType: MapType = mapTypeRaw === "tree" ? "tree" : "link";

    const graphRef = useRef<ForceGraph<NoteMapNodeObject, NoteMapLinkObject>>();
    const containerSize = useElementSize(parentRef);
    const [ fixNodes, setFixNodes ] = useState(false);
    const [ linkDistance, setLinkDistance ] = useState(40);
    const [ tooManyNotes, setTooManyNotes ] = useState<number | null>(null);
    const notesAndRelationsRef = useRef<NotesAndRelationsData>();

    const mapRootId = useMemo(() => {
        if (note.noteId && widgetMode === "ribbon") {
            return note.noteId;
        } else if (mapRootIdLabel === "hoisted") {
            return hoisted_note.getHoistedNoteId();
        } else if (mapRootIdLabel) {
            return mapRootIdLabel;
        }
        return appContext.tabManager.getActiveContext()?.parentNoteId ?? null;

    }, [ note ]);

    // Build the note graph instance.
    useEffect(() => {
        const container = containerRef.current;
        if (!container || !mapRootId) return;
        const graph = new ForceGraph<NoteMapNodeObject, NoteMapLinkObject>(container);

        graphRef.current = graph;

        const labelValues = (name: string) => note.getLabels(name).map(l => l.value) ?? [];
        const excludeRelations = labelValues("mapExcludeRelation");
        const includeRelations = labelValues("mapIncludeRelation");
        loadNotesAndRelations(mapRootId, excludeRelations, includeRelations, mapType).then((notesAndRelations) => {
            if (!containerRef.current || !styleResolverRef.current) return;

            // Guard against rendering too many notes which would freeze the browser.
            if (notesAndRelations.nodes.length > MAX_NOTES_THRESHOLD) {
                setTooManyNotes(notesAndRelations.nodes.length);
                return;
            }
            setTooManyNotes(null);

            const cssData = getCssData(containerRef.current, styleResolverRef.current);

            // Configure rendering properties.
            setupRendering(graph, {
                note,
                noteId: note.noteId,
                noteIdToSizeMap: notesAndRelations.noteIdToSizeMap,
                cssData,
                notesAndRelations,
                themeStyle: getEffectiveThemeStyle(),
                widgetMode,
                mapType
            });

            // Interaction
            graph
                .onNodeClick((node) => {
                    if (!node.id) return;
                    appContext.tabManager.getActiveContext()?.setNote(node.id);
                })
                .onNodeRightClick((node, e) => {
                    if (!node.id) return;
                    link_context_menu.openContextMenu(node.id, e);
                });

            // Set data
            graph.graphData(notesAndRelations);
            notesAndRelationsRef.current = notesAndRelations;
        });

        return () => container.replaceChildren();
    }, [ note, mapType ]);

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

    if (tooManyNotes) {
        return (
            <NoItems icon="bx bx-error-circle" text={t("note_map.too-many-notes", { count: tooManyNotes, max: MAX_NOTES_THRESHOLD })} />
        );
    }

    return (
        <div className="note-map-widget">
            <div className="btn-group btn-group-sm map-type-switcher content-floating-buttons top-left" role="group">
                <MapTypeSwitcher type="link" icon="bx bx-network-chart" text={t("note-map.button-link-map")} currentMapType={mapType} setMapType={setMapType} />
                <MapTypeSwitcher type="tree" icon="bx bx-sitemap" text={t("note-map.button-tree-map")} currentMapType={mapType} setMapType={setMapType} />
            </div>

            <div class="btn-group-sm fixnodes-type-switcher content-floating-buttons bottom-left" role="group">
                <ActionButton
                    icon="bx bx-lock-alt"
                    text={t("note_map.fix-nodes")}
                    className={fixNodes ? "active" : ""}
                    onClick={() => setFixNodes(!fixNodes)}
                    frame
                />

                <Slider
                    min={1} max={100}
                    value={linkDistance} onChange={setLinkDistance}
                    title={t("note_map.link-distance")}
                />
            </div>

            <div ref={styleResolverRef} class="style-resolver" />
            <div ref={containerRef} className="note-map-container" />
        </div>
    );
}

function MapTypeSwitcher({ icon, text, type, currentMapType, setMapType }: {
    icon: string;
    text: string;
    type: MapType;
    currentMapType: MapType;
    setMapType: (type: MapType) => void;
}) {
    return (
        <ActionButton
            icon={icon} text={text}
            active={currentMapType === type}
            onClick={() => setMapType(type)}
            frame
        />
    );
}

function getCssData(container: HTMLElement, styleResolver: HTMLElement): CssData {
    const containerStyle = window.getComputedStyle(container);
    const styleResolverStyle = window.getComputedStyle(styleResolver);

    return {
        fontFamily: containerStyle.fontFamily,
        textColor: rgb2hex(containerStyle.color),
        mutedTextColor: rgb2hex(styleResolverStyle.color)
    };
}
