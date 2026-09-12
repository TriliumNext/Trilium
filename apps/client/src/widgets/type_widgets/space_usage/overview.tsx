import type { SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import { formatSize } from "../../../services/utils";
import Treemap, { type TreemapItem } from "../../react/charts/Treemap";
import {
    type ContentChangedHandler,
    openDeletedNotesContextMenu,
    openRevisionsContextMenu,
    openSpaceUsageContextMenu,
    quickEditNote,
    type ShowDetailsHandler
} from "./context_menu";
import { deletedEntitiesLabel } from "./labels";
import { bucketWeight, buildOverviewModel, type OverviewCell } from "./overview_model";
import type { SpaceUsageSelection } from "./selection";

/**
 * A cell's area covers a note's body and attachments, leaving history out; its tooltip says the
 * same. Per-note revision sizes are counted per entity rather than deduplicated, so a revision
 * snapshotting an unchanged body reports its full size while costing the database nothing — folding
 * that into the areas would inflate cells by bytes that were never spent.
 */
const INCLUDE_REVISIONS = false;

interface OverviewProps {
    overview: SpaceUsageOverviewResponse;
    /** The cell drawn as chosen, where the page keeps a selection. See {@link onSelect}. */
    selectedMarkId?: string;
    /**
     * Where given, a click names the cell in the page's strip instead of opening the note: the way a
     * touch screen reads a map whose cells cannot be hovered to find out what they are.
     */
    onSelect?: (selection: SpaceUsageSelection) => void;
    onShowDetails: ShowDetailsHandler;
    /** Called once the menu deleted something, so the map stops drawing what is no longer there. */
    onContentChanged: ContentChangedHandler;
}

/** The treemap over the whole database: every large note at its tree location. */
export default function Overview({
    overview, selectedMarkId, onSelect, onShowDetails, onContentChanged
}: OverviewProps) {
    const icons = useNoteIcons(overview);

    // What each bucket is called, on its own: the tooltips below add the size to the name, and the
    // strip prints that in a column of its own, so the name has to be available without one.
    const bucketNames = useMemo(() => ({
        other: t("space_usage.other_notes", { count: overview.otherNotes.noteCount }),
        hidden: t("space_usage.hidden_notes", { count: overview.hiddenNotes.noteCount }),
        // Not a crowd of notes but a tier of content, so it names itself rather than a count.
        revisions: t("space_usage.revisions"),
        deleted: deletedEntitiesLabel(overview.deletedNotes)
    }), [ overview ]);

    // The labels are formatted here rather than in the model, which stays free of i18n: a bucket
    // stands for a crowd, so its tooltip names how many notes it holds and how much they take.
    const model = useMemo(() => buildOverviewModel(overview, {
        otherNotesLabel: withSize(bucketNames.other, bucketWeight(overview.otherNotes, INCLUDE_REVISIONS)),
        hiddenNotesLabel: withSize(bucketNames.hidden, bucketWeight(overview.hiddenNotes, INCLUDE_REVISIONS)),
        // The figure is the deduplicated one the status line quotes, which is what its cell draws.
        revisionsLabel: withSize(bucketNames.revisions, overview.content.revisionsSize),
        deletedNotesLabel: withSize(bucketNames.deleted, overview.deletedNotes.size),
        includeRevisions: INCLUDE_REVISIONS,
        getIcon: (noteId) => icons.get(noteId),
        // A cell's area covers the note's body and its attachments together; where attachments are
        // part of that, the line says how much, so a big cell is read for the right reason.
        makeSizeDetail: (size, attachmentsSize) => attachmentsSize > 0
            ? t("space_usage.cell_size_with_attachments", {
                size: formatSize(size),
                attachmentsSize: formatSize(attachmentsSize)
            })
            : t("space_usage.cell_size", { size: formatSize(size) })
    }), [ overview, bucketNames, icons ]);

    /**
     * What a cell answers a menu request with: the note menu, or, for the buckets that have anything
     * to offer, what can be done to the crowd they stand for. One builder for the two ways of asking,
     * a right-click on the cell and a tap on the strip naming it.
     */
    const menuFor = useCallback((item: TreemapItem<OverviewCell>) => {
        const bucket = item.data?.bucket;

        if (bucket === "deleted") {
            return (event: MouseEvent) => void openDeletedNotesContextMenu(event, onContentChanged);
        }

        if (bucket === "revisions") {
            return (event: MouseEvent) => void openRevisionsContextMenu(event, onContentChanged);
        }

        const notePath = item.data?.notePath;

        // The other two buckets stand for crowds nothing can be done to as a whole.
        if (bucket || !notePath?.length) {
            return undefined;
        }

        return (event: MouseEvent) =>
            void openSpaceUsageContextMenu(event, notePath, onShowDetails, onContentChanged);
    }, [ onShowDetails, onContentChanged ]);

    return (
        <div className="space-usage-overview">
            <Treemap<OverviewCell>
                root={model}
                selectedItemId={selectedMarkId}
                onItemClick={(item) => {
                    if (!onSelect) {
                        withCellPath(item, quickEditNote);
                        return;
                    }

                    // A tap names the cell rather than acting on it: the strip is where a touch
                    // screen reads what a pointer would have hovered.
                    const selection = selectionOf(item, bucketNames, menuFor(item));

                    if (selection) {
                        onSelect(selection);
                    }
                }}
                onItemContextMenu={(item, event) => menuFor(item)?.(event)}
            />
        </div>
    );
}

/**
 * What the strip says about a cell: the note it stands for, or the name of the crowd it stands for,
 * and the size its area encodes either way. A cell naming neither is not worth selecting.
 */
function selectionOf(
    item: TreemapItem<OverviewCell>,
    bucketNames: Record<NonNullable<OverviewCell["bucket"]>, string>,
    onActivate: ((event: MouseEvent) => void) | undefined
): SpaceUsageSelection | null {
    const bucket = item.data?.bucket;
    const notePath = item.data?.notePath;

    if (!bucket && !notePath?.length) {
        return null;
    }

    return {
        markId: item.id,
        ...(bucket ? { label: bucketNames[bucket] } : { notePath }),
        // The weight the cell was laid out with, which is what its area stands for.
        size: item.value ?? 0,
        onActivate,
        // The same the note answers a click with on a desktop, where no tap had to name it first.
        ...(notePath?.length && !bucket ? { onOpen: () => quickEditNote(notePath) } : {})
    };
}

/**
 * Batch-loads the icons the cells wear — one froca call for the whole ranking, not one per cell.
 * The map draws immediately and picks the icons up on the next render: an icon is an extra reading
 * of a cell, never something the layout should wait for.
 */
function useNoteIcons(overview: SpaceUsageOverviewResponse) {
    const [ icons, setIcons ] = useState(new Map<string, string>());

    useEffect(() => {
        let cancelled = false;

        // Silent: a note deleted since the usage was computed must not fail the whole view.
        void froca.getNotes(overview.notes.map((note) => note.noteId), true).then((notes) => {
            if (!cancelled) {
                setIcons(new Map(notes.map((note) => [ note.noteId, note.getIcon() ])));
            }
        });

        return () => {
            cancelled = true;
        };
    }, [ overview ]);

    return icons;
}

/**
 * "Other 1928 notes (512 MiB)" — the same "name (size)" wording the donut segments use, so a
 * bucket reads alike wherever it appears. Composed here rather than baked into the count keys,
 * which Browse reuses on its own and appends the size to itself.
 */
function withSize(name: string, size: number) {
    return t("space_usage.segment_tooltip", { title: name, size: formatSize(size) });
}

/** Runs an action on the cell's note, if it has one — the bucket cells stand for a crowd and stay inert. */
function withCellPath(item: TreemapItem<OverviewCell>, action: (notePath: string[]) => void) {
    const notePath = item.data?.notePath;

    if (notePath?.length) {
        action(notePath);
    }
}
