import "./browse.css";

import type { SpaceUsageNoteResponse } from "@triliumnext/commons";
import clsx from "clsx";
import { Fragment } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import { formatSize } from "../../../services/utils";
import ActionButton from "../../react/ActionButton";
import type { DonutRing, DonutSegment } from "../../react/charts/DonutChart";
import { useFetch } from "../../react/use_fetch";
import { type ContentChangedHandler, openSpaceUsageContextMenu } from "./context_menu";
import { buildChildrenSegments, type UsageSegmentData } from "./donut_segments";
import { deletedEntitiesLabel } from "./labels";
import ScrollableLabel from "../../react/ScrollableLabel";
import NoteUsageDonut, { segmentTooltip } from "./note_usage_donut";
import SpaceUsagePlaceholder from "./placeholder";
import type { SpaceUsageSelection } from "./selection";

const CHILDREN_RING_RADIUS = 180;
const CHILDREN_RING_THICKNESS = 46;

interface BrowseProps {
    /** Note IDs from the root (inclusive) down to the note in view. */
    path: string[];
    onPathChange: (path: string[]) => void;
    /** Changes when the section's refresh button asks for a fresh reading of this note. */
    refreshToken: number;
    /** Called once the menu deleted something, so the donut stops drawing what is no longer there. */
    onContentChanged: ContentChangedHandler;
    /**
     * The mark the page is holding as chosen, drawn as such and offered by the link under the chart.
     * See {@link onSelect}.
     */
    selection?: SpaceUsageSelection | null;
    /**
     * Where given, a click names the segment in the page's strip instead of descending into it: a
     * touch screen cannot hover a segment to find out what it is, so a tap has to say. Walking into
     * the child is then what "Show details" does in the menu the strip raises.
     */
    onSelect?: (selection: SpaceUsageSelection) => void;
    /**
     * Reports whether this view is measuring, so the section can keep its refresh button out while
     * it is — this view's reading is its own request, which the section cannot otherwise see.
     */
    onLoadingChange: (loading: boolean) => void;
}

/**
 * The Browse view: the composition donut of the current note wrapped by its children ring, entered
 * from the root and navigated by clicking children. The breadcrumb mirrors the descent and jumps
 * anywhere back up; the back button pops one level.
 *
 * The path is owned by the section rather than the view, so that "Show details" elsewhere in Space
 * Usage can drop the user straight onto a note here.
 */
export default function Browse({
    path, onPathChange, refreshToken, onContentChanged, selection, onSelect, onLoadingChange
}: BrowseProps) {
    const noteId = path[path.length - 1];
    const { data: usage, failed, loading } = useFetch<SpaceUsageNoteResponse>(
        `space-usage/note/${noteId}`, refreshToken);

    useEffect(() => onLoadingChange(loading), [ loading, onLoadingChange ]);
    // Leaving the view mid-measure would otherwise strand the section believing one is still under
    // way, with its refresh button disabled for good.
    useEffect(() => () => onLoadingChange(false), [ onLoadingChange ]);
    const titles = useNoteTitles(path, usage);
    const getTitle = useCallback((id: string) => titles.get(id) ?? id, [ titles ]);

    const menuFor = useCallback((childId: string) => (event: MouseEvent) =>
        void openSpaceUsageContextMenu(event, [ ...path, childId ], onPathChange, onContentChanged),
        [ path, onPathChange, onContentChanged ]);

    const childrenRing: DonutRing<UsageSegmentData> = useMemo(() => ({
        id: "children",
        radius: CHILDREN_RING_RADIUS,
        thickness: CHILDREN_RING_THICKNESS,
        segments: usage ? buildChildrenSegments(usage, {
            getTitle,
            revisionsLabel: t("space_usage.revisions_subtree"),
            deletedNotesLabel: deletedEntitiesLabel(usage.deletedNotes),
            makeTooltip: segmentTooltip,
            makeOthersTooltip: (count, size) =>
                t("space_usage.others_notes", { count, size: formatSize(size) })
        }) : [],
        onSegmentClick: (segment) => {
            const childId = segment.data?.noteId;

            if (onSelect) {
                const selection = selectionOf(segment, path, menuFor,
                    (id) => onPathChange([ ...path, id ]));

                if (selection) {
                    onSelect(selection);
                }

                return;
            }

            if (childId) {
                onPathChange([ ...path, childId ]);
            }
        },
        // Descending is what "Show details" means here, so the menu's own handler is the navigation.
        onSegmentContextMenu: (segment, event) => {
            const childId = segment.data?.noteId;

            if (childId) {
                void openSpaceUsageContextMenu(event, [ ...path, childId ], onPathChange, onContentChanged);
            }
        }
    }), [ usage, getTitle, path, onPathChange, onContentChanged, onSelect, menuFor ]);

    return (
        <div className="space-usage-browse">
            <nav className="space-usage-breadcrumb">
                {/* The whole line travels together — what it says and where it leads are one sentence
                    — so it is swiped rather than cut off, and fades at whichever end it carries on
                    past. A deep path is otherwise clipped at both ends by a row that centres itself,
                    and the end it loses is the note being looked at. */}
                <ScrollableLabel
                    // A new path is a new line to read out: keyed so it arrives with its own walk,
                    // rather than inheriting one the reader stopped at the level above.
                    key={path.join("/")}
                    className="space-usage-breadcrumb-track"
                    autoScroll
                >
                    <span className="space-usage-crumb-label">{t("space_usage.current_note")}</span>
                    {path.map((id, index) => (
                        <Fragment key={`${index}/${id}`}>
                            {index > 0 && <span className="space-usage-crumb-separator" aria-hidden="true">›</span>}
                            {index < path.length - 1 ? (
                                <button
                                    type="button"
                                    className="space-usage-crumb"
                                    onClick={() => onPathChange(path.slice(0, index + 1))}
                                >{getTitle(id)}</button>
                            ) : (
                                <span className="space-usage-crumb space-usage-crumb-current">{getTitle(id)}</span>
                            )}
                        </Fragment>
                    ))}
                </ScrollableLabel>
            </nav>

            {usage ? (
                <div className="space-usage-browse-chart">
                    <NoteUsageDonut
                        usage={usage}
                        title={getTitle(usage.noteId)}
                        notePath={path}
                        outerRings={[ childrenRing ]}
                        selectedSegmentId={selection?.markId}
                        onSelectSegment={onSelect}
                        onTitleContextMenu={(event) =>
                            void openSpaceUsageContextMenu(event, path, onPathChange, onContentChanged)}
                        centerActions={
                            <ActionButton
                                className="space-usage-back"
                                icon="bx bx-arrow-back"
                                text={t("space_usage.back")}
                                // An arrow in the middle of the chart it walks back up: there is
                                // nothing a tooltip could add, and on a touch screen the tap that
                                // presses it would leave one standing over the donut.
                                noTooltipOnTouch
                                disabled={path.length === 1}
                                onClick={() => path.length > 1 && onPathChange(path.slice(0, -1))}
                            />
                        }
                    />
                </div>
            ) : (
                <SpaceUsagePlaceholder failed={failed} />
            )}

            {/* What the second tap on a chosen child does, said in words: the tap is quick once it is
                known about, and nothing on the ring says it is there. Offered only where a selection
                is being kept at all, and kept in the layout whether or not one is — a line arriving
                and leaving would resize the chart above it at every tap. */}
            {onSelect && (
                <div className="space-usage-browse-details">
                    {/* Drawn whatever is chosen and merely hidden where there is nothing to open, so
                        the line it stands on is the height of the control itself rather than a
                        guess at it. Hidden this way it is also out of reach of the keyboard and of
                        assistive technology, which `display: none` and a bare gap both cost.

                        A plain button, as the breadcrumb's own crumbs are: the shared control's
                        low-profile look loses to the app's global `.btn` surface, and this reads as
                        a link rather than as a control anyway. */}
                    <button
                        type="button"
                        className={clsx("space-usage-details-link", !selection?.onOpen && "space-usage-details-link-idle")}
                        onClick={() => selection?.onOpen?.()}
                    >{t("space_usage.show_selection_details")}</button>
                </div>
            )}
        </div>
    );
}

/**
 * What the strip says about a segment of the children ring: the child note, with the path that
 * identifies its placement and the menu that acts on it, or one of the two figures closing the ring,
 * named by what the segment calls itself. "Others" stands for several children at once and answers
 * nothing, in the strip as in the chart.
 */
function selectionOf(
    segment: DonutSegment<UsageSegmentData>,
    path: string[],
    menuFor: (childId: string) => (event: MouseEvent) => void,
    onDescend: (childId: string) => void
): SpaceUsageSelection | null {
    const childId = segment.data?.noteId;

    if (childId) {
        return {
            markId: segment.id,
            notePath: [ ...path, childId ],
            size: segment.value,
            onActivate: menuFor(childId),
            // Walking in is what a click does here on a desktop, and a second tap is what a touch
            // screen has left once the first has been spent naming the child.
            onOpen: () => onDescend(childId)
        };
    }

    return segment.label
        ? { markId: segment.id, label: segment.label, size: segment.value }
        : null;
}

/**
 * Batch-loads the titles the view needs — the breadcrumb's path and the children ring's tooltips.
 * Until (or unless) a title arrives, the ID stands in.
 */
function useNoteTitles(path: string[], usage: SpaceUsageNoteResponse | null) {
    const [ titles, setTitles ] = useState(new Map<string, string>());

    useEffect(() => {
        const noteIds = [ ...path, ...(usage?.children.map((child) => child.noteId) ?? []) ];
        let cancelled = false;

        // Silent: a note deleted since the usage was computed must not fail the whole view.
        void froca.getNotes(noteIds, true).then((notes) => {
            if (!cancelled) {
                setTitles(new Map(notes.map((note) => [ note.noteId, note.title ])));
            }
        });

        return () => {
            cancelled = true;
        };
    }, [ path, usage ]);

    return titles;
}
