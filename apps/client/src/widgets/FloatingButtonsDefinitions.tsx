import "./Backlinks.css";

import { BacklinkCountResponse, BacklinksResponse } from "@triliumnext/commons";
import { VNode } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { EventData, EventNames } from "../components/app_context";
import NoteContext from "../components/note_context";
import FNote from "../entities/fnote";
import attributes from "../services/attributes";
import froca from "../services/froca";
import { t } from "../services/i18n";
import { getHelpUrlForNote } from "../services/in_app_help";
import LoadResults from "../services/load_results";
import { sanitizeNoteContentHtml } from "../services/sanitize_content";
import server from "../services/server";
import { openInAppHelpFromUrl } from "../services/utils";
import ActionButton, { ActionButtonProps } from "./react/ActionButton";
import { useTriliumEvent, useWindowSize } from "./react/hooks";
import NoItems from "./react/NoItems";
import NoteLink from "./react/NoteLink";
import RawHtml from "./react/RawHtml";

export interface FloatingButtonContext {
    note: FNote;
    noteContext: NoteContext;
    isDefaultViewMode: boolean;
    /** Shorthand for triggering an event from the parent component. The `ntxId` is automatically handled for convenience. */
    triggerEvent<T extends EventNames>(name: T, data?: Omit<EventData<T>, "ntxId">): void;
}

function FloatingButton({ className, ...props }: ActionButtonProps) {
    return <ActionButton
        className={`floating-button ${className ?? ""}`}
        noIconActionClass
        {...props}
    />;
}

export type FloatingButtonsList = ((context: FloatingButtonContext) => false | VNode)[];

export const DESKTOP_FLOATING_BUTTONS: FloatingButtonsList = [
    ExportSpreadsheetButton,
    InAppHelpButton,
    Backlinks
];

/**
 * Floating buttons that should be hidden in popup editor (Quick edit).
 */
export const POPUP_HIDDEN_FLOATING_BUTTONS: FloatingButtonsList = [
    InAppHelpButton
];

function ExportSpreadsheetButton({ note, triggerEvent, isDefaultViewMode }: FloatingButtonContext) {
    const isEnabled = note?.type === "spreadsheet" && note?.isContentAvailable() && isDefaultViewMode;
    return isEnabled && (
        <>
            <FloatingButton
                icon="bx bxs-spreadsheet"
                text={t("spreadsheet.export-xlsx")}
                onClick={() => triggerEvent("exportXlsx")}
            />
            <FloatingButton
                icon="bx bxs-spreadsheet"
                text={t("spreadsheet.export-csv")}
                onClick={() => triggerEvent("exportCsv")}
            />
        </>
    );
}

function InAppHelpButton({ note }: FloatingButtonContext) {
    const helpUrl = getHelpUrlForNote(note);
    const isEnabled = note.type !== "book" && !!helpUrl;

    return isEnabled && (
        <FloatingButton
            icon="bx bx-help-circle"
            text={t("help-button.title")}
            onClick={() => helpUrl && openInAppHelpFromUrl(helpUrl)}
        />
    );
}

function Backlinks({ note, isDefaultViewMode }: FloatingButtonContext) {
    const [ popupOpen, setPopupOpen ] = useState(false);
    const backlinksContainerRef = useRef<HTMLDivElement>(null);
    const backlinkCount = useBacklinkCount(note, isDefaultViewMode);

    // Determine the max height of the container.
    const { windowHeight } = useWindowSize();
    useLayoutEffect(() => {
        const el = backlinksContainerRef.current;
        if (popupOpen && el) {
            const box = el.getBoundingClientRect();
            const maxHeight = windowHeight - box.top - 10;
            el.style.maxHeight = `${maxHeight}px`;
        }
    }, [ popupOpen, windowHeight ]);

    const isEnabled = isDefaultViewMode && backlinkCount > 0;
    return (isEnabled &&
        <div className="backlinks-widget has-overflow">
            <div
                className="backlinks-ticker"
                onClick={() => setPopupOpen(!popupOpen)}
            >
                <span className="backlinks-count">{t("zpetne_odkazy.backlink", { count: backlinkCount })}</span>
            </div>

            {popupOpen && (
                <div ref={backlinksContainerRef} className="backlinks-items dropdown-menu" style={{ display: "block" }}>
                    <BacklinksList note={note} />
                </div>
            )}
        </div>
    );
}

export function useBacklinkCount(note: FNote | null | undefined, isDefaultViewMode: boolean) {
    const [ backlinkCount, setBacklinkCount ] = useState(0);

    const refresh = useCallback(() => {
        if (!note || !isDefaultViewMode) return;

        server.get<BacklinkCountResponse>(`note-map/${note.noteId}/backlink-count`).then(resp => {
            setBacklinkCount(resp.count);
        });
    }, [ isDefaultViewMode, note ]);

    useEffect(() => refresh(), [ refresh ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (note && needsRefresh(note, loadResults)) refresh();
    });

    return backlinkCount;
}

export function BacklinksList({ note }: { note: FNote }) {
    const [ backlinks, setBacklinks ] = useState<BacklinksResponse>();

    function refresh() {
        server.get<BacklinksResponse>(`note-map/${note.noteId}/backlinks`).then(async (backlinks) => {
            // prefetch all
            const noteIds = backlinks
                .filter(bl => "noteId" in bl)
                .map((bl) => bl.noteId);
            await froca.getNotes(noteIds);
            setBacklinks(backlinks);
        });
    }

    useEffect(() => refresh(), [ note ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (needsRefresh(note, loadResults)) refresh();
    });

    // Nothing at all until the request has answered, so that the placeholder below doesn't show for
    // as long as it takes — the note usually has backlinks, this list being what says it has.
    if (!backlinks) return null;

    if (!backlinks.length) {
        return (
            // An item of the list it stands in for: what holds it is a <ul> everywhere but the
            // floating button's dropdown, which only opens once there is something to list anyway.
            <li className="backlinks-empty">
                <NoItems size="small" icon="bx bx-link" text={t("zpetne_odkazy.no_backlinks")} />
            </li>
        );
    }

    // Keyed by position: one source note takes a row per relation it points with, so a note ID names
    // no single row, and the whole list is rebuilt at once anyway.
    return backlinks.map((backlink, index) => (
        <li key={index}>
            {/* Named so that the styling has something to hang off other than the position of the
                link within the item (see Backlinks.css). */}
            <NoteLink
                notePath={backlink.noteId}
                containerClassName="backlink-header"
                showNotePath showNoteIcon
                noPreview
            />

            {"relationName" in backlink ? (
                <p className="backlink-relation">{backlink.relationName}</p>
            ) : (
                backlink.excerpts.map((excerpt, excerptIndex) => (
                    <RawHtml key={excerptIndex} html={sanitizeNoteContentHtml(excerpt)} />
                ))
            )}
        </li>
    ));
}

/**
 * {@link BacklinksList} in the markup its styling hangs off (see Backlinks.css), for the places that
 * frame the list rather than build it: the sidebar's card, the mobile note menu's modal, the status
 * bar's dropdown. The floating button keeps its own container, being a popup it also sizes by hand.
 */
export function BacklinksWidget({ note }: { note: FNote }) {
    return (
        <div class="tn-backlinks-widget">
            <ul class="backlinks-items">
                <BacklinksList note={note} />
            </ul>
        </div>
    );
}

function needsRefresh(note: FNote, loadResults: LoadResults) {
    return loadResults.getAttributeRows().some(attr =>
        attr.type === "relation" &&
        attributes.isAffecting(attr, note));
}
