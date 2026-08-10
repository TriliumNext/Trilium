import type { SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { useEffect, useMemo, useState } from "preact/hooks";

import froca from "../../../../../services/froca";
import { t } from "../../../../../services/i18n";
import { formatSize } from "../../../../../services/utils";
import Treemap, { type TreemapItem } from "../../../../react/charts/Treemap";
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

/**
 * A cell's area covers a note's body and attachments, leaving history out; its tooltip says the
 * same. Per-note revision sizes are counted per entity rather than deduplicated, so a revision
 * snapshotting an unchanged body reports its full size while costing the database nothing — folding
 * that into the areas would inflate cells by bytes that were never spent.
 */
const INCLUDE_REVISIONS = false;

interface OverviewProps {
    overview: SpaceUsageOverviewResponse;
    onShowDetails: ShowDetailsHandler;
    /** Called once the menu deleted something, so the map stops drawing what is no longer there. */
    onContentChanged: ContentChangedHandler;
}

/** The treemap over the whole database: every large note at its tree location. */
export default function Overview({ overview, onShowDetails, onContentChanged }: OverviewProps) {
    const icons = useNoteIcons(overview);

    // The labels are formatted here rather than in the model, which stays free of i18n: a bucket
    // stands for a crowd, so its tooltip names how many notes it holds and how much they take.
    const model = useMemo(() => buildOverviewModel(overview, {
        otherNotesLabel: withSize(
            t("space_usage.other_notes", { count: overview.otherNotes.noteCount }),
            bucketWeight(overview.otherNotes, INCLUDE_REVISIONS)
        ),
        hiddenNotesLabel: withSize(
            t("space_usage.hidden_notes", { count: overview.hiddenNotes.noteCount }),
            bucketWeight(overview.hiddenNotes, INCLUDE_REVISIONS)
        ),
        // Not a crowd of notes but a tier of content, so it names itself rather than a count — and
        // the figure is the deduplicated one the status line quotes, which is what its cell draws.
        revisionsLabel: withSize(t("space_usage.revisions"), overview.content.revisionsSize),
        deletedNotesLabel: withSize(deletedEntitiesLabel(overview.deletedNotes), overview.deletedNotes.size),
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
    }), [ overview, icons ]);

    return (
        <div className="space-usage-overview">
            <Treemap<OverviewCell>
                root={model}
                onItemClick={(item) => withCellPath(item, quickEditNote)}
                onItemContextMenu={(item, event) => {
                    // The buckets name no note, so those with something to offer answer with what
                    // can be done to the crowd they stand for rather than with the note menu.
                    if (item.data?.bucket === "deleted") {
                        void openDeletedNotesContextMenu(event, onContentChanged);
                        return;
                    }

                    if (item.data?.bucket === "revisions") {
                        void openRevisionsContextMenu(event, onContentChanged);
                        return;
                    }

                    withCellPath(item, (notePath) =>
                        void openSpaceUsageContextMenu(event, notePath, onShowDetails, onContentChanged));
                }}
            />
        </div>
    );
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
