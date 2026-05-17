import { Fragment } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import type NoteContext from "../../components/note_context";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import { useTriliumEvents } from "../react/hooks";

interface SegmentData {
    ntxId: string;
    title: string;
    iconClass: string;
}

interface TabProps {
    ntxId: string;
}

function getShowNoteIcons() {
    return window.getComputedStyle(document.documentElement).getPropertyValue("--tab-note-icons") === "true";
}

function resolveIcon(noteContext: NoteContext, showNoteIcons: boolean): string {
    const { note } = noteContext;
    if (note && showNoteIcons) {
        return note.getIcon();
    }
    const hoistedNote = froca.getNoteFromCache(noteContext.hoistedNoteId);
    if (hoistedNote) {
        return hoistedNote.getWorkspaceIconClass();
    }
    return "";
}

async function buildSegment(noteContext: NoteContext, showNoteIcons: boolean): Promise<SegmentData> {
    const { note } = noteContext;
    const title = note
        ? (await noteContext.getNavigationTitle()) ?? note.title ?? t("tab_row.new_tab")
        : t("tab_row.new_tab");
    const iconClass = resolveIcon(noteContext, showNoteIcons);
    return { ntxId: noteContext.ntxId!, title, iconClass };
}

export default function Tab({ ntxId }: TabProps) {
    const [segments, setSegments] = useState<SegmentData[]>([{ ntxId, title: t("tab_row.new_tab"), iconClass: "" }]);
    const [activeNtxId, setActiveNtxId] = useState<string | null>(null);

    const refreshSegments = useCallback(async () => {
        const mainContext = appContext.tabManager.getNoteContextById(ntxId);
        if (!mainContext) return;

        const showNoteIcons = getShowNoteIcons();
        const subContexts = mainContext.getSubContexts();
        const newSegments = await Promise.all(
            subContexts.map((ctx) => buildSegment(ctx, showNoteIcons))
        );
        setSegments(newSegments);
    }, [ntxId]);

    const refreshActiveSegment = useCallback(() => {
        const activeContext = appContext.tabManager.getActiveContext();
        setActiveNtxId(activeContext?.ntxId ?? null);
    }, []);

    // Initial load
    useEffect(() => {
        refreshSegments();
        refreshActiveSegment();
    }, [refreshSegments, refreshActiveSegment]);

    // React to split additions/removals
    useTriliumEvents(["newNoteContextCreated", "noteContextRemoved"], useCallback(() => {
        refreshSegments();
    }, [refreshSegments]));

    // React to note switches and active context changes
    useTriliumEvents(["noteSwitched", "noteSwitchedAndActivated", "activeContextChanged"], useCallback(() => {
        refreshSegments();
        refreshActiveSegment();
    }, [refreshSegments, refreshActiveSegment]));

    // React to entity changes (title, icon updates)
    useTriliumEvents(["entitiesReloaded", "frocaReloaded"], useCallback(() => {
        refreshSegments();
    }, [refreshSegments]));

    const hasSplits = segments.length > 1;

    const onSegmentClick = (e: MouseEvent, segmentNtxId: string) => {
        e.stopPropagation();
        appContext.tabManager.activateNoteContext(segmentNtxId);
    };

    return (
        <div className={`note-tab${hasSplits ? " note-tab-split" : ""}`} data-ntx-id={ntxId}>
            <div className="note-tab-wrapper">
                <div className="note-tab-drag-handle" />
                {segments.map((segment, index) => (
                    <Fragment key={segment.ntxId}>
                        {index > 0 && <div className="note-tab-separator" />}
                        <div
                            className="note-tab-segment"
                            data-ntx-id={segment.ntxId}
                            active={activeNtxId === segment.ntxId ? "" : undefined}
                            title={segment.title}
                            onClick={(e) => onSegmentClick(e, segment.ntxId)}
                        >
                            <div className={`note-tab-icon${segment.iconClass ? ` ${segment.iconClass}` : ""}`} />
                            <div className="note-tab-title">{segment.title}</div>
                        </div>
                    </Fragment>
                ))}
                <div className="note-tab-close bx bx-x" title={t("tab_row.close_tab")} />
            </div>
        </div>
    );
}
