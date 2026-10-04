import "./NoteMap.css";

import {
    REIFICATION_OBJECT,
    REIFICATION_OF,
    REIFICATION_PREDICATE,
    REIFICATION_SUBJECT,
    ReificationResponse
} from "@triliumnext/commons";
import ForceGraph from "force-graph";
import { RefObject } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext, { type CommandNames } from "../../components/app_context";
import FNote from "../../entities/fnote";
import contextMenu, { type MenuItem } from "../../menus/context_menu";
import link_context_menu from "../../menus/link_context_menu";
import dialog, { chooseNote, pickSingleItem } from "../../services/dialog";
import froca from "../../services/froca";
import hoisted_note from "../../services/hoisted_note";
import { resolveIconGlyphs, warmIconFonts } from "../../services/icon_glyphs";
import { t } from "../../services/i18n";
import server from "../../services/server";
import ActionButton from "../react/ActionButton";
import Button from "../react/Button";
import { useColorScheme, useElementSize, useNoteLabel, useTriliumOption } from "../react/hooks";
import NoItems from "../react/NoItems";
import Slider from "../react/Slider";
import {
    carryPositions,
    dropExpansion,
    expandedNoteId,
    collapseKeys,
    foldOrder,
    foldTitle,
    loadNotesAndRelations,
    NoteMapFold,
    NoteMapLinkObject,
    NoteMapNodeObject,
    NotesAndRelationsData,
    predicatesIn,
    presentRelations,
    ReificationEnds,
    relationEndTitle,
    resolveFoldEnd,
    splitFoldTitle
} from "./data";
import MapTypeSwitcher from "./MapTypeSwitcher";
import { CssData, setupRendering } from "./rendering";
import { isRootedAtCurrentNote, MapType, NOTE_MAP_TYPE_OPTION, NoteMapWidgetMode, rgb2hex, toMapType, usesReaderPreference } from "./utils";

/** Maximum number of notes to render in the note map before showing a warning. */
const MAX_NOTES_THRESHOLD = 1_000;

interface NoteMapProps {
    note: FNote;
    widgetMode: NoteMapWidgetMode;
    parentRef: RefObject<HTMLElement | null>;
}

export default function NoteMap({ note, widgetMode, parentRef }: NoteMapProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const styleResolverRef = useRef<HTMLDivElement>(null);
    const [ mapType, setMapType ] = useMapType(note, widgetMode);
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
    const collapsedRef = useRef(new Set<string>());
    const expandedIdsRef = useRef(new Set<string>());
    const expandedEndsRef = useRef(new Map<string, ReificationEnds>());

    const mapRootId = useMemo(() => {
        if (note.noteId && isRootedAtCurrentNote(widgetMode)) {
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

        // A fresh graph sizes its canvas to the browser window, and the resize effect below only
        // fires when the container actually changes size — which navigating to another note isn't.
        // Left at the default, the graph centres its content far outside the (much smaller)
        // container's visible area and the map looks empty until something forces a resize.
        const size = parentRef.current?.getBoundingClientRect();
        if (size?.width && size.height) {
            graph.width(size.width).height(size.height);
        }

        // A fold belongs to the map that was open when it was made.
        collapsedRef.current = new Set();
        expandedIdsRef.current = new Set();
        expandedEndsRef.current = new Map();
        // Navigating away mid-load must not let the outgoing note's data land on the new graph.
        let disposed = false;
        let teardownRendering: (() => void) | undefined;
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
            const rendering = setupRendering(graph, {
                note,
                mapRootId,
                noteIdToSizeMap: notesAndRelations.noteIdToSizeMap,
                cssData,
                notesAndRelations,
                themeStyle,
                widgetMode,
                container,
                iconGlyphs
            });
            teardownRendering = rendering.stop;

            // Interaction
            const expandedEnds = () => {
                const ends: ReificationEnds[] = [];
                for (const id of expandedIdsRef.current) {
                    const item = expandedEndsRef.current.get(id);
                    if (item) {
                        ends.push(item);
                    }
                }
                return ends;
            };
            const showView = (refit: boolean) => {
                const base = notesAndRelationsRef.current;
                if (!base) {
                    return;
                }
                const next = presentRelations(
                    base,
                    collapsedRef.current,
                    expandedEnds()
                );
                // setupFraming sets framing to false on pointerdown. carryPositions copies
                // coordinates onto next, and resumeFraming sets fitWholeGraph so zoomToFit
                // follows those notes instead of planFraming's original filter.
                if (refit) {
                    carryPositions(graph.graphData().nodes, next.nodes, mapRootId);
                }
                graph.graphData(next);
                rendering.setHoverGraph(next.nodes, next.links);
                graph.d3ReheatSimulation();
                if (refit) {
                    rendering.resumeFraming();
                }
            };

            graph
                .linkHoverPrecision(10)
                .onNodeClick((node) => {
                    if (node.joint) {
                        return;
                    }
                    if (node.fold) {
                        const predicates = node.fold.predicates.length > 0
                            ? node.fold.predicates
                            : [ node.fold.predicate ];
                        if (predicates.length === 1) {
                            void openFoldedRelation(node.fold, predicates[0]);
                        } else {
                            void chooseFoldedStatement(node.fold, node.name);
                        }
                        return;
                    }
                    if (!node.id) return;
                    appContext.tabManager.getActiveContext()?.setNote(node.id);
                    // The map always sends the reader to the pane behind it, never to its own host — so a
                    // map shown in the quick-edit popup has to dismiss it, or it would be left covering the
                    // note it has just gone to. Raised whatever the host: a map anywhere else is behind the
                    // popup's backdrop while that is open, and so cannot be the one being pressed.
                    void appContext.triggerEvent("closePopupEditor", {});
                })
                .onNodeRightClick((node, event) => {
                    if (node.joint) {
                        return;
                    }
                    if (node.fold) {
                        event.preventDefault();
                        const fold = node.fold;
                        void showFoldedNodeMenu(event, fold, node.name, () => {
                            collapsedRef.current.delete(fold.collapseKey ?? fold.linkId);
                            showView(true);
                        });
                        return;
                    }
                    if (!node.id) return;
                    event.preventDefault();
                    void openReificationNodeMenu(node.id, event, (ends) => {
                        expandedEndsRef.current.set(ends.rootId, ends);
                        expandedIdsRef.current.add(ends.rootId);
                        showView(true);
                    });
                })
                .onLinkRightClick((link, event) => {
                    if (mapType !== "link" || !link.name || !link.id) {
                        return;
                    }
                    event.preventDefault();
                    const linkId = link.id;
                    void showRelationMenu(link, event, graph.graphData(), (predicate) => {
                        // The edges this one starts on fold first. Expand puts back only this one.
                        // A host edge folds only the statement this line hangs on.
                        const shown = graph.graphData();
                        const base = notesAndRelationsRef.current;
                        for (const key of collapseKeys(
                            foldOrder(shown, linkId),
                            linkId,
                            predicate,
                            (id) => {
                                const stored = base?.links.find((item) => item.id === id);
                                const current = shown.links.find((item) => item.id === id);
                                return predicatesIn(stored?.name ?? current?.name ?? "");
                            },
                            (id) => shown.links.find((item) => item.id === id)?.hostPredicate
                        )) {
                            collapsedRef.current.add(key);
                        }
                        showView(false);
                    }, () => {
                        const noteId = expandedNoteId(linkId);
                        if (!noteId) {
                            return;
                        }
                        dropExpansion(noteId, expandedIdsRef.current, expandedEndsRef.current, collapsedRef.current);
                        showView(true);
                    });
                });

            // Set data
            notesAndRelationsRef.current = notesAndRelations;
            showView(false);
        });

        return () => {
            disposed = true;
            teardownRendering?.();
            // Stops the render loop; without it the discarded graph keeps animating against a
            // detached canvas for the rest of the session.
            graph._destructor();
            container.replaceChildren();
        };
    }, [ note, mapType, bypassLimit, themeStyle ]);

    useEffect(() => {
        if (!graphRef.current || !notesAndRelationsRef.current) return;
        graphRef.current.d3Force("link")?.distance(linkDistance);
        const expanded: ReificationEnds[] = [];
        for (const id of expandedIdsRef.current) {
            const item = expandedEndsRef.current.get(id);
            if (item) {
                expanded.push(item);
            }
        }
        graphRef.current.graphData(presentRelations(
            notesAndRelationsRef.current,
            collapsedRef.current,
            expanded
        ));
    }, [ linkDistance, mapType ]);

    // React to container size
    useEffect(() => {
        if (!containerSize || !graphRef.current) return;
        graphRef.current.width(containerSize.width).height(containerSize.height);
    }, [ containerSize?.width, containerSize?.height, mapType ]);

    // Fixing nodes when dragged.
    useEffect(() => {
        graphRef.current?.onNodeDragEnd((node) => {
            if (fixNodes || node.pinnedFold) {
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
            {/* The sidebar offers the choice in its card's header instead, where the pane keeps the
                controls of a widget — see sidebar/NoteMap.tsx. */}
            {widgetMode !== "sidebar" && (
                <MapTypeSwitcher
                    mapType={mapType} setMapType={setMapType}
                    className="btn-group-sm content-floating-buttons top-left" frame
                />
            )}

            {/* Not in the sidebar, where neither has anything to hold on to: a map that small is not
                one to arrange by hand, and it is rebuilt from scratch on every note it is read for,
                which is what a connections panel is for — so a pinned node and a chosen link distance
                are both gone by the next note. */}
            {widgetMode !== "sidebar" && (
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
 * else the map is a note's own thing — a note map note, a hoisted map, the ribbon's tab — and the
 * note it belongs to says which to draw through its `mapType` label.
 */
function useMapType(note: FNote, widgetMode: NoteMapWidgetMode): [ MapType, (mapType: MapType) => void ] {
    const [ label, setLabel ] = useNoteLabel(note, "mapType");
    const [ option, setOption ] = useTriliumOption(NOTE_MAP_TYPE_OPTION);

    return usesReaderPreference(widgetMode)
        ? [ toMapType(option), (mapType) => void setOption(mapType) ]
        : [ toMapType(label), setLabel ];
}

/**
 * What the map is drawn in, asked of the theme through elements wearing the colours it is after: a
 * canvas knows nothing of a stylesheet, and a theme is free to have its own idea of any of them.
 */
async function reificationEnds(note: FNote): Promise<ReificationEnds | null> {
    if (!note.getOwnedLabelValue(REIFICATION_OF)) {
        return null;
    }
    const subjectId = note.getOwnedRelation(REIFICATION_SUBJECT)?.value;
    const predicate = note.getOwnedLabelValue(REIFICATION_PREDICATE) ?? "";
    if (!subjectId) {
        return null;
    }
    const subject = await froca.getNote(subjectId);
    if (!subject) {
        return null;
    }
    const objectId = note.getOwnedRelation(REIFICATION_OBJECT)?.value;
    const object = objectId ? await froca.getNote(objectId) : null;
    return {
        rootId: note.noteId,
        predicate,
        subject: nodeFrom(subject),
        object: object ? nodeFrom(object) : null
    };
}

function nodeFrom(note: FNote): NoteMapNodeObject {
    return {
        id: note.noteId,
        name: note.title,
        type: note.type,
        color: note.getLabelValue("color"),
        icon: note.getIcon()
    };
}

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

interface ReificationListItem {
    noteId: string;
    title: string;
    attributeId: string;
    direct: boolean;
}

interface PredicateConcept {
    noteId: string | null;
    title: string | null;
}

/**
 * Right-click on a relation: fold that instance, open a reification that already
 * includes it, or open the concept of the relation name itself.
 */
async function showRelationMenu(
    link: NoteMapLinkObject,
    event: MouseEvent,
    graph: { nodes: NoteMapNodeObject[]; links: NoteMapLinkObject[] },
    fold: (predicate?: string) => void,
    unexpand?: () => void
) {
    const sourceId = linkEndId(link.source);
    const targetId = linkEndId(link.target);
    const predicates = predicatesIn(link.name);
    const subjectTitle = await titledEnd(link.source, graph, predicateAt(link, link.source));
    const objectTitle = await titledEnd(link.target, graph, predicateAt(link, link.target));
    const chosen = await chooseRelation(predicates, subjectTitle, objectTitle);
    if (!chosen) {
        return;
    }
    const title = foldTitle([ chosen ], subjectTitle, objectTitle);
    const items: MenuItem<string>[] = [];
    if (unexpand && link.id && expandedNoteId(link.id)) {
        items.push({ title: t("note_map.show_as_note"), command: "unexpand", uiIcon: "bx bx-collapse" });
    }
    items.push({ title: t("note_map.fold_as", { title }), command: "fold", uiIcon: "bx bx-collapse" });

    const seen = new Set<string>();
    const listed: ReificationListItem[] = [];
    for (const attributeId of await relationAttributeIds(sourceId, targetId, chosen)) {
        try {
            const response = await server.get<{ items: ReificationListItem[] }>(`attributes/${attributeId}/reifications`);
            for (const item of response.items) {
                if (seen.has(item.noteId)) {
                    continue;
                }
                seen.add(item.noteId);
                listed.push(item);
            }
        } catch {
            // The row can disappear between the click and the lookup. Folding still works.
        }
    }

    const direct = listed.find((item) => item.direct);
    const rest = listed.filter((item) => !item.direct);
    if (direct) {
        items.push({
            title: t("note_map.open_reification", { title: direct.title }),
            command: `open:${direct.noteId}`,
            uiIcon: "bx bx-git-commit"
        });
        items.push({
            title: t("relation_map.remove_reification"),
            command: `unreify:${direct.attributeId}:${direct.noteId}`,
            uiIcon: "bx bx-undo"
        });
    }
    if (rest.length > 0) {
        items.push({ kind: "separator" });
        for (const item of rest) {
            items.push({ title: item.title, command: `open:${item.noteId}`, uiIcon: "bx bx-git-commit" });
        }
    }

    items.push({ kind: "separator" });
    for (const name of [ chosen ]) {
        const concept = await loadPredicateConcept(name);
        if (concept?.noteId) {
            items.push({
                title: t("note_map.go_to_concept", { name }),
                command: `concept-open:${concept.noteId}`,
                uiIcon: "bx bx-cube"
            });
            continue;
        }
        items.push({
            title: t("note_map.connect_concept", { name }),
            command: `concept-connect:${name}`,
            uiIcon: "bx bx-link"
        });
    }

    contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items,
        selectMenuItemHandler: ({ command }) => {
            if (command === "unexpand") {
                unexpand?.();
                return;
            }
            void applyRelationCommand(command, () => fold(chosen));
        }
    });
}

async function applyRelationCommand(command: string | undefined, fold: () => void) {
    if (!command) {
        return;
    }
    if (command === "fold") {
        fold();
        return;
    }
    if (command.startsWith("open:") || command.startsWith("concept-open:")) {
        const noteId = command.startsWith("concept-open:")
            ? command.slice("concept-open:".length)
            : command.slice("open:".length);
        openNote(noteId);
        return;
    }
    if (command.startsWith("unreify:")) {
        const rest = command.slice("unreify:".length);
        const splitAt = rest.indexOf(":");
        if (splitAt < 1) {
            return;
        }
        const attributeId = rest.slice(0, splitAt);
        const noteId = rest.slice(splitAt + 1);
        if (!(await dialog.confirm(t("relation_map.confirm_remove_reification")))) {
            return;
        }
        await removeReification(attributeId, noteId);
        return;
    }
    if (command.startsWith("concept-connect:")) {
        const predicate = command.slice("concept-connect:".length);
        const chosen = await chooseNote({
            title: t("note_map.connect_concept", { name: predicate }),
            allowCreatingNotes: true
        });
        if (!chosen) {
            return;
        }
        const saved = await server.post<PredicateConcept>(
            `reification-concepts/${encodeURIComponent(predicate)}`,
            { noteId: chosen }
        );
        if (saved.noteId) {
            openNote(saved.noteId);
        }
    }
}

async function loadPredicateConcept(predicate: string): Promise<PredicateConcept | null> {
    try {
        return await server.get<PredicateConcept>(`reification-concepts/${encodeURIComponent(predicate)}`);
    } catch {
        return null;
    }
}

function openNote(noteId: string) {
    appContext.tabManager.getActiveContext()?.setNote(noteId);
    void appContext.triggerEvent("closePopupEditor", {});
}

function linkEndId(end: NoteMapLinkObject["source"]): string {
    if (typeof end === "object" && end) {
        return end.id;
    }
    return String(end ?? "");
}

/** Which statement of a shared edge this end hangs on, when the line says. */
function predicateAt(link: NoteMapLinkObject, end: NoteMapLinkObject["source"]) {
    const id = linkEndId(end);
    if (id && id === link.hostEndId) {
        return link.hostPredicate;
    }
    if (id && id === link.farEndId) {
        return link.farPredicate;
    }
}

/** A note's title, or the fact a point on an edge stands for. */
async function titledEnd(
    end: NoteMapLinkObject["source"],
    graph: { nodes: NoteMapNodeObject[]; links: NoteMapLinkObject[] },
    predicate?: string
) {
    const titled = relationEndTitle(end, graph, new Set(), predicate);
    if (titled) {
        return titled;
    }
    const id = linkEndId(end);
    if (!id || id.startsWith("edge:") || id.startsWith("fold:")) {
        return "";
    }
    const note = await froca.getNote(id);
    return note?.title ?? "";
}

async function relationAttributeIds(sourceNoteId: string, targetNoteId: string, names: string): Promise<string[]> {
    const source = await froca.getNote(sourceNoteId);
    if (!source) {
        return [];
    }
    const ids: string[] = [];
    for (const name of names.split(",")) {
        const predicate = name.trim();
        if (!predicate) {
            continue;
        }
        const attributes = [
            ...source.getOwnedRelations(predicate),
            ...source.getRelations(predicate)
        ];
        for (const attribute of attributes) {
            if (attribute.value !== targetNoteId || ids.includes(attribute.attributeId)) {
                continue;
            }
            ids.push(attribute.attributeId);
        }
    }
    return ids;
}

/**
 * Right-click on a note. A reification with two ends can be opened into those
 * ends; any other note keeps the menu a note has everywhere else.
 */
async function openReificationNodeMenu(noteId: string, event: MouseEvent, expand: (ends: ReificationEnds) => void) {
    const loaded = await froca.getNote(noteId);
    const ends = loaded ? await reificationEnds(loaded) : null;
    if (!loaded || !ends?.object) {
        link_context_menu.openContextMenu(noteId, event);
        return;
    }
    showReifiedNodeMenu(event, noteId, loaded.getOwnedLabelValue(REIFICATION_OF) ?? "", ends.subject.id, () => expand(ends));
}

/**
 * Right-click on a reification. Putting the two notes back and dropping the
 * note are choices, so the fact stays until one of them is picked.
 */
function showReifiedNodeMenu(
    event: MouseEvent,
    noteId: string,
    attributeId: string,
    subjectNoteId: string,
    showEnds: () => void
) {
    async function dropReification() {
        if (!(await dialog.confirm(t("relation_map.confirm_remove_reification")))) {
            return;
        }
        await removeReification(attributeId, noteId, subjectNoteId);
    }

    const items: MenuItem<CommandNames>[] = [
        { title: t("note_map.show_ends"), uiIcon: "bx bx-expand", handler: () => showEnds() }
    ];
    if (attributeId) {
        items.push({
            title: t("relation_map.remove_reification"),
            uiIcon: "bx bx-undo",
            handler: () => {
                void dropReification();
            }
        });
    }
    items.push({ kind: "separator" }, ...link_context_menu.getItems(event));
    contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items,
        selectMenuItemHandler: ({ command }) => {
            if (command) {
                link_context_menu.handleLinkContextMenuItem(command, event, noteId);
            }
        }
    });
}

/** Right-click on a folded relation: put the two notes back, or drop the note for that row. */
async function showFoldedNodeMenu(event: MouseEvent, fold: NoteMapFold, title: string, expand: () => void) {
    const predicates = fold.predicates.length > 0 ? fold.predicates : [ fold.predicate ];
    const captions = splitFoldTitle(title);
    const chosen = await chooseStatement(predicates.map((predicate, index) => ({
        key: predicate,
        caption: captions.length === predicates.length ? captions[index] : predicate
    })));
    if (!chosen) {
        return;
    }
    const captionIndex = predicates.indexOf(chosen);
    const caption = captions.length === predicates.length && captionIndex >= 0 ? captions[captionIndex] : title;
    const attribute = await attributeOfFold(fold, chosen);
    let noteId: string | undefined;
    if (attribute) {
        const lookedUp = await server.get<{ noteId?: string } | null>(`attributes/${attribute.attributeId}/reification`);
        if (lookedUp && typeof lookedUp === "object" && lookedUp.noteId) {
            noteId = lookedUp.noteId;
        }
    }
    const items: MenuItem<string>[] = [
        { title: t("relation_map.expand_relation"), command: "expand", uiIcon: "bx bx-expand" }
    ];
    if (attribute?.attributeId && noteId) {
        items.push({
            title: t("note_map.open_reification", { title: caption }),
            command: "open",
            uiIcon: "bx bx-git-commit"
        });
        items.push({ title: t("relation_map.remove_reification"), command: "unreify", uiIcon: "bx bx-undo" });
    }
    contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items,
        selectMenuItemHandler: async ({ command }) => {
            if (command === "expand") {
                expand();
                return;
            }
            if (command === "open") {
                if (noteId) {
                    openNote(noteId);
                    return;
                }
                await openFoldedRelation(fold, chosen);
                return;
            }
            if (command === "unreify" && attribute?.attributeId && noteId) {
                if (!(await dialog.confirm(t("relation_map.confirm_remove_reification")))) {
                    return;
                }
                const fallbackNoteId = await resolveFoldEnd(fold.subject, reificationOfRelation);
                await removeReification(attribute.attributeId, noteId, fallbackNoteId);
                expand();
            }
        }
    });
}

/** The statement a grouped edge's menu is about. One name skips the search. */
async function chooseRelation(predicates: string[], subjectTitle: string, objectTitle: string) {
    return chooseStatement(predicates.map((predicate) => ({
        key: predicate,
        caption: foldTitle([ predicate ], subjectTitle, objectTitle)
    })));
}

async function chooseStatement(items: { key: string; caption: string }[]) {
    if (items.length === 0) {
        return null;
    }
    if (items.length === 1) {
        return items[0].key;
    }
    const picked = await pickSingleItem({
        title: t("note_map.choose_statement"),
        placeholder: t("note_map.choose_statement_search"),
        items: items.map((item) => ({
            key: item.key,
            caption: item.caption,
            icon: "bx bx-link"
        }))
    });
    return picked?.key ?? null;
}

/** Deletes the note for one attribute row. The relation stays. A view of that note moves to `fallbackNoteId`. */
async function removeReification(attributeId: string, reificationNoteId: string, fallbackNoteId?: string) {
    await server.remove(`attributes/${attributeId}/reification`);
    const active = appContext.tabManager.getActiveContext();
    if (fallbackNoteId && active?.note?.noteId === reificationNoteId) {
        active.setNote(fallbackNoteId);
    }
}

async function findRelationAttribute(sourceNoteId: string, predicate: string, targetNoteId: string) {
    const source = await froca.getNote(sourceNoteId);
    const owned = source?.getOwnedRelations(predicate) ?? [];
    return owned.find((item) => item.value === targetNoteId)
        ?? source?.getRelations(predicate).find((item) => item.value === targetNoteId);
}

/** The attribute row a fold stands for, including when an end of it is itself a folded relation. */
async function attributeOfFold(fold: NoteMapFold, predicate = fold.predicate) {
    const sourceId = await resolveFoldEnd(fold.subject, reificationOfRelation);
    const objectId = await resolveFoldEnd(fold.object, reificationOfRelation);
    if (!sourceId || !objectId) {
        return;
    }
    return findRelationAttribute(sourceId, predicate, objectId);
}

/** The note that already stands for one relation, when the fold's other end is that relation. */
async function reificationOfRelation(sourceNoteId: string, predicate: string, targetNoteId: string) {
    const attribute = await findRelationAttribute(sourceNoteId, predicate, targetNoteId);
    if (!attribute) {
        return;
    }
    const lookedUp = await server.get<{ noteId?: string } | null>(`attributes/${attribute.attributeId}/reification`);
    if (lookedUp && typeof lookedUp === "object" && lookedUp.noteId) {
        return lookedUp.noteId;
    }
}

/** Asks which statement on a grouped edge to open, then opens or creates that note. */
async function chooseFoldedStatement(fold: NoteMapFold, title: string) {
    const predicates = fold.predicates.length > 0 ? fold.predicates : [ fold.predicate ];
    const captions = splitFoldTitle(title);
    const chosen = await chooseStatement(predicates.map((predicate, index) => ({
        key: predicate,
        caption: captions.length === predicates.length ? captions[index] : predicate
    })));
    if (!chosen) {
        return;
    }
    await openFoldedRelation(fold, chosen);
}

/** Creates the note for a folded relation, if it does not exist yet, and opens it. */
async function openFoldedRelation(fold: NoteMapFold, predicate = fold.predicate) {
    const attribute = await attributeOfFold(fold, predicate);
    if (!attribute) {
        return;
    }
    const { noteId } = await server.post<ReificationResponse>(`attributes/${attribute.attributeId}/reification`);
    appContext.tabManager.getActiveContext()?.setNote(noteId);
    void appContext.triggerEvent("closePopupEditor", {});
}
