import "./browse.css";

import type { SpaceUsageNoteResponse } from "@triliumnext/commons";
import { Fragment } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

import froca from "../../../../../services/froca";
import { t } from "../../../../../services/i18n";
import { formatSize } from "../../../../../services/utils";
import ActionButton from "../../../../react/ActionButton";
import type { DonutRing } from "../../../../react/charts/DonutChart";
import { useFetch } from "../../../../react/use_fetch";
import { type ContentChangedHandler, openSpaceUsageContextMenu } from "./context_menu";
import { buildChildrenSegments, type UsageSegmentData } from "./donut_segments";
import { deletedEntitiesLabel } from "./labels";
import NoteUsageDonut, { segmentTooltip } from "./note_usage_donut";
import SpaceUsagePlaceholder from "./placeholder";

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
    path, onPathChange, refreshToken, onContentChanged, onLoadingChange
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
    }), [ usage, getTitle, path, onPathChange, onContentChanged ]);

    return (
        <div className="space-usage-browse">
            <nav className="space-usage-breadcrumb">
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
            </nav>

            {usage ? (
                <div className="space-usage-browse-chart">
                    <NoteUsageDonut
                        usage={usage}
                        title={getTitle(usage.noteId)}
                        notePath={path}
                        outerRings={[ childrenRing ]}
                        onTitleContextMenu={(event) =>
                            void openSpaceUsageContextMenu(event, path, onPathChange, onContentChanged)}
                        centerActions={
                            <ActionButton
                                className="space-usage-back"
                                icon="bx bx-arrow-back"
                                text={t("space_usage.back")}
                                disabled={path.length === 1}
                                onClick={() => path.length > 1 && onPathChange(path.slice(0, -1))}
                            />
                        }
                    />
                </div>
            ) : (
                <SpaceUsagePlaceholder failed={failed} />
            )}
        </div>
    );
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
