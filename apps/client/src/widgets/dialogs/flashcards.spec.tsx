import type { FlashcardReviewCard } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    class FlashcardConflictError extends Error {}

    return {
        FlashcardConflictError,
        handlers: {} as Record<string, (data?: unknown) => unknown>,
        confirm: vi.fn(async () => true),
        showMessage: vi.fn(),
        getDueCards: vi.fn(),
        getStats: vi.fn(),
        getDecks: vi.fn(),
        getCard: vi.fn(),
        createCard: vi.fn(),
        getLeeches: vi.fn(),
        reviewCard: vi.fn(),
        setSuspended: vi.fn(),
        resetCard: vi.fn(),
        buryCard: vi.fn(),
        moveCardToDeck: vi.fn(),
        setCardDueDate: vi.fn(),
        createFilteredDeck: vi.fn(),
        undoReview: vi.fn()
    };
});

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../../services/toast", () => ({
    default: { showMessage: mocks.showMessage }
}));

vi.mock("../../services/dialog", () => ({
    default: { confirm: mocks.confirm }
}));

vi.mock("../../services/flashcards", () => ({
    default: {
        getDueCards: mocks.getDueCards,
        getStats: mocks.getStats,
        getDecks: mocks.getDecks,
        getCard: mocks.getCard,
        createCard: mocks.createCard,
        getLeeches: mocks.getLeeches,
        reviewCard: mocks.reviewCard,
        setSuspended: mocks.setSuspended,
        resetCard: mocks.resetCard,
        buryCard: mocks.buryCard,
        moveCardToDeck: mocks.moveCardToDeck,
        setCardDueDate: mocks.setCardDueDate,
        createFilteredDeck: mocks.createFilteredDeck,
        undoReview: mocks.undoReview
    },
    FlashcardConflictError: mocks.FlashcardConflictError
}));

vi.mock("../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks")>()),
    useTriliumEvent: (eventName: string, handler: (data?: unknown) => unknown) => {
        mocks.handlers[eventName] = handler;
    }
}));

vi.mock("../react/Modal", () => ({
    default: ({ children, footer, show }: {
        children?: unknown;
        footer?: unknown;
        show?: boolean;
    }) => (show
        ? <div className="modal-stub">{children}{footer}</div>
        : null)
}));

import FlashcardsDialog from "./flashcards";

function makeCard(overrides: Partial<FlashcardReviewCard> = {}): FlashcardReviewCard {
    return {
        cardId: "card1",
        noteId: "note1",
        deckNoteId: "deck1",
        deckTitle: "Deck",
        front: "Front title",
        back: "<p>Back content</p>",
        state: 2,
        due: "2025-01-10 03:04:05.000Z",
        schedulingRevision: 5,
        suspended: false,
        leech: false,
        retrievability: 0.9,
        previews: [
            { rating: 1, due: "2025-01-10 03:14:05.000Z", interval: 0, scheduledDays: 0 },
            { rating: 2, due: "2025-02-09 03:04:05.000Z", interval: 30, scheduledDays: 30 },
            { rating: 3, due: "2025-02-23 03:04:05.000Z", interval: 44, scheduledDays: 44 },
            { rating: 4, due: "2025-03-26 03:04:05.000Z", interval: 75, scheduledDays: 75 }
        ],
        ...overrides
    } as FlashcardReviewCard;
}

function statsResponse() {
    return {
        dueCount: 1,
        newCount: 0,
        learningCount: 0,
        reviewCount: 1,
        reviewedTodayCount: 0,
        retentionRate: null,
        lapseCount: 0,
        leechCount: 0,
        ratingCounts: { 1: 0, 2: 0, 3: 0, 4: 0 },
        dueForecast: []
    };
}

let host: HTMLElement;

beforeEach(() => {
    host = document.body.appendChild(document.createElement("div"));
    mocks.getStats.mockResolvedValue(statsResponse());
    mocks.getDecks.mockResolvedValue({ decks: [] });
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
    vi.clearAllMocks();
    mocks.handlers = {};
});

function findButtonByText(text: string) {
    return [ ...host.querySelectorAll("button") ]
        .find((button) => button.textContent?.includes(text));
}

async function pressKey(key: string, target?: HTMLElement) {
    await act(async () => {
        // Let pending effect re-registration settle before and after the event.
        await new Promise((resolve) => setTimeout(resolve, 0));
        (target ?? document.body).dispatchEvent(
            new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

async function openDialog(eventData: Record<string, unknown> = {}) {
    render(<FlashcardsDialog />, host);
    await act(async () => {
        await mocks.handlers["showFlashcards"](eventData);
    });
}

describe("flashcards review dialog", () => {
    it("shows the empty state when no cards are due", async () => {
        mocks.getDueCards.mockResolvedValue({ cards: [], totalDueCount: 0 });

        await openDialog();

        expect(host.textContent).toContain("flashcards.no_due_cards");
    });

    it("renders the due forecast as an accessible proportional chart", async () => {
        mocks.getDueCards.mockResolvedValue({ cards: [], totalDueCount: 0 });
        mocks.getStats.mockResolvedValue({
            ...statsResponse(),
            dueForecast: [
                { date: "2025-01-10", count: 0 },
                { date: "2025-01-11", count: 5 },
                { date: "2025-01-12", count: 10 }
            ]
        });

        await openDialog();

        const chart = host.querySelector(".flashcards-due-forecast");
        expect(chart?.getAttribute("aria-label")).toContain("flashcards.due_forecast");
        expect(chart?.querySelector("figcaption")?.textContent)
            .toBe("flashcards.due_forecast_heading");

        const days = chart?.querySelectorAll("[role='listitem']");
        const activeSegmentSelector = ".flashcards-due-forecast-segment-active";
        expect(days?.length).toBe(3);
        expect(days?.[1]?.getAttribute("aria-label"))
            .toContain("flashcards.due_forecast_day");
        expect(days?.[0]?.querySelectorAll(activeSegmentSelector).length).toBe(0);
        expect(days?.[1]?.querySelectorAll(activeSegmentSelector).length).toBe(4);
        expect(days?.[2]?.querySelectorAll(activeSegmentSelector).length).toBe(8);
    });

    it("marks filtered decks in the deck browser", async () => {
        mocks.getDueCards.mockResolvedValue({ cards: [], totalDueCount: 0 });
        mocks.getDecks.mockResolvedValue({
            decks: [ {
                deckNoteId: "fd1",
                deckTitle: "Filtered",
                isFiltered: true,
                dueCount: 0,
                newCount: 0,
                learningCount: 0,
                reviewCount: 0,
                totalCount: 0,
                suspendedCount: 0
            } ]
        });

        await openDialog();

        expect(host.textContent).toContain("flashcards.filtered_deck");
    });

    it("creates a filtered deck with accessible shared form controls", async () => {
        mocks.getDueCards.mockResolvedValue({ cards: [], totalDueCount: 0 });
        mocks.createFilteredDeck.mockResolvedValue({ note: { noteId: "fd1" } });

        await openDialog();

        const newButton = findButtonByText("flashcards.new_filtered_deck");
        if (!newButton) {
            throw new Error("Expected filtered-deck button");
        }

        await act(async () => {
            newButton.click();
        });

        const inputs = host.querySelectorAll<HTMLInputElement>(
            ".flashcards-filtered-deck-editor input"
        );
        expect(inputs.length).toBe(2);
        expect(inputs[0]?.classList.contains("form-control")).toBe(true);
        expect(inputs[0]?.getAttribute("aria-label")).toBe("flashcards.filtered_deck_title");
        expect(inputs[1]?.getAttribute("aria-label")).toBe("flashcards.filtered_deck_query");
        expect(document.activeElement).toBe(inputs[0]);

        const applyButton = findButtonByText("flashcards.apply");
        if (!applyButton) {
            throw new Error("Expected apply button");
        }

        await act(async () => {
            applyButton.click();
        });
        expect(host.querySelector("[role='alert']")?.textContent)
            .toBe("flashcards.filtered_deck_missing");
        expect(mocks.createFilteredDeck).not.toHaveBeenCalled();

        await act(async () => {
            const title = inputs[0];
            const query = inputs[1];
            if (!title || !query) {
                throw new Error("Expected filtered-deck inputs");
            }
            title.value = "French verbs";
            title.dispatchEvent(new Event("input", { bubbles: true }));
            query.value = "#book";
            query.dispatchEvent(new Event("input", { bubbles: true }));
        });

        await act(async () => {
            applyButton.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(mocks.createFilteredDeck).toHaveBeenCalledWith("French verbs", "#book");
    });

    it("opens scoped to a note when given a noteId", async () => {
        const card = makeCard();
        mocks.createCard.mockResolvedValue(card);

        await openDialog({ noteId: "note1" });

        expect(mocks.createCard).toHaveBeenCalledWith({ noteId: "note1", deckNoteId: undefined });
        expect(mocks.getDueCards).not.toHaveBeenCalled();
        expect(host.textContent).toContain("Front title");
    });

    it("scopes the due queue to the requested deck", async () => {
        mocks.getDueCards.mockResolvedValue({ cards: [], totalDueCount: 0 });

        await openDialog({ deckNoteId: "deck7" });

        expect(mocks.getDueCards).toHaveBeenCalledWith(expect.objectContaining({ deckNoteId: "deck7" }));
    });

    it("lists leeches on demand and reviews them by note", async () => {
        mocks.getDueCards.mockResolvedValue({ cards: [], totalDueCount: 0 });
        mocks.getStats.mockResolvedValue({ ...statsResponse(), leechCount: 2 });
        mocks.getLeeches.mockResolvedValue({
            leeches: [
                { cardId: "card1", noteId: "note1", noteTitle: "Leechy note", lapses: 8, suspended: true },
                { cardId: "card2", noteId: "note2", noteTitle: "Another leech", lapses: 12, suspended: false }
            ]
        });

        await openDialog();

        expect(mocks.getLeeches).not.toHaveBeenCalled();

        const details = host.querySelector("details.flashcards-leech-section") as HTMLDetailsElement;
        expect(details).toBeTruthy();
        await act(async () => {
            details.open = true;
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(mocks.getLeeches).toHaveBeenCalledTimes(1);
        expect(host.innerHTML, host.innerHTML).toContain("Leechy note");
        expect(host.textContent).toContain("flashcards.leech_lapses");
        // Suspended leech offers unsuspend; the action refreshes the list.
        const unsuspend = findButtonByText("flashcards.leech_unsuspend");
        expect(unsuspend).toBeTruthy();
        mocks.setSuspended.mockResolvedValue({});
        await act(async () => {
            unsuspend!.click();
        });
        expect(mocks.setSuspended).toHaveBeenCalledWith("card1", { suspended: false });

        // Reviewing a leech reopens the dialog scoped to that note.
        mocks.getDueCards.mockClear();
        const reviewButtons = [ ...host.querySelectorAll("button") ].filter((b) => b.textContent?.includes("flashcards.leech_review"));
        expect(reviewButtons.length).toBe(2);
        await act(async () => {
            reviewButtons[0].click();
        });
        expect(mocks.createCard).toHaveBeenCalledWith(expect.objectContaining({ noteId: "note1" }));
    });

    it("reveals the answer through the show-answer button", async () => {
        const card = makeCard();
        mocks.getDueCards.mockResolvedValue({ cards: [ card ], totalDueCount: 1 });

        await openDialog();

        expect(host.textContent).toContain("Front title");
        expect(host.textContent).not.toContain("flashcards.answer");

        const revealButton = findButtonByText("flashcards.show_answer");
        expect(revealButton).toBeTruthy();

        await act(async () => {
            revealButton!.click();
        });

        expect(host.textContent).toContain("flashcards.answer");
        expect(mocks.getCard).not.toHaveBeenCalled();
    });

    it("renders cloze cards as elided HTML with a card number", async () => {
        const card = makeCard({
            cardType: "cloze",
            ordinal: 1,
            front: 'Berlin is the capital of <span class="flashcard-cloze">[...]</span>'
        });
        mocks.getDueCards.mockResolvedValue({ cards: [ card ], totalDueCount: 1 });

        await openDialog();

        const elision = host.querySelector(".flashcards-front-title .flashcard-cloze");
        expect(elision?.textContent).toBe("[...]");
        expect(host.textContent).toContain("flashcards.cloze_number");
    });

    it("reschedules a card to a manual due date", async () => {
        const card = makeCard();
        const rescheduled = makeCard({ due: "2025-01-20 12:00:00.000Z" });
        mocks.getDueCards.mockResolvedValue({ cards: [ card ], totalDueCount: 1 });
        mocks.setCardDueDate.mockResolvedValue({ card: rescheduled });

        await openDialog();

        const rescheduleButton = findButtonByText("flashcards.reschedule_card");
        if (!rescheduleButton) {
            throw new Error("Expected reschedule button");
        }

        await act(async () => {
            rescheduleButton.click();
        });

        const dateInput = host.querySelector<HTMLInputElement>(
            ".flashcards-reschedule-editor input"
        );
        expect(dateInput?.classList.contains("form-control")).toBe(true);
        expect(dateInput?.getAttribute("aria-label")).toBe("flashcards.reschedule_hint");

        const applyButton = findButtonByText("flashcards.apply");
        if (!applyButton) {
            throw new Error("Expected apply button");
        }

        await act(async () => {
            applyButton.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(mocks.setCardDueDate).toHaveBeenCalledWith("card1", {
            due: "2025-01-10T12:00:00.000Z",
            expectedSchedulingRevision: 5
        });
        expect(mocks.showMessage).toHaveBeenCalledWith("flashcards.card_rescheduled");
    });

    it("lazily fetches the answer when the queue omits the back side", async () => {
        const card = makeCard({ back: undefined });
        mocks.getDueCards.mockResolvedValue({ cards: [ card ], totalDueCount: 1 });
        mocks.getCard.mockResolvedValue(makeCard());

        await openDialog();

        const revealButton = findButtonByText("flashcards.show_answer");
        await act(async () => {
            revealButton!.click();
        });

        expect(mocks.getCard).toHaveBeenCalledWith("card1");
        expect(host.textContent).toContain("Back content");
    });

    it("submits exactly one review per rating click", async () => {
        const card = makeCard();
        mocks.getDueCards.mockResolvedValue({ cards: [ card ], totalDueCount: 2 });
        let resolveReview: (value: unknown) => void = () => {};
        mocks.reviewCard.mockImplementation(() => new Promise((resolve) => {
            resolveReview = resolve;
        }));

        await openDialog();

        const revealButton = findButtonByText("flashcards.show_answer");
        await act(async () => {
            revealButton!.click();
        });

        const goodButton = findButtonByText("flashcards.rating_3");
        expect(goodButton).toBeTruthy();

        // Two rapid clicks before the request resolves must produce one call.
        await act(async () => {
            goodButton!.click();
            goodButton!.click();
        });

        expect(mocks.reviewCard).toHaveBeenCalledTimes(1);
        expect(mocks.reviewCard).toHaveBeenCalledWith("card1", {
            rating: 3,
            expectedSchedulingRevision: 5,
            clientRequestId: expect.any(String)
        });

        await act(async () => {
            resolveReview({
                reviewId: "review1",
                card: makeCard({ cardId: "card2", noteId: "note2" })
            });
        });

        expect(host.textContent).toContain("Front title");
        expect(mocks.showMessage).toHaveBeenCalledWith("flashcards.review_saved");
    });

    it("offers to refresh the card when a conflict occurs", async () => {
        const card = makeCard();
        mocks.getDueCards.mockResolvedValue({ cards: [ card ], totalDueCount: 1 });
        mocks.reviewCard.mockRejectedValueOnce(
            new mocks.FlashcardConflictError("stale")
        );
        mocks.getCard.mockResolvedValue(makeCard({ schedulingRevision: 6 }));

        await openDialog();

        const revealButton = findButtonByText("flashcards.show_answer");
        await act(async () => {
            revealButton!.click();
        });

        const againButton = findButtonByText("flashcards.rating_1");
        await act(async () => {
            againButton!.click();
        });

        expect(mocks.confirm).toHaveBeenCalled();
        expect(mocks.getCard).toHaveBeenCalledWith("card1");

        // The refreshed card stays current with its new revision.
        const goodButton = findButtonByText("flashcards.rating_3");
        expect(goodButton).toBeTruthy();
    });

    it("keeps the keyboard shortcut hint on rating buttons", async () => {
        const card = makeCard();
        mocks.getDueCards.mockResolvedValue({ cards: [ card ], totalDueCount: 1 });

        await openDialog();

        const revealButton = findButtonByText("flashcards.show_answer");
        await act(async () => {
            revealButton!.click();
        });

        for (const rating of [ 1, 2, 3, 4 ]) {
            const button = findButtonByText(`flashcards.rating_${rating}`);
            expect(button, `rating ${rating}`).toBeTruthy();
        }
    });

    it("refreshes the queue when a queued flashcard changes over sync", async () => {
        const card = makeCard();
        mocks.getDueCards.mockResolvedValue({ cards: [ card ], totalDueCount: 1 });

        render(<FlashcardsDialog />, host);
        await act(async () => {
            await mocks.handlers["showFlashcards"]({});
        });

        expect(mocks.getDueCards).toHaveBeenCalledTimes(1);

        const refreshedCard = makeCard({ schedulingRevision: 7 });
        mocks.getDueCards.mockResolvedValue({
            cards: [ refreshedCard ],
            totalDueCount: 1
        });

        await act(async () => {
            await mocks.handlers["entitiesReloaded"]({
                loadResults: {
                    getEntityRow: (entityName: string, entityId: string) =>
                        entityName === "flashcards" && entityId === "card1"
                            ? { entityId }
                            : null
                }
            });
        });

        expect(mocks.getDueCards).toHaveBeenCalledTimes(2);
        expect(mocks.showMessage).toHaveBeenCalledWith("flashcards.queue_refreshed");
    });

    it("keeps the queue untouched for unrelated sync changes", async () => {
        const card = makeCard();
        mocks.getDueCards.mockResolvedValue({ cards: [ card ], totalDueCount: 1 });

        render(<FlashcardsDialog />, host);
        await act(async () => {
            await mocks.handlers["showFlashcards"]({});
        });

        await act(async () => {
            await mocks.handlers["entitiesReloaded"]({
                loadResults: {
                    getEntityRow: () => null
                }
            });
        });

        expect(mocks.getDueCards).toHaveBeenCalledTimes(1);
        expect(mocks.showMessage).not.toHaveBeenCalledWith("flashcards.queue_refreshed");
    });

    it("reveals the answer with Space and rates with number keys", async () => {
        const card = makeCard();
        mocks.getDueCards.mockResolvedValue({ cards: [ card ], totalDueCount: 1 });

        await openDialog();

        await pressKey(" ");
        expect(host.textContent).toContain("flashcards.answer");
        expect(mocks.reviewCard).not.toHaveBeenCalled();

        await pressKey("3");
        expect(mocks.reviewCard).toHaveBeenCalledTimes(1);
        expect(mocks.reviewCard).toHaveBeenCalledWith("card1", {
            rating: 3,
            expectedSchedulingRevision: 5,
            clientRequestId: expect.any(String)
        });
    });

    it("undoes the latest review with U after rating", async () => {
        const card = makeCard();
        mocks.getDueCards.mockResolvedValue({ cards: [ card ], totalDueCount: 1 });
        mocks.reviewCard.mockResolvedValue({
            reviewId: "review1",
            card: makeCard({ cardId: "card2" })
        });
        mocks.undoReview.mockResolvedValue({ card: makeCard() });

        await openDialog();

        await pressKey(" ");
        await pressKey("4");
        expect(mocks.reviewCard).toHaveBeenCalledTimes(1);
        expect(host.textContent).toContain("flashcards.undo_review");

        // The undo affordance appears only while a fresh review exists.
        await pressKey("u");
        expect(mocks.undoReview).toHaveBeenCalledWith({
            reviewId: "review1",
            cardId: "card2",
            expectedSchedulingRevision: 5
        });
    });

    it("ignores rating keys typed into form fields", async () => {
        const card = makeCard();
        mocks.getDueCards.mockResolvedValue({ cards: [ card ], totalDueCount: 1 });
        mocks.getDecks.mockResolvedValue({
            decks: [ {
                deckNoteId: "deck1",
                deckTitle: "Deck",
                dueCount: 1,
                newCount: 0,
                learningCount: 0,
                reviewCount: 1,
                totalCount: 1,
                suspendedCount: 0
            } ]
        });

        await openDialog();

        await pressKey(" ");

        const input = document.createElement("input");
        host.appendChild(input);
        input.focus();

        await pressKey("3", input);
        expect(mocks.reviewCard).not.toHaveBeenCalled();
    });
});
