import "./flashcards.css";

import type { FlashcardReviewCard, FlashcardReviewPreview, FlashcardReviewResponse } from "@triliumnext/commons";
import { useCallback, useMemo, useState } from "preact/hooks";

import type { EventData } from "../../components/app_context";
import flashcards from "../../services/flashcards";
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

export default function FlashcardsDialog() {
    const [ shown, setShown ] = useState(false);
    const [ loading, setLoading ] = useState(false);
    const [ cards, setCards ] = useState<FlashcardReviewCard[]>([]);
    const [ currentCard, setCurrentCard ] = useState<FlashcardReviewCard | null>(null);
    const [ answerShown, setAnswerShown ] = useState(false);
    const [ submitting, setSubmitting ] = useState(false);

    const openDialog = useCallback(async ({ noteId }: EventData<"showFlashcards"> = {}) => {
        setShown(true);
        setLoading(true);
        setAnswerShown(false);

        try {
            if (noteId) {
                const card = await flashcards.createCard({ noteId });
                setCards([ card ]);
                setCurrentCard(card);
                return;
            }

            const due = await flashcards.getDueCards({ limit: REVIEW_LIMIT });
            setCards(due.cards);
            setCurrentCard(due.cards[0] ?? null);
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
                clientRequestId: randomString()
            });

            moveToNextCard(response);
        } finally {
            setSubmitting(false);
        }
    }

    function moveToNextCard(response: FlashcardReviewResponse) {
        toast.showMessage(t("flashcards.review_saved"));
        const nextCards = cards.filter((card) => card.cardId !== response.card.cardId);
        setCards(nextCards);
        setCurrentCard(nextCards[0] ?? null);
        setAnswerShown(false);
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
                onReveal={revealAnswer}
                onRate={submitRating}
            />}
        >
            <div className="flashcards-dialog-body">
                {loading
                    ? <div className="flashcards-loading">{t("flashcards.loading")}</div>
                    : currentCard
                        ? <ReviewCard card={currentCard} activeIndex={activeIndex} total={cards.length} answerShown={answerShown} />
                        : <NoItems icon="bx bx-brain" text={t("flashcards.no_due_cards")} />
                }
            </div>
        </Modal>
    );
}

function ReviewCard({ card, activeIndex, total, answerShown }: {
    card: FlashcardReviewCard;
    activeIndex: number;
    total: number;
    answerShown: boolean;
}) {
    return (
        <>
            <div className="flashcards-card-meta">
                <span>{t("flashcards.progress", { current: Math.max(activeIndex + 1, 1), total })}</span>
                <span>{t("flashcards.deck", { title: card.deckTitle })}</span>
                <span>{t("flashcards.due", { date: formatDateTime(card.due) })}</span>
            </div>
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

function DialogFooter({ currentCard, answerShown, submitting, onReveal, onRate }: {
    currentCard: FlashcardReviewCard | null;
    answerShown: boolean;
    submitting: boolean;
    onReveal: () => Promise<void>;
    onRate: (preview: FlashcardReviewPreview) => Promise<void>;
}) {
    if (!currentCard) {
        return null;
    }

    if (!answerShown) {
        return (
            <div className="flashcards-action-row">
                <Button text={t("flashcards.show_answer")} icon="bx-show" kind="primary" onClick={() => void onReveal()} />
            </div>
        );
    }

    return (
        <div className="flashcards-rating-row">
            {currentCard.previews.map((preview) => (
                <Button
                    key={preview.rating}
                    text={t(`flashcards.rating_${preview.rating}`, { interval: formatInterval(preview) })}
                    disabled={submitting}
                    onClick={() => void onRate(preview)}
                />
            ))}
        </div>
    );
}

function formatInterval(preview: FlashcardReviewPreview) {
    if (preview.scheduledDays > 0) {
        return t("flashcards.days", { count: preview.scheduledDays });
    }

    return formatDateTime(preview.due, "none", "short");
}
