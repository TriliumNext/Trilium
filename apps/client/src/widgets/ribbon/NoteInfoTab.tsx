import "./NoteInfoTab.css";

import { MetadataResponse, NoteSizeResponse, SubtreeSizeResponse, type FlashcardCardSummary } from "@triliumnext/commons";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

import FNote from "../../entities/fnote";
import flashcards from "../../services/flashcards";
import debounce from "../../services/debounce";
import { isExperimentalFeatureEnabled } from "../../services/experimental_features";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import server from "../../services/server";
import { formatSize } from "../../services/utils";
import { formatDateTime } from "../../utils/formatters";
import { useTriliumEvent } from "../react/hooks";
import LinkButton from "../react/LinkButton";
import { Badge } from "../react/Badge";
import LoadingSpinner from "../react/LoadingSpinner";

const isNewLayout = isExperimentalFeatureEnabled("new-layout");

export default function NoteInfoTab({ note }: { note: FNote | null | undefined }) {
    const { metadata, ...sizeProps } = useNoteMetadata(note);

    return (
        <div className="note-info-widget">
            {note && (
                <>
                    <div className="note-info-item">
                        <span>{t("note_info_widget.note_id")}:</span>
                        <span className="note-info-id selectable-text">{note.noteId}</span>
                    </div>
                    {!isNewLayout && <div className="note-info-item">
                        <span>{t("note_info_widget.created")}:</span>
                        <span className="selectable-text">{formatDateTime(metadata?.dateCreated)}</span>
                    </div>}
                    {!isNewLayout && <div className="note-info-item">
                        <span>{t("note_info_widget.modified")}:</span>
                        <span className="selectable-text">{formatDateTime(metadata?.dateModified)}</span>
                    </div>}
                    <div className="note-info-item">
                        <span>{t("note_info_widget.type")}:</span>
                        <span>
                            <span className="note-info-type">{note.type}</span>{' '}
                            {note.mime && <span className="note-info-mime selectable-text">({note.mime})</span>}
                        </span>
                    </div>
                    <div className="note-info-item">
                        <span title={t("note_info_widget.note_size_info")}>{t("note_info_widget.note_size")}:</span>
                        <span className="note-info-size-col-span">
                            <NoteSizeWidget {...sizeProps} />
                        </span>
                    </div>
                    {note.hasLabel("flashcard") && <FlashcardStatusItem note={note} />}
                </>
            )}
        </div>
    );
}

export function FlashcardStatusItem({ note }: { note: FNote }) {
    const [ card, setCard ] = useState<FlashcardCardSummary | null>();

    const refresh = useCallback(() => {
        flashcards.getCardForNote(note.noteId)
            .then(setCard)
            .catch(() => setCard(null));
    }, [ note.noteId ]);

    useEffect(() => refresh(), [ refresh ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.isNoteReloaded(note.noteId)) {
            refresh();
        } else if (card?.cardId && loadResults.getEntityRow("flashcards", card.cardId)) {
            refresh();
        }
    });

    if (card == null) {
        return null;
    }

    const stateLabel = t(`flashcards.state_${FLASHCARD_STATE_LABELS[card.state]}`);

    return (
        <div className="note-info-item">
            <span>{t("flashcards.title")}:</span>
            <span className="note-info-flashcard-status">
                <span className="flashcard-state">{stateLabel}</span>{" "}
                <span>·</span>{" "}
                <span>{t("flashcards.due")}: {formatDateTime(card.due)}</span>{" "}
                <span>·</span>{" "}
                <span>{card.deckTitle}</span>
                {card.suspended && <Badge className="flashcard-suspended-badge" text={t("flashcards.status_suspended")} />}
                {card.leech && <Badge className="flashcard-leech-badge" text={t("flashcards.leech")} />}
            </span>
        </div>
    );
}

const FLASHCARD_STATE_LABELS = {
    0: "new",
    1: "learning",
    2: "review",
    3: "relearning"
} as const;

export function NoteSizeWidget({ isLoading, noteSizeResponse, subtreeSizeResponse, requestSizeInfo }: Omit<ReturnType<typeof useNoteMetadata>, "metadata">) {
    return <>
        {!isLoading && !noteSizeResponse && !subtreeSizeResponse && (
            <LinkButton
                text={t("note_info_widget.calculate")}
                onClick={requestSizeInfo}
            />
        )}

        <span className="note-sizes-wrapper selectable-text">
            <span className="note-size">{formatSize(noteSizeResponse?.noteSize)}</span>
            {" "}
            {subtreeSizeResponse && subtreeSizeResponse.subTreeNoteCount > 1 &&
                <span className="subtree-size">{t("note_info_widget.subtree_size", { size: formatSize(subtreeSizeResponse.subTreeSize), count: subtreeSizeResponse.subTreeNoteCount })}</span>
            }
            {isLoading && <LoadingSpinner />}
        </span>
    </>;
}

export function useNoteMetadata(note: FNote | null | undefined, debounceTime = 10_000) {
    const [ isLoading, setIsLoading ] = useState(false);
    const [ noteSizeResponse, setNoteSizeResponse ] = useState<NoteSizeResponse>();
    const [ subtreeSizeResponse, setSubtreeSizeResponse ] = useState<SubtreeSizeResponse>();
    const [ metadata, setMetadata ] = useState<MetadataResponse>();

    const refresh = useCallback(() => {
        // The froca check matters because this also runs off a ten-second debounce: deleting a note is
        // itself an entity change for that note, so a refresh gets scheduled for a note that is about to
        // stop existing, and asking the server about it ten seconds later answers 404 and reports a
        // failure the user can do nothing about.
        if (note && froca.getNoteFromCache(note.noteId)) {
            server.get<MetadataResponse>(`notes/${note.noteId}/metadata`).then(setMetadata);
        }

        setNoteSizeResponse(undefined);
        setSubtreeSizeResponse(undefined);
        setIsLoading(false);
    }, [ note ]);

    const debouncedRefresh = useMemo(() => debounce(refresh, debounceTime), [ refresh, debounceTime ]);
    // Drop a pending refresh when the note changes or the tab goes away, so it can't fire against the
    // note that was showing ten seconds ago.
    useEffect(() => () => debouncedRefresh.clear(), [ debouncedRefresh ]);

    function requestSizeInfo() {
        if (!note) return;

        setIsLoading(true);
        setTimeout(async () => {
            await Promise.allSettled([
                server.get<NoteSizeResponse>(`stats/note-size/${note.noteId}`).then(setNoteSizeResponse),
                server.get<SubtreeSizeResponse>(`stats/subtree-size/${note.noteId}`).then(setSubtreeSizeResponse)
            ]);
            setIsLoading(false);
        }, 0);
    }

    useEffect(() => refresh(), [ refresh ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const noteId = note?.noteId;
        if (noteId && (loadResults.isNoteReloaded(noteId) || loadResults.isNoteContentReloaded(noteId))) {
            debouncedRefresh();
        }
    });

    return { isLoading, metadata, noteSizeResponse, subtreeSizeResponse, requestSizeInfo  };
}
