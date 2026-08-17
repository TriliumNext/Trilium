import "./flashcards.css";

import type {
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
import Button from "../react/Button";
import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import NoItems from "../react/NoItems";
import { RawHtmlBlock } from "../react/RawHtml";

const REVIEW_LIMIT = 20;

interface UndoableReview {
    reviewId: string;
    cardId: string;
    expectedSchedulingRevision: number;
}

export default function FlashcardsDialog() {
    const [ shown, setShown ] = useState(false);
    const [ loading, setLoading ] = useState(false);
    const [ cards, setCards ] = useState<FlashcardReviewCard[]>([]);
    const [ currentCard, setCurrentCard ] = useState<FlashcardReviewCard | null>(null);
    const [ stats, setStats ] = useState<FlashcardStatsResponse | null>(null);
    const [ answerShown, setAnswerShown ] = useState(false);
    const [ submitting, setSubmitting ] = useState(false);
    const [ reviewRequestId, setReviewRequestId ] = useState(() => randomString());
    const [ undoableReview, setUndoableReview ] = useState<UndoableReview | null>(null);

    const openDialog = useCallback(async ({ noteId }: EventData<"showFlashcards"> = {}) => {
        setShown(true);
        setLoading(true);
        setStats(null);
        setAnswerShown(false);
        setReviewRequestId(randomString());
        setUndoableReview(null);

        try {
            if (noteId) {
                const card = await flashcards.createCard({ noteId });
                const loadedStats = await flashcards.getStats();
                setCards([ card ]);
                setCurrentCard(card);
                setStats(loadedStats);
                return;
            }

            const [ due, loadedStats ] = await Promise.all([
                flashcards.getDueCards({ limit: REVIEW_LIMIT }),
                flashcards.getStats()
            ]);
            setCards(due.cards);
            setCurrentCard(due.cards[0] ?? null);
            setStats(loadedStats);
        } finally {
            setLoading(false);
        }
    }, []);

    useTriliumEvent("showFlashcards", openDialog);

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

    async function refreshStats() {
        setStats(await flashcards.getStats());
    }

    async function revealAnswer() {
        if (!currentCard) {
            return;
        }

        if (currentCard.back === undefined) {
            setCurrentCard(await flashcards.getCard(currentCard.cardId));
        }

        setAnswerShown(true);
    }

    async function submitRating(preview: FlashcardReviewPreview) {
        if (!currentCard) {
            return;
        }

        setSubmitting(true);
        try {
            const response = await flashcards.reviewCard(currentCard.cardId, {
                rating: preview.rating,
                expectedSchedulingRevision: currentCard.schedulingRevision,
                clientRequestId: reviewRequestId
            });

            moveToNextCard(response);
        } catch (e) {
            if (e instanceof FlashcardConflictError) {
                await handleReviewConflict(currentCard.cardId, e.message);
                return;
            }

            throw e;
        } finally {
            setSubmitting(false);
        }
    }

    async function toggleSuspended() {
        if (!currentCard) {
            return;
        }

        const suspended = !currentCard.suspended;
        setSubmitting(true);
        try {
            const response = await flashcards.setSuspended(currentCard.cardId, {
                suspended,
                expectedSchedulingRevision: currentCard.schedulingRevision
            });

            applyLifecycleUpdate(response.card);
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
            setSubmitting(false);
        }
    }

    async function resetCurrentCard() {
        if (!currentCard) {
            return;
        }

        const confirmed = await dialogService.confirm(t("flashcards.reset_confirm"));
        if (!confirmed) {
            return;
        }

        setSubmitting(true);
        try {
            const response = await flashcards.resetCard(currentCard.cardId, {
                expectedSchedulingRevision: currentCard.schedulingRevision
            });

            applyLifecycleUpdate(response.card);
            setUndoableReview(null);
            toast.showMessage(t("flashcards.card_reset"));
        } catch (e) {
            if (e instanceof FlashcardConflictError) {
                await handleReviewConflict(currentCard.cardId, e.message);
                return;
            }

            throw e;
        } finally {
            setSubmitting(false);
        }
    }

    async function buryCurrentCard() {
        if (!currentCard) {
            return;
        }

        setSubmitting(true);
        try {
            const response = await flashcards.buryCard(currentCard.cardId, {
                expectedSchedulingRevision: currentCard.schedulingRevision
            });

            removeCurrentCard(response.card.cardId);
            setUndoableReview(null);
            void refreshStats();
            toast.showMessage(t("flashcards.card_buried"));
        } catch (e) {
            if (e instanceof FlashcardConflictError) {
                await handleReviewConflict(currentCard.cardId, e.message);
                return;
            }

            throw e;
        } finally {
            setSubmitting(false);
        }
    }

    async function undoLastReview() {
        if (!undoableReview) {
            return;
        }

        setSubmitting(true);
        try {
            const response = await flashcards.undoReview(undoableReview);
            setUndoableReview(null);
            applyLifecycleUpdate(response.card);
            toast.showMessage(t("flashcards.review_undone"));
        } catch (e) {
            if (e instanceof FlashcardConflictError) {
                await handleReviewConflict(undoableReview.cardId, e.message);
                setUndoableReview(null);
                return;
            }

            throw e;
        } finally {
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
        await refreshStats();
        toast.showMessage(t("flashcards.card_refreshed"));
    }

    function moveToNextCard(response: FlashcardReviewResponse) {
        toast.showMessage(t("flashcards.review_saved"));
        setUndoableReview({
            reviewId: response.reviewId,
            cardId: response.card.cardId,
            expectedSchedulingRevision: response.card.schedulingRevision
        });
        removeCurrentCard(response.card.cardId);
        void refreshStats();
    }

    function applyLifecycleUpdate(card: FlashcardReviewCard) {
        if (card.suspended) {
            removeCurrentCard(card.cardId);
            void refreshStats();
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
        void refreshStats();
    }

    function removeCurrentCard(cardId: string) {
        const nextCards = cards.filter((card) => card.cardId !== cardId);
        setCards(nextCards);
        setCurrentCard(nextCards[0] ?? null);
        setAnswerShown(false);
        setReviewRequestId(randomString());
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
            <div className="flashcards-dialog-body">
                {stats && <ReviewStats stats={stats} />}
                {loading
                    ? <div className="flashcards-loading">{t("flashcards.loading")}</div>
                    : currentCard
                        ? <ReviewCard
                            card={currentCard}
                            activeIndex={activeIndex}
                            total={cards.length}
                            answerShown={answerShown}
                            submitting={submitting}
                            onToggleSuspended={toggleSuspended}
                            onReset={resetCurrentCard}
                            onBury={buryCurrentCard}
                        />
                        : <NoItems icon="bx bx-brain" text={t("flashcards.no_due_cards")} />
                }
            </div>
        </Modal>
    );
}

function ReviewStats({ stats }: { stats: FlashcardStatsResponse }) {
    return (
        <div className="flashcards-session-stats" aria-live="polite">
            <span>{t("flashcards.due_count", { count: stats.dueCount })}</span>
            <span>{t("flashcards.new_count", { count: stats.newCount })}</span>
            <span>{t("flashcards.learning_count", { count: stats.learningCount })}</span>
            <span>{t("flashcards.review_count", { count: stats.reviewCount })}</span>
        </div>
    );
}

function ReviewCard({
    card,
    activeIndex,
    total,
    answerShown,
    submitting,
    onToggleSuspended,
    onReset,
    onBury
}: {
    card: FlashcardReviewCard;
    activeIndex: number;
    total: number;
    answerShown: boolean;
    submitting: boolean;
    onToggleSuspended: () => Promise<void>;
    onReset: () => Promise<void>;
    onBury: () => Promise<void>;
}) {
    return (
        <>
            <div className="flashcards-card-meta">
                <span>{t("flashcards.progress", {
                    current: Math.max(activeIndex + 1, 1),
                    total
                })}</span>
                <span>{t("flashcards.deck", { title: card.deckTitle })}</span>
                <span>{t("flashcards.due", { date: formatDateTime(card.due) })}</span>
            </div>
            <CardLifecycleActions
                card={card}
                disabled={submitting}
                onToggleSuspended={onToggleSuspended}
                onReset={onReset}
                onBury={onBury}
            />
            <section className="flashcards-card-pane" aria-live="polite">
                <h3 className="flashcards-front-title">{card.front}</h3>
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

function CardLifecycleActions({ card, disabled, onToggleSuspended, onReset, onBury }: {
    card: FlashcardReviewCard;
    disabled: boolean;
    onToggleSuspended: () => Promise<void>;
    onReset: () => Promise<void>;
    onBury: () => Promise<void>;
}) {
    return (
        <div className="flashcards-card-actions">
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
            <div className="flashcards-action-row">
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
        <div className="flashcards-rating-row">
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
