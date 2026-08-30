import "./index.css";

import type { SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { formatSize, isMobile } from "../../../services/utils";
import ActionButton from "../../react/ActionButton";
import { useElementSize, useStaticTooltip } from "../../react/hooks";
import SegmentedChoice from "../../react/SegmentedChoice";
import { useFetch } from "../../react/use_fetch";
import Browse from "./browse";
import { showCleanupDialog } from "./cleanup_dialog";
import Overview from "./overview";
import SpaceUsagePlaceholder from "./placeholder";
import SelectionStrip, { type SpaceUsageSelection } from "./selection";

/** Matches the server default; the treemap could not label more cells anyway. */
const OVERVIEW_LIMIT = 500;

/**
 * What a phone gets instead: the charts keep a selection, named by the strip along the foot of the
 * page, since a touch screen has no way to ask what a cell or a segment is; and the totals are a grid
 * of figures rather than the line of sentences there is no width for. A pointer needs neither and
 * keeps its hover, its right-click and its status line. Read once, as the app's other phone branches
 * do.
 */
const IS_MOBILE = isMobile();

type SpaceUsageView = "overview" | "browse";

export default function SpaceUsage() {
    const [ view, setView ] = useState<SpaceUsageView>("overview");
    // Bumped by the refresh button. Both views read it, so one press re-measures whatever is on
    // screen; a number rather than a callback, which would change identity on every render here and
    // have the views re-measuring the database continuously.
    const [ refreshToken, setRefreshToken ] = useState(0);
    // Stable, so handing it to the views costs them nothing on re-render.
    const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);
    // Browse measures its own note through a separate request, which this component would not
    // otherwise know about; without it the button would free up while that reading was still running.
    const [ browseLoading, setBrowseLoading ] = useState(false);
    // Browse's position lives here so that "Show details", offered on any note either view draws,
    // can land the user on that note — switching the view along the way when it comes from Overview.
    const [ browsePath, setBrowsePath ] = useState([ "root" ]);
    // The chosen mark, of whichever chart is on show: the strip naming it belongs to the page, and
    // both views fill the same one.
    const [ selection, setSelection ] = useState<SpaceUsageSelection | null>(null);
    // The first tap names the mark; a second on the same one opens it, which is how a touch screen
    // gets both without a gesture to guess at. A mark with nothing to open lets go instead, which is
    // also what puts the strip back to its hint without something else having to be picked.
    const select = useCallback((next: SpaceUsageSelection) => setSelection((current) => {
        if (current?.markId !== next.markId) {
            return next;
        }

        next.onOpen?.();

        return next.onOpen ? current : null;
    }), []);
    // A selection stands for a mark on the chart in front of the user: switching views, walking to
    // another note, or taking a fresh reading each leave it naming something that is no longer drawn.
    useEffect(() => setSelection(null), [ view, browsePath, refreshToken ]);
    // The strip is measured rather than guessed at: the map is given exactly its height as room to
    // scroll clear of it, and how tall it stands depends on the theme's own text size.
    const stripRef = useRef<HTMLDivElement>(null);
    const stripSize = useElementSize(stripRef);
    const showDetails = useCallback((notePath: string[]) => {
        setBrowsePath(notePath);
        setView("browse");
    }, []);
    // Kept fetched across both views so returning to the treemap draws immediately rather than
    // blanking. Revisions stay out of the ranking so it shares the basis of the areas the treemap
    // draws — asking for one basis and drawing the other would rank in notes the cells then shrink.
    const { data: overview, failed, loading } = useFetch<SpaceUsageOverviewResponse>(
        `space-usage/overview?limit=${OVERVIEW_LIMIT}`, refreshToken);

    return (
        <div
            className="space-usage-page"
            // Measured at runtime, so it cannot be a stylesheet value; the map reads it as the room
            // it leaves below itself (see the stylesheet).
            style={stripSize ? { "--space-usage-strip-height": `${stripSize.height}px` } : undefined}
        >
            {/* Above the views rather than in the note's own title row, so the controls stay put as
                whichever view is on show is redrawn beneath them. */}
            <div className="space-usage-toolbar">
                <SegmentedChoice
                    className="space-usage-view-choice"
                    options={VIEWS}
                    currentValue={view}
                    onChange={setView}
                />
                {/* Boxicons ships no broom; the brush is the nearest thing it has. The charts
                    re-measure once the dialog is done, having just been made wrong by it. */}
                <ActionButton
                    className="space-usage-cleanup"
                    icon="bx bx-brush-alt"
                    text={t("space_usage.cleanup_title")}
                    onClick={() => void showCleanupDialog().then((reclaimed) => {
                        if (reclaimed !== null) {
                            refresh();
                        }
                    })}
                />
                {/* Measuring is expensive, so a reading is taken when asked for rather than kept
                    live — and the button stays out while one is being taken. */}
                <ActionButton
                    className="space-usage-refresh"
                    icon="bx bx-refresh"
                    text={t("space_usage.refresh")}
                    disabled={loading || browseLoading}
                    onClick={refresh}
                />
            </div>

            {view === "browse" && (
                <Browse
                    path={browsePath}
                    onPathChange={setBrowsePath}
                    refreshToken={refreshToken}
                    onContentChanged={refresh}
                    selection={selection}
                    onSelect={IS_MOBILE ? select : undefined}
                    onLoadingChange={setBrowseLoading}
                />
            )}
            {view === "overview" && (overview
                ? <Overview
                    overview={overview}
                    selectedMarkId={selection?.markId}
                    onSelect={IS_MOBILE ? select : undefined}
                    onShowDetails={showDetails}
                    onContentChanged={refresh}
                />
                : <SpaceUsagePlaceholder failed={failed} />)}

            {/* Overview only: these are whole-database totals, and beside a single note's donut
                they would read as being about that note. */}
            {view === "overview" && overview && (IS_MOBILE
                ? <StatusGrid overview={overview} />
                : <footer className="space-usage-status">
                    <StatusEntry
                        // Revisions are left out: they carry their own cell on the map, which names
                        // their size, so repeating it here would only lengthen the line.
                        text={t("space_usage.status_content", {
                            count: overview.content.noteCount,
                            size: formatSize(overview.content.size),
                            attachmentsSize: formatSize(overview.content.attachmentsSize)
                        })}
                        hint={t("space_usage.status_content_hint")}
                    />
                    <span className="space-usage-status-separator" aria-hidden="true">•</span>
                    <StatusEntry
                        // Named rather than counted: the counts belong to the map's own cell, whose
                        // label carries them, and spelling them out here made the line unreadable.
                        text={t("space_usage.status_deleted", {
                            size: formatSize(overview.deletedNotes.size)
                        })}
                        hint={t("space_usage.status_deleted_hint")}
                    />
                </footer>)}

            {/* Kept on show with nothing chosen as well, so the map is laid out with room for it
                from the start and a tap always has somewhere to report to. */}
            {IS_MOBILE && <SelectionStrip selection={selection} containerRef={stripRef} />}
        </div>
    );
}

/**
 * One figure of the status line, with the app's tooltip explaining how it is measured — the
 * distinctions between the figures (deduplicated vs per entity, what each covers) are worth a
 * sentence, but not one taking up the bar itself.
 */
function StatusEntry({ text, hint }: { text: string, hint: string }) {
    const ref = useRef<HTMLSpanElement>(null);
    // The page's own chart tooltips ride the app's "above everything" layer (see chart_tooltip);
    // the line joins them, so a hint opened here is not covered by one drifting down from the map.
    useStaticTooltip(ref, useMemo(
        () => ({ title: hint, placement: "top", customClass: "tooltip-top" }),
        [ hint ]
    ));

    return <span ref={ref}>{text}</span>;
}

/**
 * The whole-database totals as a grid of figures: the same numbers the status line carries as
 * sentences, in the shape a phone has the width for. Every figure is at rest, so each is formatted to
 * read rather than to hold still under a counter.
 */
function StatusGrid({ overview }: { overview: SpaceUsageOverviewResponse }) {
    const { content, deletedNotes } = overview;

    return (
        // The outer element is nothing but the container the row measures itself against: an element
        // cannot answer its own container query, so what changes shape has to sit inside what is
        // being measured.
        <div className="space-usage-status-figures">
            <div className="space-usage-status-grid">
                <StatusFigure
                    label={t("space_usage.status_notes")}
                    value={content.noteCount.toLocaleString()}
                />
                <StatusFigure
                    label={t("space_usage.status_total")}
                    value={formatSize(content.size)}
                />
                {/* Part of the total beside it rather than another slice of the database: what the
                    notes counted above carry along with their own bodies. */}
                <StatusFigure
                    label={t("space_usage.status_attachments")}
                    value={formatSize(content.attachmentsSize)}
                />
                <StatusFigure
                    label={t("space_usage.status_deleted_items")}
                    value={formatSize(deletedNotes.size)}
                />
            </div>
        </div>
    );
}

/** One cell of it: what is being counted, small and quiet, over the figure that is the point of it. */
function StatusFigure({ label, value }: { label: string, value: string }) {
    return (
        <div className="space-usage-status-cell">
            <span className="space-usage-status-label">{label}</span>
            <span className="space-usage-status-value">{value}</span>
        </div>
    );
}

const VIEWS: { value: SpaceUsageView, label: string }[] = [
    { value: "overview", label: t("space_usage.view_overview") },
    { value: "browse", label: t("space_usage.view_browse") }
];
