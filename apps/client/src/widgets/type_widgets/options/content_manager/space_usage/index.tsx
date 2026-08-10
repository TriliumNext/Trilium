import "./index.css";

import type { SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { useCallback, useMemo, useRef, useState } from "preact/hooks";

import { t } from "../../../../../services/i18n";
import { formatSize } from "../../../../../services/utils";
import ActionButton from "../../../../react/ActionButton";
import { useStaticTooltip } from "../../../../react/hooks";
import SegmentedChoice from "../../../../react/SegmentedChoice";
import { useFetch } from "../../../../react/use_fetch";
import OptionsPageHeader from "../../components/OptionsPageHeader";
import type { ContentManagerSectionProps } from "../index";
import Browse from "./browse";
import { showCleanupDialog } from "./cleanup_dialog";
import Overview from "./overview";
import SpaceUsagePlaceholder from "./placeholder";

/** Matches the server default; the treemap could not label more cells anyway. */
const OVERVIEW_LIMIT = 500;

type SpaceUsageView = "overview" | "browse";

export default function SpaceUsage({ sectionSwitcher }: ContentManagerSectionProps) {
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
        <div className="space-usage-section">
            <OptionsPageHeader actions={sectionSwitcher} below={
                <div className="space-usage-toolbar">
                    <SegmentedChoice
                        className="content-manager-view-choice"
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
                    {/* Measuring is expensive, so a reading is taken when asked for rather than
                        kept live — and the button stays out while one is being taken. */}
                    <ActionButton
                        className="space-usage-refresh"
                        icon="bx bx-refresh"
                        text={t("space_usage.refresh")}
                        disabled={loading || browseLoading}
                        onClick={refresh}
                    />
                </div>
            } />

            {view === "browse" && (
                <Browse
                    path={browsePath}
                    onPathChange={setBrowsePath}
                    refreshToken={refreshToken}
                    onContentChanged={refresh}
                    onLoadingChange={setBrowseLoading}
                />
            )}
            {view === "overview" && (overview
                ? <Overview overview={overview} onShowDetails={showDetails} onContentChanged={refresh} />
                : <SpaceUsagePlaceholder failed={failed} />)}

            {/* Overview only: these are whole-database totals, and beside a single note's donut
                they would read as being about that note. */}
            {view === "overview" && overview && (
                <footer className="space-usage-status">
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
                </footer>
            )}
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
    // `tooltip-top` is the app's "above everything" layer, which the status line needs: the content
    // manager's own active-content overlay stands above the base tooltip layer.
    useStaticTooltip(ref, useMemo(
        () => ({ title: hint, placement: "top", customClass: "tooltip-top" }),
        [ hint ]
    ));

    return <span ref={ref}>{text}</span>;
}

const VIEWS: { value: SpaceUsageView, label: string }[] = [
    { value: "overview", label: t("space_usage.view_overview") },
    { value: "browse", label: t("space_usage.view_browse") }
];
