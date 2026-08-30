import type { SpaceUsageNoteResponse } from "@triliumnext/commons";

import type { DonutSegment } from "../../react/charts/DonutChart";
import { hueOf } from "./overview_model";

/** What a donut segment stands for; the bucket segments ("others", "deleted") name neither. */
export interface UsageSegmentData {
    noteId?: string;
    attachmentId?: string;
}

/**
 * Which wording a segment's tooltip gets: a plain label, one prefixed with its case, or the
 * revisions one — whose label carries parentheses of its own, so its size cannot follow in another
 * pair.
 */
export type UsageTooltipKind = "plain" | "attachment" | "child" | "revisions";

type MakeTooltip = (kind: UsageTooltipKind, title: string, size: number) => string;

/** Composition segments smaller than this share of the ring consolidate into "Others". */
export const MIN_COMPOSITION_SEGMENT_FRACTION = 0.02;

/** Child segments smaller than this share of the ring consolidate into "Others". */
export const MIN_CHILD_SEGMENT_FRACTION = 0.005;

type MakeOthersTooltip = (count: number, size: number) => string;

interface CompositionOptions {
    bodyLabel: string;
    makeTooltip: MakeTooltip;
    makeOthersTooltip: MakeOthersTooltip;
}

/**
 * The composition ring of a single note: its body and each attachment on its own, attachments
 * largest-first. Empty components are dropped, and segments too small to see consolidate into a
 * trailing "Others".
 *
 * History is deliberately absent: it belongs to the whole subtree rather than to this note alone,
 * so the children ring carries it for every note at once (see {@link buildChildrenSegments}).
 */
export function buildCompositionSegments(
    usage: SpaceUsageNoteResponse,
    { bodyLabel, makeTooltip, makeOthersTooltip }: CompositionOptions
): DonutSegment<UsageSegmentData>[] {
    const segments: DonutSegment<UsageSegmentData>[] = [];

    if (usage.ownSize > 0) {
        segments.push({
            id: "body",
            value: usage.ownSize,
            className: "space-usage-segment-body",
            label: bodyLabel,
            tooltip: makeTooltip("plain", bodyLabel, usage.ownSize),
            data: { noteId: usage.noteId }
        });
    }

    const attachments = [ ...usage.attachments ]
        .filter((attachment) => attachment.size > 0)
        .sort((a, b) => b.size - a.size || a.attachmentId.localeCompare(b.attachmentId));

    for (const attachment of attachments) {
        segments.push({
            id: `attachment/${attachment.attachmentId}`,
            value: attachment.size,
            className: "space-usage-segment-attachment",
            label: attachment.title,
            tooltip: makeTooltip("attachment", attachment.title, attachment.size),
            data: { attachmentId: attachment.attachmentId }
        });
    }

    return consolidateSmallSegments(segments, MIN_COMPOSITION_SEGMENT_FRACTION, makeOthersTooltip);
}

interface ChildrenOptions {
    getTitle: (noteId: string) => string;
    revisionsLabel: string;
    deletedNotesLabel: string;
    makeTooltip: MakeTooltip;
    makeOthersTooltip: MakeOthersTooltip;
}

/**
 * The children ring: each child weighted by its whole subtree, largest first, tinted by its own
 * "random" stable hue. Slivers consolidate into "Others"; the subtree's history then closes the
 * ring, and on the root the deleted-notes bucket follows it — neither is ever folded away.
 *
 * Child weights leave history out, so one revisions segment stands for all of it at once. Like the
 * deleted bucket beside it, that segment is a deduplicated reclaimable figure rather than a
 * comparable per-entity one — which is why neither is tinted, clickable, or foldable into "Others".
 */
export function buildChildrenSegments(
    usage: SpaceUsageNoteResponse,
    { getTitle, revisionsLabel, deletedNotesLabel, makeTooltip, makeOthersTooltip }: ChildrenOptions
): DonutSegment<UsageSegmentData>[] {
    const children = [ ...usage.children ]
        .filter((child) => child.subtreeSize > 0)
        .sort((a, b) => b.subtreeSize - a.subtreeSize || a.noteId.localeCompare(b.noteId))
        .map((child) => ({
            id: `child/${child.noteId}`,
            value: child.subtreeSize,
            hue: hueOf(child.noteId),
            label: getTitle(child.noteId),
            tooltip: makeTooltip("child", getTitle(child.noteId), child.subtreeSize),
            data: { noteId: child.noteId }
        }));

    const segments = consolidateSmallSegments(children, MIN_CHILD_SEGMENT_FRACTION, makeOthersTooltip);
    const revisionsSize = usage.subtreeRevisionsContentSize;

    if (revisionsSize > 0) {
        segments.push({
            id: "revisions",
            value: revisionsSize,
            className: "space-usage-segment-revisions",
            label: revisionsLabel,
            tooltip: makeTooltip("revisions", revisionsLabel, revisionsSize)
        });
    }

    if (usage.deletedNotes && usage.deletedNotes.size > 0) {
        segments.push({
            id: "/deleted-notes",
            value: usage.deletedNotes.size,
            className: "space-usage-segment-deleted",
            label: deletedNotesLabel,
            tooltip: makeTooltip("plain", deletedNotesLabel, usage.deletedNotes.size),
            data: {}
        });
    }

    return segments;
}

/** What the composition ring sums to: the note's body and its attachments, history excluded. */
export function noteWeight(usage: SpaceUsageNoteResponse) {
    return usage.ownSize + usage.attachmentsSize;
}

/**
 * What the composition ring and the children ring's child segments sum to together — the subtree
 * without its history, which the ring keeps as a segment of its own.
 */
export function subtreeWeight(usage: SpaceUsageNoteResponse) {
    return usage.children.reduce((sum, child) => sum + child.subtreeSize, noteWeight(usage));
}

/** Replaces the segments below the given share of the ring's total with one inert "N more (size)". */
function consolidateSmallSegments(
    segments: DonutSegment<UsageSegmentData>[],
    minFraction: number,
    makeOthersTooltip: MakeOthersTooltip
): DonutSegment<UsageSegmentData>[] {
    const total = segments.reduce((sum, segment) => sum + segment.value, 0);

    if (total <= 0) {
        return segments;
    }

    const kept: DonutSegment<UsageSegmentData>[] = [];
    let othersSize = 0;
    let othersCount = 0;

    for (const segment of segments) {
        if (segment.value / total >= minFraction) {
            kept.push(segment);
        } else {
            othersSize += segment.value;
            othersCount++;
        }
    }

    if (othersSize > 0) {
        kept.push({
            id: "others",
            value: othersSize,
            className: "space-usage-segment-others",
            tooltip: makeOthersTooltip(othersCount, othersSize),
            data: {}
        });
    }

    return kept;
}
