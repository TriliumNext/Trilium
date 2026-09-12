import "./note_usage_donut.css";

import type { SpaceUsageNoteResponse } from "@triliumnext/commons";
import clsx from "clsx";
import type { ComponentChildren } from "preact";
import { useMemo } from "preact/hooks";
import type React from "react";
import { Trans } from "react-i18next";

import { t } from "../../../services/i18n";
import { formatSize } from "../../../services/utils";
import DonutChart, { type DonutRing, type DonutSegment } from "../../react/charts/DonutChart";
import ContextualHelp from "../../react/ContextualHelp";
import { quickEditAttachment, quickEditNote } from "./context_menu";
import type { SpaceUsageSelection } from "./selection";
import {
    buildCompositionSegments,
    noteWeight,
    subtreeWeight,
    type UsageSegmentData,
    type UsageTooltipKind
} from "./donut_segments";

export const COMPOSITION_RING_RADIUS = 133;
/** Half the children ring's: the note's own breakdown reads as the quieter, supporting ring. */
export const COMPOSITION_RING_THICKNESS = 23;

interface NoteUsageDonutProps {
    usage: SpaceUsageNoteResponse;
    /** Shown in the hole; links to the note and carries its preview tooltip. */
    title: string;
    /** Note IDs from the root (inclusive) down to the note, for the center link and its tooltip. */
    notePath: string[];
    /** Extra rings drawn around the composition ring, e.g. Browse's children ring. */
    outerRings?: DonutRing<UsageSegmentData>[];
    /** The segment drawn as chosen, in any of the rings. See {@link onSelectSegment}. */
    selectedSegmentId?: string;
    /**
     * Where given, a click on a composition segment names it in the page's strip instead of opening
     * what it stands for: how a touch screen, which cannot hover a segment, reads the ring.
     */
    onSelectSegment?: (selection: SpaceUsageSelection) => void;
    /** Rendered centered above the title in the hole — e.g. Browse's back button. */
    centerActions?: ComponentChildren;
    /** Right-clicking the center title, which stands for the note itself. */
    onTitleContextMenu?: (event: MouseEvent) => void;
    className?: string;
}

/**
 * The composition donut of a single note — its body (blue) and each attachment (yellow) as ring
 * segments, the note's name and the totals in the hole. The name is a live note link: it opens the
 * note in the quick-edit popup, which stacks over the settings page rather than replacing what the
 * user was reading. Reusable wherever one note's usage needs breaking down; Browse wraps it with
 * its children ring via {@link outerRings}, which is also where history is drawn.
 */
export default function NoteUsageDonut({
    usage, title, notePath, outerRings = [], selectedSegmentId, onSelectSegment, centerActions,
    onTitleContextMenu, className
}: NoteUsageDonutProps) {
    const compositionRing: DonutRing<UsageSegmentData> = useMemo(() => ({
        id: "composition",
        radius: COMPOSITION_RING_RADIUS,
        thickness: COMPOSITION_RING_THICKNESS,
        segments: buildCompositionSegments(usage, {
            bodyLabel: t("space_usage.note_body"),
            makeTooltip: segmentTooltip,
            makeOthersTooltip: (count, size) =>
                t("space_usage.others_attachments", { count, size: formatSize(size) })
        }),
        // Every segment here stands for something the popup can show: the body is the note itself,
        // each other segment one of its attachments. The consolidated "Others" bucket stands for
        // several at once, so it opens nothing.
        onSegmentClick: (segment) => {
            if (onSelectSegment) {
                const selection = selectionOf(segment, notePath, onTitleContextMenu);

                if (selection) {
                    onSelectSegment(selection);
                }

                return;
            }

            if (segment.data?.attachmentId) {
                quickEditAttachment(notePath, segment.data.attachmentId);
            } else if (segment.data?.noteId) {
                quickEditNote(notePath);
            }
        }
    }), [ usage, notePath, onSelectSegment, onTitleContextMenu ]);


    return (
        <DonutChart<UsageSegmentData>
            rings={[ compositionRing, ...outerRings ]}
            selectedSegmentId={selectedSegmentId}
            className={clsx("note-usage-donut", className)}
            defs={<RevisionsHatch />}
        >
            {centerActions}
            <a
                className="note-usage-donut-title"
                // `?popup` is the app's own quick-edit link form, so the markup advertises what the
                // click does — and a copied link opens the same way anywhere else.
                href={`#${notePath.join("/")}?popup`}
                onClick={(event) => {
                    // Handled here: default hash navigation would swap the settings page itself,
                    // and the dialog's link interception must not double-handle it.
                    event.preventDefault();
                    event.stopPropagation();
                    quickEditNote(notePath);
                }}
                onContextMenu={onTitleContextMenu}
            >{title}</a>
            {/* Each line is the total of what surrounds it, so the hole reads as the rings' legend,
                and each carries an icon saying which part of the chart it adds up. */}
            <div className="note-usage-donut-sizes">
                {/* The bracketed figure is the deduplicated one: what the note or subtree really
                    costs on disk, which the drawn per-entity totals overstate wherever content is
                    shared. Revisions need no such aside — their line already draws that figure. */}
                <SizeLine
                    i18nKey="space_usage.center_note_size"
                    help={t("space_usage.center_note_size_help", { size: formatSize(usage.noteContentSize) })}
                    size={noteWeight(usage)}
                />
                <SizeLine
                    i18nKey="space_usage.center_revisions_size"
                    help={t("space_usage.center_revisions_help")}
                    size={usage.subtreeRevisionsContentSize}
                />
                <SizeLine
                    i18nKey="space_usage.center_subtree_size"
                    help={t("space_usage.center_subtree_size_help", { size: formatSize(usage.subtreeContentSize) })}
                    size={subtreeWeight(usage)}
                />
            </div>
        </DonutChart>
    );
}

/**
 * What the strip says about a composition segment: the note itself for its body, which answers the
 * same menu as the center title standing for it, and the attachment for one of its own, which the
 * popup can show. "Others" stands for several attachments at once and answers nothing.
 *
 * None of them carries an {@link SpaceUsageSelection.onOpen}: this ring is only ever selected from
 * where a tap has to stand in for a hover, and a mark there opens something only where the opening is
 * a move within the chart. Walking into a child is that; throwing a popup over the chart from a
 * second tap on a segment is not, so the segments name themselves and leave it at that.
 */
function selectionOf(
    segment: DonutSegment<UsageSegmentData>,
    notePath: string[],
    onTitleContextMenu: ((event: MouseEvent) => void) | undefined
): SpaceUsageSelection | null {
    const attachmentId = segment.data?.attachmentId;

    if (attachmentId) {
        return {
            markId: segment.id,
            label: segment.label ?? "",
            size: segment.value,
            onActivate: () => quickEditAttachment(notePath, attachmentId)
        };
    }

    if (segment.data?.noteId) {
        return {
            markId: segment.id,
            notePath,
            size: segment.value,
            onActivate: onTitleContextMenu
        };
    }

    return null;
}

/**
 * The hatch the revisions segment is stroked with — history reads as the same gray as everything
 * else that is not live content, textured so it is told apart from a note at a glance.
 *
 * A stroke can only reach a pattern through `url(#id)`, which forces a document-wide ID. Two donuts
 * on one page would therefore both resolve to the first — harmless here, since the pattern carries
 * no per-instance state and every copy is identical.
 */
function RevisionsHatch() {
    return (
        <pattern
            id="space-usage-revisions-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
        >
            <rect className="space-usage-hatch-base" width="6" height="6" />
            <line className="space-usage-hatch-stripe" x1="0" y1="0" x2="0" y2="6" />
        </pattern>
    );
}

/**
 * One labelled center line, the value emphasized, with the app's tooltip explaining what the figure
 * covers. `<Trans>` lets translations put the value wherever their wording needs it.
 */
function SizeLine({ i18nKey, help, size }: { i18nKey: string, help: string, size: number }) {
    return (
        <span className="note-usage-donut-size">
            <Trans
                i18nKey={i18nKey}
                components={{
                    Size: <span className="note-usage-donut-size-value">{formatSize(size)}</span> as React.ReactElement
                }}
            />
            <ContextualHelp helpMessage={help} />
        </span>
    );
}

/** "Title (1.2 MiB)", prefixed with its case ("Attachment: ", "Child note: ") where one applies. */
export function segmentTooltip(kind: UsageTooltipKind, title: string, size: number) {
    const key = kind === "attachment" ? "space_usage.attachment_tooltip"
        : kind === "child" ? "space_usage.child_tooltip"
            : kind === "revisions" ? "space_usage.revisions_tooltip"
                : "space_usage.segment_tooltip";

    return t(key, { title, size: formatSize(size) });
}
