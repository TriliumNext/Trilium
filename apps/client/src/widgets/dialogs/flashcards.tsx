import "./flashcards.css";

import type {
    FlashcardDeckSummary,
    FlashcardLeechSummary,
    FlashcardReviewCard,
    FlashcardReviewPreview,
    FlashcardReviewResponse,
    FlashcardStatsResponse
} from "@triliumnext/commons";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import type { EventData } from "../../components/app_context";
import flashcards, { FlashcardConflictError } from "../../services/flashcards";
import dialogService from "../../services/dialog";
import { t } from "../../services/i18n";
import toast from "../../services/toast";
import { randomString } from "../../services/utils";
import { formatDateTime } from "../../utils/formatters";
import { Badge } from "../react/Badge";
import Button from "../react/Button";
import FormSelect from "../react/FormSelect";
import FormTextBox from "../react/FormTextBox";
import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import NoItems from "../react/NoItems";
import RawHtml from "../react/RawHtml";
import { RawHtmlBlock } from "../react/RawHtml";

const REVIEW_LIMIT = 20;
const FORECAST_BAR_SEGMENTS = 8;
const FLASHCARD_DRAG_MIME = "application/x-trilium-flashcard-id";
const FORECAST_DRAG_HINT_ID = "flashcards-due-forecast-drag-hint";

interface UndoableReview {
    reviewId: string;
    cardId: string;
    expectedSchedulingRevision: number;
}

export default function FlashcardsDialog() {
    const [ shown, setShown ] = useState(false);
    const [ loading, setLoading ] = useState(false);
    const [ loadError, setLoadError ] = useState<string | null>(null);
    const [ cards, setCards ] = useState<FlashcardReviewCard[]>([]);
    const [ currentCard, setCurrentCard ] = useState<FlashcardReviewCard | null>(null);
    const [ decks, setDecks ] = useState<FlashcardDeckSummary[]>([]);
    const [ selectedDeckNoteId, setSelectedDeckNoteId ] = useState<string | null>(null);
    const [ stats, setStats ] = useState<FlashcardStatsResponse | null>(null);
    const [ dueQueueTotal, setDueQueueTotal ] = useState(0);
    const [ answerShown, setAnswerShown ] = useState(false);
    const [ submitting, setSubmitting ] = useState(false);
    const [ reviewRequestId, setReviewRequestId ] = useState(() => randomString());
    const [ undoableReview, setUndoableReview ] = useState<UndoableReview | null>(null);
    const mutationLockRef = useRef(false);

    const openDialog = useCallback(async ({
        noteId,
        deckNoteId
    }: EventData<"showFlashcards"> = {}) => {
        setShown(true);
        setLoading(true);
        setLoadError(null);
        setCards([]);
        setCurrentCard(null);
        setStats(null);
        setDueQueueTotal(0);
        setDecks([]);
        setSelectedDeckNoteId(deckNoteId ?? null);
        setAnswerShown(false);
        setReviewRequestId(randomString());
        setUndoableReview(null);

        try {
            if (noteId) {
                const [ card, loadedStats, loadedDecks ] = await Promise.all([
                    flashcards.createCard({ noteId, deckNoteId }),
                    flashcards.getStats(),
                    flashcards.getDecks()
                ]);
                setCards([ card ]);
                setCurrentCard(card);
                setDueQueueTotal(1);
                setStats(loadedStats);
                setDecks(loadedDecks.decks);

                // Reconcile the cloze card set in the background; stale cards
                // disappear from future queues without blocking this session.
                if (card.cardType === "cloze") {
                    void flashcards.syncNoteCards(noteId).catch(() => undefined);
                }
                return;
            }

            const [ due, loadedStats, loadedDecks ] = await Promise.all([
                flashcards.getDueCards({ deckNoteId, limit: REVIEW_LIMIT }),
                flashcards.getStats(),
                flashcards.getDecks()
            ]);
            setCards(due.cards);
            setCurrentCard(due.cards[0] ?? null);
            setDueQueueTotal(due.totalDueCount);
            setStats(loadedStats);
            setDecks(loadedDecks.decks);
        } catch {
            setCards([]);
            setCurrentCard(null);
            setStats(null);
            setDueQueueTotal(0);
            setLoadError(t("flashcards.load_failed"));
        } finally {
            setLoading(false);
        }
    }, []);

    useTriliumEvent("showFlashcards", openDialog);

    useTriliumEvent("entitiesReloaded", useCallback(({ loadResults }) => {
        if (!shown || cards.length === 0) {
            return;
        }

        const flashcardChanged = cards.some((card) =>
            loadResults.getEntityRow("flashcards", card.cardId)
        );
        if (!flashcardChanged) {
            return;
        }

        void refreshDueQueueAfterSync();
    }, [ shown, cards, selectedDeckNoteId ]));

    const activeIndex = useMemo(() => {
        if (!currentCard) {
            return -1;
        }

        return cards.findIndex((card) => card.cardId === currentCard.cardId);
    }, [ cards, currentCard ]);

    useEffect(() => {
        if (!shown || (!currentCard && !undoableReview) || submitting) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || shouldIgnoreKeyboardTarget(event.target)) {
                return;
            }

            if (undoableReview && event.key.toLowerCase() === "u") {
                event.preventDefault();
                void undoLastReview();
                return;
            }

            if (!answerShown && (event.key === " " || event.key === "Enter")) {
                event.preventDefault();
                void revealAnswer();
                return;
            }

            if (!answerShown || !currentCard) {
                return;
            }

            const ratingIndex = Number(event.key) - 1;
            const preview = currentCard.previews[ratingIndex];
            if (preview) {
                event.preventDefault();
                void submitRating(preview);
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [ shown, currentCard, answerShown, submitting, undoableReview ]);

    async function refreshProgress() {
        const [ loadedStats, loadedDecks ] = await Promise.all([
            flashcards.getStats(),
            flashcards.getDecks()
        ]);
        setStats(loadedStats);
        setDecks(loadedDecks.decks);
    }

    async function studyDeck(deckNoteId: string | null) {
        setLoading(true);
        setLoadError(null);
        setCards([]);
        setCurrentCard(null);
        setSelectedDeckNoteId(deckNoteId);
        setAnswerShown(false);
        setReviewRequestId(randomString());
        setUndoableReview(null);

        try {
            await loadDueQueue(deckNoteId);
        } catch {
            setLoadError(t("flashcards.load_failed"));
        } finally {
            setLoading(false);
        }
    }

    async function refreshDueQueueAfterSync() {
        setLoading(true);
        setLoadError(null);
        setAnswerShown(false);
        setReviewRequestId(randomString());
        setUndoableReview(null);

        try {
            await loadDueQueue(selectedDeckNoteId);
            toast.showMessage(t("flashcards.queue_refreshed"));
        } catch {
            setLoadError(t("flashcards.load_failed"));
        } finally {
            setLoading(false);
        }
    }

    async function loadDueQueue(deckNoteId: string | null) {
        const [ due, loadedStats, loadedDecks ] = await Promise.all([
            flashcards.getDueCards({
                deckNoteId: deckNoteId ?? undefined,
                limit: REVIEW_LIMIT
            }),
            flashcards.getStats(),
            flashcards.getDecks()
        ]);
        setCards(due.cards);
        setCurrentCard(due.cards[0] ?? null);
        setDueQueueTotal(due.totalDueCount);
        setStats(loadedStats);
        setDecks(loadedDecks.decks);
    }

    async function revealAnswer() {
        if (!currentCard || mutationLockRef.current) {
            return;
        }

        mutationLockRef.current = true;
        try {
            if (currentCard.back === undefined) {
                setCurrentCard(await flashcards.getCard(currentCard.cardId));
            }

            setAnswerShown(true);
        } finally {
            mutationLockRef.current = false;
        }
    }

    async function submitRating(preview: FlashcardReviewPreview) {
        if (!currentCard || mutationLockRef.current) {
            return;
        }

        mutationLockRef.current = true;
        setSubmitting(true);
        try {
            const response = await flashcards.reviewCard(currentCard.cardId, {
                rating: preview.rating,
                expectedSchedulingRevision: currentCard.schedulingRevision,
                clientRequestId: reviewRequestId
            });

            await moveToNextCard(response);
        } catch (e) {
            if (e instanceof FlashcardConflictError) {
                await handleReviewConflict(currentCard.cardId, e.message);
                return;
            }

            throw e;
        } finally {
            mutationLockRef.current = false;
            setSubmitting(false);
        }
    }

    async function toggleSuspended() {
        if (!currentCard || mutationLockRef.current) {
            return;
        }

        const suspended = !currentCard.suspended;
        mutationLockRef.current = true;
        setSubmitting(true);
        try {
            const response = await flashcards.setSuspended(currentCard.cardId, {
                suspended,
                expectedSchedulingRevision: currentCard.schedulingRevision
            });

            await applyLifecycleUpdate(response.card);
            setUndoableReview(null);
            toast.showMessage(suspended
                ? t("flashcards.card_suspended")
                : t("flashcards.card_resumed"));
        } catch (e) {
            if (e instanceof FlashcardConflictError) {
                await handleReviewConflict(currentCard.cardId, e.message);
                return;
            }

            throw e;
        } finally {
            mutationLockRef.current = false;
            setSubmitting(false);
        }
    }

    async function resetCurrentCard() {
        if (!currentCard || mutationLockRef.current) {
            return;
        }

        const confirmed = await dialogService.confirm(t("flashcards.reset_confirm"));
        if (!confirmed) {
            return;
        }

        mutationLockRef.current = true;
        setSubmitting(true);
        try {
            const response = await flashcards.resetCard(currentCard.cardId, {
                expectedSchedulingRevision: currentCard.schedulingRevision
            });

            await applyLifecycleUpdate(response.card);
            setUndoableReview(null);
            toast.showMessage(t("flashcards.card_reset"));
        } catch (e) {
            if (e instanceof FlashcardConflictError) {
                await handleReviewConflict(currentCard.cardId, e.message);
                return;
            }

            throw e;
        } finally {
            mutationLockRef.current = false;
            setSubmitting(false);
        }
    }

    async function buryCurrentCard() {
        if (!currentCard || mutationLockRef.current) {
            return;
        }

        mutationLockRef.current = true;
        setSubmitting(true);
        try {
            const response = await flashcards.buryCard(currentCard.cardId, {
                expectedSchedulingRevision: currentCard.schedulingRevision
            });

            await removeCurrentCard(response.card.cardId, { refillIfEmpty: true });
            setUndoableReview(null);
            toast.showMessage(t("flashcards.card_buried"));
        } catch (e) {
            if (e instanceof FlashcardConflictError) {
                await handleReviewConflict(currentCard.cardId, e.message);
                return;
            }

            throw e;
        } finally {
            mutationLockRef.current = false;
            setSubmitting(false);
        }
    }

    async function rescheduleCurrentCard(due: string) {
        if (!currentCard || mutationLockRef.current) {
            throw new FlashcardConflictError("Flashcard has changed.");
        }

        mutationLockRef.current = true;
        setSubmitting(true);
        try {
            const response = await flashcards.setCardDueDate(currentCard.cardId, {
                due,
                expectedSchedulingRevision: currentCard.schedulingRevision
            });

            await applyLifecycleUpdate(response.card);
            setUndoableReview(null);
            toast.showMessage(t("flashcards.card_rescheduled"));
        } catch (e) {
            if (e instanceof FlashcardConflictError) {
                await handleReviewConflict(currentCard.cardId, e.message);
                return;
            }

            throw e;
        } finally {
            mutationLockRef.current = false;
            setSubmitting(false);
        }
    }

    async function moveCurrentCardToDeck(deckNoteId: string) {
        if (!currentCard || currentCard.deckNoteId === deckNoteId || mutationLockRef.current) {
            return;
        }

        mutationLockRef.current = true;
        setSubmitting(true);
        try {
            const response = await flashcards.moveCardToDeck(currentCard.cardId, {
                deckNoteId,
                expectedSchedulingRevision: currentCard.schedulingRevision
            });

            await applyLifecycleUpdate(response.card);
            setSelectedDeckNoteId(deckNoteId);
            setUndoableReview(null);
            toast.showMessage(t("flashcards.card_moved"));
        } catch (e) {
            if (e instanceof FlashcardConflictError) {
                await handleReviewConflict(currentCard.cardId, e.message);
                return;
            }

            throw e;
        } finally {
            mutationLockRef.current = false;
            setSubmitting(false);
        }
    }

    async function undoLastReview() {
        if (!undoableReview || mutationLockRef.current) {
            return;
        }

        mutationLockRef.current = true;
        setSubmitting(true);
        try {
            const response = await flashcards.undoReview(undoableReview);
            setUndoableReview(null);
            await applyLifecycleUpdate(response.card);
            toast.showMessage(t("flashcards.review_undone"));
        } catch (e) {
            if (e instanceof FlashcardConflictError) {
                await handleReviewConflict(undoableReview.cardId, e.message);
                setUndoableReview(null);
                return;
            }

            throw e;
        } finally {
            mutationLockRef.current = false;
            setSubmitting(false);
        }
    }

    async function handleReviewConflict(cardId: string, message: string) {
        const confirmed = await dialogService.confirm(t("flashcards.stale_review_confirm", {
            message
        }));
        if (!confirmed) {
            return;
        }

        const refreshedCard = await flashcards.getCard(cardId);
        setCards(cards.map((card) => card.cardId === cardId ? refreshedCard : card));
        setCurrentCard(refreshedCard);
        setAnswerShown(false);
        setReviewRequestId(randomString());
        setUndoableReview(null);
        await refreshProgress();
        toast.showMessage(t("flashcards.card_refreshed"));
    }

    async function moveToNextCard(response: FlashcardReviewResponse) {
        toast.showMessage(response.card.leech
            ? t("flashcards.leech_suspended")
            : t("flashcards.review_saved"));
        setUndoableReview({
            reviewId: response.reviewId,
            cardId: response.card.cardId,
            expectedSchedulingRevision: response.card.schedulingRevision
        });
        await removeCurrentCard(response.card.cardId, { refillIfEmpty: true });
    }

    async function applyLifecycleUpdate(card: FlashcardReviewCard) {
        if (card.suspended) {
            await removeCurrentCard(card.cardId, { refillIfEmpty: true });
            return;
        }

        const cardWithAnswer = currentCard?.cardId === card.cardId && currentCard.back !== undefined
            ? { ...card, back: currentCard.back }
            : card;
        const nextCards = cards.some((existingCard) => existingCard.cardId === card.cardId)
            ? cards.map((existingCard) => existingCard.cardId === card.cardId
                ? cardWithAnswer
                : existingCard)
            : [ cardWithAnswer, ...cards ];

        setCards(nextCards);
        setCurrentCard(cardWithAnswer);
        setAnswerShown(false);
        setReviewRequestId(randomString());
        await refreshProgress();
    }

    async function removeCurrentCard(
        cardId: string,
        { refillIfEmpty = false }: { refillIfEmpty?: boolean } = {}
    ) {
        const nextCards = cards.filter((card) => card.cardId !== cardId);
        const hasMoreQueuedCards = dueQueueTotal > cards.length;
        setCards(nextCards);
        setCurrentCard(nextCards[0] ?? null);
        setDueQueueTotal(Math.max(0, dueQueueTotal - 1));
        setAnswerShown(false);
        setReviewRequestId(randomString());

        if (nextCards.length === 0 && refillIfEmpty && hasMoreQueuedCards) {
            await loadDueQueue(selectedDeckNoteId);
            return;
        }

        await refreshProgress();
    }

    return (
        <Modal
            className="flashcards-dialog"
            title={t("flashcards.title")}
            size="lg"
            show={shown}
            onHidden={() => setShown(false)}
            scrollable
            isFullPageOnMobile
            footer={<DialogFooter
                currentCard={currentCard}
                answerShown={answerShown}
                submitting={submitting}
                undoableReview={undoableReview}
                onReveal={revealAnswer}
                onRate={submitRating}
                onUndo={undoLastReview}
            />}
        >
            <div className="flashcards-dialog-body" aria-busy={loading}>
                {stats && <ReviewStats
                    stats={stats}
                    activeCardId={currentCard?.cardId}
                    disabled={submitting}
                    onReschedule={rescheduleCurrentCard}
                />}
                {stats && stats.leechCount > 0 && (
                    <LeechSection onOpenNote={(noteId) => void openDialog({ noteId })} />
                )}
                {!loading && stats && <DeckBrowser
                    decks={decks}
                    stats={stats}
                    selectedDeckNoteId={selectedDeckNoteId}
                    submitting={submitting}
                    onStudyAll={() => void studyDeck(null)}
                    onStudyDeck={(deckNoteId) => void studyDeck(deckNoteId)}
                    onCreated={refreshProgress}
                />}
                {loading
                    ? <div className="flashcards-loading" role="status">
                        {t("flashcards.loading")}
                    </div>
                    : loadError
                        ? <div role="alert">
                            <NoItems icon="bx bx-error-circle" text={loadError} />
                        </div>
                        : currentCard
                            ? <ReviewCard
                                card={currentCard}
                                decks={decks}
                                activeIndex={activeIndex}
                                total={Math.max(cards.length, dueQueueTotal)}
                                answerShown={answerShown}
                                submitting={submitting}
                                onToggleSuspended={toggleSuspended}
                                onReset={resetCurrentCard}
                                onBury={buryCurrentCard}
                                onMoveDeck={moveCurrentCardToDeck}
                                onReschedule={rescheduleCurrentCard}
                            />
                            : <NoItems icon="bx bx-brain" text={t("flashcards.no_due_cards")} />
                }
            </div>
        </Modal>
    );
}

function DeckBrowser({
    decks,
    stats,
    selectedDeckNoteId,
    submitting,
    onStudyAll,
    onStudyDeck,
    onCreated
}: {
    decks: FlashcardDeckSummary[];
    stats: FlashcardStatsResponse;
    selectedDeckNoteId: string | null;
    submitting: boolean;
    onStudyAll: () => void;
    onStudyDeck: (deckNoteId: string) => void;
    onCreated: () => Promise<void>;
}) {
    const [ creating, setCreating ] = useState(false);
    const [ newTitle, setNewTitle ] = useState("");
    const [ newQuery, setNewQuery ] = useState("");
    const [ creatingDeck, setCreatingDeck ] = useState(false);
    const [ createError, setCreateError ] = useState<string | null>(null);

    async function submitCreate() {
        const title = newTitle.trim();
        const query = newQuery.trim();

        if (!title || !query) {
            setCreateError(t("flashcards.filtered_deck_missing"));
            return;
        }

        setCreatingDeck(true);
        setCreateError(null);
        try {
            await flashcards.createFilteredDeck(title, query);
            setCreating(false);
            setNewTitle("");
            setNewQuery("");
            await onCreated();
        } catch {
            setCreateError(t("flashcards.filtered_deck_create_failed"));
        } finally {
            setCreatingDeck(false);
        }
    }

    return (
        <section className="flashcards-deck-browser" aria-label={t("flashcards.deck_browser")}>
            <header className="flashcards-deck-browser-header">
                <h3>{t("flashcards.deck_browser")}</h3>
                <div className="flashcards-deck-browser-actions">
                    <Button
                        text={t("flashcards.new_filtered_deck")}
                        icon="bx-filter-alt"
                        disabled={submitting || creatingDeck}
                        size="small"
                        onClick={() => setCreating(!creating)}
                    />
                    {decks.length > 0 && <Button
                        text={t("flashcards.study_all")}
                        icon="bx-play-circle"
                        disabled={submitting || stats.dueCount === 0}
                        size="small"
                        onClick={() => onStudyAll()}
                    />}
                </div>
            </header>
            {creating && <div className="flashcards-filtered-deck-editor">
                <FormTextBox
                    aria-label={t("flashcards.filtered_deck_title")}
                    placeholder={t("flashcards.filtered_deck_title")}
                    currentValue={newTitle}
                    disabled={creatingDeck}
                    autoFocus
                    onChange={setNewTitle}
                />
                <FormTextBox
                    aria-label={t("flashcards.filtered_deck_query")}
                    placeholder={t("flashcards.filtered_deck_query")}
                    currentValue={newQuery}
                    disabled={creatingDeck}
                    onChange={setNewQuery}
                />
                <Button
                    text={t("flashcards.apply")}
                    icon="bx-check"
                    disabled={creatingDeck}
                    size="small"
                    onClick={() => void submitCreate()}
                />
                {createError && (
                    <span className="flashcards-reschedule-error" role="alert">{createError}</span>
                )}
            </div>}
            <div className="flashcards-deck-list">
                {decks.map((deck) => <DeckSummaryCard
                    key={deck.deckNoteId}
                    deck={deck}
                    selected={deck.deckNoteId === selectedDeckNoteId}
                    submitting={submitting}
                    onStudyDeck={onStudyDeck}
                />)}
            </div>
        </section>
    );
}

function DeckSummaryCard({ deck, selected, submitting, onStudyDeck }: {
    deck: FlashcardDeckSummary;
    selected: boolean;
    submitting: boolean;
    onStudyDeck: (deckNoteId: string) => void;
}) {
    return (
        <article
            className={`flashcards-deck-item${selected ? " flashcards-deck-item-selected" : ""}`}
        >
            <div className="flashcards-deck-heading">
                <h4>{deck.deckTitle}</h4>
                {deck.isFiltered && <Badge
                    className="flashcards-deck-badge flashcards-deck-badge-filtered"
                    text={t("flashcards.filtered_deck")}
                    icon="bx-filter-alt"
                    outline
                />}
                <Button
                    text={t("flashcards.study_deck")}
                    icon="bx-play"
                    disabled={submitting || deck.dueCount === 0}
                    size="small"
                    onClick={() => onStudyDeck(deck.deckNoteId)}
                />
            </div>
            <div className="flashcards-deck-badges">
                <Badge
                    className="flashcards-deck-badge flashcards-deck-badge-due"
                    text={t("flashcards.due_count", { count: deck.dueCount })}
                    outline
                />
                <Badge
                    className="flashcards-deck-badge flashcards-deck-badge-new"
                    text={t("flashcards.new_count", { count: deck.newCount })}
                    outline
                />
                <Badge
                    className="flashcards-deck-badge flashcards-deck-badge-learning"
                    text={t("flashcards.learning_count", { count: deck.learningCount })}
                    outline
                />
                <Badge
                    className="flashcards-deck-badge flashcards-deck-badge-review"
                    text={t("flashcards.review_count", { count: deck.reviewCount })}
                    outline
                />
                <Badge
                    className="flashcards-deck-badge flashcards-deck-badge-total"
                    text={t("flashcards.total_count", { count: deck.totalCount })}
                    outline
                />
                <Badge
                    className="flashcards-deck-badge flashcards-deck-badge-suspended"
                    text={t("flashcards.suspended_count", { count: deck.suspendedCount })}
                    outline
                />
            </div>
        </article>
    );
}

function LeechSection({ onOpenNote }: { onOpenNote: (noteId: string) => void }) {
    const [ leeches, setLeeches ] = useState<FlashcardLeechSummary[] | null>(null);

    async function refresh() {
        try {
            const response = await flashcards.getLeeches();
            setLeeches(response.leeches);
        } catch {
            setLeeches([]);
        }
    }

    async function unsuspend(cardId: string) {
        await flashcards.setSuspended(cardId, { suspended: false });
        await refresh();
    }

    return (
        <details
            className="flashcards-leech-section"
            onToggle={(e) => {
                if ((e.currentTarget as HTMLDetailsElement).open && leeches === null) {
                    void refresh();
                }
            }}
        >
            <summary className="flashcards-leech-toggle">{t("flashcards.leeches")}</summary>
            {leeches === null
                ? <div className="flashcards-loading" role="status">{t("flashcards.loading")}</div>
                : leeches.length === 0
                    ? <div className="flashcards-leech-empty">{t("flashcards.leeches_empty")}</div>
                    : <ul className="flashcards-leech-list">
                            {leeches.map((leech) => (
                                <li key={leech.cardId} className="flashcards-leech-row">
                                    <span className="flashcards-leech-title">{leech.noteTitle}</span>
                                    <Badge
                                        className="flashcards-deck-badge flashcards-deck-badge-suspended"
                                        text={t("flashcards.leech_lapses", { count: leech.lapses })}
                                        outline
                                    />
                                    {leech.suspended && <Badge text={t("flashcards.status_suspended")} outline />}
                                    <div className="flashcards-leech-actions">
                                        {leech.suspended && (
                                            <Button
                                                text={t("flashcards.leech_unsuspend")}
                                                onClick={() => void unsuspend(leech.cardId)}
                                            />
                                        )}
                                        <Button
                                            text={t("flashcards.leech_review")}
                                            onClick={() => onOpenNote(leech.noteId)}
                                        />
                                    </div>
                                </li>
                            ))}
                        </ul>
        }
        </details>
    );
}

function ReviewStats({
    stats,
    activeCardId,
    disabled,
    onReschedule
}: {
    stats: FlashcardStatsResponse;
    activeCardId?: string;
    disabled: boolean;
    onReschedule: (due: string) => Promise<void>;
}) {
    return (
        <div
            className="flashcards-session-stats"
            aria-label={t("flashcards.session_summary")}
            aria-live="polite"
            role="status"
        >
            <span>{t("flashcards.due_count", { count: stats.dueCount })}</span>
            <span>{t("flashcards.new_count", { count: stats.newCount })}</span>
            <span>{t("flashcards.learning_count", { count: stats.learningCount })}</span>
            <span>{t("flashcards.review_count", { count: stats.reviewCount })}</span>
            <span>{t("flashcards.reviewed_today", { count: stats.reviewedTodayCount })}</span>
            <span>{t("flashcards.retention", { value: formatRetention(stats.retentionRate) })}</span>
            <span>{t("flashcards.lapses", { count: stats.lapseCount })}</span>
            <span>{t("flashcards.leeches", { count: stats.leechCount })}</span>
            <span>{t("flashcards.rating_counts", {
                again: stats.ratingCounts[1],
                hard: stats.ratingCounts[2],
                good: stats.ratingCounts[3],
                easy: stats.ratingCounts[4]
            })}</span>
            <DueForecast
                dueForecast={stats.dueForecast}
                activeCardId={activeCardId}
                disabled={disabled}
                onReschedule={onReschedule}
            />
        </div>
    );
}

function DueForecast({
    dueForecast,
    activeCardId,
    disabled,
    onReschedule
}: {
    dueForecast: FlashcardStatsResponse["dueForecast"];
    activeCardId?: string;
    disabled: boolean;
    onReschedule: (due: string) => Promise<void>;
}) {
    const [ dragOverDate, setDragOverDate ] = useState<string | null>(null);
    const maximumCount = Math.max(1, ...dueForecast.map(({ count }) => count));
    const canReschedule = !!activeCardId && !disabled;

    return (
        <figure
            className="flashcards-due-forecast"
            aria-label={t("flashcards.due_forecast", { value: formatDueForecast(dueForecast) })}
        >
            <figcaption>{t("flashcards.due_forecast_heading")}</figcaption>
            {canReschedule && (
                <div id={FORECAST_DRAG_HINT_ID} className="flashcards-due-forecast-hint">
                    {t("flashcards.due_forecast_drag_hint")}
                </div>
            )}
            <div className="flashcards-due-forecast-days" role="list">
                {dueForecast.map(({ date, count }) => {
                    const filledSegments = count === 0
                        ? 0
                        : Math.max(1, Math.round(count / maximumCount * FORECAST_BAR_SEGMENTS));
                    const className = [
                        "flashcards-due-forecast-day",
                        canReschedule ? "flashcards-due-forecast-day-droppable" : "",
                        dragOverDate === date ? "flashcards-due-forecast-day-drop-target" : ""
                    ].filter(Boolean).join(" ");

                    return (
                        <div
                            className={className}
                            key={date}
                            role="listitem"
                            aria-label={t("flashcards.due_forecast_day", { date, count })}
                            onDragOver={canReschedule ? (event) => {
                                if (!event.dataTransfer) {
                                    return;
                                }

                                event.preventDefault();
                                event.dataTransfer.dropEffect = "move";
                                setDragOverDate(date);
                            } : undefined}
                            onDragLeave={canReschedule ? () => setDragOverDate(null) : undefined}
                            onDrop={canReschedule ? (event) => {
                                if (!event.dataTransfer) {
                                    return;
                                }

                                event.preventDefault();
                                setDragOverDate(null);
                                const due = getFlashcardDropDue(
                                    event.dataTransfer,
                                    activeCardId,
                                    date
                                );
                                if (due) {
                                    void onReschedule(due);
                                }
                            } : undefined}
                        >
                            <span className="flashcards-due-forecast-count" aria-hidden="true">
                                {count}
                            </span>
                            <span className="flashcards-due-forecast-bar" aria-hidden="true">
                                {Array.from({ length: FORECAST_BAR_SEGMENTS }, (_, index) => (
                                    <span
                                        key={index}
                                        className={index >= FORECAST_BAR_SEGMENTS - filledSegments
                                            ? "flashcards-due-forecast-segment-active"
                                            : undefined}
                                    />
                                ))}
                            </span>
                            <time dateTime={date} aria-hidden="true">{date.slice(5)}</time>
                        </div>
                    );
                })}
            </div>
        </figure>
    );
}

function ReviewCard({
    card,
    decks,
    activeIndex,
    total,
    answerShown,
    submitting,
    onToggleSuspended,
    onReset,
    onBury,
    onMoveDeck,
    onReschedule
}: {
    card: FlashcardReviewCard;
    decks: FlashcardDeckSummary[];
    activeIndex: number;
    total: number;
    answerShown: boolean;
    submitting: boolean;
    onToggleSuspended: () => Promise<void>;
    onReset: () => Promise<void>;
    onBury: () => Promise<void>;
    onMoveDeck: (deckNoteId: string) => Promise<void>;
    onReschedule: (due: string) => Promise<void>;
}) {
    return (
        <>
            <div className="flashcards-card-meta">
                <span>{t("flashcards.progress", {
                    current: Math.max(activeIndex + 1, 1),
                    total
                })}</span>
                <span>{t("flashcards.deck", { title: card.deckTitle })}</span>
                {card.cardType === "cloze" && <span>{t("flashcards.cloze_number", { number: card.ordinal + 1 })}</span>}
                <span>{t("flashcards.due", { date: formatDateTime(card.due) })}</span>
                <span>{t("flashcards.retrievability", {
                    value: formatRetrievability(card.retrievability)
                })}</span>
            </div>
            <CardLifecycleActions
                card={card}
                disabled={submitting}
                onToggleSuspended={onToggleSuspended}
                onReset={onReset}
                onBury={onBury}
                decks={decks}
                onMoveDeck={onMoveDeck}
                onReschedule={onReschedule}
            />
            <section
                className="flashcards-card-pane"
                aria-label={t("flashcards.current_card")}
                aria-live="polite"
                aria-describedby={!submitting ? FORECAST_DRAG_HINT_ID : undefined}
                draggable={!submitting}
                onDragStart={(event) => {
                    if (!event.dataTransfer) {
                        return;
                    }

                    event.dataTransfer.effectAllowed = "move";
                    setFlashcardDragData(event.dataTransfer, card.cardId);
                }}
            >
                {card.frontIsHtml || card.cardType === "cloze"
                    ? <h3 className="flashcards-front-title">
                        <RawHtml html={card.front} />
                    </h3>
                    : <h3 className="flashcards-front-title">{card.front}</h3>}
                {answerShown && (
                    <div className="flashcards-answer">
                        <div className="flashcards-answer-label">{t("flashcards.answer")}</div>
                        <RawHtmlBlock html={card.back || t("flashcards.empty_answer")} />
                    </div>
                )}
            </section>
        </>
    );
}

function CardLifecycleActions({
    card,
    disabled,
    decks,
    onToggleSuspended,
    onReset,
    onBury,
    onMoveDeck,
    onReschedule
}: {
    card: FlashcardReviewCard;
    disabled: boolean;
    decks: FlashcardDeckSummary[];
    onToggleSuspended: () => Promise<void>;
    onReset: () => Promise<void>;
    onBury: () => Promise<void>;
    onMoveDeck: (deckNoteId: string) => Promise<void>;
    onReschedule: (due: string) => Promise<void>;
}) {
    const [ rescheduling, setRescheduling ] = useState(false);
    const [ rescheduleDate, setRescheduleDate ] = useState(() => card.due.slice(0, 10));
    const [ reschedulingError, setReschedulingError ] = useState<string | null>(null);

    const submitReschedule = async () => {
        setReschedulingError(null);
        const due = `${rescheduleDate}T12:00:00.000Z`;
        try {
            await onReschedule(due);
            setRescheduling(false);
        } catch {
            setReschedulingError(t("flashcards.reschedule_conflict"));
        }
    };

    return (
        <div className="flashcards-card-actions">
            {decks.length > 0 && <label className="flashcards-deck-move">
                <span>{t("flashcards.move_to_deck")}</span>
                <FormSelect<FlashcardDeckSummary>
                    values={decks}
                    keyProperty="deckNoteId"
                    titleProperty="deckTitle"
                    currentValue={card.deckNoteId}
                    disabled={disabled}
                    onChange={(deckNoteId) => void onMoveDeck(deckNoteId)}
                />
            </label>}
            <Button
                text={t(card.suspended ? "flashcards.resume_card" : "flashcards.suspend_card")}
                icon={card.suspended ? "bx-play-circle" : "bx-pause-circle"}
                disabled={disabled}
                size="small"
                onClick={() => void onToggleSuspended()}
            />
            <Button
                text={t("flashcards.bury_card")}
                icon="bx-time-five"
                disabled={disabled}
                size="small"
                onClick={() => void onBury()}
            />
            <Button
                text={t("flashcards.reset_card")}
                icon="bx-reset"
                disabled={disabled}
                size="small"
                onClick={() => void onReset()}
            />
            <Button
                text={t("flashcards.reschedule_card")}
                icon="bx-calendar"
                disabled={disabled}
                size="small"
                onClick={() => setRescheduling((value) => !value)}
            />
            {rescheduling && <div className="flashcards-reschedule-editor">
                <FormTextBox
                    type="date"
                    currentValue={rescheduleDate}
                    aria-label={t("flashcards.reschedule_hint")}
                    title={t("flashcards.reschedule_hint")}
                    disabled={disabled}
                    onChange={setRescheduleDate}
                />
                <Button
                    text={t("flashcards.apply")}
                    icon="bx-check"
                    kind="primary"
                    disabled={disabled}
                    size="small"
                    onClick={() => void submitReschedule()}
                />
                {reschedulingError && (
                    <span className="flashcards-reschedule-error" role="alert">
                        {reschedulingError}
                    </span>
                )}
            </div>}
        </div>
    );
}

function DialogFooter({
    currentCard,
    answerShown,
    submitting,
    undoableReview,
    onReveal,
    onRate,
    onUndo
}: {
    currentCard: FlashcardReviewCard | null;
    answerShown: boolean;
    submitting: boolean;
    undoableReview: UndoableReview | null;
    onReveal: () => Promise<void>;
    onRate: (preview: FlashcardReviewPreview) => Promise<void>;
    onUndo: () => Promise<void>;
}) {
    const revealButtonRef = useRef<HTMLButtonElement>(null);
    const firstRatingButtonRef = useRef<HTMLButtonElement>(null);
    const currentCardId = currentCard?.cardId;

    useEffect(() => {
        if (!currentCardId || submitting) {
            return;
        }

        if (answerShown) {
            firstRatingButtonRef.current?.focus();
        } else {
            revealButtonRef.current?.focus();
        }
    }, [ currentCardId, answerShown, submitting ]);

    if (!currentCard && !undoableReview) {
        return null;
    }

    if (!currentCard || !answerShown) {
        return (
            <div className="flashcards-action-row" role="group" aria-label={t("flashcards.review_controls")}>
                {currentCard && <Button
                    buttonRef={revealButtonRef}
                    text={t("flashcards.show_answer")}
                    icon="bx-show"
                    kind="primary"
                    keyboardShortcut="Space"
                    title={t("flashcards.show_answer_shortcut")}
                    onClick={() => void onReveal()}
                />}
                {undoableReview && <UndoButton disabled={submitting} onUndo={onUndo} />}
            </div>
        );
    }

    return (
        <div className="flashcards-rating-row" role="group" aria-label={t("flashcards.review_controls")}>
            {currentCard.previews.map((preview, index) => (
                <Button
                    key={preview.rating}
                    buttonRef={index === 0 ? firstRatingButtonRef : undefined}
                    text={t(`flashcards.rating_${preview.rating}`, {
                        interval: formatInterval(preview)
                    })}
                    disabled={submitting}
                    keyboardShortcut={preview.rating.toString()}
                    title={t(`flashcards.rate_${preview.rating}_shortcut`)}
                    onClick={() => void onRate(preview)}
                />
            ))}
            {undoableReview && <UndoButton disabled={submitting} onUndo={onUndo} />}
        </div>
    );
}

function UndoButton({ disabled, onUndo }: {
    disabled: boolean;
    onUndo: () => Promise<void>;
}) {
    return (
        <Button
            text={t("flashcards.undo_review")}
            icon="bx-undo"
            disabled={disabled}
            keyboardShortcut="U"
            title={t("flashcards.undo_review_shortcut")}
            onClick={() => void onUndo()}
        />
    );
}

type FlashcardDragTransfer = Pick<DataTransfer, "getData" | "setData">;

export function setFlashcardDragData(dataTransfer: FlashcardDragTransfer, cardId: string) {
    dataTransfer.setData(FLASHCARD_DRAG_MIME, cardId);
}

export function getFlashcardDropDue(
    dataTransfer: FlashcardDragTransfer,
    activeCardId: string,
    date: string
) {
    return dataTransfer.getData(FLASHCARD_DRAG_MIME) === activeCardId
        ? `${date}T12:00:00.000Z`
        : null;
}

function formatDueForecast(dueForecast: FlashcardStatsResponse["dueForecast"]) {
    return dueForecast.map(({ date, count }) => `${date.slice(5)}:${count}`).join(" ");
}

function formatRetention(retentionRate: number | null) {
    if (retentionRate === null) {
        return t("flashcards.no_reviews");
    }

    return `${Math.round(retentionRate * 100)}%`;
}

function formatRetrievability(retrievability: number) {
    return `${Math.round(retrievability * 100)}%`;
}

function formatInterval(preview: FlashcardReviewPreview) {
    if (preview.scheduledDays > 0) {
        return t("flashcards.days", { count: preview.scheduledDays });
    }

    return formatDateTime(preview.due, "none", "short");
}

function shouldIgnoreKeyboardTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    if (target.isContentEditable) {
        return true;
    }

    return [ "INPUT", "TEXTAREA", "SELECT" ].includes(target.tagName);
}
